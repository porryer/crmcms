'use strict';
/** RFC 6238 TOTP（SHA-1、6 位、30 秒），兼容 Google / Microsoft Authenticator、阿里云/腾讯身份宝等 */
const crypto = require('node:crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1e6).padStart(6, '0');
}
const step = (t = Date.now()) => Math.floor(t / 30000);
const totp = (secret, t = Date.now()) => hotp(secret, step(t));

/** 校验验证码，允许 ±1 个时间窗口；返回命中的时间步（用于防重放），失败返回 -1 */
function verify(secret, code, t = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return -1;
  const now = step(t);
  for (const s of [now, now - 1, now + 1]) {
    const expected = Buffer.from(hotp(secret, s)), got = Buffer.from(code);
    if (crypto.timingSafeEqual(expected, got)) return s;
  }
  return -1;
}
const otpauthUri = (secret, account, issuer) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { generateSecret, totp, verify, otpauthUri, base32Encode, base32Decode, hotp };
