import { barChart, donut } from '../charts.js';
import { icon } from '../constants.js';
import { changeBadge, pageHead } from '../list.js';
import { $, ui } from '../state.js';
import { API, canEdit, esc, money, moneyShort } from '../util.js';

// ======================= 数据报表 =======================
export async function pageReports() {
  const rr = ui.tabs.reports || {};
  const q = new URLSearchParams(); if (rr.from) q.set('from', rr.from); if (rr.to) q.set('to', rr.to);
  const d = await API.get('/reports?' + q);
  ui.tabs.reports = { from: d.from, to: d.to };
  const s = d.summary;
  const maxStage = Math.max(1, ...d.stages.map(x => x.count));
  const maxOwner = Math.max(1, ...d.owners.map(x => x.amount));
  $('#content').innerHTML = pageHead('数据报表', '销售业绩、客户分析、商机分析与回款分析',
    `<label class="range"><input class="field slim" type="date" id="rFrom" value="${d.from}"> ~ <input class="field slim" type="date" id="rTo" value="${d.to}"></label><button class="btn light" data-act="report-query">查询</button>${canEdit() ? `<button class="btn" data-act="report-export">${icon('download')}导出</button>` : ''}`) + `
    <div class="kpis">
      <div class="kpi blue"><span class="kpi-ic">${icon('users')}</span><div><div class="kpi-l">新增客户</div><div class="kpi-v">${s.newAccounts}</div><div class="kpi-c">较上期 ${changeBadge(s.newAccountsChange)}</div></div></div>
      <div class="kpi green"><span class="kpi-ic">${icon('file')}</span><div><div class="kpi-l">成交金额</div><div class="kpi-v">${money(s.contractAmount)}</div><div class="kpi-c">较上期 ${changeBadge(s.contractAmountChange)}</div></div></div>
      <div class="kpi purple"><span class="kpi-ic">${icon('target')}</span><div><div class="kpi-l">线索转化率</div><div class="kpi-v">${s.conversionRate}%</div><div class="kpi-c">较上期 ${changeBadge(s.conversionRateChange, 'pp')}</div></div></div>
      <div class="kpi orange"><span class="kpi-ic">${icon('coins')}</span><div><div class="kpi-l">回款金额</div><div class="kpi-v">${money(s.payments)}</div><div class="kpi-c">较上期 ${changeBadge(s.paymentsChange)}</div></div></div>
    </div>
    <div class="grid g-trend">
      <section class="panel"><div class="panel-head"><h3>成交金额趋势（元）</h3></div>${barChart(d.months.map(m => ({ ...m, label: m.label.slice(2) })))}</section>
      <section class="panel"><div class="panel-head"><h3>客户来源</h3></div>${donut(d.accountSources, '客户')}</section>
    </div>
    <div class="grid g-three">
      <section class="panel"><div class="panel-head"><h3>商机阶段分布</h3><span class="muted small">赢单率 ${s.winRate}%</span></div>
        <ul class="hbars">${d.stages.map((x, i) => `<li><span>${esc(x.stage)}</span><meter class="s${i}" min="0" max="${maxStage}" value="${x.count}"></meter><b>${x.count}</b></li>`).join('')}</ul></section>
      <section class="panel"><div class="panel-head"><h3>销售业绩排行</h3></div>
        ${d.owners.length ? `<ul class="hbars">${d.owners.slice(0, 8).map(x => `<li><span>${esc(x.name)}</span><meter min="0" max="${maxOwner}" value="${x.amount}"></meter><b>${moneyShort(x.amount)}</b></li>`).join('')}</ul>` : '<div class="empty small">区间内暂无成交</div>'}</section>
      <section class="panel"><div class="panel-head"><h3>行业分布</h3></div>${donut(d.accountIndustries, '客户')}</section>
    </div>
    <section class="panel"><div class="panel-head"><h3>月度明细</h3></div><div class="tbl-wrap plain"><table><thead><tr><th>月份</th><th>成交金额</th><th>回款金额</th><th>新增客户</th></tr></thead><tbody>${d.months.map(m => `<tr><td>${m.label}</td><td>${money(m.contractAmount)}</td><td>${money(m.payments)}</td><td>${m.newAccounts}</td></tr>`).join('')}</tbody></table></div></section>`;
}
