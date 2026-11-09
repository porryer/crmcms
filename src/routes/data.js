'use strict';
/** 附件、对账单、仪表盘、财务、查找、搜索、报表 */
const { boom } = require('../util');
const { audit } = require('../store');
const { canWrite } = require('../scope');
const { NEXT, isExport, send, sendCSV } = require('../http');
const { dashboard, finance, reports, statement } = require('../stats');
const { lookup, search } = require('../query');
const { attachmentsApi } = require('../attachments');

async function dataRoutes(req, res, url, u) {
  const p = url.pathname, m = req.method;
  const attMatch = p.match(/^\/api\/attachments(?:\/([^/]+)(?:\/(download))?)?$/);
  if (attMatch) return attachmentsApi(u, req, res, url, attMatch[1], attMatch[2]);
  if (p === '/api/statements' && m === 'GET') {
    const r = statement(u, url.searchParams.get('accountId') || '', url.searchParams.get('from'), url.searchParams.get('to'));
    if (isExport(url)) {
      if (!canWrite(u)) boom(403, '没有导出权限');
      audit(u, 'export', 'statements', r.accountId || '*', { from: r.from, to: r.to });
      if (r.accountId) {
        const s0 = r.summary[0];
        return sendCSV(res, `对账单_${s0.accountName}_${r.from}_${r.to}.csv`, ['日期', '类型', '单据', '应收增加', '回款', '余额'],
          [[r.from, '期初余额', '', '', '', s0.opening], ...r.lines.map(l => [l.date, l.kind, l.ref, l.debit || '', l.credit || '', l.balance]), [r.to, '期末余额', '', s0.debit, s0.credit, s0.closing]]);
      }
      return sendCSV(res, `对账汇总_${r.from}_${r.to}.csv`, ['客户', '期初余额', '本期应收', '本期回款', '期末余额'], r.summary.map(x => [x.accountName, x.opening, x.debit, x.credit, x.closing]));
    }
    return send(res, 200, r);
  }
  if (p === '/api/dashboard' && m === 'GET') return send(res, 200, dashboard(u, url.searchParams.get('range') || 'year'));
  if (p === '/api/finance' && m === 'GET') return send(res, 200, finance(u));
  if (p === '/api/lookup' && m === 'GET') return send(res, 200, lookup(u, url.searchParams));
  if (p === '/api/search' && m === 'GET') return send(res, 200, search(u, url.searchParams.get('q')));
  if (p === '/api/reports' && m === 'GET') {
    const r = reports(u, url.searchParams.get('from'), url.searchParams.get('to'));
    if (isExport(url)) {
      if (!canWrite(u)) boom(403, '没有导出权限');
      audit(u, 'export', 'reports', '*', { from: r.from, to: r.to });
      return sendCSV(res, `report_${r.from}_${r.to}.csv`, ['月份', '成交金额', '回款金额', '新增客户'], r.months.map(x => [x.label, x.contractAmount, x.payments, x.newAccounts]));
    }
    return send(res, 200, r);
  }

  return NEXT;
}

module.exports = { dataRoutes };
