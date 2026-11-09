'use strict';
/**
 * NovaCRM V1.1 —— 零依赖 Node HTTP + 内置 SQLite 服务端
 * 业务记录以 JSON 存储在 records 表，按 tenant_id 隔离；所有写操作写审计日志。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const backups = require('./lib/backup');
const CSV = require('./lib/csv');
const TOTP = require('./lib/totp');

const VERSION = '1.2.0';
const PORT = Number(process.env.PORT || 3100);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SESSION_HOURS = 8;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'crm.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','manager','sales','viewer')),display_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(tenant_id,email));
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expiry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_records_tenant_type ON records(tenant_id,type,deleted);
CREATE TABLE IF NOT EXISTS audits(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audits(tenant_id,at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---------- 结构迁移（V1.0 → V1.1，幂等） ----------
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('tenants', 'settings', "settings TEXT NOT NULL DEFAULT '{}'");
addColumn('users', 'department', "department TEXT NOT NULL DEFAULT ''");
addColumn('users', 'last_login_at', 'last_login_at TEXT');
addColumn('users', 'data_scope', "data_scope TEXT NOT NULL DEFAULT ''");
addColumn('users', 'notif_seen_at', 'notif_seen_at TEXT');
addColumn('users', 'totp_secret', "totp_secret TEXT NOT NULL DEFAULT ''");
addColumn('users', 'totp_enabled', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'totp_last_step', 'totp_last_step INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS login_failures(key TEXT PRIMARY KEY,first_at INTEGER NOT NULL,count INTEGER NOT NULL)');
db.exec(`CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_attach_entity ON attachments(tenant_id,entity,entity_id,deleted);`);
db.exec(`
CREATE INDEX IF NOT EXISTS idx_records_account ON records(tenant_id,type,json_extract(data,'$.accountId')) WHERE deleted=0;
CREATE INDEX IF NOT EXISTS idx_records_contract ON records(tenant_id,type,json_extract(data,'$.contractId')) WHERE deleted=0;
CREATE INDEX IF NOT EXISTS idx_records_opportunity ON records(tenant_id,type,json_extract(data,'$.opportunityId')) WHERE deleted=0;
`);

// ---------- 业务字典 ----------
const STAGES = ['初步沟通', '需求确认', '方案报价', '商务谈判', '赢单', '输单'];
const OPEN_STAGES = STAGES.slice(0, 4);
const LEAD_STATUS = ['未联系', '跟进中', '已分配', '已转化', '已失效'];
const TASK_STATUS = ['待处理', '进行中', '已完成'];
const CONTRACT_STATUS = ['草稿', '审批中', '已签订', '执行中', '已完成', '已作废'];
const CONTRACT_APPROVED = ['已签订', '执行中', '已完成', '已作废']; // 仅经理/管理员可设置
const PLAN_STATUS = ['待回款', '已回款'];
const PRIORITY = ['低', '中', '高'];
const ROLES = ['admin', 'manager', 'sales', 'viewer'];
const DATA_SCOPES = ['self', 'dept', 'all'];
const DEFAULT_SCOPE = { admin: 'all', manager: 'all', sales: 'self', viewer: 'all' };
/** 金额字段在库中以整数“分”存储（amountCents），API 对外仍为“元” */
const MONEY_TYPES = new Set(['opportunities', 'contracts', 'payments', 'plans']);

/** V1.0 旧枚举值 → V1.1 新值（入参归一化 + 启动迁移共用） */
const LEGACY = {
  leads: { status: { 新建: '未联系', 无效: '已失效' } },
  opportunities: { stage: { 初步接洽: '初步沟通', 谈判签约: '商务谈判' } },
  tasks: { status: { 待办: '待处理', 完成: '已完成' } },
  contracts: { status: { 已签署: '已签订', 已终止: '已作废' } },
};

const DEFAULT_SETTINGS = {
  systemName: 'NovaCRM',
  companyName: '默认企业',
  dicts: {
    leadSources: ['官网', '广告', '展会', '电话', '转介绍', '公众号', '其他'],
    accountTypes: ['企业客户', '个人客户', '渠道伙伴'],
    accountLevels: ['VIP', '重要', '普通'],
    accountStatus: ['潜在', '合作中', '休眠', '流失'],
    industries: ['科技/IT', '互联网/软件', '制造业', '文化传媒', '能源', '建筑工程', '金融', '教育', '医疗', '其他'],
    activityTypes: ['电话', '微信', '拜访', '邮件', '会议', '演示'],
    activityResults: ['有效跟进', '安排演示', '待反馈', '持续跟进', '推进中', '无效'],
    paymentMethods: ['银行转账', '支付宝', '微信', '现金', '其他'],
    departments: ['销售部', '客户部', '市场部', '财务部', '技术部'],
  },
  /** 自定义字段：{ 实体: [{ key: 'cf_xxxx', label, type, options, required, inList }] } */
  customFields: {},
  /** 合同审批：按金额阈值命中的级别依次审批 */
  approval: { levels: [{ name: '销售经理审批', role: 'manager', minAmount: 0 }] },
  /** 群机器人通知：kind = wecom | dingtalk | generic */
  webhook: { url: '', kind: 'wecom', events: ['approval', 'assign'] },
  logo: '',
};
const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select'];
const CUSTOM_FIELD_ENTITIES = ['leads', 'accounts', 'contacts', 'opportunities', 'contracts'];
const WEBHOOK_EVENTS = ['approval', 'assign', 'overdue'];

/**
 * 实体定义：fields 为允许写入的字段；enums 为服务端强校验的枚举；numbers 为数字字段及范围。
 * labels 用于 CSV 导出表头。
 */
const TABLES = {
  leads: {
    label: '线索', fields: ['name', 'company', 'phone', 'email', 'source', 'status', 'owner', 'ownerId', 'notes', 'convertedAccountId'],
    required: ['name'], defaults: { status: '未联系', source: '其他' }, enums: { status: LEAD_STATUS },
  },
  accounts: {
    label: '客户', fields: ['name', 'type', 'industry', 'level', 'source', 'status', 'phone', 'email', 'owner', 'ownerId', 'address', 'foundedAt', 'notes'],
    required: ['name'], defaults: { type: '企业客户', level: '普通', status: '合作中' },
  },
  contacts: {
    label: '联系人', fields: ['name', 'accountId', 'title', 'phone', 'email', 'isPrimary', 'notes'],
    required: ['name', 'accountId'], defaults: {},
  },
  opportunities: {
    label: '商机', fields: ['name', 'accountId', 'amount', 'probability', 'stage', 'owner', 'ownerId', 'expectedDate', 'notes'],
    required: ['name', 'accountId'], defaults: { amount: 0, stage: '初步沟通', probability: 10 },
    enums: { stage: STAGES }, numbers: { probability: [0, 100] },
  },
  tasks: {
    label: '任务', fields: ['title', 'accountId', 'dueDate', 'priority', 'status', 'owner', 'ownerId', 'notes'],
    required: ['title'], defaults: { priority: '中', status: '待处理' }, enums: { status: TASK_STATUS, priority: PRIORITY },
  },
  activities: {
    label: '跟进记录', fields: ['accountId', 'type', 'content', 'result', 'occurredAt', 'nextAt', 'owner', 'ownerId'],
    required: ['accountId', 'content'], defaults: { type: '电话', result: '有效跟进' },
  },
  contracts: {
    label: '合同', fields: ['name', 'number', 'accountId', 'opportunityId', 'amount', 'status', 'signedAt', 'startDate', 'endDate', 'owner', 'ownerId', 'notes', 'approvalNote'],
    required: ['name', 'accountId'], defaults: { status: '草稿', amount: 0 }, enums: { status: CONTRACT_STATUS },
  },
  payments: {
    label: '回款', fields: ['contractId', 'amount', 'paidAt', 'method', 'notes'],
    required: ['contractId', 'amount'], defaults: { method: '银行转账' },
  },
  plans: {
    label: '回款计划', fields: ['contractId', 'amount', 'dueDate', 'status', 'notes'],
    required: ['contractId', 'amount', 'dueDate'], defaults: { status: '待回款' }, enums: { status: PLAN_STATUS },
  },
};
const LABELS = {
  id: '编号', name: '名称', company: '公司', phone: '电话', email: '邮箱', source: '来源', status: '状态', owner: '负责人',
  notes: '备注', convertedAccountId: '转化客户', type: '类型', industry: '行业', level: '级别', address: '地址', foundedAt: '成立时间',
  accountId: '客户', title: '标题/职位', isPrimary: '主联系人', amount: '金额', probability: '赢率%', stage: '阶段',
  expectedDate: '预计成交', dueDate: '截止日期', priority: '优先级', content: '跟进内容', result: '跟进结果', occurredAt: '跟进时间',
  nextAt: '下次跟进', number: '合同编号', opportunityId: '商机', signedAt: '签订日期', startDate: '开始日期', endDate: '结束日期',
  approvalNote: '审批意见', contractId: '合同', paidAt: '到账日期', method: '付款方式', createdAt: '创建时间', updatedAt: '更新时间',
};

// ---------- 基础工具 ----------
const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
/** 服务器本地时区的 YYYY-MM-DD（Docker 中通过 TZ 设定为业务时区） */
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDay = v => (!v ? '' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v) ? v.slice(0, 10) : ymd(new Date(v))));
const cents = v => Math.round(Number(v || 0) * 100);
const yuan = c => c / 100;
const sumCents = arr => arr.reduce((a, x) => a + cents(x.amount), 0);
const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur ? 100 : 0));

