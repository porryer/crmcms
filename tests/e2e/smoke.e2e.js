'use strict';
/**
 * 浏览器端到端冒烟测试（Playwright + Chromium）：npm run e2e
 * 覆盖主业务闭环：登录 → 新建客户 → 联系人 → 商机（远程搜索选择客户）→ 看板拖拽 → 转合同 → 审批 → 回款 → 对账单 → 导入，
 * 并检查所有页面无 JS 异常、无 CSP 拦截。
 */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, devices } = require('playwright');
const { startServer } = require('../helpers');

test('end-to-end smoke', { timeout: 180000 }, async t => {
  const s = await startServer();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await s.stop(); });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) problems.push('console: ' + m.text()); });
  const B = s.base;
  const settle = () => page.waitForLoadState('networkidle');

  await t.test('login', async () => {
    await page.goto(B + '/');
    await page.fill('[name=email]', 'admin@local.crm');
    await page.fill('[name=password]', 'TestPassword!1234');
    await page.click('#loginForm button[type=submit]');
    await page.waitForSelector('.kpis');
  });

  await t.test('create customer via form', async () => {
    await page.goto(B + '/#/accounts'); await settle();
    await page.click('button[data-act=create]');
    await page.fill('dialog [name=name]', '端到端科技');
    await page.selectOption('dialog [name=industry]', '科技/IT');
    await page.click('dialog button[type=submit]');
    await page.waitForSelector('td a.link:has-text("端到端科技")');
  });

  await t.test('customer detail: add contact with preset customer', async () => {
    await page.click('td a.link:has-text("端到端科技")'); await settle();
    await page.click('[data-tab=contacts]'); await settle();
    await page.click('button[data-act=create][data-type=contacts]');
    await page.waitForSelector('dialog select[name=accountId] option:checked:has-text("端到端科技")');
    await page.fill('dialog [name=name]', '王经理');
    await page.click('dialog button[type=submit]'); await settle();
    await page.waitForSelector('td:has-text("王经理")');
  });

  let oppId;
  await t.test('create opportunity with remote customer search, drag on kanban', async () => {
    await page.goto(B + '/#/opportunities'); await settle();
    await page.click('button[data-act=create][data-type=opportunities]');
    await page.fill('dialog [name=name]', '端到端项目');
    await page.fill('dialog .rselect[data-kind=account] [data-rs-q]', '端到端');
    await page.waitForSelector('dialog select[name=accountId] option:has-text("端到端科技")', { state: 'attached' });
    const val = await page.$eval('dialog select[name=accountId]', sel => [...sel.options].find(o => o.textContent.includes('端到端科技')).value);
    await page.selectOption('dialog select[name=accountId]', val);
    await page.fill('dialog [name=amount]', '88000');
    await page.click('dialog button[type=submit]'); await settle();
    const card = page.locator('.deal:has-text("端到端项目")');
    await card.waitFor();
    oppId = await card.getAttribute('data-id');
    await card.dragTo(page.locator('.lane[data-stage="方案报价"]'));
    await page.waitForSelector('.lane[data-stage="方案报价"] .deal:has-text("端到端项目")');
    assert.equal((await s.req('/opportunities/' + oppId)).data.item.stage, '方案报价');
  });

  await t.test('opportunity -> contract -> approval -> payment', async () => {
    await page.goto(B + '/#/opportunities/' + oppId); await settle();
    await page.click('button[data-act=opp-contract]');
    await page.click('dialog button[type=submit]');
    await page.waitForURL(/#\/contracts/); await settle();
    await page.click('button[data-act=submit-contract]'); await settle();
    await page.click('button[data-act=approve-contract]');
    await page.waitForSelector('dialog textarea[name=note]');
    await page.fill('dialog textarea[name=note]', '同意');
    await page.click('dialog button[type=submit]'); await settle();
    await page.waitForSelector('td .tag:has-text("已签订")');
    await page.click('button[data-act=pay-contract]');
    await page.waitForSelector('dialog select[name=contractId] option:checked');
    await page.fill('dialog [name=amount]', '30000');
    await page.click('dialog button[type=submit]'); await settle();
    const fin = (await s.req('/finance')).data.totals;
    assert.equal(fin.receivable, 88000); assert.equal(fin.received, 30000);
  });

  await t.test('statement shows balance', async () => {
    await page.goto(B + '/#/finance'); await settle();
    await page.click('[data-tab=statements]'); await settle();
    await page.waitForSelector('.statement td:has-text("端到端科技")');
    assert.match(await page.textContent('.statement'), /58,000/);
  });

  await t.test('CSV import', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'acc.csv');
    fs.writeFileSync(file, '客户名称,行业\n导入一号,制造业\n导入二号,金融\n');
    await page.goto(B + '/#/accounts'); await settle();
    await page.click('button[data-act=import]');
    await page.setInputFiles('dialog [data-role=import-file]', file);
    await page.waitForSelector('dialog .import-sum');
    await page.click('dialog button[type=submit]'); await settle();
    assert.equal((await s.req('/accounts')).data.total, 3);
  });

  await t.test('every page renders without errors', async () => {
    for (const p of ['dashboard', 'leads', 'accounts', 'contacts', 'opportunities?view=list', 'contracts', 'finance', 'tasks', 'activities', 'reports', 'team', 'settings']) {
      await page.goto(`${B}/#/${p}`); await settle();
      assert.equal(await page.locator('#content .empty .ic + p').filter({ hasText: /错误|失败/ }).count(), 0, p);
    }
    for (const tab of ['basic', 'dicts', 'fields', 'approval', 'audits', 'about']) { await page.click(`[data-tab=${tab}]`); await settle(); }
    await page.click('[data-act=notif]'); await page.waitForSelector('#notifPanel:not([hidden])');
  });

  await t.test('mobile layout', async () => {
    const m = await browser.newContext({ ...devices['iPhone 13'] });
    const mp = await m.newPage();
    mp.on('pageerror', e => problems.push('mobile pageerror: ' + e.message));
    await mp.goto(B + '/');
    await mp.fill('[name=email]', 'admin@local.crm'); await mp.fill('[name=password]', 'TestPassword!1234');
    await mp.click('#loginForm button[type=submit]'); await mp.waitForSelector('.kpis');
    assert.ok(await mp.isVisible('.tabbar'));
    assert.ok(!(await mp.isVisible('.aside')));
    await m.close();
  });

  assert.deepEqual(problems, [], '浏览器中出现错误');
});
