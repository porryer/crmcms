'use strict';
// 测试辅助：在隔离数据目录中启动服务进程
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ROOT = path.join(__dirname, '..');

async function startServer({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacrm-t-')), env = {} } = {}) {
  const port = 34000 + Math.floor(Math.random() * 6000);
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), CRM_ADMIN_PASSWORD: 'TestPassword!1234', BACKUP_INTERVAL_HOURS: '0', ...env } });
  let logs = ''; proc.stdout.on('data', b => (logs += b)); proc.stderr.on('data', b => (logs += b));
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('Server crashed: ' + logs);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 80));
    if (i === 99) throw new Error('Server start timeout ' + logs);
  }
  const client = { base, dir, proc, cookie: '', logs: () => logs };
  client.req = async (p, { method = 'GET', body, cookie = client.cookie, headers = {}, raw } = {}) => {
    const r = await fetch(base + '/api' + p, { method, headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  client.login = async (email, password, extra = {}) => {
    const r = await client.req('/login', { method: 'POST', body: { email, password, ...extra }, cookie: '' });
    return r.status === 200 ? r.cookie : r;
  };
  client.stop = async (keep = false) => {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await new Promise(r => proc.once('exit', r)); }
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  };
  client.cookie = await client.login('admin@local.crm', 'TestPassword!1234');
  return client;
}
module.exports = { startServer, ROOT };
