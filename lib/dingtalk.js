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
const OAPI = () => (process.env.DINGTALK_OAPI_BASE || 'https://oapi.dingtalk.com').replace(/\/$/, '');

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

// ---------- 客户端内免登（H5 微应用：JSAPI requestAuthCode → 服务端换取身份） ----------
const appTokens = new Map(); // clientId -> { token, exp }
async function appToken(cfg, force = false) {
  const c = appTokens.get(cfg.clientId);
  if (!force && c && c.exp > Date.now()) return c.token;
  const u = new URL(OAPI() + '/gettoken');
  u.searchParams.set('appkey', cfg.clientId); u.searchParams.set('appsecret', cfg.clientSecret);
  const d = await (await fetch(u, { signal: AbortSignal.timeout(10000) })).json().catch(() => ({ errcode: -1, errmsg: '响应异常' }));
  if (d.errcode) throw new Error(`钉钉获取应用凭证失败：${d.errmsg}（${d.errcode}）`);
  appTokens.set(cfg.clientId, { token: d.access_token, exp: Date.now() + (Number(d.expires_in || 7200) - 300) * 1000 });
  return d.access_token;
}
/** 调用旧版服务端接口（topapi），凭证失效时刷新重试一次 */
async function topapi(cfg, path, body) {
  const post = async token => (await fetch(`${OAPI()}${path}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  })).json().catch(() => ({ errcode: -1, errmsg: '响应异常' }));
  let d = await post(await appToken(cfg));
  if ([40014, 42001, 88].includes(d.errcode)) d = await post(await appToken(cfg, true));
  return d;
}
/** 免登授权码 → { subject: unionid, name, email, mobile }；授权码只对本企业应用有效，天然限定本企业成员 */
async function inAppIdentify(cfg, code) {
  const info = await topapi(cfg, '/topapi/v2/user/getuserinfo', { code });
  if (info.errcode) throw new Error(`钉钉免登失败：${info.errmsg}（${info.errcode}）`);
  const r = info.result || {};
  if (!r.userid) throw new Error('钉钉未返回成员信息');
  const detail = await topapi(cfg, '/topapi/v2/user/get', { userid: r.userid, language: 'zh_CN' });
  const d = detail.errcode ? {} : detail.result || {};
  const unionid = r.unionid || d.unionid;
  if (!unionid) throw new Error('钉钉未返回用户标识（unionid）');
  return { subject: unionid, userid: r.userid, name: d.name || r.name || '', email: d.org_email || d.email || '', mobile: d.mobile || '' };
}

/** unionId → 企业内 userid（工作通知需要 userid；扫码登录只拿到 unionId） */
async function userIdByUnionId(cfg, unionid) {
  const d = await topapi(cfg, '/topapi/user/getbyunionid', { unionid });
  if (d.errcode) throw new Error(`钉钉查询成员失败：${d.errmsg}（${d.errcode}）`);
  return d.result?.userid || '';
}
/**
 * 工作通知：POST /topapi/message/corpconversation/asyncsend_v2，最多 100 人/次。
 * 有详情链接时用 ActionCard（带“查看详情”按钮），否则用 Markdown。
 */
async function sendWorkNotice(cfg, userids, { title, lines, url }) {
  if (!/^\d+$/.test(String(cfg.agentId || ''))) throw new Error('未配置钉钉应用 AgentId');
  const markdown = `### ${title}\n\n` + lines.map(l => `- ${l}`).join('\n');
  const msg = url
    ? { msgtype: 'action_card', action_card: { title: title.slice(0, 64), markdown, single_title: '查看详情', single_url: url } }
    : { msgtype: 'markdown', markdown: { title: title.slice(0, 64), text: markdown } };
  const tasks = [];
  for (let i = 0; i < userids.length; i += 100) {
    const d = await topapi(cfg, '/topapi/message/corpconversation/asyncsend_v2', { agent_id: Number(cfg.agentId), userid_list: userids.slice(i, i + 100).join(','), msg });
    if (d.errcode) throw new Error(`钉钉发送工作通知失败：${d.errmsg}（${d.errcode}）`);
    tasks.push(d.task_id);
  }
  return { tasks };
}

module.exports = { authorizeUrl, identify, verifyConfig, inAppIdentify, userIdByUnionId, sendWorkNotice, _appTokens: appTokens };
