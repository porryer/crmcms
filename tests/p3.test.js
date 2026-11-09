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
