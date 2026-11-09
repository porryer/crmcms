'use strict';
/** 列表查询、导出行、全局搜索、下拉查找与客户概览 */
const { LABELS, OPEN_STAGES, TABLES } = require('./constants');
const { boom, row, sumCents, ymd, yuan } = require('./util');
const { all, childrenOf, decorate } = require('./store');
const { getVisible, scoped } = require('./scope');
const { customFieldsOf } = require('./settings');
const { isEffectiveContract } = require('./stats');

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

module.exports = { accountOverview, exportRows, listRecords, lookup, search };