function row(r) {
  if (!r) return null;
  const d = JSON.parse(r.data);
  if (Object.hasOwn(d, 'amountCents')) { d.amount = d.amountCents / 100; delete d.amountCents; }
  return { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, ...d };
}
/** API 数据 → 落库 JSON（金额转整数分，去掉元数据字段） */
function serialize(type, data) {
  const d = { ...data };
  for (const k of ['id', 'createdAt', 'updatedAt', 'createdBy']) delete d[k];
  if (MONEY_TYPES.has(type) && Object.hasOwn(d, 'amount')) { d.amountCents = Math.round(Number(d.amount || 0) * 100); delete d.amount; }
  return JSON.stringify(d);
}
const hashPwd = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
function verifyPwd(pwd, hash) {
  const [salt, expected] = String(hash).split(':');
  if (!salt || !expected) return false;
  const a = Buffer.from(expected, 'hex'), b = crypto.scryptSync(pwd, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const getRecord = (u, type, key) => db.prepare('SELECT * FROM records WHERE id=? AND tenant_id=? AND type=? AND deleted=0').get(key, u.tenant_id, type);
const all = (u, type) => db.prepare('SELECT * FROM records WHERE tenant_id=? AND type=? AND deleted=0 ORDER BY created_at DESC').all(u.tenant_id, type).map(row);
/** 按关联字段取子记录（走表达式索引，不做数据范围过滤，用于完整性校验） */
const childrenOf = (u, type, field, value) => db.prepare(`SELECT * FROM records WHERE tenant_id=? AND type=? AND deleted=0 AND json_extract(data,'$.${field}')=?`).all(u.tenant_id, type, value).map(row);

/** 按 ID 批量取记录（含已删除，用于显示名称） */
function byIds(u, type, ids) {
  const out = new Map(), list = [...ids].filter(Boolean);
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    for (const r of db.prepare(`SELECT * FROM records WHERE tenant_id=? AND type=? AND id IN (${chunk.map(() => '?').join(',')})`).all(u.tenant_id, type, ...chunk)) out.set(r.id, row(r));
  }
  return out;
}
/** 为列表项补充关联名称（客户名、合同编号名称、商机名），前端无需加载全量引用数据 */
function decorate(u, items) {
  const acc = new Set(), con = new Set(), opp = new Set();
  for (const x of items) { if (x.accountId) acc.add(x.accountId); if (x.contractId) con.add(x.contractId); if (x.opportunityId) opp.add(x.opportunityId); if (x.convertedAccountId) acc.add(x.convertedAccountId); }
  const contracts = byIds(u, 'contracts', con);
  for (const c of contracts.values()) acc.add(c.accountId);
  const accounts = byIds(u, 'accounts', acc), opps = byIds(u, 'opportunities', opp);
  return items.map(x => {
    const d = { ...x };
    if (x.accountId) d.accountName = accounts.get(x.accountId)?.name || '';
    if (x.opportunityId) d.opportunityName = opps.get(x.opportunityId)?.name || '';
    if (x.contractId) {
      const c = contracts.get(x.contractId);
      d.contractLabel = c ? `${c.number || ''} ${c.name}`.trim() : '';
      d.contractAccountId = c?.accountId || ''; d.contractAccountName = c ? accounts.get(c.accountId)?.name || '' : '';
    }
    return d;
  });
}
/** 下拉框远程搜索 */
function lookup(u, params) {
  const type = params.get('type');
  if (!['accounts', 'contracts', 'opportunities'].includes(type)) boom(400, '不支持的类型');
  const q = String(params.get('q') || '').trim().toLowerCase(), accountId = params.get('accountId'), ids = params.get('ids');
  const limit = Math.min(100, Number(params.get('limit')) || 30);
  let items = scoped(u, type);
  if (ids) { const want = new Set(ids.split(',')); items = items.filter(x => want.has(x.id)); }
  if (accountId) items = items.filter(x => x.accountId === accountId);
  if (type === 'contracts' && params.get('active') === '1') items = items.filter(x => x.status !== '已作废');
  if (q) items = items.filter(x => `${x.name || ''} ${x.number || ''} ${x.phone || ''}`.toLowerCase().includes(q));
  items = decorate(u, items.slice(0, limit));
  return { items: items.map(x => ({ id: x.id, label: type === 'contracts' ? `${x.number || ''} ${x.name} · ${x.accountName}`.trim() : type === 'opportunities' ? `${x.name} · ¥${Number(x.amount || 0).toLocaleString('zh-CN')}` : x.name, accountId: x.accountId || '', amount: x.amount })) };
}

// ---------- 行级数据权限 ----------
const effectiveScope = u => (DATA_SCOPES.includes(u.data_scope) ? u.data_scope : DEFAULT_SCOPE[u.role] || 'self');
/** 可见负责人集合；null 表示全部可见 */
function scopeOwners(u) {
  if (u._owners !== undefined) return u._owners;
  const scope = effectiveScope(u);
  if (scope === 'all') return (u._owners = null);
  if (scope === 'dept' && u.department) return (u._owners = new Set(db.prepare('SELECT id FROM users WHERE tenant_id=? AND department=?').all(u.tenant_id, u.department).map(x => x.id)));
  return (u._owners = new Set([u.id]));
}
/**
 * 当前用户可见的记录：
 * 线索/客户按负责人；联系人随客户；回款/回款计划随合同；商机/合同/跟进/任务 = 本人负责 或 所属客户可见。
 * 未设置负责人的记录归创建人。
 */
function scoped(u, type) {
  const owners = scopeOwners(u);
  if (!owners) return all(u, type);
  const memo = (u._scoped ||= {});
  if (memo[type]) return memo[type];
  const own = x => owners.has(x.ownerId || x.createdBy);
  const items = all(u, type);
  const ids = t => new Set(scoped(u, t).map(x => x.id));
  let res;
  if (type === 'leads' || type === 'accounts') res = items.filter(own);
  else if (type === 'contacts') { const acc = ids('accounts'); res = items.filter(x => acc.has(x.accountId)); }
  else if (type === 'payments' || type === 'plans') { const c = ids('contracts'); res = items.filter(x => c.has(x.contractId)); }
  else { const acc = ids('accounts'); res = items.filter(x => own(x) || acc.has(x.accountId)); }
  return (memo[type] = res);
}
/** 取单条且校验数据范围 */
function getVisible(u, type, key) {
  const r = getRecord(u, type, key);
  if (!r || !scopeOwners(u)) return r;
  return scoped(u, type).some(x => x.id === key) ? r : undefined;
}
const resetScope = u => { delete u._scoped; };

function audit(u, action, entity, entityId, details = {}) {
  db.prepare('INSERT INTO audits VALUES(?,?,?,?,?,?,?,?)').run(newId(), u.tenant_id, u.id, action, entity, entityId, JSON.stringify(details), now());
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function boom(status, message) { throw httpError(status, message); }
const publicUser = u => ({ id: u.id, tenantId: u.tenant_id, name: u.display_name, email: u.email, role: u.role, department: u.department || '', mfaEnabled: !!u.totp_enabled });
const canWrite = u => ['admin', 'manager', 'sales'].includes(u.role);
const canManage = u => ['admin', 'manager'].includes(u.role);
const canDelete = canManage;

function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- 设置 ----------
function getSettings(tenantId) {
  const t = db.prepare('SELECT name,settings FROM tenants WHERE id=?').get(tenantId);
  let s = {};
  try { s = JSON.parse(t?.settings || '{}'); } catch { s = {}; }
  return {
    ...DEFAULT_SETTINGS, ...s, companyName: s.companyName || t?.name || DEFAULT_SETTINGS.companyName,
    dicts: { ...DEFAULT_SETTINGS.dicts, ...(s.dicts || {}) },
    customFields: s.customFields || {}, approval: s.approval?.levels?.length ? s.approval : DEFAULT_SETTINGS.approval,
    webhook: { ...DEFAULT_SETTINGS.webhook, ...(s.webhook || {}) },
  };
}
/** 返回给前端的设置：Webhook 地址含密钥，仅管理员可见 */
function publicSettings(u) {
  const st = getSettings(u.tenant_id);
  if (u.role !== 'admin') st.webhook = { configured: !!st.webhook.url };
  return st;
}
const customFieldsOf = (u, type) => (u ? getSettings(u.tenant_id).customFields?.[type] || [] : []);

// ---------- 会话 & Cookie ----------
const makeCookie = (token, maxAge) => `crm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
const sessionToken = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('crm_session='))?.slice(12) || '';
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
function authenticate(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const s = db.prepare('SELECT u.*, s.expiry FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?').get(tokenHash(token));
  return s && s.active && s.expiry > now() ? s : null;
}
function createSession(u, res) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), u.id, new Date(Date.now() + SESSION_HOURS * 3600000).toISOString());
  res.setHeader('Set-Cookie', makeCookie(token, SESSION_HOURS * 3600));
}
const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expiry<=?').run(now());

// ---------- 登录防爆破（单进程内存计数） ----------
const LOGIN_WINDOW_MS = 15 * 60 * 1000, LOGIN_MAX_PER_ACCOUNT = 5, LOGIN_MAX_PER_IP = 30;
// 失败计数存于数据库：重启不丢失，多进程共享同一数据库时也一致
function loginBlocked(keys) {
  const t = Date.now(), get = db.prepare('SELECT first_at,count FROM login_failures WHERE key=?');
  return keys.some(([k, max]) => { const v = get.get(k); return v && t - v.first_at < LOGIN_WINDOW_MS && v.count >= max; });
}
function recordLoginFailure(keys) {
  const t = Date.now();
  const upsert = db.prepare(`INSERT INTO login_failures(key,first_at,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ?-first_at>=? THEN 1 ELSE count+1 END, first_at=CASE WHEN ?-first_at>=? THEN ? ELSE first_at END`);
  for (const [k] of keys) upsert.run(k, t, t, LOGIN_WINDOW_MS, t, LOGIN_WINDOW_MS, t);
}
const clearLoginFailures = key => db.prepare('DELETE FROM login_failures WHERE key=?').run(key);
const pruneLoginFailures = () => db.prepare('DELETE FROM login_failures WHERE first_at<?').run(Date.now() - LOGIN_WINDOW_MS);

/** 密码策略：≥12 位，包含大写/小写/数字/符号中至少 3 类，且不包含邮箱前缀 */
function checkPassword(pw, email = '') {
  pw = String(pw || '');
  if (pw.length < 12 || pw.length > 128) boom(400, '密码长度需为 12-128 位');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (classes < 3) boom(400, '密码需包含大写字母、小写字母、数字、符号中的至少 3 类');
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) boom(400, '密码不能包含账号名');
}

/** 反向代理部署时设置 TRUST_PROXY=1，取 X-Forwarded-For 最左侧地址 */
const clientIp = req => (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress || '');
const SECURITY_HEADERS = process.env.COOKIE_SECURE === '1' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {};

// ---------- HTTP 工具 ----------
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
};
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = []; let len = 0, failed = false;
    req.on('data', chunk => {
      if (failed) return;
      len += chunk.length;
      if (len > limit) { failed = true; reject(httpError(413, '请求体过大')); return; }
      parts.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(httpError(400, 'JSON格式错误')); }
    });
    req.on('error', reject);
  });
}
/** 防 CSV 公式注入：以 = + - @ 制表/回车开头的单元格前加单引号 */
const csv = CSV.stringify;
function sendCSV(res, filename, headers, rows) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'no-store' });
  res.end(csv(headers, rows));
}

// ---------- 校验 ----------
function sanitize(type, obj, existing = {}, u = null) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) boom(400, '提交内容无效');
  const def = TABLES[type];
  const data = { ...existing, ...(!Object.keys(existing).length ? def.defaults : {}) };
  for (const field of def.fields) {
    if (!Object.hasOwn(obj, field)) continue;
    let v = obj[field];
    if (field === 'amount') {
      if (typeof v !== 'number' && typeof v !== 'string') boom(400, '金额格式错误');
      v = Number(v);
      if (!Number.isFinite(v) || v < 0 || v > 1e12 || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) boom(400, '金额必须为非负、最多两位小数');
    } else if (def.numbers?.[field]) {
      const [min, max] = def.numbers[field];
      v = v === '' || v === null ? min : Number(v);
      if (!Number.isFinite(v) || v < min || v > max) boom(400, `${LABELS[field] || field} 必须在 ${min}-${max} 之间`);
    } else if (field === 'isPrimary') {
      v = v === true || v === 'true' || v === '1' || v === 1;
    } else if (typeof v !== 'string' || v.length > 3000) {
      boom(400, `${field} 必须为长度不超过3000的文本`);
    }
    const legacy = LEGACY[type]?.[field]?.[v];
    if (legacy) v = legacy;
    if (def.enums?.[field] && !def.enums[field].includes(v)) boom(400, `${LABELS[field] || field} 取值无效：${v}`);
    data[field] = v;
  }
  for (const k of def.required) if (!String(data[k] ?? '').trim()) boom(400, `缺少必填字段: ${LABELS[k] || k}`);
  const custom = customFieldsOf(u, type), creating = !Object.keys(existing).length;
  for (const f of custom) {
    if (!Object.hasOwn(obj, f.key)) continue;
    let v = obj[f.key] ?? '';
    if (f.type === 'number') {
      if (v !== '') { v = Number(v); if (!Number.isFinite(v)) boom(400, `${f.label} 必须为数字`); }
    } else {
      if (typeof v !== 'string' && typeof v !== 'number') boom(400, `${f.label} 格式错误`);
      v = String(v);
      if (v.length > 3000) boom(400, `${f.label} 过长`);
      if (f.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) boom(400, `${f.label} 日期格式应为 YYYY-MM-DD`);
      if (f.type === 'select' && v && !(f.options || []).includes(v)) boom(400, `${f.label} 取值无效：${v}`);
    }
    data[f.key] = v;
  }
  for (const f of custom) if (f.required && (creating || Object.hasOwn(obj, f.key)) && String(data[f.key] ?? '').trim() === '') boom(400, `缺少必填字段: ${f.label}`);
  return data;
}

function collectedCents(u, contractId) {
  return sumCents(childrenOf(u, 'payments', 'contractId', contractId));
}

/**
 * 负责人解析：优先 ownerId（成员 ID）；兼容旧接口按姓名传 owner。
 * 新建未指定时默认当前用户；仅“全部”范围可分配给任意人，“本部门”限本部门，“本人”仅能给自己。
 */
function resolveOwner(u, type, data, submitted, before = null) {
  if (!TABLES[type].fields.includes('ownerId')) return;
  let target;
  if (Object.hasOwn(submitted, 'ownerId')) target = submitted.ownerId ? findUser(u, { id: submitted.ownerId }) : null;
  else if (Object.hasOwn(submitted, 'owner')) target = submitted.owner ? findUser(u, { name: submitted.owner }) : null;
  else if (!before) target = u;
  else return;
  if (target === undefined) boom(400, '负责人不存在或已停用');
  if (target && target.id !== before?.ownerId) assertCanAssign(u, target);
  data.ownerId = target ? target.id : '';
  data.owner = target ? target.display_name : '';
}
function findUser(u, { id, name }) {
  const rows = id ? db.prepare('SELECT * FROM users WHERE tenant_id=? AND id=? AND active=1').all(u.tenant_id, id)
    : db.prepare('SELECT * FROM users WHERE tenant_id=? AND display_name=? AND active=1').all(u.tenant_id, String(name).trim());
  return rows.length === 1 ? rows[0] : undefined;
}
function assertCanAssign(u, target) {
  const scope = effectiveScope(u);
  if (scope === 'self' && target.id !== u.id) boom(403, '当前数据范围为“本人”，不能分配给其他成员');
  if (scope === 'dept' && target.id !== u.id && (!u.department || target.department !== u.department)) boom(403, '只能分配给本部门成员');
}

function validRefs(u, type, data, recordId = null) {
  for (const [field, refType] of [['accountId', 'accounts'], ['opportunityId', 'opportunities'], ['contractId', 'contracts']]) {
    if (data[field] && !getVisible(u, refType, data[field])) boom(400, `${LABELS[field] || field}关联数据不存在或无权访问`);
  }
  if (type === 'payments') {
    const contract = row(getRecord(u, 'contracts', data.contractId));
    if (contract.status === '已作废') boom(409, '合同已作废，不能登记回款');
    const amount = cents(data.amount);
    if (amount <= 0) boom(400, '回款金额必须大于0');
    if (collectedCents(u, data.contractId) + amount > cents(contract.amount)) boom(409, '累计回款不能超过合同金额');
  }
  if (type === 'plans' && cents(data.amount) <= 0) boom(400, '计划金额必须大于0');
  if (type === 'contracts') {
    if (recordId && cents(data.amount) < collectedCents(u, recordId)) boom(409, '合同金额不能低于已登记回款');
    if (data.number) {
      const dup = db.prepare("SELECT id FROM records WHERE tenant_id=? AND type='contracts' AND deleted=0 AND json_extract(data,'$.number')=? AND id<>?").get(u.tenant_id, data.number, recordId || '');
      if (dup) boom(409, `合同编号 ${data.number} 已存在`);
    }
    if (data.opportunityId) {
      const opp = row(getRecord(u, 'opportunities', data.opportunityId));
      if (opp.accountId !== data.accountId) boom(400, '所选商机不属于该客户');
    }
  }
  if (type === 'leads' && data.status === '已转化' && !data.convertedAccountId) boom(400, '请使用“转客户”操作完成线索转化');
}

/** 非经理角色不得直接把合同置为审批后状态 */
/**
 * 合同状态流转规则（返回 'submit' 表示需要发起审批）：
 * 草稿 →审批中（提交）→ 按级别审批 → 已签订 → 执行中/已完成；作废需经理以上。
 * 跳过审批直接置为已签订等仅管理员可做（历史补录）。
 */
function guardContractStatus(u, before, after) {
  const signed = ['已签订', '执行中', '已完成'];
  const isAdmin = u.role === 'admin';
  if (after.status !== before.status) {
    if (after.status === '审批中') { if (before.status !== '草稿') boom(409, '仅草稿合同可以提交审批'); return 'submit'; }
    if (signed.includes(after.status) && !signed.includes(before.status) && !isAdmin) boom(403, '合同需通过审批流程签订（管理员可直接补录）');
    if (CONTRACT_APPROVED.includes(after.status) && !canManage(u)) boom(403, '合同需经理或管理员审批后才能变更为该状态');
    if (after.status === '草稿' && signed.includes(before.status) && !isAdmin) boom(403, '已签订合同不能退回草稿');
  }
  const changedMoney = after.amount !== before.amount || after.accountId !== before.accountId;
  if (before.status === '审批中' && after.status === '审批中' && changedMoney && !isAdmin) boom(409, '审批中的合同不能修改金额或客户，请先撤回');
  if (CONTRACT_APPROVED.includes(before.status) && before.status !== '已作废' && changedMoney && !canManage(u)) boom(403, '已审批合同的金额与客户仅经理或管理员可修改');
  return null;
}
function approvalLevelsFor(u, amount) {
  const levels = getSettings(u.tenant_id).approval.levels;
  const hit = levels.filter(l => cents(amount) >= cents(l.minAmount || 0));
  return (hit.length ? hit : levels.slice(0, 1)).map(l => ({ name: l.name, role: l.role }));
}
function startApproval(u, data) {
  data.status = '审批中';
  data.approvalLevels = approvalLevelsFor(u, data.amount);
  data.approvalStep = 0;
  data.submittedBy = u.id;
  data.approvalHistory = [...(data.approvalHistory || []), { action: 'submit', by: u.id, byName: u.display_name, at: now() }].slice(-50);
}
const currentLevel = c => (c.approvalLevels || [])[c.approvalStep || 0] || null;
/** 当前节点可审批：角色匹配且非提交人本人；管理员可审批任意节点 */
function canApprove(u, c) {
  if (c.status !== '审批中') return false;
  if (u.role === 'admin') return true;
  const lv = currentLevel(c);
  if (!lv) return u.role === 'manager';
  return u.role === lv.role && c.submittedBy !== u.id;
}

// ---------- 群机器人 Webhook ----------
function notifyWebhook(u, event, title, lines) {
  const w = getSettings(u.tenant_id).webhook;
  if (!w.url || !(w.events || []).includes(event)) return;
  const text = `### ${title}\n` + lines.map(l => `> ${l}`).join('\n');
  const body = w.kind === 'dingtalk' ? { msgtype: 'markdown', markdown: { title, text } }
    : w.kind === 'wecom' ? { msgtype: 'markdown', markdown: { content: text } }
      : { event, title, lines, at: now() };
  fetch(w.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    .catch(e => console.error('[webhook]', event, e.message));
}
function validWebhookUrl(url) {
  if (!url) return true;
  try {
    const x = new URL(url);
    return x.protocol === 'https:' || (x.protocol === 'http:' && process.env.WEBHOOK_ALLOW_HTTP === '1');
  } catch { return false; }
}

function nextContractNumber(u) {
  const year = new Date().getFullYear(), prefix = `HT${year}`;
  const used = new Set(all(u, 'contracts').map(x => x.number));
  let seq = all(u, 'contracts').filter(x => String(x.number || '').startsWith(prefix)).length + 1;
  while (used.has(prefix + String(seq).padStart(3, '0'))) seq++;
  return prefix + String(seq).padStart(3, '0');
}

function insertRecord(u, type, data, t = now()) {
  const key = newId();
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?)').run(key, u.tenant_id, type, serialize(type, data), t, t, u.id, u.id, 0);
  return { id: key, createdAt: t, updatedAt: t, createdBy: u.id, ...data };
}
function updateRecord(u, recordId, data) {
  const r = db.prepare('SELECT type FROM records WHERE id=? AND tenant_id=?').get(recordId, u.tenant_id);
  db.prepare('UPDATE records SET data=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(serialize(r.type, data), now(), u.id, recordId, u.tenant_id);
}

/** 删除前的关联检查；返回错误信息或 null */
function deleteBlocker(u, type, recordId) {
  if (type === 'accounts' && ['contacts', 'opportunities', 'tasks', 'activities', 'contracts'].some(k => childrenOf(u, k, 'accountId', recordId).length)) return '存在关联数据，不能删除客户';
  if (type === 'contracts' && childrenOf(u, 'payments', 'contractId', recordId).length) return '存在回款记录，不能删除合同';
  if (type === 'contracts' && childrenOf(u, 'plans', 'contractId', recordId).length) return '存在回款计划，不能删除合同';
  if (type === 'opportunities' && childrenOf(u, 'contracts', 'opportunityId', recordId).length) return '商机已关联合同，不能删除';
  return null;
}
function softDelete(u, type, recordId) {
  db.prepare('UPDATE records SET deleted=1,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(now(), u.id, recordId, u.tenant_id);
  audit(u, 'delete', type, recordId);
}

// ---------- 初始化 ----------
function initAdmin() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const tenant = newId(), admin = newId();
  const password = process.env.CRM_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  if (password.length < 12) throw new Error('CRM_ADMIN_PASSWORD至少12位');
  const email = (process.env.CRM_ADMIN_EMAIL || 'admin@local.crm').toLowerCase();
  db.prepare('INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)').run(tenant, '默认企业', now());
  db.prepare('INSERT INTO users(id,tenant_id,email,password_hash,role,display_name,active,created_at,department) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(admin, tenant, email, hashPwd(password), 'admin', '系统管理员', 1, now(), '管理部');
  console.log('\n========== 首次安装管理员账号 ==========\n邮箱:', email, '\n初始密码:', password, '\n请登录后妥善保管，不要公开此凭据。\n======================================\n');
}
/** 将 V1.0 旧枚举值迁移为新值 */
function migrateLegacyValues() {
  const stmt = db.prepare("UPDATE records SET data=json_set(data,'$.'||?,?) WHERE type=? AND json_extract(data,'$.'||?)=?");
  for (const [type, fields] of Object.entries(LEGACY)) {
    for (const [field, map] of Object.entries(fields)) for (const [from, to] of Object.entries(map)) stmt.run(field, to, type, field, from);
  }
  db.prepare("UPDATE records SET data=json_set(data,'$.method','银行转账') WHERE type='payments' AND json_extract(data,'$.method')='转账'").run();
}
/** 版本化数据迁移（PRAGMA user_version） */
function migrate() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 1) {
    transaction(() => {
      migrateLegacyValues();
      // 金额改为整数分存储
      db.prepare(`UPDATE records SET data=json_remove(json_set(data,'$.amountCents',CAST(ROUND(COALESCE(json_extract(data,'$.amount'),0)*100) AS INTEGER)),'$.amount')
        WHERE type IN ('opportunities','contracts','payments','plans') AND json_extract(data,'$.amountCents') IS NULL`).run();
      // 负责人姓名 → 成员 ID（仅姓名唯一时）
      for (const t of db.prepare('SELECT id FROM tenants').all()) {
        const users = db.prepare('SELECT id,display_name FROM users WHERE tenant_id=?').all(t.id);
        const byName = new Map();
        for (const x of users) byName.set(x.display_name, byName.has(x.display_name) ? null : x.id);
        const upd = db.prepare("UPDATE records SET data=json_set(data,'$.ownerId',?) WHERE tenant_id=? AND json_extract(data,'$.owner')=? AND COALESCE(json_extract(data,'$.ownerId'),'')=''");
        for (const [name, uid] of byName) if (uid) upd.run(uid, t.id, name);
      }
    });
    db.exec('PRAGMA user_version=1');
  }
}
initAdmin();
migrate();
purgeSessions();

// ---------- 统计 ----------
function monthRange(offset = 0, base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + offset + 1, 1);
  return [ymd(start), ymd(new Date(end - 1))];
}
const inRange = (day, [from, to]) => day && day >= from && day <= to;
const contractDay = c => localDay(c.signedAt || c.createdAt);
const paymentDay = p => localDay(p.paidAt || p.createdAt);
const isEffectiveContract = c => !['草稿', '已作废'].includes(c.status);

/** 按区间生成趋势桶：7d/30d 按日，quarter 按周，year 按月 */
function buildBuckets(range, today = new Date()) {
  const buckets = [];
  if (range === '7d' || range === '30d') {
    const n = range === '7d' ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), key = ymd(d);
      buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, from: key, to: key });
    }
  } else if (range === 'quarter') {
    const qStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
    for (let s = new Date(qStart); s <= qEnd; s.setDate(s.getDate() + 7)) {
      const e = new Date(Math.min(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6), qEnd));
      buckets.push({ label: `${s.getMonth() + 1}/${s.getDate()}`, from: ymd(s), to: ymd(e) });
    }
  } else {
    for (let m = 0; m < 12; m++) {
      const [from, to] = monthRange(m - today.getMonth(), today);
      buckets.push({ label: `${m + 1}月`, from, to });
    }
  }
  return buckets;
}

