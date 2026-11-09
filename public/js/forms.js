import { CONTRACT_STATUS, ENTITY_LABEL, FORMS, LISTS, icon } from './constants.js';
import { optionList } from './list.js';
import { rerender } from './router.js';
import { me, ui } from './state.js';
import { API, canEdit, canManage, debounce, esc, fmtDateTime, formFields, isAdmin, money, nowLocal, toast, ymd } from './util.js';

// ======================= 远程搜索下拉 =======================
const RS_TYPE = { account: 'accounts', contract: 'contracts', opportunity: 'opportunities' };
const RS_EMPTY = { account: '请选择客户', contract: '请选择合同', opportunity: '不关联商机' };
/** 带搜索框的下拉：输入关键字后从 /api/lookup 拉取前 30 条，避免一次性加载全部客户 */
export function remoteSelect(kind, attrs, value = '', emptyText = RS_EMPTY[kind]) {
  return `<span class="rselect" data-kind="${kind}"><input class="field rs-q" data-rs-q placeholder="输入名称搜索…" autocomplete="off" aria-label="搜索">
    <select class="field" ${attrs} data-role="${kind}" data-rs-value="${esc(value)}" data-empty="${esc(emptyText)}"><option value="">${esc(emptyText)}</option>${value ? `<option value="${esc(value)}" selected>加载中…</option>` : ''}</select></span>`;
}
async function rsLoad(box, q = '') {
  const kind = box.dataset.kind, sel = box.querySelector('select'), current = sel.value || sel.dataset.rsValue || '';
  const params = new URLSearchParams({ type: RS_TYPE[kind], q, limit: 30 });
  if (kind === 'contract') params.set('active', '1');
  if (kind === 'opportunity') {
    const acc = box.closest('form, .toolbar, .modal-body')?.querySelector('[data-role=account]')?.value;
    if (!acc) { sel.innerHTML = `<option value="">先选择客户</option>`; return; }
    params.set('accountId', acc);
  }
  const reqs = [API.get('/lookup?' + params)];
  if (current) reqs.push(API.get(`/lookup?type=${RS_TYPE[kind]}&ids=${encodeURIComponent(current)}`));
  const [list, cur] = await Promise.all(reqs);
  const items = list.items.slice();
  if (cur?.items[0] && !items.some(x => x.id === current)) items.unshift(cur.items[0]);
  sel.innerHTML = `<option value="">${esc(sel.dataset.empty)}</option>` + items.map(x => `<option value="${esc(x.id)}" ${x.id === current ? 'selected' : ''}>${esc(x.label)}</option>`).join('')
    + (list.items.length >= 30 ? '<option value="" disabled>… 结果较多，请输入关键字缩小范围</option>' : '');
  sel.dataset.rsValue = sel.value;
}
export function initRemoteSelects(root) {
  for (const box of root.querySelectorAll('.rselect')) rsLoad(box).catch(e => toast(e.message, true));
}
document.addEventListener('input', debounce(e => { const box = e.target.closest?.('.rselect'); if (box && e.target.matches('[data-rs-q]')) rsLoad(box, e.target.value.trim()).catch(err => toast(err.message, true)); }, 250));
document.addEventListener('change', e => {
  if (!e.target.matches?.('[data-role=account]')) return;
  const opp = e.target.closest('form')?.querySelector('.rselect[data-kind=opportunity]');
  if (opp) { opp.querySelector('select').dataset.rsValue = ''; rsLoad(opp).catch(err => toast(err.message, true)); }
});

