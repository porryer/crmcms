'use strict';
/* NovaCRM V1.1 前端：原生 JS 单页应用（hash 路由），兼容严格 CSP（无内联脚本/样式）。 */

// ======================= 常量 =======================
const STAGES = ['初步沟通', '需求确认', '方案报价', '商务谈判', '赢单', '输单'];
const LEAD_STATUS = ['未联系', '跟进中', '已分配', '已转化', '已失效'];
const TASK_STATUS = ['待处理', '进行中', '已完成'];
const CONTRACT_STATUS = ['草稿', '审批中', '已签订', '执行中', '已完成', '已作废'];
const PLAN_STATUS = ['待回款', '已回款'];
const PRIORITY = ['低', '中', '高'];
const ROLE_LABEL = { admin: '管理员', manager: '销售经理', sales: '销售', viewer: '只读' };
const SCOPE_LABEL = { self: '仅本人', dept: '本部门', all: '全部数据' };
const ENTITY_LABEL = { leads: '线索', accounts: '客户', contacts: '联系人', opportunities: '商机', tasks: '任务', activities: '跟进记录', contracts: '合同', payments: '回款', plans: '回款计划', users: '成员', settings: '系统设置', session: '登录', reports: '报表' };
const ACTION_LABEL = { create: '新增', update: '修改', delete: '删除', convert: '线索转化', export: '导出', login: '登录', change_password: '修改密码', assign: '分配', submit: '提交审批', approve: '审批通过', reject: '审批驳回' };

const TAG_COLORS = {
  green: ['已转化', '合作中', '赢单', '已签订', '执行中', '已完成', '已收齐', '已回款', '有效跟进', '推进中', '正常', 'VIP'],
  blue: ['跟进中', '进行中', '已分配', '需求确认', '初步沟通', '持续跟进', '安排演示', '重要', '企业客户'],
  orange: ['审批中', '待反馈', '部分回款', '待处理', '方案报价', '商务谈判', '中', '潜在', '待回款'],
  red: ['已失效', '输单', '已作废', '逾期', '流失', '高', '停用', '无效'],
};
const tagClass = v => Object.keys(TAG_COLORS).find(k => TAG_COLORS[k].includes(v)) || 'gray';

// ======================= 图标（stroke SVG） =======================
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l7-7M16 5h3v3"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7"/><path d="M16 4.2a4 4 0 010 7.6M22 21c0-3-1.6-5.4-4-6.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18"/>',
  file: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  coins: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  calcheck: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M9 15.5l2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  org: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pluscircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/>',
  message: '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  visit: '<path d="M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  meeting: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
  clip: '<path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-6a2 2 0 012-2h14a2 2 0 012 2v6a1 1 0 01-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const ACTIVITY_ICON = { 电话: 'phone', 微信: 'message', 拜访: 'visit', 邮件: 'mail', 会议: 'meeting', 演示: 'calendar' };

// ======================= 菜单 =======================
const MENU = [
  { key: 'dashboard', label: '工作台', icon: 'home' },
  { key: 'leads', label: '线索管理', icon: 'target' },
  { label: '客户管理', icon: 'users', children: [['accounts', '客户列表'], ['contacts', '联系人']] },
  { key: 'opportunities', label: '商机管理', icon: 'briefcase' },
  { key: 'contracts', label: '合同订单', icon: 'file' },
  { key: 'finance', label: '财务回款', icon: 'coins' },
  { label: '跟进任务', icon: 'calcheck', children: [['tasks', '任务列表'], ['activities', '跟进记录']] },
  { key: 'reports', label: '数据报表', icon: 'chart' },
  { key: 'team', label: '团队管理', icon: 'org' },
  { key: 'settings', label: '系统设置', icon: 'gear', roles: ['admin', 'manager'] },
];
const IMPORTABLE = ['leads', 'accounts', 'contacts', 'opportunities'];
const PAGE_TITLE = { dashboard: '工作台', leads: '线索管理', accounts: '客户管理', contacts: '联系人', opportunities: '商机管理', contracts: '合同订单', finance: '财务回款', tasks: '跟进任务', activities: '跟进记录', reports: '数据报表', team: '团队管理', settings: '系统设置' };

// ======================= 表单字段定义 =======================
// [字段, 标签, 类型, 必填, 宽字段]
const FORMS = {
  leads: [['name', '线索姓名', 'text', 1], ['company', '公司名称'], ['phone', '手机号', 'tel'], ['email', '邮箱', 'email'], ['source', '线索来源', 'dict:leadSources'], ['status', '状态', LEAD_STATUS.filter(s => s !== '已转化')], ['ownerId', '负责人', 'user'], ['notes', '备注', 'textarea']],
  accounts: [['name', '客户名称', 'text', 1], ['type', '客户类型', 'dict:accountTypes'], ['industry', '所属行业', 'dict:industries'], ['level', '客户级别', 'dict:accountLevels'], ['source', '客户来源', 'dict:leadSources'], ['status', '客户状态', 'dict:accountStatus'], ['phone', '联系电话', 'tel'], ['email', '邮箱', 'email'], ['ownerId', '负责人', 'user'], ['foundedAt', '成立时间', 'date'], ['address', '地址', 'text', 0, 1], ['notes', '备注', 'textarea']],
  contacts: [['name', '姓名', 'text', 1], ['accountId', '所属客户', 'account', 1], ['title', '职位'], ['phone', '电话', 'tel'], ['email', '邮箱', 'email'], ['isPrimary', '设为主联系人', 'checkbox'], ['notes', '备注', 'textarea']],
  opportunities: [['name', '商机名称', 'text', 1], ['accountId', '关联客户', 'account', 1], ['amount', '预计金额（元）', 'money'], ['probability', '成交概率（%）', 'percent'], ['stage', '商机阶段', STAGES], ['ownerId', '负责人', 'user'], ['expectedDate', '预计成交日', 'date'], ['notes', '备注', 'textarea']],
  tasks: [['title', '任务名称', 'text', 1], ['accountId', '关联客户', 'account'], ['dueDate', '截止日期', 'date'], ['priority', '优先级', PRIORITY], ['status', '状态', TASK_STATUS], ['ownerId', '负责人', 'user'], ['notes', '备注', 'textarea']],
  activities: [['accountId', '客户', 'account', 1], ['type', '跟进方式', 'dict:activityTypes'], ['occurredAt', '跟进时间', 'datetime'], ['result', '跟进结果', 'dict:activityResults'], ['content', '跟进内容', 'textarea', 1], ['nextAt', '下次跟进日期', 'date'], ['ownerId', '跟进人', 'user']],
  contracts: [['name', '合同名称', 'text', 1], ['number', '合同编号（留空自动生成）'], ['accountId', '客户', 'account', 1], ['opportunityId', '关联商机', 'opportunity'], ['amount', '合同金额（元）', 'money'], ['status', '合同状态', 'contractStatus'], ['signedAt', '签订日期', 'date'], ['ownerId', '负责人', 'user'], ['startDate', '开始日期', 'date'], ['endDate', '结束日期', 'date'], ['notes', '备注', 'textarea']],
  payments: [['contractId', '关联合同', 'contract', 1], ['amount', '回款金额（元）', 'money', 1], ['paidAt', '到账日期', 'date'], ['method', '付款方式', 'dict:paymentMethods'], ['notes', '备注', 'textarea']],
  plans: [['contractId', '关联合同', 'contract', 1], ['amount', '计划金额（元）', 'money', 1], ['dueDate', '计划回款日', 'date', 1], ['status', '状态', PLAN_STATUS], ['notes', '备注', 'textarea']],
};

// 列定义：[字段, 标题, 渲染器]
const LISTS = {
  leads: { title: '线索管理', sub: '线索录入、分配、跟进与转客户', create: '新增线索',
    cols: [['name', '线索名称', 'strong'], ['company', '公司'], ['source', '来源'], ['phone', '手机号'], ['status', '状态', 'tag'], ['owner', '负责人'], ['createdAt', '创建时间', 'date']],
    filters: [['source', '来源', 'dict:leadSources'], ['status', '状态', LEAD_STATUS], ['ownerId', '负责人', 'user']], batch: true },
  accounts: { title: '客户管理', sub: '客户列表、搜索、筛选与批量操作', create: '新增客户',
    cols: [['name', '客户名称', 'accountLink'], ['type', '客户类型'], ['industry', '行业'], ['level', '客户级别', 'tag'], ['owner', '负责人'], ['phone', '联系电话'], ['status', '状态', 'tag']],
    filters: [['type', '客户类型', 'dict:accountTypes'], ['industry', '行业', 'dict:industries'], ['level', '客户级别', 'dict:accountLevels'], ['ownerId', '负责人', 'user']], batch: true },
  contacts: { title: '联系人', sub: '客户联系人档案', create: '新增联系人',
    cols: [['name', '姓名', 'strong'], ['accountId', '所属客户', 'account'], ['title', '职位'], ['phone', '电话'], ['email', '邮箱'], ['isPrimary', '主联系人', 'bool']],
    filters: [], batch: true },
  opportunities: { title: '商机管理', sub: '商机阶段、预计金额与成交预测', create: '新增商机',
    cols: [['name', '商机名称', 'oppLink'], ['accountId', '客户', 'account'], ['amount', '预计金额', 'money'], ['stage', '阶段', 'tag'], ['probability', '赢率', 'pct'], ['owner', '负责人'], ['expectedDate', '预计成交', 'date']],
    filters: [['stage', '阶段', STAGES], ['ownerId', '负责人', 'user']], batch: true },
  contracts: { title: '合同订单', sub: '合同列表、审批与回款进度', create: '新增合同',
    cols: [['number', '合同编号', 'strong'], ['name', '合同名称'], ['accountId', '客户', 'account'], ['amount', '金额(元)', 'money'], ['signedAt', '签订日期', 'date'], ['status', '状态', 'tag'], ['owner', '负责人']],
    filters: [['status', '合同状态', CONTRACT_STATUS], ['ownerId', '负责人', 'user']], batch: false },
  payments: { title: '回款记录', create: '登记回款',
    cols: [['paidAt', '到账日期', 'date'], ['contractId', '合同', 'contract'], ['customer', '客户', 'contractAccount'], ['amount', '金额(元)', 'money'], ['method', '付款方式'], ['notes', '备注']],
    filters: [['method', '付款方式', 'dict:paymentMethods']], batch: false, noEdit: true },
  plans: { title: '回款计划', create: '新增计划',
    cols: [['dueDate', '计划日期', 'date'], ['contractId', '合同', 'contract'], ['customer', '客户', 'contractAccount'], ['amount', '计划金额', 'money'], ['status', '状态', 'planStatus'], ['notes', '备注']],
    filters: [['status', '状态', PLAN_STATUS]], batch: false },
  tasks: { title: '跟进任务', sub: '任务列表、提醒与完成状态', create: '新建任务',
    cols: [['done', '', 'taskCheck'], ['title', '任务', 'strong'], ['accountId', '客户', 'account'], ['owner', '负责人'], ['dueDate', '截止时间', 'date'], ['priority', '优先级', 'tag'], ['status', '状态', 'taskStatus']],
    filters: [['ownerId', '负责人', 'user'], ['priority', '优先级', PRIORITY]], batch: true },
  activities: { title: '跟进记录', sub: '客户沟通与拜访记录', create: '写跟进',
    cols: [['occurredAt', '时间', 'datetime'], ['accountId', '客户', 'account'], ['type', '方式', 'activityType'], ['content', '跟进内容', 'clip'], ['result', '结果', 'tag'], ['owner', '负责人'], ['nextAt', '下次跟进', 'date']],
    filters: [['type', '方式', 'dict:activityTypes'], ['result', '结果', 'dict:activityResults'], ['ownerId', '负责人', 'user']], batch: false },
};

// ======================= 状态 =======================
let me = null, settings = null;
const R = { users: [] };
const ui = { collapsed: false, openGroups: new Set(), dashRange: 'year', oppView: 'board', list: null, tabs: {} };
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// ======================= 工具 =======================
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = x => '¥' + Number(x || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const moneyShort = x => { x = Number(x || 0); return Math.abs(x) >= 1e8 ? +(x / 1e8).toFixed(2) + '亿' : Math.abs(x) >= 1e4 ? +(x / 1e4).toFixed(1) + '万' : String(+x.toFixed(2)); };
const pad = n => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowLocal = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toDate = v => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v));
const fmtDate = v => { const d = toDate(v); return d && !isNaN(d) ? ymd(d) : '—'; };
const fmtDateTime = v => { const d = toDate(v); return d && !isNaN(d) ? `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—'; };
function relTime(v) {
  const d = toDate(v); if (!d || isNaN(d)) return '—';
  const today = ymd(), yest = ymd(new Date(Date.now() - 86400000)), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ymd(d) === today) return `今天 ${hm}`;
  if (ymd(d) === yest) return `昨天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
const tag = v => (v ? `<span class="tag ${tagClass(v)}">${esc(v)}</span>` : '—');
const canEdit = () => me && me.role !== 'viewer';
const canManage = () => me && ['admin', 'manager'].includes(me.role);
const isAdmin = () => me && me.role === 'admin';
const dict = k => settings?.dicts?.[k] || [];
const isOverdue = t => t.status !== '已完成' && t.dueDate && t.dueDate < ymd();
/** 内置字段 + 自定义字段 */
function formFields(type) {
  const custom = (settings.customFields?.[type] || []).map(f => [f.key, f.label, f.type === 'select' ? f.options : f.type, f.required ? 1 : 0, f.type === 'textarea' ? 1 : 0]);
  return [...FORMS[type], ...custom];
}
const customCols = type => (settings.customFields?.[type] || []).filter(f => f.inList).map(f => [f.key, f.label, f.type === 'date' ? 'date' : '']);
const customKv = (type, x) => (settings.customFields?.[type] || []).map(f => `<div class="kv ${f.type === 'textarea' ? 'wide' : ''}"><span>${esc(f.label)}</span><b>${esc(x[f.key] ?? '') || '—'}</b></div>`).join('');
const curLevel = c => (c.approvalLevels || [])[c.approvalStep || 0] || null;
const canApproveC = c => !!me && c.status === '审批中' && (me.role === 'admin' || (curLevel(c) ? me.role === curLevel(c).role && c.submittedBy !== me.id : me.role === 'manager'));
const fileSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const avatar = (name, cls = '') => `<span class="avatar ${cls}">${esc(String(name || '?').slice(0, 1))}</span>`;
const greeting = () => { const h = new Date().getHours(); return h < 6 ? '凌晨好' : h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };
const weekday = () => '日一二三四五六'[new Date().getDay()];
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function request(url, opt = {}) {
  const r = await fetch('/api' + url, { credentials: 'same-origin', ...opt, headers: { ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...opt.headers } });
  if (r.status === 401 && me && url !== '/login') { me = null; toast('登录已过期，请重新登录', true); renderLogin(); throw new Error('登录已过期'); }
  if (!r.ok) { const data = await r.json().catch(() => ({ error: '网络错误' })); const err = new Error(data.error || r.statusText); err.data = data; err.status = r.status; throw err; }
  return r.json();
}
const API = {
  get: u => request(u),
  post: (u, b) => request(u, { method: 'POST', body: JSON.stringify(b || {}) }),
  patch: (u, b) => request(u, { method: 'PATCH', body: JSON.stringify(b || {}) }),
  put: (u, b) => request(u, { method: 'PUT', body: JSON.stringify(b || {}) }),
  del: u => request(u, { method: 'DELETE' }),
};

function toast(msg, error = false) {
  $('.toast')?.remove();
  const div = document.createElement('div');
  div.className = 'toast' + (error ? ' error' : '');
  div.setAttribute('role', 'status');
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3600);
}

