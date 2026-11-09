import { ENTITY_LABEL, LISTS, icon } from '../constants.js';
import { filesPane } from '../files.js';
import { table } from '../list.js';
import { $, ui } from '../state.js';
import { API, canEdit, canManage, customKv, esc, fmtDateTime, money, relTime, tag } from '../util.js';

// ======================= 客户详情 =======================
export async function pageAccount(id) {
  const o = await API.get(`/accounts/${id}/overview`);
  const a = o.account, primary = o.contacts.find(c => c.isPrimary) || o.contacts[0];
  const tabs = [['info', '基本信息'], ['contacts', `联系人 ${o.contacts.length}`], ['activities', `跟进记录 ${o.activities.length}`], ['opportunities', `商机 ${o.opportunities.length}`], ['contracts', `合同 ${o.contracts.length}`], ['payments', `回款 ${o.payments.length}`], ['tasks', `任务 ${o.tasks.length}`], ['files', '相关文件']];
  const tab = ui.tabs.account?.id === id ? ui.tabs.account.tab : 'info';
  ui.tabs.account = { id, tab };
  const sub = (type, items, cols) => `<div class="sub-head">${canEdit() ? `<button class="btn light small" data-act="create" data-type="${type}" data-account="${esc(id)}">${icon('plus')}新增${ENTITY_LABEL[type]}</button>` : ''}</div>${table(type, cols, items)}`;
  const panes = {
    info: `<div class="detail-grid"><div class="kv-grid">
        ${[['客户名称', a.name], ['客户类型', a.type], ['所属行业', a.industry], ['客户级别', a.level], ['客户来源', a.source], ['成立时间', a.foundedAt], ['主联系人', primary ? `${primary.name}${primary.phone ? '　' + primary.phone : ''}` : ''], ['联系电话', a.phone], ['邮箱', a.email], ['负责人', a.owner], ['地址', a.address], ['创建时间', fmtDateTime(a.createdAt)]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}
        ${customKv('accounts', a)}<div class="kv wide"><span>备注</span><b>${esc(a.notes || '—')}</b></div></div>
      <div class="portrait"><h4>客户画像</h4><div class="pgrid">
        <div><span>跟进次数</span><b>${o.stats.activities}</b></div><div><span>进行中商机</span><b>${o.stats.opportunities}</b></div>
        <div><span>合同金额</span><b>${money(o.stats.contractAmount)}</b></div><div><span>回款金额</span><b>${money(o.stats.received)}</b></div></div>
        <p class="muted small">最近跟进：${o.stats.lastActivityAt ? relTime(o.stats.lastActivityAt) : '暂无'}</p></div></div>`,
    contacts: sub('contacts', o.contacts, LISTS.contacts.cols.filter(c => c[0] !== 'accountId')),
    activities: sub('activities', o.activities, LISTS.activities.cols.filter(c => c[0] !== 'accountId')),
    opportunities: sub('opportunities', o.opportunities, LISTS.opportunities.cols.filter(c => c[0] !== 'accountId')),
    contracts: sub('contracts', o.contracts, LISTS.contracts.cols.filter(c => c[0] !== 'accountId')),
    payments: table('payments', LISTS.payments.cols.filter(c => c[0] !== 'customer'), o.payments),
    tasks: sub('tasks', o.tasks, LISTS.tasks.cols.filter(c => c[0] !== 'accountId')),
    files: tab === 'files' ? await filesPane('accounts', id) : '',
  };
  $('#content').innerHTML = `
    <a class="back" href="#/accounts">${icon('left')}返回客户列表</a>
    <section class="panel detail-hero">
      <span class="hero-ic">${icon('building')}</span>
      <div class="hero-main"><h2>${esc(a.name)} ${tag(a.level)} ${tag(a.status)}</h2><p class="muted">${esc([a.type, a.industry, a.owner && '负责人：' + a.owner].filter(Boolean).join(' · '))}</p></div>
      <div class="tools">${canEdit() ? `<button class="btn light" data-act="edit" data-type="accounts" data-id="${esc(id)}">${icon('edit')}编辑</button><button class="btn light" data-act="create" data-type="activities" data-account="${esc(id)}">写跟进</button><button class="btn" data-act="create" data-type="opportunities" data-account="${esc(id)}">${icon('plus')}新建商机</button>` : ''}${canManage() ? `<button class="btn light danger" data-act="delete" data-type="accounts" data-id="${esc(id)}">删除</button>` : ''}</div>
    </section>
    <section class="panel">
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="account-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="tab-pane">${panes[tab]}</div>
    </section>`;
}
