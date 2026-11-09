'use strict';
// V1.1 新增接口与审查修复项的集成测试
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacrm-v11-')), port = 33000 + Math.floor(Math.random() * 1000);
const BASE = 'http://127.0.0.1:' + port;
let proc, cookie;
async function req(p, { method = 'GET', body, cookie: auth = cookie, headers = {} } = {}) {
  const r = await fetch(BASE + '/api' + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, cookie: r.headers.get('set-cookie'), headers: r.headers };
}
const login = async (email, password) => { const r = await req('/login', { method: 'POST', body: { email, password }, cookie: '' }); return r.status === 200 ? r.cookie.split(';')[0] : r; };

async function start() {
  proc = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir, PORT: String(port), CRM_ADMIN_PASSWORD: 'TestPassword!1234', PUBLIC_ORIGIN: 'https://crm.example.com' } });
  let logs = ''; proc.stdout.on('data', b => (logs += b)); proc.stderr.on('data', b => (logs += b));
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) throw new Error('Server crashed: ' + logs);
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('Server start timeout ' + logs);
}

test('CRM V1.1 features', async t => {
  await start();
  t.after(async () => { proc.kill('SIGTERM'); await new Promise(r => proc.once('exit', r)); fs.rmSync(dir, { recursive: true, force: true }); });
  cookie = await login('admin@local.crm', 'TestPassword!1234');
  let account, opp, contract;

  await t.test('origin check accepts same-host and PUBLIC_ORIGIN, rejects foreign', async () => {
    assert.equal((await req('/accounts', { method: 'POST', body: { name: 'O1' }, headers: { Origin: `http://127.0.0.1:${port}` } })).status, 201);
    assert.equal((await req('/accounts', { method: 'POST', body: { name: 'O2' }, headers: { Origin: 'https://crm.example.com' } })).status, 201);
    assert.equal((await req('/accounts', { method: 'POST', body: { name: 'O3' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  });

  await t.test('enum validation and legacy value normalisation', async () => {
    account = (await req('/accounts', { method: 'POST', body: { name: '华东科技', source: '官网', industry: '科技/IT' } })).data.item;
    assert.equal((await req('/opportunities', { method: 'POST', body: { name: 'x', accountId: account.id, stage: '乱写' } })).status, 400);
    const legacy = await req('/opportunities', { method: 'POST', body: { name: '旧阶段', accountId: account.id, stage: '谈判签约', amount: 1000 } });
    assert.equal(legacy.data.item.stage, '商务谈判');
    assert.equal((await req('/opportunities', { method: 'POST', body: { name: 'p', accountId: account.id, probability: 150 } })).status, 400);
    assert.equal((await req('/leads', { method: 'POST', body: { name: 'l', status: '已转化' } })).status, 400);
  });

  await t.test('paged list, filters and keyword search incl. referenced account name', async () => {
    for (let i = 0; i < 12; i++) await req('/contacts', { method: 'POST', body: { name: '联系人' + i, accountId: account.id } });
    const page = await req('/contacts?page=2&pageSize=5');
    assert.equal(page.data.total, 12); assert.equal(page.data.items.length, 5); assert.equal(page.data.page, 2);
    assert.equal((await req('/contacts?q=' + encodeURIComponent('华东'))).data.total, 12);
    assert.equal((await req('/opportunities?stage=' + encodeURIComponent('商务谈判'))).data.total, 1);
  });

  await t.test('opportunity -> contract, approval flow, numbering', async () => {
    opp = (await req('/opportunities', { method: 'POST', body: { name: '平台项目', accountId: account.id, amount: 5000, stage: '方案报价' } })).data.item;
    const r = await req(`/opportunities/${opp.id}/contract`, { method: 'POST' });
    assert.equal(r.status, 201); contract = r.data.item;
    assert.match(contract.number, /^HT\d{7}$/); assert.equal(contract.status, '草稿'); assert.equal(contract.amount, 5000);
    assert.equal((await req(`/opportunities/${opp.id}`)).data.item.stage, '赢单');
    assert.equal((await req(`/opportunities/${opp.id}/contract`, { method: 'POST' })).status, 409);
    assert.equal((await req(`/opportunities/${opp.id}`, { method: 'DELETE' })).status, 409, '商机被合同引用不能删除');
    assert.equal((await req('/contracts', { method: 'POST', body: { name: 'dup', accountId: account.id, number: contract.number } })).status, 409);

    await req('/users', { method: 'POST', body: { email: 'sales@local.crm', name: '销售', password: 'Deal!Maker2026x', role: 'sales', dataScope: 'all' } });
    const sc = await login('sales@local.crm', 'Deal!Maker2026x');
    assert.equal((await req(`/contracts/${contract.id}`, { method: 'PATCH', body: { status: '已签订' }, cookie: sc })).status, 403);
    assert.equal((await req(`/contracts/${contract.id}/submit`, { method: 'POST', cookie: sc })).status, 200);
    assert.equal((await req(`/contracts/${contract.id}/approve`, { method: 'POST', body: { approved: true }, cookie: sc })).status, 403);
    const ok = await req(`/contracts/${contract.id}/approve`, { method: 'POST', body: { approved: true, note: '同意' } });
    assert.equal(ok.data.status, '已签订');
    assert.equal((await req(`/contracts/${contract.id}`, { method: 'PATCH', body: { amount: 1 }, cookie: sc })).status, 403, '已审批合同金额销售不可改');
  });

  await t.test('finance summary, plans and voided contract guard', async () => {
    assert.equal((await req('/payments', { method: 'POST', body: { contractId: contract.id, amount: 2000 } })).status, 201);
    assert.equal((await req('/plans', { method: 'POST', body: { contractId: contract.id, amount: 3000, dueDate: '2000-01-01' } })).status, 201);
    const f = (await req('/finance')).data;
    assert.equal(f.totals.receivable, 5000); assert.equal(f.totals.received, 2000); assert.equal(f.totals.outstanding, 3000); assert.equal(f.totals.overdue, 3000);
    assert.equal(f.contracts.find(c => c.id === contract.id).status, '部分回款');
    assert.equal((await req(`/contracts/${contract.id}`, { method: 'DELETE' })).status, 409);
    const v = (await req('/contracts', { method: 'POST', body: { name: '作废', accountId: account.id, amount: 100, status: '已作废' } })).data.item;
    assert.equal((await req('/payments', { method: 'POST', body: { contractId: v.id, amount: 10 } })).status, 409);
  });

  await t.test('lead convert creates account + primary contact; batch assign/delete', async () => {
    const l = (await req('/leads', { method: 'POST', body: { name: '王先生', company: '远景能源', phone: '13800000000', source: '展会' } })).data.item;
    const c = await req(`/leads/${l.id}/convert`, { method: 'POST' });
    assert.ok(c.data.contactId);
    const ov = (await req(`/accounts/${c.data.accountId}/overview`)).data;
    assert.equal(ov.account.source, '展会'); assert.equal(ov.contacts[0].isPrimary, true);
    const l2 = (await req('/leads', { method: 'POST', body: { name: '甲' } })).data.item;
    const a = await req('/leads/batch', { method: 'POST', body: { action: 'assign', ids: [l2.id], owner: '销售' } });
    assert.deepEqual(a.data.done, [l2.id]);
    const got = (await req(`/leads/${l2.id}`)).data.item;
    assert.equal(got.owner, '销售'); assert.equal(got.status, '已分配');
    const d = await req('/accounts/batch', { method: 'POST', body: { action: 'delete', ids: [account.id, c.data.accountId] } });
    assert.equal(d.data.done.length, 0); assert.equal(d.data.failed.length, 2);
  });

  await t.test('dashboard, reports, search', async () => {
    for (const range of ['7d', '30d', 'quarter', 'year']) {
      const d = (await req('/dashboard?range=' + range)).data;
      assert.equal(d.kpis.length, 4); assert.ok(d.trend.length >= 7);
    }
    const y = (await req('/dashboard?range=year')).data;
    assert.equal(y.trend.length, 12); assert.equal(y.trend.reduce((a, x) => a + x.amount, 0), 5000);
    const r = (await req('/reports')).data;
    assert.ok(r.months.length >= 1); assert.equal(r.summary.contractAmount, 5000);
    assert.equal((await req('/reports?from=2026-05-01&to=2026-01-01')).status, 400);
    const csv = await fetch(BASE + '/api/reports?format=csv', { headers: { Cookie: cookie } });
    assert.equal(csv.status, 200); assert.match(await csv.text(), /成交金额/);
    assert.ok((await req('/search?q=' + encodeURIComponent('华东'))).data.results.some(x => x.type === 'accounts'));
  });

  await t.test('CSV export uses Chinese headers, names and neutralises formulas', async () => {
    await req('/accounts', { method: 'POST', body: { name: '=HYPERLINK("http://x")' } });
    const text = await (await fetch(BASE + '/api/accounts?format=csv', { headers: { Cookie: cookie } })).text();
    assert.match(text, /客户/); assert.match(text, /"'=HYPERLINK/);
    const ctext = await (await fetch(BASE + '/api/contacts?format=csv', { headers: { Cookie: cookie } })).text();
    assert.match(ctext, /华东科技/);
  });

  await t.test('settings and user management guards', async () => {
    const s = await req('/settings', { method: 'PUT', body: { companyName: '测试公司', dicts: { leadSources: ['官网', '抖音'] } } });
    assert.equal(s.data.settings.companyName, '测试公司'); assert.deepEqual(s.data.settings.dicts.leadSources, ['官网', '抖音']);
    assert.equal((await req('/settings', { method: 'PUT', body: { dicts: { industries: [] } } })).status, 400);
    const users = (await req('/users')).data.items;
    const admin = users.find(u => u.role === 'admin'), sales = users.find(u => u.role === 'sales');
    assert.equal((await req(`/users/${admin.id}`, { method: 'PATCH', body: { active: false } })).status, 400);
    const sc = await login('sales@local.crm', 'Deal!Maker2026x');
    assert.equal((await req('/settings', { method: 'PUT', body: { companyName: 'x' }, cookie: sc })).status, 403);
    assert.equal((await req('/users', { cookie: sc })).data.items[0].email, undefined, '非经理不返回成员邮箱');
    assert.equal((await req(`/users/${sales.id}`, { method: 'PATCH', body: { active: false, department: '销售部' } })).status, 200);
    assert.equal((await req('/me', { cookie: sc })).status, 401, '停用后会话立即失效');
  });

  await t.test('login brute-force lockout', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login('nobody@local.crm', 'wrong')).status, 401);
    assert.equal((await login('nobody@local.crm', 'wrong')).status, 429);
  });

  await t.test('static pages carry strict CSP', async () => {
    const r = await fetch(BASE + '/');
    assert.match(r.headers.get('content-security-policy'), /style-src 'self'/);
    assert.equal((await fetch(BASE + '/favicon.svg')).status, 200);
  });
});
