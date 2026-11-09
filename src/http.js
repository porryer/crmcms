'use strict';
/** HTTP 工具：JSON 响应、请求体、导出、重定向、日志 */
const fs = require('node:fs');
const CSV = require('../lib/csv');
const XLSX = require('../lib/xlsx');
const { httpError, now } = require('./util');

const SECURITY_HEADERS = process.env.COOKIE_SECURE === '1' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {};
// ---------- HTTP 工具 ----------
/** 流式发送文件；读取出错时中止响应而不是让未处理的 error 事件导致进程崩溃 */
function sendFileStream(res, file) {
  const rs = fs.createReadStream(file);
  rs.on('error', e => { logJson({ type: 'error', message: `读取文件失败：${e.message}` }); res.destroy(); });
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
};
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = []; let len = 0, failed = false;
    req.on('data', chunk => {
      len += chunk.length;
      if (failed) { if (len > limit + 16 * 1048576) { req.destroy(); reject(httpError(413, '请求体过大')); } return; }
      if (len > limit) { failed = true; parts.length = 0; return; }
      parts.push(chunk);
    });
    req.on('end', () => {
      if (failed) return reject(httpError(413, '请求体过大'));
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(httpError(400, 'JSON格式错误')); }
    });
    req.on('error', reject);
  });
}
/** 防 CSV 公式注入：以 = + - @ 制表/回车开头的单元格前加单引号 */
const csv = CSV.stringify;
/** 导出表格：?format=xlsx 输出 Excel，否则输出 UTF-8 BOM CSV */
function sendCSV(res, filename, headers, rows) {
  const xlsx = res.exportFormat === 'xlsx';
  if (xlsx) filename = filename.replace(/\.csv$/, '.xlsx');
  const body = xlsx ? XLSX.writeWorkbook(headers, rows.map(r => r.map(v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v))), filename.replace(/\.xlsx$/, '').slice(0, 31)) : csv(headers, rows);
  res.writeHead(200, {
    'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'no-store',
  });
  res.end(body);
}
const isExport = url => ['csv', 'xlsx'].includes(url.searchParams.get('format'));
/** 302 跳转 */
function redirect(res, location, headers = {}) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers }); res.end(); }
/** 结构化日志：每行一条 JSON */
function logJson(obj) { process.stdout.write(JSON.stringify({ t: now(), ...obj }) + '\n'); }
/** 路由未匹配时返回，交给下一组路由 */
const NEXT = Symbol('next');

module.exports = { NEXT, SECURITY_HEADERS, isExport, logJson, readBody, redirect, send, sendCSV, sendFileStream };