async function loadRefs() {
  // 仅加载成员列表；客户/合同/商机名称由服务端随列表返回，下拉框远程搜索，避免数据量大时全量加载
  R.users = (await API.get('/users')).items;
}

// ======================= 路由 =======================
function parseRoute() {
  const [pathPart, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page = 'dashboard', id = ''] = pathPart.split('/');
  return { page: PAGE_TITLE[page] ? page : 'dashboard', id: decodeURIComponent(id), params: new URLSearchParams(query) };
}
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
window.addEventListener('hashchange', () => route());

async function route() {
  if (!me) return renderLogin();
  const r = parseRoute();
  if (r.page === 'settings' && !canManage()) return go('#/dashboard');
  renderShell(r);
  const content = $('#content');
  content.innerHTML = '<div class="loading">加载中…</div>';
  document.body.classList.remove('nav-open');
  try {
    await loadRefs();
    if (r.page === 'dashboard') await pageDashboard();
    else if (r.page === 'accounts' && r.id) await pageAccount(r.id);
    else if (r.page === 'opportunities' && r.id) await pageOpportunity(r.id);
    else if (r.page === 'opportunities') await pageOpportunities(r);
    else if (r.page === 'finance') await pageFinance();
    else if (r.page === 'tasks') await pageTasks(r);
    else if (r.page === 'reports') await pageReports();
    else if (r.page === 'team') await pageTeam();
    else if (r.page === 'settings') await pageSettings();
    else await pageList(r.page, r);
  } catch (e) {
    if (me) content.innerHTML = `<div class="empty">${icon('alert')}<p>${esc(e.message)}</p></div>`;
  }
  refreshBell();
}
const rerender = () => route();

// ======================= 登录 =======================
function renderLogin() {
  let saved = '';
  try { saved = localStorage.getItem('novacrm.email') || ''; } catch { /* 隐私模式 */ }
  document.title = 'NovaCRM · 登录';
  $('#app').innerHTML = `
  <div class="login">
    <section class="login-hero">
      <div class="brand big"><span class="logo">N</span><span>NovaCRM</span></div>
      <h1>让客户管理更简单<br>更高效的销售管理平台</h1>
      <p>线索 → 客户 → 商机 → 合同 → 回款，全流程闭环管理</p>
      <div class="hero-art" aria-hidden="true">
        <div class="art-card a1"><b>客户总数</b><strong>1,286</strong></div>
        <div class="art-card a2"><b>本月回款</b><strong>¥286,500</strong></div>
        <div class="art-bars"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
    </section>
    <section class="login-panel">
      <form class="login-form" id="loginForm">
        <h2>欢迎登录</h2>
        <p class="muted">请使用管理员分配的企业账号登录</p>
        <label class="input-icon">${icon('user')}<input name="email" type="email" placeholder="请输入登录邮箱" value="${esc(saved)}" required autocomplete="username"></label>
        <label class="input-icon">${icon('key')}<input name="password" type="password" placeholder="请输入密码" required autocomplete="current-password"></label>
        <div class="login-row"><label class="check"><input type="checkbox" name="remember" ${saved ? 'checked' : ''}> 记住账号</label><span class="muted small" title="请联系系统管理员在“团队管理”中重置密码">忘记密码？</span></div>
        <button class="btn block" type="submit">登 录</button>
        <p class="muted small center">首次安装的管理员密码显示在服务启动日志中</p>
      </form>
    </section>
  </div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const btn = e.currentTarget.querySelector('button'); btn.disabled = true;
    try {
      const r = await API.post('/login', { email: f.email, password: f.password, ...(f.otp ? { otp: f.otp } : {}) });
      try { if (f.remember) localStorage.setItem('novacrm.email', f.email); else localStorage.removeItem('novacrm.email'); } catch { /* ignore */ }
      me = r.user; settings = r.settings;
      if (!location.hash || location.hash === '#/') location.hash = '#/dashboard'; else route();
    } catch (err) {
      btn.disabled = false;
      if (err.data?.mfaRequired) {
        const form = $('#loginForm');
        if (!form.querySelector('[name=otp]')) {
          form.querySelector('.login-row').insertAdjacentHTML('beforebegin', `<label class="input-icon">${icon('shield')}<input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="身份验证器中的 6 位动态码" required></label>`);
          if (!f.otp) { toast('该账号已启用两步验证，请输入动态码'); form.querySelector('[name=otp]').focus(); return; }
        }
      }
      toast(err.message, true);
    }
  });
}

// ======================= 布局 =======================
function renderShell(r) {
  const active = r.page;
  document.title = `${PAGE_TITLE[active]} · ${settings.systemName}`;
  const items = MENU.filter(m => !m.roles || m.roles.includes(me.role)).map(m => {
    if (!m.children) return `<a class="nav ${active === m.key ? 'active' : ''}" href="#/${m.key}" title="${m.label}">${icon(m.icon)}<span class="navtext">${m.label}</span></a>`;
    const childActive = m.children.some(([k]) => k === active);
    const open = childActive || ui.openGroups.has(m.label);
    return `<div class="nav-group ${open ? 'open' : ''}"><button class="nav ${childActive ? 'parent-active' : ''}" data-act="toggle-group" data-group="${m.label}" title="${m.label}">${icon(m.icon)}<span class="navtext">${m.label}</span>${icon('down', 'chev')}</button>
      <div class="sub">${m.children.map(([k, l]) => `<a class="subnav ${active === k ? 'active' : ''}" href="#/${k}">${l}</a>`).join('')}</div></div>`;
  }).join('');
  const shell = $('#shell');
  const html = `
    <aside class="aside" id="aside">
      <a class="brand" href="#/dashboard">${settings.logo ? `<img class="logo img" src="/api/settings/logo?v=${encodeURIComponent(settings.logoV || '')}" alt="">` : '<span class="logo">N</span>'}<span class="navtext">${esc(settings.systemName)}</span><small class="navtext">V1.1</small></a>
      <nav>${items}</nav>
      <div class="side-bottom navtext">${esc(settings.companyName)}<br><span>企业版 · 数据本地存储</span></div>
    </aside>
    <div class="scrim" data-act="close-nav"></div>
    <section class="workspace">
      <header class="topbar">
        <button class="iconbtn" data-act="toggle-nav" aria-label="切换菜单">${icon('menu')}</button>
        <h1 class="page-title">${PAGE_TITLE[active]}</h1>
        <div class="gsearch">${icon('search')}<input id="gsearch" placeholder="搜索客户、线索、商机、合同…" autocomplete="off"><div class="gresults" id="gresults" hidden></div></div>
        <div class="notif"><button class="iconbtn bell" data-act="notif" title="消息通知" aria-label="消息通知">${icon('bell')}<span class="badge" id="bellBadge" hidden></span></button><div class="dropdown notif-panel" id="notifPanel" hidden></div></div>
        <div class="usermenu">
          <button class="userbtn" data-act="user-menu">${avatar(me.name, 'blue')}<span class="uname">${esc(me.name)}</span>${icon('down', 'chev')}</button>
          <div class="dropdown" id="userDropdown" hidden>
            <div class="dd-head"><b>${esc(me.name)}</b><small>${esc(me.email)} · ${ROLE_LABEL[me.role]}</small></div>
            <button data-act="password">${icon('key')}修改密码</button>
            <button data-act="mfa">${icon('shield')}两步验证${me.mfaEnabled ? '（已启用）' : ''}</button>
            <button data-act="logout">${icon('logout')}退出登录</button>
          </div>
        </div>
      </header>
      <main class="content" id="content"></main>
    </section>
    <nav class="tabbar">
      ${[['dashboard', 'home', '首页'], ['accounts', 'users', '客户'], ['opportunities', 'briefcase', '商机'], ['tasks', 'calcheck', '任务']].map(([k, ic, l]) => `<a href="#/${k}" class="${active === k ? 'active' : ''}">${icon(ic)}<span>${l}</span></a>`).join('')}
      <button data-act="toggle-nav">${icon('more')}<span>更多</span></button>
    </nav>`;
  if (!shell) {
    $('#app').innerHTML = `<div class="app ${ui.collapsed ? 'collapsed' : ''}" id="shell">${html}</div>`;
    bindGlobalSearch();
  } else {
    // 保留顶部搜索框状态，仅刷新侧栏/标题/底部导航
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    shell.querySelector('#aside').replaceWith(tmp.querySelector('#aside'));
    shell.querySelector('.page-title').textContent = PAGE_TITLE[active];
    shell.querySelector('.tabbar').replaceWith(tmp.querySelector('.tabbar'));
  }
}

async function refreshBell() {
  if (!me) return null;
  try {
    const r = await API.get('/notifications');
    const b = $('#bellBadge'); if (!b) return r;
    b.hidden = !r.unread; b.textContent = r.unread > 99 ? '99+' : r.unread;
    return r;
  } catch { return null; }
}
const NOTIF_ICON = { task: 'calcheck', approval: 'file', plan: 'coins', assign: 'user', approve: 'check', reject: 'x' };
async function openNotifications() {
  const panel = $('#notifPanel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const r = await refreshBell();
  if (!r) return;
  panel.innerHTML = `<div class="dd-head row"><b>消息通知</b><small>${r.actionable} 项待处理</small></div>
    ${r.items.length ? `<div class="notif-list">${r.items.map(n => `<a href="${esc(n.link)}" class="notif-item ${n.unread ? 'unread' : ''}"><span class="n-ic ${n.type}">${icon(NOTIF_ICON[n.type] || 'bell')}</span><span><b>${esc(n.title)}</b><small>${esc(n.text)}</small><em>${relTime(n.at)}</em></span></a>`).join('')}</div>` : '<div class="empty small">暂无消息</div>'}`;
  panel.hidden = false;
  if (r.unread) { await API.post('/notifications').catch(() => {}); $('#bellBadge').hidden = true; }
}

function bindGlobalSearch() {
  const input = $('#gsearch'), box = $('#gresults');
  const TYPE = { accounts: '客户', leads: '线索', opportunities: '商机', contracts: '合同', contacts: '联系人' };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { box.hidden = true; return; }
    try {
      const { results } = await API.get('/search?q=' + encodeURIComponent(q));
      box.innerHTML = results.length ? results.map(x => {
        const href = x.type === 'accounts' ? `#/accounts/${x.id}` : x.type === 'opportunities' ? `#/opportunities/${x.id}` : x.type === 'contacts' ? `#/accounts/${x.accountId}` : `#/${x.type}?q=${encodeURIComponent(x.title.split(' ').pop())}`;
        return `<a href="${esc(href)}"><span class="tag gray">${TYPE[x.type]}</span><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></a>`;
      }).join('') : '<div class="muted pad">没有匹配结果</div>';
      box.hidden = false;
    } catch (e) { toast(e.message, true); }
  });
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim()) box.hidden = false; });
  document.addEventListener('click', e => {
    if (!e.target.closest('.gsearch')) box.hidden = true;
    if (!e.target.closest('.usermenu')) { const d = $('#userDropdown'); if (d) d.hidden = true; }
    if (!e.target.closest('.notif') || e.target.closest('.notif-item')) { const d = $('#notifPanel'); if (d) d.hidden = true; }
  });
  box.addEventListener('click', e => { if (e.target.closest('a')) { box.hidden = true; input.value = ''; } });
}

