'use strict';
// 企业微信 / 钉钉 扫码登录（模拟开放平台接口）
const test = require('node:test'), assert = require('node:assert/strict');
const { startServer, mockOpenApi } = require('./helpers');
const { sessionCookie } = require('./helpers');

test('WeCom and DingTalk QR login', async t => {
  const api = await mockOpenApi();
  const s = await startServer({ env: { WECOM_API_BASE: api.base, WECOM_LOGIN_BASE: 'https://login.wecom.test', WECOM_OAUTH_BASE: 'https://oauth.wecom.test', DINGTALK_API_BASE: api.base, DINGTALK_LOGIN_BASE: 'https://login.ding.test', PUBLIC_ORIGIN: 'https://crm.example.com' } });
  t.after(async () => { await s.stop(); api.close(); });
  const startFlow = async (provider, { ua, cookie } = {}) => {
    const r = await fetch(`${s.base}/api/sso/${provider}/start${cookie ? '?bind=1' : ''}`, { redirect: 'manual', headers: { ...(ua ? { 'User-Agent': ua } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    return new URL(r.headers.get('location').replace('#wechat_redirect', ''), 'https://x');
  };
  const callback = async (provider, state, code, codeParam = 'code', cookieState) => {
    const r = await fetch(`${s.base}/api/sso/${provider}/callback?${codeParam}=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + (cookieState ?? state) } });
    return { location: decodeURIComponent(r.headers.get('location') || ''), cookie: sessionCookie(r) };
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
    // 绑定 CSRF：攻击者用自己账号发起绑定，把授权链接发给受害者；受害者浏览器没有对应 state Cookie → 拒绝
    const attacker = await s.login('zhang@corp.cn', 'Password!12345');
    const atkState = (await startFlow('wecom', { cookie: attacker })).searchParams.get('state');
    api.wecomCodes.set('victim-code', { userid: 'VictimUser' });
    assert.match((await callback('wecom', atkState, 'victim-code', 'code', 'victim-own-state')).location, /当前浏览器不匹配/);
    assert.match((await callback('wecom', 'whatever', 'victim-code', 'code', '')).location, /已失效|不匹配/);
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
    assert.match(decodeURIComponent((await fetch(`${s.base}/api/sso/dingtalk/callback?state=${st}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + st } })).headers.get('location')), /未返回授权码/);
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

test('DingTalk in-app silent login (JSAPI auth code)', async t => {
  const api = await mockOpenApi();
  const s = await startServer({ env: { DINGTALK_API_BASE: api.base, DINGTALK_OAPI_BASE: api.base } });
  t.after(async () => { await s.stop(); api.close(); });
  const inapp = code => s.req('/sso/dingtalk/inapp', { method: 'POST', body: { code }, cookie: '' });
  assert.equal((await inapp('x')).status, 400, '未启用时拒绝');
  await s.req('/settings', { method: 'PUT', body: { dingtalk: { enabled: true, clientId: 'dingkey', clientSecret: 'ding-secret', corpId: 'ding-corp' } } });
  const cfg = await (await fetch(s.base + '/api/sso/config')).json();
  assert.deepEqual(cfg.dingtalk, { corpId: 'ding-corp', clientId: 'dingkey' }, '前端只拿到公开参数');
  // 详情接口有权限：按手机号匹配
  const uid = (await s.req('/users', { method: 'POST', body: { email: 'qian@corp.cn', name: '钱七', password: 'Password!12345', role: 'sales', mobile: '13600000007' } })).data.id;
  api.ddInApp.set('k1', { userid: 'qian', unionid: 'union-qian', name: '钱七' });
  api.ddUsers.set('qian', { name: '钱七', mobile: '13600000007', org_email: '' });
  const r1 = await inapp('k1');
  assert.equal(r1.status, 200); assert.ok(r1.cookie);
  assert.equal((await s.req('/me', { cookie: r1.cookie })).data.user.id, uid);
  // 免登与扫码共用 unionId 绑定：详情无权限时仍可按绑定登录；应用凭证过期自动刷新
  api.ddUsers.set('qian', null);
  const before = api.ddAppTokens; api.ddExpireNext = true;
  api.ddInApp.set('k2', { userid: 'qian', unionid: 'union-qian', name: '钱七' });
  const r2 = await inapp('k2');
  assert.equal(r2.status, 200); assert.equal(api.ddAppTokens, before + 1);
  assert.equal((await s.req('/me', { cookie: r2.cookie })).data.user.id, uid);
  api.dingCodes.set('qr1', { corpId: 'ding-corp', user: { unionId: 'union-qian', nick: '钱七' } });
  const auth = new URL((await fetch(`${s.base}/api/sso/dingtalk/start`, { redirect: 'manual' })).headers.get('location'));
  const cb = await fetch(`${s.base}/api/sso/dingtalk/callback?authCode=qr1&state=${auth.searchParams.get('state')}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + auth.searchParams.get('state') } });
  assert.equal(cb.headers.get('location'), '/#/dashboard', '扫码登录命中同一绑定');
  // 无效授权码、未匹配成员
  const bad = await inapp('nope');
  assert.equal(bad.status, 401); assert.match(bad.data.error, /不存在的临时授权码/);
  api.ddInApp.set('k3', { userid: 'stranger', unionid: 'union-s', name: '陌生人' });
  const r3 = await inapp('k3');
  assert.equal(r3.status, 403); assert.match(r3.data.error, /未找到/);
  // 跨站 POST 被拒绝
  api.ddInApp.set('k4', { userid: 'qian', unionid: 'union-qian' });
  assert.equal((await s.req('/sso/dingtalk/inapp', { method: 'POST', body: { code: 'k4' }, cookie: '', headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('personal work notifications via WeCom app message and DingTalk work notice', async t => {
  const api = await mockOpenApi();
  const s = await startServer({ env: { WECOM_API_BASE: api.base, DINGTALK_API_BASE: api.base, DINGTALK_OAPI_BASE: api.base, PUBLIC_ORIGIN: 'https://crm.example.com' } });
  t.after(async () => { await s.stop(); api.close(); });
  const flush = () => new Promise(r => setTimeout(r, 300));
  // 未启用登录不能开通知；钉钉通知需 AgentId
  assert.equal((await s.req('/settings', { method: 'PUT', body: { wecom: { notify: true } } })).status, 400);
  await s.req('/settings', { method: 'PUT', body: { wecom: { enabled: true, corpId: 'ww123', agentId: '1000002', secret: 'wecom-secret', notify: true } } });
  assert.equal((await s.req('/settings', { method: 'PUT', body: { dingtalk: { enabled: true, clientId: 'dingkey', clientSecret: 'ding-secret', corpId: 'ding-corp', notify: true } } })).status, 400);
  await s.req('/settings', { method: 'PUT', body: { dingtalk: { enabled: true, clientId: 'dingkey', clientSecret: 'ding-secret', corpId: 'ding-corp', agentId: '4000001', notify: true } } });
  await s.req('/settings', { method: 'PUT', body: { approval: { levels: [{ name: '经理审批', role: 'manager', minAmount: 0 }] } } });
  const mk = (email, name, role) => s.req('/users', { method: 'POST', body: { email, name, password: 'Password!12345', role, dataScope: 'all' } }).then(r => r.data.id);
  const salesId = await mk('xs@corp.cn', '销售小周', 'sales'), mgrId = await mk('jl@corp.cn', '经理老吴', 'manager');
  // 经理通过企业微信扫码绑定（userid=WuJL），销售通过钉钉扫码绑定（unionId，userid 需反查）
  const bindVia = async (email, provider, register) => {
    const c = await s.login(email, 'Password!12345');
    const start = new URL((await fetch(`${s.base}/api/sso/${provider}/start?bind=1`, { redirect: 'manual', headers: { Cookie: c } })).headers.get('location'));
    const code = 'bind-' + email; register(code);
    await fetch(`${s.base}/api/sso/${provider}/callback?${provider === 'dingtalk' ? 'authCode' : 'code'}=${code}&state=${start.searchParams.get('state')}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + start.searchParams.get('state') } });
    return c;
  };
  api.wecomUsers.set('WuJL', { name: '经理老吴' });
  await bindVia('jl@corp.cn', 'wecom', code => api.wecomCodes.set(code, { userid: 'WuJL' }));
  api.ddUnion.set('union-zhou', 'zhou01');
  const sc = await bindVia('xs@corp.cn', 'dingtalk', code => api.dingCodes.set(code, { corpId: 'ding-corp', user: { unionId: 'union-zhou', nick: '销售小周' } }));
  // 销售提交审批 → 经理收到企业微信文本卡片（含详情链接）
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: '通知客户' }, cookie: sc })).data.item;
  const c = (await s.req('/contracts', { method: 'POST', body: { name: '通知合同', accountId: acc.id, amount: 8800, status: '审批中' }, cookie: sc })).data.item;
  await flush();
  const wm = api.wecomMessages.at(-1);
  assert.equal(wm.touser, 'WuJL'); assert.equal(wm.msgtype, 'textcard'); assert.equal(wm.agentid, 1000002);
  assert.match(wm.textcard.title, /合同待审批/); assert.match(wm.textcard.description, /通知合同/);
  assert.match(wm.textcard.url, /^https:\/\/crm\.example\.com\/#\/contracts\?q=HT/);
  // 经理审批 → 销售收到钉钉工作通知（unionId 反查 userid 并缓存）
  const mc = await s.login('jl@corp.cn', 'Password!12345');
  await s.req(`/contracts/${c.id}/approve`, { method: 'POST', body: { approved: true, note: '同意' }, cookie: mc });
  await flush();
  const dn = api.ddNotices.at(-1);
  assert.equal(dn.userid_list, 'zhou01'); assert.equal(dn.msg.msgtype, 'action_card');
  assert.match(dn.msg.action_card.markdown, /合同审批通过/); assert.match(dn.msg.action_card.markdown, /意见：同意/);
  api.ddUnion.delete('union-zhou'); // 第二次不再反查（已缓存）
  // 分配 → 新负责人收到；成员关闭工作通知后不再发送
  const lead = (await s.req('/leads', { method: 'POST', body: { name: '通知线索' } })).data.item;
  await s.req('/leads/' + lead.id, { method: 'PATCH', body: { ownerId: salesId } });
  await flush();
  assert.match(api.ddNotices.at(-1).msg.action_card.markdown, /通知线索/);
  await s.req('/me', { method: 'PATCH', body: { imNotify: false }, cookie: sc });
  const before = api.ddNotices.length;
  await s.req('/leads/' + lead.id, { method: 'PATCH', body: { ownerId: mgrId } });
  await s.req('/leads/' + lead.id, { method: 'PATCH', body: { ownerId: salesId } });
  await flush();
  assert.equal(api.ddNotices.length, before, '已关闭工作通知');
  assert.equal(api.wecomMessages.at(-1).touser, 'WuJL', '分配给经理时经理收到企业微信消息');
  // 事件过滤：关闭企业微信的“分配”事件
  await s.req('/settings', { method: 'PUT', body: { wecom: { notifyEvents: ['approval', 'digest'] } } });
  const wBefore = api.wecomMessages.length;
  await s.req('/leads/' + lead.id, { method: 'PATCH', body: { ownerId: mgrId } });
  await flush();
  assert.equal(api.wecomMessages.length, wBefore);
  // 每日摘要（未启用邮件也可仅经工作通知发送）
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await s.req('/tasks', { method: 'POST', body: { title: '今天回访', dueDate: today }, cookie: mc });
  const sent = (await s.req('/settings/digest-now', { method: 'POST' })).data.sent;
  assert.ok(sent >= 1);
  assert.match(api.wecomMessages.at(-1).textcard.description, /今天回访/);
  // 测试消息：管理员未绑定时提示
  const tm = await s.req('/settings/im-test', { method: 'POST', body: { provider: 'wecom' } });
  assert.equal(tm.status, 400); assert.match(tm.data.error, /尚未绑定/);
});

