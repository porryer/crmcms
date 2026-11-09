import { FORMS, tagClass } from './constants.js';
import { renderLogin } from './login.js';
import { $, R, me, setMe, settings } from './state.js';

// ======================= 工具 =======================
export const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = x => '¥' + Number(x || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const moneyShort = x => { x = Number(x || 0); return Math.abs(x) >= 1e8 ? +(x / 1e8).toFixed(2) + '亿' : Math.abs(x) >= 1e4 ? +(x / 1e4).toFixed(1) + '万' : String(+x.toFixed(2)); };
const pad = n => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowLocal = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toDate = v => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v));
export const fmtDate = v => { const d = toDate(v); return d && !isNaN(d) ? ymd(d) : '—'; };
export const fmtDateTime = v => { const d = toDate(v); return d && !isNaN(d) ? `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—'; };
export function relTime(v) {
  const d = toDate(v); if (!d || isNaN(d)) return '—';
  const today = ymd(), yest = ymd(new Date(Date.now() - 86400000)), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ymd(d) === today) return `今天 ${hm}`;
  if (ymd(d) === yest) return `昨天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
export const tag = v => (v ? `<span class="tag ${tagClass(v)}">${esc(v)}</span>` : '—');
export const canEdit = () => me && me.role !== 'viewer';
export const canManage = () => me && ['admin', 'manager'].includes(me.role);
export const isAdmin = () => me && me.role === 'admin';
export const dict = k => settings?.dicts?.[k] || [];
export const isOverdue = t => t.status !== '已完成' && t.dueDate && t.dueDate < ymd();
/** 内置字段 + 自定义字段 */
export function formFields(type) {
  const custom = (settings.customFields?.[type] || []).map(f => [f.key, f.label, f.type === 'select' ? f.options : f.type, f.required ? 1 : 0, f.type === 'textarea' ? 1 : 0]);
  return [...FORMS[type], ...custom];
}
export const customCols = type => (settings.customFields?.[type] || []).filter(f => f.inList).map(f => [f.key, f.label, f.type === 'date' ? 'date' : '']);
export const customKv = (type, x) => (settings.customFields?.[type] || []).map(f => `<div class="kv ${f.type === 'textarea' ? 'wide' : ''}"><span>${esc(f.label)}</span><b>${esc(x[f.key] ?? '') || '—'}</b></div>`).join('');
export const curLevel = c => (c.approvalLevels || [])[c.approvalStep || 0] || null;
export const canApproveC = c => !!me && c.status === '审批中' && (me.role === 'admin' || (curLevel(c) ? me.role === curLevel(c).role && c.submittedBy !== me.id : me.role === 'manager'));
export const fileSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export const avatar = (name, cls = '') => `<span class="avatar ${cls}">${esc(String(name || '?').slice(0, 1))}</span>`;
export const greeting = () => { const h = new Date().getHours(); return h < 6 ? '凌晨好' : h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };
export const weekday = () => '日一二三四五六'[new Date().getDay()];
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export async function request(url, opt = {}) {
  const r = await fetch('/api' + url, { credentials: 'same-origin', ...opt, headers: { ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...opt.headers } });
  if (r.status === 401 && me && url !== '/login') { setMe(null); toast('登录已过期，请重新登录', true); renderLogin(); throw new Error('登录已过期'); }
  if (!r.ok) { const data = await r.json().catch(() => ({ error: '网络错误' })); const err = new Error(data.error || r.statusText); err.data = data; err.status = r.status; throw err; }
  return r.json();
}
export const API = {
  get: u => request(u),
  post: (u, b) => request(u, { method: 'POST', body: JSON.stringify(b || {}) }),
  patch: (u, b) => request(u, { method: 'PATCH', body: JSON.stringify(b || {}) }),
  put: (u, b) => request(u, { method: 'PUT', body: JSON.stringify(b || {}) }),
  del: u => request(u, { method: 'DELETE' }),
};

export function toast(msg, error = false) {
  $('.toast')?.remove();
  const div = document.createElement('div');
  div.className = 'toast' + (error ? ' error' : '');
  div.setAttribute('role', 'status');
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3600);
}

export async function loadRefs() {
  // 仅加载成员列表；客户/合同/商机名称由服务端随列表返回，下拉框远程搜索，避免数据量大时全量加载
  R.users = (await API.get('/users')).items;
}
