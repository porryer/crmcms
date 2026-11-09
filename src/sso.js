'use strict';
/** 单点登录：OIDC 与企业微信 / 钉钉扫码登录 */
const crypto = require('node:crypto');
const OIDC = require('../lib/oidc');
const WECOM = require('../lib/wecom');
const DINGTALK = require('../lib/dingtalk');
const { db } = require('./db');
const { ROLES } = require('./constants');
const { boom, newId, now } = require('./util');
const { audit } = require('./store');
const { getSettings, ssoRedirectUri } = require('./settings');
const { appendCookie, authenticate, createSession, hashPwd } = require('./auth');
const { logJson, readBody, redirect, send } = require('./http');

// ---------- 单点登录（OIDC） ----------
/** 登录页所属租户：SSO_TENANT 环境变量或最早创建的租户（单租户安装） */
const ssoTenantId = () => process.env.SSO_TENANT || db.prepare('SELECT id FROM tenants ORDER BY created_at LIMIT 1').get()?.id;
const PROVIDER_NAME = { oidc: '单点登录', wecom: '企业微信', dingtalk: '钉钉' };
/** 已启用的登录方式（登录页按钮） */
function enabledProviders(st) {
  const list = [];
  if (st.sso.enabled) list.push({ id: 'oidc', text: st.sso.buttonText || '企业账号登录', url: '/api/sso/start' });
  if (st.wecom.enabled) list.push({ id: 'wecom', text: st.wecom.buttonText || '企业微信登录', url: '/api/sso/wecom/start' });
  if (st.dingtalk.enabled) list.push({ id: 'dingtalk', text: st.dingtalk.buttonText || '钉钉登录', url: '/api/sso/dingtalk/start' });
  return list;
}
const validIssuer = url => { try { const x = new URL(url); return x.protocol === 'https:' || (x.protocol === 'http:' && process.env.SSO_ALLOW_HTTP === '1'); } catch { return false; } };
/**
 * 第三方登录 state 与浏览器绑定：发起时写入短期 HttpOnly Cookie，回调时必须一致。
 * 防止“登录/绑定 CSRF”——攻击者把带自己 state 的授权链接发给他人，使对方身份登录或绑定到攻击者账号。
 */
