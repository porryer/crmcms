/* NovaCRM 前端入口：原生 JS 单页应用（hash 路由，ES 模块，无构建），兼容严格 CSP（无内联脚本/样式）。 */
import { route } from './router.js';
import { me, setMe, setSettings, ui } from './state.js';
import { request } from './util.js';
import './actions.js'; // 事件委托（click / change / input / submit 等全局监听）

// ======================= 启动 =======================
(async () => {
  try { const r = await request('/me'); setMe(r.user); setSettings(r.settings); ui.providers = r.providers || []; } catch { /* 未登录 */ }
  if (me && (!location.hash || location.hash === '#/')) location.hash = '#/dashboard'; else route();
})();
