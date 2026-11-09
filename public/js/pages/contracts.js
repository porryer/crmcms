import { filesPane } from '../files.js';
import { openModal } from '../forms.js';
import { cell } from '../list.js';
import { rerender } from '../router.js';
import { API, canApproveC, canEdit, curLevel, customKv, esc, fmtDate, fmtDateTime, money, toast } from '../util.js';

// ======================= 合同 =======================
export async function viewContract(id) {
  const { item: c } = await API.get(`/contracts/${id}`);
  const [{ items: pays }, { items: plans }] = await Promise.all([API.get(`/payments?contractId=${id}`), API.get(`/plans?contractId=${id}`)]);
  const got = pays.reduce((a, p) => a + Number(p.amount), 0);
  const ratio = c.amount ? Math.min(100, Math.round((got / c.amount) * 100)) : 0;
  const files = await filesPane('contracts', id);
  const levels = c.approvalLevels || [];
  const ACTION = { submit: '提交审批', approve: '通过', reject: '驳回', withdraw: '撤回' };
  const approvalHtml = levels.length || (c.approvalHistory || []).length ? `<h4 class="sec">审批流程</h4>
    ${levels.length ? `<ol class="steps small">${levels.map((l, i) => `<li class="${c.status === '审批中' ? (i < c.approvalStep ? 'done' : i === c.approvalStep ? 'cur' : '') : ['已签订', '执行中', '已完成'].includes(c.status) ? 'done' : ''}"><span>${i + 1}</span>${esc(l.name)}</li>`).join('')}</ol>` : ''}
    <ul class="timeline">${(c.approvalHistory || []).slice().reverse().map(h => `<li class="${h.action}"><b>${esc(h.byName)}</b> ${ACTION[h.action] || h.action}${h.level ? `（${esc(h.level)}）` : ''}<small>${fmtDateTime(h.at)}</small>${h.note ? `<p>${esc(h.note)}</p>` : ''}</li>`).join('')}</ul>` : '';
  openModal({
    title: `合同 ${c.number || ''}`, wide: true, readOnly: true,
    body: `<div class="kv-grid">${[['合同名称', c.name], ['客户', c.accountName], ['关联商机', c.opportunityName], ['合同金额', money(c.amount)], ['状态', c.status], ['签订日期', fmtDate(c.signedAt)], ['合同期限', c.startDate || c.endDate ? `${fmtDate(c.startDate)} ~ ${fmtDate(c.endDate)}` : ''], ['负责人', c.owner]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}
      ${customKv('contracts', c)}<div class="kv wide"><span>备注</span><b>${esc(c.notes || '—')}</b></div></div>${approvalHtml}
      <h4 class="sec">回款进度 <span class="muted small">已收 ${money(got)} / 应收 ${money(c.amount)}（${ratio}%）</span></h4><progress max="100" value="${ratio}"></progress>
      ${pays.length ? `<table class="mini"><thead><tr><th>到账日期</th><th>金额</th><th>方式</th><th>备注</th></tr></thead><tbody>${pays.map(p => `<tr><td>${fmtDate(p.paidAt)}</td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.notes || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">暂无回款记录</p>'}
      ${plans.length ? `<h4 class="sec">回款计划</h4><table class="mini"><thead><tr><th>计划日期</th><th>金额</th><th>状态</th></tr></thead><tbody>${plans.map(p => `<tr><td>${fmtDate(p.dueDate)}</td><td>${money(p.amount)}</td><td>${cell('plans', ['status', '', 'planStatus'], p)}</td></tr>`).join('')}</tbody></table>` : ''}
      <h4 class="sec">相关文件</h4>${files}`,
    footer: canEdit() ? `${c.status !== '已作废' && got < c.amount ? `<button type="button" class="btn light" data-act="pay-contract" data-id="${esc(id)}">登记回款</button>` : ''}${canApproveC(c) ? `<button type="button" class="btn" data-act="approve-contract" data-id="${esc(id)}">审批</button>` : ''}<button type="button" class="btn light" data-act="edit" data-type="contracts" data-id="${esc(id)}">编辑</button>` : '',
  });
}
export async function approveModal(id) {
  const { item: c } = await API.get(`/contracts/${id}`);
  const levels = c.approvalLevels || [], lv = curLevel(c);
  openModal({
    title: `合同审批${lv ? ' · ' + lv.name : ''}`, submitText: '审批通过',
    body: `<p>合同：<b>${esc(`${c.number || ''} ${c.name}`)}</b>　金额：<b>${money(c.amount)}</b>　客户：<b>${esc(c.accountName)}</b></p>
      ${levels.length > 1 ? `<p class="muted small">共 ${levels.length} 级审批：${levels.map((l, i) => i === c.approvalStep ? `<b>${esc(l.name)}（当前）</b>` : esc(l.name)).join(' → ')}</p>` : ''}<label class="fld wide"><span>审批意见</span><textarea class="field" name="note" maxlength="500" placeholder="可选"></textarea></label>`,
    footer: '<button type="button" class="btn light danger" data-act="reject-contract">驳回</button>',
    onSubmit: async fd => { const r = await API.post(`/contracts/${id}/approve`, { approved: true, note: fd.get('note') }); toast(r.pending ? `已通过，流转至「${r.pending.name}」` : '审批通过，合同已签订'); rerender(); },
  }).dataset.contract = id;
}
