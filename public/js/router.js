import { PAGE_TITLE, icon } from './constants.js';
import { pageList } from './list.js';
import { renderLogin } from './login.js';
import { pageAccount } from './pages/account.js';
import { pageDashboard } from './pages/dashboard.js';
import { pageFinance } from './pages/finance.js';
import { pageOpportunities, pageOpportunity } from './pages/opportunities.js';
import { pageReports } from './pages/reports.js';
import { pageSettings } from './pages/settings.js';
import { pageTasks } from './pages/tasks.js';
import { pageTeam } from './pages/team.js';
import { refreshBell, renderShell } from './shell.js';
import { $, me, setMe } from './state.js';
import { canManage, esc, loadRefs, request, toast } from './util.js';

// ======================= 路由 =======================
export function parseRoute() {
  const [pathPart, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page = 'dashboard', id = ''] = pathPart.split('/');
  return { page: PAGE_TITLE[page] ? page : 'dashboard', id: decodeURIComponent(id), params: new URLSearchParams(query) };
}
export const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
window.addEventListener('hashchange', () => route());

export async function route() {
  if (!me) return renderLogin();
  const r = parseRoute();
  if (r.params.get('sso_ok')) { toast(r.params.get('sso_ok')); history.replaceState(null, '', location.pathname + '#/' + r.page); setMe((await request('/me').catch(() => ({ user: me }))).user); $('#shell')?.remove(); }
  if (r.page === 'settings' && !canManage()) return go('#/dashboard');
  renderShell(r);
  const content = $('#content');
  content.innerHTML = '<div class="loading">加载中…</div>';
  document.body.classList.remove('nav-open');
  try {
    await loadRefs();
    if (r.page === 'dashboard') await pageDashboard();
    else if (r.page === 'accounts' && r.id) await pageAccount(r.id);
    else if (r.page === 'opportunities' && r.id) await pageOpportunity(r.id);
    else if (r.page === 'opportunities') await pageOpportunities(r);
    else if (r.page === 'finance') await pageFinance();
    else if (r.page === 'tasks') await pageTasks(r);
    else if (r.page === 'reports') await pageReports();
    else if (r.page === 'team') await pageTeam();
    else if (r.page === 'settings') await pageSettings();
    else await pageList(r.page, r);
  } catch (e) {
    if (me) content.innerHTML = `<div class="empty">${icon('alert')}<p>${esc(e.message)}</p></div>`;
  }
  refreshBell();
}
export const rerender = () => route();
