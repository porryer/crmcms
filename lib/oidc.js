'use strict';
/**
 * 零依赖 OpenID Connect 客户端：发现文档、授权码 + PKCE、id_token（JWS RS256/ES256）校验。
 */
const crypto = require('node:crypto');

const b64url = buf => Buffer.from(buf).toString('base64url');
const cache = new Map(); // key -> { at, value }
const TTL = 3600 * 1000;

async function getJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`${url} 返回非 JSON（HTTP ${r.status}）`); }
  if (!r.ok) throw new Error(data.error_description || data.error || `HTTP ${r.status}`);
  return data;
}
async function cached(key, loader) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const discover = issuer => cached('disc:' + issuer, () => getJson(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration'));

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

async function authorizeUrl(cfg, { state, nonce, challenge, redirectUri }) {
  const d = await discover(cfg.issuer);
  const u = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri, scope: cfg.scope || 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
  return u.toString();
}

async function exchangeCode(cfg, { code, verifier, redirectUri }) {
  const d = await discover(cfg.issuer);
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: cfg.clientId });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const methods = d.token_endpoint_auth_methods_supported || ['client_secret_basic'];
  if (cfg.clientSecret) {
    if (methods.includes('client_secret_basic')) headers.Authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
    else body.set('client_secret', cfg.clientSecret);
  }
  const tok = await getJson(d.token_endpoint, { method: 'POST', headers, body });
  if (!tok.id_token) throw new Error('令牌响应中缺少 id_token');
  return tok;
}

/** 校验 id_token 并返回 claims */
async function verifyIdToken(cfg, idToken, { nonce, now = Date.now() } = {}) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('id_token 格式错误');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const alg = header.alg;
  if (!['RS256', 'ES256'].includes(alg)) throw new Error(`不支持的签名算法：${alg}`);
  const d = await discover(cfg.issuer);
  let jwks = await cached('jwks:' + d.jwks_uri, () => getJson(d.jwks_uri));
  let jwk = jwks.keys.find(k => k.kid === header.kid) || (!header.kid && jwks.keys.length === 1 ? jwks.keys[0] : null);
  if (!jwk) { // 密钥轮换：强制刷新一次
    cache.delete('jwks:' + d.jwks_uri);
    jwks = await cached('jwks:' + d.jwks_uri, () => getJson(d.jwks_uri));
    jwk = jwks.keys.find(k => k.kid === header.kid);
  }
  if (!jwk) throw new Error('找不到签名公钥');
  if ((alg === 'RS256' && jwk.kty !== 'RSA') || (alg === 'ES256' && jwk.kty !== 'EC')) throw new Error('密钥类型与算法不符');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${parts[0]}.${parts[1]}`), sig = Buffer.from(parts[2], 'base64url');
  const ok = alg === 'RS256' ? crypto.verify('RSA-SHA256', data, key, sig) : crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
  if (!ok) throw new Error('id_token 签名无效');
  const sec = Math.floor(now / 1000), skew = 120;
  if (claims.iss !== (d.issuer || cfg.issuer)) throw new Error('签发方不匹配');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new Error('受众不匹配');
  if (aud.length > 1 && claims.azp && claims.azp !== cfg.clientId) throw new Error('azp 不匹配');
  if (!(claims.exp > sec - skew)) throw new Error('id_token 已过期');
  if (claims.iat && claims.iat > sec + skew) throw new Error('id_token 签发时间异常');
  if (nonce && claims.nonce !== nonce) throw new Error('nonce 不匹配');
  return claims;
}

module.exports = { discover, pkce, authorizeUrl, exchangeCode, verifyIdToken, clearCache: () => cache.clear() };
