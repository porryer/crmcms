'use strict';
/**
 * 企业微信登录（自建应用）
 * - 浏览器：企业微信 Web 登录组件页面（扫码 / 已登录企业微信客户端快速确认）
 *   https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=<corpid>&agentid=<agentid>&redirect_uri=..&state=..
 * - 企业微信客户端内打开：网页授权静默登录（snsapi_base）
 *   https://open.weixin.qq.com/connect/oauth2/authorize?appid=<corpid>&redirect_uri=..&response_type=code&scope=snsapi_base&state=..&agentid=..#wechat_redirect
 * - 回调 code → access_token(gettoken) → auth/getuserinfo 取 userid → user/get 取姓名/邮箱/手机（有权限时）
 * 仅企业成员才会返回 userid；非成员只返回 openid，按“非本企业成员”拒绝。
 * 接口地址可通过环境变量覆盖（私有化部署 / 测试）。
 */
const API = () => (process.env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com').replace(/\/$/, '');
const LOGIN = () => (process.env.WECOM_LOGIN_BASE || 'https://login.work.weixin.qq.com').replace(/\/$/, '');
const OAUTH = () => (process.env.WECOM_OAUTH_BASE || 'https://open.weixin.qq.com').replace(/\/$/, '');

const tokens = new Map(); // corpId:agentId -> { token, exp }

async function call(path, params) {
  const url = new URL(API() + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  let d; try { d = await r.json(); } catch { throw new Error(`企业微信接口返回异常（HTTP ${r.status}）`); }
  return d;
}

async function accessToken(cfg, force = false) {
  const key = `${cfg.corpId}:${cfg.agentId}`, c = tokens.get(key);
  if (!force && c && c.exp > Date.now()) return c.token;
  const d = await call('/cgi-bin/gettoken', { corpid: cfg.corpId, corpsecret: cfg.secret });
  if (d.errcode) throw new Error(`企业微信获取凭证失败：${d.errmsg}（${d.errcode}）`);
  tokens.set(key, { token: d.access_token, exp: Date.now() + (Number(d.expires_in || 7200) - 300) * 1000 });
  return d.access_token;
}
/** 调用需要 access_token 的接口；凭证失效（40014/42001/40001）时刷新重试一次 */
async function authed(cfg, path, params) {
  let d = await call(path, { access_token: await accessToken(cfg), ...params });
  if ([40001, 40014, 42001].includes(d.errcode)) d = await call(path, { access_token: await accessToken(cfg, true), ...params });
  return d;
}

function authorizeUrl(cfg, { state, redirectUri, inApp = false }) {
  if (inApp) {
    const u = new URL(OAUTH() + '/connect/oauth2/authorize');
    for (const [k, v] of Object.entries({ appid: cfg.corpId, redirect_uri: redirectUri, response_type: 'code', scope: 'snsapi_base', state, agentid: cfg.agentId })) u.searchParams.set(k, v);
    return u.toString() + '#wechat_redirect';
  }
  const u = new URL(LOGIN() + '/wwlogin/sso/login');
  for (const [k, v] of Object.entries({ login_type: 'CorpApp', appid: cfg.corpId, agentid: cfg.agentId, redirect_uri: redirectUri, state })) u.searchParams.set(k, v);
  return u.toString();
}

/** code → { subject: userid, name, email, mobile } */
async function identify(cfg, code) {
  const info = await authed(cfg, '/cgi-bin/auth/getuserinfo', { code });
  if (info.errcode) throw new Error(`企业微信身份校验失败：${info.errmsg}（${info.errcode}）`);
  const userid = info.userid || info.UserId;
  if (!userid) throw new Error('非本企业成员，无法登录');
  const detail = await authed(cfg, '/cgi-bin/user/get', { userid });
  // 2022 年后新建应用默认拿不到邮箱/手机（errcode 0 但字段为空），或无通讯录权限（60011 等），均不影响登录
  const ok = !detail.errcode;
  return { subject: userid, name: (ok && detail.name) || userid, email: ok ? detail.biz_mail || detail.email || '' : '', mobile: ok ? detail.mobile || '' : '' };
}

/** 校验配置：能否取得 access_token */
const verifyConfig = cfg => accessToken(cfg, true);
const isInApp = ua => /wxwork/i.test(String(ua || ''));

module.exports = { authorizeUrl, identify, verifyConfig, isInApp, _tokens: tokens };
