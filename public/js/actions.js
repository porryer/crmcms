import { ENTITY_LABEL, PROVIDER_NAME } from './constants.js';
import { filesPane, importModal, uploadFiles } from './files.js';
import { assignModal, confirmBox, deleteRecord, editRecord, fieldControl, openModal, viewRecord } from './forms.js';
import { listParams, loadList, updateBatchBar } from './list.js';
import { dingtalkAutoLogin, renderLogin } from './login.js';
import { approveModal, viewContract } from './pages/contracts.js';
import { pageDashboard } from './pages/dashboard.js';
import { renderStatement } from './pages/finance.js';
import { mfaModal } from './pages/mfa.js';
import { pageSettings } from './pages/settings.js';
import { userModal } from './pages/team.js';
import { go, parseRoute, rerender } from './router.js';
import { openNotifications } from './shell.js';
import { $, $$, R, me, setMe, setSettings, settings, ui } from './state.js';
import { API, debounce, esc, request, toast, ymd } from './util.js';

// ======================= 事件委托 =======================
const ACTIONS = {
  'toggle-nav': () => { if (matchMedia('(max-width: 900px)').matches) document.body.classList.toggle('nav-open'); else { ui.collapsed = !ui.collapsed; $('#shell').classList.toggle('collapsed', ui.collapsed); } },
  'close-nav': () => document.body.classList.remove('nav-open'),
  'toggle-group': t => { const g = t.dataset.group; ui.openGroups.has(g) ? ui.openGroups.delete(g) : ui.openGroups.add(g); t.parentElement.classList.toggle('open'); if (ui.collapsed) { ui.collapsed = false; $('#shell').classList.remove('collapsed'); } },
  'user-menu': () => { const d = $('#userDropdown'); d.hidden = !d.hidden; },
  logout: async () => { try { await API.post('/logout'); } catch { /* ignore */ } try { sessionStorage.setItem('novacrm.noAuto', '1'); } catch { /* ignore */ } setMe(null); renderLogin(); },
  'dd-auto': () => dingtalkAutoLogin().catch(() => {}),
  password: () => openModal({
    title: '修改登录密码',
    body: '<label class="fld wide"><span>当前密码</span><input class="field" name="oldPassword" type="password" required autocomplete="current-password"></label><label class="fld wide"><span>新密码（至少12位）</span><input class="field" name="newPassword" type="password" minlength="12" required autocomplete="new-password"></label>',
    onSubmit: async fd => { await API.post('/password', Object.fromEntries(fd)); setMe(null); toast('密码已修改，请重新登录'); renderLogin(); },
  }),
  create: t => editRecord(t.dataset.type, null, t.dataset.account ? { accountId: t.dataset.account } : {}),
  edit: t => { document.querySelector('dialog.modal')?.close(); editRecord(t.dataset.type, t.dataset.id); },
  view: t => viewRecord(t.dataset.type, t.dataset.id),
  delete: async t => { await deleteRecord(t.dataset.type, t.dataset.id); if (t.dataset.type === 'accounts' && parseRoute().id) go('#/accounts'); },
  assign: t => assignModal(t.dataset.type, [t.dataset.id]),
  convert: async t => {
    if (!await confirmBox('将该线索转换为客户？系统会创建客户档案（及主联系人），转换后不可再次转换。', '确认转换', false)) return;
    try { const r = await API.post(`/leads/${t.dataset.id}/convert`); toast('线索已转为客户'); go(`#/accounts/${r.accountId}`); } catch (e) { toast(e.message, true); }
  },
  'view-contract': t => viewContract(t.dataset.id),
  'pay-contract': t => { document.querySelector('dialog.modal')?.close(); editRecord('payments', null, { contractId: t.dataset.id }); },
  'submit-contract': async t => { try { await API.post(`/contracts/${t.dataset.id}/submit`); toast('已提交审批'); rerender(); } catch (e) { toast(e.message, true); } },
  'approve-contract': t => approveModal(t.dataset.id),
  'reject-contract': async t => {
    const dlg = t.closest('dialog'), id = dlg.dataset.contract, note = dlg.querySelector('[name=note]').value;
    try { await API.post(`/contracts/${id}/approve`, { approved: false, note }); dlg.close(); toast('已驳回，合同退回草稿'); rerender(); } catch (e) { toast(e.message, true); }
  },
  'plan-paid': async t => {
    const { item: p } = await API.get(`/plans/${t.dataset.id}`);
    openModal({
      title: '确认回款', submitText: '登记回款并完成计划',
      body: `<p class="muted">将按计划登记一笔回款，并把该计划标记为“已回款”。</p><div class="form-grid">${fieldControl('payments', ['amount', '回款金额（元）', 'money', 1], { amount: p.amount })}${fieldControl('payments', ['paidAt', '到账日期', 'date'], { paidAt: ymd() })}${fieldControl('payments', ['method', '付款方式', 'dict:paymentMethods'], {})}</div>`,
      onSubmit: async fd => {
        await API.post('/payments', { contractId: p.contractId, amount: Number(fd.get('amount')), paidAt: fd.get('paidAt'), method: fd.get('method'), notes: `回款计划 ${p.dueDate}` });
        await API.patch(`/plans/${p.id}`, { status: '已回款' });
        toast('已登记回款'); rerender();
      },
    });
  },
  'toggle-task': async t => {
    const id = t.dataset.id;
    try { const { item } = await API.get(`/tasks/${id}`); await API.patch(`/tasks/${id}`, { status: item.status === '已完成' ? '待处理' : '已完成' }); toast(item.status === '已完成' ? '任务已重新打开' : '任务已完成'); rerender(); } catch (e) { toast(e.message, true); }
  },
  'dash-range': t => { ui.dashRange = t.dataset.range; pageDashboard().catch(e => toast(e.message, true)); },
  'opp-view': t => { ui.oppView = t.dataset.view; go('#/opportunities'); },
  'opp-advance': async t => { try { await API.patch(`/opportunities/${t.dataset.id}`, { stage: t.dataset.stage }); toast(`阶段已更新为「${t.dataset.stage}」`); rerender(); } catch (e) { toast(e.message, true); } },
  'opp-contract': async t => {
    if (!await confirmBox('根据该商机生成合同草稿，并将商机标记为“赢单”？', '生成合同', false)) return;
    try { const r = await API.post(`/opportunities/${t.dataset.id}/contract`); toast(`已生成合同 ${r.item.number}`); go('#/contracts?q=' + encodeURIComponent(r.item.number)); } catch (e) { toast(e.message, true); }
  },
  'account-tab': t => { ui.tabs.account.tab = t.dataset.tab; rerender(); },
  'opp-tab': t => { ui.tabs.opp.tab = t.dataset.tab; rerender(); },
  'finance-tab': t => { ui.tabs.finance = t.dataset.tab; rerender(); },
  'settings-tab': t => { ui.tabs.settings = t.dataset.tab; rerender(); },
  'list-tab': t => { const L = ui.list; L.tab = Number(t.dataset.i); L.page = 1; L.selected.clear(); $$('.tabs .tab', L.container).forEach((b, i) => b.classList.toggle('on', i === L.tab)); loadList(); },
  page: t => { ui.list.page = Number(t.dataset.page); loadList(); },
  'select-all': t => { const L = ui.list; L.items.forEach(x => (t.checked ? L.selected.add(x.id) : L.selected.delete(x.id))); $$('[data-act=select-row]', L.container).forEach(c => { c.checked = t.checked; }); updateBatchBar(); },
  'select-row': t => { const L = ui.list; t.checked ? L.selected.add(t.dataset.id) : L.selected.delete(t.dataset.id); updateBatchBar(); },
  'batch-assign': () => assignModal(ui.list.type, [...ui.list.selected]),
  'batch-delete': async () => {
    const L = ui.list;
    if (!await confirmBox(`确认删除选中的 ${L.selected.size} 条${ENTITY_LABEL[L.type]}？存在关联数据的记录将被跳过。`, '批量删除')) return;
    try { const r = await API.post(`/${L.type}/batch`, { action: 'delete', ids: [...L.selected] }); toast(`已删除 ${r.done.length} 条${r.failed.length ? `，${r.failed.length} 条因存在关联数据未删除` : ''}`, !!r.failed.length); L.selected.clear(); rerender(); } catch (e) { toast(e.message, true); }
  },
  export: t => { const L = ui.list; location.href = `/api/${L.type}?${listParams(L, false)}&format=${t.dataset.format || 'xlsx'}`; },
  'report-query': () => { ui.tabs.reports = { from: $('#rFrom').value, to: $('#rTo').value }; rerender(); },
  'report-export': () => { location.href = `/api/reports?from=${encodeURIComponent($('#rFrom').value)}&to=${encodeURIComponent($('#rTo').value)}&format=xlsx`; },
  'user-create': () => userModal(),
  mfa: () => mfaModal(),
  'mfa-start': async t => {
    const r = await API.post('/mfa/setup');
    const dlg = t.closest('dialog'), box = t.closest('.modal-body');
    // qrSvg 由服务端生成（仅含路径数据，不含用户输入的标记）
    box.innerHTML = `<div class="mfa-setup"><div class="qr">${r.qrSvg}</div><ol class="howto"><li>在手机上打开身份验证器 App（Google/Microsoft Authenticator、腾讯身份验证器等），<b>扫描左侧二维码</b>。</li>
      <li>无法扫码时选择“手动输入密钥”：账号 <b>${esc(me.email)}</b>，密钥：<div class="secret">${esc(r.secret.match(/.{1,4}/g).join(' '))}</div>类型选“基于时间”。</li>
      <li>输入 App 中显示的 6 位动态码完成绑定。</li></ol></div>
      <label class="fld wide"><span>动态码</span><input class="field" name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>`;
    dlg.querySelector('[type=submit]').hidden = false;
    box.querySelector('[name=code]').focus();
  },
  'im-unbind': async t => {
    const prov = t.dataset.provider;
    if (!await confirmBox(`解除与${PROVIDER_NAME[prov]}账号的绑定？解绑后需重新绑定才能扫码登录。`, '解绑')) return;
    await API.del(`/me/identities?provider=${prov}`);
    setMe((await request('/me')).user); toast('已解绑'); $('#shell')?.remove(); rerender();
  },
  'user-sso-unbind': async t => {
    const u = R.users.find(x => x.id === t.dataset.id);
    if (!await confirmBox(`解除「${u.name}」与单点登录身份的绑定？下次单点登录时将按邮箱重新绑定。`, '解绑')) return;
    await API.patch(`/users/${u.id}`, { unbindSso: true }); toast('已解绑'); rerender();
  },
  'user-mfa-reset': async t => {
    const u = R.users.find(x => x.id === t.dataset.id);
    if (!await confirmBox(`重置「${u.name}」的两步验证？对方下次登录只需密码，可重新绑定。`, '重置')) return;
    await API.patch(`/users/${u.id}`, { resetMfa: true }); toast('已重置'); rerender();
  },
  notif: () => openNotifications(),
  import: t => importModal(t.dataset.type),
  'file-del': async t => {
    if (!await confirmBox('确认删除该文件？')) return;
    const box = t.closest('.files');
    await API.del(`/attachments/${t.dataset.id}`); toast('已删除');
    box.outerHTML = await filesPane(box.dataset.entity, box.dataset.id);
  },
  'logo-del': async () => { setSettings((await API.del('/settings/logo')).settings); toast('已移除 Logo'); $('#shell')?.remove(); rerender(); },
  'stmt-query': () => { ui.tabs.stmt = { accountId: $('#stAccount').value, from: $('#stFrom').value, to: $('#stTo').value }; renderStatement($('#financeBody')).catch(e => toast(e.message, true)); },
  'stmt-account': t => { ui.tabs.stmt.accountId = t.dataset.id; renderStatement($('#financeBody')).catch(e => toast(e.message, true)); },
  'stmt-export': () => { const st = ui.tabs.stmt; location.href = `/api/statements?${new URLSearchParams({ from: st.from, to: st.to, ...(st.accountId ? { accountId: st.accountId } : {}), format: 'xlsx' })}`; },
  print: () => window.print(),
  'cf-add': t => { (ui.cfDraft[t.dataset.ent] ||= []).push({ label: '', type: 'text', options: [], required: false, inList: false }); pageSettings(); },
  'cf-del': t => { ui.cfDraft[t.dataset.ent].splice(Number(t.dataset.i), 1); pageSettings(); },
  'cf-reset': () => { ui.cfDraft = null; pageSettings(); },
  'ap-add': () => { ui.apDraft.push({ name: '总经理审批', role: 'admin', minAmount: 100000 }); pageSettings(); },
  'ap-del': t => { ui.apDraft.splice(Number(t.dataset.i), 1); pageSettings(); },
  'smtp-test': async t => { t.disabled = true; try { const r = await API.post('/settings/smtp-test'); toast(`测试邮件已发送至 ${r.to}`); } finally { t.disabled = false; } },
  'digest-now': async () => { const r = await API.post('/settings/digest-now'); toast(`已发送 ${r.sent} 封摘要邮件`); },
  'im-toggle': async () => { const r = await API.patch('/me', { imNotify: !me.imNotify }); setMe({ ...me, ...r.user }); toast(me.imNotify ? '已开启工作通知' : '已关闭工作通知'); $('#shell')?.remove(); rerender(); },
  'im-test': async t => { t.disabled = true; try { await API.post('/settings/im-test', { provider: t.dataset.provider }); toast('测试消息已发送，请在手机上查看'); } finally { t.disabled = false; } },
  'email-toggle': async () => { const r = await API.patch('/me', { emailNotify: !me.emailNotify }); setMe({ ...me, ...r.user }); toast(me.emailNotify ? '已开启邮件通知' : '已关闭邮件通知'); $('#shell')?.remove(); rerender(); },
  'webhook-test': async () => { await API.post('/settings/webhook-test'); toast('测试消息已发送，请在群内查看'); },
  'backup-now': async () => { const r = await API.post('/backups'); toast('已生成备份 ' + r.name); rerender(); },
  'user-edit': t => userModal(R.users.find(u => u.id === t.dataset.id)),
  'user-toggle': async t => {
    const u = R.users.find(x => x.id === t.dataset.id);
    if (u.active && !await confirmBox(`确认停用成员「${u.name}」？其登录会话会立即失效。`, '停用')) return;
    try { await API.patch(`/users/${u.id}`, { active: !u.active }); toast(u.active ? '已停用' : '已启用'); rerender(); } catch (e) { toast(e.message, true); }
  },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
  const fn = ACTIONS[t.dataset.act];
  if (!fn) return;
  if (t.tagName !== 'INPUT') e.preventDefault();
  Promise.resolve(fn(t, e)).catch(err => toast(err.message, true));
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-act-change]'); if (!t) return;
  const L = ui.list;
  if (t.dataset.actChange === 'filter') { L.filters[t.dataset.key] = t.value; L.page = 1; L.selected.clear(); loadList().catch(err => toast(err.message, true)); }
  if (t.dataset.actChange === 'page-size') { L.pageSize = Number(t.value); L.page = 1; loadList().catch(err => toast(err.message, true)); }
  if (t.dataset.actChange === 'upload') uploadFiles(t).catch(err => toast(err.message, true));
  if (t.dataset.actChange === 'logo') {
    const f = t.files[0]; if (!f) return;
    fetch('/api/settings/logo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type }, body: f })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setSettings(d.settings); settings.logoV = Date.now(); toast('Logo 已更新'); $('#shell')?.remove(); rerender(); })
      .catch(err => toast(err.message, true));
  }
  if (t.dataset.cf !== undefined || t.dataset.ap !== undefined) syncDraft(t);
  if (t.dataset.actChange === 'opp-owner') go('#/opportunities' + (t.value ? '?owner=' + encodeURIComponent(t.value) : ''));
});
const onListSearch = debounce(v => { const L = ui.list; if (!L) return; L.q = v.trim(); L.page = 1; L.selected.clear(); loadList().catch(err => toast(err.message, true)); }, 300);
document.addEventListener('input', e => { if (e.target.dataset.actInput === 'list-q') onListSearch(e.target.value); if (e.target.dataset.cf !== undefined || e.target.dataset.ap !== undefined) syncDraft(e.target); });
/** 设置页可编辑表格 → 草稿对象 */
function syncDraft(el) {
  const prop = el.dataset.prop, v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.ap !== undefined) { ui.apDraft[Number(el.dataset.ap)][prop] = prop === 'minAmount' ? Number(v || 0) : v; return; }
  const f = ui.cfDraft[el.dataset.cf][Number(el.dataset.i)];
  f[prop] = prop === 'options' ? String(v).split(/[,，\n]/).map(x => x.trim()).filter(Boolean) : v;
  if (prop === 'type') { const opt = el.closest('tr').querySelector('[data-prop=options]'); opt.disabled = v !== 'select'; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });
