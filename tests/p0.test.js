'use strict';
// P0：行级数据权限、负责人 ID、整数分存储、版本迁移、备份恢复
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { startServer, ROOT } = require('./helpers');

test('row-level data scope and owner ids', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const mk = async (email, name, role, department, dataScope) => (await s.req('/users', { method: 'POST', body: { email, name, password: 'Password!12345', role, department, dataScope } })).data.id;
  const a = await mk('a@x.cn', '销售甲', 'sales', '一部'), b = await mk('b@x.cn', '销售乙', 'sales', '一部'), c = await mk('c@x.cn', '销售丙', 'sales', '二部');
  await mk('m@x.cn', '经理', 'manager', '一部', 'dept');
  const ca = await s.login('a@x.cn', 'Password!12345'), cb = await s.login('b@x.cn', 'Password!12345'), cc = await s.login('c@x.cn', 'Password!12345'), cm = await s.login('m@x.cn', 'Password!12345');

  // 默认负责人为创建人
  const accA = (await s.req('/accounts', { method: 'POST', body: { name: '甲的客户' }, cookie: ca })).data.item;
  assert.equal(accA.ownerId, a); assert.equal(accA.owner, '销售甲');
  const accC = (await s.req('/accounts', { method: 'POST', body: { name: '丙的客户' }, cookie: cc })).data.item;
  await s.req('/contacts', { method: 'POST', body: { name: '联系人A', accountId: accA.id }, cookie: ca });
  const con = (await s.req('/contracts', { method: 'POST', body: { name: '甲合同', accountId: accA.id, amount: 100 }, cookie: ca })).data.item;
  await s.req('/payments', { method: 'POST', body: { contractId: con.id, amount: 10 }, cookie: ca });

  // 本人范围：只见自己的及其子记录
  assert.deepEqual((await s.req('/accounts', { cookie: ca })).data.items.map(x => x.name), ['甲的客户']);
  assert.equal((await s.req('/contacts', { cookie: ca })).data.total, 1);
  assert.equal((await s.req('/payments', { cookie: ca })).data.total, 1);
  assert.equal((await s.req('/accounts', { cookie: cb })).data.total, 0);
  assert.equal((await s.req('/payments', { cookie: cb })).data.total, 0);
  assert.equal((await s.req('/accounts/' + accA.id, { cookie: cb })).status, 404);
  assert.equal((await s.req('/accounts/' + accA.id, { method: 'PATCH', body: { name: 'x' }, cookie: cb })).status, 404);
  assert.equal((await s.req('/contacts', { method: 'POST', body: { name: '越权', accountId: accA.id }, cookie: cb })).status, 400);
  assert.equal((await s.req('/accounts/' + accA.id + '/overview', { cookie: cb })).status, 404);
  assert.equal((await s.req('/finance', { cookie: cb })).data.totals.receivable, 0);
  assert.equal((await s.req('/search?q=' + encodeURIComponent('甲'), { cookie: cb })).data.results.length, 0);
  // 本人范围不能分配给他人
  assert.equal((await s.req('/accounts/' + accA.id, { method: 'PATCH', body: { ownerId: b }, cookie: ca })).status, 403);
  // 部门经理：看到一部（甲、乙）而非二部
  const mNames = (await s.req('/accounts', { cookie: cm })).data.items.map(x => x.name);
  assert.ok(mNames.includes('甲的客户')); assert.ok(!mNames.includes('丙的客户'));
  assert.equal((await s.req('/accounts/' + accA.id, { method: 'PATCH', body: { ownerId: b }, cookie: cm })).status, 200);
  assert.equal((await s.req('/accounts/' + accC.id, { method: 'PATCH', body: { ownerId: b }, cookie: cm })).status, 404);
  assert.equal((await s.req('/accounts/batch', { method: 'POST', body: { action: 'assign', ids: [accA.id], ownerId: c }, cookie: cm })).status, 403);
  // 转给乙后：乙能看到客户与其合同、回款；甲（合同负责人）仍能看到合同
  assert.equal((await s.req('/accounts', { cookie: cb })).data.total, 1);
  assert.equal((await s.req('/payments', { cookie: cb })).data.total, 1);
  assert.equal((await s.req('/contracts', { cookie: ca })).data.total, 1);
  assert.equal((await s.req('/accounts', { cookie: ca })).data.total, 0);
  // 兼容按姓名传负责人；不存在则 400
  assert.equal((await s.req('/leads', { method: 'POST', body: { name: 'L', owner: '销售丙' } })).data.item.ownerId, c);
  assert.equal((await s.req('/leads', { method: 'POST', body: { name: 'L', owner: '查无此人' } })).status, 400);
  // 成员改名同步负责人姓名
  await s.req('/users/' + b, { method: 'PATCH', body: { name: '乙（改名）' } });
  assert.equal((await s.req('/accounts/' + accA.id)).data.item.owner, '乙（改名）');
  // 管理员可单独设置数据范围
  await s.req('/users/' + c, { method: 'PATCH', body: { dataScope: 'all' } });
  assert.equal((await s.req('/accounts', { cookie: await s.login('c@x.cn', 'Password!12345') })).data.total, 2);
});

