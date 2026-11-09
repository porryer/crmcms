'use strict';
/** 行级数据权限与角色判断 */
const { db } = require('./db');
const { DATA_SCOPES, DEFAULT_SCOPE } = require('./constants');
const { all, getRecord } = require('./store');

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

const publicUser = u => ({ id: u.id, tenantId: u.tenant_id, name: u.display_name, email: u.email, role: u.role, department: u.department || '', mfaEnabled: !!u.totp_enabled, emailNotify: u.email_notify !== 0, imNotify: u.im_notify !== 0 });
const canWrite = u => ['admin', 'manager', 'sales'].includes(u.role);
const canManage = u => ['admin', 'manager'].includes(u.role);
const canDelete = canManage;

module.exports = { canDelete, canManage, canWrite, effectiveScope, getVisible, publicUser, resetScope, scopeOwners, scoped };