function dashboard(u, range) {
  const data = {};
  for (const k of Object.keys(TABLES)) data[k] = scoped(u, k);
  const sum = arr => yuan(sumCents(arr));
  const today = ymd(new Date());
  const thisMonth = monthRange(0), lastMonth = monthRange(-1);
  const created = x => localDay(x.createdAt);

  const accountsLastMonthEnd = data.accounts.filter(x => created(x) <= lastMonth[1]).length;
  const newThis = data.accounts.filter(x => inRange(created(x), thisMonth)).length;
  const newLast = data.accounts.filter(x => inRange(created(x), lastMonth)).length;
  const openOpps = data.opportunities.filter(x => OPEN_STAGES.includes(x.stage));
  const openPrev = openOpps.filter(x => created(x) <= lastMonth[1]).length;
  const payThis = sumCents(data.payments.filter(x => inRange(paymentDay(x), thisMonth)));
  const payLast = sumCents(data.payments.filter(x => inRange(paymentDay(x), lastMonth)));

  const effective = data.contracts.filter(isEffectiveContract);
  const trend = buildBuckets(range).map(b => ({ label: b.label, from: b.from, to: b.to, amount: sum(effective.filter(c => inRange(contractDay(c), [b.from, b.to]))) }));
  const accountName = id => data.accounts.find(a => a.id === id)?.name || '';
  const openTasks = data.tasks.filter(x => x.status !== '已完成');

  return {
    metrics: {
      leads: data.leads.filter(x => !x.convertedAccountId && x.status !== '已失效').length,
      accounts: data.accounts.length,
      opportunities: data.opportunities.length,
      opportunityAmount: sum(data.opportunities),
      contracts: data.contracts.length,
      contractAmount: sum(effective),
      payments: sum(data.payments),
      todo: openTasks.length,
    },
    kpis: [
      { key: 'accounts', label: '客户总数', value: data.accounts.length, change: pct(data.accounts.length, accountsLastMonthEnd) },
      { key: 'newAccounts', label: '本月新增', value: newThis, change: pct(newThis, newLast) },
      { key: 'openOpportunities', label: '进行中商机', value: openOpps.length, change: pct(openOpps.length, openPrev) },
      { key: 'monthPayments', label: '本月回款', value: yuan(payThis), money: true, change: pct(payThis, payLast) },
    ],
    trend,
    stages: STAGES.map(stage => ({ stage, count: data.opportunities.filter(x => x.stage === stage).length, amount: sum(data.opportunities.filter(x => x.stage === stage)) })),
    recentActivities: [...data.activities]
      .sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)))
      .slice(0, 6).map(x => ({ ...x, accountName: accountName(x.accountId) })),
    todos: [...openTasks]
      .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
      .slice(0, 6).map(x => ({ ...x, accountName: accountName(x.accountId), overdue: !!x.dueDate && x.dueDate < today, dueToday: x.dueDate === today })),
    alerts: openTasks.filter(x => x.dueDate && x.dueDate <= today).length,
    recent: db.prepare('SELECT action,entity,at FROM audits WHERE tenant_id=? ORDER BY at DESC LIMIT 8').all(u.tenant_id),
  };
}

