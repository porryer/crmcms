import { LISTS, STAGES, icon } from '../constants.js';
import { filesPane } from '../files.js';
import { mountList, optionList, pageHead, table } from '../list.js';
import { rerender } from '../router.js';
import { $, $$, ui } from '../state.js';
import { API, avatar, canEdit, customKv, esc, fmtDate, fmtDateTime, money, tag, toast } from '../util.js';

// ======================= 商机 =======================
export async function pageOpportunities(r) {
  const view = r.params.get('view') || ui.oppView;
  ui.oppView = view;
  const switcher = `<div class="seg">${[['board', 'board', '看板'], ['list', 'list', '列表']].map(([k, ic, l]) => `<button class="${view === k ? 'on' : ''}" data-act="opp-view" data-view="${k}">${icon(ic)}${l}</button>`).join('')}</div>`;
  if (view === 'list') {
    $('#content').innerHTML = pageHead('商机管理', '商机阶段、预计金额与成交预测', switcher) + '<div id="listHost"></div>';
    return mountList($('#listHost'), 'opportunities', { q: r.params.get('q') || '' });
  }
  const owner = r.params.get('owner') || '';
  const items = (await API.get('/opportunities' + (owner ? '?ownerId=' + encodeURIComponent(owner) : ''))).items;
  ui.oppCache = new Map(items.map(o => [o.id, o]));
  const LANE_MAX = 50;
  const totalOpen = items.filter(o => !['赢单', '输单'].includes(o.stage));
  $('#content').innerHTML = pageHead('商机管理', `进行中 ${totalOpen.length} 个 · 预计金额 ${money(totalOpen.reduce((a, o) => a + Number(o.amount || 0), 0))} · 拖拽卡片可变更阶段`,
    `${switcher}<select class="field slim" data-act-change="opp-owner">${optionList('user', owner, '全部负责人')}</select>${canEdit() ? `<button class="btn" data-act="create" data-type="opportunities">${icon('plus')}新建商机</button>` : ''}`) +
    `<div class="kanban">${STAGES.map((s, i) => {
      const lane = items.filter(o => o.stage === s);
      return `<div class="lane" data-stage="${s}"><div class="lane-head s${i}"><b>${s}</b><span>${lane.length}</span><small>${money(lane.reduce((a, o) => a + Number(o.amount || 0), 0))}</small></div>
        <div class="lane-body">${[...lane].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, LANE_MAX).map(o => `<a class="deal" href="#/opportunities/${esc(o.id)}" draggable="${canEdit()}" data-id="${esc(o.id)}"><b>${esc(o.name)}</b><span class="muted">${esc(o.accountName)}</span><strong>${money(o.amount)}</strong><span class="deal-foot">${avatar(o.owner)}<span>${esc(o.owner || '未分配')}</span><small>${o.expectedDate ? fmtDate(o.expectedDate) : ''}</small></span></a>`).join('') || '<div class="lane-empty">拖拽商机到此</div>'}${lane.length > LANE_MAX ? `<a class="lane-more" href="#/opportunities?view=list">还有 ${lane.length - LANE_MAX} 个（按金额显示前 ${LANE_MAX}），在列表中查看</a>` : ''}</div></div>`;
    }).join('')}</div>`;
  bindKanban();
}
function bindKanban() {
  let dragId = null;
  $$('.deal[draggable=true]').forEach(c => c.addEventListener('dragstart', e => { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); }));
  $$('.deal').forEach(c => c.addEventListener('dragend', () => c.classList.remove('dragging')));
  $$('.lane').forEach(l => {
    l.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); l.classList.add('over'); } });
    l.addEventListener('dragleave', () => l.classList.remove('over'));
    l.addEventListener('drop', async e => {
      e.preventDefault(); l.classList.remove('over');
      const id = dragId; dragId = null;
      if (!id || ui.oppCache?.get(id)?.stage === l.dataset.stage) return;
      try { await API.patch(`/opportunities/${id}`, { stage: l.dataset.stage }); toast(`已移至「${l.dataset.stage}」`); rerender(); } catch (err) { toast(err.message, true); }
    });
  });
}

