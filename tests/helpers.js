'use strict';
// 测试辅助：在隔离数据目录中启动服务进程
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ROOT = path.join(__dirname, '..');

async function startServer({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacrm-t-')), env = {} } = {}) {
  // PORT=0 由系统分配空闲端口，从启动日志读取实际端口，避免并行测试端口冲突
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: '0', CRM_ADMIN_PASSWORD: 'TestPassword!1234', BACKUP_INTERVAL_HOURS: '0', ...env } });
  let logs = ''; proc.stdout.on('data', b => (logs += b)); proc.stderr.on('data', b => (logs += b));
  let base = '';
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) throw new Error('Server crashed: ' + logs);
    const m = logs.match(/listening on http:\/\/localhost:(\d+)/);
    if (m) { base = 'http://127.0.0.1:' + m[1]; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  if (!base) throw new Error('Server start timeout ' + logs);
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
/** 模拟 OIDC 身份提供方：发现文档、JWKS、令牌端点（校验客户端认证与 PKCE），签发 RS256 id_token */
async function mockIdp() {
  const http = require('node:http'), crypto = require('node:crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const kid = 'k1', codes = new Map(), idp = { codes, base: '' };
  const sign = (claims, key = privateKey, header = { alg: 'RS256', kid }) => {
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${enc(header)}.${enc(claims)}`;
    return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
  };
  const server = http.createServer((req, res) => {
    const json = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/.well-known/openid-configuration') return json(200, { issuer: idp.base, authorization_endpoint: idp.base + '/authorize', token_endpoint: idp.base + '/token', jwks_uri: idp.base + '/jwks', token_endpoint_auth_methods_supported: ['client_secret_basic'] });
    if (req.url === '/jwks') return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    if (req.url === '/token' && req.method === 'POST') {
      let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
        const f = new URLSearchParams(body), c = codes.get(f.get('code'));
        if (req.headers.authorization !== 'Basic ' + Buffer.from('crm-app:top-secret').toString('base64')) return json(401, { error: 'invalid_client' });
        if (!c) return json(400, { error: 'invalid_grant' });
        codes.delete(f.get('code'));
        const challenge = crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url');
        if (challenge !== c.challenge || f.get('redirect_uri') !== c.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'PKCE 或 redirect_uri 不匹配' });
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: idp.base, aud: 'crm-app', sub: 'sub-1', iat: now, exp: now + 300, nonce: c.nonce, email: 'sso@x.cn', email_verified: true, name: 'SSO 用户', ...c.claims };
        json(200, { access_token: 'at', token_type: 'Bearer', id_token: sign(claims, c.key === 'evil' ? evil : privateKey) });
      });
      return;
    }
    if (req.url.startsWith('/authorize')) { // 浏览器流程：直接“同意”并回跳
      const q = new URL(req.url, idp.base).searchParams, code = 'b' + crypto.randomBytes(6).toString('hex');
      codes.set(code, { challenge: q.get('code_challenge'), nonce: q.get('nonce'), redirectUri: q.get('redirect_uri'), claims: idp.browserClaims || {} });
      res.writeHead(302, { Location: `${q.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(q.get('state'))}` }); return res.end();
    }
    json(404, {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  idp.base = `http://127.0.0.1:${server.address().port}`;
  idp.close = () => server.close();
  return idp;
}

module.exports = { startServer, ROOT, mockIdp };