test('login returns to the requested page (safe next only)', async t => {
  const api = await mockOpenApi();
  const s = await startServer({ env: { WECOM_API_BASE: api.base } });
  t.after(async () => { await s.stop(); api.close(); });
  await s.req('/settings', { method: 'PUT', body: { wecom: { enabled: true, corpId: 'ww123', agentId: '1000002', secret: 'wecom-secret' } } });
  await s.req('/users', { method: 'POST', body: { email: 'n@corp.cn', name: 'N', password: 'Password!12345', role: 'sales' } });
  api.wecomUsers.set('N1', { name: 'N', email: 'n@corp.cn' });
  const run = async next => {
    const start = new URL((await fetch(`${s.base}/api/sso/wecom/start?next=${encodeURIComponent(next)}`, { redirect: 'manual' })).headers.get('location'));
    const code = 'n' + Math.random(); api.wecomCodes.set(code, { userid: 'N1' });
    return (await fetch(`${s.base}/api/sso/wecom/callback?code=${code}&state=${start.searchParams.get('state')}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + start.searchParams.get('state') } })).headers.get('location');
  };
  assert.equal(await run('#/contracts?q=HT2026001'), '/#/contracts?q=HT2026001');
  for (const evil of ['https://evil.example', '//evil.example', '#/x"><script>', 'javascript:alert(1)']) assert.equal(await run(evil), '/#/dashboard', evil);
});

test('audit log and dashboard activity respect manager data scope', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const mk = (email, role, department, dataScope) => s.req('/users', { method: 'POST', body: { email, name: email, password: 'Password!12345', role, department, dataScope } });
  await mk('a1@x.cn', 'sales', '一部'); await mk('b1@x.cn', 'sales', '二部'); await mk('m1@x.cn', 'manager', '一部', 'dept');
  const a = await s.login('a1@x.cn', 'Password!12345'), b = await s.login('b1@x.cn', 'Password!12345');
  await s.req('/accounts', { method: 'POST', body: { name: '一部客户' }, cookie: a });
  const secret = (await s.req('/accounts', { method: 'POST', body: { name: '二部机密客户' }, cookie: b })).data.item;
  const m = await s.login('m1@x.cn', 'Password!12345');
  const items = (await s.req('/audits', { cookie: m })).data.items;
  assert.ok(items.length > 0);
  assert.ok(!items.some(x => x.entity_id === secret.id), '看不到二部成员的操作');
  assert.ok((await s.req('/audits')).data.items.some(x => x.entity_id === secret.id), '管理员可见全部');
  const recent = (await s.req('/dashboard', { cookie: m })).data.recent;
  assert.ok(recent.every(x => x.entity !== 'users'), '不含管理员创建成员的记录');
});
