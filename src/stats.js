'use strict';
/** 仪表盘、财务、报表与对账单统计 */
const { db } = require('./db');
const { OPEN_STAGES, STAGES, TABLES } = require('./constants');
const { boom, cents, localDay, pad, pct, sumCents, ymd, yuan } = require('./util');
const { all } = require('./store');
const { scopeOwners, scoped } = require('./scope');

// ---------- 统计 ----------
function monthRange(offset = 0, base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + offset + 1, 1);
  return [ymd(start), ymd(new Date(end - 1))];
}
const inRange = (day, [from, to]) => day && day >= from && day <= to;
const contractDay = c => localDay(c.signedAt || c.createdAt);
const paymentDay = p => localDay(p.paidAt || p.createdAt);
const isEffectiveContract = c => !['草稿', '已作废'].includes(c.status);

/** 按区间生成趋势桶：7d/30d 按日，quarter 按周，year 按月 */
function buildBuckets(range, today = new Date()) {
  const buckets = [];
  if (range === '7d' || range === '30d') {
    const n = range === '7d' ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), key = ymd(d);
      buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, from: key, to: key });
    }
  } else if (range === 'quarter') {
    const qStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
    for (let s = new Date(qStart); s <= qEnd; s.setDate(s.getDate() + 7)) {
      const e = new Date(Math.min(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6), qEnd));
      buckets.push({ label: `${s.getMonth() + 1}/${s.getDate()}`, from: ymd(s), to: ymd(e) });
    }
  } else {
    for (let m = 0; m < 12; m++) {
      const [from, to] = monthRange(m - today.getMonth(), today);
      buckets.push({ label: `${m + 1}月`, from, to });
    }
  }
  return buckets;
}

function dashboard(u, range) {
  const data = {};
  for (const k of Object.keys(TABLES)) data[k] = scoped(u, k);
  const sum = arr => yuan(sumCents(arr));
  const today = ymd(new Date());
  const thisMonth = monthRange(0), lastMonth = monthRange(-1);
  const created = x => localDay(x.createdAt);

  const accountsLastMonthEnd = data.accounts.filter(x => created(x) <= lastMonth[1]).length;
  const newThis = data.accounts.filter(x => inRange(created(x), thisMonth)).length;
  const newLast = data.accounts.filter(x => inRange(created(x), lastMonth)).length;
  const openOpps = data.opportunities.filter(x => OPEN_STAGES.includes(x.stage));
  const openPrev = openOpps.filter(x => created(x) <= lastMonth[1]).length;
  const payThis = sumCents(data.payments.filter(x => inRange(paymentDay(x), thisMonth)));
  const payLast = sumCents(data.payments.filter(x => inRange(paymentDay(x), lastMonth)));

  const effective = data.contracts.filter(isEffectiveContract);
  const trend = buildBuckets(range).map(b => ({ label: b.label, from: b.from, to: b.to, amount: sum(effective.filter(c => inRange(contractDay(c), [b.from, b.to]))) }));
  const accountName = id => data.accounts.find(a => a.id === id)?.name || '';
  const openTasks = data.tasks.filter(x => x.status !== '已完成');

  return {
    metrics: {
      leads: data.leads.filter(x => !x.convertedAccountId && x.status !== '已失效').length,
      accounts: data.accounts.length,
      opportunities: data.opportunities.length,
      opportunityAmount: sum(data.opportunities),
      contracts: data.contracts.length,
      contractAmount: sum(effective),
      payments: sum(data.payments),
      todo: openTasks.length,
    },
    kpis: [
      { key: 'accounts', label: '客户总数', value: data.accounts.length, change: pct(data.accounts.length, accountsLastMonthEnd) },
      { key: 'newAccounts', label: '本月新增', value: newThis, change: pct(newThis, newLast) },
      { key: 'openOpportunities', label: '进行中商机', value: openOpps.length, change: pct(openOpps.length, openPrev) },
      { key: 'monthPayments', label: '本月回款', value: yuan(payThis), money: true, change: pct(payThis, payLast) },
    ],
    trend,
    stages: STAGES.map(stage => ({ stage, count: data.opportunities.filter(x => x.stage === stage).length, amount: sum(data.opportunities.filter(x => x.stage === stage)) })),
    recentActivities: [...data.activities]
      .sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)))
      .slice(0, 6).map(x => ({ ...x, accountName: accountName(x.accountId) })),
    todos: [...openTasks]
      .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
      .slice(0, 6).map(x => ({ ...x, accountName: accountName(x.accountId), overdue: !!x.dueDate && x.dueDate < today, dueToday: x.dueDate === today })),
    alerts: openTasks.filter(x => x.dueDate && x.dueDate <= today).length,
    recent: (() => { const o = scopeOwners(u); return db.prepare(`SELECT action,entity,at FROM audits WHERE tenant_id=? ${o ? `AND user_id IN (${[...o].map(() => '?').join(',')})` : ''} ORDER BY at DESC LIMIT 8`).all(u.tenant_id, ...(o ? [...o] : [])); })(),
  };
}

