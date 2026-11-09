'use strict';
/** HTTP 服务：静态资源、Origin 校验、访问日志、错误处理 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT } = require('./config');
const { boom } = require('./util');
const { clientIp } = require('./auth');
const { SECURITY_HEADERS, logJson, send, sendFileStream } = require('./http');
const { api } = require('./routes/index');

// ---------- 静态资源 ----------
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function staticFile(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const base = path.resolve(ROOT, 'public');
  const file = path.resolve(base, '.' + requested);
  if (!file.startsWith(base + path.sep)) boom(403, '禁止访问');
  let st;
  try { st = fs.statSync(file); } catch { boom(404, '页面不存在'); }
  if (!st.isFile()) boom(404, '页面不存在');
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', ...SECURITY_HEADERS,
  });
  sendFileStream(res, file);
}

/** 允许的 Origin：PUBLIC_ORIGIN（可逗号分隔多个）以及与 Host 一致的同源地址 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 非浏览器或同源导航；SameSite=Lax Cookie 已阻止跨站携带
  const allowed = new Set(String(process.env.PUBLIC_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean));
  if (req.headers.host) { allowed.add(`http://${req.headers.host}`); allowed.add(`https://${req.headers.host}`); }
  return allowed.has(origin);
}
/** 结构化访问日志（ACCESS_LOG=1 开启，每行一条 JSON，便于 Loki/ELK/云日志采集） */
const ACCESS_LOG = process.env.ACCESS_LOG === '1';
const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const rid = /^[\w-]{8,64}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', rid);
  if (ACCESS_LOG) {
    res.on('finish', () => {
      const path0 = req.url.split('?')[0];
      if (path0 === '/api/health') return;
      logJson({ type: 'access', rid, ip: clientIp(req), method: req.method, path: path0, status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6, uid: req.uid || null });
    });
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) boom(405, 'Method not allowed');
      if (req.method !== 'GET' && !originAllowed(req)) boom(403, '跨站请求被拒绝');
      await api(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      staticFile(req, res, url);
    } else boom(405, 'Method not allowed');
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '服务器内部错误' });
    else res.end();
    if (!e.status) logJson({ type: 'error', rid, method: req.method, path: req.url.split('?')[0], message: e.message, stack: e.stack });
  }
});

module.exports = { server };
