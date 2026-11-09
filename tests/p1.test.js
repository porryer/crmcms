'use strict';
// P1：批量导入、附件与 Logo、对账单、自定义字段、站内通知与 Webhook、多级审批
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers');

test('CSV import: template, dry run, errors, commit', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const tpl = await fetch(s.base + '/api/accounts/import', { headers: { Cookie: s.cookie } });
  assert.equal(tpl.status, 200); assert.match(await tpl.text(), /客户名称/);
  await s.req('/accounts', { method: 'POST', body: { name: '已存在公司' } });
  const csv = '﻿*客户名称,行业,客户级别,负责人,成立时间,未知列\n"新公司,A",科技/IT,VIP,系统管理员,2020/3/5,x\n已存在公司,,,,,\n新公司B,,,查无此人,,\n';
  const dry = (await s.req('/accounts/import', { method: 'POST', body: { csv } })).data;
  assert.equal(dry.total, 3); assert.equal(dry.valid, 1); assert.equal(dry.errorCount, 2);
  assert.deepEqual(dry.errors.map(e => e.line), [3, 4]); assert.deepEqual(dry.ignoredColumns, ['未知列']);
  assert.equal((await s.req('/accounts/import', { method: 'POST', body: { csv, commit: true } })).status, 400);
  assert.equal((await s.req('/accounts')).data.total, 1, '有错误时整体不导入');
  const ok = (await s.req('/accounts/import', { method: 'POST', body: { csv: '客户名称,行业,成立时间\n"新公司,A",科技/IT,2020/3/5\n新公司B,,\n', commit: true } })).data;
  assert.equal(ok.imported, 2);
  const a = (await s.req('/accounts?q=' + encodeURIComponent('新公司,A'))).data.items[0];
  assert.equal(a.foundedAt, '2020-03-05'); assert.equal(a.owner, '系统管理员');
  // 联系人按客户名称关联、商机金额带千分位
  const c = (await s.req('/contacts/import', { method: 'POST', body: { csv: '姓名,客户名称,主联系人\n王五,新公司B,是\n赵六,不存在的公司,否\n' } })).data;
  assert.equal(c.valid, 1); assert.match(c.errors[0].error, /不存在/);
  const o = (await s.req('/opportunities/import', { method: 'POST', body: { csv: '商机名称,客户,预计金额,赢率,阶段\n项目X,新公司B,"¥1,200.50",40%,需求确认\n', commit: true } })).data;
  assert.equal(o.imported, 1);
  assert.equal((await s.req('/opportunities')).data.items[0].amount, 1200.5);
  assert.equal((await s.req('/payments/import', { method: 'POST', body: { csv: 'a\n1' } })).status, 404);
});

