'use strict';
// V1.3：附件纳入备份、xlsx 导入、邮件通知、两步验证二维码、OIDC 单点登录
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, ROOT, mockIdp } = require('./helpers');
const { sessionCookie } = require('./helpers');

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

test('QR code encoder: structure, format info and versions (decoded externally with ZXing during development)', async t => {
  const QR = require('../lib/qrcode');
  const { dataCodewords } = QR._internal;
  // 纠错等级 M 的数据码字数（ISO/IEC 18004 表 7、9：总码字 - 纠错码字）
  assert.deepEqual([1, 2, 7, 8, 10, 40].map(v => dataCodewords(v)), [16, 28, 124, 154, 216, 2334]);
  const sizeFor = n => QR.matrix('a'.repeat(n)).length;
  assert.equal(sizeFor(14), 21); assert.equal(sizeFor(15), 25); assert.equal(sizeFor(150), 49);
  const TOTP = require('../lib/totp');
  for (const text of ['A', TOTP.otpauthUri(TOTP.generateSecret(), 'admin@local.crm', 'NovaCRM'), '中文 ✓'.repeat(40)]) {
    const m = QR.matrix(text), n = m.length;
    // 三个定位图形中心 3x3 为深色、外圈第 2 层为浅色
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) { assert.equal(m[cy][cx], true); assert.equal(m[cy - 2][cx], false); assert.equal(m[cy - 3][cx], true); }
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    // 两份格式信息一致，BCH 校验有效，纠错等级为 M（00）
    const bitsA = [0, 1, 2, 3, 4, 5, 7, 8].map(i => m[i][8]).concat([7, 5, 4, 3, 2, 1, 0].map(i => m[8][i]));
    const bitsB = Array.from({ length: 8 }, (_, i) => m[8][n - 1 - i]).concat(Array.from({ length: 7 }, (_, i) => m[n - 7 + i][8]));
    assert.deepEqual(bitsA, bitsB);
    const fmt = bitsA.reduce((a, b, i) => a | ((b ? 1 : 0) << i), 0) ^ 0x5412;
    let rem = fmt >>> 10; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    assert.equal(rem & 0x3ff, fmt & 0x3ff, 'BCH 校验');
    assert.equal(fmt >>> 13, 0, '纠错等级 M');
    assert.equal(m[n - 8][8], true, '固定深色模块');
    if (n >= 45) { // 版本 ≥7 的版本信息
      const ver = (n - 17) / 4;
      const vb = Array.from({ length: 18 }, (_, i) => (m[Math.floor(i / 3)][n - 11 + (i % 3)] ? 1 : 0) << i).reduce((a, b) => a | b, 0);
      assert.equal(vb >>> 12, ver);
    }
  }
  const svg = QR.toSvg('hello');
  assert.match(svg, /^<svg[^>]+viewBox="0 0 29 29"/); assert.doesNotMatch(svg, /hello/);
  // MFA 接口返回二维码
  const s = await startServer(); t.after(() => s.stop());
  assert.match((await s.req('/mfa/setup', { method: 'POST' })).data.qrSvg, /^<svg/);
});

