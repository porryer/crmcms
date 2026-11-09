'use strict';
/**
 * 备份 = SQLite 在线一致性快照（VACUUM INTO） + 附件增量文件池。
 * 附件文件写入后不再修改（以附件 ID / logo-<哈希> 命名），故文件池按文件名增量复制，
 * 多份快照共享同一文件池；清理时仅保留仍被保留快照引用的文件。
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const backupDir = dataDir => path.join(dataDir, 'backups');
const poolDir = dataDir => path.join(backupDir(dataDir), 'files');
const PATTERN = /^crm-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sqlite$/;

function listBackups(dataDir) {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => PATTERN.test(f)).map(name => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, createdAt: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

/** 快照中引用的附件文件：Set('<tenant>/<file>') */
function referencedFiles(snapshotPath) {
  const refs = new Set();
  const db = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    try { for (const r of db.prepare('SELECT tenant_id,id FROM attachments').all()) refs.add(`${r.tenant_id}/${r.id}`); } catch { /* 旧版本无附件表 */ }
    for (const t of db.prepare('SELECT id,settings FROM tenants').all()) {
      try { const s = JSON.parse(t.settings || '{}'); if (s.logoFile) refs.add(`${t.id}/${s.logoFile}`); else if (s.logo) refs.add(`${t.id}/logo`); } catch { /* ignore */ }
    }
  } finally { db.close(); }
  return refs;
}

/** 增量同步 data/files → backups/files（只复制池中不存在的文件） */
function syncFiles(dataDir) {
  const src = path.join(dataDir, 'files');
  let copied = 0;
  if (!fs.existsSync(src)) return copied;
  for (const tenant of fs.readdirSync(src)) {
    const from = path.join(src, tenant), to = path.join(poolDir(dataDir), tenant);
    if (!fs.statSync(from).isDirectory()) continue;
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) {
      if (f.includes('.tmp') || !fs.statSync(path.join(from, f)).isFile()) continue;
      if (!fs.existsSync(path.join(to, f))) { fs.copyFileSync(path.join(from, f), path.join(to, f)); copied++; }
    }
  }
  return copied;
}

function prunePool(dataDir) {
  const pool = poolDir(dataDir);
  if (!fs.existsSync(pool)) return 0;
  const keep = new Set();
  for (const b of listBackups(dataDir)) for (const r of referencedFiles(path.join(backupDir(dataDir), b.name))) keep.add(r);
  let removed = 0;
  for (const tenant of fs.readdirSync(pool)) {
    for (const f of fs.readdirSync(path.join(pool, tenant))) if (!keep.has(`${tenant}/${f}`)) { fs.rmSync(path.join(pool, tenant, f), { force: true }); removed++; }
  }
  return removed;
}

/** 生成快照（含附件增量）并按 keep 清理旧快照与无引用文件；返回新快照路径 */
function backup(db, dataDir, keep = 14) {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'crm-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
  db.exec('VACUUM INTO ' + "'" + dest.replaceAll("'", "''") + "'");
  syncFiles(dataDir);
  if (keep > 0) {
    for (const old of listBackups(dataDir).slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
    prunePool(dataDir);
  }
  return dest;
}

/** 从文件池恢复快照引用的附件，返回 { restored, missing } */
function restoreFiles(dataDir, snapshotPath) {
  let restored = 0; const missing = [];
  for (const ref of referencedFiles(snapshotPath)) {
    const [tenant, f] = ref.split('/');
    const target = path.join(dataDir, 'files', tenant, f), src = path.join(poolDir(dataDir), tenant, f);
    if (fs.existsSync(target)) continue;
    if (!fs.existsSync(src)) { missing.push(ref); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target); restored++;
  }
  return { restored, missing };
}

module.exports = { backup, listBackups, backupDir, poolDir, PATTERN, syncFiles, prunePool, restoreFiles, referencedFiles };
