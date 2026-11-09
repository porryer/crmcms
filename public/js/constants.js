/* NovaCRM V1.1 前端：原生 JS 单页应用（hash 路由），兼容严格 CSP（无内联脚本/样式）。 */

// ======================= 常量 =======================
export const STAGES = ['初步沟通', '需求确认', '方案报价', '商务谈判', '赢单', '输单'];
const LEAD_STATUS = ['未联系', '跟进中', '已分配', '已转化', '已失效'];
const TASK_STATUS = ['待处理', '进行中', '已完成'];
export const CONTRACT_STATUS = ['草稿', '审批中', '已签订', '执行中', '已完成', '已作废'];
const PLAN_STATUS = ['待回款', '已回款'];
const PRIORITY = ['低', '中', '高'];
export const ROLE_LABEL = { admin: '管理员', manager: '销售经理', sales: '销售', viewer: '只读' };
export const SCOPE_LABEL = { self: '仅本人', dept: '本部门', all: '全部数据' };
export const ENTITY_LABEL = { leads: '线索', accounts: '客户', contacts: '联系人', opportunities: '商机', tasks: '任务', activities: '跟进记录', contracts: '合同', payments: '回款', plans: '回款计划', users: '成员', settings: '系统设置', session: '登录', reports: '报表' };
export const ACTION_LABEL = { create: '新增', update: '修改', delete: '删除', convert: '线索转化', export: '导出', login: '登录', change_password: '修改密码', assign: '分配', submit: '提交审批', approve: '审批通过', reject: '审批驳回' };

const TAG_COLORS = {
  green: ['已转化', '合作中', '赢单', '已签订', '执行中', '已完成', '已收齐', '已回款', '有效跟进', '推进中', '正常', 'VIP'],
  blue: ['跟进中', '进行中', '已分配', '需求确认', '初步沟通', '持续跟进', '安排演示', '重要', '企业客户'],
  orange: ['审批中', '待反馈', '部分回款', '待处理', '方案报价', '商务谈判', '中', '潜在', '待回款'],
  red: ['已失效', '输单', '已作废', '逾期', '流失', '高', '停用', '无效'],
};
export const tagClass = v => Object.keys(TAG_COLORS).find(k => TAG_COLORS[k].includes(v)) || 'gray';

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
export const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
export const ACTIVITY_ICON = { 电话: 'phone', 微信: 'message', 拜访: 'visit', 邮件: 'mail', 会议: 'meeting', 演示: 'calendar' };

// ======================= 菜单 =======================
export const MENU = [
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
export const IMPORTABLE = ['leads', 'accounts', 'contacts', 'opportunities'];
export const PROVIDER_ICON = { oidc: 'shield', wecom: 'message', dingtalk: 'bell' };
export const PROVIDER_NAME = { oidc: '单点登录', wecom: '企业微信', dingtalk: '钉钉' };
export const PAGE_TITLE = { dashboard: '工作台', leads: '线索管理', accounts: '客户管理', contacts: '联系人', opportunities: '商机管理', contracts: '合同订单', finance: '财务回款', tasks: '跟进任务', activities: '跟进记录', reports: '数据报表', team: '团队管理', settings: '系统设置' };

// ======================= 表单字段定义 =======================
// [字段, 标签, 类型, 必填, 宽字段]
export const FORMS = {
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
export const LISTS = {
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
