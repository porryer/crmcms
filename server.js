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

const VERSION = '1.1.0';
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
};

/**
 * 实体定义：fields 为允许写入的字段；enums 为服务端强校验的枚举；numbers 为数字字段及范围。
 * labels 用于 CSV 导出表头。
 */
const TABLES = {
  leads: {
    label: '线索', fields: ['name', 'company', 'phone', 'email', 'source', 'status', 'owner', 'notes', 'convertedAccountId'],
    required: ['name'], defaults: { status: '未联系', source: '其他' }, enums: { status: LEAD_STATUS },
  },
  accounts: {
    label: '客户', fields: ['name', 'type', 'industry', 'level', 'source', 'status', 'phone', 'email', 'owner', 'address', 'foundedAt', 'notes'],
    required: ['name'], defaults: { type: '企业客户', level: '普通', status: '合作中' },
  },
  contacts: {
    label: '联系人', fields: ['name', 'accountId', 'title', 'phone', 'email', 'isPrimary', 'notes'],
    required: ['name', 'accountId'], defaults: {},
  },
  opportunities: {
    label: '商机', fields: ['name', 'accountId', 'amount', 'probability', 'stage', 'owner', 'expectedDate', 'notes'],
    required: ['name', 'accountId'], defaults: { amount: 0, stage: '初步沟通', probability: 10 },
    enums: { stage: STAGES }, numbers: { probability: [0, 100] },
  },
  tasks: {
    label: '任务', fields: ['title', 'accountId', 'dueDate', 'priority', 'status', 'owner', 'notes'],
    required: ['title'], defaults: { priority: '中', status: '待处理' }, enums: { status: TASK_STATUS, priority: PRIORITY },
  },
  activities: {
    label: '跟进记录', fields: ['accountId', 'type', 'content', 'result', 'occurredAt', 'nextAt', 'owner'],
    required: ['accountId', 'content'], defaults: { type: '电话', result: '有效跟进' },
  },
  contracts: {
    label: '合同', fields: ['name', 'number', 'accountId', 'opportunityId', 'amount', 'status', 'signedAt', 'startDate', 'endDate', 'owner', 'notes', 'approvalNote'],
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

const row = r => (r ? { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, ...JSON.parse(r.data) } : null);
const hashPwd = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
function verifyPwd(pwd, hash) {
  const [salt, expected] = String(hash).split(':');
  if (!salt || !expected) return false;
  const a = Buffer.from(expected, 'hex'), b = crypto.scryptSync(pwd, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const getRecord = (u, type, key) => db.prepare('SELECT * FROM records WHERE id=? AND tenant_id=? AND type=? AND deleted=0').get(key, u.tenant_id, type);
const all = (u, type) => db.prepare('SELECT * FROM records WHERE tenant_id=? AND type=? AND deleted=0 ORDER BY created_at DESC').all(u.tenant_id, type).map(row);
function audit(u, action, entity, entityId, details = {}) {
  db.prepare('INSERT INTO audits VALUES(?,?,?,?,?,?,?,?)').run(newId(), u.tenant_id, u.id, action, entity, entityId, JSON.stringify(details), now());
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function boom(status, message) { throw httpError(status, message); }
const publicUser = u => ({ id: u.id, tenantId: u.tenant_id, name: u.display_name, email: u.email, role: u.role, department: u.department || '' });
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
  return { ...DEFAULT_SETTINGS, ...s, companyName: s.companyName || t?.name || DEFAULT_SETTINGS.companyName, dicts: { ...DEFAULT_SETTINGS.dicts, ...(s.dicts || {}) } };
}

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
const loginFailures = new Map();
function loginBlocked(keys) {
  const t = Date.now();
  return keys.some(([k, max]) => { const v = loginFailures.get(k); return v && t - v.first < LOGIN_WINDOW_MS && v.count >= max; });
}
function recordLoginFailure(keys) {
  const t = Date.now();
  for (const [k] of keys) {
    const v = loginFailures.get(k);
    if (!v || t - v.first >= LOGIN_WINDOW_MS) loginFailures.set(k, { first: t, count: 1 }); else v.count++;
  }
}
function pruneLoginFailures() {
  const t = Date.now();
  for (const [k, v] of loginFailures) if (t - v.first >= LOGIN_WINDOW_MS) loginFailures.delete(k);
}

// ---------- HTTP 工具 ----------
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []; let len = 0, failed = false;
    req.on('data', chunk => {
      if (failed) return;
      len += chunk.length;
      if (len > 1024 * 1024) { failed = true; reject(httpError(413, '请求体过大')); return; }
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
function csv(headers, rows) {
  const esc = v => {
    let s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '﻿' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
}
function sendCSV(res, filename, headers, rows) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'no-store' });
  res.end(csv(headers, rows));
}

// ---------- 校验 ----------
function sanitize(type, obj, existing = {}) {
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
  return data;
}

function collectedCents(u, contractId) {
  return sumCents(all(u, 'payments').filter(x => x.contractId === contractId));
}

function validRefs(u, type, data, recordId = null) {
  for (const [field, refType] of [['accountId', 'accounts'], ['opportunityId', 'opportunities'], ['contractId', 'contracts']]) {
    if (data[field] && !getRecord(u, refType, data[field])) boom(400, `${LABELS[field] || field}关联数据不存在`);
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
      const dup = all(u, 'contracts').find(x => x.number === data.number && x.id !== recordId);
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
function guardContractStatus(u, before, after) {
  if (canManage(u)) return;
  if (after.status !== before.status && CONTRACT_APPROVED.includes(after.status)) boom(403, '合同需经理或管理员审批后才能变更为该状态');
  if (CONTRACT_APPROVED.includes(before.status) && before.status !== '已作废' && (after.amount !== before.amount || after.accountId !== before.accountId)) {
    boom(403, '已审批合同的金额与客户仅经理或管理员可修改');
  }
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
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?)').run(key, u.tenant_id, type, JSON.stringify(data), t, t, u.id, u.id, 0);
  return { id: key, createdAt: t, updatedAt: t, ...data };
}
function updateRecord(u, recordId, data) {
  const clean = { ...data }; delete clean.id; delete clean.createdAt; delete clean.updatedAt;
  db.prepare('UPDATE records SET data=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(JSON.stringify(clean), now(), u.id, recordId, u.tenant_id);
}

/** 删除前的关联检查；返回错误信息或 null */
function deleteBlocker(u, type, recordId) {
  if (type === 'accounts' && ['contacts', 'opportunities', 'tasks', 'activities', 'contracts'].some(k => all(u, k).some(x => x.accountId === recordId))) return '存在关联数据，不能删除客户';
  if (type === 'contracts' && all(u, 'payments').some(x => x.contractId === recordId)) return '存在回款记录，不能删除合同';
  if (type === 'contracts' && all(u, 'plans').some(x => x.contractId === recordId)) return '存在回款计划，不能删除合同';
  if (type === 'opportunities' && all(u, 'contracts').some(x => x.opportunityId === recordId)) return '商机已关联合同，不能删除';
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
initAdmin();
migrateLegacyValues();
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
  for (const k of Object.keys(TABLES)) data[k] = all(u, k);
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
  const contracts = all(u, 'contracts').filter(c => c.status !== '已作废');
  const payments = all(u, 'payments'), plans = all(u, 'plans'), accounts = all(u, 'accounts');
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
  for (const k of ['accounts', 'leads', 'opportunities', 'contracts', 'payments']) data[k] = all(u, k);
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
const FILTERABLE = ['status', 'stage', 'source', 'owner', 'industry', 'level', 'type', 'priority', 'accountId', 'contractId', 'opportunityId', 'result', 'method'];
function listRecords(u, type, params) {
  let items = all(u, type);
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
  if (!params.has('page')) return { items, total };
  const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize')) || 10));
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}

function exportRows(u, type, items) {
  const def = TABLES[type];
  const refs = {};
  for (const [field, refType] of [['accountId', 'accounts'], ['contractId', 'contracts'], ['opportunityId', 'opportunities'], ['convertedAccountId', 'accounts']]) {
    if (def.fields.includes(field)) { refs[field] = new Map(all(u, refType).map(r => [r.id, r.number ? `${r.number} ${r.name}` : r.name])); }
  }
  const cols = ['id', ...def.fields, 'createdAt', 'updatedAt'];
  return {
    headers: cols.map(c => LABELS[c] || c),
    rows: items.map(x => cols.map(c => (refs[c] ? refs[c].get(x[c]) ?? x[c] : typeof x[c] === 'boolean' ? (x[c] ? '是' : '否') : x[c]))),
  };
}

function search(u, q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return { results: [] };
  const results = [];
  for (const [type, keys] of [['accounts', ['name', 'phone', 'email']], ['leads', ['name', 'company', 'phone']], ['opportunities', ['name']], ['contracts', ['name', 'number']], ['contacts', ['name', 'phone']]]) {
    for (const x of all(u, type)) {
      if (keys.some(k => String(x[k] || '').toLowerCase().includes(q))) results.push({ type, id: x.id, title: x.number ? `${x.number} ${x.name}` : x.name, sub: x.company || x.phone || x.stage || x.status || '', accountId: x.accountId });
      if (results.filter(r => r.type === type).length >= 5) break;
    }
  }
  return { results };
}

function accountOverview(u, accountId) {
  const account = row(getRecord(u, 'accounts', accountId));
  if (!account) boom(404, '客户不存在');
  const of = type => all(u, type).filter(x => x.accountId === accountId);
  const contracts = of('contracts');
  const contractIds = new Set(contracts.map(c => c.id));
  const payments = all(u, 'payments').filter(p => contractIds.has(p.contractId));
  const activities = of('activities').sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)));
  return {
    account, contacts: of('contacts'), activities, opportunities: of('opportunities'), contracts, payments, tasks: of('tasks'),
    stats: {
      activities: activities.length,
      opportunities: of('opportunities').filter(o => OPEN_STAGES.includes(o.stage)).length,
      contractAmount: yuan(sumCents(contracts.filter(isEffectiveContract))),
      received: yuan(sumCents(payments)),
      lastActivityAt: activities[0]?.occurredAt || activities[0]?.createdAt || null,
    },
  };
}

// ---------- 用户管理 ----------
function listUsers(u) {
  return db.prepare('SELECT id,email,role,display_name name,department,active,created_at createdAt,last_login_at lastLoginAt FROM users WHERE tenant_id=? ORDER BY created_at').all(u.tenant_id)
    .map(x => (canManage(u) ? x : { id: x.id, name: x.name, role: x.role, department: x.department, active: x.active }));
}
async function createUser(u, req) {
  if (u.role !== 'admin') boom(403, '仅管理员可添加用户');
  const b = await readBody(req);
  const role = String(b.role || 'sales'), email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (!ROLES.includes(role) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) boom(400, '用户信息无效：邮箱格式、角色或密码长度不符合要求');
  const uid = newId();
  try {
    db.prepare('INSERT INTO users(id,tenant_id,email,password_hash,role,display_name,active,created_at,department) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(uid, u.tenant_id, email, hashPwd(password), role, String(b.name || email).slice(0, 100), 1, now(), String(b.department || '').slice(0, 50));
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
  };
  if (!ROLES.includes(next.role)) boom(400, '角色无效');
  if (target.id === u.id && (next.role !== 'admin' || !next.active)) boom(400, '不能停用或降级自己的管理员账号');
  if (target.role === 'admin' && (next.role !== 'admin' || !next.active)) {
    const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role='admin' AND active=1").get(u.tenant_id).n;
    if (admins <= 1) boom(409, '至少需要保留一名启用的管理员');
  }
  const resetPassword = b.password !== undefined && b.password !== '';
  if (resetPassword && String(b.password).length < 12) boom(400, '新密码不少于12位');
  transaction(() => {
    db.prepare('UPDATE users SET display_name=?,department=?,role=?,active=? WHERE id=?').run(next.display_name, next.department, next.role, next.active, target.id);
    if (resetPassword) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPwd(String(b.password)), target.id);
    if (resetPassword || !next.active || next.role !== target.role) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    audit(u, 'update', 'users', target.id, { before: { name: target.display_name, role: target.role, department: target.department, active: target.active }, resetPassword });
  });
  return { ok: true };
}

// ---------- 路由 ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/health') return send(res, 200, { status: 'ok', version: VERSION, storage: 'sqlite' });

  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
    const ip = req.socket.remoteAddress || '';
    const keys = [[`acct:${email}`, LOGIN_MAX_PER_ACCOUNT], [`ip:${ip}`, LOGIN_MAX_PER_IP]];
    if (loginBlocked(keys)) boom(429, '登录失败次数过多，请 15 分钟后再试');
    const found = db.prepare('SELECT * FROM users WHERE email=? AND active=1').all(email).find(x => verifyPwd(String(b.password || ''), x.password_hash));
    if (!found) { recordLoginFailure(keys); boom(401, '邮箱或密码错误'); }
    loginFailures.delete(`acct:${email}`);
    createSession(found, res);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), found.id);
    audit(found, 'login', 'session', found.id);
    return send(res, 200, { user: publicUser(found), settings: getSettings(found.tenant_id) });
  }

  const u = authenticate(req);
  if (!u) boom(401, '请先登录');

  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: publicUser(u), settings: getSettings(u.tenant_id) });
  if (p === '/api/logout' && m === 'POST') {
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(tokenHash(sessionToken(req)));
    res.setHeader('Set-Cookie', makeCookie('', 0));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && m === 'POST') {
    const b = await readBody(req);
    if (!verifyPwd(String(b.oldPassword || ''), u.password_hash)) boom(403, '原密码错误');
    if (String(b.newPassword || '').length < 12) boom(400, '新密码不少于12位');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPwd(String(b.newPassword)), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    res.setHeader('Set-Cookie', makeCookie('', 0));
    audit(u, 'change_password', 'users', u.id);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/settings') {
    if (m === 'GET') return send(res, 200, { settings: getSettings(u.tenant_id) });
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
      const next = { systemName: text(b.systemName, cur.systemName), companyName: text(b.companyName, cur.companyName), dicts };
      db.prepare('UPDATE tenants SET settings=?,name=? WHERE id=?').run(JSON.stringify(next), next.companyName, u.tenant_id);
      audit(u, 'update', 'settings', u.tenant_id, { before: cur });
      return send(res, 200, { settings: getSettings(u.tenant_id) });
    }
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
  if (p === '/api/dashboard' && m === 'GET') return send(res, 200, dashboard(u, url.searchParams.get('range') || 'year'));
  if (p === '/api/finance' && m === 'GET') return send(res, 200, finance(u));
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
    const data = sanitize(type, submitted);
    if (type === 'contracts') { guardContractStatus(u, { status: '草稿' }, data); if (!data.number) data.number = nextContractNumber(u); }
    validRefs(u, type, data);
    const item = transaction(() => { const it = insertRecord(u, type, data); audit(u, 'create', type, it.id); return it; });
    return send(res, 201, { item });
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
          if (!getRecord(u, type, key)) { failed.push({ id: key, error: '记录不存在' }); continue; }
          const why = deleteBlocker(u, type, key);
          if (why) { failed.push({ id: key, error: why }); continue; }
          softDelete(u, type, key); done.push(key);
        }
      });
    } else if (b.action === 'assign') {
      if (!canWrite(u)) boom(403, '无编辑权限');
      if (!TABLES[type].fields.includes('owner')) boom(400, '该对象不支持分配负责人');
      const owner = String(b.owner || '').trim().slice(0, 100);
      if (!owner) boom(400, '请选择负责人');
      transaction(() => {
        for (const key of ids) {
          const old = getRecord(u, type, key);
          if (!old) { failed.push({ id: key, error: '记录不存在' }); continue; }
          const before = row(old), data = { ...before, owner };
          if (type === 'leads' && before.status === '未联系') data.status = '已分配';
          updateRecord(u, key, data);
          audit(u, 'assign', type, key, { before: { owner: before.owner }, owner });
          done.push(key);
        }
      });
    } else boom(400, '不支持的批量操作');
    return send(res, 200, { done, failed });
  }

  const old = getRecord(u, type, recordId);
  if (!old) boom(404, '记录不存在');

  if (act) {
    if (m === 'GET' && type === 'accounts' && act === 'overview') return send(res, 200, accountOverview(u, recordId));
    if (m !== 'POST') boom(404, '接口不存在');
    if (!canWrite(u)) boom(403, '无操作权限');

    if (type === 'leads' && act === 'convert') {
      const lead = row(old);
      if (lead.convertedAccountId) boom(409, '该线索已转化');
      const t = now();
      const account = sanitize('accounts', { name: lead.company || lead.name, phone: lead.phone || '', email: lead.email || '', owner: lead.owner || '', source: lead.source || '' });
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
      if (all(u, 'contracts').some(c => c.opportunityId === recordId && c.status !== '已作废')) boom(409, '该商机已生成合同');
      if (opp.stage === '输单') boom(409, '输单商机不能转合同');
      const result = transaction(() => {
        const data = sanitize('contracts', { name: opp.name, accountId: opp.accountId, opportunityId: recordId, amount: opp.amount || 0, owner: opp.owner || '' });
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
      updateRecord(u, recordId, { ...c, status: '审批中' });
      audit(u, 'submit', 'contracts', recordId);
      return send(res, 200, { ok: true });
    }
    if (type === 'contracts' && act === 'approve') {
      if (!canManage(u)) boom(403, '仅经理或管理员可审批合同');
      const c = row(old), b = await readBody(req);
      if (c.status !== '审批中') boom(409, '合同不在审批中');
      const approved = b.approved === true;
      const note = String(b.note || '').slice(0, 500);
      updateRecord(u, recordId, { ...c, status: approved ? '已签订' : '草稿', signedAt: approved ? (c.signedAt || ymd(new Date())) : c.signedAt, approvalNote: note });
      audit(u, approved ? 'approve' : 'reject', 'contracts', recordId, { note });
      return send(res, 200, { ok: true, status: approved ? '已签订' : '草稿' });
    }
    boom(404, '接口不存在');
  }

  if (m === 'GET') return send(res, 200, { item: row(old) });
  if (m === 'PATCH') {
    if (!canWrite(u)) boom(403, '无编辑权限');
    if (type === 'payments') boom(403, '回款不可修改，请删除错误登记后重建');
    const submitted = await readBody(req);
    if (type === 'leads' && Object.hasOwn(submitted, 'convertedAccountId')) boom(400, '不能自行设置转换关联');
    const before = row(old);
    const data = sanitize(type, submitted, JSON.parse(old.data));
    if (type === 'contracts') guardContractStatus(u, before, data);
    validRefs(u, type, data, recordId);
    transaction(() => { updateRecord(u, recordId, data); audit(u, 'update', type, recordId, { before }); });
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
    'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
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

const server = http.createServer(async (req, res) => {
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
    if (!e.status) console.error(e);
  }
});

const housekeeping = setInterval(() => { purgeSessions(); pruneLoginFailures(); }, 3600 * 1000);
housekeeping.unref();

if (require.main === module) {
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`NovaCRM V${VERSION} listening on http://localhost:${PORT}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
module.exports = { server, db, TABLES, STAGES };
