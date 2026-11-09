'use strict';
/**
 * 浏览器端到端冒烟测试（Playwright + Chromium）：npm run e2e
 * 覆盖主业务闭环：登录 → 新建客户 → 联系人 → 商机（远程搜索选择客户）→ 看板拖拽 → 转合同 → 审批 → 回款 → 对账单 → 导入，
 * 并检查所有页面无 JS 异常、无 CSP 拦截。
 */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, devices } = require('playwright');
const { startServer, mockIdp } = require('../helpers');
/** 在 Node 侧轮询（页面启用严格 CSP，避免 waitForFunction 在部分 Playwright 版本中使用 eval） */
async function waitFor(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('waitFor timeout');
}

test('end-to-end smoke', { timeout: 180000 }, async t => {
  const s = await startServer();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await s.stop(); });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
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
    await page.waitForSelector('dialog select[name=accountId] option:checked:has-text("端到端科技")', { state: 'attached' });
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
    await waitFor(async () => !!(await page.inputValue('dialog select[name=contractId]')));
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

  await t.test('two-step verification: enrol via UI (QR), then two-step login', async () => {
    const TOTP = require('../../lib/totp');
    await s.req('/users', { method: 'POST', body: { email: 'mfa@x.cn', name: 'MFA', password: 'Password!12345', role: 'sales' } });
    const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
    p2.on('pageerror', e => problems.push('mfa pageerror: ' + e.message));
    const login = async otp => {
      await p2.goto(B + '/');
      await p2.fill('[name=email]', 'mfa@x.cn'); await p2.fill('[name=password]', 'Password!12345');
      await p2.click('#loginForm button[type=submit]');
      if (otp) { await p2.waitForSelector('[name=otp]'); await p2.fill('[name=otp]', otp()); await p2.click('#loginForm button[type=submit]'); }
      await p2.waitForSelector('.kpis');
    };
    await login();
    await p2.click('[data-act=user-menu]'); await p2.click('[data-act=mfa]');
    assert.ok(!(await p2.isVisible('dialog button[type=submit]')), '开始设置前不显示提交按钮');
    await p2.click('[data-act=mfa-start]');
    await p2.waitForSelector('.mfa-setup .qr svg');
    const secret = (await p2.textContent('.secret')).replace(/\s/g, '');
    await p2.fill('dialog [name=code]', TOTP.totp(secret, Date.now() - 30000));
    await p2.click('dialog button[type=submit]');
    await waitFor(async () => (await s.req('/users')).data.items.find(x => x.email === 'mfa@x.cn').mfaEnabled === 1);
    await p2.click('[data-act=user-menu]'); await p2.click('[data-act=logout]');
    await login(() => TOTP.totp(secret));
    await ctx2.close();
  });

  await t.test('single sign-on via OIDC in the browser', async () => {
    const idp = await mockIdp();
    try {
      const s2 = await startServer({ env: { SSO_ALLOW_HTTP: '1' } });
      try {
        await s2.req('/settings', { method: 'PUT', body: { sso: { enabled: true, issuer: idp.base, clientId: 'crm-app', clientSecret: 'top-secret', buttonText: '企业账号登录', autoCreate: true } } });
        idp.browserClaims = { sub: 'browser-1', email: 'browser@x.cn', name: '浏览器用户' };
        const ctx3 = await browser.newContext(); const p3 = await ctx3.newPage();
        p3.on('pageerror', e => problems.push('sso pageerror: ' + e.message));
        await p3.goto(s2.base + '/');
        await p3.click('#ssoBox a:has-text("企业账号登录")');
        await p3.waitForSelector('.kpis');
        assert.match(await p3.textContent('.uname'), /浏览器用户/);
        // 失败回跳显示错误
        idp.browserClaims = { sub: 'other', email: 'browser@x.cn' };
        const p4 = await (await browser.newContext()).newPage();
        await p4.goto(s2.base + '/'); await p4.click('#ssoBox a');
        await p4.waitForSelector('.toast.error');
        assert.match(await p4.textContent('.toast'), /已绑定其他身份/);
        await ctx3.close();
      } finally { await s2.stop(); }
    } finally { idp.close(); }
  });

  await t.test('mobile layout', async () => {
    const m = await browser.newContext({ ...devices['iPhone 13'] });
    const mp = await m.newPage();
    mp.on('pageerror', e => problems.push('mobile pageerror: ' + e.message));
    await mp.goto(B + '/');
    await mp.fill('[name=email]', 'admin@local.crm'); await mp.fill('[name=password]', 'TestPassword!1234');
    await mp.click('#loginForm button[type=submit]'); await mp.waitForSelector('.kpis');
    assert.ok(await mp.isVisible('.tabbar'));
    const box = await mp.locator('.aside').boundingBox();
    assert.ok(box.x + box.width <= 1, '侧栏默认收起在屏幕外');
    await mp.click('.tabbar [data-act=toggle-nav]');
    await waitFor(async () => (await mp.locator('.aside').boundingBox()).x >= 0);
    await m.close();
  });

  assert.deepEqual(problems, [], '浏览器中出现错误');
});
