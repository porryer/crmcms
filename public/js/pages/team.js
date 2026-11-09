import { PROVIDER_NAME, ROLE_LABEL, SCOPE_LABEL, icon } from '../constants.js';
import { openModal } from '../forms.js';
import { optionList, pageHead } from '../list.js';
import { rerender } from '../router.js';
import { $, R, me } from '../state.js';
import { API, avatar, canManage, esc, fmtDateTime, isAdmin, toast } from '../util.js';

// ======================= 团队 =======================
export async function pageTeam() {
  const items = R.users;
  $('#content').innerHTML = pageHead('团队管理', '成员、部门、角色与权限', isAdmin() ? `<button class="btn" data-act="user-create">${icon('plus')}新增成员</button>` : '') + `
    <section class="panel flush"><div class="tbl-wrap"><table><thead><tr><th>姓名</th>${canManage() ? '<th>账号</th>' : ''}<th>部门</th><th>角色</th>${canManage() ? '<th>数据范围</th><th>两步验证 / 登录绑定</th>' : ''}<th>状态</th>${canManage() ? '<th>最近登录</th>' : ''}${isAdmin() ? '<th class="ops">操作</th>' : ''}</tr></thead><tbody>
      ${items.map(u => `<tr><td><span class="who">${avatar(u.name, 'blue')}<b>${esc(u.name)}</b>${u.id === me.id ? '<span class="tag gray">我</span>' : ''}</span></td>${canManage() ? `<td>${esc(u.email)}</td>` : ''}<td>${esc(u.department || '—')}</td><td><span class="tag ${u.role === 'admin' ? 'red' : u.role === 'manager' ? 'orange' : u.role === 'sales' ? 'blue' : 'gray'}">${ROLE_LABEL[u.role]}</span></td>${canManage() ? `<td>${SCOPE_LABEL[u.dataScope] || '—'}</td><td>${u.mfaEnabled ? '<span class="tag green">已启用</span>' : '<span class="muted">未启用</span>'}${u.ssoBound ? ' <span class="tag blue" title="已绑定单点登录身份">SSO</span>' : ''}${(u.identities || []).map(p => ` <span class="tag blue">${PROVIDER_NAME[p]}</span>`).join('')}</td>` : ''}<td><span class="dot ${u.active ? 'on' : 'off'}"></span>${u.active ? '正常' : '停用'}</td>${canManage() ? `<td>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>` : ''}${isAdmin() ? `<td class="ops"><div class="row-actions"><button class="textbtn" data-act="user-edit" data-id="${esc(u.id)}">编辑</button>${u.mfaEnabled && u.id !== me.id ? `<button class="textbtn" data-act="user-mfa-reset" data-id="${esc(u.id)}">重置验证</button>` : ''}${u.ssoBound || u.identities?.length ? `<button class="textbtn" data-act="user-sso-unbind" data-id="${esc(u.id)}">解绑登录</button>` : ''}${u.id !== me.id ? `<button class="textbtn ${u.active ? 'danger' : ''}" data-act="user-toggle" data-id="${esc(u.id)}">${u.active ? '停用' : '启用'}</button>` : ''}</div></td>` : ''}</tr>`).join('')}
    </tbody></table></div></section>
    <section class="panel"><h3>角色权限说明</h3><div class="tbl-wrap plain"><table><thead><tr><th>角色</th><th>查看</th><th>新增/编辑</th><th>删除</th><th>合同审批</th><th>导出</th><th>审计日志</th><th>成员与系统设置</th></tr></thead><tbody>
      ${[['管理员', 1, 1, 1, 1, 1, 1, 1], ['销售经理', 1, 1, 1, 1, 1, 1, 0], ['销售', 1, 1, 0, 0, 1, 0, 0], ['只读', 1, 0, 0, 0, 0, 0, 0]].map(([n, ...f]) => `<tr><td><b>${n}</b></td>${f.map(v => `<td>${v ? '<span class="ok">✓</span>' : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="muted small">数据范围：<b>仅本人</b>＝自己负责的线索、客户及其下的商机/合同/回款/跟进；<b>本部门</b>＝同部门成员负责的数据；<b>全部数据</b>＝租户内全部。默认：销售为仅本人，其余角色为全部。</p></section>`;
}
export function userModal(u = null) {
  const deptOpts = optionList('dict:departments', u?.department || '', '请选择');
  openModal({
    title: u ? '编辑成员' : '新增成员', wide: true,
    body: `<div class="form-grid">
      <label class="fld"><span>姓名 <i class="req">*</i></span><input class="field" name="name" required maxlength="100" value="${esc(u?.name || '')}"></label>
      <label class="fld"><span>登录邮箱 <i class="req">*</i></span><input class="field" name="email" type="email" ${u ? 'disabled' : 'required'} value="${esc(u?.email || '')}"></label>
      <label class="fld"><span>部门</span><select class="field" name="department">${deptOpts}</select></label>
      <label class="fld"><span>手机号（用于钉钉/企业微信登录匹配）</span><input class="field" name="mobile" type="tel" maxlength="30" value="${esc(u?.mobile || '')}"></label>
      <label class="fld"><span>角色</span><select class="field" name="role" ${u?.id === me.id ? 'disabled' : ''}>${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${(u?.role || 'sales') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld"><span>数据范围</span><select class="field" name="dataScope"><option value="">按角色默认</option>${Object.entries(SCOPE_LABEL).map(([k, l]) => `<option value="${k}" ${u?.dataScopeSet === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld wide"><span>${u ? '重置密码（留空不修改，至少12位）' : '初始密码（至少12位）'} ${u ? '' : '<i class="req">*</i>'}</span><input class="field" name="password" type="password" minlength="12" autocomplete="new-password" ${u ? '' : 'required'}></label></div>`,
    onSubmit: async fd => {
      const body = Object.fromEntries(fd);
      if (u) { if (u.id === me.id) delete body.role; await API.patch(`/users/${u.id}`, body); } else await API.post('/users', body);
      toast('已保存'); rerender();
    },
  });
}