function finance(u) {
  const contracts = scoped(u, 'contracts').filter(c => c.status !== '已作废');
  const payments = scoped(u, 'payments'), plans = scoped(u, 'plans'), accounts = all(u, 'accounts');
  const today = ymd(new Date());
  const accountName = id => accounts.find(a => a.id === id)?.name || '';
  let receivable = 0, received = 0;
  const rows = contracts.map(c => {
    const amount = cents(c.amount), got = sumCents(payments.filter(p => p.contractId === c.id));
    receivable += amount; received += got;
    return {
      id: c.id, number: c.number, name: c.name, accountId: c.accountId, accountName: accountName(c.accountId), contractStatus: c.status,
      amount: yuan(amount), received: yuan(got), outstanding: yuan(amount - got),
      status: amount > 0 && got >= amount ? '已收齐' : got > 0 ? '部分回款' : '待回款',
    };
  });
  const planRows = plans.map(p => {
    const c = contracts.find(x => x.id === p.contractId);
    return { ...p, contractNumber: c?.number || '', contractName: c?.name || '', accountName: accountName(c?.accountId), overdue: p.status !== '已回款' && p.dueDate < today };
  }).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return {
    totals: {
      receivable: yuan(receivable), received: yuan(received), outstanding: yuan(receivable - received),
      overdue: yuan(sumCents(planRows.filter(p => p.overdue))),
    },
    contracts: rows, plans: planRows,
  };
}

