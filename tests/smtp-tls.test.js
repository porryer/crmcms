'use strict';
/**
 * SMTP 加密通道测试：SSL（465 隐式 TLS）与 STARTTLS（587），
 * 证书校验（不受信任 / 主机名不符必须拒绝）与 STARTTLS 降级防护。
 * 证书在测试时用 openssl 临时生成（不入库私钥）；无 openssl 时跳过。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
const { sendMail } = require('../lib/smtp');

function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-tls-'));
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  const out = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

let creds = null;
try { creds = makeCert(); } catch { /* 无 openssl */ }
const skip = creds ? false : '需要 openssl 生成测试证书';

/**
 * 假 SMTP 服务器。mode: 'ssl' 连接即 TLS；'starttls' 明文握手后升级；
 * advertiseStarttls=false 模拟被中间人剥离 STARTTLS 能力。
 * 记录每条命令及其收到时连接是否已加密。
 */
function fakeServer(mode, { advertiseStarttls = true } = {}) {
  const log = [], mails = [];
  const handle = (sock, encrypted) => {
    let buf = '', inData = false, data = [];
    const onLine = line => {
      if (inData) {
        if (line === '.') { inData = false; mails.push(data.join('\r\n')); data = []; sock.write('250 queued\r\n'); }
        else data.push(line);
        return;
      }
      log.push({ line, encrypted });
      if (/^EHLO/.test(line)) {
        const caps = ['250-fake'];
        if (!encrypted && mode === 'starttls' && advertiseStarttls) caps.push('250-STARTTLS');
        caps.push('250 AUTH PLAIN LOGIN');
        sock.write(caps.join('\r\n') + '\r\n');
      } else if (line === 'STARTTLS') {
        sock.write('220 go ahead\r\n');
        sock.removeAllListeners('data');
        const secure = new tls.TLSSocket(sock, { isServer: true, ...creds });
        secure.on('error', () => {});
        handle(secure, true);
      } else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
      else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
      else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    };
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); onLine(l); }
    });
    sock.on('error', () => {});
  };
  const server = mode === 'ssl'
    ? tls.createServer(creds, s => { s.write('220 fake ESMTPS\r\n'); handle(s, true); })
    : net.createServer(s => { s.write('220 fake ESMTP\r\n'); handle(s, false); });
  server.on('tlsClientError', () => {});
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, log, mails })));
}

const cfgFor = (srv, secure, extra = {}) => ({
  host: 'localhost', port: srv.port, secure, user: 'robot', pass: 's3cret',
  from: 'NovaCRM <crm@example.com>', ca: creds && creds.cert, timeoutMs: 5000, ...extra,
});
const msg = { to: ['a@example.com'], subject: '加密测试', text: '正文' };

test('SMTP over implicit TLS (ssl): credentials and message only on the encrypted channel', { skip }, async t => {
  const srv = await fakeServer('ssl'); t.after(() => srv.server.close());
  await sendMail(cfgFor(srv, 'ssl'), msg);
  assert.equal(srv.mails.length, 1);
  assert.ok(srv.log.length > 0 && srv.log.every(e => e.encrypted), '所有命令均经 TLS');
  assert.ok(srv.log.some(e => /^AUTH PLAIN/.test(e.line)));
});

test('SMTP STARTTLS: upgrades before AUTH, re-EHLOs, delivers', { skip }, async t => {
  const srv = await fakeServer('starttls'); t.after(() => srv.server.close());
  await sendMail(cfgFor(srv, 'starttls'), msg);
  assert.equal(srv.mails.length, 1);
  assert.match(srv.mails[0], /Subject: =\?UTF-8\?B\?/);
  const plain = srv.log.filter(e => !e.encrypted).map(e => e.line.split(' ')[0]);
  assert.deepEqual(plain, ['EHLO', 'STARTTLS'], '升级前只发送 EHLO 与 STARTTLS');
  const enc = srv.log.filter(e => e.encrypted).map(e => e.line.split(' ')[0]);
  assert.deepEqual(enc.slice(0, 2), ['EHLO', 'AUTH'], '升级后重新 EHLO 再认证');
});

test('SMTP STARTTLS refuses to continue when the server does not offer it (no downgrade)', { skip }, async t => {
  const srv = await fakeServer('starttls', { advertiseStarttls: false }); t.after(() => srv.server.close());
  await assert.rejects(sendMail(cfgFor(srv, 'starttls'), msg), /不支持 STARTTLS/);
  assert.ok(!srv.log.some(e => /^AUTH|^MAIL/.test(e.line)), '未明文发送凭证或邮件');
  assert.equal(srv.mails.length, 0);
});

test('SMTP TLS rejects untrusted certificates and host name mismatch', { skip }, async t => {
  for (const mode of ['ssl', 'starttls']) {
    const srv = await fakeServer(mode); t.after(() => srv.server.close());
    // 不提供 CA：自签名证书不受信任
    await assert.rejects(sendMail(cfgFor(srv, mode, { ca: undefined }), msg), /self[- ]signed|certificate/i, `${mode} 不受信任证书`);
    // 证书为 localhost，用 IP 连接：主机名不符
    await assert.rejects(sendMail(cfgFor(srv, mode, { host: '127.0.0.1' }), msg), /altnames|IP|certificate/i, `${mode} 主机名不符`);
    assert.ok(!srv.log.some(e => /^AUTH|^MAIL/.test(e.line)), `${mode} 未发送凭证`);
    assert.equal(srv.mails.length, 0);
  }
});