function finance(u) {
  const contracts = scoped(u, 'contracts').filter(c => c.status !== '已作废');
  const payments = scoped(u, 'payments'), plans = scoped(u, 'plans'), accounts = all(u, 'accounts');
  const today = ymd(new Date());
  const accountName = id => accounts.find(a => a.id === id)?.name || '';
  let receivable = 0, received = 0;
  const rows = contracts.map(c => {
    const amount = cents(c.amount), got = sumCents(payments.filter(p => p.contractId === c.id));
    receivable += amount; received += got;
    return {
      id: c.id, number: c.number, name: c.name, accountId: c.accountId, accountName: accountName(c.accountId), contractStatus: c.status,
      amount: yuan(amount), received: yuan(got), outstanding: yuan(amount - got),
      status: amount > 0 && got >= amount ? '已收齐' : got > 0 ? '部分回款' : '待回款',
    };
  });
  const planRows = plans.map(p => {
    const c = contracts.find(x => x.id === p.contractId);
    return { ...p, contractNumber: c?.number || '', contractName: c?.name || '', accountName: accountName(c?.accountId), overdue: p.status !== '已回款' && p.dueDate < today };
  }).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return {
    totals: {
      receivable: yuan(receivable), received: yuan(received), outstanding: yuan(receivable - received),
      overdue: yuan(sumCents(planRows.filter(p => p.overdue))),
    },
    contracts: rows, plans: planRows,
  };
}

function reports(u, from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date();
  if (!day.test(from || '')) from = ymd(new Date(today.getFullYear(), today.getMonth() - 5, 1));
  if (!day.test(to || '')) to = ymd(today);
  if (from > to) boom(400, '开始日期不能晚于结束日期');
  const range = [from, to];
  const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const prevTo = ymd(new Date(new Date(from + 'T00:00:00') - 86400000));
  const prevFrom = ymd(new Date(new Date(from + 'T00:00:00') - spanDays * 86400000));
  const prev = [prevFrom, prevTo];
  const data = {};
  for (const k of ['accounts', 'leads', 'opportunities', 'contracts', 'payments']) data[k] = scoped(u, k);
  const created = x => localDay(x.createdAt);
  const contracts = data.contracts.filter(isEffectiveContract);

  // 按月序列
  const months = [];
  for (let d = new Date(from.slice(0, 7) + '-01T00:00:00'); ymd(d) <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const [mf, mt] = monthRange(0, d);
    const r = [mf < from ? from : mf, mt > to ? to : mt];
    months.push({
      label: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      contractAmount: yuan(sumCents(contracts.filter(c => inRange(contractDay(c), r)))),
      payments: yuan(sumCents(data.payments.filter(p => inRange(paymentDay(p), r)))),
      newAccounts: data.accounts.filter(a => inRange(created(a), r)).length,
    });
    if (months.length > 36) break;
  }
  const leadsIn = data.leads.filter(l => inRange(created(l), range));
  const leadsPrev = data.leads.filter(l => inRange(created(l), prev));
  const rate = arr => (arr.length ? Math.round((arr.filter(l => l.convertedAccountId).length / arr.length) * 1000) / 10 : 0);
  const newAccounts = data.accounts.filter(a => inRange(created(a), range)).length;
  const newAccountsPrev = data.accounts.filter(a => inRange(created(a), prev)).length;
  const amount = sumCents(contracts.filter(c => inRange(contractDay(c), range)));
  const amountPrev = sumCents(contracts.filter(c => inRange(contractDay(c), prev)));
  const paid = sumCents(data.payments.filter(p => inRange(paymentDay(p), range)));
  const paidPrev = sumCents(data.payments.filter(p => inRange(paymentDay(p), prev)));

  const group = (arr, key) => {
    const m = new Map();
    for (const x of arr) { const k = x[key] || '未填写'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const owners = new Map();
  for (const c of contracts.filter(c => inRange(contractDay(c), range))) {
    const k = c.owner || '未分配', v = owners.get(k) || { name: k, amount: 0, count: 0 };
    v.amount += cents(c.amount); v.count++; owners.set(k, v);
  }
  const closed = data.opportunities.filter(o => ['赢单', '输单'].includes(o.stage));
  return {
    from, to,
    summary: {
      newAccounts, newAccountsChange: pct(newAccounts, newAccountsPrev),
      contractAmount: yuan(amount), contractAmountChange: pct(amount, amountPrev),
      conversionRate: rate(leadsIn), conversionRateChange: Math.round((rate(leadsIn) - rate(leadsPrev)) * 10) / 10,
      payments: yuan(paid), paymentsChange: pct(paid, paidPrev),
      winRate: closed.length ? Math.round((closed.filter(o => o.stage === '赢单').length / closed.length) * 1000) / 10 : 0,
    },
    months,
    accountSources: group(data.accounts, 'source'),
    accountIndustries: group(data.accounts, 'industry'),
    stages: STAGES.map(stage => ({ stage, count: data.opportunities.filter(o => o.stage === stage).length, amount: yuan(sumCents(data.opportunities.filter(o => o.stage === stage))) })),
    owners: [...owners.values()].map(o => ({ ...o, amount: yuan(o.amount) })).sort((a, b) => b.amount - a.amount),
  };
}

// ---------- 列表查询（关键字 / 字段过滤 / 排序 / 分页） ----------
const FILTERABLE = ['status', 'stage', 'source', 'owner', 'ownerId', 'industry', 'level', 'type', 'priority', 'accountId', 'contractId', 'opportunityId', 'result', 'method'];
function listRecords(u, type, params) {
  let items = scoped(u, type);
  for (const f of FILTERABLE) {
    const v = params.get(f);
    if (v) items = items.filter(x => String(x[f] ?? '') === v);
  }
  if (type === 'tasks' && (params.get('overdue') === '1' || params.get('due') === '1')) {
    const today = ymd(new Date()), includeToday = params.get('due') === '1';
    items = items.filter(x => x.status !== '已完成' && x.dueDate && (includeToday ? x.dueDate <= today : x.dueDate < today));
  }
  const q = String(params.get('q') || '').trim().toLowerCase();
  if (q) {
    const names = new Map();
    for (const [field, refType] of [['accountId', 'accounts'], ['contractId', 'contracts'], ['opportunityId', 'opportunities']]) {
      if (TABLES[type].fields.includes(field)) for (const r of all(u, refType)) names.set(r.id, `${r.name || ''} ${r.number || ''}`);
    }
    items = items.filter(x => Object.entries(x).some(([k, v]) => k !== 'id' && String(names.get(v) ?? v ?? '').toLowerCase().includes(q)));
  }
  const sort = params.get('sort');
  if (sort && /^-?[a-zA-Z]+$/.test(sort)) {
    const key = sort.replace(/^-/, ''), dir = sort.startsWith('-') ? -1 : 1;
    items.sort((a, b) => (typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] - b[key] : String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'zh-CN')) * dir);
  }
  const total = items.length;
  if (!params.has('page')) return { items: params.get('raw') === '1' ? items : decorate(u, items), total };
  const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize')) || 10));
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { items: decorate(u, items.slice((page - 1) * pageSize, page * pageSize)), total, page, pageSize };
}

function exportRows(u, type, items) {
  const def = TABLES[type];
  const refs = {};
  for (const [field, refType] of [['accountId', 'accounts'], ['contractId', 'contracts'], ['opportunityId', 'opportunities'], ['convertedAccountId', 'accounts']]) {
    if (def.fields.includes(field)) { refs[field] = new Map(all(u, refType).map(r => [r.id, r.number ? `${r.number} ${r.name}` : r.name])); }
  }
  const custom = customFieldsOf(u, type);
  const cols = ['id', ...def.fields.filter(f => f !== 'ownerId'), ...custom.map(f => f.key), 'createdAt', 'updatedAt'];
  const label = c => LABELS[c] || custom.find(f => f.key === c)?.label || c;
  return {
    headers: cols.map(label),
    rows: items.map(x => cols.map(c => (refs[c] ? refs[c].get(x[c]) ?? x[c] : typeof x[c] === 'boolean' ? (x[c] ? '是' : '否') : x[c]))),
  };
}

function search(u, q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return { results: [] };
  const results = [];
  for (const [type, keys] of [['accounts', ['name', 'phone', 'email']], ['leads', ['name', 'company', 'phone']], ['opportunities', ['name']], ['contracts', ['name', 'number']], ['contacts', ['name', 'phone']]]) {
    for (const x of scoped(u, type)) {
      if (keys.some(k => String(x[k] || '').toLowerCase().includes(q))) results.push({ type, id: x.id, title: x.number ? `${x.number} ${x.name}` : x.name, sub: x.company || x.phone || x.stage || x.status || '', accountId: x.accountId });
      if (results.filter(r => r.type === type).length >= 5) break;
    }
  }
  return { results };
}

function accountOverview(u, accountId) {
  const account = row(getVisible(u, 'accounts', accountId));
  if (!account) boom(404, '客户不存在');
  // 客户可见即其下全部子记录可见（数据权限规则），直接走关联索引
  const of = type => childrenOf(u, type, 'accountId', accountId);
  const contracts = of('contracts');
  const payments = contracts.flatMap(c => childrenOf(u, 'payments', 'contractId', c.id));
  const activities = of('activities').sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)));
  return {
    account, contacts: of('contacts'), activities, opportunities: of('opportunities'), contracts, payments: decorate(u, payments), tasks: of('tasks'),
    stats: {
      activities: activities.length,
      opportunities: of('opportunities').filter(o => OPEN_STAGES.includes(o.stage)).length,
      contractAmount: yuan(sumCents(contracts.filter(isEffectiveContract))),
      received: yuan(sumCents(payments)),
      lastActivityAt: activities[0]?.occurredAt || activities[0]?.createdAt || null,
    },
  };
}

