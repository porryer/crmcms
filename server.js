'use strict';
/**
 * NovaCRM —— 零依赖 Node HTTP + 内置 SQLite 服务端（入口）
 * 业务记录以 JSON 存储在 records 表，按 tenant_id 隔离；所有写操作写审计日志。
 * 各模块位于 src/，本文件只负责初始化数据、启动服务与定时任务。
 */
const backups = require('./lib/backup');
const { VERSION, PORT, DATA_DIR, BACKUP_INTERVAL_HOURS, BACKUP_KEEP } = require('./src/config');
const { db } = require('./src/db');
const { TABLES, STAGES } = require('./src/constants');
const { purgeSessions, pruneLoginFailures } = require('./src/auth');
const { logJson } = require('./src/http');
const { sendDigests, pendingMail } = require('./src/notify');
const { initAdmin, migrate } = require('./src/bootstrap');
const { server } = require('./src/app');

initAdmin();
migrate();
purgeSessions();

const housekeeping = setInterval(() => { purgeSessions(); pruneLoginFailures(); }, 3600 * 1000);
housekeeping.unref();

// ---------- 每日摘要邮件 ----------
const DIGEST_TIME = /^\d{1,2}:\d{2}$/.test(process.env.DIGEST_TIME || '') ? process.env.DIGEST_TIME : '08:30';
if (require.main === module) {
  setInterval(() => {
    const d = new Date(), [h, mi] = DIGEST_TIME.split(':').map(Number);
    if (d.getHours() * 60 + d.getMinutes() >= h * 60 + mi) sendDigests().catch(e => logJson({ type: 'digest_error', message: e.message }));
  }, 5 * 60 * 1000).unref();
}

// ---------- 定时备份 ----------
function scheduledBackup() {
  try { console.log('[backup] 已生成', backups.backup(db, DATA_DIR, BACKUP_KEEP)); } catch (e) { console.error('[backup] 失败', e); }
}
if (require.main === module && BACKUP_INTERVAL_HOURS > 0) {
  const latest = backups.listBackups(DATA_DIR)[0];
  const due = !latest || Date.now() - new Date(latest.createdAt) > BACKUP_INTERVAL_HOURS * 3600000;
  if (due) setTimeout(scheduledBackup, 60 * 1000).unref();
  setInterval(scheduledBackup, BACKUP_INTERVAL_HOURS * 3600000).unref();
}

if (require.main === module) {
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`NovaCRM V${VERSION} listening on http://localhost:${server.address().port}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
module.exports = { server, db, TABLES, STAGES, sendDigests, pendingMail };
