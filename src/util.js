'use strict';
/** 通用工具：ID、时间、金额、记录序列化、HTTP 错误 */
const crypto = require('node:crypto');
const { MONEY_TYPES } = require('./constants');

// ---------- 基础工具 ----------
const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
/** 服务器本地时区的 YYYY-MM-DD（Docker 中通过 TZ 设定为业务时区） */
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDay = v => (!v ? '' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v) ? v.slice(0, 10) : ymd(new Date(v))));
const cents = v => Math.round(Number(v || 0) * 100);
const yuan = c => c / 100;
const sumCents = arr => arr.reduce((a, x) => a + cents(x.amount), 0);
const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur ? 100 : 0));

function row(r) {
  if (!r) return null;
  const d = JSON.parse(r.data);
  if (Object.hasOwn(d, 'amountCents')) { d.amount = d.amountCents / 100; delete d.amountCents; }
  return { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, ...d };
}
/** API 数据 → 落库 JSON（金额转整数分，去掉元数据字段） */
function serialize(type, data) {
  const d = { ...data };
  for (const k of ['id', 'createdAt', 'updatedAt', 'createdBy']) delete d[k];
  if (MONEY_TYPES.has(type) && Object.hasOwn(d, 'amount')) { d.amountCents = Math.round(Number(d.amount || 0) * 100); delete d.amount; }
  return JSON.stringify(d);
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function boom(status, message) { throw httpError(status, message); }

module.exports = { boom, cents, httpError, localDay, newId, now, pad, pct, row, serialize, sumCents, ymd, yuan };