const STATE_COOKIE = 'crm_sso_state';
const stateCookie = (state, maxAge = 600) => `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/api/sso; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
const cookieValue = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
function stateMatchesBrowser(req, res, state) {
  const ok = !!state && cookieValue(req, STATE_COOKIE) === state;
  appendCookie(res, stateCookie('', 0));
  return ok;
}
const ssoFail = (res, msg) => redirect(res, '/#/login?sso_error=' + encodeURIComponent(msg));

async function ssoStart(req, res, url) {
  const tenantId = ssoTenantId(), cfg = getSettings(tenantId).sso;
  if (!cfg.enabled) return ssoFail(res, '未启用单点登录');
  db.prepare('DELETE FROM sso_states WHERE created_at<?').run(Date.now() - 10 * 60 * 1000);
  const state = crypto.randomBytes(24).toString('base64url'), nonce = crypto.randomBytes(24).toString('base64url'), { verifier, challenge } = OIDC.pkce();
  db.prepare("INSERT INTO sso_states(state,tenant_id,nonce,verifier,created_at,provider,next_path) VALUES(?,?,?,?,?,'oidc',?)").run(state, tenantId, nonce, verifier, Date.now(), safeNext(url.searchParams.get('next')));
  try { return redirect(res, await OIDC.authorizeUrl(cfg, { state, nonce, challenge, redirectUri: ssoRedirectUri(req) }), { 'Set-Cookie': stateCookie(state) }); }
  catch (e) { logJson({ type: 'sso_error', stage: 'start', message: e.message }); return ssoFail(res, '无法连接身份提供方：' + e.message); }
}
async function ssoCallback(req, res, url) {
  const q = url.searchParams;
  if (q.get('error')) return ssoFail(res, `身份提供方返回错误：${q.get('error_description') || q.get('error')}`);
  const st = db.prepare('SELECT * FROM sso_states WHERE state=?').get(String(q.get('state') || ''));
  if (st) db.prepare('DELETE FROM sso_states WHERE state=?').run(st.state); // 一次性
  if (!st || st.provider !== 'oidc' || Date.now() - st.created_at > 10 * 60 * 1000) return ssoFail(res, '登录请求已失效，请重试');
  if (!stateMatchesBrowser(req, res, st.state)) return ssoFail(res, '登录请求与当前浏览器不匹配，请在同一浏览器中重新发起登录');
  const cfg = getSettings(st.tenant_id).sso;
  if (!cfg.enabled) return ssoFail(res, '未启用单点登录');
  let claims;
  try {
    const tok = await OIDC.exchangeCode(cfg, { code: String(q.get('code') || ''), verifier: st.verifier, redirectUri: ssoRedirectUri(req) });
    claims = await OIDC.verifyIdToken(cfg, tok.id_token, { nonce: st.nonce });
  } catch (e) { logJson({ type: 'sso_error', stage: 'callback', message: e.message }); return ssoFail(res, '身份校验失败：' + e.message); }
  const email = String(claims.email || claims.upn || claims.preferred_username || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return ssoFail(res, '身份提供方未返回邮箱，请在 IdP 中为应用开放 email 权限');
  if (claims.email && claims.email_verified === false) return ssoFail(res, '该邮箱在身份提供方未验证');
  let user = db.prepare('SELECT * FROM users WHERE tenant_id=? AND email=?').get(st.tenant_id, email);
  if (user && !user.active) return ssoFail(res, '账号已停用，请联系管理员');
  if (user && user.sso_sub && user.sso_sub !== String(claims.sub)) return ssoFail(res, '该邮箱已绑定其他身份，请联系管理员');
  if (!user) {
    if (!cfg.autoCreate) return ssoFail(res, `账号 ${email} 尚未在系统中开通，请联系管理员`);
    const uid = newId();
    db.prepare('INSERT INTO users(id,tenant_id,email,password_hash,role,display_name,active,created_at,department,data_scope) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(uid, st.tenant_id, email, hashPwd(crypto.randomBytes(32).toString('hex')), ROLES.includes(cfg.defaultRole) && cfg.defaultRole !== 'admin' ? cfg.defaultRole : 'sales', String(claims.name || email.split('@')[0]).slice(0, 100), 1, now(), String(cfg.defaultDept || '').slice(0, 50), '');
    user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    audit(user, 'create', 'users', uid, { via: 'sso', email });
  }
  if (!user.sso_sub) db.prepare('UPDATE users SET sso_sub=? WHERE id=?').run(String(claims.sub), user.id);
  createSession(user, res);
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), user.id);
  audit(user, 'login', 'session', user.id, { via: 'sso' });
  res.writeHead(302, { Location: '/' + (st.next_path || '#/dashboard'), 'Cache-Control': 'no-store' });
  res.end();
}

// ---------- 企业微信 / 钉钉 扫码登录 ----------
const IM = { wecom: WECOM, dingtalk: DINGTALK };
/** 发起登录；bind=1 时需已登录，回调后把第三方身份绑定到当前账号 */
async function imStart(req, res, url, provider) {
  const bindUser = url.searchParams.get('bind') === '1' ? authenticate(req) : null;
  if (url.searchParams.get('bind') === '1' && !bindUser) return ssoFail(res, '请先登录后再绑定');
  const tenantId = bindUser ? bindUser.tenant_id : ssoTenantId(), cfg = getSettings(tenantId)[provider];
  if (!cfg.enabled) return ssoFail(res, `未启用${PROVIDER_NAME[provider]}登录`);
  const state = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sso_states(state,tenant_id,nonce,verifier,created_at,provider,bind_user_id,next_path) VALUES(?,?,?,?,?,?,?,?)').run(state, tenantId, '', '', Date.now(), provider, bindUser?.id || '', safeNext(url.searchParams.get('next')));
  return redirect(res, IM[provider].authorizeUrl(cfg, { state, redirectUri: ssoRedirectUri(req, provider), inApp: provider === 'wecom' && WECOM.isInApp(req.headers['user-agent']) }), { 'Set-Cookie': stateCookie(state) });
}
/** 登录后返回的页面：仅允许站内 hash 路由，防开放重定向 */
const safeNext = v => (typeof v === 'string' && v.length <= 300 && /^#\/[\w\-/?=&%.~+]*$/.test(v) ? v : '');
const normMobile = m => String(m || '').replace(/\D/g, '').slice(-11);
async function imCallback(req, res, url, provider) {
  const q = url.searchParams, name = PROVIDER_NAME[provider];
  const st = db.prepare('SELECT * FROM sso_states WHERE state=?').get(String(q.get('state') || ''));
  if (st) db.prepare('DELETE FROM sso_states WHERE state=?').run(st.state);
  if (!st || st.provider !== provider || Date.now() - st.created_at > 10 * 60 * 1000) return ssoFail(res, '登录请求已失效，请重试');
  if (!stateMatchesBrowser(req, res, st.state)) return ssoFail(res, '登录请求与当前浏览器不匹配，请在同一浏览器中重新发起登录');
  const code = String(q.get('authCode') || q.get('code') || '');
  if (!code) return ssoFail(res, `${name}未返回授权码（用户可能取消了授权）`);
  const cfg = getSettings(st.tenant_id)[provider];
  if (!cfg.enabled) return ssoFail(res, `未启用${name}登录`);
  let who;
  try { who = await IM[provider].identify(cfg, code); }
  catch (e) { logJson({ type: 'sso_error', provider, message: e.message }); return ssoFail(res, e.message); }
  const bound = db.prepare('SELECT * FROM identities WHERE tenant_id=? AND provider=? AND subject=?').get(st.tenant_id, provider, who.subject);
  const bind = userId => db.prepare('INSERT OR REPLACE INTO identities(tenant_id,provider,subject,user_id,name,created_at,ext_userid) VALUES(?,?,?,?,?,?,?)').run(st.tenant_id, provider, who.subject, userId, String(who.name || '').slice(0, 100), now(), who.userid || '');

  // ---- 绑定模式：已登录用户把第三方身份绑定到自己 ----
  if (st.bind_user_id) {
    const me = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(st.bind_user_id);
    if (!me) return ssoFail(res, '账号不存在或已停用');
    if (bound && bound.user_id !== me.id) return ssoFail(res, `该${name}账号已绑定其他成员，请联系管理员`);
    db.prepare('DELETE FROM identities WHERE tenant_id=? AND provider=? AND user_id=?').run(st.tenant_id, provider, me.id);
    bind(me.id);
    audit(me, 'bind', 'users', me.id, { provider, subject: who.subject });
    return redirect(res, '/#/dashboard?sso_ok=' + encodeURIComponent(`已绑定${name}账号${who.name ? '：' + who.name : ''}`));
  }

  // ---- 登录：已绑定 → 邮箱 → 手机号 → 自动开通 ----
  const r = imResolveUser(st.tenant_id, provider, cfg, who);
  if (r.error) return ssoFail(res, r.error);
  imCompleteLogin(r.user, provider, res);
  res.writeHead(302, { Location: '/' + (st.next_path || '#/dashboard'), 'Cache-Control': 'no-store' });
  res.end();
}

/** 第三方身份 → 成员（已绑定 → 邮箱 → 手机号 → 自动开通），返回 { user } 或 { error }；匹配成功时自动绑定 */
function imResolveUser(tenantId, provider, cfg, who) {
  const name = PROVIDER_NAME[provider];
  const bound = db.prepare('SELECT * FROM identities WHERE tenant_id=? AND provider=? AND subject=?').get(tenantId, provider, who.subject);
  let user = bound ? db.prepare('SELECT * FROM users WHERE id=?').get(bound.user_id) : null;
  const email = String(who.email || '').trim().toLowerCase(), mobile = normMobile(who.mobile);
  if (!user && email) user = db.prepare('SELECT * FROM users WHERE tenant_id=? AND email=?').get(tenantId, email);
  if (!user && mobile.length === 11) {
    const hits = db.prepare('SELECT * FROM users WHERE tenant_id=? AND mobile<>\'\'').all(tenantId).filter(x => normMobile(x.mobile) === mobile);
    if (hits.length === 1) user = hits[0];
  }
  if (user && !user.active) return { error: '账号已停用，请联系管理员' };
  if (user && !bound) {
    const other = db.prepare('SELECT subject FROM identities WHERE tenant_id=? AND provider=? AND user_id=?').get(tenantId, provider, user.id);
    if (other) return { error: `该成员已绑定其他${name}账号，请联系管理员` };
  }
  if (!user) {
    if (!cfg.autoCreate || !/^\S+@\S+\.\S+$/.test(email)) {
      return { error: `未找到与该${name}账号对应的成员。请先用账号密码登录，在右上角个人菜单中“绑定${name}”；或请管理员在团队管理中填写手机号/邮箱` };
    }
    const uid = newId();
    db.prepare('INSERT INTO users(id,tenant_id,email,password_hash,role,display_name,active,created_at,department,data_scope,mobile) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid, tenantId, email, hashPwd(crypto.randomBytes(32).toString('hex')), ['sales', 'viewer', 'manager'].includes(cfg.defaultRole) ? cfg.defaultRole : 'sales', String(who.name || email.split('@')[0]).slice(0, 100), 1, now(), String(cfg.defaultDept || '').slice(0, 50), '', String(who.mobile || '').slice(0, 30));
    user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    audit(user, 'create', 'users', uid, { via: provider, email });
  }
  if (!bound) db.prepare('INSERT OR REPLACE INTO identities(tenant_id,provider,subject,user_id,name,created_at,ext_userid) VALUES(?,?,?,?,?,?,?)').run(tenantId, provider, who.subject, user.id, String(who.name || '').slice(0, 100), now(), who.userid || '');
  else if (who.userid && !bound.ext_userid) db.prepare('UPDATE identities SET ext_userid=? WHERE tenant_id=? AND provider=? AND subject=?').run(who.userid, tenantId, provider, who.subject);
  return { user };
}
function imCompleteLogin(user, provider, res) {
  createSession(user, res);
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), user.id);
  audit(user, 'login', 'session', user.id, { via: provider });
}
/** 钉钉客户端内免登：前端 JSAPI 取得授权码后 POST 到此 */
async function dingtalkInApp(req, res) {
  const tenantId = ssoTenantId(), cfg = getSettings(tenantId).dingtalk;
  if (!cfg.enabled) boom(400, '未启用钉钉登录');
  const b = await readBody(req), code = String(b.code || '');
  if (!code || code.length > 200) boom(400, '缺少免登授权码');
  let who;
  try { who = await DINGTALK.inAppIdentify(cfg, code); }
  catch (e) { logJson({ type: 'sso_error', provider: 'dingtalk-inapp', message: e.message }); boom(401, e.message); }
  const r = imResolveUser(tenantId, 'dingtalk', cfg, who);
  if (r.error) boom(403, r.error);
  imCompleteLogin(r.user, 'dingtalk', res);
  return send(res, 200, { ok: true });
}

module.exports = { IM, PROVIDER_NAME, dingtalkInApp, enabledProviders, imCallback, imStart, ssoCallback, ssoStart, ssoTenantId, validIssuer };
