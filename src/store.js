'use strict';
/** 记录读取、关联名称补全、审计与事务 */
const { db } = require('./db');
const { newId, now, row } = require('./util');

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
function audit(u, action, entity, entityId, details = {}) {
  db.prepare('INSERT INTO audits VALUES(?,?,?,?,?,?,?,?)').run(newId(), u.tenant_id, u.id, action, entity, entityId, JSON.stringify(details), now());
}
function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { all, audit, childrenOf, decorate, getRecord, transaction };
