'use strict';
/** SQLite 连接与表结构（建表与幂等的加列迁移） */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'crm.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','manager','sales','viewer')),display_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(tenant_id,email));
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expiry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_records_tenant_type ON records(tenant_id,type,deleted);
CREATE TABLE IF NOT EXISTS audits(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audits(tenant_id,at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---------- 结构迁移（V1.0 → V1.1，幂等） ----------
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('tenants', 'settings', "settings TEXT NOT NULL DEFAULT '{}'");
addColumn('users', 'department', "department TEXT NOT NULL DEFAULT ''");
addColumn('users', 'last_login_at', 'last_login_at TEXT');
addColumn('users', 'data_scope', "data_scope TEXT NOT NULL DEFAULT ''");
addColumn('users', 'notif_seen_at', 'notif_seen_at TEXT');
addColumn('users', 'totp_secret', "totp_secret TEXT NOT NULL DEFAULT ''");
addColumn('users', 'totp_enabled', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'totp_last_step', 'totp_last_step INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS login_failures(key TEXT PRIMARY KEY,first_at INTEGER NOT NULL,count INTEGER NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
addColumn('users', 'email_notify', 'email_notify INTEGER NOT NULL DEFAULT 1');
addColumn('users', 'sso_sub', "sso_sub TEXT NOT NULL DEFAULT ''");
db.exec('CREATE TABLE IF NOT EXISTS sso_states(state TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,created_at INTEGER NOT NULL)');
addColumn('sso_states', 'provider', "provider TEXT NOT NULL DEFAULT 'oidc'");
addColumn('sso_states', 'bind_user_id', "bind_user_id TEXT NOT NULL DEFAULT ''");
addColumn('users', 'mobile', "mobile TEXT NOT NULL DEFAULT ''");
addColumn('users', 'im_notify', 'im_notify INTEGER NOT NULL DEFAULT 1');
addColumn('sso_states', 'next_path', "next_path TEXT NOT NULL DEFAULT ''");
/** 第三方身份绑定（企业微信 userid / 钉钉 unionId），每个成员每种方式最多绑定一个 */
db.exec(`CREATE TABLE IF NOT EXISTS identities(tenant_id TEXT NOT NULL,provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(tenant_id,provider,subject));
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_user ON identities(tenant_id,provider,user_id);`);
addColumn('identities', 'ext_userid', "ext_userid TEXT NOT NULL DEFAULT ''");
db.exec(`CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_attach_entity ON attachments(tenant_id,entity,entity_id,deleted);`);
db.exec(`
CREATE INDEX IF NOT EXISTS idx_records_account ON records(tenant_id,type,json_extract(data,'$.accountId')) WHERE deleted=0;
CREATE INDEX IF NOT EXISTS idx_records_contract ON records(tenant_id,type,json_extract(data,'$.contractId')) WHERE deleted=0;
CREATE INDEX IF NOT EXISTS idx_records_opportunity ON records(tenant_id,type,json_extract(data,'$.opportunityId')) WHERE deleted=0;
`);

module.exports = { db };
