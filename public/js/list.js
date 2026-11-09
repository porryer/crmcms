import { ACTIVITY_ICON, FORMS, IMPORTABLE, LISTS, icon } from './constants.js';
import { $, R, ui } from './state.js';
import { API, canApproveC, canEdit, canManage, curLevel, customCols, dict, esc, fmtDate, isOverdue, money, relTime, tag, ymd } from './util.js';

// ======================= 通用片段 =======================
export function pageHead(title, sub, buttons = '') {
  return `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="tools">${buttons}</div></div>`;
}
export const changeBadge = (v, suffix = '%') => {
  const n = Number(v || 0), up = n >= 0;
  return `<span class="chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${n}${suffix}</span>`;
};
export function optionList(kind, current = '', withEmpty = '') {
  let opts = [];
  if (Array.isArray(kind)) opts = kind.map(v => [v, v]);
  else if (kind.startsWith('dict:')) opts = dict(kind.slice(5)).map(v => [v, v]);
  else if (kind === 'user') opts = R.users.filter(u => u.active).map(u => [u.id, u.name]);
  if (current && !opts.some(([v]) => v === current)) opts.unshift([current, kind === 'user' ? (R.users.find(u => u.id === current)?.name || '（已停用成员）') : current]);
  return (withEmpty !== false ? `<option value="">${withEmpty || '全部'}</option>` : '') + opts.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

/** 单元格渲染 */
export function cell(type, [key, , kind], x) {
  const v = x[key];
  switch (kind) {
    case 'strong': return `<b>${esc(v || '—')}</b>`;
    case 'accountLink': return `<a class="link" href="#/accounts/${esc(x.id)}">${esc(v)}</a>`;
    case 'oppLink': return `<a class="link" href="#/opportunities/${esc(x.id)}">${esc(v)}</a>`;
    case 'account': return v ? `<a class="link" href="#/accounts/${esc(v)}">${esc(x.accountName || '（已删除）')}</a>` : '—';
    case 'contract': return v ? `<span class="link" data-act="view-contract" data-id="${esc(v)}">${esc(x.contractLabel || '（已删除）')}</span>` : '—';
    case 'contractAccount': return x.contractAccountId ? `<a class="link" href="#/accounts/${esc(x.contractAccountId)}">${esc(x.contractAccountName)}</a>` : '—';
    case 'money': return money(v);
    case 'pct': return `${Number(v || 0)}%`;
    case 'tag': return tag(v);
    case 'date': return fmtDate(v);
    case 'datetime': return relTime(v);
    case 'bool': return v ? '<span class="tag green">是</span>' : '—';
    case 'clip': return `<span class="clip" title="${esc(v)}">${esc(v)}</span>`;
    case 'activityType': return `<span class="atype">${icon(ACTIVITY_ICON[v] || 'message')}${esc(v || '—')}</span>`;
    case 'taskStatus': return tag(isOverdue(x) ? '逾期' : v);
    case 'taskCheck': return canEdit() ? `<button class="circle ${x.status === '已完成' ? 'done' : ''}" data-act="toggle-task" data-id="${esc(x.id)}" aria-label="切换完成">${icon('check')}</button>` : '';
    case 'planStatus': return tag(x.status !== '已回款' && x.dueDate < ymd() ? '逾期' : v);
    default: return esc(v ?? '—') || '—';
  }
}

function rowActions(type, x) {
  const b = [];
  const btn = (act, label, extra = '', cls = '') => `<button class="textbtn ${cls}" data-act="${act}" data-type="${type}" data-id="${esc(x.id)}" ${extra}>${label}</button>`;
  if (type === 'accounts') b.push(`<a class="textbtn" href="#/accounts/${esc(x.id)}">查看</a>`);
  else if (type === 'opportunities') b.push(`<a class="textbtn" href="#/opportunities/${esc(x.id)}">查看</a>`);
  else if (type === 'contracts') b.push(btn('view-contract', '查看'));
  else b.push(btn('view', '查看'));
  if (canEdit() && !LISTS[type]?.noEdit && !(type === 'leads' && x.convertedAccountId)) b.push(btn('edit', '编辑'));
  if (type === 'leads' && canEdit() && !x.convertedAccountId) b.push(btn('assign', '分配'), btn('convert', '转客户'));
  if (type === 'leads' && x.convertedAccountId) b.push(`<a class="textbtn" href="#/accounts/${esc(x.convertedAccountId)}">已转客户</a>`);
  if (type === 'contracts' && canEdit() && x.status === '草稿') b.push(btn('submit-contract', '提交审批'));
  if (type === 'contracts' && canApproveC(x)) b.push(btn('approve-contract', `审批${curLevel(x) ? '·' + curLevel(x).name.replace(/审批$/, '') : ''}`));
  if (type === 'contracts' && canEdit() && x.status !== '已作废') b.push(btn('pay-contract', '登记回款'));
  if (type === 'plans' && canEdit() && x.status !== '已回款') b.push(btn('plan-paid', '确认回款'));
  if (canManage()) b.push(btn('delete', '删除', '', 'danger'));
  return `<div class="row-actions">${b.join('')}</div>`;
}

export function table(type, cols, items, { selectable = false, actions = true, selected = new Set() } = {}) {
  if (!items.length) return `<div class="empty">${icon('list')}<p>暂无数据</p></div>`;
  return `<div class="tbl-wrap"><table>
    <thead><tr>${selectable ? `<th class="sel"><input type="checkbox" data-act="select-all" aria-label="全选" ${items.every(x => selected.has(x.id)) ? 'checked' : ''}></th>` : ''}${cols.map(c => `<th>${c[1]}</th>`).join('')}${actions ? '<th class="ops">操作</th>' : ''}</tr></thead>
    <tbody>${items.map(x => `<tr class="${type === 'tasks' && x.status === '已完成' ? 'is-done' : ''}">${selectable ? `<td class="sel"><input type="checkbox" data-act="select-row" data-id="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''} aria-label="选择"></td>` : ''}${cols.map(c => `<td data-label="${esc(c[1])}">${cell(type, c, x)}</td>`).join('')}${actions ? `<td class="ops">${rowActions(type, x)}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
}

function pager(total, page, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<div class="pager"><span class="muted">共 ${total} 条</span>
    <button class="pg" data-act="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="上一页">${icon('left')}</button>
    ${nums.map(n => n === '…' ? '<span class="muted">…</span>' : `<button class="pg ${n === page ? 'on' : ''}" data-act="page" data-page="${n}">${n}</button>`).join('')}
    <button class="pg" data-act="page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="下一页">${icon('right')}</button>
    <select class="field slim" data-act-change="page-size">${[10, 20, 50, 100].map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} 条/页</option>`).join('')}</select></div>`;
}

// ======================= 通用列表 =======================
/**
 * 在 container 中挂载一个带筛选/分页/批量操作的列表。
 * opts.fixed: 固定过滤（不显示）；opts.tabs: [[label, params]] 顶部状态页签
 */
export function mountList(container, type, opts = {}) {
  const def = LISTS[type];
  const L = ui.list = { type, container, page: 1, pageSize: 10, q: opts.q || '', filters: { ...(opts.filters || {}) }, fixed: opts.fixed || {}, selected: new Set(), tabs: opts.tabs || null, tab: opts.tab || 0, items: [] };
  const filters = def.filters.filter(([k]) => !(k in L.fixed)).map(([k, label, kind]) => `<label class="filter"><span>${label}</span><select class="field slim" data-act-change="filter" data-key="${k}">${optionList(kind, L.filters[k] || '')}</select></label>`).join('');
  container.innerHTML = `
    ${L.tabs ? `<div class="tabs">${L.tabs.map(([label], i) => `<button class="tab ${i === L.tab ? 'on' : ''}" data-act="list-tab" data-i="${i}">${label}</button>`).join('')}</div>` : ''}
    <div class="toolbar">
      <div class="filters">${filters}<label class="search">${icon('search')}<input data-act-input="list-q" placeholder="输入关键字搜索" value="${esc(L.q)}"></label></div>
      <div class="tools">
        <span class="batch" id="batchBar" hidden><span class="muted" id="batchCount"></span>
          ${def.batch && canEdit() && FORMS[type].some(f => f[0] === 'ownerId') ? '<button class="btn light small" data-act="batch-assign">批量分配</button>' : ''}
          ${def.batch && canManage() ? '<button class="btn light small danger" data-act="batch-delete">批量删除</button>' : ''}</span>
        ${canEdit() && IMPORTABLE.includes(type) ? `<button class="btn light" data-act="import" data-type="${type}">${icon('upload')}导入</button>` : ''}
        ${canEdit() ? `<span class="btn-group"><button class="btn light" data-act="export" data-format="xlsx" title="导出当前筛选结果为 Excel">${icon('download')}导出 Excel</button><button class="btn light" data-act="export" data-format="csv" title="导出为 CSV">CSV</button></span>` : ''}
        ${canEdit() && def.create ? `<button class="btn" data-act="create" data-type="${type}">${icon('plus')}${def.create}</button>` : ''}
      </div>
    </div>
    <div class="panel flush" id="listBody"><div class="loading">加载中…</div></div>`;
  return loadList();
}
export function listParams(L, paged = true) {
  const p = new URLSearchParams();
  const tabParams = L.tabs ? L.tabs[L.tab][1] : {};
  for (const [k, v] of Object.entries({ ...L.fixed, ...tabParams, ...L.filters })) if (v) p.set(k, v);
  if (L.q) p.set('q', L.q);
  if (paged) { p.set('page', L.page); p.set('pageSize', L.pageSize); }
  return p;
}
export async function loadList() {
  const L = ui.list; if (!L) return;
  const r = await API.get(`/${L.type}?${listParams(L)}`);
  if (ui.list !== L) return;
  if (!r.items.length && L.page > 1) { L.page = Math.max(1, Math.ceil(r.total / L.pageSize)); return loadList(); }
  L.items = r.items;
  const def = LISTS[L.type];
  const cols = [...def.cols, ...customCols(L.type)].filter(([k]) => !(k in L.fixed));
  $('#listBody', L.container).innerHTML = table(L.type, cols, r.items, { selectable: def.batch && canEdit(), selected: L.selected }) + (r.total ? pager(r.total, L.page, L.pageSize) : '');
  updateBatchBar();
}
export function updateBatchBar() {
  const L = ui.list, bar = $('#batchBar'); if (!L || !bar) return;
  bar.hidden = !L.selected.size;
  $('#batchCount').textContent = `已选 ${L.selected.size} 项`;
}

export async function pageList(type, r) {
  const def = LISTS[type];
  const content = $('#content');
  content.innerHTML = pageHead(def.title, def.sub) + '<div id="listHost"></div>';
  await mountList($('#listHost'), type, { q: r.params.get('q') || '' });
}
