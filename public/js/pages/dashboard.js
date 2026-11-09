import { bindLineChart, funnel, lineChart } from '../charts.js';
import { ACTIVITY_ICON, icon } from '../constants.js';
import { changeBadge } from '../list.js';
import { $, me, ui } from '../state.js';
import { API, canEdit, esc, greeting, money, relTime, tag, weekday } from '../util.js';

// ======================= 工作台 =======================
export async function pageDashboard() {
  const d = await API.get('/dashboard?range=' + ui.dashRange);
  const KPI_ICON = { accounts: ['users', 'blue'], newAccounts: ['pluscircle', 'green'], openOpportunities: ['briefcase', 'purple'], monthPayments: ['coins', 'orange'] };
  const shown = d.stages.filter(s => s.stage !== '输单');
  const totalOpp = shown.reduce((a, s) => a + s.count, 0), totalAmt = shown.reduce((a, s) => a + s.amount, 0);
  const now = new Date();
  $('#content').innerHTML = `
    <div class="hello"><h2>${greeting()}，${esc(me.name)}！</h2><p class="muted">今天是 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（周${weekday()}）${d.alerts ? `，你有 <a class="link" href="#/tasks?view=due">${d.alerts} 项今日/逾期任务</a>` : ''}</p></div>
    <div class="kpis">${d.kpis.map(k => `<div class="kpi ${KPI_ICON[k.key][1]}"><span class="kpi-ic">${icon(KPI_ICON[k.key][0])}</span><div><div class="kpi-l">${k.label}</div><div class="kpi-v">${k.money ? money(k.value) : Number(k.value).toLocaleString('zh-CN')}</div><div class="kpi-c">较上月 ${changeBadge(k.change)}</div></div></div>`).join('')}</div>
    <div class="grid g-trend">
      <section class="panel"><div class="panel-head"><h3>销售趋势</h3><div class="seg">${[['7d', '近7天'], ['30d', '近30天'], ['quarter', '本季度'], ['year', '本年度']].map(([k, l]) => `<button class="${ui.dashRange === k ? 'on' : ''}" data-act="dash-range" data-range="${k}">${l}</button>`).join('')}</div></div>
        ${lineChart(d.trend)}<p class="muted small">销售额 = 已生效合同金额（按签订日期统计，不含草稿/作废）</p></section>
      <section class="panel"><div class="panel-head"><h3>商机销售漏斗</h3><span class="muted small">商机总数 <b>${totalOpp}</b>｜预计金额 <b>${money(totalAmt)}</b></span></div>
        <div class="funnel-wrap">${funnel(d.stages)}
          <table class="mini"><thead><tr><th>阶段</th><th>商机数</th><th>金额(万元)</th></tr></thead><tbody>${shown.map((s, i) => `<tr><td><i class="sw f${i}"></i>${esc(s.stage)}</td><td>${s.count}</td><td>${(s.amount / 1e4).toFixed(1)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>
    <div class="grid g-bottom">
      <section class="panel"><div class="panel-head"><h3>最近跟进记录</h3><a class="link" href="#/activities">查看全部 ${icon('right')}</a></div>
        ${d.recentActivities.length ? `<div class="tbl-wrap plain"><table><thead><tr><th></th><th>时间</th><th>客户</th><th>跟进内容</th><th>负责人</th><th>结果</th></tr></thead><tbody>
          ${d.recentActivities.map(a => `<tr><td class="aic">${icon(ACTIVITY_ICON[a.type] || 'message')}</td><td>${relTime(a.occurredAt || a.createdAt)}</td><td><a class="link" href="#/accounts/${esc(a.accountId)}">${esc(a.accountName || '—')}</a></td><td><span class="clip" title="${esc(a.content)}">${esc(a.content)}</span></td><td>${esc(a.owner || '—')}</td><td>${tag(a.result)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('message')}<p>暂无跟进记录</p>${canEdit() ? '<button class="btn light small" data-act="create" data-type="activities">写跟进</button>' : ''}</div>`}
      </section>
      <section class="panel"><div class="panel-head"><h3>待办任务</h3><a class="link" href="#/tasks">查看全部 ${icon('right')}</a></div>
        ${d.todos.length ? `<ul class="todos">${d.todos.map(t => `<li><button class="box" data-act="toggle-task" data-id="${esc(t.id)}" ${canEdit() ? '' : 'disabled'} aria-label="完成任务"></button><span class="todo-t">${esc(t.title)}${t.accountName ? `<small>${esc(t.accountName)}</small>` : ''}</span><span class="due ${t.overdue ? 'late' : t.dueToday ? 'today' : ''}">${t.overdue ? '已逾期' : t.dueToday ? '今天' : t.dueDate ? t.dueDate.slice(5) : '—'}</span></li>`).join('')}</ul>` : `<div class="empty">${icon('check')}<p>暂无待办，干得漂亮！</p></div>`}
      </section>
    </div>`;
  bindLineChart($('.line-chart'));
}