test('attachments and logo', async t => {
  const s = await startServer({ env: { ATTACH_MAX_MB: '1' } }); t.after(() => s.stop());
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: 'A' } })).data.item;
  const up = (name, body, type = 'application/octet-stream') => s.req(`/attachments?entity=accounts&entityId=${acc.id}`, { method: 'POST', raw: body, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) } });
  const r = await up('合同扫描件.pdf', Buffer.from('%PDF-1.4 test'));
  assert.equal(r.status, 201);
  assert.equal((await up('evil.html', Buffer.from('<script>'))).status, 415);
  assert.equal((await up('big.pdf', Buffer.alloc(1024 * 1024 + 10))).status, 413);
  const list = (await s.req(`/attachments?entity=accounts&entityId=${acc.id}`)).data.items;
  assert.equal(list.length, 1); assert.equal(list[0].name, '合同扫描件.pdf');
  const dl = await fetch(`${s.base}/api/attachments/${r.data.item.id}/download`, { headers: { Cookie: s.cookie } });
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.match(dl.headers.get('content-security-policy'), /sandbox/);
  assert.equal(await dl.text(), '%PDF-1.4 test');
  // 无权查看客户的销售不能访问附件
  await s.req('/users', { method: 'POST', body: { email: 's@x.cn', name: 'S', password: 'Password!12345', role: 'sales' } });
  const sc = await s.login('s@x.cn', 'Password!12345');
  assert.equal((await s.req(`/attachments/${r.data.item.id}/download`, { cookie: sc })).status, 404);
  assert.equal((await s.req(`/attachments?entity=accounts&entityId=${acc.id}`, { cookie: sc })).status, 404);
  assert.equal((await s.req(`/attachments/${r.data.item.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await s.req(`/attachments?entity=accounts&entityId=${acc.id}`)).data.items.length, 0);
  // Logo
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  assert.equal((await s.req('/settings/logo', { method: 'POST', raw: Buffer.from('<svg/>'), headers: { 'Content-Type': 'image/svg+xml' } })).status, 415);
  const lg = await s.req('/settings/logo', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(lg.data.settings.logo, 'image/png');
  const img = await fetch(s.base + '/api/settings/logo', { headers: { Cookie: s.cookie } });
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await s.req('/settings/logo', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' }, cookie: sc })).status, 403);
});

test('reconciliation statement', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: '对账客户' } })).data.item;
  const c1 = (await s.req('/contracts', { method: 'POST', body: { name: '老合同', accountId: acc.id, amount: 1000, status: '已签订', signedAt: '2026-01-10' } })).data.item;
  const c2 = (await s.req('/contracts', { method: 'POST', body: { name: '新合同', accountId: acc.id, amount: 500, status: '已签订', signedAt: '2026-03-05' } })).data.item;
  await s.req('/contracts', { method: 'POST', body: { name: '草稿不计', accountId: acc.id, amount: 999, signedAt: '2026-03-06' } });
  await s.req('/payments', { method: 'POST', body: { contractId: c1.id, amount: 400, paidAt: '2026-02-01' } });
  await s.req('/payments', { method: 'POST', body: { contractId: c1.id, amount: 100.5, paidAt: '2026-03-10' } });
  await s.req('/payments', { method: 'POST', body: { contractId: c2.id, amount: 200, paidAt: '2026-04-01' } });
  const r = (await s.req(`/statements?accountId=${acc.id}&from=2026-03-01&to=2026-03-31`)).data;
  assert.deepEqual(r.summary[0], { accountId: acc.id, accountName: '对账客户', opening: 600, debit: 500, credit: 100.5, closing: 999.5 });
  assert.deepEqual(r.lines.map(l => [l.date, l.balance]), [['2026-03-05', 1100], ['2026-03-10', 999.5]]);
  const all = (await s.req('/statements?from=2026-01-01&to=2026-12-31')).data;
  assert.equal(all.totals.closing, 799.5);
  const csv = await (await fetch(`${s.base}/api/statements?accountId=${acc.id}&from=2026-03-01&to=2026-03-31&format=csv`, { headers: { Cookie: s.cookie } })).text();
  assert.match(csv, /期初余额/); assert.match(csv, /999.5/);
  assert.equal((await s.req('/statements?from=2026-05-01&to=2026-01-01')).status, 400);
});

test('custom fields', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const st = (await s.req('/settings', { method: 'PUT', body: { customFields: { accounts: [{ label: '统一社会信用代码', type: 'text', required: true, inList: true }, { label: '规模', type: 'select', options: '小,中,大' }, { label: '员工数', type: 'number' }] } } })).data.settings;
  const [code, size, staff] = st.customFields.accounts;
  assert.match(code.key, /^cf_/); assert.deepEqual(size.options, ['小', '中', '大']);
  assert.equal((await s.req('/accounts', { method: 'POST', body: { name: 'A' } })).status, 400, '必填自定义字段');
  assert.equal((await s.req('/accounts', { method: 'POST', body: { name: 'A', [code.key]: 'X1', [size.key]: '特大' } })).status, 400);
  assert.equal((await s.req('/accounts', { method: 'POST', body: { name: 'A', [code.key]: 'X1', [staff.key]: 'abc' } })).status, 400);
  const a = (await s.req('/accounts', { method: 'POST', body: { name: 'A', [code.key]: '91310000X', [size.key]: '中', [staff.key]: '120', cf_hacker: 'x' } })).data.item;
  assert.equal(a[code.key], '91310000X'); assert.equal(a[staff.key], 120); assert.equal(a.cf_hacker, undefined);
  assert.equal((await s.req('/accounts/' + a.id, { method: 'PATCH', body: { phone: '1' } })).status, 200, '编辑时不强制未提交的必填字段');
  const csv = await (await fetch(s.base + '/api/accounts?format=csv', { headers: { Cookie: s.cookie } })).text();
  assert.match(csv, /统一社会信用代码/); assert.match(csv, /91310000X/);
  // 导入识别自定义列
  const imp = (await s.req('/accounts/import', { method: 'POST', body: { csv: '客户名称,统一社会信用代码,规模\nB,X2,大\n', commit: true } })).data;
  assert.equal(imp.imported, 1);
  assert.equal((await s.req('/settings', { method: 'PUT', body: { customFields: { payments: [{ label: 'x' }] } } })).status, 400);
  assert.equal((await s.req('/settings', { method: 'PUT', body: { customFields: { accounts: [{ label: 'x', type: 'select' }] } } })).status, 400);
});

test('multi-level approval, notifications and webhook', async t => {
  const hits = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { hits.push(JSON.parse(b)); res.end('{}'); }); });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  const s = await startServer({ env: { WEBHOOK_ALLOW_HTTP: '1' } });
  t.after(async () => { await s.stop(); hook.close(); });
  const hookUrl = `http://127.0.0.1:${hook.address().port}/hook`;
  assert.equal((await s.req('/settings', { method: 'PUT', body: { webhook: { url: 'ftp://x' } } })).status, 400);
  const st = (await s.req('/settings', { method: 'PUT', body: { approval: { levels: [{ name: '经理审批', role: 'manager', minAmount: 0 }, { name: '总经理审批', role: 'admin', minAmount: 100000 }] }, webhook: { url: hookUrl, kind: 'wecom', events: ['approval', 'assign'] } } })).data.settings;
  assert.equal(st.approval.levels.length, 2);
  const mk = (email, name, role) => s.req('/users', { method: 'POST', body: { email, name, password: 'Password!12345', role, dataScope: 'all' } });
  const salesId = (await mk('s@x.cn', '小销', 'sales')).data.id; await mk('m@x.cn', '经理', 'manager'); await mk('m2@x.cn', '经理二', 'manager');
  const sc = await s.login('s@x.cn', 'Password!12345'), mc = await s.login('m@x.cn', 'Password!12345');
  // 非管理员看不到 webhook 地址
  assert.equal((await s.req('/settings', { cookie: sc })).data.settings.webhook.url, undefined);
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: 'A' }, cookie: sc })).data.item;
  const small = (await s.req('/contracts', { method: 'POST', body: { name: '小单', accountId: acc.id, amount: 5000 }, cookie: sc })).data.item;
  const big = (await s.req('/contracts', { method: 'POST', body: { name: '大单', accountId: acc.id, amount: 200000, status: '审批中' }, cookie: sc })).data.item;
  assert.equal(big.status, '审批中'); assert.equal(big.approvalLevels.length, 2);
  assert.equal((await s.req(`/contracts/${small.id}/submit`, { method: 'POST', cookie: sc })).data.levels.length, 1);
  // 经理看到两条待审批通知
  const n = (await s.req('/notifications', { cookie: mc })).data;
  assert.equal(n.items.filter(x => x.type === 'approval').length, 2); assert.ok(n.unread >= 2);
  assert.equal((await s.req(`/contracts/${big.id}/approve`, { method: 'POST', body: { approved: true }, cookie: sc })).status, 403);
  let r = (await s.req(`/contracts/${big.id}/approve`, { method: 'POST', body: { approved: true, note: '同意' }, cookie: mc })).data;
  assert.equal(r.status, '审批中'); assert.equal(r.pending.name, '总经理审批');
  assert.equal((await s.req(`/contracts/${big.id}/approve`, { method: 'POST', body: { approved: true }, cookie: mc })).status, 403, '经理不能审批总经理级');
  r = (await s.req(`/contracts/${big.id}/approve`, { method: 'POST', body: { approved: true } })).data;
  assert.equal(r.status, '已签订');
  const hist = (await s.req(`/contracts/${big.id}`)).data.item.approvalHistory;
  assert.deepEqual(hist.map(h => h.action), ['submit', 'approve', 'approve']);
  // 驳回回到草稿
  assert.equal((await s.req(`/contracts/${small.id}/approve`, { method: 'POST', body: { approved: false, note: '价格过低' }, cookie: mc })).data.status, '草稿');
  // 销售收到审批结果通知
  const ns = (await s.req('/notifications', { cookie: sc })).data;
  assert.ok(ns.items.some(x => x.type === 'approve' && x.title === '合同审批通过'));
  assert.ok(ns.items.some(x => x.type === 'reject' && /价格过低/.test(x.text)));
  await s.req('/notifications', { method: 'POST', cookie: sc });
  assert.equal((await s.req('/notifications', { cookie: sc })).data.unread, 0);
  // 非管理员不能直接把草稿合同改为已签订
  assert.equal((await s.req(`/contracts/${small.id}`, { method: 'PATCH', body: { status: '已签订' }, cookie: mc })).status, 403);
  // 分配通知
  const lead = (await s.req('/leads', { method: 'POST', body: { name: '线索X', ownerId: salesId }, cookie: mc })).data.item;
  assert.ok((await s.req('/notifications', { cookie: sc })).data.items.some(x => x.type === 'assign' && x.text === lead.name));
  // 任务到期
  const today = new Date(); const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await s.req('/tasks', { method: 'POST', body: { title: '今天的事', dueDate: d }, cookie: sc });
  assert.ok((await s.req('/notifications', { cookie: sc })).data.items.some(x => x.type === 'task'));
  // webhook：待审批 ×3（大单两级+小单）+ 结果 ×2，企业微信 markdown 格式
  await new Promise(r2 => setTimeout(r2, 300));
  assert.ok(hits.length >= 5, 'webhook hits ' + hits.length);
  assert.ok(hits.every(h => h.msgtype === 'markdown' && h.markdown.content));
  assert.ok(hits.some(h => /合同审批通过/.test(h.markdown.content)));
});