function reports(u, from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date();
  if (!day.test(from || '')) from = ymd(new Date(today.getFullYear(), today.getMonth() - 5, 1));
  if (!day.test(to || '')) to = ymd(today);
  if (from > to) boom(400, '开始日期不能晚于结束日期');
  const range = [from, to];
  const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const prevTo = ymd(new Date(new Date(from + 'T00:00:00') - 86400000));
  const prevFrom = ymd(new Date(new Date(from + 'T00:00:00') - spanDays * 86400000));
  const prev = [prevFrom, prevTo];
  const data = {};
  for (const k of ['accounts', 'leads', 'opportunities', 'contracts', 'payments']) data[k] = scoped(u, k);
  const created = x => localDay(x.createdAt);
  const contracts = data.contracts.filter(isEffectiveContract);

  // 按月序列
  const months = [];
  for (let d = new Date(from.slice(0, 7) + '-01T00:00:00'); ymd(d) <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const [mf, mt] = monthRange(0, d);
    const r = [mf < from ? from : mf, mt > to ? to : mt];
    months.push({
      label: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      contractAmount: yuan(sumCents(contracts.filter(c => inRange(contractDay(c), r)))),
      payments: yuan(sumCents(data.payments.filter(p => inRange(paymentDay(p), r)))),
      newAccounts: data.accounts.filter(a => inRange(created(a), r)).length,
    });
    if (months.length > 36) break;
  }
  const leadsIn = data.leads.filter(l => inRange(created(l), range));
  const leadsPrev = data.leads.filter(l => inRange(created(l), prev));
  const rate = arr => (arr.length ? Math.round((arr.filter(l => l.convertedAccountId).length / arr.length) * 1000) / 10 : 0);
  const newAccounts = data.accounts.filter(a => inRange(created(a), range)).length;
  const newAccountsPrev = data.accounts.filter(a => inRange(created(a), prev)).length;
  const amount = sumCents(contracts.filter(c => inRange(contractDay(c), range)));
  const amountPrev = sumCents(contracts.filter(c => inRange(contractDay(c), prev)));
  const paid = sumCents(data.payments.filter(p => inRange(paymentDay(p), range)));
  const paidPrev = sumCents(data.payments.filter(p => inRange(paymentDay(p), prev)));

  const group = (arr, key) => {
    const m = new Map();
    for (const x of arr) { const k = x[key] || '未填写'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const owners = new Map();
  for (const c of contracts.filter(c => inRange(contractDay(c), range))) {
    const k = c.owner || '未分配', v = owners.get(k) || { name: k, amount: 0, count: 0 };
    v.amount += cents(c.amount); v.count++; owners.set(k, v);
  }
  const closed = data.opportunities.filter(o => ['赢单', '输单'].includes(o.stage));
  return {
    from, to,
    summary: {
      newAccounts, newAccountsChange: pct(newAccounts, newAccountsPrev),
      contractAmount: yuan(amount), contractAmountChange: pct(amount, amountPrev),
      conversionRate: rate(leadsIn), conversionRateChange: Math.round((rate(leadsIn) - rate(leadsPrev)) * 10) / 10,
      payments: yuan(paid), paymentsChange: pct(paid, paidPrev),
      winRate: closed.length ? Math.round((closed.filter(o => o.stage === '赢单').length / closed.length) * 1000) / 10 : 0,
    },
    months,
    accountSources: group(data.accounts, 'source'),
    accountIndustries: group(data.accounts, 'industry'),
    stages: STAGES.map(stage => ({ stage, count: data.opportunities.filter(o => o.stage === stage).length, amount: yuan(sumCents(data.opportunities.filter(o => o.stage === stage))) })),
    owners: [...owners.values()].map(o => ({ ...o, amount: yuan(o.amount) })).sort((a, b) => b.amount - a.amount),
  };
}

// ---------- 对账单 ----------
function statement(u, accountId, from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || '') || !day.test(to || '')) boom(400, '请选择对账期间');
  if (from > to) boom(400, '开始日期不能晚于结束日期');
  const contracts = scoped(u, 'contracts').filter(isEffectiveContract);
  const payments = scoped(u, 'payments');
  const cById = new Map(contracts.map(c => [c.id, c]));
  const accounts = scoped(u, 'accounts').filter(a => !accountId || a.id === accountId);
  if (accountId && !accounts.length) boom(404, '客户不存在');
  const summary = accounts.map(a => {
    const cs = contracts.filter(c => c.accountId === a.id), ids = new Set(cs.map(c => c.id));
    const ps = payments.filter(p => ids.has(p.contractId));
    const before = d => d < from, within = d => d >= from && d <= to;
    const opening = sumCents(cs.filter(c => before(contractDay(c)))) - sumCents(ps.filter(p => before(paymentDay(p))));
    const debit = sumCents(cs.filter(c => within(contractDay(c)))), credit = sumCents(ps.filter(p => within(paymentDay(p))));
    return { accountId: a.id, accountName: a.name, opening: yuan(opening), debit: yuan(debit), credit: yuan(credit), closing: yuan(opening + debit - credit) };
  }).filter(x => accountId || x.opening || x.debit || x.credit || x.closing);
  let lines = [];
  if (accountId) {
    const s = summary[0] || { opening: 0 };
    const cs = contracts.filter(c => c.accountId === accountId), ids = new Set(cs.map(c => c.id));
    lines = [
      ...cs.filter(c => contractDay(c) >= from && contractDay(c) <= to).map(c => ({ date: contractDay(c), kind: '合同应收', ref: `${c.number} ${c.name}`, debit: c.amount, credit: 0 })),
      ...payments.filter(p => ids.has(p.contractId) && paymentDay(p) >= from && paymentDay(p) <= to).map(p => ({ date: paymentDay(p), kind: '回款', ref: `${cById.get(p.contractId)?.number || ''} ${p.method || ''}`.trim(), debit: 0, credit: p.amount })),
    ].sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit);
    let bal = cents(s.opening);
    for (const l of lines) { bal += cents(l.debit) - cents(l.credit); l.balance = yuan(bal); }
  }
  const total = k => yuan(summary.reduce((x, r) => x + cents(r[k]), 0));
  return { from, to, accountId: accountId || null, summary, lines, totals: { opening: total('opening'), debit: total('debit'), credit: total('credit'), closing: total('closing') } };
}

module.exports = { dashboard, finance, isEffectiveContract, reports, statement };