// ======================= 表单弹窗 =======================
export function fieldControl(type, field, record) {
  const [key, label, kind = 'text', required = 0, wide = 0] = field;
  const v = record[key] ?? '';
  const req = required ? 'required' : '';
  let input;
  if (kind === 'textarea') input = `<textarea class="field" name="${key}" ${req} maxlength="3000">${esc(v)}</textarea>`;
  else if (kind === 'checkbox') return `<label class="check fld"><input type="checkbox" name="${key}" ${v ? 'checked' : ''}> ${label}</label>`;
  else if (['account', 'contract', 'opportunity'].includes(kind)) input = remoteSelect(kind, `name="${key}" ${req}`, v);
  else if (kind === 'user') input = `<select class="field" name="${key}">${optionList('user', v, '未分配')}</select>`;
  else if (kind === 'contractStatus') {
    const signed = ['已签订', '执行中', '已完成'];
    const opts = isAdmin() ? CONTRACT_STATUS
      : canManage() ? CONTRACT_STATUS.filter(s => ['草稿', '审批中', '已作废'].includes(s) || s === v || (signed.includes(v) && signed.includes(s)))
        : CONTRACT_STATUS.filter(s => ['草稿', '审批中'].includes(s) || s === v);
    input = `<select class="field" name="${key}">${opts.map(o => `<option ${o === (v || '草稿') ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (Array.isArray(kind) || kind.startsWith('dict:')) input = `<select class="field" name="${key}">${optionList(kind, v, required || (Array.isArray(kind) && FORMS[type]?.some(f => f[0] === key)) ? false : '请选择')}</select>`;
  else if (kind === 'money') input = `<input class="field" type="number" name="${key}" step="0.01" min="0" max="1000000000000" value="${esc(v)}" ${req} inputmode="decimal">`;
  else if (kind === 'percent') input = `<input class="field" type="number" name="${key}" step="1" min="0" max="100" value="${esc(v)}">`;
  else if (kind === 'datetime') input = `<input class="field" type="datetime-local" name="${key}" value="${esc(String(v).slice(0, 16))}">`;
  else if (kind === 'number') input = `<input class="field" type="number" step="any" name="${key}" value="${esc(v)}" ${req}>`;
  else input = `<input class="field" type="${kind}" name="${key}" value="${esc(v)}" ${req} maxlength="3000">`;
  return `<label class="fld ${wide || kind === 'textarea' ? 'wide' : ''}"><span>${label}${required ? ' <i class="req">*</i>' : ''}</span>${input}</label>`;
}

export function openModal({ title, body, submitText = '保存', onSubmit, wide = false, readOnly = false, footer = '' }) {
  document.querySelector('dialog.modal')?.close();
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' wide' : '');
  dlg.innerHTML = `<form method="dialog" class="modal-form"><div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="iconbtn" data-close aria-label="关闭">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${footer}<button type="button" class="btn light" data-close>${readOnly ? '关闭' : '取消'}</button>${readOnly ? '' : `<button type="submit" class="btn">${submitText}</button>`}</div></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (readOnly || !onSubmit) return dlg.close();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try { const keep = await onSubmit(new FormData(form), form); if (keep !== false) dlg.close(); }
    catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
  dlg.showModal();
  initRemoteSelects(form);
  return dlg;
}

export function confirmBox(message, okText = '确定', danger = true) {
  return new Promise(resolve => {
    let ok = false;
    const dlg = openModal({ title: '请确认', body: `<p class="confirm">${esc(message)}</p>`, submitText: okText, onSubmit: async () => { ok = true; } });
    if (danger) dlg.querySelector('[type=submit]').classList.add('danger-solid');
    dlg.addEventListener('close', () => resolve(ok));
  });
}

function formToBody(type, fd) {
  const body = {};
  for (const [key, , kind] of formFields(type)) {
    if (kind === 'checkbox') { body[key] = fd.has(key); continue; }
    if (!fd.has(key)) continue;
    const v = String(fd.get(key)).trim();
    body[key] = kind === 'money' || kind === 'percent' ? (v === '' ? 0 : Number(v)) : v;
  }
  return body;
}

export async function editRecord(type, id = null, preset = {}) {
  let record = { ...preset };
  if (id) record = (await API.get(`/${type}/${id}`)).item;
  else {
    if (FORMS[type].some(f => f[0] === 'ownerId') && !record.ownerId) record.ownerId = me.id;
    if (type === 'activities' && !record.occurredAt) record.occurredAt = nowLocal();
    if (type === 'payments' && !record.paidAt) record.paidAt = ymd();
  }
  openModal({
    title: `${id ? '编辑' : '新增'}${ENTITY_LABEL[type]}`,
    wide: formFields(type).length > 6,
    body: `<div class="form-grid">${formFields(type).map(f => fieldControl(type, f, record)).join('')}</div>`,
    onSubmit: async fd => {
      await (id ? API.patch(`/${type}/${id}`, formToBody(type, fd)) : API.post(`/${type}`, formToBody(type, fd)));
      toast('已保存'); rerender();
    },
  });
}

export async function viewRecord(type, id) {
  const { item } = await API.get(`/${type}/${id}`);
  const rows = formFields(type).map(([k, label, kind]) => {
    let v = item[k];
    if (kind === 'user') v = item.owner; else if (kind === 'account') v = item.accountName; else if (kind === 'contract') v = item.contractLabel; else if (kind === 'opportunity') v = item.opportunityName;
    else if (kind === 'money') v = money(v); else if (kind === 'checkbox') v = v ? '是' : '否'; else if (kind === 'datetime') v = fmtDateTime(v);
    return `<div class="kv ${kind === 'textarea' ? 'wide' : ''}"><span>${label.replace(/（.*?）/, '')}</span><b>${esc(v || '—')}</b></div>`;
  }).join('');
  openModal({ title: `${ENTITY_LABEL[type]}详情`, wide: true, readOnly: true, body: `<div class="kv-grid">${rows}<div class="kv"><span>创建时间</span><b>${fmtDateTime(item.createdAt)}</b></div><div class="kv"><span>更新时间</span><b>${fmtDateTime(item.updatedAt)}</b></div></div>`,
    footer: canEdit() && !LISTS[type]?.noEdit ? `<button type="button" class="btn light" data-act="edit" data-type="${type}" data-id="${esc(id)}">编辑</button>` : '' });
}

export async function deleteRecord(type, id) {
  if (!await confirmBox(`确认删除该${ENTITY_LABEL[type]}？操作将写入审计日志。`, '删除')) return;
  try { await API.del(`/${type}/${id}`); toast('已删除'); rerender(); } catch (e) { toast(e.message, true); }
}

export function assignModal(type, ids) {
  openModal({
    title: `分配负责人（${ids.length} 条）`,
    body: `<label class="fld wide"><span>负责人 <i class="req">*</i></span><select class="field" name="ownerId" required>${optionList('user', '', '请选择负责人')}</select></label>`,
    onSubmit: async fd => {
      const r = await API.post(`/${type}/batch`, { action: 'assign', ids, ownerId: fd.get('ownerId') });
      toast(`已分配 ${r.done.length} 条${r.failed.length ? `，失败 ${r.failed.length} 条` : ''}`);
      if (ui.list) ui.list.selected.clear();
      rerender();
    },
  });
}