test('OIDC single sign-on', async t => {
  const idp = await mockIdp();
  const s = await startServer({ env: { SSO_ALLOW_HTTP: '1', PUBLIC_ORIGIN: 'http://crm.local' } });
  t.after(async () => { await s.stop(); idp.close(); });
  /** 走一遍 start → (模拟 IdP 授权) → callback，返回 { location, cookie } */
  const flow = async ({ claims = {}, key, mutate, noCookie } = {}) => {
    const start = await fetch(s.base + '/api/sso/start', { redirect: 'manual' });
    const auth = new URL(start.headers.get('location'));
    assert.equal(auth.origin, idp.base); assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    const code = 'c' + Math.random();
    idp.codes.set(code, { challenge: auth.searchParams.get('code_challenge'), nonce: auth.searchParams.get('nonce'), redirectUri: auth.searchParams.get('redirect_uri'), claims, key });
    let state = auth.searchParams.get('state');
    if (mutate) state = mutate(state);
    const cb = await fetch(`${s.base}/api/sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + (noCookie ? '' : auth.searchParams.get('state')) } });
    return { status: cb.status, location: decodeURIComponent(cb.headers.get('location') || ''), cookie: sessionCookie(cb), state };
  };
  assert.equal((await (await fetch(s.base + '/api/sso/config')).json()).enabled, false);
  assert.equal((await s.req('/settings', { method: 'PUT', body: { sso: { enabled: true, issuer: 'ftp://x', clientId: 'a' } } })).status, 400);
  assert.equal((await s.req('/settings', { method: 'PUT', body: { sso: { enabled: true, issuer: 'http://127.0.0.1:1', clientId: 'a' } } })).status, 400, '发现文档不可达');
  const st = (await s.req('/settings', { method: 'PUT', body: { sso: { enabled: true, issuer: idp.base, clientId: 'crm-app', clientSecret: 'top-secret', buttonText: '飞书/企业账号登录' } } })).data.settings.sso;
  assert.equal(st.clientSecret, ''); assert.equal(st.secretSet, true); assert.equal(st.redirectUri, 'http://crm.local/api/sso/callback');
  assert.deepEqual(await (await fetch(s.base + '/api/sso/config')).json(), { enabled: true, buttonText: '飞书/企业账号登录', enforce: false, providers: [{ id: 'oidc', text: '飞书/企业账号登录', url: '/api/sso/start' }] });

  // 未开通的账号
  assert.match((await flow()).location, /尚未在系统中开通/);
  // 已开通账号登录成功
  const uid = (await s.req('/users', { method: 'POST', body: { email: 'SSO@x.cn', name: '单点用户', password: 'Password!12345', role: 'sales' } })).data.id;
  const ok = await flow();
  assert.equal(ok.location, '/#/dashboard'); assert.ok(ok.cookie);
  assert.equal((await s.req('/me', { cookie: ok.cookie })).data.user.id, uid);
  // state 只能使用一次 / 伪造 state
  assert.match((await fetch(`${s.base}/api/sso/callback?code=x&state=${ok.state}`, { redirect: 'manual', headers: { Cookie: 'crm_sso_state=' + ok.state } })).headers.get('location'), /sso_error/);
  // state 必须与发起登录的浏览器绑定（防登录 CSRF）
  assert.match((await flow({ noCookie: true })).location, /当前浏览器不匹配/);
  assert.match((await flow({ mutate: () => 'forged' })).location, /已失效/);
  // 各类令牌异常
  assert.match((await flow({ claims: { nonce: 'other' } })).location, /nonce/);
  assert.match((await flow({ claims: { aud: 'another-app' } })).location, /受众/);
  assert.match((await flow({ claims: { iss: 'https://evil.example' } })).location, /签发方/);
  assert.match((await flow({ key: 'evil' })).location, /签名无效/);
  assert.match((await flow({ claims: { exp: Math.floor(Date.now() / 1000) - 600 } })).location, /过期/);
  assert.match((await flow({ claims: { email_verified: false } })).location, /未验证/);
  // 首次登录后绑定 sub，邮箱被他人身份冒用时拒绝
  assert.match((await flow({ claims: { sub: 'sub-2' } })).location, /已绑定其他身份/);
  assert.equal((await s.req('/users')).data.items.find(x => x.id === uid).ssoBound, 1);
  // 自动开通
  await s.req('/settings', { method: 'PUT', body: { sso: { autoCreate: true, defaultRole: 'viewer', defaultDept: '销售部' } } });
  const auto = await flow({ claims: { sub: 'sub-9', email: 'newbie@x.cn', name: '新同事' } });
  assert.equal(auto.location, '/#/dashboard');
  const nu = (await s.req('/me', { cookie: auto.cookie })).data.user;
  assert.equal(nu.role, 'viewer'); assert.equal(nu.name, '新同事'); assert.equal(nu.department, '销售部');
  // 强制单点登录：非管理员不能用密码登录，管理员可以
  await s.req('/settings', { method: 'PUT', body: { sso: { enforce: true } } });
  const pw = await s.login('sso@x.cn', 'Password!12345');
  assert.equal(pw.status, 403); assert.match(pw.data.error, /单点登录/);
  assert.equal(typeof await s.login('admin@local.crm', 'TestPassword!1234'), 'string');
});

test('oversized uploads never crash the server (regression: unhandled stream error)', async t => {
  const s = await startServer({ env: { ATTACH_MAX_MB: '1' } }); t.after(() => s.stop());
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: 'A' } })).data.item;
  const up = size => fetch(`${s.base}/api/attachments?entity=accounts&entityId=${acc.id}`, { method: 'POST', body: Buffer.alloc(size), headers: { Cookie: s.cookie, 'Content-Type': 'application/pdf', 'X-File-Name': 'big.pdf' } }).then(r => r.status, e => e.cause?.code || e.message);
  for (let round = 0; round < 3; round++) {
    const statuses = await Promise.all(Array.from({ length: 15 }, (_, i) => up(1024 * 1024 + 1 + i * 40000)));
    assert.deepEqual([...new Set(statuses)], [413]);
  }
  assert.equal((await s.req('/health')).status, 200, '服务仍在运行');
  assert.equal(s.proc.exitCode, null);
  assert.equal(await up(1000), 201, '正常上传不受影响');
});
