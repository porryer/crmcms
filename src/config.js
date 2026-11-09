'use strict';
/** 运行配置（环境变量） */
const path = require('node:path');

const VERSION = '1.7.0';
const PORT = Number(process.env.PORT || 3100);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
/** 会话有效期（小时）：SESSION_HOURS，1–720，默认 8；取值无效时回退默认值并告警 */
function sessionHours(raw = process.env.SESSION_HOURS) {
  if (raw === undefined || raw === '') return 8;
  const h = Number(raw);
  if (Number.isFinite(h) && h >= 1 && h <= 720) return h;
  console.warn(`SESSION_HOURS=${raw} 无效（应为 1-720 的小时数），使用默认值 8`);
  return 8;
}
const SESSION_HOURS = sessionHours();
const publicOrigin = () => String(process.env.PUBLIC_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 14);

module.exports = { BACKUP_INTERVAL_HOURS, BACKUP_KEEP, DATA_DIR, PORT, ROOT, SESSION_HOURS, VERSION, publicOrigin, sessionHours };
