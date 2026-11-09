import { ACTION_LABEL, ENTITY_LABEL, FORMS, PROVIDER_NAME, icon } from '../constants.js';
import { optionList, pageHead } from '../list.js';
import { rerender } from '../router.js';
import { $, setSettings, settings, ui } from '../state.js';
import { API, dict, esc, fmtDateTime, isAdmin, tag, toast } from '../util.js';

// ======================= 系统设置 =======================
const DICT_LABEL = { leadSources: '线索/客户来源', accountTypes: '客户类型', accountLevels: '客户级别', accountStatus: '客户状态', industries: '行业', activityTypes: '跟进方式', activityResults: '跟进结果', paymentMethods: '付款方式', departments: '部门' };
export async function pageSettings() {
  const tabs = isAdmin() ? [['basic', '基础设置'], ['dicts', '数据字典'], ['fields', '字段管理'], ['approval', '审批与通知'], ['sso', '单点登录'], ['audits', '审计日志'], ['about', '安全与运维']] : [['audits', '审计日志'], ['fields', '字段管理'], ['about', '安全与运维']];
  let tab = ui.tabs.settings; if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  ui.tabs.settings = tab;
  let pane = '';
  if (tab === 'basic') {
    pane = `<form id="basicForm" class="settings-form"><label class="fld"><span>系统名称</span><input class="field" name="systemName" maxlength="60" value="${esc(settings.systemName)}"></label>
      <label class="fld"><span>公司名称</span><input class="field" name="companyName" maxlength="60" value="${esc(settings.companyName)}"></label>
      <div class="fld"><span>系统 Logo</span><div class="logo-preview">${settings.logo ? `<img class="logo img" src="/api/settings/logo?v=${Date.now()}" alt="">` : '<span class="logo">N</span>'}
        <label class="btn light small">${icon('upload')}上传<input type="file" hidden accept="image/png,image/jpeg,image/webp" data-act-change="logo"></label>${settings.logo ? '<button type="button" class="btn light small danger" data-act="logo-del">移除</button>' : ''}<small class="muted">PNG/JPG/WebP，≤512KB，建议正方形</small></div></div>
      <div><button class="btn" type="submit">保存</button></div></form>`;
  } else if (tab === 'dicts') {
    pane = `<form id="dictForm"><p class="muted">每行一个选项；修改后新建/编辑表单立即生效，历史数据保留原值。</p><div class="dict-grid">${Object.entries(DICT_LABEL).map(([k, l]) => `<label class="fld"><span>${l}</span><textarea class="field" name="${k}" rows="6">${esc(dict(k).join('\n'))}</textarea></label>`).join('')}</div><div><button class="btn" type="submit">保存字典</button></div></form>`;
  } else if (tab === 'sso') {
    const c = settings.sso || {};
    pane = `<form id="ssoForm" class="settings-form wide-form"><h4>单点登录（OpenID Connect）</h4>
      <p class="muted small">支持任何标准 OIDC 身份提供方：Microsoft Entra ID（Azure AD）、Okta、Keycloak、Authing、阿里云 IDaaS、Google Workspace 等。在 IdP 中创建“Web 应用”，回调地址填写下方地址，授权范围包含 openid、email、profile。</p>
      <div class="fld"><span>回调地址（Redirect URI）</span><code class="wrap">${esc(c.redirectUri || '')}</code></div>
      <label class="check"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''}> 启用单点登录</label>
      <div class="form-grid">
        <label class="fld wide"><span>Issuer（签发方地址）</span><input class="field" name="issuer" value="${esc(c.issuer || '')}" placeholder="https://login.microsoftonline.com/&lt;租户ID&gt;/v2.0"></label>
        <label class="fld"><span>Client ID</span><input class="field" name="clientId" value="${esc(c.clientId || '')}" autocomplete="off"></label>
        <label class="fld"><span>Client Secret</span><input class="field" name="clientSecret" type="password" autocomplete="new-password" placeholder="${c.secretSet ? '已保存，留空则不修改' : ''}"></label>
        <label class="fld"><span>登录按钮文字</span><input class="field" name="buttonText" maxlength="30" value="${esc(c.buttonText || '企业账号登录')}"></label>
        <label class="fld"><span>自动开通账号的默认角色</span><select class="field" name="defaultRole">${[['sales', '销售'], ['viewer', '只读'], ['manager', '销售经理']].map(([k, l]) => `<option value="${k}" ${c.defaultRole === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fld"><span>自动开通账号的默认部门</span><select class="field" name="defaultDept">${optionList('dict:departments', c.defaultDept || '', '不指定')}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="autoCreate" ${c.autoCreate ? 'checked' : ''}> 首次登录自动开通账号（否则需管理员先在“团队管理”中添加相同邮箱的成员）</label>
      <div class="tools"><button class="btn" type="submit">保存</button>${c.enabled ? '<a class="btn light" href="/api/sso/start" target="_blank" rel="noopener">在新窗口测试登录</a>' : ''}</div>
      <p class="muted small">按邮箱匹配成员，首次登录后与 IdP 的用户标识（sub）绑定；单点登录用户的多因素认证由 IdP 负责。</p></form>`;
    const roleSel = v => [['sales', '销售'], ['viewer', '只读'], ['manager', '销售经理']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
    const w = settings.wecom || {}, d = settings.dingtalk || {};
    const imNotifyFields = x => `<div class="fld"><label class="check"><input type="checkbox" name="notify" ${x.notify ? 'checked' : ''}> 推送个人工作通知（发给已绑定该账号的成员）</label>
        <div class="checks">${[['approval', '合同审批'], ['assign', '分配负责人'], ['digest', '每日待办摘要']].map(([k, l]) => `<label class="check"><input type="checkbox" name="notifyEvents" value="${k}" ${(x.notifyEvents || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>`;
    const imCommon = x => `<label class="fld"><span>登录按钮文字</span><input class="field" name="buttonText" maxlength="30" value="${esc(x.buttonText || '')}"></label>
        <label class="fld"><span>自动开通账号的默认角色</span><select class="field" name="defaultRole">${roleSel(x.defaultRole)}</select></label>
        <label class="fld"><span>自动开通账号的默认部门</span><select class="field" name="defaultDept">${optionList('dict:departments', x.defaultDept || '', '不指定')}</select></label>`;
    pane = `<form id="enforceForm" class="settings-form wide-form"><h4>登录策略</h4>
        <label class="check"><input type="checkbox" name="enforce" ${c.enforce ? 'checked' : ''}> 强制使用第三方登录（启用任一方式后，非管理员不能使用密码登录；管理员保留密码登录用于应急）</label>
        <div><button class="btn small" type="submit">保存登录策略</button></div></form>
      <form id="wecomForm" class="settings-form wide-form"><h4 class="sec">企业微信扫码登录</h4>
        <ol class="howto small"><li>企业微信管理后台 →“应用管理”→ 创建自建应用，记录 AgentId 与 Secret；“我的企业”中查看企业 ID（CorpID）。</li>
          <li>在应用的“企业微信授权登录”中设置授权回调域，在“网页授权及 JS-SDK”中设置可信域名，均填写本系统域名；并将应用可见范围设为需要登录的成员。</li>
          <li>回调地址：<code>${esc(w.redirectUri || '')}</code>。在企业微信客户端内打开本系统时将自动静默登录。</li></ol>
        <label class="check"><input type="checkbox" name="enabled" ${w.enabled ? 'checked' : ''}> 启用企业微信登录</label>
        <div class="form-grid">
          <label class="fld"><span>企业 ID（CorpID）</span><input class="field" name="corpId" value="${esc(w.corpId || '')}" placeholder="ww开头"></label>
          <label class="fld"><span>应用 AgentId</span><input class="field" name="agentId" value="${esc(w.agentId || '')}" inputmode="numeric"></label>
          <label class="fld wide"><span>应用 Secret</span><input class="field" name="secret" type="password" autocomplete="new-password" placeholder="${w.secretSet ? '已保存，留空则不修改' : ''}"></label>
          ${imCommon(w)}
        </div>
        <label class="check"><input type="checkbox" name="autoCreate" ${w.autoCreate ? 'checked' : ''}> 首次登录自动开通账号（需企业微信返回邮箱；2022 年后新建的应用通常拿不到邮箱/手机号，建议成员自行在个人菜单中绑定）</label>
        ${imNotifyFields(w)}
        <div class="tools"><button class="btn" type="submit">保存企业微信设置</button>${w.enabled ? '<a class="btn light" href="/api/sso/wecom/start" target="_blank" rel="noopener">测试扫码登录</a>' : ''}${w.notify ? '<button type="button" class="btn light" data-act="im-test" data-provider="wecom">给我发测试消息</button>' : ''}</div></form>
      <form id="dingtalkForm" class="settings-form wide-form"><h4 class="sec">钉钉扫码登录</h4>
        <ol class="howto small"><li>钉钉开放平台 → 应用开发 → 企业内部应用 → 创建应用，在“凭证与基础信息”获取 Client ID（AppKey）与 Client Secret（AppSecret），在开发者后台首页获取企业 CorpId。</li>
          <li>“安全设置”→ 重定向 URL 填写：<code>${esc(d.redirectUri || '')}</code>；“权限管理”中开通“个人手机号信息”“通讯录个人信息读权限”（用于按手机号/邮箱匹配成员）。</li>
          <li>客户端内免登：在应用“网页应用”中把<b>应用首页地址</b>和<b>PC 端首页地址</b>填写为本系统地址并发布到工作台；成员在钉钉工作台打开即自动登录，无需扫码。</li>
          <li>只允许本企业（CorpId 一致）的钉钉账号登录。</li></ol>
        <label class="check"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}> 启用钉钉登录</label>
        <div class="form-grid">
          <label class="fld"><span>Client ID（AppKey）</span><input class="field" name="clientId" value="${esc(d.clientId || '')}"></label>
          <label class="fld"><span>企业 CorpId</span><input class="field" name="corpId" value="${esc(d.corpId || '')}" placeholder="ding开头"></label>
          <label class="fld wide"><span>Client Secret（AppSecret）</span><input class="field" name="clientSecret" type="password" autocomplete="new-password" placeholder="${d.secretSet ? '已保存，留空则不修改' : ''}"></label>
          ${imCommon(d)}
        </div>
        <label class="check"><input type="checkbox" name="autoCreate" ${d.autoCreate ? 'checked' : ''}> 首次登录自动开通账号（需钉钉返回邮箱）</label>
        <label class="fld"><span>应用 AgentId（推送工作通知需要）</span><input class="field" name="agentId" value="${esc(d.agentId || '')}" inputmode="numeric"></label>
        ${imNotifyFields(d)}
        <div class="tools"><button class="btn" type="submit">保存钉钉设置</button>${d.enabled ? '<a class="btn light" href="/api/sso/dingtalk/start" target="_blank" rel="noopener">测试扫码登录</a>' : ''}${d.notify ? '<button type="button" class="btn light" data-act="im-test" data-provider="dingtalk">给我发测试消息</button>' : ''}</div></form>
      <p class="muted small">成员匹配顺序：已绑定 → 邮箱 → 手机号（在团队管理中填写）→ 自动开通。匹配不到时，成员可先用账号密码登录，在右上角个人菜单中“绑定企业微信 / 钉钉”。</p>
      <div class="sec"></div>${pane}`;
  } else if (tab === 'approval') {
    const ap = ui.apDraft ||= structuredClone(settings.approval.levels);
    const w = settings.webhook || {};
    pane = `<form id="approvalForm"><h4>合同审批级别</h4><p class="muted small">合同金额 ≥ 阈值的级别都需要依次审批；管理员可审批任意级别，提交人不能审批自己的合同。</p>
      <div class="tbl-wrap plain"><table class="mini edit"><thead><tr><th>顺序</th><th>级别名称</th><th>审批角色</th><th>金额阈值（元，≥）</th><th></th></tr></thead><tbody>
      ${ap.map((l, i) => `<tr><td>${i + 1}</td><td><input class="field slim" data-ap="${i}" data-prop="name" value="${esc(l.name)}" maxlength="30"></td><td><select class="field slim" data-ap="${i}" data-prop="role"><option value="manager" ${l.role === 'manager' ? 'selected' : ''}>销售经理</option><option value="admin" ${l.role === 'admin' ? 'selected' : ''}>管理员</option></select></td><td><input class="field slim" type="number" min="0" step="0.01" data-ap="${i}" data-prop="minAmount" value="${l.minAmount}"></td><td>${ap.length > 1 ? `<button type="button" class="textbtn danger" data-act="ap-del" data-i="${i}">删除</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="tools">${ap.length < 5 ? '<button type="button" class="btn light small" data-act="ap-add">新增级别</button>' : ''}<button class="btn" type="submit">保存审批设置</button></div></form>
      <form id="webhookForm" class="settings-form"><h4 class="sec">群机器人通知</h4>
        <label class="fld"><span>类型</span><select class="field" name="kind">${[['wecom', '企业微信群机器人'], ['dingtalk', '钉钉群机器人'], ['generic', '通用 JSON']].map(([k, l]) => `<option value="${k}" ${w.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fld"><span>Webhook 地址（https）</span><input class="field" name="url" value="${esc(w.url || '')}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"></label>
        <div class="fld"><span>推送事件</span><div class="checks">${[['approval', '合同审批（待审批/结果）'], ['assign', '分配负责人']].map(([k, l]) => `<label class="check"><input type="checkbox" name="events" value="${k}" ${(w.events || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div class="tools"><button class="btn" type="submit">保存通知设置</button>${w.url ? '<button type="button" class="btn light" data-act="webhook-test">发送测试消息</button>' : ''}</div>
        <p class="muted small">钉钉机器人如开启“加签”，请改用“自定义关键词”安全设置（关键词可填系统名称）。站内通知无需配置，顶部铃铛即可查看。</p></form>
      <form id="smtpForm" class="settings-form"><h4 class="sec">邮件通知（SMTP）</h4>
        <label class="check"><input type="checkbox" name="enabled" ${settings.smtp?.enabled ? 'checked' : ''}> 启用邮件通知</label>
        <div class="form-grid">
          <label class="fld"><span>SMTP 服务器</span><input class="field" name="host" value="${esc(settings.smtp?.host || '')}" placeholder="smtp.exmail.qq.com"></label>
          <label class="fld"><span>端口</span><input class="field" name="port" type="number" min="1" max="65535" value="${esc(settings.smtp?.port || 465)}"></label>
          <label class="fld"><span>加密方式</span><select class="field" name="secure">${[['ssl', 'SSL/TLS（465）'], ['starttls', 'STARTTLS（587）'], ['none', '不加密（仅限内网中继）']].map(([k, l]) => `<option value="${k}" ${settings.smtp?.secure === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fld"><span>发件人</span><input class="field" name="from" value="${esc(settings.smtp?.from || '')}" placeholder="NovaCRM 通知 &lt;crm@example.com&gt;"></label>
          <label class="fld"><span>用户名</span><input class="field" name="user" value="${esc(settings.smtp?.user || '')}" autocomplete="off"></label>
          <label class="fld"><span>密码 / 授权码</span><input class="field" name="pass" type="password" autocomplete="new-password" placeholder="${settings.smtp?.passSet ? '已保存，留空则不修改' : ''}"></label>
        </div>
        <div class="fld"><span>发送事件</span><div class="checks">${[['approval', '合同审批（待审批/结果）'], ['assign', '分配负责人'], ['digest', '每日待办摘要（默认 08:30）']].map(([k, l]) => `<label class="check"><input type="checkbox" name="events" value="${k}" ${(settings.smtp?.events || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
        <div class="tools"><button class="btn" type="submit">保存邮件设置</button>${settings.smtp?.host ? '<button type="button" class="btn light" data-act="smtp-test">发送测试邮件给我</button><button type="button" class="btn light" data-act="digest-now">立即发送今日摘要</button>' : ''}</div>
        <p class="muted small">企业邮箱请使用“客户端授权码”。邮件中的链接使用环境变量 PUBLIC_ORIGIN 作为站点地址。成员可在右上角个人菜单中关闭邮件通知。</p></form>`;
  } else if (tab === 'fields') {
    const CF_ENT = ['leads', 'accounts', 'contacts', 'opportunities', 'contracts'];
    const cf = ui.cfDraft ||= structuredClone(settings.customFields || {});
    const typeOpts = v => [['text', '单行文本'], ['textarea', '多行文本'], ['number', '数字'], ['date', '日期'], ['select', '下拉选项']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
    pane = (isAdmin() ? `<form id="cfForm"><h4>自定义字段</h4><p class="muted small">新增字段会出现在新建/编辑表单、详情、CSV 导出与导入模板中；勾选“列表显示”后在列表中显示。删除字段不会删除历史数据。</p>
      ${CF_ENT.map(ent => `<div class="cf-block"><div class="panel-head"><b>${ENTITY_LABEL[ent]}</b><button type="button" class="btn light small" data-act="cf-add" data-ent="${ent}">${icon('plus')}新增字段</button></div>
        ${(cf[ent] || []).length ? `<div class="tbl-wrap plain"><table class="mini edit"><thead><tr><th>字段名称</th><th>类型</th><th>下拉选项（逗号分隔）</th><th>必填</th><th>列表显示</th><th></th></tr></thead><tbody>${cf[ent].map((f, i) => `<tr>
          <td><input class="field slim" data-cf="${ent}" data-i="${i}" data-prop="label" value="${esc(f.label)}" maxlength="30" placeholder="如：统一社会信用代码"></td>
          <td><select class="field slim" data-cf="${ent}" data-i="${i}" data-prop="type">${typeOpts(f.type)}</select></td>
          <td><input class="field slim" data-cf="${ent}" data-i="${i}" data-prop="options" value="${esc((f.options || []).join(','))}" ${f.type === 'select' ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-cf="${ent}" data-i="${i}" data-prop="required" ${f.required ? 'checked' : ''}></td>
          <td><input type="checkbox" data-cf="${ent}" data-i="${i}" data-prop="inList" ${f.inList ? 'checked' : ''}></td>
          <td><button type="button" class="textbtn danger" data-act="cf-del" data-ent="${ent}" data-i="${i}">删除</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">暂无自定义字段</p>'}</div>`).join('')}
      <div class="tools"><button class="btn" type="submit">保存字段配置</button><button type="button" class="btn light" data-act="cf-reset">放弃修改</button></div></form><h4 class="sec">内置字段</h4>` : '') + `<p class="muted">系统内置字段如下。</p>${Object.entries(FORMS).map(([type, fields]) => `<h4 class="sec">${ENTITY_LABEL[type]}</h4><div class="tbl-wrap plain"><table class="mini"><thead><tr><th>字段名</th><th>字段键</th><th>类型</th><th>必填</th><th>状态</th></tr></thead><tbody>${fields.map(([k, l, kind = 'text', req]) => `<tr><td>${esc(l.replace(/（.*?）/, ''))}</td><td><code>${k}</code></td><td>${Array.isArray(kind) ? '下拉' : String(kind).startsWith('dict:') ? '下拉（字典）' : { text: '文本', textarea: '多行文本', money: '金额', percent: '百分比', date: '日期', datetime: '日期时间', account: '关联客户', contract: '关联合同', opportunity: '关联商机', user: '成员', checkbox: '开关', tel: '电话', email: '邮箱', contractStatus: '下拉' }[kind] || kind}</td><td>${req ? '是' : '否'}</td><td><span class="dot on"></span>启用</td></tr>`).join('')}</tbody></table></div>`).join('')}`;
  } else if (tab === 'audits') {
    const { items } = await API.get('/audits');
    pane = items.length ? `<div class="tbl-wrap plain"><table><thead><tr><th>时间</th><th>操作人</th><th>行为</th><th>对象</th><th>记录编号</th></tr></thead><tbody>${items.map(x => `<tr><td>${fmtDateTime(x.at)}</td><td>${esc(x.user_name || '—')}</td><td>${tag(ACTION_LABEL[x.action] || x.action)}</td><td>${esc(ENTITY_LABEL[x.entity] || x.entity)}</td><td><code>${esc(x.entity_id.slice(0, 8))}</code></td></tr>`).join('')}</tbody></table></div><p class="muted small">显示最近 300 条。</p>` : '<div class="empty">暂无审计日志</div>';
  } else {
    const h = await API.get('/health');
    const bk = isAdmin() ? await API.get('/backups') : null;
    pane = (bk ? `<div class="panel-head"><h4>数据备份</h4><button class="btn small" data-act="backup-now">${icon('download')}立即备份</button></div>
      <p class="muted small">自动备份：${bk.schedule.intervalHours > 0 ? `每 ${bk.schedule.intervalHours} 小时一次` : '已关闭'}，保留最近 ${bk.schedule.keep} 份；快照位于数据目录 backups/。恢复需停服后执行 <code>node scripts/restore.js &lt;快照&gt; --yes</code>。</p>
      ${bk.items.length ? `<div class="tbl-wrap plain"><table class="mini"><thead><tr><th>快照文件</th><th>大小</th><th>时间</th></tr></thead><tbody>${bk.items.map(b => `<tr><td><code>${esc(b.name)}</code></td><td>${(b.size / 1024).toFixed(0)} KB</td><td>${fmtDateTime(b.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">暂无备份</p>'}<h4 class="sec">安全配置</h4>` : '') + `<div class="kv-grid">${[['系统版本', 'V' + h.version], ['数据存储', 'SQLite（WAL）'], ['会话有效期', '8 小时，HttpOnly + SameSite Cookie'], ['密码策略', '≥12 位、至少 3 类字符、不含账号名；scrypt 加盐散列'], ['登录保护', '同账号 15 分钟内失败 5 次锁定（持久化）'], ['两步验证', 'TOTP 动态码，用户可自助启用，管理员可重置'], ['访问日志', 'ACCESS_LOG=1 输出 JSON 行日志，含请求 ID'], ['数据权限', '按成员“数据范围”控制（本人/本部门/全部）'], ['金额存储', '整数“分”，避免浮点误差']].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  }
  $('#content').innerHTML = pageHead('系统设置', '基础设置、数据字典、字段与审计日志') + `<section class="panel settings"><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-act="settings-tab" data-tab="${k}">${l}</button>`).join('')}</div><div class="tab-pane">${pane}</div></section>`;
  $('#cfForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { setSettings((await API.put('/settings', { customFields: ui.cfDraft })).settings); ui.cfDraft = null; toast('字段配置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#approvalForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { setSettings((await API.put('/settings', { approval: { levels: ui.apDraft } })).settings); ui.apDraft = null; toast('审批设置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#enforceForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { setSettings((await API.put('/settings', { sso: { enforce: new FormData(e.currentTarget).has('enforce') } })).settings); toast('登录策略已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  for (const prov of ['wecom', 'dingtalk']) {
    $(`#${prov}Form`)?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget), body = { enabled: fd.has('enabled'), autoCreate: fd.has('autoCreate'), notify: fd.has('notify'), notifyEvents: fd.getAll('notifyEvents') };
      for (const k of ['corpId', 'agentId', 'clientId', 'buttonText', 'defaultRole', 'defaultDept']) if (fd.has(k)) body[k] = fd.get(k);
      for (const k of ['secret', 'clientSecret']) if (fd.get(k)) body[k] = fd.get(k);
      const btn = e.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
      try { setSettings((await API.put('/settings', { [prov]: body })).settings); toast(`${PROVIDER_NAME[prov]}设置已保存`); rerender(); } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
  }
  $('#ssoForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sso = { enabled: fd.has('enabled'), issuer: fd.get('issuer'), clientId: fd.get('clientId'), buttonText: fd.get('buttonText'), defaultRole: fd.get('defaultRole'), defaultDept: fd.get('defaultDept'), autoCreate: fd.has('autoCreate') };
    if (fd.get('clientSecret')) sso.clientSecret = fd.get('clientSecret');
    const btn = e.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
    try { setSettings((await API.put('/settings', { sso })).settings); toast('单点登录设置已保存'); rerender(); } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
  $('#smtpForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const smtp = { enabled: fd.has('enabled'), host: fd.get('host'), port: Number(fd.get('port')), secure: fd.get('secure'), from: fd.get('from'), user: fd.get('user'), events: fd.getAll('events') };
    if (fd.get('pass')) smtp.pass = fd.get('pass');
    try { setSettings((await API.put('/settings', { smtp })).settings); toast('邮件设置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#webhookForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try { setSettings((await API.put('/settings', { webhook: { url: fd.get('url'), kind: fd.get('kind'), events: fd.getAll('events') } })).settings); toast('通知设置已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#basicForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { setSettings((await API.put('/settings', Object.fromEntries(new FormData(e.currentTarget)))).settings); toast('设置已保存'); $('#shell')?.remove(); rerender(); } catch (err) { toast(err.message, true); }
  });
  $('#dictForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget), dicts = {};
    for (const k of Object.keys(DICT_LABEL)) dicts[k] = String(fd.get(k) || '').split('\n').map(s => s.trim()).filter(Boolean);
    try { setSettings((await API.put('/settings', { dicts })).settings); toast('数据字典已保存'); rerender(); } catch (err) { toast(err.message, true); }
  });
}