function notifyApprovalPending(u, c) {
  const lv = currentLevel(c);
  notifyWebhook(u, 'approval', `合同待审批：${lv?.name || '审批'}`, [`${c.number} ${c.name}`, `金额：¥${c.amount}`, `提交人：${u.display_name}`]);
}
function validateCustomFields(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) boom(400, '自定义字段格式错误');
  const out = { ...current };
  for (const [entity, list] of Object.entries(input)) {
    if (!CUSTOM_FIELD_ENTITIES.includes(entity)) boom(400, `不支持为 ${entity} 添加自定义字段`);
    if (!Array.isArray(list) || list.length > 30) boom(400, '每个对象最多 30 个自定义字段');
    const keys = new Set();
    out[entity] = list.map(f => {
      const label = String(f?.label || '').trim().slice(0, 30);
      if (!label) boom(400, '自定义字段名称不能为空');
      const type = CUSTOM_FIELD_TYPES.includes(f.type) ? f.type : 'text';
      const key = /^cf_[a-z0-9]{4,16}$/.test(f.key || '') ? f.key : 'cf_' + crypto.randomBytes(4).toString('hex');
      if (keys.has(key)) boom(400, '自定义字段键重复');
      keys.add(key);
      const options = type === 'select' ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(/[\n,，]/)).map(x => String(x).trim()).filter(Boolean))].slice(0, 50) : [];
      if (type === 'select' && !options.length) boom(400, `下拉字段“${label}”至少需要一个选项`);
      return { key, label, type, options, required: !!f.required, inList: !!f.inList };
    });
  }
  return out;
}
function validateApproval(input) {
  const levels = Array.isArray(input?.levels) ? input.levels : [];
  if (!levels.length || levels.length > 5) boom(400, '审批级别需 1-5 级');
  return {
    levels: levels.map(l => {
      const name = String(l?.name || '').trim().slice(0, 30);
      if (!name) boom(400, '审批级别名称不能为空');
      if (!['manager', 'admin'].includes(l.role)) boom(400, '审批人角色只能是销售经理或管理员');
      const minAmount = Number(l.minAmount || 0);
      if (!Number.isFinite(minAmount) || minAmount < 0) boom(400, '金额阈值无效');
      return { name, role: l.role, minAmount };
    }),
  };
}

// ---------- 站内通知 ----------
function notifications(u) {
  const items = [], today = ymd(new Date()), soon = ymd(new Date(Date.now() + 3 * 86400000));
  for (const t of scoped(u, 'tasks')) {
    if (t.ownerId === u.id && t.status !== '已完成' && t.dueDate && t.dueDate <= today) {
      items.push({ type: 'task', id: t.id, title: t.dueDate < today ? '任务已逾期' : '任务今日到期', text: t.title, link: '#/tasks?view=due', at: t.dueDate + 'T00:00:00' });
    }
  }
  const contracts = scoped(u, 'contracts'), byId = new Map(contracts.map(c => [c.id, c]));
  for (const c of contracts) {
    if (!canApprove(u, c)) continue;
    const last = (c.approvalHistory || []).at(-1);
    items.push({ type: 'approval', id: c.id, title: `待审批：${currentLevel(c)?.name || '合同审批'}`, text: `${c.number} ${c.name} · ¥${Number(c.amount).toLocaleString('zh-CN')}`, link: '#/contracts?q=' + encodeURIComponent(c.number || c.name), at: last?.at || c.updatedAt });
  }
  for (const p of scoped(u, 'plans')) {
    const c = byId.get(p.contractId);
    if (p.status === '已回款' || !p.dueDate || p.dueDate > soon || !c || (c.ownerId || c.createdBy) !== u.id) continue;
    items.push({ type: 'plan', id: p.id, title: p.dueDate < today ? '回款计划已逾期' : '回款计划即将到期', text: `${c.number} ${c.name} · ¥${Number(p.amount).toLocaleString('zh-CN')} · ${p.dueDate}`, link: '#/finance', at: p.dueDate + 'T00:00:00' });
  }
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const rows = db.prepare("SELECT a.*,x.display_name by_name FROM audits a LEFT JOIN users x ON x.id=a.user_id WHERE a.tenant_id=? AND a.at>? AND a.user_id<>? AND a.action IN ('assign','approve','reject') ORDER BY a.at DESC LIMIT 300").all(u.tenant_id, since, u.id);
  for (const a of rows) {
    const d = JSON.parse(a.details || '{}');
    if (a.action === 'assign' && d.ownerId === u.id) {
      const rec = row(getRecord(u, a.entity, a.entity_id));
      if (rec) items.push({ type: 'assign', id: a.id, title: `${a.by_name || '同事'} 将${TABLES[a.entity]?.label || ''}分配给你`, text: rec.name || rec.title || '', link: a.entity === 'accounts' ? `#/accounts/${rec.id}` : a.entity === 'opportunities' ? `#/opportunities/${rec.id}` : `#/${a.entity}?q=${encodeURIComponent(rec.name || rec.title || '')}`, at: a.at });
    } else if (a.entity === 'contracts' && (a.action === 'approve' || a.action === 'reject')) {
      const c = row(getRecord(u, 'contracts', a.entity_id));
      if (c && (c.submittedBy === u.id || c.ownerId === u.id)) items.push({ type: a.action, id: a.id, title: a.action === 'approve' ? (d.final ? '合同审批通过' : `合同已通过「${d.level || '审批'}」`) : '合同被驳回', text: `${c.number} ${c.name}${d.note ? ' · ' + d.note : ''}`, link: '#/contracts?q=' + encodeURIComponent(c.number || ''), at: a.at });
    }
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const seen = u.notif_seen_at || '';
  const actionable = items.filter(x => ['task', 'approval', 'plan'].includes(x.type)).length;
  return { items: items.slice(0, 50).map(x => ({ ...x, unread: x.at > seen })), unread: items.filter(x => x.at > seen).length, actionable };
}

// ---------- 附件 ----------
const ATTACH_ENTITIES = ['accounts', 'opportunities', 'contracts', 'leads'];
const ATTACH_EXT = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip' };
const ATTACH_MAX = Number(process.env.ATTACH_MAX_MB || 20) * 1024 * 1024;
const fileDir = tenantId => path.join(DATA_DIR, 'files', tenantId);
/** 流式写入请求体到文件并计算 sha256，超过 max 则中止 */
function receiveFile(req, dest, max) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(dest, { flags: 'wx' });
    const hash = crypto.createHash('sha256'); let size = 0, failed = false;
    const fail = e => { if (failed) return; failed = true; out.destroy(); fs.rm(dest, { force: true }, () => {}); reject(e); };
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > max) return fail(httpError(413, `文件不能超过 ${Math.round(max / 1048576)}MB`));
      hash.update(chunk);
      if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => { if (failed) return; out.end(() => (size ? resolve({ size, sha256: hash.digest('hex') }) : fail(httpError(400, '文件为空')))); });
    req.on('error', fail);
  });
}
function fileName(req) {
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { boom(400, '文件名编码错误'); }
  name = path.basename(name).replace(/[\x00-\x1f"\\/]/g, '').slice(0, 200).trim();
  if (!name) boom(400, '缺少文件名');
  return name;
}
const attachRow = a => ({ id: a.id, entity: a.entity, entityId: a.entity_id, name: a.name, mime: a.mime, size: a.size, createdBy: a.created_by, createdByName: a.by_name, createdAt: a.created_at });
async function attachmentsApi(u, req, res, url, attId, sub) {
  const m = req.method;
  if (!attId && m === 'GET') {
    const entity = url.searchParams.get('entity'), entityId = url.searchParams.get('entityId');
    if (!ATTACH_ENTITIES.includes(entity) || !getVisible(u, entity, entityId)) boom(404, '记录不存在');
    const items = db.prepare('SELECT a.*,x.display_name by_name FROM attachments a LEFT JOIN users x ON x.id=a.created_by WHERE a.tenant_id=? AND a.entity=? AND a.entity_id=? AND a.deleted=0 ORDER BY a.created_at DESC').all(u.tenant_id, entity, entityId);
    return send(res, 200, { items: items.map(attachRow) });
  }
  if (!attId && m === 'POST') {
    if (!canWrite(u)) boom(403, '无上传权限');
    const entity = url.searchParams.get('entity'), entityId = url.searchParams.get('entityId');
    if (!ATTACH_ENTITIES.includes(entity) || !getVisible(u, entity, entityId)) boom(404, '记录不存在');
    const name = fileName(req), ext = path.extname(name).slice(1).toLowerCase();
    if (!ATTACH_EXT[ext]) boom(415, `不支持的文件类型：${ext || '无扩展名'}（允许 ${Object.keys(ATTACH_EXT).join('/')}）`);
    const aid = newId(), dest = path.join(fileDir(u.tenant_id), aid);
    const { size, sha256 } = await receiveFile(req, dest, ATTACH_MAX);
    db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(aid, u.tenant_id, entity, entityId, name, ATTACH_EXT[ext], size, sha256, u.id, now());
    audit(u, 'upload', entity, entityId, { attachmentId: aid, name, size });
    return send(res, 201, { item: { id: aid, name, size, mime: ATTACH_EXT[ext] } });
  }
  const a = attId && db.prepare('SELECT * FROM attachments WHERE id=? AND tenant_id=? AND deleted=0').get(attId, u.tenant_id);
  if (!a || !getVisible(u, a.entity, a.entity_id)) boom(404, '附件不存在');
  if (m === 'GET' && sub === 'download') {
    const file = path.join(fileDir(u.tenant_id), a.id);
    if (!fs.existsSync(file)) boom(410, '附件文件已丢失');
    res.writeHead(200, {
      'Content-Type': a.mime.startsWith('image/') && a.mime !== 'image/svg+xml' ? a.mime : 'application/octet-stream', 'Content-Length': a.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
    });
    return fs.createReadStream(file).pipe(res);
  }
  if (m === 'DELETE' && !sub) {
    if (!canDelete(u) && a.created_by !== u.id) boom(403, '仅上传人、经理或管理员可删除附件');
    db.prepare('UPDATE attachments SET deleted=1 WHERE id=?').run(a.id);
    fs.rm(path.join(fileDir(u.tenant_id), a.id), { force: true }, () => {});
    audit(u, 'delete', 'attachments', a.id, { name: a.name, entity: a.entity, entityId: a.entity_id });
    return send(res, 200, { ok: true });
  }
  boom(405, '不支持的操作');
}

// ---------- 批量导入 ----------
const IMPORT_COLUMNS = {
  leads: { name: ['线索姓名', '姓名', '线索名称', 'name'], company: ['公司名称', '公司', 'company'], phone: ['手机号', '电话', '联系电话', 'phone'], email: ['邮箱', 'email'], source: ['线索来源', '来源', 'source'], status: ['状态', 'status'], owner: ['负责人', 'owner'], notes: ['备注', 'notes'] },
  accounts: { name: ['客户名称', '名称', 'name'], type: ['客户类型', '类型', 'type'], industry: ['所属行业', '行业', 'industry'], level: ['客户级别', '级别', 'level'], source: ['客户来源', '来源', 'source'], status: ['客户状态', '状态', 'status'], phone: ['联系电话', '电话', 'phone'], email: ['邮箱', 'email'], owner: ['负责人', 'owner'], address: ['地址', 'address'], foundedAt: ['成立时间', 'foundedAt'], notes: ['备注', 'notes'] },
  contacts: { name: ['姓名', '联系人', 'name'], account: ['所属客户', '客户名称', '客户', 'account'], title: ['职位', 'title'], phone: ['电话', '手机号', 'phone'], email: ['邮箱', 'email'], isPrimary: ['主联系人', 'isPrimary'], notes: ['备注', 'notes'] },
  opportunities: { name: ['商机名称', '名称', 'name'], account: ['客户名称', '客户', '所属客户', 'account'], amount: ['预计金额', '金额', 'amount'], probability: ['成交概率', '赢率', 'probability'], stage: ['商机阶段', '阶段', 'stage'], owner: ['负责人', 'owner'], expectedDate: ['预计成交日', '预计成交', 'expectedDate'], notes: ['备注', 'notes'] },
};
const IMPORT_EXAMPLE = {
  leads: { name: '张三', company: '示例科技有限公司', phone: '13800000000', source: '官网', status: '未联系' },
  accounts: { name: '示例科技有限公司', type: '企业客户', industry: '科技/IT', level: '重要', source: '官网', phone: '010-88886666', address: '北京市海淀区', foundedAt: '2018-06-12' },
  contacts: { name: '李四', account: '示例科技有限公司', title: '采购经理', phone: '13900000000', isPrimary: '是' },
  opportunities: { name: '年度采购项目', account: '示例科技有限公司', amount: '120000', probability: '40', stage: '需求确认', expectedDate: '2026-12-31' },
};
function importColumns(u, type) {
  const cols = Object.entries(IMPORT_COLUMNS[type]).map(([key, aliases]) => ({ key, aliases }));
  for (const f of customFieldsOf(u, type)) cols.push({ key: f.key, aliases: [f.label, f.key] });
  return cols;
}
function importTemplate(u, type) {
  const cols = importColumns(u, type);
  return { headers: cols.map(c => c.aliases[0]), rows: [cols.map(c => IMPORT_EXAMPLE[type][c.key] ?? '')] };
}
function importRecords(u, type, text, commit) {
  const rows = CSV.parse(text);
  if (rows.length < 2) boom(400, '文件中没有数据行（第一行须为表头）');
  if (rows.length > 5001) boom(400, '单次最多导入 5000 行');
  const cols = importColumns(u, type);
  const header = rows[0].map(h => String(h).trim().replace(/^[*＊]/, '').replace(/[（(].*?[)）]$/, '').trim());
  const mapping = header.map(h => cols.find(c => c.aliases.some(a => a.toLowerCase() === h.toLowerCase()))?.key || null);
  const unknown = header.filter((h, i) => h && !mapping[i]);
  if (!mapping.includes('name')) boom(400, `缺少必需列“${cols[0].aliases[0]}”。可识别的列：${cols.map(c => c.aliases[0]).join('、')}`);
  const accountsByName = new Map();
  if (['contacts', 'opportunities'].includes(type)) for (const a of scoped(u, 'accounts')) accountsByName.set(a.name, accountsByName.has(a.name) ? null : a.id);
  const existingNames = type === 'accounts' ? new Set(all(u, 'accounts').map(a => a.name)) : null;
  const errors = [], prepared = [], seen = new Set();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    try {
      const submitted = {};
      mapping.forEach((key, i) => { if (key) submitted[key] = String(r[i] ?? '').trim(); });
      for (const k of Object.keys(submitted)) if (submitted[k] === '' && k !== 'name') delete submitted[k];
      if (Object.hasOwn(submitted, 'account')) {
        const id = accountsByName.get(submitted.account);
        if (id === undefined) boom(400, `客户“${submitted.account}”不存在或无权访问`);
        if (id === null) boom(400, `存在多个名为“${submitted.account}”的客户，请手工录入`);
        submitted.accountId = id; delete submitted.account;
      }
      if (Object.hasOwn(submitted, 'isPrimary')) submitted.isPrimary = ['是', 'y', 'yes', 'true', '1'].includes(submitted.isPrimary.toLowerCase());
      if (Object.hasOwn(submitted, 'amount')) submitted.amount = submitted.amount.replace(/[,，¥￥\s]/g, '');
      if (Object.hasOwn(submitted, 'probability')) submitted.probability = submitted.probability.replace(/%$/, '');
      for (const k of ['foundedAt', 'expectedDate']) if (submitted[k]) submitted[k] = submitted[k].replace(/[/.]/g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
      const data = sanitize(type, submitted, {}, u);
      resolveOwner(u, type, data, submitted);
      validRefs(u, type, data);
      if (existingNames) {
        if (existingNames.has(data.name)) boom(409, `客户“${data.name}”已存在`);
        if (seen.has(data.name)) boom(409, `文件内客户“${data.name}”重复`);
        seen.add(data.name);
      }
      prepared.push(data);
    } catch (e) {
      if (!e.status) throw e;
      errors.push({ line, error: e.message });
    }
  });
  const result = { total: rows.length - 1, valid: prepared.length, errors: errors.slice(0, 200), errorCount: errors.length, ignoredColumns: unknown, imported: 0 };
  if (commit) {
    if (errors.length) boom(400, `存在 ${errors.length} 行错误，请修正后再导入`);
    transaction(() => { for (const d of prepared) insertRecord(u, type, d); audit(u, 'import', type, '*', { count: prepared.length }); });
    result.imported = prepared.length;
  }
  return result;
}

// ---------- 对账单 ----------
function statement(u, accountId, from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || '') || !day.test(to || '')) boom(400, '请选择对账期间');
  if (from > to) boom(400, '开始日期不能晚于结束日期');
  const contracts = scoped(u, 'contracts').filter(isEffectiveContract);
  const payments = scoped(u, 'payments');
  const cById = new Map(contracts.map(c => [c.id, c]));
  const accounts = scoped(u, 'accounts').filter(a => !accountId || a.id === accountId);
  if (accountId && !accounts.length) boom(404, '客户不存在');
  const summary = accounts.map(a => {
    const cs = contracts.filter(c => c.accountId === a.id), ids = new Set(cs.map(c => c.id));
    const ps = payments.filter(p => ids.has(p.contractId));
    const before = d => d < from, within = d => d >= from && d <= to;
    const opening = sumCents(cs.filter(c => before(contractDay(c)))) - sumCents(ps.filter(p => before(paymentDay(p))));
    const debit = sumCents(cs.filter(c => within(contractDay(c)))), credit = sumCents(ps.filter(p => within(paymentDay(p))));
    return { accountId: a.id, accountName: a.name, opening: yuan(opening), debit: yuan(debit), credit: yuan(credit), closing: yuan(opening + debit - credit) };
  }).filter(x => accountId || x.opening || x.debit || x.credit || x.closing);
  let lines = [];
  if (accountId) {
    const s = summary[0] || { opening: 0 };
    const cs = contracts.filter(c => c.accountId === accountId), ids = new Set(cs.map(c => c.id));
    lines = [
      ...cs.filter(c => contractDay(c) >= from && contractDay(c) <= to).map(c => ({ date: contractDay(c), kind: '合同应收', ref: `${c.number} ${c.name}`, debit: c.amount, credit: 0 })),
      ...payments.filter(p => ids.has(p.contractId) && paymentDay(p) >= from && paymentDay(p) <= to).map(p => ({ date: paymentDay(p), kind: '回款', ref: `${cById.get(p.contractId)?.number || ''} ${p.method || ''}`.trim(), debit: 0, credit: p.amount })),
    ].sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit);
    let bal = cents(s.opening);
    for (const l of lines) { bal += cents(l.debit) - cents(l.credit); l.balance = yuan(bal); }
  }
  const total = k => yuan(summary.reduce((x, r) => x + cents(r[k]), 0));
  return { from, to, accountId: accountId || null, summary, lines, totals: { opening: total('opening'), debit: total('debit'), credit: total('credit'), closing: total('closing') } };
}

