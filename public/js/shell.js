import { MENU, PAGE_TITLE, PROVIDER_ICON, PROVIDER_NAME, ROLE_LABEL, icon } from './constants.js';
import { $, me, settings, ui } from './state.js';
import { API, avatar, debounce, esc, relTime, toast } from './util.js';

// ======================= 布局 =======================
export function renderShell(r) {
  const active = r.page;
  document.title = `${PAGE_TITLE[active]} · ${settings.systemName}`;
  const items = MENU.filter(m => !m.roles || m.roles.includes(me.role)).map(m => {
    if (!m.children) return `<a class="nav ${active === m.key ? 'active' : ''}" href="#/${m.key}" title="${m.label}">${icon(m.icon)}<span class="navtext">${m.label}</span></a>`;
    const childActive = m.children.some(([k]) => k === active);
    const open = childActive || ui.openGroups.has(m.label);
    return `<div class="nav-group ${open ? 'open' : ''}"><button class="nav ${childActive ? 'parent-active' : ''}" data-act="toggle-group" data-group="${m.label}" title="${m.label}">${icon(m.icon)}<span class="navtext">${m.label}</span>${icon('down', 'chev')}</button>
      <div class="sub">${m.children.map(([k, l]) => `<a class="subnav ${active === k ? 'active' : ''}" href="#/${k}">${l}</a>`).join('')}</div></div>`;
  }).join('');
  const shell = $('#shell');
  const html = `
    <aside class="aside" id="aside">
      <a class="brand" href="#/dashboard">${settings.logo ? `<img class="logo img" src="/api/settings/logo?v=${encodeURIComponent(settings.logoV || '')}" alt="">` : '<span class="logo">N</span>'}<span class="navtext">${esc(settings.systemName)}</span><small class="navtext">V1.6</small></a>
      <nav>${items}</nav>
      <div class="side-bottom navtext">${esc(settings.companyName)}<br><span>企业版 · 数据本地存储</span></div>
    </aside>
    <div class="scrim" data-act="close-nav"></div>
    <section class="workspace">
      <header class="topbar">
        <button class="iconbtn" data-act="toggle-nav" aria-label="切换菜单">${icon('menu')}</button>
        <h1 class="page-title">${PAGE_TITLE[active]}</h1>
        <div class="gsearch">${icon('search')}<input id="gsearch" placeholder="搜索客户、线索、商机、合同…" autocomplete="off"><div class="gresults" id="gresults" hidden></div></div>
        <div class="notif"><button class="iconbtn bell" data-act="notif" title="消息通知" aria-label="消息通知">${icon('bell')}<span class="badge" id="bellBadge" hidden></span></button><div class="dropdown notif-panel" id="notifPanel" hidden></div></div>
        <div class="usermenu">
          <button class="userbtn" data-act="user-menu">${avatar(me.name, 'blue')}<span class="uname">${esc(me.name)}</span>${icon('down', 'chev')}</button>
          <div class="dropdown" id="userDropdown" hidden>
            <div class="dd-head"><b>${esc(me.name)}</b><small>${esc(me.email)} · ${ROLE_LABEL[me.role]}</small></div>
            <button data-act="password">${icon('key')}修改密码</button>
            <button data-act="mfa">${icon('shield')}两步验证${me.mfaEnabled ? '（已启用）' : ''}</button>
            ${(ui.providers || []).filter(p => p.id !== 'oidc').map(p => { const b = (me.identities || []).find(x => x.provider === p.id); return b ? `<button data-act="im-unbind" data-provider="${p.id}">${icon(PROVIDER_ICON[p.id])}已绑定${PROVIDER_NAME[p.id]}${b.name ? '（' + esc(b.name) + '）' : ''}·解绑</button>` : `<a class="dd-link" href="/api/sso/${p.id}/start?bind=1">${icon(PROVIDER_ICON[p.id])}绑定${PROVIDER_NAME[p.id]}</a>`; }).join('')}
            ${(me.identities || []).length && (settings.wecom?.enabled || settings.dingtalk?.enabled) ? `<button data-act="im-toggle">${icon('message')}工作通知：${me.imNotify ? '已开启' : '已关闭'}</button>` : ''}
            ${settings.smtp?.enabled ? `<button data-act="email-toggle">${icon('mail')}邮件通知：${me.emailNotify ? '已开启' : '已关闭'}</button>` : ''}
            <button data-act="logout">${icon('logout')}退出登录</button>
          </div>
        </div>
      </header>
      <main class="content" id="content"></main>
    </section>
    <nav class="tabbar">
      ${[['dashboard', 'home', '首页'], ['accounts', 'users', '客户'], ['opportunities', 'briefcase', '商机'], ['tasks', 'calcheck', '任务']].map(([k, ic, l]) => `<a href="#/${k}" class="${active === k ? 'active' : ''}">${icon(ic)}<span>${l}</span></a>`).join('')}
      <button data-act="toggle-nav">${icon('more')}<span>更多</span></button>
    </nav>`;
  if (!shell) {
    $('#app').innerHTML = `<div class="app ${ui.collapsed ? 'collapsed' : ''}" id="shell">${html}</div>`;
    bindGlobalSearch();
  } else {
    // 保留顶部搜索框状态，仅刷新侧栏/标题/底部导航
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    shell.querySelector('#aside').replaceWith(tmp.querySelector('#aside'));
    shell.querySelector('.page-title').textContent = PAGE_TITLE[active];
    shell.querySelector('.tabbar').replaceWith(tmp.querySelector('.tabbar'));
  }
}

