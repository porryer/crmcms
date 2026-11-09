'use strict';
/**
 * 从快照恢复：必须先停止服务。
 * 用法：node scripts/restore.js data/backups/crm-xxx.sqlite --yes
 * 步骤：校验快照完整性 → 把当前库及 -wal/-shm 移到 data/pre-restore-<时间>/ → 复制快照为 crm.sqlite。
 */
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const [src, flag] = process.argv.slice(2);
if (!src || flag !== '--yes') { console.error('用法: node scripts/restore.js <快照文件> --yes   （请先停止 CRM 服务）'); process.exit(1); }
if (!fs.existsSync(src)) { console.error('快照不存在:', src); process.exit(1); }

const check = new DatabaseSync(src, { readOnly: true });
const ok = check.prepare('PRAGMA integrity_check').get();
const users = check.prepare('SELECT COUNT(*) n FROM users').get().n;
check.close();
if (Object.values(ok)[0] !== 'ok' || !users) { console.error('快照校验失败：', ok, 'users=', users); process.exit(1); }

const target = path.join(dir, 'crm.sqlite');
const keepDir = path.join(dir, 'pre-restore-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(keepDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(target + suffix)) fs.renameSync(target + suffix, path.join(keepDir, 'crm.sqlite' + suffix));
fs.copyFileSync(src, target);
console.log('恢复完成。原数据库已保存在', keepDir, '，请重新启动服务并核对数据。');
