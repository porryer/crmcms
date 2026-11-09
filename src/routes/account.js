'use strict';
/** 当前用户：个人信息、退出、改密、两步验证、站内通知 */
const TOTP = require('../../lib/totp');
const QR = require('../../lib/qrcode');
const { db } = require('../db');
const { boom, now } = require('../util');
const { audit } = require('../store');
const { publicUser } = require('../scope');
const { getSettings, publicSettings } = require('../settings');
const { checkPassword, hashPwd, makeCookie, sessionToken, tokenHash, verifyPwd } = require('../auth');
const { NEXT, readBody, send } = require('../http');
const { notifications } = require('../notify');
const { enabledProviders } = require('../sso');

async function accountRoutes(req, res, url, u) {
  const p = url.pathname, m = req.method;
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: { ...publicUser(u), identities: db.prepare('SELECT provider,name FROM identities WHERE user_id=?').all(u.id) }, settings: publicSettings(u), providers: enabledProviders(getSettings(u.tenant_id)) });
  if (p === '/api/me/identities' && m === 'DELETE') {
    const prov = url.searchParams.get('provider');
    db.prepare('DELETE FROM identities WHERE user_id=? AND provider=?').run(u.id, prov);
    audit(u, 'unbind', 'users', u.id, { provider: prov });
    return send(res, 200, { ok: true });
  }
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
    const uri = TOTP.otpauthUri(secret, u.email, getSettings(u.tenant_id).systemName);
    return send(res, 200, { secret, uri, qrSvg: QR.toSvg(uri, { scale: 4 }) });
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

  if (p === '/api/me' && m === 'PATCH') {
    const b = await readBody(req);
    if (b.emailNotify !== undefined) db.prepare('UPDATE users SET email_notify=? WHERE id=?').run(b.emailNotify ? 1 : 0, u.id);
    if (b.imNotify !== undefined) db.prepare('UPDATE users SET im_notify=? WHERE id=?').run(b.imNotify ? 1 : 0, u.id);
    return send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
  }
  if (p === '/api/notifications') {
    if (m === 'GET') return send(res, 200, notifications(u));
    if (m === 'POST') { db.prepare('UPDATE users SET notif_seen_at=? WHERE id=?').run(now(), u.id); return send(res, 200, { ok: true }); }
  }
  return NEXT;
}

module.exports = { accountRoutes };
