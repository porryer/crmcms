'use strict';
// 企业微信 / 钉钉 扫码登录（模拟开放平台接口）
const test = require('node:test'), assert = require('node:assert/strict');
const { startServer, mockOpenApi } = require('./helpers');

test('WeCom and DingTalk QR login', async t => {
  const api = await mockOpenApi();
  const s = await startServer({ env: { WECOM_API_BASE: api.base, WECOM_LOGIN_BASE: 'https://login.wecom.test', WECOM_OAUTH_BASE: 'https://oauth.wecom.test', DINGTALK_API_BASE: api.base, DINGTALK_LOGIN_BASE: 'https://login.ding.test', PUBLIC_ORIGIN: 'https://crm.example.com' } });
  t.after(async () => { await s.stop(); api.close(); });
  const startFlow = async (provider, { ua, cookie } = {}) => {
    const r = await fetch(`${s.base}/api/sso/${provider}/start${cookie ? '?bind=1' : ''}`, { redirect: 'manual', headers: { ...(ua ? { 'User-Agent': ua } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    return new URL(r.headers.get('location').replace('#wechat_redirect', ''), 'https://x');
  };
  const callback = async (provider, state, code, codeParam = 'code') => {
    const r = await fetch(`${s.base}/api/sso/${provider}/callback?${codeParam}=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    return { location: decodeURIComponent(r.headers.get('location') || ''), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const mkUser = (email, name, extra = {}) => s.req('/users', { method: 'POST', body: { email, name, password: 'Password!12345', role: 'sales', ...extra } }).then(r => r.data.id);

  await t.test('configuration is validated against the platform', async () => {
    assert.equal((await s.req('/settings', { method: 'PUT', body: { wecom: { enabled: true, corpId: 'ww123', agentId: 'abc', secret: 'x' } } })).status, 400, 'AgentId 须为数字');
    const bad = await s.req('/settings', { method: 'PUT', body: { wecom: { enabled: true, corpId: 'ww123', agentId: '1000002', secret: 'wrong' } } });
    assert.equal(bad.status, 400); assert.match(bad.data.error, /invalid credential/);
    const ok = (await s.req('/settings', { method: 'PUT', body: { wecom: { enabled: true, corpId: 'ww123', agentId: '1000002', secret: 'wecom-secret' } } })).data.settings.wecom;
    assert.equal(ok.secret, ''); assert.equal(ok.secretSet, true); assert.equal(ok.redirectUri, 'https://crm.example.com/api/sso/wecom/callback');
    assert.equal((await s.req('/settings', { method: 'PUT', body: { dingtalk: { enabled: true, clientId: 'dingkey', clientSecret: 'ding-secret' } } })).status, 400, '钉钉必须填写 CorpId');
    const dbad = await s.req('/settings', { method: 'PUT', body: { dingtalk: { enabled: true, clientId: 'dingkey', clientSecret: 'nope', corpId: 'ding-corp' } } });
    assert.equal(dbad.status, 400); assert.match(dbad.data.error, /无效的clientId/);
    assert.equal((await s.req('/settings', { method: 'PUT', body: { dingtalk: { enabled: true, clientId: 'dingkey', clientSecret: 'ding-secret', corpId: 'ding-corp' } } })).status, 200);
    const cfg = await (await fetch(s.base + '/api/sso/config')).json();
    assert.deepEqual(cfg.providers.map(p => p.id), ['wecom', 'dingtalk']);
  });

  await t.test('WeCom: authorize URLs (browser QR / in-app silent)', async () => {
    const qr = await startFlow('wecom');
    assert.equal(qr.origin + qr.pathname, 'https://login.wecom.test/wwlogin/sso/login');
    assert.equal(qr.searchParams.get('login_type'), 'CorpApp'); assert.equal(qr.searchParams.get('appid'), 'ww123'); assert.equal(qr.searchParams.get('agentid'), '1000002');
    assert.equal(qr.searchParams.get('redirect_uri'), 'https://crm.example.com/api/sso/wecom/callback');
    const inApp = await startFlow('wecom', { ua: 'Mozilla/5.0 (iPhone) wxwork/4.1.20 MicroMessenger/7.0.1' });
    assert.equal(inApp.origin + inApp.pathname, 'https://oauth.wecom.test/connect/oauth2/authorize');
    assert.equal(inApp.searchParams.get('scope'), 'snsapi_base');
  });

  await t.test('WeCom: match by email, then by binding; token cached and refreshed', async () => {
    const uid = await mkUser('zhang@corp.cn', '张三');
    api.wecomUsers.set('ZhangSan', { name: '张三', biz_mail: 'Zhang@corp.cn' });
    let st = (await startFlow('wecom')).searchParams.get('state');
    api.wecomCodes.set('c1', { userid: 'ZhangSan' });
    const r1 = await callback('wecom', st, 'c1');
    assert.equal(r1.location, '/#/dashboard');
    assert.equal((await s.req('/me', { cookie: r1.cookie })).data.user.id, uid);
    assert.deepEqual((await s.req('/me', { cookie: r1.cookie })).data.user.identities.map(x => x.provider), ['wecom']);
    // 之后即使拿不到邮箱（新应用无权限），也按绑定登录；凭证过期自动刷新
    api.wecomUsers.set('ZhangSan', null);
    const tokensBefore = api.wecomTokens;
    api.wecomExpireNext = true;
    st = (await startFlow('wecom')).searchParams.get('state');
    api.wecomCodes.set('c2', { userid: 'ZhangSan' });
    const r2 = await callback('wecom', st, 'c2');
    assert.equal(r2.location, '/#/dashboard');
    assert.equal(api.wecomTokens, tokensBefore + 1, '过期后只刷新一次');
    // state 一次性 / 跨方式使用无效
    assert.match((await callback('wecom', st, 'c2')).location, /已失效/);
    const dst = (await startFlow('dingtalk')).searchParams.get('state');
    assert.match((await callback('wecom', dst, 'x')).location, /已失效/);
  });

  await t.test('WeCom: non-member, invalid code, unknown member', async () => {
    let st = (await startFlow('wecom')).searchParams.get('state');
    api.wecomCodes.set('c3', { openid: 'oXYZ' });
    assert.match((await callback('wecom', st, 'c3')).location, /非本企业成员/);
    st = (await startFlow('wecom')).searchParams.get('state');
    assert.match((await callback('wecom', st, 'nope')).location, /invalid code/);
    st = (await startFlow('wecom')).searchParams.get('state');
    api.wecomCodes.set('c4', { userid: 'LiSi' });
    const r = await callback('wecom', st, 'c4');
    assert.match(r.location, /未找到与该企业微信账号对应的成员.*绑定企业微信/); assert.equal(r.cookie, undefined);
  });

  await t.test('self-service binding from personal menu', async () => {
    const uid = await mkUser('lisi@corp.cn', '李四');
    const c = await s.login('lisi@corp.cn', 'Password!12345');
    assert.match(decodeURIComponent((await fetch(`${s.base}/api/sso/wecom/start?bind=1`, { redirect: 'manual' })).headers.get('location')), /请先登录/);
    let st = (await startFlow('wecom', { cookie: c })).searchParams.get('state');
    api.wecomCodes.set('b1', { userid: 'LiSi' });
    assert.match((await callback('wecom', st, 'b1')).location, /sso_ok=已绑定企业微信/);
    st = (await startFlow('wecom')).searchParams.get('state');
    api.wecomCodes.set('b2', { userid: 'LiSi' });
    const r = await callback('wecom', st, 'b2');
    assert.equal((await s.req('/me', { cookie: r.cookie })).data.user.id, uid);
    // 已被他人绑定的企业微信账号不能再绑定
    const c2 = await s.login('zhang@corp.cn', 'Password!12345');
    st = (await startFlow('wecom', { cookie: c2 })).searchParams.get('state');
    api.wecomCodes.set('b3', { userid: 'LiSi' });
    assert.match((await callback('wecom', st, 'b3')).location, /已绑定其他成员/);
    // 本人解绑后无法再用企业微信登录
    await s.req('/me/identities?provider=wecom', { method: 'DELETE', cookie: c });
    st = (await startFlow('wecom')).searchParams.get('state');
    api.wecomCodes.set('b4', { userid: 'LiSi' });
    assert.match((await callback('wecom', st, 'b4')).location, /未找到/);
  });

  await t.test('DingTalk: corp check, mobile matching, authCode param, auto-create', async () => {
    const auth = await startFlow('dingtalk');
    assert.equal(auth.origin + auth.pathname, 'https://login.ding.test/oauth2/auth');
    assert.equal(auth.searchParams.get('client_id'), 'dingkey'); assert.equal(auth.searchParams.get('scope'), 'openid corpid');
    // 其他企业的钉钉账号
    api.dingCodes.set('d1', { corpId: 'other-corp', user: { unionId: 'u1', nick: '外人', mobile: '13800000001' } });
    assert.match((await callback('dingtalk', auth.searchParams.get('state'), 'd1', 'authCode')).location, /不属于本企业/);
    // 按手机号匹配（团队管理中填写的手机号可带 +86/空格）
    const uid = await mkUser('wang@corp.cn', '王五', { mobile: '+86 138-0000-0002' });
    let st = (await startFlow('dingtalk')).searchParams.get('state');
    api.dingCodes.set('d2', { corpId: 'ding-corp', user: { unionId: 'union-wang', nick: '王五', mobile: '13800000002', stateCode: '86' } });
    const r = await callback('dingtalk', st, 'd2', 'authCode');
    assert.equal(r.location, '/#/dashboard');
    assert.equal((await s.req('/me', { cookie: r.cookie })).data.user.id, uid);
    assert.deepEqual((await s.req('/users')).data.items.find(x => x.id === uid).identities, ['dingtalk']);
    // 未开通且无邮箱：不能自动开通
    await s.req('/settings', { method: 'PUT', body: { dingtalk: { autoCreate: true, defaultRole: 'viewer' } } });
    st = (await startFlow('dingtalk')).searchParams.get('state');
    api.dingCodes.set('d3', { corpId: 'ding-corp', user: { unionId: 'union-x', nick: '无邮箱' } });
    assert.match((await callback('dingtalk', st, 'd3', 'authCode')).location, /未找到/);
    // 有邮箱：自动开通
    st = (await startFlow('dingtalk')).searchParams.get('state');
    api.dingCodes.set('d4', { corpId: 'ding-corp', user: { unionId: 'union-new', nick: '新同事', email: 'New@corp.cn', mobile: '13900000009' } });
    const r4 = await callback('dingtalk', st, 'd4', 'authCode');
    const me = (await s.req('/me', { cookie: r4.cookie })).data.user;
    assert.equal(me.email, 'new@corp.cn'); assert.equal(me.role, 'viewer'); assert.equal(me.name, '新同事');
    // 用户在授权页取消
    st = (await startFlow('dingtalk')).searchParams.get('state');
    assert.match(decodeURIComponent((await fetch(`${s.base}/api/sso/dingtalk/callback?state=${st}`, { redirect: 'manual' })).headers.get('location')), /未返回授权码/);
  });

  await t.test('enforce mode applies when only WeCom/DingTalk are enabled; admin unbind', async () => {
    await s.req('/settings', { method: 'PUT', body: { sso: { enforce: true } } });
    const r = await s.login('wang@corp.cn', 'Password!12345');
    assert.equal(r.status, 403); assert.match(r.data.error, /企业微信登录.*钉钉登录/);
    assert.equal(typeof await s.login('admin@local.crm', 'TestPassword!1234'), 'string');
    const cfg = await (await fetch(s.base + '/api/sso/config')).json();
    assert.equal(cfg.enforce, true);
    const wang = (await s.req('/users')).data.items.find(x => x.email === 'wang@corp.cn');
    await s.req('/users/' + wang.id, { method: 'PATCH', body: { unbindSso: true } });
    assert.deepEqual((await s.req('/users')).data.items.find(x => x.id === wang.id).identities, []);
  });
});