test('amounts are stored as integer cents', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const acc = (await s.req('/accounts', { method: 'POST', body: { name: 'A' } })).data.item;
  const c = (await s.req('/contracts', { method: 'POST', body: { name: 'C', accountId: acc.id, amount: 0.3 } })).data.item;
  for (const v of [0.1, 0.2]) assert.equal((await s.req('/payments', { method: 'POST', body: { contractId: c.id, amount: v } })).status, 201);
  assert.equal((await s.req('/payments', { method: 'POST', body: { contractId: c.id, amount: 0.01 } })).status, 409);
  assert.equal((await s.req('/contracts/' + c.id)).data.item.amount, 0.3);
  await s.stop(true);
  const db = new DatabaseSync(path.join(s.dir, 'crm.sqlite'), { readOnly: true });
  const raw = db.prepare("SELECT data FROM records WHERE type='payments'").all().map(r => JSON.parse(r.data));
  db.close(); fs.rmSync(s.dir, { recursive: true, force: true });
  assert.deepEqual(raw.map(x => x.amountCents).sort(), [10, 20]);
  assert.ok(raw.every(x => !('amount' in x)));
});

test('V1.0 database is migrated on startup', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacrm-mig-'));
  const db = new DatabaseSync(path.join(dir, 'crm.sqlite'));
  db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','manager','sales','viewer')),display_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(tenant_id,email));
    CREATE TABLE records(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);`);
  const salt = 'abcd', hash = `${salt}:${crypto.scryptSync('TestPassword!1234', salt, 64).toString('hex')}`, t0 = new Date().toISOString();
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('t1', '老企业', t0);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('u1', 't1', 'admin@local.crm', hash, 'admin', '老王', 1, t0);
  const ins = db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,0)');
  ins.run('a1', 't1', 'accounts', JSON.stringify({ name: '老客户', owner: '老王' }), t0, t0, 'u1', 'u1');
  ins.run('o1', 't1', 'opportunities', JSON.stringify({ name: '老商机', accountId: 'a1', amount: 1299.99, stage: '谈判签约', owner: '老王' }), t0, t0, 'u1', 'u1');
  ins.run('k1', 't1', 'tasks', JSON.stringify({ title: '旧任务', status: '完成' }), t0, t0, 'u1', 'u1');
  db.close();
  const s = await startServer({ dir }); t.after(() => s.stop());
  const opp = (await s.req('/opportunities/o1')).data.item;
  assert.equal(opp.amount, 1299.99); assert.equal(opp.stage, '商务谈判'); assert.equal(opp.ownerId, 'u1');
  assert.equal((await s.req('/accounts/a1')).data.item.ownerId, 'u1');
  assert.equal((await s.req('/tasks/k1')).data.item.status, '已完成');
  // 重启不重复迁移（金额不会再次 ×100）
  await s.stop(true);
  const s2 = await startServer({ dir });
  assert.equal((await s2.req('/opportunities/o1')).data.item.amount, 1299.99);
  await s2.stop();
});

test('backup API, retention and restore script', async t => {
  const s = await startServer({ env: { BACKUP_KEEP: '2' } }); t.after(() => s.stop());
  await s.req('/accounts', { method: 'POST', body: { name: '备份前客户' } });
  const first = (await s.req('/backups', { method: 'POST' })).data.name;
  await s.req('/accounts', { method: 'POST', body: { name: '备份后客户' } });
  for (let i = 0; i < 2; i++) { await new Promise(r => setTimeout(r, 5)); await s.req('/backups', { method: 'POST' }); }
  const list = (await s.req('/backups')).data.items;
  assert.equal(list.length, 2, '按 BACKUP_KEEP 清理');
  assert.ok(!list.some(b => b.name === first));
  assert.equal((await s.req('/backups', { cookie: '' })).status, 401);
  await s.stop(true);
  const snap = path.join(s.dir, 'backups', list[1].name);
  assert.throws(() => execFileSync(process.execPath, ['scripts/restore.js', snap], { cwd: ROOT, env: { ...process.env, DATA_DIR: s.dir }, stdio: 'pipe' }));
  execFileSync(process.execPath, ['scripts/restore.js', snap, '--yes'], { cwd: ROOT, env: { ...process.env, DATA_DIR: s.dir }, stdio: 'pipe' });
  assert.ok(fs.readdirSync(s.dir).some(f => f.startsWith('pre-restore-')));
  const s2 = await startServer({ dir: s.dir });
  assert.equal((await s2.req('/accounts')).data.total, 2);
  await s2.stop();
});