// ---------- 用户管理 ----------
function listUsers(u) {
  return db.prepare('SELECT id,email,role,display_name name,department,active,created_at createdAt,last_login_at lastLoginAt,data_scope dataScope,totp_enabled mfaEnabled FROM users WHERE tenant_id=? ORDER BY created_at').all(u.tenant_id)
    .map(x => ({ ...x, dataScopeSet: x.dataScope || '', dataScope: DATA_SCOPES.includes(x.dataScope) ? x.dataScope : DEFAULT_SCOPE[x.role] }))
    .map(x => (canManage(u) ? x : { id: x.id, name: x.name, role: x.role, department: x.department, active: x.active }));
}
async function createUser(u, req) {
  if (u.role !== 'admin') boom(403, '仅管理员可添加用户');
  const b = await readBody(req);
  const role = String(b.role || 'sales'), email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (!ROLES.includes(role) || !/^\S+@\S+\.\S+$/.test(email)) boom(400, '用户信息无效：邮箱格式或角色不正确');
  checkPassword(password, email);
  const uid = newId();
  try {
    const dataScope = DATA_SCOPES.includes(b.dataScope) ? b.dataScope : '';
    db.prepare('INSERT INTO users(id,tenant_id,email,password_hash,role,display_name,active,created_at,department,data_scope) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(uid, u.tenant_id, email, hashPwd(password), role, String(b.name || email).slice(0, 100), 1, now(), String(b.department || '').slice(0, 50), dataScope);
  } catch { boom(409, '邮箱已存在'); }
  audit(u, 'create', 'users', uid, { email, role });
  return { id: uid };
}
async function updateUser(u, req, userId) {
  if (u.role !== 'admin') boom(403, '仅管理员可修改成员');
  const target = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(userId, u.tenant_id);
  if (!target) boom(404, '成员不存在');
  const b = await readBody(req);
  const next = {
    display_name: b.name !== undefined ? String(b.name).trim().slice(0, 100) || target.display_name : target.display_name,
    department: b.department !== undefined ? String(b.department).slice(0, 50) : target.department,
    role: b.role !== undefined ? String(b.role) : target.role,
    active: b.active !== undefined ? (b.active ? 1 : 0) : target.active,
    data_scope: b.dataScope !== undefined ? (DATA_SCOPES.includes(b.dataScope) ? b.dataScope : '') : target.data_scope,
  };
  if (!ROLES.includes(next.role)) boom(400, '角色无效');
  if (target.id === u.id && (next.role !== 'admin' || !next.active)) boom(400, '不能停用或降级自己的管理员账号');
  if (target.role === 'admin' && (next.role !== 'admin' || !next.active)) {
    const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role='admin' AND active=1").get(u.tenant_id).n;
    if (admins <= 1) boom(409, '至少需要保留一名启用的管理员');
  }
  const resetPassword = b.password !== undefined && b.password !== '';
  if (resetPassword) checkPassword(b.password, target.email);
  const resetMfa = b.resetMfa === true;
  transaction(() => {
    db.prepare('UPDATE users SET display_name=?,department=?,role=?,active=?,data_scope=? WHERE id=?').run(next.display_name, next.department, next.role, next.active, next.data_scope, target.id);
    // 负责人姓名为冗余字段，随成员改名同步
    if (next.display_name !== target.display_name) db.prepare("UPDATE records SET data=json_set(data,'$.owner',?) WHERE tenant_id=? AND json_extract(data,'$.ownerId')=?").run(next.display_name, u.tenant_id, target.id);
    if (resetPassword) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPwd(String(b.password)), target.id);
    if (resetMfa) db.prepare("UPDATE users SET totp_enabled=0,totp_secret='' WHERE id=?").run(target.id);
    if (resetPassword || resetMfa || !next.active || next.role !== target.role) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    audit(u, 'update', 'users', target.id, { before: { name: target.display_name, role: target.role, department: target.department, active: target.active, dataScope: target.data_scope }, resetPassword, resetMfa });
  });
  return { ok: true };
}

