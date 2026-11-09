'use strict';
/**
 * 钉钉登录（新版 OAuth2 统一身份认证，企业内部应用）
 * - 授权：https://login.dingtalk.com/oauth2/auth?redirect_uri=..&response_type=code&client_id=<AppKey>&scope=openid%20corpid&state=..&prompt=consent
 * - 回调参数 authCode（兼容 code）
 * - POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken → accessToken、corpId
 * - GET  https://api.dingtalk.com/v1.0/contact/users/me（x-acs-dingtalk-access-token）→ unionId、nick、mobile、email
 * 必须校验 corpId 与配置一致，否则任意钉钉用户都能完成授权。
 */
const API = () => (process.env.DINGTALK_API_BASE || 'https://api.dingtalk.com').replace(/\/$/, '');
const LOGIN = () => (process.env.DINGTALK_LOGIN_BASE || 'https://login.dingtalk.com').replace(/\/$/, '');

async function json(r, what) {
  let d; try { d = await r.json(); } catch { throw new Error(`钉钉${what}返回异常（HTTP ${r.status}）`); }
  if (!r.ok) throw new Error(`钉钉${what}失败：${d.message || d.code || r.status}`);
  return d;
}

function authorizeUrl(cfg, { state, redirectUri }) {
  const u = new URL(LOGIN() + '/oauth2/auth');
  for (const [k, v] of Object.entries({ redirect_uri: redirectUri, response_type: 'code', client_id: cfg.clientId, scope: 'openid corpid', state, prompt: 'consent' })) u.searchParams.set(k, v);
  return u.toString();
}

/** authCode → { subject: unionId, name, email, mobile } */
async function identify(cfg, code) {
  const tok = await json(await fetch(API() + '/v1.0/oauth2/userAccessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, code, grantType: 'authorization_code' }),
  }), '获取用户凭证');
  if (!tok.accessToken) throw new Error('钉钉未返回用户凭证');
  if (!tok.corpId || tok.corpId !== cfg.corpId) throw new Error('该钉钉账号不属于本企业（请在授权页选择本企业组织）');
  const me = await json(await fetch(API() + '/v1.0/contact/users/me', { headers: { 'x-acs-dingtalk-access-token': tok.accessToken }, signal: AbortSignal.timeout(10000) }), '获取用户信息');
  if (!me.unionId) throw new Error('钉钉未返回用户标识');
  return { subject: me.unionId, name: me.nick || '', email: me.email || '', mobile: me.mobile || '' };
}

/** 校验应用凭证：POST /v1.0/oauth2/accessToken（企业内部应用 AppKey/AppSecret） */
async function verifyConfig(cfg) {
  const d = await json(await fetch(API() + '/v1.0/oauth2/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ appKey: cfg.clientId, appSecret: cfg.clientSecret }),
  }), '校验应用凭证');
  if (!d.accessToken) throw new Error('钉钉未返回应用凭证');
  return true;
}

module.exports = { authorizeUrl, identify, verifyConfig };