// ======================= 通用片段 =======================
function pageHead(title, sub, buttons = '') {
  return `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="tools">${buttons}</div></div>`;
}
const changeBadge = (v, suffix = '%') => {
  const n = Number(v || 0), up = n >= 0;
  return `<span class="chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${n}${suffix}</span>`;
};
function optionList(kind, current = '', withEmpty = '') {
  let opts = [];
  if (Array.isArray(kind)) opts = kind.map(v => [v, v]);
  else if (kind.startsWith('dict:')) opts = dict(kind.slice(5)).map(v => [v, v]);
  else if (kind === 'user') opts = R.users.filter(u => u.active).map(u => [u.id, u.name]);
  if (current && !opts.some(([v]) => v === current)) opts.unshift([current, kind === 'user' ? (R.users.find(u => u.id === current)?.name || '（已停用成员）') : current]);
  return (withEmpty !== false ? `<option value="">${withEmpty || '全部'}</option>` : '') + opts.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

/** 单元格渲染 */
function cell(type, [key, , kind], x) {
  const v = x[key];
  switch (kind) {
    case 'strong': return `<b>${esc(v || '—')}</b>`;
    case 'accountLink': return `<a class="link" href="#/accounts/${esc(x.id)}">${esc(v)}</a>`;
    case 'oppLink': return `<a class="link" href="#/opportunities/${esc(x.id)}">${esc(v)}</a>`;
    case 'account': return v ? `<a class="link" href="#/accounts/${esc(v)}">${esc(x.accountName || '（已删除）')}</a>` : '—';
    case 'contract': return v ? `<span class="link" data-act="view-contract" data-id="${esc(v)}">${esc(x.contractLabel || '（已删除）')}</span>` : '—';
    case 'contractAccount': return x.contractAccountId ? `<a class="link" href="#/accounts/${esc(x.contractAccountId)}">${esc(x.contractAccountName)}</a>` : '—';
    case 'money': return money(v);
    case 'pct': return `${Number(v || 0)}%`;
    case 'tag': return tag(v);
    case 'date': return fmtDate(v);
    case 'datetime': return relTime(v);
    case 'bool': return v ? '<span class="tag green">是</span>' : '—';
    case 'clip': return `<span class="clip" title="${esc(v)}">${esc(v)}</span>`;
    case 'activityType': return `<span class="atype">${icon(ACTIVITY_ICON[v] || 'message')}${esc(v || '—')}</span>`;
    case 'taskStatus': return tag(isOverdue(x) ? '逾期' : v);
    case 'taskCheck': return canEdit() ? `<button class="circle ${x.status === '已完成' ? 'done' : ''}" data-act="toggle-task" data-id="${esc(x.id)}" aria-label="切换完成">${icon('check')}</button>` : '';
    case 'planStatus': return tag(x.status !== '已回款' && x.dueDate < ymd() ? '逾期' : v);
    default: return esc(v ?? '—') || '—';
  }
}

function rowActions(type, x) {
  const b = [];
  const btn = (act, label, extra = '', cls = '') => `<button class="textbtn ${cls}" data-act="${act}" data-type="${type}" data-id="${esc(x.id)}" ${extra}>${label}</button>`;
  if (type === 'accounts') b.push(`<a class="textbtn" href="#/accounts/${esc(x.id)}">查看</a>`);
  else if (type === 'opportunities') b.push(`<a class="textbtn" href="#/opportunities/${esc(x.id)}">查看</a>`);
  else if (type === 'contracts') b.push(btn('view-contract', '查看'));
  else b.push(btn('view', '查看'));
  if (canEdit() && !LISTS[type]?.noEdit && !(type === 'leads' && x.convertedAccountId)) b.push(btn('edit', '编辑'));
  if (type === 'leads' && canEdit() && !x.convertedAccountId) b.push(btn('assign', '分配'), btn('convert', '转客户'));
  if (type === 'leads' && x.convertedAccountId) b.push(`<a class="textbtn" href="#/accounts/${esc(x.convertedAccountId)}">已转客户</a>`);
  if (type === 'contracts' && canEdit() && x.status === '草稿') b.push(btn('submit-contract', '提交审批'));
  if (type === 'contracts' && canApproveC(x)) b.push(btn('approve-contract', `审批${curLevel(x) ? '·' + curLevel(x).name.replace(/审批$/, '') : ''}`));
  if (type === 'contracts' && canEdit() && x.status !== '已作废') b.push(btn('pay-contract', '登记回款'));
  if (type === 'plans' && canEdit() && x.status !== '已回款') b.push(btn('plan-paid', '确认回款'));
  if (canManage()) b.push(btn('delete', '删除', '', 'danger'));
  return `<div class="row-actions">${b.join('')}</div>`;
}

function table(type, cols, items, { selectable = false, actions = true, selected = new Set() } = {}) {
  if (!items.length) return `<div class="empty">${icon('list')}<p>暂无数据</p></div>`;
  return `<div class="tbl-wrap"><table>
    <thead><tr>${selectable ? `<th class="sel"><input type="checkbox" data-act="select-all" aria-label="全选" ${items.every(x => selected.has(x.id)) ? 'checked' : ''}></th>` : ''}${cols.map(c => `<th>${c[1]}</th>`).join('')}${actions ? '<th class="ops">操作</th>' : ''}</tr></thead>
    <tbody>${items.map(x => `<tr class="${type === 'tasks' && x.status === '已完成' ? 'is-done' : ''}">${selectable ? `<td class="sel"><input type="checkbox" data-act="select-row" data-id="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''} aria-label="选择"></td>` : ''}${cols.map(c => `<td data-label="${esc(c[1])}">${cell(type, c, x)}</td>`).join('')}${actions ? `<td class="ops">${rowActions(type, x)}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
}

function pager(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<div class="pager"><span class="muted">共 ${total} 条</span>
    <button class="pg" data-act="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="上一页">${icon('left')}</button>
    ${nums.map(n => n === '…' ? '<span class="muted">…</span>' : `<button class="pg ${n === page ? 'on' : ''}" data-act="page" data-page="${n}">${n}</button>`).join('')}
    <button class="pg" data-act="page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="下一页">${icon('right')}</button>
    <select class="field slim" data-act-change="page-size">${[10, 20, 50, 100].map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} 条/页</option>`).join('')}</select></div>`;
}

// ======================= 通用列表 =======================
/**
 * 在 container 中挂载一个带筛选/分页/批量操作的列表。
 * opts.fixed: 固定过滤（不显示）；opts.tabs: [[label, params]] 顶部状态页签
 */
function mountList(container, type, opts = {}) {
  const def = LISTS[type];
  const L = ui.list = { type, container, page: 1, pageSize: 10, q: opts.q || '', filters: { ...(opts.filters || {}) }, fixed: opts.fixed || {}, selected: new Set(), tabs: opts.tabs || null, tab: opts.tab || 0, items: [] };
  const filters = def.filters.filter(([k]) => !(k in L.fixed)).map(([k, label, kind]) => `<label class="filter"><span>${label}</span><select class="field slim" data-act-change="filter" data-key="${k}">${optionList(kind, L.filters[k] || '')}</select></label>`).join('');
  container.innerHTML = `
    ${L.tabs ? `<div class="tabs">${L.tabs.map(([label], i) => `<button class="tab ${i === L.tab ? 'on' : ''}" data-act="list-tab" data-i="${i}">${label}</button>`).join('')}</div>` : ''}
    <div class="toolbar">
      <div class="filters">${filters}<label class="search">${icon('search')}<input data-act-input="list-q" placeholder="输入关键字搜索" value="${esc(L.q)}"></label></div>
      <div class="tools">
        <span class="batch" id="batchBar" hidden><span class="muted" id="batchCount"></span>
          ${def.batch && canEdit() && FORMS[type].some(f => f[0] === 'ownerId') ? '<button class="btn light small" data-act="batch-assign">批量分配</button>' : ''}
          ${def.batch && canManage() ? '<button class="btn light small danger" data-act="batch-delete">批量删除</button>' : ''}</span>
        ${canEdit() && IMPORTABLE.includes(type) ? `<button class="btn light" data-act="import" data-type="${type}">${icon('upload')}导入</button>` : ''}
        ${canEdit() ? `<button class="btn light" data-act="export">${icon('download')}导出</button>` : ''}
        ${canEdit() && def.create ? `<button class="btn" data-act="create" data-type="${type}">${icon('plus')}${def.create}</button>` : ''}
      </div>
    </div>
    <div class="panel flush" id="listBody"><div class="loading">加载中…</div></div>`;
  return loadList();
}
function listParams(L, paged = true) {
  const p = new URLSearchParams();
  const tabParams = L.tabs ? L.tabs[L.tab][1] : {};
  for (const [k, v] of Object.entries({ ...L.fixed, ...tabParams, ...L.filters })) if (v) p.set(k, v);
  if (L.q) p.set('q', L.q);
  if (paged) { p.set('page', L.page); p.set('pageSize', L.pageSize); }
  return p;
}
async function loadList() {
  const L = ui.list; if (!L) return;
  const r = await API.get(`/${L.type}?${listParams(L)}`);
  if (ui.list !== L) return;
  if (!r.items.length && L.page > 1) { L.page = Math.max(1, Math.ceil(r.total / L.pageSize)); return loadList(); }
  L.items = r.items;
  const def = LISTS[L.type];
  const cols = [...def.cols, ...customCols(L.type)].filter(([k]) => !(k in L.fixed));
  $('#listBody', L.container).innerHTML = table(L.type, cols, r.items, { selectable: def.batch && canEdit(), selected: L.selected }) + (r.total ? pager(r.total, L.page, L.pageSize) : '');
  updateBatchBar();
}
function updateBatchBar() {
  const L = ui.list, bar = $('#batchBar'); if (!L || !bar) return;
  bar.hidden = !L.selected.size;
  $('#batchCount').textContent = `已选 ${L.selected.size} 项`;
}

async function pageList(type, r) {
  const def = LISTS[type];
  const content = $('#content');
  content.innerHTML = pageHead(def.title, def.sub) + '<div id="listHost"></div>';
  await mountList($('#listHost'), type, { q: r.params.get('q') || '' });
}

// ======================= 远程搜索下拉 =======================
const RS_TYPE = { account: 'accounts', contract: 'contracts', opportunity: 'opportunities' };
const RS_EMPTY = { account: '请选择客户', contract: '请选择合同', opportunity: '不关联商机' };
/** 带搜索框的下拉：输入关键字后从 /api/lookup 拉取前 30 条，避免一次性加载全部客户 */
function remoteSelect(kind, attrs, value = '', emptyText = RS_EMPTY[kind]) {
  return `<span class="rselect" data-kind="${kind}"><input class="field rs-q" data-rs-q placeholder="输入名称搜索…" autocomplete="off" aria-label="搜索">
    <select class="field" ${attrs} data-role="${kind}" data-rs-value="${esc(value)}" data-empty="${esc(emptyText)}"><option value="">${esc(emptyText)}</option>${value ? `<option value="${esc(value)}" selected>加载中…</option>` : ''}</select></span>`;
}
async function rsLoad(box, q = '') {
  const kind = box.dataset.kind, sel = box.querySelector('select'), current = sel.value || sel.dataset.rsValue || '';
  const params = new URLSearchParams({ type: RS_TYPE[kind], q, limit: 30 });
  if (kind === 'contract') params.set('active', '1');
  if (kind === 'opportunity') {
    const acc = box.closest('form, .toolbar, .modal-body')?.querySelector('[data-role=account]')?.value;
    if (!acc) { sel.innerHTML = `<option value="">先选择客户</option>`; return; }
    params.set('accountId', acc);
  }
  const reqs = [API.get('/lookup?' + params)];
  if (current) reqs.push(API.get(`/lookup?type=${RS_TYPE[kind]}&ids=${encodeURIComponent(current)}`));
  const [list, cur] = await Promise.all(reqs);
  const items = list.items.slice();
  if (cur?.items[0] && !items.some(x => x.id === current)) items.unshift(cur.items[0]);
  sel.innerHTML = `<option value="">${esc(sel.dataset.empty)}</option>` + items.map(x => `<option value="${esc(x.id)}" ${x.id === current ? 'selected' : ''}>${esc(x.label)}</option>`).join('')
    + (list.items.length >= 30 ? '<option value="" disabled>… 结果较多，请输入关键字缩小范围</option>' : '');
  sel.dataset.rsValue = sel.value;
}
function initRemoteSelects(root) {
  for (const box of root.querySelectorAll('.rselect')) rsLoad(box).catch(e => toast(e.message, true));
}
document.addEventListener('input', debounce(e => { const box = e.target.closest?.('.rselect'); if (box && e.target.matches('[data-rs-q]')) rsLoad(box, e.target.value.trim()).catch(err => toast(err.message, true)); }, 250));
document.addEventListener('change', e => {
  if (!e.target.matches?.('[data-role=account]')) return;
  const opp = e.target.closest('form')?.querySelector('.rselect[data-kind=opportunity]');
  if (opp) { opp.querySelector('select').dataset.rsValue = ''; rsLoad(opp).catch(err => toast(err.message, true)); }
});

// ======================= 表单弹窗 =======================
function fieldControl(type, field, record) {
  const [key, label, kind = 'text', required = 0, wide = 0] = field;
  const v = record[key] ?? '';
  const req = required ? 'required' : '';
  let input;
  if (kind === 'textarea') input = `<textarea class="field" name="${key}" ${req} maxlength="3000">${esc(v)}</textarea>`;
  else if (kind === 'checkbox') return `<label class="check fld"><input type="checkbox" name="${key}" ${v ? 'checked' : ''}> ${label}</label>`;
  else if (['account', 'contract', 'opportunity'].includes(kind)) input = remoteSelect(kind, `name="${key}" ${req}`, v);
  else if (kind === 'user') input = `<select class="field" name="${key}">${optionList('user', v, '未分配')}</select>`;
  else if (kind === 'contractStatus') {
    const signed = ['已签订', '执行中', '已完成'];
    const opts = isAdmin() ? CONTRACT_STATUS
      : canManage() ? CONTRACT_STATUS.filter(s => ['草稿', '审批中', '已作废'].includes(s) || s === v || (signed.includes(v) && signed.includes(s)))
        : CONTRACT_STATUS.filter(s => ['草稿', '审批中'].includes(s) || s === v);
    input = `<select class="field" name="${key}">${opts.map(o => `<option ${o === (v || '草稿') ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (Array.isArray(kind) || kind.startsWith('dict:')) input = `<select class="field" name="${key}">${optionList(kind, v, required ? false : '请选择')}</select>`;
  else if (kind === 'money') input = `<input class="field" type="number" name="${key}" step="0.01" min="0" max="1000000000000" value="${esc(v)}" ${req} inputmode="decimal">`;
  else if (kind === 'percent') input = `<input class="field" type="number" name="${key}" step="1" min="0" max="100" value="${esc(v)}">`;
  else if (kind === 'datetime') input = `<input class="field" type="datetime-local" name="${key}" value="${esc(String(v).slice(0, 16))}">`;
  else if (kind === 'number') input = `<input class="field" type="number" step="any" name="${key}" value="${esc(v)}" ${req}>`;
  else input = `<input class="field" type="${kind}" name="${key}" value="${esc(v)}" ${req} maxlength="3000">`;
  return `<label class="fld ${wide || kind === 'textarea' ? 'wide' : ''}"><span>${label}${required ? ' <i class="req">*</i>' : ''}</span>${input}</label>`;
}

function openModal({ title, body, submitText = '保存', onSubmit, wide = false, readOnly = false, footer = '' }) {
  document.querySelector('dialog.modal')?.close();
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' wide' : '');
  dlg.innerHTML = `<form method="dialog" class="modal-form"><div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="iconbtn" data-close aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${footer}<button type="button" class="btn light" data-close>${readOnly ? '关闭' : '取消'}</button>${readOnly ? '' : `<button type="submit" class="btn">${submitText}</button>`}</div></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (readOnly || !onSubmit) return dlg.close();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try { const keep = await onSubmit(new FormData(form), form); if (keep !== false) dlg.close(); }
    catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
  dlg.showModal();
  initRemoteSelects(form);
  return dlg;
}

function confirmBox(message, okText = '确定', danger = true) {
  return new Promise(resolve => {
    let ok = false;
    const dlg = openModal({ title: '请确认', body: `<p class="confirm">${esc(message)}</p>`, submitText: okText, onSubmit: async () => { ok = true; } });
    if (danger) dlg.querySelector('[type=submit]').classList.add('danger-solid');
    dlg.addEventListener('close', () => resolve(ok));
  });
}

function formToBody(type, fd) {
  const body = {};
  for (const [key, , kind] of formFields(type)) {
    if (kind === 'checkbox') { body[key] = fd.has(key); continue; }
    if (!fd.has(key)) continue;
    const v = String(fd.get(key)).trim();
    body[key] = kind === 'money' || kind === 'percent' ? (v === '' ? 0 : Number(v)) : v;
  }
  return body;
}

async function editRecord(type, id = null, preset = {}) {
  let record = { ...preset };
  if (id) record = (await API.get(`/${type}/${id}`)).item;
  else {
    if (FORMS[type].some(f => f[0] === 'ownerId') && !record.ownerId) record.ownerId = me.id;
    if (type === 'activities' && !record.occurredAt) record.occurredAt = nowLocal();
    if (type === 'payments' && !record.paidAt) record.paidAt = ymd();
  }
  openModal({
    title: `${id ? '编辑' : '新增'}${ENTITY_LABEL[type]}`,
    wide: formFields(type).length > 6,
    body: `<div class="form-grid">${formFields(type).map(f => fieldControl(type, f, record)).join('')}</div>`,
    onSubmit: async fd => {
      await (id ? API.patch(`/${type}/${id}`, formToBody(type, fd)) : API.post(`/${type}`, formToBody(type, fd)));
      toast('已保存'); rerender();
    },
  });
}

async function viewRecord(type, id) {
  const { item } = await API.get(`/${type}/${id}`);
  const rows = formFields(type).map(([k, label, kind]) => {
    let v = item[k];
    if (kind === 'user') v = item.owner; else if (kind === 'account') v = item.accountName; else if (kind === 'contract') v = item.contractLabel; else if (kind === 'opportunity') v = item.opportunityName;
    else if (kind === 'money') v = money(v); else if (kind === 'checkbox') v = v ? '是' : '否'; else if (kind === 'datetime') v = fmtDateTime(v);
    return `<div class="kv ${kind === 'textarea' ? 'wide' : ''}"><span>${label.replace(/（.*?）/, '')}</span><b>${esc(v || '—')}</b></div>`;
  }).join('');
  openModal({ title: `${ENTITY_LABEL[type]}详情`, wide: true, readOnly: true, body: `<div class="kv-grid">${rows}<div class="kv"><span>创建时间</span><b>${fmtDateTime(item.createdAt)}</b></div><div class="kv"><span>更新时间</span><b>${fmtDateTime(item.updatedAt)}</b></div></div>`,
    footer: canEdit() && !LISTS[type]?.noEdit ? `<button type="button" class="btn light" data-act="edit" data-type="${type}" data-id="${esc(id)}">编辑</button>` : '' });
}

async function deleteRecord(type, id) {
  if (!await confirmBox(`确认删除该${ENTITY_LABEL[type]}？操作将写入审计日志。`, '删除')) return;
  try { await API.del(`/${type}/${id}`); toast('已删除'); rerender(); } catch (e) { toast(e.message, true); }
}

function assignModal(type, ids) {
  openModal({
    title: `分配负责人（${ids.length} 条）`,
    body: `<label class="fld wide"><span>负责人 <i class="req">*</i></span><select class="field" name="ownerId" required>${optionList('user', '', '请选择负责人')}</select></label>`,
    onSubmit: async fd => {
      const r = await API.post(`/${type}/batch`, { action: 'assign', ids, ownerId: fd.get('ownerId') });
      toast(`已分配 ${r.done.length} 条${r.failed.length ? `，失败 ${r.failed.length} 条` : ''}`);
      if (ui.list) ui.list.selected.clear();
      rerender();
    },
  });
}

// ======================= 附件 =======================
async function filesPane(entity, id) {
  const { items } = await API.get(`/attachments?entity=${entity}&entityId=${encodeURIComponent(id)}`);
  return `<div class="files" data-entity="${entity}" data-id="${esc(id)}">
    <div class="sub-head">${canEdit() ? `<label class="btn light small">${icon('upload')}上传文件<input type="file" hidden multiple data-act-change="upload" data-entity="${entity}" data-id="${esc(id)}"></label>` : ''}<span class="muted small">支持 PDF、Office、图片、TXT/CSV、ZIP，单个不超过 20MB</span></div>
    ${items.length ? `<div class="tbl-wrap plain"><table><thead><tr><th>文件名</th><th>大小</th><th>上传人</th><th>上传时间</th><th class="ops">操作</th></tr></thead><tbody>${items.map(f => `<tr><td><a class="link" href="/api/attachments/${esc(f.id)}/download">${icon('clip')}${esc(f.name)}</a></td><td>${fileSize(f.size)}</td><td>${esc(f.createdByName || '—')}</td><td>${fmtDateTime(f.createdAt)}</td><td class="ops">${canManage() || f.createdBy === me.id ? `<button class="textbtn danger" data-act="file-del" data-id="${esc(f.id)}">删除</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty small">${icon('clip')}<p>暂无文件</p></div>`}</div>`;
}
async function uploadFiles(input) {
  const { entity, id } = input.dataset, box = input.closest('.files');
  for (const f of input.files) {
    const r = await fetch(`/api/attachments?entity=${entity}&entityId=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: f });
    if (!r.ok) { toast(`${f.name}：${(await r.json().catch(() => ({}))).error || '上传失败'}`, true); continue; }
    toast(`已上传 ${f.name}`);
  }
  box.outerHTML = await filesPane(entity, id);
}

// ======================= 批量导入 =======================
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('gbk').decode(buf); }
}
function importModal(type) {
  const dlg = openModal({
    title: `批量导入${ENTITY_LABEL[type]}`, wide: true, submitText: '确认导入',
    body: `<ol class="howto"><li>下载 <a class="link" href="/api/${type}/import">导入模板</a>，按表头填写（带 * 为必填；负责人填成员姓名${['contacts', 'opportunities'].includes(type) ? '；客户填系统中已有的客户名称' : ''}）。</li>
      <li>Excel 中“另存为 CSV（UTF-8 或默认编码均可）”，选择文件后系统先预检，全部通过才能导入。</li></ol>
      <label class="fld wide"><span>CSV 文件</span><input class="field" type="file" accept=".csv,.txt,text/csv" name="file" data-role="import-file"></label><div id="importResult"></div>`,
    onSubmit: async (fd, form) => {
      if (!form.csvText) { toast('请先选择文件并完成预检', true); return false; }
      const r = await API.post(`/${type}/import`, { csv: form.csvText, commit: true });
      toast(`已导入 ${r.imported} 条${ENTITY_LABEL[type]}`); rerender();
    },
  });
  const form = dlg.querySelector('form'), submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  form.querySelector('[data-role=import-file]').addEventListener('change', async e => {
    const file = e.target.files[0]; form.csvText = ''; submit.disabled = true;
    if (!file) return;
    const out = $('#importResult', dlg); out.innerHTML = '<div class="loading">预检中…</div>';
    try {
      const text = await decodeFile(file);
      const r = await API.post(`/${type}/import`, { csv: text });
      out.innerHTML = `<div class="import-sum"><span>共 <b>${r.total}</b> 行</span><span class="ok">可导入 <b>${r.valid}</b></span><span class="${r.errorCount ? 'neg' : ''}">错误 <b>${r.errorCount}</b></span></div>
        ${r.ignoredColumns.length ? `<p class="muted small">未识别的列（将忽略）：${r.ignoredColumns.map(esc).join('、')}</p>` : ''}
        ${r.errorCount ? `<div class="tbl-wrap plain"><table class="mini edit"><thead><tr><th>行号</th><th>错误</th></tr></thead><tbody>${r.errors.map(x => `<tr><td>${x.line}</td><td>${esc(x.error)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="ok">✓ 预检通过，可以导入</p>'}`;
      if (!r.errorCount && r.valid) { form.csvText = text; submit.disabled = false; }
    } catch (err) { out.innerHTML = `<p class="neg">${esc(err.message)}</p>`; }
  });
}

// ======================= 图表（SVG，属性着色，兼容 CSP） =======================
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 5 ? 5 : 10) * p;
}
function lineChart(points, { valueLabel = '销售额' } = {}) {
  const W = 680, H = 260, L = 56, Rr = 16, T = 18, B = 34;
  const max = niceMax(Math.max(...points.map(p => p.amount), 0) * 1.1);
  const x = i => L + (points.length === 1 ? (W - L - Rr) / 2 : (i * (W - L - Rr)) / (points.length - 1));
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 1, 2, 3, 4, 5].map(i => (max * i) / 5);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.amount).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const step = Math.ceil(points.length / 12);
  return `<svg class="chart line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${valueLabel}趋势图" data-points='${esc(JSON.stringify(points.map((p, i) => [x(i), y(p.amount), p.label, p.amount])))}'>
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${moneyShort(t)}</text>`).join('')}
    ${points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text class="axis" x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(p.label)}</text>` : '')).join('')}
    <path class="area" d="${area}" fill="url(#areaGrad)"/><path class="line" d="${line}"/>
    ${points.length <= 31 ? points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.amount)}" r="3.5"/>`).join('') : ''}
    <g class="tip" transform="translate(0,0)"><line class="tip-line" x1="0" x2="0" y1="${T}" y2="${H - B}"/><circle class="tip-dot" r="6"/><g class="tip-box"><rect x="10" y="-44" width="150" height="50" rx="8"/><text class="tip-l" x="22" y="-24"></text><text class="tip-v" x="22" y="-6"></text></g></g>
  </svg>`;
}
function bindLineChart(svg, valueLabel = '销售额') {
  if (!svg) return;
  const pts = JSON.parse(svg.dataset.points);
  const tip = svg.querySelector('.tip'), W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
  const show = i => {
    const [px, py, label, v] = pts[i];
    tip.setAttribute('transform', `translate(${px},0)`);
    tip.querySelector('.tip-dot').setAttribute('cy', py);
    const box = tip.querySelector('.tip-box');
    const flip = px > W - 180;
    box.setAttribute('transform', `translate(${flip ? -170 : 0},${Math.max(56, Math.min(H - 40, py))})`);
    tip.querySelector('.tip-l').textContent = `${label} ${valueLabel}`;
    tip.querySelector('.tip-v').textContent = money(v);
  };
  let last = pts.length - 1;
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i][3] > 0) { last = i; break; }
  show(last);
  svg.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0; pts.forEach((p, i) => { if (Math.abs(p[0] - vx) < Math.abs(pts[best][0] - vx)) best = i; });
    show(best);
  });
}
function barChart(points, key = 'contractAmount', labelKey = 'label') {
  const W = 680, H = 260, L = 56, T = 24, B = 34, Rr = 12;
  const max = niceMax(Math.max(...points.map(p => p[key]), 0) * 1.1);
  const bw = Math.min(42, ((W - L - Rr) / Math.max(1, points.length)) * 0.55);
  const x = i => L + ((i + 0.5) * (W - L - Rr)) / Math.max(1, points.length);
  const y = v => T + (H - T - B) * (1 - v / max);
  return `<svg class="chart bar-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="柱状图">
    ${[0, 1, 2, 3, 4, 5].map(i => (max * i) / 5).map(t => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${moneyShort(t)}</text>`).join('')}
    ${points.map((p, i) => `<rect class="bar" x="${x(i) - bw / 2}" y="${y(p[key])}" width="${bw}" height="${Math.max(0, y(0) - y(p[key]))}" rx="4"><title>${esc(p[labelKey])}：${money(p[key])}</title></rect>
      ${p[key] ? `<text class="bar-v" x="${x(i)}" y="${y(p[key]) - 6}" text-anchor="middle">${moneyShort(p[key])}</text>` : ''}
      <text class="axis" x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(p[labelKey])}</text>`).join('')}
  </svg>`;
}
function donut(items, centerLabel) {
  const total = items.reduce((a, x) => a + x.count, 0);
  const C = 2 * Math.PI * 60;
  let offset = 0;
  const arcs = total ? items.map((x, i) => { const len = (x.count / total) * C; const s = `<circle class="arc c${i % 8}" cx="90" cy="90" r="60" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"><title>${esc(x.name)}：${x.count}</title></circle>`; offset += len; return s; }).join('') : '<circle class="arc empty" cx="90" cy="90" r="60"/>';
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 180 180" role="img" aria-label="${esc(centerLabel)}分布"><g transform="rotate(-90 90 90)">${arcs}</g><text x="90" y="84" text-anchor="middle" class="d-l">${esc(centerLabel)}</text><text x="90" y="108" text-anchor="middle" class="d-v">${total}</text></svg>
    <ul class="legend">${items.map((x, i) => `<li><i class="sw c${i % 8}"></i>${esc(x.name)}<b>${total ? Math.round((x.count / total) * 100) : 0}%</b></li>`).join('') || '<li class="muted">暂无数据</li>'}</ul></div>`;
}
function funnel(stages) {
  const W = 220, rowH = 34, gap = 5;
  const shown = stages.filter(s => s.stage !== '输单');
  const widths = shown.map((_, i) => W - i * ((W * 0.55) / Math.max(1, shown.length - 1)));
  return `<svg class="funnel" viewBox="0 0 ${W} ${shown.length * (rowH + gap)}" role="img" aria-label="商机销售漏斗">
    ${shown.map((s, i) => {
      const top = widths[i], bot = widths[i + 1] ?? widths[i] * 0.82, yy = i * (rowH + gap);
      return `<path class="fs f${i}" d="M${(W - top) / 2},${yy}H${(W + top) / 2}L${(W + bot) / 2},${yy + rowH}H${(W - bot) / 2}Z"/><text class="fs-t" x="${W / 2}" y="${yy + rowH / 2 + 5}" text-anchor="middle">${esc(s.stage)}  ${s.count}</text>`;
    }).join('')}
  </svg>`;
}

// ======================= 工作台 =======================
async function pageDashboard() {
  const d = await API.get('/dashboard?range=' + ui.dashRange);
  const KPI_ICON = { accounts: ['users', 'blue'], newAccounts: ['pluscircle', 'green'], openOpportunities: ['briefcase', 'purple'], monthPayments: ['coins', 'orange'] };
  const shown = d.stages.filter(s => s.stage !== '输单');
  const totalOpp = shown.reduce((a, s) => a + s.count, 0), totalAmt = shown.reduce((a, s) => a + s.amount, 0);
  const now = new Date();
  $('#content').innerHTML = `
    <div class="hello"><h2>${greeting()}，${esc(me.name)}！</h2><p class="muted">今天是 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（周${weekday()}）${d.alerts ? `，你有 <a class="link" href="#/tasks?view=due">${d.alerts} 项今日/逾期任务</a>` : ''}</p></div>
    <div class="kpis">${d.kpis.map(k => `<div class="kpi ${KPI_ICON[k.key][1]}"><span class="kpi-ic">${icon(KPI_ICON[k.key][0])}</span><div><div class="kpi-l">${k.label}</div><div class="kpi-v">${k.money ? money(k.value) : Number(k.value).toLocaleString('zh-CN')}</div><div class="kpi-c">较上月 ${changeBadge(k.change)}</div></div></div>`).join('')}</div>
    <div class="grid g-trend">
      <section class="panel"><div class="panel-head"><h3>销售趋势</h3><div class="seg">${[['7d', '近7天'], ['30d', '近30天'], ['quarter', '本季度'], ['year', '本年度']].map(([k, l]) => `<button class="${ui.dashRange === k ? 'on' : ''}" data-act="dash-range" data-range="${k}">${l}</button>`).join('')}</div></div>
        ${lineChart(d.trend)}<p class="muted small">销售额 = 已生效合同金额（按签订日期统计，不含草稿/作废）</p></section>
      <section class="panel"><div class="panel-head"><h3>商机销售漏斗</h3><span class="muted small">商机总数 <b>${totalOpp}</b>｜预计金额 <b>${money(totalAmt)}</b></span></div>
        <div class="funnel-wrap">${funnel(d.stages)}
          <table class="mini"><thead><tr><th>阶段</th><th>商机数</th><th>金额(万元)</th></tr></thead><tbody>${shown.map((s, i) => `<tr><td><i class="sw f${i}"></i>${esc(s.stage)}</td><td>${s.count}</td><td>${(s.amount / 1e4).toFixed(1)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>
    <div class="grid g-bottom">
      <section class="panel"><div class="panel-head"><h3>最近跟进记录</h3><a class="link" href="#/activities">查看全部 ${icon('right')}</a></div>
        ${d.recentActivities.length ? `<div class="tbl-wrap plain"><table><thead><tr><th></th><th>时间</th><th>客户</th><th>跟进内容</th><th>负责人</th><th>结果</th></tr></thead><tbody>
          ${d.recentActivities.map(a => `<tr><td class="aic">${icon(ACTIVITY_ICON[a.type] || 'message')}</td><td>${relTime(a.occurredAt || a.createdAt)}</td><td><a class="link" href="#/accounts/${esc(a.accountId)}">${esc(a.accountName || '—')}</a></td><td><span class="clip" title="${esc(a.content)}">${esc(a.content)}</span></td><td>${esc(a.owner || '—')}</td><td>${tag(a.result)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('message')}<p>暂无跟进记录</p>${canEdit() ? '<button class="btn light small" data-act="create" data-type="activities">写跟进</button>' : ''}</div>`}
      </section>
      <section class="panel"><div class="panel-head"><h3>待办任务</h3><a class="link" href="#/tasks">查看全部 ${icon('right')}</a></div>
        ${d.todos.length ? `<ul class="todos">${d.todos.map(t => `<li><button class="box" data-act="toggle-task" data-id="${esc(t.id)}" ${canEdit() ? '' : 'disabled'} aria-label="完成任务"></button><span class="todo-t">${esc(t.title)}${t.accountName ? `<small>${esc(t.accountName)}</small>` : ''}</span><span class="due ${t.overdue ? 'late' : t.dueToday ? 'today' : ''}">${t.overdue ? '已逾期' : t.dueToday ? '今天' : t.dueDate ? t.dueDate.slice(5) : '—'}</span></li>`).join('')}</ul>` : `<div class="empty">${icon('check')}<p>暂无待办，干得漂亮！</p></div>`}
      </section>
    </div>`;
  bindLineChart($('.line-chart'));
}

// ======================= 客户详情 =======================
async function pageAccount(id) {
  const o = await API.get(`/accounts/${id}/overview`);
  const a = o.account, primary = o.contacts.find(c => c.isPrimary) || o.contacts[0];
  const tabs = [['info', '基本信息'], ['contacts', `联系人 ${o.contacts.length}`], ['activities', `跟进记录 ${o.activities.length}`], ['opportunities', `商机 ${o.opportunities.length}`], ['contracts', `合同 ${o.contracts.length}`], ['payments', `回款 ${o.payments.length}`], ['tasks', `任务 ${o.tasks.length}`], ['files', '相关文件']];
  const tab = ui.tabs.account?.id === id ? ui.tabs.account.tab : 'info';
  ui.tabs.account = { id, tab };
  const sub = (type, items, cols) => `<div class="sub-head">${canEdit() ? `<button class="btn light small" data-act="create" data-type="${type}" data-account="${esc(id)}">${icon('plus')}新增${ENTITY_LABEL[type]}</button>` : ''}</div>${table(type, cols, items)}`;
  const panes = {
    info: `<div class="detail-grid"><div class="kv-grid">
        ${[['客户名称', a.name], ['客户类型', a.type], ['所属行业', a.industry], ['客户级别', a.level], ['客户来源', a.source], ['成立时间', a.foundedAt], ['主联系人', primary ? `${primary.name}${primary.phone ? '　' + primary.phone : ''}` : ''], ['联系电话', a.phone], ['邮箱', a.email], ['负责人', a.owner], ['地址', a.address], ['创建时间', fmtDateTime(a.createdAt)]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}
        ${customKv('accounts', a)}<div class="kv wide"><span>备注</span><b>${esc(a.notes || '—')}</b></div></div>
      <div class="portrait"><h4>客户画像</h4><div class="pgrid">
        <div><span>跟进次数</span><b>${o.stats.activities}</b></div><div><span>进行中商机</span><b>${o.stats.opportunities}</b></div>
        <div><span>合同金额</span><b>${money(o.stats.contractAmount)}</b></div><div><span>回款金额</span><b>${money(o.stats.received)}</b></div></div>
        <p class="muted small">最近跟进：${o.stats.lastActivityAt ? relTime(o.stats.lastActivityAt) : '暂无'}</p></div></div>`,
    contacts: sub('contacts', o.contacts, LISTS.contacts.cols.filter(c => c[0] !== 'accountId')),
    activities: sub('activities', o.activities, LISTS.activities.cols.filter(c => c[0] !== 'accountId')),
    opportunities: sub('opportunities', o.opportunities, LISTS.opportunities.cols.filter(c => c[0] !== 'accountId')),
    contracts: sub('contracts', o.contracts, LISTS.contracts.cols.filter(c => c[0] !== 'accountId')),
    payments: table('payments', LISTS.payments.cols.filter(c => c[0] !== 'customer'), o.payments),
    tasks: sub('tasks', o.tasks, LISTS.tasks.cols.filter(c => c[0] !== 'accountId')),
    files: tab === 'files' ? await filesPane('accounts', id) : '',
  };
  $('#content').innerHTML = `
    <a class="back" href="#/accounts">${icon('left')}返回客户列表</a>
    <section class="panel detail-hero">
      <span class="hero-ic">${icon('building')}</span>
      <div class="hero-main"><h2>${esc(a.name)} ${tag(a.level)} ${tag(a.status)}</h2><p class="muted">${esc([a.type, a.industry, a.owner && '负责人：' + a.owner].filter(Boolean).join(' · '))}</p></div>
      <div class="tools">${canEdit() ? `<button class="btn light" data-act="edit" data-type="accounts" data-id="${esc(id)}">${icon('edit')}编辑</button><button class="btn light" data-act="create" data-type="activities" data-account="${esc(id)}">写跟进</button><button class="btn" data-act="create" data-type="opportunities" data-account="${esc(id)}">${icon('plus')}新建商机</button>` : ''}${canManage() ? `<button class="btn light danger" data-act="delete" data-type="accounts" data-id="${esc(id)}">删除</button>` : ''}</div>
    </section>
    <section class="panel">
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="account-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="tab-pane">${panes[tab]}</div>
    </section>`;
}

// ======================= 商机 =======================
async function pageOpportunities(r) {
  const view = r.params.get('view') || ui.oppView;
  ui.oppView = view;
  const switcher = `<div class="seg">${[['board', 'board', '看板'], ['list', 'list', '列表']].map(([k, ic, l]) => `<button class="${view === k ? 'on' : ''}" data-act="opp-view" data-view="${k}">${icon(ic)}${l}</button>`).join('')}</div>`;
  if (view === 'list') {
    $('#content').innerHTML = pageHead('商机管理', '商机阶段、预计金额与成交预测', switcher) + '<div id="listHost"></div>';
    return mountList($('#listHost'), 'opportunities', { q: r.params.get('q') || '' });
  }
  const owner = r.params.get('owner') || '';
  const items = (await API.get('/opportunities' + (owner ? '?ownerId=' + encodeURIComponent(owner) : ''))).items;
  ui.oppCache = new Map(items.map(o => [o.id, o]));
  const LANE_MAX = 50;
  const totalOpen = items.filter(o => !['赢单', '输单'].includes(o.stage));
  $('#content').innerHTML = pageHead('商机管理', `进行中 ${totalOpen.length} 个 · 预计金额 ${money(totalOpen.reduce((a, o) => a + Number(o.amount || 0), 0))} · 拖拽卡片可变更阶段`,
    `${switcher}<select class="field slim" data-act-change="opp-owner">${optionList('user', owner, '全部负责人')}</select>${canEdit() ? `<button class="btn" data-act="create" data-type="opportunities">${icon('plus')}新建商机</button>` : ''}`) +
    `<div class="kanban">${STAGES.map((s, i) => {
      const lane = items.filter(o => o.stage === s);
      return `<div class="lane" data-stage="${s}"><div class="lane-head s${i}"><b>${s}</b><span>${lane.length}</span><small>${money(lane.reduce((a, o) => a + Number(o.amount || 0), 0))}</small></div>
        <div class="lane-body">${[...lane].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, LANE_MAX).map(o => `<a class="deal" href="#/opportunities/${esc(o.id)}" draggable="${canEdit()}" data-id="${esc(o.id)}"><b>${esc(o.name)}</b><span class="muted">${esc(o.accountName)}</span><strong>${money(o.amount)}</strong><span class="deal-foot">${avatar(o.owner)}<span>${esc(o.owner || '未分配')}</span><small>${o.expectedDate ? fmtDate(o.expectedDate) : ''}</small></span></a>`).join('') || '<div class="lane-empty">拖拽商机到此</div>'}${lane.length > LANE_MAX ? `<a class="lane-more" href="#/opportunities?view=list">还有 ${lane.length - LANE_MAX} 个（按金额显示前 ${LANE_MAX}），在列表中查看</a>` : ''}</div></div>`;
    }).join('')}</div>`;
  bindKanban();
}
function bindKanban() {
  let dragId = null;
  $$('.deal[draggable=true]').forEach(c => c.addEventListener('dragstart', e => { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); }));
  $$('.deal').forEach(c => c.addEventListener('dragend', () => c.classList.remove('dragging')));
  $$('.lane').forEach(l => {
    l.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); l.classList.add('over'); } });
    l.addEventListener('dragleave', () => l.classList.remove('over'));
    l.addEventListener('drop', async e => {
      e.preventDefault(); l.classList.remove('over');
      const id = dragId; dragId = null;
      if (!id || ui.oppCache?.get(id)?.stage === l.dataset.stage) return;
      try { await API.patch(`/opportunities/${id}`, { stage: l.dataset.stage }); toast(`已移至「${l.dataset.stage}」`); rerender(); } catch (err) { toast(err.message, true); }
    });
  });
}

async function pageOpportunity(id) {
  const { item: o } = await API.get(`/opportunities/${id}`);
  const ov = await API.get(`/accounts/${o.accountId}/overview`).catch(() => null);
  const contracts = ov ? ov.contracts.filter(c => c.opportunityId === id) : [];
  const flow = STAGES.filter(s => s !== '输单');
  const cur = flow.indexOf(o.stage);
  const tab = ui.tabs.opp?.id === id ? ui.tabs.opp.tab : 'info';
  ui.tabs.opp = { id, tab };
  const next = cur >= 0 && cur < flow.length - 1 ? flow[cur + 1] : null;
  $('#content').innerHTML = `
    <a class="back" href="#/opportunities">${icon('left')}返回商机列表</a>
    <section class="panel detail-hero">
      <span class="hero-ic purple">${icon('briefcase')}</span>
      <div class="hero-main"><h2>${esc(o.accountName)} - ${esc(o.name)} ${tag(o.stage)}</h2>
        <div class="facts"><span>预计金额：<b>${money(o.amount)}</b></span><span>成交概率：<b>${Number(o.probability || 0)}%</b></span><span>负责人：<b>${esc(o.owner || '未分配')}</b></span><span>预计成交：<b>${fmtDate(o.expectedDate)}</b></span></div></div>
      <div class="tools">${canEdit() ? `<button class="btn light" data-act="edit" data-type="opportunities" data-id="${esc(id)}">${icon('edit')}编辑</button>
        ${next ? `<button class="btn light" data-act="opp-advance" data-id="${esc(id)}" data-stage="${next}">推进到「${next}」</button>` : ''}
        ${o.stage !== '输单' && !contracts.some(c => c.status !== '已作废') ? `<button class="btn green" data-act="opp-contract" data-id="${esc(id)}">${icon('file')}转合同</button>` : ''}
        ${!['赢单', '输单'].includes(o.stage) ? `<button class="btn light danger" data-act="opp-advance" data-id="${esc(id)}" data-stage="输单">标记输单</button>` : ''}` : ''}</div>
    </section>
    <section class="panel">
      <ol class="steps">${flow.map((s, i) => `<li class="${o.stage === '输单' ? 'lost' : i < cur ? 'done' : i === cur ? 'cur' : ''}"><span>${i < cur || (i === cur && s === '赢单') ? icon('check') : i + 1}</span>${s}</li>`).join('')}</ol>
      ${o.stage === '输单' ? '<p class="center"><span class="tag red">该商机已输单</span></p>' : ''}
    </section>
    <section class="panel">
      <div class="tabs">${[['info', '基本信息'], ['activities', `跟进记录 ${ov?.activities.length || 0}`], ['contracts', `相关合同 ${contracts.length}`], ['files', '相关文件']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="opp-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="tab-pane">${tab === 'info' ? `<div class="kv-grid">${[['商机名称', o.name], ['客户', o.accountName], ['阶段', o.stage], ['预计金额', money(o.amount)], ['成交概率', `${Number(o.probability || 0)}%`], ['负责人', o.owner], ['预计成交日', fmtDate(o.expectedDate)], ['创建时间', fmtDateTime(o.createdAt)]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}${customKv('opportunities', o)}<div class="kv wide"><span>备注</span><b>${esc(o.notes || '—')}</b></div></div>`
        : tab === 'activities' ? `<div class="sub-head">${canEdit() ? `<button class="btn light small" data-act="create" data-type="activities" data-account="${esc(o.accountId)}">${icon('plus')}写跟进</button>` : ''}</div>${table('activities', LISTS.activities.cols.filter(c => c[0] !== 'accountId'), ov?.activities || [])}`
        : tab === 'files' ? await filesPane('opportunities', id)
        : table('contracts', LISTS.contracts.cols.filter(c => c[0] !== 'accountId'), contracts)}</div>
    </section>`;
}

// ======================= 合同 =======================
async function viewContract(id) {
  const { item: c } = await API.get(`/contracts/${id}`);
  const [{ items: pays }, { items: plans }] = await Promise.all([API.get(`/payments?contractId=${id}`), API.get(`/plans?contractId=${id}`)]);
  const got = pays.reduce((a, p) => a + Number(p.amount), 0);
  const ratio = c.amount ? Math.min(100, Math.round((got / c.amount) * 100)) : 0;
  const files = await filesPane('contracts', id);
  const levels = c.approvalLevels || [];
  const ACTION = { submit: '提交审批', approve: '通过', reject: '驳回', withdraw: '撤回' };
  const approvalHtml = levels.length || (c.approvalHistory || []).length ? `<h4 class="sec">审批流程</h4>
    ${levels.length ? `<ol class="steps small">${levels.map((l, i) => `<li class="${c.status === '审批中' ? (i < c.approvalStep ? 'done' : i === c.approvalStep ? 'cur' : '') : ['已签订', '执行中', '已完成'].includes(c.status) ? 'done' : ''}"><span>${i + 1}</span>${esc(l.name)}</li>`).join('')}</ol>` : ''}
    <ul class="timeline">${(c.approvalHistory || []).slice().reverse().map(h => `<li class="${h.action}"><b>${esc(h.byName)}</b> ${ACTION[h.action] || h.action}${h.level ? `（${esc(h.level)}）` : ''}<small>${fmtDateTime(h.at)}</small>${h.note ? `<p>${esc(h.note)}</p>` : ''}</li>`).join('')}</ul>` : '';
  openModal({
    title: `合同 ${c.number || ''}`, wide: true, readOnly: true,
    body: `<div class="kv-grid">${[['合同名称', c.name], ['客户', c.accountName], ['关联商机', c.opportunityName], ['合同金额', money(c.amount)], ['状态', c.status], ['签订日期', fmtDate(c.signedAt)], ['合同期限', c.startDate || c.endDate ? `${fmtDate(c.startDate)} ~ ${fmtDate(c.endDate)}` : ''], ['负责人', c.owner]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}
      ${customKv('contracts', c)}<div class="kv wide"><span>备注</span><b>${esc(c.notes || '—')}</b></div></div>${approvalHtml}
      <h4 class="sec">回款进度 <span class="muted small">已收 ${money(got)} / 应收 ${money(c.amount)}（${ratio}%）</span></h4><progress max="100" value="${ratio}"></progress>
      ${pays.length ? `<table class="mini"><thead><tr><th>到账日期</th><th>金额</th><th>方式</th><th>备注</th></tr></thead><tbody>${pays.map(p => `<tr><td>${fmtDate(p.paidAt)}</td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.notes || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">暂无回款记录</p>'}
      ${plans.length ? `<h4 class="sec">回款计划</h4><table class="mini"><thead><tr><th>计划日期</th><th>金额</th><th>状态</th></tr></thead><tbody>${plans.map(p => `<tr><td>${fmtDate(p.dueDate)}</td><td>${money(p.amount)}</td><td>${cell('plans', ['status', '', 'planStatus'], p)}</td></tr>`).join('')}</tbody></table>` : ''}
      <h4 class="sec">相关文件</h4>${files}`,
    footer: canEdit() ? `${c.status !== '已作废' && got < c.amount ? `<button type="button" class="btn light" data-act="pay-contract" data-id="${esc(id)}">登记回款</button>` : ''}${canApproveC(c) ? `<button type="button" class="btn" data-act="approve-contract" data-id="${esc(id)}">审批</button>` : ''}<button type="button" class="btn light" data-act="edit" data-type="contracts" data-id="${esc(id)}">编辑</button>` : '',
  });
}
async function approveModal(id) {
  const { item: c } = await API.get(`/contracts/${id}`);
  const levels = c.approvalLevels || [], lv = curLevel(c);
  openModal({
    title: `合同审批${lv ? ' · ' + lv.name : ''}`, submitText: '审批通过',
    body: `<p>合同：<b>${esc(`${c.number || ''} ${c.name}`)}</b>　金额：<b>${money(c.amount)}</b>　客户：<b>${esc(c.accountName)}</b></p>
      ${levels.length > 1 ? `<p class="muted small">共 ${levels.length} 级审批：${levels.map((l, i) => i === c.approvalStep ? `<b>${esc(l.name)}（当前）</b>` : esc(l.name)).join(' → ')}</p>` : ''}<label class="fld wide"><span>审批意见</span><textarea class="field" name="note" maxlength="500" placeholder="可选"></textarea></label>`,
    footer: '<button type="button" class="btn light danger" data-act="reject-contract">驳回</button>',
    onSubmit: async fd => { const r = await API.post(`/contracts/${id}/approve`, { approved: true, note: fd.get('note') }); toast(r.pending ? `已通过，流转至「${r.pending.name}」` : '审批通过，合同已签订'); rerender(); },
  }).dataset.contract = id;
}

// ======================= 财务回款 =======================
async function pageFinance() {
  const f = await API.get('/finance');
  const tab = ui.tabs.finance || 'payments';
  const t = f.totals;
  $('#content').innerHTML = pageHead('财务回款', '应收 / 实收、回款计划与应收账款') + `
    <div class="kpis">
      <div class="kpi blue"><span class="kpi-ic">${icon('file')}</span><div><div class="kpi-l">应收金额</div><div class="kpi-v">${money(t.receivable)}</div><div class="kpi-c muted">不含已作废合同</div></div></div>
      <div class="kpi green"><span class="kpi-ic">${icon('wallet')}</span><div><div class="kpi-l">已收金额</div><div class="kpi-v">${money(t.received)}</div><div class="kpi-c muted">回款率 ${t.receivable ? Math.round((t.received / t.receivable) * 1000) / 10 : 0}%</div></div></div>
      <div class="kpi red"><span class="kpi-ic">${icon('alert')}</span><div><div class="kpi-l">欠款金额</div><div class="kpi-v">${money(t.outstanding)}</div><div class="kpi-c muted">应收 - 已收</div></div></div>
      <div class="kpi orange"><span class="kpi-ic">${icon('calendar')}</span><div><div class="kpi-l">逾期计划</div><div class="kpi-v">${money(t.overdue)}</div><div class="kpi-c muted">计划日期已过且未回款</div></div></div>
    </div>
    <section class="panel"><div class="tabs">${[['payments', '回款记录'], ['plans', '回款计划'], ['receivables', '应收账款'], ['statements', '对账单']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="finance-tab" data-tab="${k}">${l}</button>`).join('')}</div><div id="financeBody"></div></section>`;
  const body = $('#financeBody');
  if (tab === 'statements') { ui.list = null; return renderStatement(body); }
  if (tab === 'receivables') {
    ui.list = null;
    body.innerHTML = f.contracts.length ? `<div class="tbl-wrap"><table><thead><tr><th>合同编号</th><th>合同名称</th><th>客户</th><th>合同金额</th><th>已收</th><th>未收</th><th>回款进度</th><th>状态</th><th class="ops">操作</th></tr></thead><tbody>
      ${f.contracts.map(c => `<tr><td><b>${esc(c.number)}</b></td><td>${esc(c.name)}</td><td><a class="link" href="#/accounts/${esc(c.accountId)}">${esc(c.accountName)}</a></td><td>${money(c.amount)}</td><td>${money(c.received)}</td><td class="${c.outstanding > 0 ? 'neg' : ''}">${money(c.outstanding)}</td><td><progress max="100" value="${c.amount ? Math.round((c.received / c.amount) * 100) : 0}"></progress></td><td>${tag(c.status)}</td><td class="ops"><div class="row-actions"><button class="textbtn" data-act="view-contract" data-id="${esc(c.id)}">查看</button>${canEdit() && c.outstanding > 0 ? `<button class="textbtn" data-act="pay-contract" data-id="${esc(c.id)}">登记回款</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${icon('file')}<p>暂无合同</p></div>`;
  } else await mountList(body, tab);
}

async function renderStatement(body) {
  const st = ui.tabs.stmt ||= { accountId: '', from: `${new Date().getFullYear()}-01-01`, to: ymd() };
  const q = new URLSearchParams({ from: st.from, to: st.to }); if (st.accountId) q.set('accountId', st.accountId);
  const r = await API.get('/statements?' + q);
  const s0 = r.summary[0];
  body.innerHTML = `<div class="toolbar"><div class="filters">
      <label class="filter"><span>客户</span>${remoteSelect('account', 'id="stAccount"', st.accountId, '全部客户（汇总）')}</label>
      <label class="range"><input class="field slim" type="date" id="stFrom" value="${st.from}"> ~ <input class="field slim" type="date" id="stTo" value="${st.to}"></label>
      <button class="btn light" data-act="stmt-query">查询</button></div>
      <div class="tools">${canEdit() ? `<button class="btn light" data-act="stmt-export">${icon('download')}导出</button>` : ''}<button class="btn light" data-act="print">${icon('print')}打印</button></div></div>
    <div class="statement">
      <h3 class="center">${esc(settings.companyName)} · ${st.accountId ? esc(s0?.accountName || '') + ' 往来对账单' : '客户往来对账汇总'}</h3>
      <p class="center muted">对账期间：${r.from} 至 ${r.to}　　单位：元</p>
      ${st.accountId ? `<div class="tbl-wrap plain"><table><thead><tr><th>日期</th><th>类型</th><th>单据</th><th class="num">应收增加</th><th class="num">回款</th><th class="num">余额</th></tr></thead><tbody>
        <tr class="sum"><td>${r.from}</td><td>期初余额</td><td></td><td></td><td></td><td class="num">${money(s0.opening)}</td></tr>
        ${r.lines.map(l => `<tr><td>${l.date}</td><td>${l.kind}</td><td>${esc(l.ref)}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td><td class="num">${money(l.balance)}</td></tr>`).join('')}
        <tr class="sum"><td>${r.to}</td><td>本期合计 / 期末余额</td><td></td><td class="num">${money(s0.debit)}</td><td class="num">${money(s0.credit)}</td><td class="num"><b>${money(s0.closing)}</b></td></tr>
      </tbody></table></div><div class="sign"><span>客户确认（盖章）：</span><span>${esc(settings.companyName)}（盖章）：</span></div>`
      : `<div class="tbl-wrap plain"><table><thead><tr><th>客户</th><th class="num">期初余额</th><th class="num">本期应收</th><th class="num">本期回款</th><th class="num">期末余额</th><th class="ops"></th></tr></thead><tbody>
        ${r.summary.map(x => `<tr><td><b>${esc(x.accountName)}</b></td><td class="num">${money(x.opening)}</td><td class="num">${money(x.debit)}</td><td class="num">${money(x.credit)}</td><td class="num ${x.closing > 0 ? 'neg' : ''}">${money(x.closing)}</td><td class="ops"><button class="textbtn" data-act="stmt-account" data-id="${esc(x.accountId)}">明细</button></td></tr>`).join('') || '<tr><td colspan="6" class="center muted">期间内无往来</td></tr>'}
        <tr class="sum"><td>合计</td><td class="num">${money(r.totals.opening)}</td><td class="num">${money(r.totals.debit)}</td><td class="num">${money(r.totals.credit)}</td><td class="num">${money(r.totals.closing)}</td><td></td></tr></tbody></table></div>`}
      <p class="muted small">口径：应收 = 已生效合同金额（按签订日期），回款按到账日期；不含草稿与作废合同。</p></div>`;
  initRemoteSelects(body);
}

// ======================= 任务 =======================
async function pageTasks(r) {
  const tabs = [['全部', {}], ['待处理', { status: '待处理' }], ['进行中', { status: '进行中' }], ['已完成', { status: '已完成' }], ['已逾期', { overdue: '1' }], ['今日/逾期', { due: '1' }]];
  const idx = r.params.get('view') === 'due' ? 5 : 0;
  $('#content').innerHTML = pageHead('跟进任务', '任务列表、提醒与完成状态') + '<div id="listHost"></div>';
  await mountList($('#listHost'), 'tasks', { tabs, tab: idx, q: r.params.get('q') || '' });
}

// ======================= 数据报表 =======================
async function pageReports() {
  const rr = ui.tabs.reports || {};
  const q = new URLSearchParams(); if (rr.from) q.set('from', rr.from); if (rr.to) q.set('to', rr.to);
  const d = await API.get('/reports?' + q);
  ui.tabs.reports = { from: d.from, to: d.to };
  const s = d.summary;
  const maxStage = Math.max(1, ...d.stages.map(x => x.count));
  const maxOwner = Math.max(1, ...d.owners.map(x => x.amount));
  $('#content').innerHTML = pageHead('数据报表', '销售业绩、客户分析、商机分析与回款分析',
    `<label class="range"><input class="field slim" type="date" id="rFrom" value="${d.from}"> ~ <input class="field slim" type="date" id="rTo" value="${d.to}"></label><button class="btn light" data-act="report-query">查询</button>${canEdit() ? `<button class="btn" data-act="report-export">${icon('download')}导出</button>` : ''}`) + `
    <div class="kpis">
      <div class="kpi blue"><span class="kpi-ic">${icon('users')}</span><div><div class="kpi-l">新增客户</div><div class="kpi-v">${s.newAccounts}</div><div class="kpi-c">较上期 ${changeBadge(s.newAccountsChange)}</div></div></div>
      <div class="kpi green"><span class="kpi-ic">${icon('file')}</span><div><div class="kpi-l">成交金额</div><div class="kpi-v">${money(s.contractAmount)}</div><div class="kpi-c">较上期 ${changeBadge(s.contractAmountChange)}</div></div></div>
      <div class="kpi purple"><span class="kpi-ic">${icon('target')}</span><div><div class="kpi-l">线索转化率</div><div class="kpi-v">${s.conversionRate}%</div><div class="kpi-c">较上期 ${changeBadge(s.conversionRateChange, 'pp')}</div></div></div>
      <div class="kpi orange"><span class="kpi-ic">${icon('coins')}</span><div><div class="kpi-l">回款金额</div><div class="kpi-v">${money(s.payments)}</div><div class="kpi-c">较上期 ${changeBadge(s.paymentsChange)}</div></div></div>
    </div>
    <div class="grid g-trend">
      <section class="panel"><div class="panel-head"><h3>成交金额趋势（元）</h3></div>${barChart(d.months.map(m => ({ ...m, label: m.label.slice(2) })))}</section>
      <section class="panel"><div class="panel-head"><h3>客户来源</h3></div>${donut(d.accountSources, '客户')}</section>
    </div>
    <div class="grid g-three">
      <section class="panel"><div class="panel-head"><h3>商机阶段分布</h3><span class="muted small">赢单率 ${s.winRate}%</span></div>
        <ul class="hbars">${d.stages.map((x, i) => `<li><span>${esc(x.stage)}</span><meter class="s${i}" min="0" max="${maxStage}" value="${x.count}"></meter><b>${x.count}</b></li>`).join('')}</ul></section>
      <section class="panel"><div class="panel-head"><h3>销售业绩排行</h3></div>
        ${d.owners.length ? `<ul class="hbars">${d.owners.slice(0, 8).map(x => `<li><span>${esc(x.name)}</span><meter min="0" max="${maxOwner}" value="${x.amount}"></meter><b>${moneyShort(x.amount)}</b></li>`).join('')}</ul>` : '<div class="empty small">区间内暂无成交</div>'}</section>
      <section class="panel"><div class="panel-head"><h3>行业分布</h3></div>${donut(d.accountIndustries, '客户')}</section>
    </div>
    <section class="panel"><div class="panel-head"><h3>月度明细</h3></div><div class="tbl-wrap plain"><table><thead><tr><th>月份</th><th>成交金额</th><th>回款金额</th><th>新增客户</th></tr></thead><tbody>${d.months.map(m => `<tr><td>${m.label}</td><td>${money(m.contractAmount)}</td><td>${money(m.payments)}</td><td>${m.newAccounts}</td></tr>`).join('')}</tbody></table></div></section>`;
}

// ======================= 团队 =======================
async function pageTeam() {
  const items = R.users;
  $('#content').innerHTML = pageHead('团队管理', '成员、部门、角色与权限', isAdmin() ? `<button class="btn" data-act="user-create">${icon('plus')}新增成员</button>` : '') + `
    <section class="panel flush"><div class="tbl-wrap"><table><thead><tr><th>姓名</th>${canManage() ? '<th>账号</th>' : ''}<th>部门</th><th>角色</th>${canManage() ? '<th>数据范围</th><th>两步验证</th>' : ''}<th>状态</th>${canManage() ? '<th>最近登录</th>' : ''}${isAdmin() ? '<th class="ops">操作</th>' : ''}</tr></thead><tbody>
      ${items.map(u => `<tr><td><span class="who">${avatar(u.name, 'blue')}<b>${esc(u.name)}</b>${u.id === me.id ? '<span class="tag gray">我</span>' : ''}</span></td>${canManage() ? `<td>${esc(u.email)}</td>` : ''}<td>${esc(u.department || '—')}</td><td><span class="tag ${u.role === 'admin' ? 'red' : u.role === 'manager' ? 'orange' : u.role === 'sales' ? 'blue' : 'gray'}">${ROLE_LABEL[u.role]}</span></td>${canManage() ? `<td>${SCOPE_LABEL[u.dataScope] || '—'}</td><td>${u.mfaEnabled ? '<span class="tag green">已启用</span>' : '<span class="muted">未启用</span>'}</td>` : ''}<td><span class="dot ${u.active ? 'on' : 'off'}"></span>${u.active ? '正常' : '停用'}</td>${canManage() ? `<td>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>` : ''}${isAdmin() ? `<td class="ops"><div class="row-actions"><button class="textbtn" data-act="user-edit" data-id="${esc(u.id)}">编辑</button>${u.mfaEnabled && u.id !== me.id ? `<button class="textbtn" data-act="user-mfa-reset" data-id="${esc(u.id)}">重置验证</button>` : ''}${u.id !== me.id ? `<button class="textbtn ${u.active ? 'danger' : ''}" data-act="user-toggle" data-id="${esc(u.id)}">${u.active ? '停用' : '启用'}</button>` : ''}</div></td>` : ''}</tr>`).join('')}
    </tbody></table></div></section>
    <section class="panel"><h3>角色权限说明</h3><div class="tbl-wrap plain"><table><thead><tr><th>角色</th><th>查看</th><th>新增/编辑</th><th>删除</th><th>合同审批</th><th>导出</th><th>审计日志</th><th>成员与系统设置</th></tr></thead><tbody>
      ${[['管理员', 1, 1, 1, 1, 1, 1, 1], ['销售经理', 1, 1, 1, 1, 1, 1, 0], ['销售', 1, 1, 0, 0, 1, 0, 0], ['只读', 1, 0, 0, 0, 0, 0, 0]].map(([n, ...f]) => `<tr><td><b>${n}</b></td>${f.map(v => `<td>${v ? '<span class="ok">✓</span>' : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="muted small">数据范围：<b>仅本人</b>＝自己负责的线索、客户及其下的商机/合同/回款/跟进；<b>本部门</b>＝同部门成员负责的数据；<b>全部数据</b>＝租户内全部。默认：销售为仅本人，其余角色为全部。</p></section>`;
}
function userModal(u = null) {
  const deptOpts = optionList('dict:departments', u?.department || '', '请选择');
  openModal({
    title: u ? '编辑成员' : '新增成员', wide: true,
    body: `<div class="form-grid">
      <label class="fld"><span>姓名 <i class="req">*</i></span><input class="field" name="name" required maxlength="100" value="${esc(u?.name || '')}"></label>
      <label class="fld"><span>登录邮箱 <i class="req">*</i></span><input class="field" name="email" type="email" ${u ? 'disabled' : 'required'} value="${esc(u?.email || '')}"></label>
      <label class="fld"><span>部门</span><select class="field" name="department">${deptOpts}</select></label>
      <label class="fld"><span>角色</span><select class="field" name="role" ${u?.id === me.id ? 'disabled' : ''}>${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${(u?.role || 'sales') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld"><span>数据范围</span><select class="field" name="dataScope"><option value="">按角色默认</option>${Object.entries(SCOPE_LABEL).map(([k, l]) => `<option value="${k}" ${u?.dataScopeSet === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld wide"><span>${u ? '重置密码（留空不修改，至少12位）' : '初始密码（至少12位）'} ${u ? '' : '<i class="req">*</i>'}</span><input class="field" name="password" type="password" minlength="12" autocomplete="new-password" ${u ? '' : 'required'}></label></div>`,
    onSubmit: async fd => {
      const body = Object.fromEntries(fd);
      if (u) { if (u.id === me.id) delete body.role; await API.patch(`/users/${u.id}`, body); } else await API.post('/users', body);
      toast('已保存'); rerender();
    },
  });
}

// ======================= 两步验证 =======================
function mfaModal() {
  const enabled = me.mfaEnabled;
  const dlg = openModal({
    title: '两步验证（TOTP）', submitText: enabled ? '关闭两步验证' : '完成绑定',
    body: enabled
      ? `<p><span class="tag green">已启用</span> 登录时需输入身份验证器中的动态码。</p><p class="muted small">如需关闭，请输入登录密码和当前动态码。</p>
         <label class="fld wide"><span>登录密码</span><input class="field" type="password" name="password" required autocomplete="current-password"></label>
         <label class="fld wide"><span>动态码</span><input class="field" name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>`
      : `<p>启用后，登录除密码外还需输入手机身份验证器生成的 6 位动态码，可有效防止密码泄露导致的账号被盗。</p><button type="button" class="btn" data-act="mfa-start">${icon('shield')}开始设置</button>`,
    onSubmit: async fd => {
      if (enabled) { await API.post('/mfa/disable', { password: fd.get('password'), code: fd.get('code') }); me.mfaEnabled = false; toast('已关闭两步验证'); }
      else { await API.post('/mfa/enable', { code: fd.get('code') }); me.mfaEnabled = true; toast('两步验证已启用'); }
      $('#shell')?.remove(); rerender();
    },
  });
  if (!enabled) dlg.querySelector('[type=submit]').hidden = true;
}

// ======================= 系统设置 =======================
const DICT_LABEL = { leadSources: '线索/客户来源', accountTypes: '客户类型', accountLevels: '客户级别', accountStatus: '客户状态', industries: '行业', activityTypes: '跟进方式', activityResults: '跟进结果', paymentMethods: '付款方式', departments: '部门' };
async function pageSettings() {
  const tabs = isAdmin() ? [['basic', '基础设置'], ['dicts', '数据字典'], ['fields', '字段管理'], ['approval', '审批与通知'], ['audits', '审计日志'], ['about', '安全与运维']] : [['audits', '审计日志'], ['fields', '字段管理'], ['about', '安全与运维']];
  let tab = ui.tabs.settings; if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  ui.tabs.settings = tab;
  let pane = '';
  if (tab === 'basic') {
    pane = `<form id="basicForm" class="settings-form"><label class="fld"><span>系统名称</span><input class="field" name="systemName" maxlength="60" value="${esc(settings.systemName)}"></label>
      <label class="fld"><span>公司名称</span><input class="field" name="companyName" maxlength="60" value="${esc(settings.companyName)}"></label>
      <div class="fld"><span>系统 Logo</span><div class="logo-preview">${settings.logo ? `<img class="logo img" src="/api/settings/logo?v=${Date.now()}" alt="">` : '<span class="logo">N</span>'}
        <label class="btn light small">${icon('upload')}上传<input type="file" hidden accept="image/png,image/jpeg,image/webp" data-act-change="logo"></label>${settings.logo ? '<button type="button" class="btn light small danger" data-act="logo-del">移除</button>' : ''}<small class="muted">PNG/JPG/WebP，≤512KB，建议正方形</small></div></div>
      <div><button class="btn" type="submit">保存</button></div></form>`;
  } else if (tab === 'dicts') {
    pane = `<form id="dictForm"><p class="muted">每行一个选项；修改后新建/编辑表单立即生效，历史数据保留原值。</p><div class="dict-grid">${Object.entries(DICT_LABEL).map(([k, l]) => `<label class="fld"><span>${l}</span><textarea class="field" name="${k}" rows="6">${esc(dict(k).join('\n'))}</textarea></label>`).join('')}</div><div><button class="btn" type="submit">保存字典</button></div></form>`;
  } else if (tab === 'approval') {
    const ap = ui.apDraft ||= structuredClone(settings.approval.levels);
    const w = settings.webhook || {};
    pane = `<form id="approvalForm"><h4>合同审批级别</h4><p class="muted small">合同金额 ≥ 阈值的级别都需要依次审批；管理员可审批任意级别，提交人不能审批自己的合同。</p>
      <div class="tbl-wrap plain"><table class="mini edit"><thead><tr><th>顺序</th><th>级别名称</th><th>审批角色</th><th>金额阈值（元，≥）</th><th></th></tr></thead><tbody>
      ${ap.map((l, i) => `<tr><td>${i + 1}</td><td><input class="field slim" data-ap="${i}" data-prop="name" value="${esc(l.name)}" maxlength="30"></td><td><select class="field slim" data-ap="${i}" data-prop="role"><option value="manager" ${l.role === 'manager' ? 'selected' : ''}>销售经理</option><option value="admin" ${l.role === 'admin' ? 'selected' : ''}>管理员</option></select></td><td><input class="field slim" type="number" min="0" step="0.01" data-ap="${i}" data-prop="minAmount" value="${l.minAmount}"></td><td>${ap.length > 1 ? `<button type="button" class="textbtn danger" data-act="ap-del" data-i="${i}">删除</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="tools">${ap.length < 5 ? '<button type="button" class="btn light small" data-act="ap-add">新增级别</button>' : ''}<button class="btn" type="submit">保存审批设置</button></div></form>
      <form id="webhookForm" class="settings-form"><h4 class="sec">群机器人通知</h4>
        <label class="fld"><span>类型</span><select class="field" name="kind">${[['wecom', '企业微信群机器人'], ['dingtalk', '钉钉群机器人'], ['generic', '通用 JSON']].map(([k, l]) => `<option value="${k}" ${w.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fld"><span>Webhook 地址（https）</span><input class="field" name="url" value="${esc(w.url || '')}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"></label>
        <div class="fld"><span>推送事件</span><div class="checks">${[['approval', '合同审批（待审批/结果）'], ['assign', '分配负责人']].map(([k, l]) => `<label class="check"><input type="checkbox" name="events" value="${k}" ${(w.events || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div class="tools"><button class="btn" type="submit">保存通知设置</button>${w.url ? '<button type="button" class="btn light" data-act="webhook-test">发送测试消息</button>' : ''}</div>
        <p class="muted small">钉钉机器人如开启“加签”，请改用“自定义关键词”安全设置（关键词可填系统名称）。站内通知无需配置，顶部铃铛即可查看。</p></form>`;
  } else if (tab === 'fields') {
    const CF_ENT = ['leads', 'accounts', 'contacts', 'opportunities', 'contracts'];
    const cf = ui.cfDraft ||= structuredClone(settings.customFields || {});
    const typeOpts = v => [['text', '单行文本'], ['textarea', '多行文本'], ['number', '数字'], ['date', '日期'], ['select', '下拉选项']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
    pane = (isAdmin() ? `<form id="cfForm"><h4>自定义字段</h4><p class="muted small">新增字段会出现在新建/编辑表单、详情、CSV 导出与导入模板中；勾选“列表显示”后在列表中显示。删除字段不会删除历史数据。</p>
      ${CF_ENT.map(ent => `<div class="cf-block"><div class="panel-head"><b>${ENTITY_LABEL[ent]}</b><button type="button" class="btn light small" data-act="cf-add" data-ent="${ent}">${icon('plus')}新增字段</button></div>
        ${(cf[ent] || []).length ? `<div class="tbl-wrap plain"><table class="mini edit"><thead><tr><th>字段名称</th><th>类型</th><th>下拉选项（逗号分隔）</th><th>必填</th><th>列表显示</th><th></th></tr></thead><tbody>${cf[ent].map((f, i) => `<tr>
          <td><input class="field slim" data-cf="${ent}" data-i="${i}" data-prop="label" value="${esc(f.label)}" maxlength="30" placeholder="如：统一社会信用代码"></td>
          <td><select class="field slim" data-cf="${ent}" data-i="${i}" data-prop="type">${typeOpts(f.type)}</select></td>
          <td><input class="field slim" data-cf="${ent}" data-i="${i}" data-prop="options" value="${esc((f.options || []).join(','))}" ${f.type === 'select' ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-cf="${ent}" data-i="${i}" data-prop="required" ${f.required ? 'checked' : ''}></td>
          <td><input type="checkbox" data-cf="${ent}" data-i="${i}" data-prop="inList" ${f.inList ? 'checked' : ''}></td>
          <td><button type="button" class="textbtn danger" data-act="cf-del" data-ent="${ent}" data-i="${i}">删除</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">暂无自定义字段</p>'}</div>`).join('')}
      <div class="tools"><button class="btn" type="submit">保存字段配置</button><button type="button" class="btn light" data-act="cf-reset">放弃修改</button></div></form><h4 class="sec">内置字段</h4>` : '') + `<p class="muted">系统内置字段如下。</p>${Object.entries(FORMS).map(([type, fields]) => `<h4 class="sec">${ENTITY_LABEL[type]}</h4><div class="tbl-wrap plain"><table class="mini"><thead><tr><th>字段名</th><th>字段键</th><th>类型</th><th>必填</th><th>状态</th></tr></thead><tbody>${fields.map(([k, l, kind = 'text', req]) => `<tr><td>${esc(l.replace(/（.*?）/, ''))}</td><td><code>${k}</code></td><td>${Array.isArray(kind) ? '下拉' : String(kind).startsWith('dict:') ? '下拉（字典）' : { text: '文本', textarea: '多行文本', money: '金额', percent: '百分比', date: '日期', datetime: '日期时间', account: '关联客户', contract: '关联合同', opportunity: '关联商机', user: '成员', checkbox: '开关', tel: '电话', email: '邮箱', contractStatus: '下拉' }[kind] || kind}</td><td>${req ? '是' : '否'}</td><td><span class="dot on"></span>启用</td></tr>`).join('')}</tbody></table></div>`).join('')}`;
  } else if (tab === 'audits') {
    const { items } = await API.get('/audits');
    pane = items.length ? `<div class="tbl-wrap plain"><table><thead><tr><th>时间</th><th>操作人</th><th>行为</th><th>对象</th><th>记录编号</th></tr></thead><tbody>${items.map(x => `<tr><td>${fmtDateTime(x.at)}</td><td>${esc(x.user_name || '—')}</td><td>${tag(ACTION_LABEL[x.action] || x.action)}</td><td>${esc(ENTITY_LABEL[x.entity] || x.entity)}</td><td><code>${esc(x.entity_id.slice(0, 8))}</code></td></tr>`).join('')}</tbody></table></div><p class="muted small">显示最近 300 条。</p>` : '<div class="empty">暂无审计日志</div>';
  } else {
    const h = await API.get('/health');
    const bk = isAdmin() ? await API.get('/backups') : null;
    pane = (bk ? `<div class="panel-head"><h4>数据备份</h4><button class="btn small" data-act="backup-now">${icon('download')}立即备份</button></div>
      <p class="muted small">自动备份：${bk.schedule.intervalHours > 0 ? `每 ${bk.schedule.intervalHours} 小时一次` : '已关闭'}，保留最近 ${bk.schedule.keep} 份；快照位于数据目录 backups/。恢复需停服后执行 <code>node scripts/restore.js &lt;快照&gt; --yes</code>。</p>
      ${bk.items.length ? `<div class="tbl-wrap plain"><table class="mini"><thead><tr><th>快照文件</th><th>大小</th><th>时间</th></tr></thead><tbody>${bk.items.map(b => `<tr><td><code>${esc(b.name)}</code></td><td>${(b.size / 1024).toFixed(0)} KB</td><td>${fmtDateTime(b.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无备份</p>'}<h4 class="sec">安全配置</h4>` : '') + `<div class="kv-grid">${[['系统版本', 'V' + h.version], ['数据存储', 'SQLite（WAL）'], ['会话有效期', '8 小时，HttpOnly + SameSite Cookie'], ['密码策略', '≥12 位、至少 3 类字符、不含账号名；scrypt 加盐散列'], ['登录保护', '同账号 15 分钟内失败 5 次锁定（持久化）'], ['两步验证', 'TOTP 动态码，用户可自助启用，管理员可重置'], ['访问日志', 'ACCESS_LOG=1 输出 JSON 行日志，含请求 ID'], ['数据权限', '按成员“数据范围”控制（本人/本部门/全部）'], ['金额存储', '整数“分”，避免浮点误差']].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  }
  $('#content').innerHTML = pageHead('系统设置', '基础设置、数据字典、字段与审计日志') + `<section class="panel settings"><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="settings-tab" data-tab="${k}">${l}</button>`).join('')}</div><div class="tab-pane">${pane}</div></section>`;
  $('#cfForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { settings = (await API.put('/settings', { customFields: ui.cfDraft })).settings; ui.cfDraft = null; toast('字段配置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#approvalForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { settings = (await API.put('/settings', { approval: { levels: ui.apDraft } })).settings; ui.apDraft = null; toast('审批设置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#webhookForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try { settings = (await API.put('/settings', { webhook: { url: fd.get('url'), kind: fd.get('kind'), events: fd.getAll('events') } })).settings; toast('通知设置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#basicForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { settings = (await API.put('/settings', Object.fromEntries(new FormData(e.currentTarget)))).settings; toast('设置已保存'); $('#shell')?.remove(); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#dictForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget), dicts = {};
    for (const k of Object.keys(DICT_LABEL)) dicts[k] = String(fd.get(k) || '').split('\n').map(s => s.trim()).filter(Boolean);
    try { settings = (await API.put('/settings', { dicts })).settings; toast('数据字典已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
}

// ======================= 事件委托 =======================
const ACTIONS = {
  'toggle-nav': () => { if (matchMedia('(max-width: 900px)').matches) document.body.classList.toggle('nav-open'); else { ui.collapsed = !ui.collapsed; $('#shell').classList.toggle('collapsed', ui.collapsed); } },
  'close-nav': () => document.body.classList.remove('nav-open'),
  'toggle-group': t => { const g = t.dataset.group; ui.openGroups.has(g) ? ui.openGroups.delete(g) : ui.openGroups.add(g); t.parentElement.classList.toggle('open'); if (ui.collapsed) { ui.collapsed = false; $('#shell').classList.remove('collapsed'); } },
  'user-menu': () => { const d = $('#userDropdown'); d.hidden = !d.hidden; },
  logout: async () => { try { await API.post('/logout'); } catch { /* ignore */ } me = null; renderLogin(); },
  password: () => openModal({
    title: '修改登录密码',
    body: '<label class="fld wide"><span>当前密码</span><input class="field" name="oldPassword" type="password" required autocomplete="current-password"></label><label class="fld wide"><span>新密码（至少12位）</span><input class="field" name="newPassword" type="password" minlength="12" required autocomplete="new-password"></label>',
    onSubmit: async fd => { await API.post('/password', Object.fromEntries(fd)); me = null; toast('密码已修改，请重新登录'); renderLogin(); },
  }),
  create: t => editRecord(t.dataset.type, null, t.dataset.account ? { accountId: t.dataset.account } : {}),
  edit: t => { document.querySelector('dialog.modal')?.close(); editRecord(t.dataset.type, t.dataset.id); },
  view: t => viewRecord(t.dataset.type, t.dataset.id),
  delete: async t => { await deleteRecord(t.dataset.type, t.dataset.id); if (t.dataset.type === 'accounts' && parseRoute().id) go('#/accounts'); },
  assign: t => assignModal(t.dataset.type, [t.dataset.id]),
  convert: async t => {
    if (!await confirmBox('将该线索转换为客户？系统会创建客户档案（及主联系人），转换后不可再次转换。', '确认转换', false)) return;
    try { const r = await API.post(`/leads/${t.dataset.id}/convert`); toast('线索已转为客户'); go(`#/accounts/${r.accountId}`); } catch (e) { toast(e.message, true); }
  },
  'view-contract': t => viewContract(t.dataset.id),
  'pay-contract': t => { document.querySelector('dialog.modal')?.close(); editRecord('payments', null, { contractId: t.dataset.id }); },
  'submit-contract': async t => { try { await API.post(`/contracts/${t.dataset.id}/submit`); toast('已提交审批'); rerender(); } catch (e) { toast(e.message, true); } },
  'approve-contract': t => approveModal(t.dataset.id),
  'reject-contract': async t => {
    const dlg = t.closest('dialog'), id = dlg.dataset.contract, note = dlg.querySelector('[name=note]').value;
    try { await API.post(`/contracts/${id}/approve`, { approved: false, note }); dlg.close(); toast('已驳回，合同退回草稿'); rerender(); } catch (e) { toast(e.message, true); }
  },
  'plan-paid': async t => {
    const { item: p } = await API.get(`/plans/${t.dataset.id}`);
    openModal({
      title: '确认回款', submitText: '登记回款并完成计划',
      body: `<p class="muted">将按计划登记一笔回款，并把该计划标记为“已回款”。</p><div class="form-grid">${fieldControl('payments', ['amount', '回款金额（元）', 'money', 1], { amount: p.amount })}${fieldControl('payments', ['paidAt', '到账日期', 'date'], { paidAt: ymd() })}${fieldControl('payments', ['method', '付款方式', 'dict:paymentMethods'], {})}</div>`,
      onSubmit: async fd => {
        await API.post('/payments', { contractId: p.contractId, amount: Number(fd.get('amount')), paidAt: fd.get('paidAt'), method: fd.get('method'), notes: `回款计划 ${p.dueDate}` });
        await API.patch(`/plans/${p.id}`, { status: '已回款' });
        toast('已登记回款'); rerender();
      },
    });
  },
  'toggle-task': async t => {
    const id = t.dataset.id;
    try { const { item } = await API.get(`/tasks/${id}`); await API.patch(`/tasks/${id}`, { status: item.status === '已完成' ? '待处理' : '已完成' }); toast(item.status === '已完成' ? '任务已重新打开' : '任务已完成'); rerender(); } catch (e) { toast(e.message, true); }
  },
  'dash-range': t => { ui.dashRange = t.dataset.range; pageDashboard().catch(e => toast(e.message, true)); },
  'opp-view': t => { ui.oppView = t.dataset.view; go('#/opportunities'); },
  'opp-advance': async t => { try { await API.patch(`/opportunities/${t.dataset.id}`, { stage: t.dataset.stage }); toast(`阶段已更新为「${t.dataset.stage}」`); rerender(); } catch (e) { toast(e.message, true); } },
  'opp-contract': async t => {
    if (!await confirmBox('根据该商机生成合同草稿，并将商机标记为“赢单”？', '生成合同', false)) return;
    try { const r = await API.post(`/opportunities/${t.dataset.id}/contract`); toast(`已生成合同 ${r.item.number}`); go('#/contracts?q=' + encodeURIComponent(r.item.number)); } catch (e) { toast(e.message, true); }
  },
  'account-tab': t => { ui.tabs.account.tab = t.dataset.tab; rerender(); },
  'opp-tab': t => { ui.tabs.opp.tab = t.dataset.tab; rerender(); },
  'finance-tab': t => { ui.tabs.finance = t.dataset.tab; rerender(); },
  'settings-tab': t => { ui.tabs.settings = t.dataset.tab; rerender(); },
  'list-tab': t => { const L = ui.list; L.tab = Number(t.dataset.i); L.page = 1; L.selected.clear(); $$('.tabs .tab', L.container).forEach((b, i) => b.classList.toggle('on', i === L.tab)); loadList(); },
  page: t => { ui.list.page = Number(t.dataset.page); loadList(); },
  'select-all': t => { const L = ui.list; L.items.forEach(x => (t.checked ? L.selected.add(x.id) : L.selected.delete(x.id))); $$('[data-act=select-row]', L.container).forEach(c => { c.checked = t.checked; }); updateBatchBar(); },
  'select-row': t => { const L = ui.list; t.checked ? L.selected.add(t.dataset.id) : L.selected.delete(t.dataset.id); updateBatchBar(); },
  'batch-assign': () => assignModal(ui.list.type, [...ui.list.selected]),
  'batch-delete': async () => {
    const L = ui.list;
    if (!await confirmBox(`确认删除选中的 ${L.selected.size} 条${ENTITY_LABEL[L.type]}？存在关联数据的记录将被跳过。`, '批量删除')) return;
    try { const r = await API.post(`/${L.type}/batch`, { action: 'delete', ids: [...L.selected] }); toast(`已删除 ${r.done.length} 条${r.failed.length ? `，${r.failed.length} 条因存在关联数据未删除` : ''}`, !!r.failed.length); L.selected.clear(); rerender(); } catch (e) { toast(e.message, true); }
  },
  export: () => { const L = ui.list; location.href = `/api/${L.type}?${listParams(L, false)}&format=csv`; },
  'report-query': () => { ui.tabs.reports = { from: $('#rFrom').value, to: $('#rTo').value }; rerender(); },
  'report-export': () => { location.href = `/api/reports?from=${encodeURIComponent($('#rFrom').value)}&to=${encodeURIComponent($('#rTo').value)}&format=csv`; },
  'user-create': () => userModal(),
  mfa: () => mfaModal(),
  'mfa-start': async t => {
    const r = await API.post('/mfa/setup');
    const box = t.closest('.modal-body');
    box.innerHTML = `<ol class="howto"><li>在手机上打开身份验证器 App（Google/Microsoft Authenticator、腾讯身份验证器等），选择“手动输入密钥”。</li>
      <li>账号填写 <b>${esc(me.email)}</b>，密钥填写：<div class="secret">${esc(r.secret.match(/.{1,4}/g).join(' '))}</div>类型选“基于时间”。</li>
      <li>输入 App 中显示的 6 位动态码完成绑定。</li></ol>
      <details><summary class="muted small">otpauth 链接（可用其他工具生成二维码）</summary><code class="wrap">${esc(r.uri)}</code></details>
      <label class="fld wide"><span>动态码</span><input class="field" name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>`;
    const dlg = t.closest('dialog'); dlg.dataset.mode = 'enable';
    dlg.querySelector('[type=submit]').hidden = false;
  },
  'user-mfa-reset': async t => {
    const u = R.users.find(x => x.id === t.dataset.id);
    if (!await confirmBox(`重置「${u.name}」的两步验证？对方下次登录只需密码，可重新绑定。`, '重置')) return;
    await API.patch(`/users/${u.id}`, { resetMfa: true }); toast('已重置'); rerender();
  },
  notif: () => openNotifications(),
  import: t => importModal(t.dataset.type),
  'file-del': async t => {
    if (!await confirmBox('确认删除该文件？')) return;
    const box = t.closest('.files');
    await API.del(`/attachments/${t.dataset.id}`); toast('已删除');
    box.outerHTML = await filesPane(box.dataset.entity, box.dataset.id);
  },
  'logo-del': async () => { settings = (await API.del('/settings/logo')).settings; toast('已移除 Logo'); $('#shell')?.remove(); rerender(); },
  'stmt-query': () => { ui.tabs.stmt = { accountId: $('#stAccount').value, from: $('#stFrom').value, to: $('#stTo').value }; renderStatement($('#financeBody')).catch(e => toast(e.message, true)); },
  'stmt-account': t => { ui.tabs.stmt.accountId = t.dataset.id; renderStatement($('#financeBody')).catch(e => toast(e.message, true)); },
  'stmt-export': () => { const st = ui.tabs.stmt; location.href = `/api/statements?${new URLSearchParams({ from: st.from, to: st.to, ...(st.accountId ? { accountId: st.accountId } : {}), format: 'csv' })}`; },
  print: () => window.print(),
  'cf-add': t => { (ui.cfDraft[t.dataset.ent] ||= []).push({ label: '', type: 'text', options: [], required: false, inList: false }); pageSettings(); },
  'cf-del': t => { ui.cfDraft[t.dataset.ent].splice(Number(t.dataset.i), 1); pageSettings(); },
  'cf-reset': () => { ui.cfDraft = null; pageSettings(); },
  'ap-add': () => { ui.apDraft.push({ name: '总经理审批', role: 'admin', minAmount: 100000 }); pageSettings(); },
  'ap-del': t => { ui.apDraft.splice(Number(t.dataset.i), 1); pageSettings(); },
  'webhook-test': async () => { await API.post('/settings/webhook-test'); toast('测试消息已发送，请在群内查看'); },
  'backup-now': async () => { const r = await API.post('/backups'); toast('已生成备份 ' + r.name); rerender(); },
  'user-edit': t => userModal(R.users.find(u => u.id === t.dataset.id)),
  'user-toggle': async t => {
    const u = R.users.find(x => x.id === t.dataset.id);
    if (u.active && !await confirmBox(`确认停用成员「${u.name}」？其登录会话会立即失效。`, '停用')) return;
    try { await API.patch(`/users/${u.id}`, { active: !u.active }); toast(u.active ? '已停用' : '已启用'); rerender(); } catch (e) { toast(e.message, true); }
  },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
  const fn = ACTIONS[t.dataset.act];
  if (!fn) return;
  if (t.tagName !== 'INPUT') e.preventDefault();
  Promise.resolve(fn(t, e)).catch(err => toast(err.message, true));
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-act-change]'); if (!t) return;
  const L = ui.list;
  if (t.dataset.actChange === 'filter') { L.filters[t.dataset.key] = t.value; L.page = 1; L.selected.clear(); loadList().catch(err => toast(err.message, true)); }
  if (t.dataset.actChange === 'page-size') { L.pageSize = Number(t.value); L.page = 1; loadList().catch(err => toast(err.message, true)); }
  if (t.dataset.actChange === 'upload') uploadFiles(t).catch(err => toast(err.message, true));
  if (t.dataset.actChange === 'logo') {
    const f = t.files[0]; if (!f) return;
    fetch('/api/settings/logo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type }, body: f })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); settings = d.settings; settings.logoV = Date.now(); toast('Logo 已更新'); $('#shell')?.remove(); rerender(); })
      .catch(err => toast(err.message, true));
  }
  if (t.dataset.cf !== undefined || t.dataset.ap !== undefined) syncDraft(t);
  if (t.dataset.actChange === 'opp-owner') go('#/opportunities' + (t.value ? '?owner=' + encodeURIComponent(t.value) : ''));
});
const onListSearch = debounce(v => { const L = ui.list; if (!L) return; L.q = v.trim(); L.page = 1; L.selected.clear(); loadList().catch(err => toast(err.message, true)); }, 300);
document.addEventListener('input', e => { if (e.target.dataset.actInput === 'list-q') onListSearch(e.target.value); if (e.target.dataset.cf !== undefined || e.target.dataset.ap !== undefined) syncDraft(e.target); });
/** 设置页可编辑表格 → 草稿对象 */
function syncDraft(el) {
  const prop = el.dataset.prop, v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.ap !== undefined) { ui.apDraft[Number(el.dataset.ap)][prop] = prop === 'minAmount' ? Number(v || 0) : v; return; }
  const f = ui.cfDraft[el.dataset.cf][Number(el.dataset.i)];
  f[prop] = prop === 'options' ? String(v).split(/[,，\n]/).map(x => x.trim()).filter(Boolean) : v;
  if (prop === 'type') { const opt = el.closest('tr').querySelector('[data-prop=options]'); opt.disabled = v !== 'select'; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });

// ======================= 启动 =======================
(async () => {
  try { const r = await request('/me'); me = r.user; settings = r.settings; } catch { /* 未登录 */ }
  if (me && (!location.hash || location.hash === '#/')) location.hash = '#/dashboard'; else route();
})();
