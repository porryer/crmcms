import { icon } from '../constants.js';
import { openModal } from '../forms.js';
import { rerender } from '../router.js';
import { $, me } from '../state.js';
import { API, toast } from '../util.js';

// ======================= 两步验证 =======================
export function mfaModal() {
  const enabled = me.mfaEnabled;
  const dlg = openModal({
    title: '两步验证（TOTP）', submitText: enabled ? '关闭两步验证' : '完成绑定',
    body: enabled
      ? `<p><span class="tag green">已启用</span> 登录时需输入身份验证器中的动态码。</p><p class="muted small">如需关闭，请输入登录密码和当前动态码。</p>
         <label class="fld wide"><span>登录密码</span><input class="field" type="password" name="password" required autocomplete="current-password"></label>
         <label class="fld wide"><span>动态码</span><input class="field" name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>`
      : `<p>启用后，登录除密码外还需输入手机身份验证器生成的 6 位动态码，可有效防止密码泄露导致的账号被盗。</p><button type="button" class="btn" data-act="mfa-start">${icon('shield')}开始设置</button>`,
    onSubmit: async fd => {
      if (enabled) { await API.post('/mfa/disable', { password: fd.get('password'), code: fd.get('code') }); me.mfaEnabled = false; toast('已关闭两步验证'); }
      else { await API.post('/mfa/enable', { code: fd.get('code') }); me.mfaEnabled = true; toast('两步验证已启用'); }
      $('#shell')?.remove(); rerender();
    },
  });
  if (!enabled) dlg.querySelector('[type=submit]').hidden = true;
}