// ---------- 路由 ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/health') {
    // 数据库可读 + 可获取写锁（磁盘只读/满、文件损坏时返回 503，供容器健康检查与监控告警使用）
    let dbOk = true;
    try { db.prepare('SELECT 1').get(); db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); } catch { dbOk = false; }
    const last = backups.listBackups(DATA_DIR)[0];
    return send(res, dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'degraded', version: VERSION, storage: 'sqlite', db: dbOk ? 'ok' : 'error', uptimeSec: Math.round(process.uptime()), lastBackupAt: last?.createdAt || null });
  }

  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
    const ip = clientIp(req);
    const keys = [[`acct:${email}`, LOGIN_MAX_PER_ACCOUNT], [`ip:${ip}`, LOGIN_MAX_PER_IP]];
    if (loginBlocked(keys)) boom(429, '登录失败次数过多，请 15 分钟后再试');
    const found = db.prepare('SELECT * FROM users WHERE email=? AND active=1').all(email).find(x => verifyPwd(String(b.password || ''), x.password_hash));
    if (!found) { recordLoginFailure(keys); boom(401, '邮箱或密码错误'); }
    if (found.totp_enabled) {
      // 密码正确但未提供动态码：提示前端进入第二步，不计失败
      if (!b.otp) return send(res, 401, { error: '请输入身份验证器中的 6 位动态码', mfaRequired: true });
      const s2 = TOTP.verify(found.totp_secret, b.otp);
      if (s2 < 0 || s2 <= found.totp_last_step) { recordLoginFailure(keys); return send(res, 401, { error: '动态码错误或已使用', mfaRequired: true }); }
      db.prepare('UPDATE users SET totp_last_step=? WHERE id=?').run(s2, found.id);
    }
    clearLoginFailures(`acct:${email}`);
    createSession(found, res);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), found.id);
    audit(found, 'login', 'session', found.id);
    return send(res, 200, { user: publicUser(found), settings: publicSettings(found) });
  }

  const u = authenticate(req);
  if (!u) boom(401, '请先登录');
  req.uid = u.id;

  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: publicUser(u), settings: publicSettings(u) });
  if (p === '/api/logout' && m === 'POST') {
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(tokenHash(sessionToken(req)));
    res.setHeader('Set-Cookie', makeCookie('', 0));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && m === 'POST') {
    const b = await readBody(req);
    if (!verifyPwd(String(b.oldPassword || ''), u.password_hash)) boom(403, '原密码错误');
    checkPassword(b.newPassword, u.email);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPwd(String(b.newPassword)), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    res.setHeader('Set-Cookie', makeCookie('', 0));
    audit(u, 'change_password', 'users', u.id);
    return send(res, 200, { ok: true });
  }

  // ---- 两步验证（TOTP）----
  if (p === '/api/mfa/setup' && m === 'POST') {
    if (u.totp_enabled) boom(409, '已启用两步验证');
    const secret = TOTP.generateSecret();
    db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(secret, u.id);
    return send(res, 200, { secret, uri: TOTP.otpauthUri(secret, u.email, getSettings(u.tenant_id).systemName) });
  }
  if (p === '/api/mfa/enable' && m === 'POST') {
    const b = await readBody(req);
    if (u.totp_enabled) boom(409, '已启用两步验证');
    if (!u.totp_secret) boom(400, '请先生成密钥');
    const st = TOTP.verify(u.totp_secret, b.code);
    if (st < 0) boom(400, '动态码不正确，请确认手机时间准确');
    db.prepare('UPDATE users SET totp_enabled=1,totp_last_step=? WHERE id=?').run(st, u.id);
    audit(u, 'mfa_enable', 'users', u.id);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/mfa/disable' && m === 'POST') {
    const b = await readBody(req);
    if (!u.totp_enabled) boom(409, '未启用两步验证');
    if (!verifyPwd(String(b.password || ''), u.password_hash)) boom(403, '密码错误');
    if (TOTP.verify(u.totp_secret, b.code) < 0) boom(403, '动态码不正确');
    db.prepare("UPDATE users SET totp_enabled=0,totp_secret='' WHERE id=?").run(u.id);
    audit(u, 'mfa_disable', 'users', u.id);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/settings') {
    if (m === 'GET') return send(res, 200, { settings: publicSettings(u) });
    if (m === 'PUT' || m === 'PATCH') {
      if (u.role !== 'admin') boom(403, '仅管理员可修改系统设置');
      const b = await readBody(req), cur = getSettings(u.tenant_id);
      const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : fallback);
      const dicts = { ...cur.dicts };
      if (b.dicts && typeof b.dicts === 'object') {
        for (const k of Object.keys(DEFAULT_SETTINGS.dicts)) {
          if (!Array.isArray(b.dicts[k])) continue;
          const list = [...new Set(b.dicts[k].map(x => String(x).trim()).filter(Boolean).map(x => x.slice(0, 40)))].slice(0, 100);
          if (!list.length) boom(400, `字典 ${k} 至少保留一项`);
          dicts[k] = list;
        }
      }
      const next = { ...cur, systemName: text(b.systemName, cur.systemName), companyName: text(b.companyName, cur.companyName), dicts };
      if (b.customFields !== undefined) next.customFields = validateCustomFields(b.customFields, cur.customFields);
      if (b.approval !== undefined) next.approval = validateApproval(b.approval);
      if (b.webhook !== undefined) {
        const w = b.webhook || {};
        const url = String(w.url ?? cur.webhook.url).trim();
        if (!validWebhookUrl(url)) boom(400, 'Webhook 地址必须为 https:// 开头的有效 URL');
        next.webhook = { url, kind: ['wecom', 'dingtalk', 'generic'].includes(w.kind) ? w.kind : cur.webhook.kind, events: Array.isArray(w.events) ? w.events.filter(e => WEBHOOK_EVENTS.includes(e)) : cur.webhook.events };
      }
      db.prepare('UPDATE tenants SET settings=?,name=? WHERE id=?').run(JSON.stringify(next), next.companyName, u.tenant_id);
      audit(u, 'update', 'settings', u.tenant_id, { before: { ...cur, webhook: { ...cur.webhook, url: cur.webhook.url ? '***' : '' } } });
      return send(res, 200, { settings: publicSettings(u) });
    }
  }

  if (p === '/api/settings/webhook-test' && m === 'POST') {
    if (u.role !== 'admin') boom(403, '仅管理员可操作');
    const w = getSettings(u.tenant_id).webhook;
    if (!w.url) boom(400, '请先保存 Webhook 地址');
    notifyWebhook(u, (w.events || [])[0] || 'approval', `${getSettings(u.tenant_id).systemName} 测试消息`, ['Webhook 配置成功', `发送人：${u.display_name}`]);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/settings/logo') {
    if (m === 'GET') {
      const st = getSettings(u.tenant_id), file = path.join(fileDir(u.tenant_id), 'logo');
      if (!st.logo || !fs.existsSync(file)) boom(404, '未设置 Logo');
      res.writeHead(200, { 'Content-Type': st.logo, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      return fs.createReadStream(file).pipe(res);
    }
    if (u.role !== 'admin') boom(403, '仅管理员可修改 Logo');
    const st = getSettings(u.tenant_id);
    if (m === 'POST') {
      const mime = String(req.headers['content-type'] || '').split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) boom(415, 'Logo 仅支持 PNG / JPG / WebP');
      const file = path.join(fileDir(u.tenant_id), 'logo'), tmp = file + '.' + newId();
      await receiveFile(req, tmp, 512 * 1024);
      fs.renameSync(tmp, file);
      st.logo = mime;
    } else if (m === 'DELETE') { st.logo = ''; fs.rmSync(path.join(fileDir(u.tenant_id), 'logo'), { force: true }); }
    else boom(405, '不支持的操作');
    db.prepare('UPDATE tenants SET settings=? WHERE id=?').run(JSON.stringify(st), u.tenant_id);
    audit(u, 'update', 'settings', u.tenant_id, { logo: st.logo });
    return send(res, 200, { settings: publicSettings(u) });
  }
  if (p === '/api/notifications') {
    if (m === 'GET') return send(res, 200, notifications(u));
    if (m === 'POST') { db.prepare('UPDATE users SET notif_seen_at=? WHERE id=?').run(now(), u.id); return send(res, 200, { ok: true }); }
  }
  const attMatch = p.match(/^\/api\/attachments(?:\/([^/]+)(?:\/(download))?)?$/);
  if (attMatch) return attachmentsApi(u, req, res, url, attMatch[1], attMatch[2]);
  if (p === '/api/statements' && m === 'GET') {
    const r = statement(u, url.searchParams.get('accountId') || '', url.searchParams.get('from'), url.searchParams.get('to'));
    if (url.searchParams.get('format') === 'csv') {
      if (!canWrite(u)) boom(403, '没有导出权限');
      audit(u, 'export', 'statements', r.accountId || '*', { from: r.from, to: r.to });
      if (r.accountId) {
        const s0 = r.summary[0];
        return sendCSV(res, `对账单_${s0.accountName}_${r.from}_${r.to}.csv`, ['日期', '类型', '单据', '应收增加', '回款', '余额'],
          [[r.from, '期初余额', '', '', '', s0.opening], ...r.lines.map(l => [l.date, l.kind, l.ref, l.debit || '', l.credit || '', l.balance]), [r.to, '期末余额', '', s0.debit, s0.credit, s0.closing]]);
      }
      return sendCSV(res, `对账汇总_${r.from}_${r.to}.csv`, ['客户', '期初余额', '本期应收', '本期回款', '期末余额'], r.summary.map(x => [x.accountName, x.opening, x.debit, x.credit, x.closing]));
    }
    return send(res, 200, r);
  }
  const userMatch = p.match(/^\/api\/users(?:\/([^/]+))?$/);
  if (userMatch) {
    if (!userMatch[1] && m === 'GET') return send(res, 200, { items: listUsers(u) });
    if (!userMatch[1] && m === 'POST') return send(res, 201, await createUser(u, req));
    if (userMatch[1] && m === 'PATCH') return send(res, 200, await updateUser(u, req, userMatch[1]));
    boom(405, '不支持的操作');
  }
  if (p === '/api/audits' && m === 'GET') {
    if (!canManage(u)) boom(403, '无审计查看权限');
    const entity = url.searchParams.get('entity');
    const items = db.prepare(`SELECT a.*,u.display_name user_name FROM audits a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ${entity ? 'AND a.entity=?' : ''} ORDER BY a.at DESC LIMIT 300`)
      .all(...(entity ? [u.tenant_id, entity] : [u.tenant_id]));
    return send(res, 200, { items });
  }
  if (p === '/api/backups') {
    if (u.role !== 'admin') boom(403, '仅管理员可管理备份');
    if (m === 'GET') return send(res, 200, { items: backups.listBackups(DATA_DIR), schedule: { intervalHours: BACKUP_INTERVAL_HOURS, keep: BACKUP_KEEP } });
    if (m === 'POST') { const file = backups.backup(db, DATA_DIR, BACKUP_KEEP); audit(u, 'backup', 'system', path.basename(file)); return send(res, 201, { name: path.basename(file) }); }
  }
  if (p === '/api/dashboard' && m === 'GET') return send(res, 200, dashboard(u, url.searchParams.get('range') || 'year'));
  if (p === '/api/finance' && m === 'GET') return send(res, 200, finance(u));
  if (p === '/api/lookup' && m === 'GET') return send(res, 200, lookup(u, url.searchParams));
  if (p === '/api/search' && m === 'GET') return send(res, 200, search(u, url.searchParams.get('q')));
  if (p === '/api/reports' && m === 'GET') {
    const r = reports(u, url.searchParams.get('from'), url.searchParams.get('to'));
    if (url.searchParams.get('format') === 'csv') {
      if (!canWrite(u)) boom(403, '没有导出权限');
      audit(u, 'export', 'reports', '*', { from: r.from, to: r.to });
      return sendCSV(res, `report_${r.from}_${r.to}.csv`, ['月份', '成交金额', '回款金额', '新增客户'], r.months.map(x => [x.label, x.contractAmount, x.payments, x.newAccounts]));
    }
    return send(res, 200, r);
  }

  // ---- 通用实体路由 ----
  const match = p.match(/^\/api\/([a-z]+)(?:\/([^/]+)(?:\/([a-z]+))?)?$/);
  if (!match || !TABLES[match[1]]) boom(404, '接口不存在');
  const [, type, recordId, act] = match;

  if (!recordId && m === 'GET') {
    const result = listRecords(u, type, url.searchParams);
    if (url.searchParams.get('format') === 'csv') {
      if (!canWrite(u)) boom(403, '没有导出权限');
      const all = listRecords(u, type, new URLSearchParams([...url.searchParams].filter(([k]) => !['page', 'pageSize'].includes(k))));
      audit(u, 'export', type, '*', { count: all.items.length });
      const { headers, rows } = exportRows(u, type, all.items);
      return sendCSV(res, `${type}.csv`, headers, rows);
    }
    return send(res, 200, result);
  }
  if (!recordId && m === 'POST') {
    if (!canWrite(u)) boom(403, '无新增权限');
    const submitted = await readBody(req);
    if (type === 'leads' && Object.hasOwn(submitted, 'convertedAccountId')) boom(400, '不能自行设置转换关联');
    const data = sanitize(type, submitted, {}, u);
    resolveOwner(u, type, data, submitted);
    let submitNow = false;
    if (type === 'contracts') {
      submitNow = guardContractStatus(u, { status: '草稿' }, data) === 'submit';
      if (submitNow) data.status = '草稿';
      if (!data.number) data.number = nextContractNumber(u);
    }
    validRefs(u, type, data);
    if (submitNow) startApproval(u, data);
    const item = transaction(() => {
      const it = insertRecord(u, type, data); audit(u, 'create', type, it.id);
      if (submitNow) audit(u, 'submit', 'contracts', it.id);
      if (data.ownerId && data.ownerId !== u.id) audit(u, 'assign', type, it.id, { ownerId: data.ownerId, owner: data.owner });
      return it;
    });
    if (submitNow) notifyApprovalPending(u, item);
    return send(res, 201, { item });
  }

  // 批量导入：GET 下载模板，POST {csv, commit}
  if (recordId === 'import' && !act) {
    if (!IMPORT_COLUMNS[type]) boom(404, '该对象不支持导入');
    if (m === 'GET') { const t = importTemplate(u, type); return sendCSV(res, `${type}_import_template.csv`, t.headers, t.rows); }
    if (m === 'POST') {
      if (!canWrite(u)) boom(403, '无导入权限');
      const b = await readBody(req, 6 * 1024 * 1024);
      return send(res, 200, importRecords(u, type, String(b.csv || ''), b.commit === true));
    }
  }

  // 批量操作：POST /api/{type}/batch {ids, action:'delete'|'assign', owner}
  if (recordId === 'batch' && !act && m === 'POST') {
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 500) : [];
    if (!ids.length) boom(400, '请选择记录');
    const done = [], failed = [];
    if (b.action === 'delete') {
      if (!canDelete(u)) boom(403, '仅经理或管理员可删除');
      transaction(() => {
        for (const key of ids) {
          if (!getVisible(u, type, key)) { failed.push({ id: key, error: '记录不存在' }); continue; }
          const why = deleteBlocker(u, type, key);
          if (why) { failed.push({ id: key, error: why }); continue; }
          softDelete(u, type, key); done.push(key);
        }
      });
    } else if (b.action === 'assign') {
      if (!canWrite(u)) boom(403, '无编辑权限');
      if (!TABLES[type].fields.includes('ownerId')) boom(400, '该对象不支持分配负责人');
      const target = b.ownerId ? findUser(u, { id: String(b.ownerId) }) : b.owner ? findUser(u, { name: String(b.owner) }) : undefined;
      if (!target) boom(400, '请选择有效的负责人');
      assertCanAssign(u, target);
      const owner = target.display_name;
      transaction(() => {
        for (const key of ids) {
          const old = getVisible(u, type, key);
          if (!old) { failed.push({ id: key, error: '记录不存在' }); continue; }
          const before = row(old), data = { ...before, owner, ownerId: target.id };
          if (type === 'leads' && before.status === '未联系') data.status = '已分配';
          updateRecord(u, key, data);
          audit(u, 'assign', type, key, { before: { owner: before.owner, ownerId: before.ownerId }, owner, ownerId: target.id });
          done.push(key);
        }
      });
      if (done.length && target.id !== u.id) notifyWebhook(u, 'assign', `${TABLES[type].label}分配`, [`${done.length} 条${TABLES[type].label}已分配给 ${owner}`, `操作人：${u.display_name}`]);
    } else boom(400, '不支持的批量操作');
    return send(res, 200, { done, failed });
  }

  const old = getVisible(u, type, recordId);
  if (!old) boom(404, '记录不存在');

  if (act) {
    if (m === 'GET' && type === 'accounts' && act === 'overview') return send(res, 200, accountOverview(u, recordId));
    if (m !== 'POST') boom(404, '接口不存在');
    if (!canWrite(u)) boom(403, '无操作权限');

    if (type === 'leads' && act === 'convert') {
      const lead = row(old);
      if (lead.convertedAccountId) boom(409, '该线索已转化');
      const t = now();
      const account = sanitize('accounts', { name: lead.company || lead.name, phone: lead.phone || '', email: lead.email || '', owner: lead.owner || u.display_name, ownerId: lead.ownerId || u.id, source: lead.source || '' });
      const result = transaction(() => {
        const acc = insertRecord(u, 'accounts', account, t);
        let contactId = null;
        if (lead.company) contactId = insertRecord(u, 'contacts', sanitize('contacts', { name: lead.name, accountId: acc.id, phone: lead.phone || '', email: lead.email || '', isPrimary: true }), t).id;
        updateRecord(u, recordId, { ...lead, convertedAccountId: acc.id, status: '已转化' });
        audit(u, 'convert', 'leads', recordId, { accountId: acc.id, contactId });
        return { accountId: acc.id, contactId };
      });
      return send(res, 200, result);
    }

    if (type === 'opportunities' && act === 'contract') {
      const opp = row(old);
      if (childrenOf(u, 'contracts', 'opportunityId', recordId).some(c => c.status !== '已作废')) boom(409, '该商机已生成合同');
      if (opp.stage === '输单') boom(409, '输单商机不能转合同');
      const result = transaction(() => {
        const data = sanitize('contracts', { name: opp.name, accountId: opp.accountId, opportunityId: recordId, amount: opp.amount || 0, owner: opp.owner || u.display_name, ownerId: opp.ownerId || u.id });
        data.number = nextContractNumber(u);
        const c = insertRecord(u, 'contracts', data);
        updateRecord(u, recordId, { ...opp, stage: '赢单', probability: 100 });
        audit(u, 'create', 'contracts', c.id, { fromOpportunity: recordId });
        audit(u, 'update', 'opportunities', recordId, { before: opp });
        return c;
      });
      return send(res, 201, { item: result });
    }

    if (type === 'contracts' && act === 'submit') {
      const c = row(old);
      if (c.status !== '草稿') boom(409, '仅草稿合同可以提交审批');
      startApproval(u, c);
      transaction(() => { updateRecord(u, recordId, c); audit(u, 'submit', 'contracts', recordId); });
      notifyApprovalPending(u, c);
      return send(res, 200, { ok: true, levels: c.approvalLevels });
    }
    if (type === 'contracts' && act === 'approve') {
      const c = row(old), b = await readBody(req);
      if (c.status !== '审批中') boom(409, '合同不在审批中');
      if (!canApprove(u, c)) boom(403, c.submittedBy === u.id ? '不能审批自己提交的合同' : `当前节点「${currentLevel(c)?.name || '审批'}」无权审批`);
      const approved = b.approved === true, note = String(b.note || '').slice(0, 500);
      const level = currentLevel(c)?.name || '审批';
      const history = [...(c.approvalHistory || []), { action: approved ? 'approve' : 'reject', level, by: u.id, byName: u.display_name, note, at: now() }].slice(-50);
      let next, final = false;
      if (!approved) next = { ...c, status: '草稿', approvalStep: 0, approvalNote: note, approvalHistory: history };
      else {
        const step = (c.approvalStep || 0) + 1;
        final = step >= (c.approvalLevels || []).length;
        next = { ...c, approvalStep: step, approvalNote: note, approvalHistory: history, ...(final ? { status: '已签订', signedAt: c.signedAt || ymd(new Date()) } : {}) };
      }
      transaction(() => { updateRecord(u, recordId, next); audit(u, approved ? 'approve' : 'reject', 'contracts', recordId, { note, level, final }); });
      if (approved && !final) notifyApprovalPending(u, next);
      else notifyWebhook(u, 'approval', approved ? '合同审批通过' : '合同被驳回', [`${c.number} ${c.name}`, `金额：¥${c.amount}`, `审批人：${u.display_name}（${level}）`, ...(note ? [`意见：${note}`] : [])]);
      return send(res, 200, { ok: true, status: next.status, pending: approved && !final ? currentLevel(next) : null });
    }
    boom(404, '接口不存在');
  }

  if (m === 'GET') return send(res, 200, { item: decorate(u, [row(old)])[0] });
  if (m === 'PATCH') {
    if (!canWrite(u)) boom(403, '无编辑权限');
    if (type === 'payments') boom(403, '回款不可修改，请删除错误登记后重建');
    const submitted = await readBody(req);
    if (type === 'leads' && Object.hasOwn(submitted, 'convertedAccountId')) boom(400, '不能自行设置转换关联');
    const before = row(old);
    const existing = { ...before }; for (const k of ['id', 'createdAt', 'updatedAt', 'createdBy']) delete existing[k];
    const data = sanitize(type, submitted, existing, u);
    resolveOwner(u, type, data, submitted, before);
    const submitNow = type === 'contracts' && guardContractStatus(u, before, data) === 'submit';
    validRefs(u, type, data, recordId);
    if (submitNow) startApproval(u, data);
    if (type === 'contracts' && before.status === '审批中' && data.status === '草稿') data.approvalHistory = [...(data.approvalHistory || []), { action: 'withdraw', by: u.id, byName: u.display_name, at: now() }];
    transaction(() => {
      updateRecord(u, recordId, data); audit(u, 'update', type, recordId, { before });
      if (submitNow) audit(u, 'submit', 'contracts', recordId);
      if (data.ownerId && data.ownerId !== before.ownerId && data.ownerId !== u.id) audit(u, 'assign', type, recordId, { ownerId: data.ownerId, owner: data.owner });
    });
    if (submitNow) notifyApprovalPending(u, { id: recordId, ...data });
    if (data.ownerId && data.ownerId !== before.ownerId && data.ownerId !== u.id) notifyWebhook(u, 'assign', `${TABLES[type].label}分配`, [`${data.name || data.title || ''} 已分配给 ${data.owner}`, `操作人：${u.display_name}`]);
    resetScope(u);
    return send(res, 200, { item: row(getRecord(u, type, recordId)) });
  }
  if (m === 'DELETE') {
    if (!canDelete(u)) boom(403, '仅经理或管理员可删除');
    const why = deleteBlocker(u, type, recordId);
    if (why) boom(409, why);
    softDelete(u, type, recordId);
    return send(res, 200, { ok: true });
  }
  boom(405, '不支持的操作');
}

