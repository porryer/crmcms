'use strict';
// 手动备份：npm run backup（可与服务同时运行）。BACKUP_KEEP 控制保留份数，默认 14。
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { backup } = require('../lib/backup');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const file = path.join(dir, 'crm.sqlite');
if (!fs.existsSync(file)) { console.error('数据库不存在，请先启动一次CRM'); process.exit(1); }
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=5000');
const dest = backup(db, dir, Number(process.env.BACKUP_KEEP ?? 14));
db.close();
console.log('备份完成:', dest);
