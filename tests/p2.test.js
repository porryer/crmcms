'use strict';
// P2：查询优化接口、可观测性、安全加固（TOTP 两步验证、密码策略、持久化登录限流）
const test = require('node:test'), assert = require('node:assert/strict');
const TOTP = require('../lib/totp');
const { startServer } = require('./helpers');

test('TOTP matches RFC 6238 test vector', () => {
  const secret = TOTP.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(TOTP.totp(secret, 59 * 1000), '287082');
  assert.equal(TOTP.totp(secret, 1111111109 * 1000), '081804');
  assert.equal(TOTP.verify(secret, '287082', 59 * 1000), 1);
  assert.equal(TOTP.verify(secret, '000000', 59 * 1000), -1);
});

test('MFA enrolment, two-step login, replay protection, admin reset', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const setup = (await s.req('/mfa/setup', { method: 'POST' })).data;
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  assert.equal((await s.req('/mfa/enable', { method: 'POST', body: { code: '000000' } })).status, 400);
  assert.equal((await s.req('/mfa/enable', { method: 'POST', body: { code: TOTP.totp(setup.secret) } })).status, 200);
  assert.equal((await s.req('/me')).data.user.mfaEnabled, true);
  const step1 = await s.login('admin@local.crm', 'TestPassword!1234');
  assert.equal(step1.status, 401); assert.equal(step1.data.mfaRequired, true);
  assert.equal((await s.login('admin@local.crm', 'TestPassword!1234', { otp: '123456' })).status, 401);
  // 启用时已用过当前时间步的动态码，重放被拒绝；用下一时间步的动态码可登录
  assert.equal((await s.login('admin@local.crm', 'TestPassword!1234', { otp: TOTP.totp(setup.secret) })).status, 401);
  const next = TOTP.totp(setup.secret, Date.now() + 30000);
  const c = await s.login('admin@local.crm', 'TestPassword!1234', { otp: next });
  assert.equal(typeof c, 'string', '下一时间窗口的动态码可登录');
  assert.equal((await s.login('admin@local.crm', 'TestPassword!1234', { otp: next })).status, 401, '同一动态码不能重复使用');
  // 管理员为成员重置两步验证
  const uid = (await s.req('/users', { method: 'POST', body: { email: 'm@x.cn', name: 'M', password: 'Password!12345', role: 'manager' }, cookie: c })).data.id;
  const mc = await s.login('m@x.cn', 'Password!12345');
  const ms = (await s.req('/mfa/setup', { method: 'POST', cookie: mc })).data;
  await s.req('/mfa/enable', { method: 'POST', body: { code: TOTP.totp(ms.secret) }, cookie: mc });
  assert.equal((await s.req('/users', { cookie: c })).data.items.find(x => x.id === uid).mfaEnabled, 1);
  await s.req('/users/' + uid, { method: 'PATCH', body: { resetMfa: true }, cookie: c });
  assert.equal((await s.req('/me', { cookie: mc })).status, 401, '重置后会话失效');
  assert.equal(typeof await s.login('m@x.cn', 'Password!12345'), 'string', '重置后无需动态码');
  // 关闭需密码 + 动态码
  const sec2 = TOTP.totp(setup.secret, Date.now() + 60000);
  assert.equal((await s.req('/mfa/disable', { method: 'POST', body: { password: 'wrong', code: sec2 }, cookie: c })).status, 403);
  assert.equal((await s.req('/mfa/disable', { method: 'POST', body: { password: 'TestPassword!1234', code: TOTP.totp(setup.secret) }, cookie: c })).status, 200);
});

test('password policy and persistent login lockout', async t => {
  const s = await startServer();
  let s2 = null;
  t.after(async () => { if (s2) await s2.stop(); else await s.stop(); });
  for (const [i, [pw, ok]] of [['short1!A', false], ['alllowercaseletters', false], ['lowercase123456', false], ['Lower1234567', true], ['Alice!Secret99', false]].entries()) {
    const r = await s.req('/users', { method: 'POST', body: { email: i === 4 ? 'alice@x.cn' : `user${i}@x.cn`, name: 'A', password: pw, role: 'sales' } });
    assert.equal(r.status === 201, ok, pw + ' -> ' + JSON.stringify(r.data));
  }
  assert.equal((await s.req('/password', { method: 'POST', body: { oldPassword: 'TestPassword!1234', newPassword: 'admin_password_1' } })).status, 400);
  for (let i = 0; i < 5; i++) await s.login('ghost@x.cn', 'nope');
  assert.equal((await s.login('ghost@x.cn', 'nope')).status, 429);
  await s.stop(true);
  s2 = await startServer({ dir: s.dir });
  assert.equal((await s2.login('ghost@x.cn', 'nope')).status, 429, '重启后锁定仍然有效');
  assert.equal(typeof await s2.login('admin@local.crm', 'TestPassword!1234'), 'string', '其他账号不受影响');
});

test('health, request id and structured access log', async t => {
  const s = await startServer({ env: { ACCESS_LOG: '1' } }); t.after(() => s.stop());
  const h = await s.req('/health');
  assert.equal(h.data.db, 'ok'); assert.ok(h.data.uptimeSec >= 0);
  assert.match(h.headers.get('x-request-id'), /^[0-9a-f]{16}$/);
  const r = await s.req('/accounts', { headers: { 'X-Request-Id': 'trace-abc-123' } });
  assert.equal(r.headers.get('x-request-id'), 'trace-abc-123');
  await new Promise(x => setTimeout(x, 50));
  const line = s.logs().split('\n').find(l => l.includes('trace-abc-123'));
  const entry = JSON.parse(line);
  assert.equal(entry.type, 'access'); assert.equal(entry.path, '/api/accounts'); assert.equal(entry.status, 200); assert.ok(entry.uid);
  assert.ok(!s.logs().includes('"path":"/api/health"'), '健康检查不写访问日志');
});

test('list items carry related names; lookup respects data scope', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = (await s.req('/accounts', { method: 'POST', body: { name: '华东科技' } })).data.item;
  const o = (await s.req('/opportunities', { method: 'POST', body: { name: '项目', accountId: a.id, amount: 10 } })).data.item;
  const c = (await s.req('/contracts', { method: 'POST', body: { name: '合同', accountId: a.id, opportunityId: o.id, amount: 10 } })).data.item;
  await s.req('/payments', { method: 'POST', body: { contractId: c.id, amount: 5 } });
  const pay = (await s.req('/payments?page=1')).data.items[0];
  assert.equal(pay.contractLabel, `${c.number} 合同`); assert.equal(pay.contractAccountName, '华东科技');
  const got = (await s.req('/contracts/' + c.id)).data.item;
  assert.equal(got.accountName, '华东科技'); assert.equal(got.opportunityName, '项目');
  assert.equal((await s.req('/lookup?type=accounts&q=' + encodeURIComponent('华东'))).data.items[0].label, '华东科技');
  assert.equal((await s.req(`/lookup?type=opportunities&accountId=${a.id}`)).data.items.length, 1);
  assert.equal((await s.req('/lookup?type=leads')).status, 400);
  await s.req('/users', { method: 'POST', body: { email: 'x@x.cn', name: 'X', password: 'Password!12345', role: 'sales' } });
  const xc = await s.login('x@x.cn', 'Password!12345');
  assert.equal((await s.req('/lookup?type=accounts', { cookie: xc })).data.items.length, 0);
  assert.equal((await s.req(`/lookup?type=accounts&ids=${a.id}`, { cookie: xc })).data.items.length, 0);
});
