import { PROVIDER_ICON, icon } from './constants.js';
import { route } from './router.js';
import { $, setMe, setSettings, ui } from './state.js';
import { API, esc, request, toast } from './util.js';

// ======================= 登录 =======================
export function renderLogin() {
  let saved = '';
  try { saved = localStorage.getItem('novacrm.email') || ''; } catch { /* 隐私模式 */ }
  document.title = 'NovaCRM · 登录';
  $('#app').innerHTML = `
  <div class="login">
    <section class="login-hero">
      <div class="brand big"><span class="logo">N</span><span>NovaCRM</span></div>
      <h1>让客户管理更简单<br>更高效的销售管理平台</h1>
      <p>线索 → 客户 → 商机 → 合同 → 回款，全流程闭环管理</p>
      <div class="hero-art" aria-hidden="true">
        <div class="art-card a1"><b>客户总数</b><strong>1,286</strong></div>
        <div class="art-card a2"><b>本月回款</b><strong>¥286,500</strong></div>
        <div class="art-bars"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
    </section>
    <section class="login-panel">
      <form class="login-form" id="loginForm">
        <h2>欢迎登录</h2>
        <p class="muted">请使用管理员分配的企业账号登录</p>
        <label class="input-icon">${icon('user')}<input name="email" type="email" placeholder="请输入登录邮箱" value="${esc(saved)}" required autocomplete="username"></label>
        <label class="input-icon">${icon('key')}<input name="password" type="password" placeholder="请输入密码" required autocomplete="current-password"></label>
        <div class="login-row"><label class="check"><input type="checkbox" name="remember" ${saved ? 'checked' : ''}> 记住账号</label><span class="muted small" title="请联系系统管理员在“团队管理”中重置密码">忘记密码？</span></div>
        <button class="btn block" type="submit">登 录</button>
        <div id="ssoBox"></div>
        <p class="muted small center">首次安装的管理员密码显示在服务启动日志中</p>
      </form>
    </section>
  </div>`;
  // 单点登录按钮与回调错误提示
  const ssoErr = new URLSearchParams(location.hash.split('?')[1] || '').get('sso_error');
  if (ssoErr) { toast(ssoErr, true); history.replaceState(null, '', location.pathname); }
  fetch('/api/sso/config').then(r => r.json()).then(c => {
    if (!c.providers?.length || !$('#ssoBox')) return;
    const inDing = IN_DINGTALK && c.dingtalk;
    $('#ssoBox').innerHTML = `<div class="or"><span>或</span></div><div class="sso-btns">${inDing ? `<button type="button" class="btn block" data-act="dd-auto">${icon('bell')}钉钉免登</button>` : ''}${c.providers.filter(p => !(inDing && p.id === 'dingtalk')).map(p => `<a class="btn light block sso-${p.id}" href="${esc(p.url + nextParam())}">${icon(PROVIDER_ICON[p.id] || 'shield')}${esc(p.text)}</a>`).join('')}</div><p class="muted small center" id="ddStatus" hidden></p>${c.enforce ? '<p class="muted small center">本企业已启用单点登录，仅管理员可使用密码登录</p>' : ''}`;
    ui.ddCfg = c.dingtalk;
    // 钉钉客户端内自动免登（主动退出后不自动登录，可点按钮重试）
    let skip = false; try { skip = sessionStorage.getItem('novacrm.noAuto') === '1'; } catch { /* ignore */ }
    if (inDing && !skip) dingtalkAutoLogin().catch(() => {});
    // 企业微信客户端内：自动走网页授权静默登录
    if (IN_WXWORK && c.wecom && !skip) location.href = '/api/sso/wecom/start' + nextParam();
  }).catch(() => {});
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const btn = e.currentTarget.querySelector('button'); btn.disabled = true;
    try {
      const r = await API.post('/login', { email: f.email, password: f.password, ...(f.otp ? { otp: f.otp } : {}) });
      try { if (f.remember) localStorage.setItem('novacrm.email', f.email); else localStorage.removeItem('novacrm.email'); } catch { /* ignore */ }
      setMe(r.user); setSettings(r.settings);
      try { const m2 = await request('/me'); setMe(m2.user); ui.providers = m2.providers || []; } catch { /* ignore */ }
      if (!location.hash || location.hash === '#/') location.hash = '#/dashboard'; else route();
    } catch (err) {
      btn.disabled = false;
      if (err.data?.mfaRequired) {
        const form = $('#loginForm');
        if (!form.querySelector('[name=otp]')) {
          form.querySelector('.login-row').insertAdjacentHTML('beforebegin', `<label class="input-icon">${icon('shield')}<input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="身份验证器中的 6 位动态码" required></label>`);
          if (!f.otp) { toast('该账号已启用两步验证，请输入动态码'); form.querySelector('[name=otp]').focus(); return; }
        }
      }
      toast(err.message, true);
    }
  });
}

// ======================= 钉钉客户端内免登 =======================
const IN_DINGTALK = /DingTalk/i.test(navigator.userAgent);
const IN_WXWORK = /wxwork/i.test(navigator.userAgent);
/** 登录后回到当前页面（例如从消息通知链接进入） */
function nextParam() {
  const h = location.hash;
  return h && h.startsWith('#/') && !h.startsWith('#/login') && h.length <= 300 ? '?next=' + encodeURIComponent(h) : '';
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src; el.onload = () => resolve(); el.onerror = () => reject(new Error('加载钉钉组件失败'));
    document.head.appendChild(el);
  });
}
export async function dingtalkAutoLogin() {
  const cfg = ui.ddCfg, status = $('#ddStatus');
  if (!cfg) return;
  const say = (msg, err) => { if (status) { status.hidden = false; status.textContent = msg; status.classList.toggle('neg', !!err); } };
  say('正在通过钉钉免登…');
  try {
    await loadScript('/vendor/dingtalk-lite.js');
    const dd = window.ddLite;
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('钉钉免登超时，请确认在本企业钉钉中打开')), 10000);
      const fail = e => { clearTimeout(timer); reject(new Error(e?.errorMessage || e?.message || '获取免登授权码失败')); };
      if (typeof dd.error === 'function') dd.error(fail);
      dd.ready(() => dd.requestAuthCode({ corpId: cfg.corpId, clientId: cfg.clientId }).then(r => { clearTimeout(timer); resolve(r?.code || r?.authCode); }, fail));
    });
    if (!code) throw new Error('钉钉未返回免登授权码');
    await API.post('/sso/dingtalk/inapp', { code });
    const r = await request('/me'); setMe(r.user); setSettings(r.settings); ui.providers = r.providers || [];
    if (!location.hash || location.hash === '#/') location.hash = '#/dashboard'; else route();
  } catch (e) { say(e.message, true); toast(e.message, true); throw e; }
}
