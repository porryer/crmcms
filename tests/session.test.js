'use strict';
// 会话有效期可配置（SESSION_HOURS）
const test = require('node:test'), assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { sessionHours } = require('../src/config');

const maxAge = r => Number((r.headers.getSetCookie() || []).find(c => c.startsWith('crm_session=') && !c.startsWith('crm_session=;'))?.match(/Max-Age=(\d+)/)?.[1]);

test('SESSION_HOURS parsing: default, valid range, invalid falls back to 8', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(sessionHours(undefined), 8);
    assert.equal(sessionHours(''), 8);
    assert.equal(sessionHours('24'), 24);
    assert.equal(sessionHours('0.5'), 8); // 低于 1 小时
    assert.equal(sessionHours('1.5'), 1.5);
    assert.equal(sessionHours('720'), 720);
    for (const bad of ['0', '-1', '721', 'abc', 'Infinity']) assert.equal(sessionHours(bad), 8, bad);
  } finally { console.warn = warn; }
});

test('SESSION_HOURS controls cookie Max-Age and server-side expiry', async t => {
  const s = await startServer({ env: { SESSION_HOURS: '24' } });
  t.after(() => s.stop());
  const before = Date.now();
  const r = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@local.crm', password: 'TestPassword!1234' }) });
  assert.equal(r.status, 200);
  assert.equal(maxAge(r), 24 * 3600);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(require('node:path').join(s.dir, 'crm.sqlite'), { readOnly: true });
  const latest = db.prepare('SELECT MAX(expiry) e FROM sessions').get().e;
  db.close();
  const ms = Date.parse(latest) - before;
  assert.ok(ms > 23.9 * 3600e3 && ms <= 24.1 * 3600e3, `expiry ${latest}`);
});

test('default session lifetime stays 8 hours', async t => {
  const s = await startServer({ env: { SESSION_HOURS: '' } });
  t.after(() => s.stop());
  const r = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@local.crm', password: 'TestPassword!1234' }) });
  assert.equal(maxAge(r), 8 * 3600);
});
