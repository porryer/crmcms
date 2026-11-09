'use strict';
/**
 * 零依赖 SMTP 客户端：SSL(465) / STARTTLS(587) / 明文(内网中继)，AUTH PLAIN/LOGIN，
 * UTF-8 主题（RFC 2047）与 base64 正文，multipart/alternative（纯文本 + HTML）。
 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const os = require('node:os');

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const encodeHeader = s => { s = String(s).replace(/[\r\n]+/g, ' '); return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; };
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');
const addr = a => String(a).replace(/[\r\n<>]/g, '').trim();
/** "名称 <a@b.c>" → 编码显示名 */
function formatAddress(a) {
  const m = String(a).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m && m[1] ? `${encodeHeader(m[1].replace(/"/g, ''))} <${addr(m[2])}>` : addr(m ? m[2] : a);
}
const bareAddress = a => { const m = String(a).match(/<([^>]+)>/); return addr(m ? m[1] : a); };

function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'b_' + crypto.randomBytes(12).toString('hex');
  const headers = [
    `From: ${formatAddress(from)}`, `To: ${to.map(formatAddress).join(', ')}`, `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${crypto.randomUUID()}@${bareAddress(from).split('@')[1] || 'novacrm.local'}>`,
    'MIME-Version: 1.0', 'Auto-Submitted: auto-generated',
  ];
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}`;
  const body = html
    ? `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${part('text/plain', text || '')}${part('text/html', html)}--${boundary}--\r\n`
    : `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(text || ''))}`;
  // 点填充：行首的 "." 需写成 ".."（base64 不会出现，此处为稳妥）
  return (headers.join('\r\n') + '\r\n' + body).replace(/\r\n\./g, '\r\n..');
}

/**
 * 发送一封邮件；cfg: { host, port, secure: 'ssl'|'starttls'|'none', user, pass, from, timeoutMs, ca }
 * 证书始终校验（主机名 + 证书链）；ca 可选，用于企业内部 CA 签发的邮件服务器证书。
 */
function sendMail(cfg, msg) {
  return new Promise((resolve, reject) => {
    const timeoutMs = cfg.timeoutMs || 15000;
    const opts = { host: cfg.host, port: Number(cfg.port) || (cfg.secure === 'ssl' ? 465 : 587), servername: cfg.host, ...(cfg.ca ? { ca: cfg.ca } : {}) };
    let socket = cfg.secure === 'ssl' ? tls.connect(opts) : net.connect(opts);
    let buf = '', waiter = null, done = false;
    const finish = err => { if (done) return; done = true; clearTimeout(timer); try { socket.end(); } catch { /* ignore */ } err ? reject(err) : resolve(); };
    const timer = setTimeout(() => { finish(new Error('SMTP 超时')); socket.destroy(); }, timeoutMs);
    const onData = d => {
      buf += d.toString('utf8');
      // 多行响应以 "xyz " 结束
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null; if (w) w(resp);
          return onData('');
        }
      }
    };
    const attach = s => { s.on('data', onData); s.on('error', e => finish(e)); };
    attach(socket);
    const expect = code => new Promise((res, rej) => { waiter = resp => (resp.startsWith(String(code)) ? res(resp) : rej(new Error(`SMTP 错误：${resp.split('\n').pop()}`))); });
    const cmd = (line, code) => { const p = expect(code); socket.write(line + '\r\n'); return p; };
    const ehloName = os.hostname().replace(/[^\w.-]/g, '') || 'localhost';
    (async () => {
      await expect(220);
      let caps = await cmd(`EHLO ${ehloName}`, 250);
      if (cfg.secure === 'starttls') {
        if (!/STARTTLS/i.test(caps)) throw new Error('服务器不支持 STARTTLS');
        await cmd('STARTTLS', 220);
        socket.removeAllListeners('data');
        socket = tls.connect({ socket, servername: cfg.host, ...(cfg.ca ? { ca: cfg.ca } : {}) });
        attach(socket);
        await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
        caps = await cmd(`EHLO ${ehloName}`, 250);
      }
      if (cfg.user) {
        if (/AUTH[^\n]*PLAIN/i.test(caps)) await cmd('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass || ''}`).toString('base64'), 235);
        else { await cmd('AUTH LOGIN', 334); await cmd(b64(cfg.user), 334); await cmd(b64(cfg.pass || ''), 235); }
      }
      await cmd(`MAIL FROM:<${bareAddress(cfg.from)}>`, 250);
      for (const r of msg.to) await cmd(`RCPT TO:<${bareAddress(r)}>`, 250);
      await cmd('DATA', 354);
      await cmd(buildMessage({ ...msg, from: cfg.from }) + '\r\n.', 250);
      socket.write('QUIT\r\n');
      finish();
    })().catch(finish);
  });
}

module.exports = { sendMail, buildMessage, encodeHeader };
