import { icon } from '../constants.js';
import { initRemoteSelects, remoteSelect } from '../forms.js';
import { mountList, pageHead } from '../list.js';
import { $, settings, ui } from '../state.js';
import { API, canEdit, esc, money, tag, ymd } from '../util.js';

// ======================= 财务回款 =======================
export async function pageFinance() {
  const f = await API.get('/finance');
  const tab = ui.tabs.finance || 'payments';
  const t = f.totals;
  $('#content').innerHTML = pageHead('财务回款', '应收 / 实收、回款计划与应收账款') + `
    <div class="kpis">
      <div class="kpi blue"><span class="kpi-ic">${icon('file')}</span><div><div class="kpi-l">应收金额</div><div class="kpi-v">${money(t.receivable)}</div><div class="kpi-c muted">不含已作废合同</div></div></div>
      <div class="kpi green"><span class="kpi-ic">${icon('wallet')}</span><div><div class="kpi-l">已收金额</div><div class="kpi-v">${money(t.received)}</div><div class="kpi-c muted">回款率 ${t.receivable ? Math.round((t.received / t.receivable) * 1000) / 10 : 0}%</div></div></div>
      <div class="kpi red"><span class="kpi-ic">${icon('alert')}</span><div><div class="kpi-l">欠款金额</div><div class="kpi-v">${money(t.outstanding)}</div><div class="kpi-c muted">应收 - 已收</div></div></div>
      <div class="kpi orange"><span class="kpi-ic">${icon('calendar')}</span><div><div class="kpi-l">逾期计划</div><div class="kpi-v">${money(t.overdue)}</div><div class="kpi-c muted">计划日期已过且未回款</div></div></div>
    </div>
    <section class="panel"><div class="tabs">${[['payments', '回款记录'], ['plans', '回款计划'], ['receivables', '应收账款'], ['statements', '对账单']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="finance-tab" data-tab="${k}">${l}</button>`).join('')}</div><div id="financeBody"></div></section>`;
  const body = $('#financeBody');
  if (tab === 'statements') { ui.list = null; return renderStatement(body); }
  if (tab === 'receivables') {
    ui.list = null;
    body.innerHTML = f.contracts.length ? `<div class="tbl-wrap"><table><thead><tr><th>合同编号</th><th>合同名称</th><th>客户</th><th>合同金额</th><th>已收</th><th>未收</th><th>回款进度</th><th>状态</th><th class="ops">操作</th></tr></thead><tbody>
      ${f.contracts.map(c => `<tr><td><b>${esc(c.number)}</b></td><td>${esc(c.name)}</td><td><a class="link" href="#/accounts/${esc(c.accountId)}">${esc(c.accountName)}</a></td><td>${money(c.amount)}</td><td>${money(c.received)}</td><td class="${c.outstanding > 0 ? 'neg' : ''}">${money(c.outstanding)}</td><td><progress max="100" value="${c.amount ? Math.round((c.received / c.amount) * 100) : 0}"></progress></td><td>${tag(c.status)}</td><td class="ops"><div class="row-actions"><button class="textbtn" data-act="view-contract" data-id="${esc(c.id)}">查看</button>${canEdit() && c.outstanding > 0 ? `<button class="textbtn" data-act="pay-contract" data-id="${esc(c.id)}">登记回款</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${icon('file')}<p>暂无合同</p></div>`;
  } else await mountList(body, tab);
}

export async function renderStatement(body) {
  const st = ui.tabs.stmt ||= { accountId: '', from: `${new Date().getFullYear()}-01-01`, to: ymd() };
  const q = new URLSearchParams({ from: st.from, to: st.to }); if (st.accountId) q.set('accountId', st.accountId);
  const r = await API.get('/statements?' + q);
  const s0 = r.summary[0];
  body.innerHTML = `<div class="toolbar"><div class="filters">
      <label class="filter"><span>客户</span>${remoteSelect('account', 'id="stAccount"', st.accountId, '全部客户（汇总）')}</label>
      <label class="range"><input class="field slim" type="date" id="stFrom" value="${st.from}"> ~ <input class="field slim" type="date" id="stTo" value="${st.to}"></label>
      <button class="btn light" data-act="stmt-query">查询</button></div>
      <div class="tools">${canEdit() ? `<button class="btn light" data-act="stmt-export">${icon('download')}导出</button>` : ''}<button class="btn light" data-act="print">${icon('print')}打印</button></div></div>
    <div class="statement">
      <h3 class="center">${esc(settings.companyName)} · ${st.accountId ? esc(s0?.accountName || '') + ' 往来对账单' : '客户往来对账汇总'}</h3>
      <p class="center muted">对账期间：${r.from} 至 ${r.to}　　单位：元</p>
      ${st.accountId ? `<div class="tbl-wrap plain"><table><thead><tr><th>日期</th><th>类型</th><th>单据</th><th class="num">应收增加</th><th class="num">回款</th><th class="num">余额</th></tr></thead><tbody>
        <tr class="sum"><td>${r.from}</td><td>期初余额</td><td></td><td></td><td></td><td class="num">${money(s0.opening)}</td></tr>
        ${r.lines.map(l => `<tr><td>${l.date}</td><td>${l.kind}</td><td>${esc(l.ref)}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td><td class="num">${money(l.balance)}</td></tr>`).join('')}
        <tr class="sum"><td>${r.to}</td><td>本期合计 / 期末余额</td><td></td><td class="num">${money(s0.debit)}</td><td class="num">${money(s0.credit)}</td><td class="num"><b>${money(s0.closing)}</b></td></tr>
      </tbody></table></div><div class="sign"><span>客户确认（盖章）：</span><span>${esc(settings.companyName)}（盖章）：</span></div>`
      : `<div class="tbl-wrap plain"><table><thead><tr><th>客户</th><th class="num">期初余额</th><th class="num">本期应收</th><th class="num">本期回款</th><th class="num">期末余额</th><th class="ops"></th></tr></thead><tbody>
        ${r.summary.map(x => `<tr><td><b>${esc(x.accountName)}</b></td><td class="num">${money(x.opening)}</td><td class="num">${money(x.debit)}</td><td class="num">${money(x.credit)}</td><td class="num ${x.closing > 0 ? 'neg' : ''}">${money(x.closing)}</td><td class="ops"><button class="textbtn" data-act="stmt-account" data-id="${esc(x.accountId)}">明细</button></td></tr>`).join('') || '<tr><td colspan="6" class="center muted">期间内无往来</td></tr>'}
        <tr class="sum"><td>合计</td><td class="num">${money(r.totals.opening)}</td><td class="num">${money(r.totals.debit)}</td><td class="num">${money(r.totals.credit)}</td><td class="num">${money(r.totals.closing)}</td><td></td></tr></tbody></table></div>`}
      <p class="muted small">口径：应收 = 已生效合同金额（按签订日期），回款按到账日期；不含草稿与作废合同。</p></div>`;
  initRemoteSelects(body);
}
