'use strict';
/** SQLite 在线一致性快照（VACUUM INTO）+ 保留策略 */
const fs = require('node:fs');
const path = require('node:path');

const backupDir = dataDir => path.join(dataDir, 'backups');
const PATTERN = /^crm-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sqlite$/;

function listBackups(dataDir) {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => PATTERN.test(f)).map(name => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, createdAt: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

/** 生成快照并按 keep 数量清理旧快照；返回新快照路径 */
function backup(db, dataDir, keep = 14) {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'crm-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
  db.exec('VACUUM INTO ' + "'" + dest.replaceAll("'", "''") + "'");
  if (keep > 0) for (const old of listBackups(dataDir).slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
  return dest;
}

module.exports = { backup, listBackups, backupDir, PATTERN };