// ---------- 静态资源 ----------
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function staticFile(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const base = path.resolve(ROOT, 'public');
  const file = path.resolve(base, '.' + requested);
  if (!file.startsWith(base + path.sep)) boom(403, '禁止访问');
  let st;
  try { st = fs.statSync(file); } catch { boom(404, '页面不存在'); }
  if (!st.isFile()) boom(404, '页面不存在');
  res.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', ...SECURITY_HEADERS,
  });
  fs.createReadStream(file).pipe(res);
}

/** 允许的 Origin：PUBLIC_ORIGIN（可逗号分隔多个）以及与 Host 一致的同源地址 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 非浏览器或同源导航；SameSite=Lax Cookie 已阻止跨站携带
  const allowed = new Set(String(process.env.PUBLIC_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean));
  if (req.headers.host) { allowed.add(`http://${req.headers.host}`); allowed.add(`https://${req.headers.host}`); }
  return allowed.has(origin);
}

/** 结构化访问日志（ACCESS_LOG=1 开启，每行一条 JSON，便于 Loki/ELK/云日志采集） */
const ACCESS_LOG = process.env.ACCESS_LOG === '1';
function logJson(obj) { process.stdout.write(JSON.stringify({ t: now(), ...obj }) + '\n'); }
const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const rid = /^[\w-]{8,64}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', rid);
  if (ACCESS_LOG) {
    res.on('finish', () => {
      const path0 = req.url.split('?')[0];
      if (path0 === '/api/health') return;
      logJson({ type: 'access', rid, ip: clientIp(req), method: req.method, path: path0, status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6, uid: req.uid || null });
    });
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) boom(405, 'Method not allowed');
      if (req.method !== 'GET' && !originAllowed(req)) boom(403, '跨站请求被拒绝');
      await api(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      staticFile(req, res, url);
    } else boom(405, 'Method not allowed');
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '服务器内部错误' });
    else res.end();
    if (!e.status) logJson({ type: 'error', rid, method: req.method, path: req.url.split('?')[0], message: e.message, stack: e.stack });
  }
});

const housekeeping = setInterval(() => { purgeSessions(); pruneLoginFailures(); }, 3600 * 1000);
housekeeping.unref();

// ---------- 定时备份 ----------
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 14);
function scheduledBackup() {
  try { console.log('[backup] 已生成', backups.backup(db, DATA_DIR, BACKUP_KEEP)); } catch (e) { console.error('[backup] 失败', e); }
}
if (require.main === module && BACKUP_INTERVAL_HOURS > 0) {
  const latest = backups.listBackups(DATA_DIR)[0];
  const due = !latest || Date.now() - new Date(latest.createdAt) > BACKUP_INTERVAL_HOURS * 3600000;
  if (due) setTimeout(scheduledBackup, 60 * 1000).unref();
  setInterval(scheduledBackup, BACKUP_INTERVAL_HOURS * 3600000).unref();
}

if (require.main === module) {
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`NovaCRM V${VERSION} listening on http://localhost:${PORT}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
module.exports = { server, db, TABLES, STAGES };
