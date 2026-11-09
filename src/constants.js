'use strict';
/** 业务字典、默认设置与实体字段定义 */

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
  /** 邮件通知（SMTP） */
  smtp: { enabled: false, host: '', port: 465, secure: 'ssl', user: '', pass: '', from: '', events: ['approval', 'assign', 'digest'] },
  /** 单点登录（OpenID Connect） */
  sso: { enabled: false, issuer: '', clientId: '', clientSecret: '', buttonText: '企业账号登录', autoCreate: false, defaultRole: 'sales', defaultDept: '', enforce: false },
  /** 企业微信登录（自建应用：CorpID / AgentId / Secret） */
  wecom: { enabled: false, corpId: '', agentId: '', secret: '', buttonText: '企业微信登录', autoCreate: false, defaultRole: 'sales', defaultDept: '', notify: false, notifyEvents: ['approval', 'assign', 'digest'] },
  /** 钉钉登录（企业内部应用：AppKey / AppSecret / CorpId） */
  dingtalk: { enabled: false, clientId: '', clientSecret: '', corpId: '', agentId: '', buttonText: '钉钉登录', autoCreate: false, defaultRole: 'sales', defaultDept: '', notify: false, notifyEvents: ['approval', 'assign', 'digest'] },
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

module.exports = { CONTRACT_APPROVED, CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, DATA_SCOPES, DEFAULT_SCOPE, DEFAULT_SETTINGS, LABELS, LEGACY, MONEY_TYPES, OPEN_STAGES, ROLES, STAGES, TABLES, WEBHOOK_EVENTS };
