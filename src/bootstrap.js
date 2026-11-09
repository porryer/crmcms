'use strict';
/** 首次安装管理员与版本化数据迁移 */
const crypto = require('node:crypto');
const { db } = require('./db');
const { LEGACY } = require('./constants');
const { newId, now } = require('./util');
const { transaction } = require('./store');
const { hashPwd } = require('./auth');

// ---------- 初始化 ----------
function initAdmin() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const tenant = newId(), admin = newId();
  const password = process.env.CRM_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  if (password.length < 12) throw new Error('CRM_ADMIN_PASSWORD至少12位');
  const email = (process.env.CRM_ADMIN_EMAIL || 'admin@local.crm').toLowerCase();
  db.prepare('INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)').run(tenant, '默认企业', now());
  db.prepare('INSERT INTO users(id,tenant_id,email,password_hash,role,display_name,active,created_at,department) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(admin, tenant, email, hashPwd(password), 'admin', '系统管理员', 1, now(), '管理部');
  console.log('\n========== 首次安装管理员账号 ==========\n邮箱:', email, '\n初始密码:', password, '\n请登录后妥善保管，不要公开此凭据。\n======================================\n');
}
/** 将 V1.0 旧枚举值迁移为新值 */
function migrateLegacyValues() {
  const stmt = db.prepare("UPDATE records SET data=json_set(data,'$.'||?,?) WHERE type=? AND json_extract(data,'$.'||?)=?");
  for (const [type, fields] of Object.entries(LEGACY)) {
    for (const [field, map] of Object.entries(fields)) for (const [from, to] of Object.entries(map)) stmt.run(field, to, type, field, from);
  }
  db.prepare("UPDATE records SET data=json_set(data,'$.method','银行转账') WHERE type='payments' AND json_extract(data,'$.method')='转账'").run();
}
/** 版本化数据迁移（PRAGMA user_version） */
function migrate() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 1) {
    transaction(() => {
      migrateLegacyValues();
      // 金额改为整数分存储
      db.prepare(`UPDATE records SET data=json_remove(json_set(data,'$.amountCents',CAST(ROUND(COALESCE(json_extract(data,'$.amount'),0)*100) AS INTEGER)),'$.amount')
        WHERE type IN ('opportunities','contracts','payments','plans') AND json_extract(data,'$.amountCents') IS NULL`).run();
      // 负责人姓名 → 成员 ID（仅姓名唯一时）
      for (const t of db.prepare('SELECT id FROM tenants').all()) {
        const users = db.prepare('SELECT id,display_name FROM users WHERE tenant_id=?').all(t.id);
        const byName = new Map();
        for (const x of users) byName.set(x.display_name, byName.has(x.display_name) ? null : x.id);
        const upd = db.prepare("UPDATE records SET data=json_set(data,'$.ownerId',?) WHERE tenant_id=? AND json_extract(data,'$.owner')=? AND COALESCE(json_extract(data,'$.ownerId'),'')=''");
        for (const [name, uid] of byName) if (uid) upd.run(uid, t.id, name);
      }
    });
    db.exec('PRAGMA user_version=1');
  }
}

module.exports = { initAdmin, migrate };