export async function pageOpportunity(id) {
  const { item: o } = await API.get(`/opportunities/${id}`);
  const ov = await API.get(`/accounts/${o.accountId}/overview`).catch(() => null);
  const contracts = ov ? ov.contracts.filter(c => c.opportunityId === id) : [];
  const flow = STAGES.filter(s => s !== '输单');
  const cur = flow.indexOf(o.stage);
  const tab = ui.tabs.opp?.id === id ? ui.tabs.opp.tab : 'info';
  ui.tabs.opp = { id, tab };
  const next = cur >= 0 && cur < flow.length - 1 ? flow[cur + 1] : null;
  $('#content').innerHTML = `
    <a class="back" href="#/opportunities">${icon('left')}返回商机列表</a>
    <section class="panel detail-hero">
      <span class="hero-ic purple">${icon('briefcase')}</span>
      <div class="hero-main"><h2>${esc(o.accountName)} - ${esc(o.name)} ${tag(o.stage)}</h2>
        <div class="facts"><span>预计金额：<b>${money(o.amount)}</b></span><span>成交概率：<b>${Number(o.probability || 0)}%</b></span><span>负责人：<b>${esc(o.owner || '未分配')}</b></span><span>预计成交：<b>${fmtDate(o.expectedDate)}</b></span></div></div>
      <div class="tools">${canEdit() ? `<button class="btn light" data-act="edit" data-type="opportunities" data-id="${esc(id)}">${icon('edit')}编辑</button>
        ${next ? `<button class="btn light" data-act="opp-advance" data-id="${esc(id)}" data-stage="${next}">推进到「${next}」</button>` : ''}
        ${o.stage !== '输单' && !contracts.some(c => c.status !== '已作废') ? `<button class="btn green" data-act="opp-contract" data-id="${esc(id)}">${icon('file')}转合同</button>` : ''}
        ${!['赢单', '输单'].includes(o.stage) ? `<button class="btn light danger" data-act="opp-advance" data-id="${esc(id)}" data-stage="输单">标记输单</button>` : ''}` : ''}</div>
    </section>
    <section class="panel">
      <ol class="steps">${flow.map((s, i) => `<li class="${o.stage === '输单' ? 'lost' : i < cur ? 'done' : i === cur ? 'cur' : ''}"><span>${i < cur || (i === cur && s === '赢单') ? icon('check') : i + 1}</span>${s}</li>`).join('')}</ol>
      ${o.stage === '输单' ? '<p class="center"><span class="tag red">该商机已输单</span></p>' : ''}
    </section>
    <section class="panel">
      <div class="tabs">${[['info', '基本信息'], ['activities', `跟进记录 ${ov?.activities.length || 0}`], ['contracts', `相关合同 ${contracts.length}`], ['files', '相关文件']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="opp-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="tab-pane">${tab === 'info' ? `<div class="kv-grid">${[['商机名称', o.name], ['客户', o.accountName], ['阶段', o.stage], ['预计金额', money(o.amount)], ['成交概率', `${Number(o.probability || 0)}%`], ['负责人', o.owner], ['预计成交日', fmtDate(o.expectedDate)], ['创建时间', fmtDateTime(o.createdAt)]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}${customKv('opportunities', o)}<div class="kv wide"><span>备注</span><b>${esc(o.notes || '—')}</b></div></div>`
        : tab === 'activities' ? `<div class="sub-head">${canEdit() ? `<button class="btn light small" data-act="create" data-type="activities" data-account="${esc(o.accountId)}">${icon('plus')}写跟进</button>` : ''}</div>${table('activities', LISTS.activities.cols.filter(c => c[0] !== 'accountId'), ov?.activities || [])}`
        : tab === 'files' ? await filesPane('opportunities', id)
        : table('contracts', LISTS.contracts.cols.filter(c => c[0] !== 'accountId'), contracts)}</div>
    </section>`;
}
