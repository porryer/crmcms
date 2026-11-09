'use strict';
// V1.3：附件纳入备份、xlsx 导入、邮件通知、两步验证二维码、OIDC 单点登录
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, ROOT } = require('./helpers');

test('backups include attachments and logo; restore brings them back', async t => {
  const s = await startServer();
  let s2 = null; t.after(async () => { if (s2) await s2.stop(); else await s.stop(); });
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: 'A' } })).data.item;
  const up = await s.req(`/attachments?entity=accounts&entityId=${acc.id}`, { method: 'POST', raw: Buffer.from('合同原件内容'), headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('合同.pdf') } });
  assert.equal(up.status, 201);
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const lg = (await s.req('/settings/logo', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png' } })).data.settings;
  assert.match(lg.logoFile, /^logo-/);
  const snap = (await s.req('/backups', { method: 'POST' })).data.name;
  const pool = path.join(s.dir, 'backups', 'files');
  const pooled = fs.readdirSync(pool).flatMap(t0 => fs.readdirSync(path.join(pool, t0)));
  assert.ok(pooled.includes(up.data.item.id) && pooled.includes(lg.logoFile), '附件与 Logo 已进入备份文件池');
  assert.ok(!pooled.some(f => f.endsWith('.tmp')));
  // 第二次备份不重复复制（增量）
  const mtime = fs.statSync(path.join(pool, fs.readdirSync(pool)[0], up.data.item.id)).mtimeMs;
  await new Promise(r => setTimeout(r, 20));
  await s.req('/backups', { method: 'POST' });
  assert.equal(fs.statSync(path.join(pool, fs.readdirSync(pool)[0], up.data.item.id)).mtimeMs, mtime);
  await s.stop(true);
  // 模拟附件目录丢失后恢复
  fs.rmSync(path.join(s.dir, 'files'), { recursive: true, force: true });
  const out = execFileSync(process.execPath, ['scripts/restore.js', path.join(s.dir, 'backups', snap), '--yes'], { cwd: ROOT, env: { ...process.env, DATA_DIR: s.dir } }).toString();
  assert.match(out, /恢复 2 个文件/);
  s2 = await startServer({ dir: s.dir });
  const dl = await fetch(`${s2.base}/api/attachments/${up.data.item.id}/download`, { headers: { Cookie: s2.cookie } });
  assert.equal(await dl.text(), '合同原件内容');
  assert.equal((await fetch(`${s2.base}/api/settings/logo`, { headers: { Cookie: s2.cookie } })).status, 200);
});

test('xlsx import (file produced by openpyxl), xlsx template and export', async t => {
  const XLSX = require('../lib/xlsx');
  const s = await startServer(); t.after(() => s.stop());
  const tpl = await fetch(`${s.base}/api/accounts/import?format=xlsx`, { headers: { Cookie: s.cookie } });
  assert.match(tpl.headers.get('content-type'), /spreadsheetml/);
  assert.deepEqual(XLSX.readRows(Buffer.from(await tpl.arrayBuffer()))[0].slice(0, 2), ['客户名称', '客户类型']);
  const xlsx = fs.readFileSync(path.join(__dirname, 'fixtures', 'accounts.xlsx')).toString('base64');
  const dry = (await s.req('/accounts/import', { method: 'POST', body: { xlsx } })).data;
  assert.equal(dry.total, 2); assert.equal(dry.errorCount, 0);
  assert.equal((await s.req('/accounts/import', { method: 'POST', body: { xlsx, commit: true } })).data.imported, 2);
  const a = (await s.req('/accounts?q=' + encodeURIComponent('表格导入科技'))).data.items[0];
  assert.equal(a.foundedAt, '2019-03-08'); assert.equal(a.phone, '13800138000'); assert.equal(a.level, 'VIP'); assert.equal(a.notes, '含 <特殊> & "符号"');
  assert.equal((await s.req('/accounts/import', { method: 'POST', body: { xlsx: Buffer.from('not a zip').toString('base64') } })).status, 400);
  const ex = await fetch(`${s.base}/api/accounts?format=xlsx`, { headers: { Cookie: s.cookie } });
  assert.match(ex.headers.get('content-disposition'), /accounts\.xlsx/);
  const rows = XLSX.readRows(Buffer.from(await ex.arrayBuffer()));
  assert.ok(rows[0].includes('名称')); assert.ok(rows.some(r => r.includes('表格导入制造')));
});

/** 极简 SMTP 测试服务器：记录 AUTH、收件人与解码后的主题/正文 */
function fakeSmtp() {
  const net = require('node:net');
  const mails = [], auths = [];
  const server = net.createServer(sock => {
    let buf = '', inData = false, cur = null;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            const raw = cur.data.join('\r\n');
            const subj = (raw.match(/^Subject: (.*)$/m) || [])[1] || '';
            const subject = subj.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString());
            const texts = [...raw.matchAll(/Content-Type: text\/(plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?:\r\n--|$)/g)].map(m => Buffer.from(m[2].replace(/\s/g, ''), 'base64').toString());
            mails.push({ ...cur, subject, text: texts[0] || '', html: texts[1] || '' });
            sock.write('250 queued\r\n');
          } else cur.data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) { auths.push(Buffer.from(line.slice(11), 'base64').toString().split('\0')); sock.write('235 ok\r\n'); }
        else if (/^MAIL FROM/.test(line)) { cur = { from: line, to: [], data: [] }; sock.write('250 ok\r\n'); }
        else if (/^RCPT TO:<(.+)>/.test(line)) { cur.to.push(line.match(/<(.+)>/)[1]); sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, mails, auths })));
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 30)); } };