export async function refreshBell() {
  if (!me) return null;
  try {
    const r = await API.get('/notifications');
    const b = $('#bellBadge'); if (!b) return r;
    b.hidden = !r.unread; b.textContent = r.unread > 99 ? '99+' : r.unread;
    return r;
  } catch { return null; }
}
const NOTIF_ICON = { task: 'calcheck', approval: 'file', plan: 'coins', assign: 'user', approve: 'check', reject: 'x' };
export async function openNotifications() {
  const panel = $('#notifPanel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const r = await refreshBell();
  if (!r) return;
  panel.innerHTML = `<div class="dd-head row"><b>消息通知</b><small>${r.actionable} 项待处理</small></div>
    ${r.items.length ? `<div class="notif-list">${r.items.map(n => `<a href="${esc(n.link)}" class="notif-item ${n.unread ? 'unread' : ''}"><span class="n-ic ${n.type}">${icon(NOTIF_ICON[n.type] || 'bell')}</span><span><b>${esc(n.title)}</b><small>${esc(n.text)}</small><em>${relTime(n.at)}</em></span></a>`).join('')}</div>` : '<div class="empty small">暂无消息</div>'}`;
  panel.hidden = false;
  if (r.unread) { await API.post('/notifications').catch(() => {}); $('#bellBadge').hidden = true; }
}

function bindGlobalSearch() {
  const input = $('#gsearch'), box = $('#gresults');
  const TYPE = { accounts: '客户', leads: '线索', opportunities: '商机', contracts: '合同', contacts: '联系人' };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { box.hidden = true; return; }
    try {
      const { results } = await API.get('/search?q=' + encodeURIComponent(q));
      box.innerHTML = results.length ? results.map(x => {
        const href = x.type === 'accounts' ? `#/accounts/${x.id}` : x.type === 'opportunities' ? `#/opportunities/${x.id}` : x.type === 'contacts' ? `#/accounts/${x.accountId}` : `#/${x.type}?q=${encodeURIComponent(x.title.split(' ').pop())}`;
        return `<a href="${esc(href)}"><span class="tag gray">${TYPE[x.type]}</span><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></a>`;
      }).join('') : '<div class="muted pad">没有匹配结果</div>';
      box.hidden = false;
    } catch (e) { toast(e.message, true); }
  });
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim()) box.hidden = false; });
  document.addEventListener('click', e => {
    if (!e.target.closest('.gsearch')) box.hidden = true;
    if (!e.target.closest('.usermenu')) { const d = $('#userDropdown'); if (d) d.hidden = true; }
    if (!e.target.closest('.notif') || e.target.closest('.notif-item')) { const d = $('#notifPanel'); if (d) d.hidden = true; }
  });
  box.addEventListener('click', e => { if (e.target.closest('a')) { box.hidden = true; input.value = ''; } });
}
