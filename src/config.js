'use strict';
/** 运行配置（环境变量） */
const path = require('node:path');

const VERSION = '1.6.0';
const PORT = Number(process.env.PORT || 3100);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SESSION_HOURS = 8;
const publicOrigin = () => String(process.env.PUBLIC_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 14);

module.exports = { BACKUP_INTERVAL_HOURS, BACKUP_KEEP, DATA_DIR, PORT, ROOT, SESSION_HOURS, VERSION, publicOrigin };
