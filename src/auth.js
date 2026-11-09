'use strict';
/** 密码、会话 Cookie、登录防爆破 */
const crypto = require('node:crypto');
const { SESSION_HOURS } = require('./config');
const { db } = require('./db');
const { boom, now } = require('./util');

const hashPwd = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
function verifyPwd(pwd, hash) {
  const [salt, expected] = String(hash).split(':');
  if (!salt || !expected) return false;
  const a = Buffer.from(expected, 'hex'), b = crypto.scryptSync(pwd, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const DUMMY_HASH = hashPwd(crypto.randomBytes(16).toString('hex'));
// ---------- 会话 & Cookie ----------
/** 追加 Set-Cookie（不覆盖已设置的其他 Cookie） */
function appendCookie(res, c) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
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
  appendCookie(res, makeCookie(token, Math.round(SESSION_HOURS * 3600)));
}
const purgeSessions = () => { db.prepare('DELETE FROM sessions WHERE expiry<=?').run(now()); db.prepare('DELETE FROM sso_states WHERE created_at<?').run(Date.now() - 600000); };

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

module.exports = { DUMMY_HASH, LOGIN_MAX_PER_ACCOUNT, LOGIN_MAX_PER_IP, appendCookie, authenticate, checkPassword, clearLoginFailures, clientIp, createSession, hashPwd, loginBlocked, makeCookie, pruneLoginFailures, purgeSessions, recordLoginFailure, sessionToken, tokenHash, verifyPwd };
