'use strict';
/** 成员管理 */
const { db } = require('./db');
const { DATA_SCOPES, DEFAULT_SCOPE, ROLES } = require('./constants');
const { boom, newId, now } = require('./util');
const { audit, transaction } = require('./store');
const { canManage } = require('./scope');
const { checkPassword, hashPwd } = require('./auth');
const { readBody } = require('./http');

// ---------- 用户管理 ----------
function listUsers(u) {
  return db.prepare('SELECT id,email,role,display_name name,department,active,created_at createdAt,last_login_at lastLoginAt,data_scope dataScope,totp_enabled mfaEnabled,length(sso_sub)>0 ssoBound,mobile,(SELECT group_concat(provider) FROM identities i WHERE i.user_id=users.id) identities FROM users WHERE tenant_id=? ORDER BY created_at').all(u.tenant_id)
    .map(x => ({ ...x, identities: x.identities ? x.identities.split(',') : [] }))
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
    if (b.mobile) db.prepare('UPDATE users SET mobile=? WHERE id=?').run(String(b.mobile).trim().slice(0, 30), uid);
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
    if (b.unbindSso === true) { db.prepare("UPDATE users SET sso_sub='' WHERE id=?").run(target.id); db.prepare('DELETE FROM identities WHERE user_id=?').run(target.id); }
    if (b.mobile !== undefined) db.prepare('UPDATE users SET mobile=? WHERE id=?').run(String(b.mobile).trim().slice(0, 30), target.id);
    if (resetPassword || resetMfa || !next.active || next.role !== target.role) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    audit(u, 'update', 'users', target.id, { before: { name: target.display_name, role: target.role, department: target.department, active: target.active, dataScope: target.data_scope }, resetPassword, resetMfa });
  });
  return { ok: true };
}

module.exports = { createUser, listUsers, updateUser };