test('email notifications via SMTP: approvals, assignment, opt-out, digest', async t => {
  const smtp = await fakeSmtp();
  const s = await startServer({ env: { PUBLIC_ORIGIN: 'https://crm.example.com' } });
  t.after(async () => { await s.stop(); smtp.server.close(); });
  const bad = await s.req('/settings', { method: 'PUT', body: { smtp: { enabled: true, host: '', from: 'x' } } });
  assert.equal(bad.status, 400);
  const st = (await s.req('/settings', { method: 'PUT', body: { smtp: { enabled: true, host: '127.0.0.1', port: smtp.port, secure: 'none', user: 'robot', pass: 's3cret', from: 'NovaCRM 通知 <crm@example.com>' } } })).data.settings;
  assert.equal(st.smtp.pass, ''); assert.equal(st.smtp.passSet, true, '密码不回传');
  // 测试邮件
  const tm = await s.req('/settings/smtp-test', { method: 'POST' });
  assert.equal(tm.status, 200);
  assert.deepEqual(smtp.auths[0], ['', 'robot', 's3cret']);
  assert.match(smtp.mails[0].subject, /测试邮件/); assert.deepEqual(smtp.mails[0].to, ['admin@local.crm']);
  // 成员
  const mk = (email, name, role) => s.req('/users', { method: 'POST', body: { email, name, password: 'Password!12345', role, dataScope: 'all' } }).then(r => r.data.id);
  const salesId = await mk('sales1@x.cn', '小销', 'sales'), mgr1 = await mk('mgr1@x.cn', '经理一', 'manager'), mgr2 = await mk('mgr2@x.cn', '经理二', 'manager');
  const sc = await s.login('sales1@x.cn', 'Password!12345');
  // 经理二关闭邮件通知
  const m2c = await s.login('mgr2@x.cn', 'Password!12345');
  assert.equal((await s.req('/me', { method: 'PATCH', body: { emailNotify: false }, cookie: m2c })).data.user.emailNotify, false);
  // 提交审批 → 只发给经理一
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: '邮件客户' }, cookie: sc })).data.item;
  const c = (await s.req('/contracts', { method: 'POST', body: { name: '邮件合同', accountId: acc.id, amount: 1000, status: '审批中' }, cookie: sc })).data.item;
  await until(() => smtp.mails.length >= 2);
  const pending = smtp.mails[1];
  assert.deepEqual(pending.to, ['mgr1@x.cn']);
  assert.match(pending.subject, /合同待审批/); assert.match(pending.text, /邮件合同/);
  assert.match(pending.html, /https:\/\/crm\.example\.com\/#\/contracts/);
  // 审批通过 → 通知提交人
  await s.req(`/contracts/${c.id}/approve`, { method: 'POST', body: { approved: true, note: '同意' }, cookie: await s.login('mgr1@x.cn', 'Password!12345') });
  await until(() => smtp.mails.length >= 3);
  assert.deepEqual(smtp.mails[2].to, ['sales1@x.cn']); assert.match(smtp.mails[2].text, /意见：同意/);
  // 分配 → 通知新负责人
  const lead = (await s.req('/leads', { method: 'POST', body: { name: '线索甲' } })).data.item;
  await s.req('/leads/' + lead.id, { method: 'PATCH', body: { ownerId: salesId } });
  await until(() => smtp.mails.length >= 4);
  assert.deepEqual(smtp.mails[3].to, ['sales1@x.cn']); assert.match(smtp.mails[3].text, /线索甲/);
  // 关闭通知的经理二收不到；分配给他不发邮件
  await s.req('/leads/' + lead.id, { method: 'PATCH', body: { ownerId: mgr2 } });
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!smtp.mails.some(m => m.to.includes('mgr2@x.cn')));
  // 每日摘要：小销有今日到期任务
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await s.req('/tasks', { method: 'POST', body: { title: '今天要打的电话', dueDate: today }, cookie: sc });
  const before = smtp.mails.length;
  const dg = (await s.req('/settings/digest-now', { method: 'POST' })).data;
  assert.ok(dg.sent >= 1);
  const digest = smtp.mails.slice(before).find(m => m.to[0] === 'sales1@x.cn');
  assert.match(digest.subject, /今日待办提醒/); assert.match(digest.text, /今天要打的电话/);
  // 非管理员看不到 SMTP 配置
  assert.deepEqual((await s.req('/settings', { cookie: sc })).data.settings.smtp, { enabled: true });
});
