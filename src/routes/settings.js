'use strict';
/** 系统设置（管理员）：设置保存、通知测试、Logo */
const fs = require('node:fs');
const path = require('node:path');
const SMTP = require('../../lib/smtp');
const OIDC = require('../../lib/oidc');
const WECOM = require('../../lib/wecom');
const DINGTALK = require('../../lib/dingtalk');
const { publicOrigin } = require('../config');
const { db } = require('../db');
const { DEFAULT_SETTINGS, WEBHOOK_EVENTS } = require('../constants');
const { boom, newId } = require('../util');
const { audit } = require('../store');
const { getSettings, publicSettings, validateApproval, validateCustomFields } = require('../settings');
const { NEXT, readBody, send, sendFileStream } = require('../http');
const { notifyWebhook, validWebhookUrl } = require('../records');
const { mailBody, sendDigests } = require('../notify');
const { IM, PROVIDER_NAME, validIssuer } = require('../sso');
const { fileDir, receiveFile } = require('../attachments');

async function settingsRoutes(req, res, url, u) {
  const p = url.pathname, m = req.method;
  if (p === '/api/settings') {
    if (m === 'GET') return send(res, 200, { settings: publicSettings(u) });
    if (m === 'PUT' || m === 'PATCH') {
      if (u.role !== 'admin') boom(403, '仅管理员可修改系统设置');
      const b = await readBody(req), cur = getSettings(u.tenant_id);
      const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : fallback);
      const dicts = { ...cur.dicts };
      if (b.dicts && typeof b.dicts === 'object') {
        for (const k of Object.keys(DEFAULT_SETTINGS.dicts)) {
          if (!Array.isArray(b.dicts[k])) continue;
          const list = [...new Set(b.dicts[k].map(x => String(x).trim()).filter(Boolean).map(x => x.slice(0, 40)))].slice(0, 100);
          if (!list.length) boom(400, `字典 ${k} 至少保留一项`);
          dicts[k] = list;
        }
      }
      const next = { ...cur, systemName: text(b.systemName, cur.systemName), companyName: text(b.companyName, cur.companyName), dicts };
      if (b.customFields !== undefined) next.customFields = validateCustomFields(b.customFields, cur.customFields);
      if (b.approval !== undefined) next.approval = validateApproval(b.approval);
      if (b.smtp !== undefined) {
        const x = b.smtp || {}, c0 = cur.smtp;
        const smtp = {
          enabled: x.enabled !== undefined ? !!x.enabled : c0.enabled,
          host: String(x.host ?? c0.host).trim().slice(0, 200), port: Number(x.port ?? c0.port) || 465,
          secure: ['ssl', 'starttls', 'none'].includes(x.secure) ? x.secure : c0.secure,
          user: String(x.user ?? c0.user).trim().slice(0, 200),
          pass: x.pass ? String(x.pass).slice(0, 500) : (x.clearPass ? '' : c0.pass),
          from: String(x.from ?? c0.from).trim().slice(0, 200),
          events: Array.isArray(x.events) ? x.events.filter(e => ['approval', 'assign', 'digest'].includes(e)) : c0.events,
        };
        if (smtp.enabled && (!smtp.host || !/^[^\s@<>]+@[^\s@<>]+$/.test(String(smtp.from).replace(/^.*<|>$/g, '')))) boom(400, '启用邮件通知需填写 SMTP 服务器与有效的发件人地址');
        if (smtp.port < 1 || smtp.port > 65535) boom(400, '端口无效');
        next.smtp = smtp;
      }
      if (b.sso !== undefined) {
        const x = b.sso || {}, c0 = cur.sso;
        const sso = {
          enabled: x.enabled !== undefined ? !!x.enabled : c0.enabled,
          issuer: String(x.issuer ?? c0.issuer).trim().replace(/\/$/, '').slice(0, 300),
          clientId: String(x.clientId ?? c0.clientId).trim().slice(0, 300),
          clientSecret: x.clientSecret ? String(x.clientSecret).slice(0, 1000) : (x.clearSecret ? '' : c0.clientSecret),
          buttonText: String(x.buttonText ?? c0.buttonText).trim().slice(0, 30) || '企业账号登录',
          autoCreate: x.autoCreate !== undefined ? !!x.autoCreate : c0.autoCreate,
          defaultRole: ['sales', 'viewer', 'manager'].includes(x.defaultRole) ? x.defaultRole : c0.defaultRole,
          defaultDept: String(x.defaultDept ?? c0.defaultDept).slice(0, 50),
          enforce: x.enforce !== undefined ? !!x.enforce : c0.enforce,
        };
        if (sso.enabled) {
          if (!validIssuer(sso.issuer)) boom(400, 'Issuer 必须为 https:// 开头的有效地址');
          if (!sso.clientId) boom(400, '请填写 Client ID');
          try { await OIDC.discover(sso.issuer); } catch (e) { boom(400, `无法读取 ${sso.issuer}/.well-known/openid-configuration：${e.message}`); }
        }
        next.sso = sso;
      }
      for (const prov of ['wecom', 'dingtalk']) {
        if (b[prov] === undefined) continue;
        const x = b[prov] || {}, c0 = cur[prov], secretKey = prov === 'wecom' ? 'secret' : 'clientSecret';
        const t = (k, n = 200) => String(x[k] ?? c0[k]).trim().slice(0, n);
        const cfg = {
          enabled: x.enabled !== undefined ? !!x.enabled : c0.enabled,
          ...(prov === 'wecom' ? { corpId: t('corpId'), agentId: t('agentId', 30) } : { clientId: t('clientId'), corpId: t('corpId'), agentId: t('agentId', 30) }),
          notify: x.notify !== undefined ? !!x.notify : c0.notify,
          notifyEvents: Array.isArray(x.notifyEvents) ? x.notifyEvents.filter(e => ['approval', 'assign', 'digest'].includes(e)) : c0.notifyEvents,
          [secretKey]: x[secretKey] ? String(x[secretKey]).slice(0, 500) : (x.clearSecret ? '' : c0[secretKey]),
          buttonText: t('buttonText', 30) || DEFAULT_SETTINGS[prov].buttonText,
          autoCreate: x.autoCreate !== undefined ? !!x.autoCreate : c0.autoCreate,
          defaultRole: ['sales', 'viewer', 'manager'].includes(x.defaultRole) ? x.defaultRole : c0.defaultRole,
          defaultDept: t('defaultDept', 50),
        };
        if (prov === 'dingtalk' && cfg.notify && !/^\d+$/.test(cfg.agentId)) boom(400, '推送钉钉工作通知需填写应用 AgentId（数字）');
        if (cfg.notify && !cfg.enabled) boom(400, `请先启用${PROVIDER_NAME[prov]}登录（工作通知按成员绑定的${PROVIDER_NAME[prov]}账号发送）`);
        if (cfg.enabled) {
          if (prov === 'wecom' && (!cfg.corpId || !/^\d+$/.test(cfg.agentId) || !cfg.secret)) boom(400, '请完整填写企业 ID（CorpID）、应用 AgentId（数字）和应用 Secret');
          if (prov === 'dingtalk' && (!cfg.clientId || !cfg.clientSecret || !cfg.corpId)) boom(400, '请完整填写 AppKey（Client ID）、AppSecret 和企业 CorpId');
          try { await IM[prov].verifyConfig(cfg); } catch (e) { boom(400, `${PROVIDER_NAME[prov]}配置校验失败：${e.message}`); }
        }
        next[prov] = cfg;
      }
      if (b.webhook !== undefined) {
        const w = b.webhook || {};
        const url = String(w.url ?? cur.webhook.url).trim();
        if (!validWebhookUrl(url)) boom(400, 'Webhook 地址必须为 https:// 开头的有效 URL');
        next.webhook = { url, kind: ['wecom', 'dingtalk', 'generic'].includes(w.kind) ? w.kind : cur.webhook.kind, events: Array.isArray(w.events) ? w.events.filter(e => WEBHOOK_EVENTS.includes(e)) : cur.webhook.events };
      }
      db.prepare('UPDATE tenants SET settings=?,name=? WHERE id=?').run(JSON.stringify(next), next.companyName, u.tenant_id);
      audit(u, 'update', 'settings', u.tenant_id, { before: { ...cur, webhook: { ...cur.webhook, url: cur.webhook.url ? '***' : '' }, smtp: { ...cur.smtp, pass: cur.smtp.pass ? '***' : '' }, sso: { ...cur.sso, clientSecret: cur.sso.clientSecret ? '***' : '' }, wecom: { ...cur.wecom, secret: cur.wecom.secret ? '***' : '' }, dingtalk: { ...cur.dingtalk, clientSecret: cur.dingtalk.clientSecret ? '***' : '' } } });
      return send(res, 200, { settings: publicSettings(u) });
    }
  }

  if (p === '/api/settings/webhook-test' && m === 'POST') {
    if (u.role !== 'admin') boom(403, '仅管理员可操作');
    const w = getSettings(u.tenant_id).webhook;
    if (!w.url) boom(400, '请先保存 Webhook 地址');
    notifyWebhook(u, (w.events || [])[0] || 'approval', `${getSettings(u.tenant_id).systemName} 测试消息`, ['Webhook 配置成功', `发送人：${u.display_name}`]);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/settings/smtp-test' && m === 'POST') {
    if (u.role !== 'admin') boom(403, '仅管理员可操作');
    const st = getSettings(u.tenant_id);
    if (!st.smtp.host) boom(400, '请先保存 SMTP 配置');
    const { text, html } = mailBody(st, '邮件通知配置成功', [`这是一封来自 ${st.systemName} 的测试邮件。`, `发送人：${u.display_name}`]);
    try { await SMTP.sendMail(st.smtp, { to: [u.email], subject: `[${st.systemName}] 测试邮件`, text, html }); }
    catch (e) { boom(400, `发送失败：${e.message}`); }
    return send(res, 200, { ok: true, to: u.email });
  }
  if (p === '/api/settings/im-test' && m === 'POST') {
    if (u.role !== 'admin') boom(403, '仅管理员可操作');
    const b = await readBody(req), prov = b.provider;
    if (!['wecom', 'dingtalk'].includes(prov)) boom(400, '参数错误');
    const cfg = getSettings(u.tenant_id)[prov];
    if (!cfg.enabled || !cfg.notify) boom(400, `请先启用${PROVIDER_NAME[prov]}登录与工作通知并保存`);
    const ident = db.prepare('SELECT * FROM identities WHERE tenant_id=? AND provider=? AND user_id=?').get(u.tenant_id, prov, u.id);
    if (!ident) boom(400, `你的账号尚未绑定${PROVIDER_NAME[prov]}，请先在个人菜单中绑定`);
    const lines = ['工作通知配置成功', `发送人：${u.display_name}`];
    try {
      if (prov === 'wecom') { const r = await WECOM.sendMessage(cfg, [ident.subject], { title: '测试消息', lines, url: publicOrigin() ? publicOrigin() + '/#/dashboard' : '' }); if (r.invalid.length) throw new Error('成员不在应用可见范围内'); }
      else {
        let id = ident.ext_userid || await DINGTALK.userIdByUnionId(cfg, ident.subject);
        if (!id) throw new Error('未查到钉钉成员 userid');
        if (!ident.ext_userid) db.prepare("UPDATE identities SET ext_userid=? WHERE tenant_id=? AND provider='dingtalk' AND subject=?").run(id, u.tenant_id, ident.subject);
        await DINGTALK.sendWorkNotice(cfg, [id], { title: '测试消息', lines, url: publicOrigin() ? publicOrigin() + '/#/dashboard' : '' });
      }
    } catch (e) { boom(400, `发送失败：${e.message}`); }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/settings/digest-now' && m === 'POST') {
    if (u.role !== 'admin') boom(403, '仅管理员可操作');
    return send(res, 200, { sent: await sendDigests(true) });
  }
  if (p === '/api/settings/logo') {
    if (m === 'GET') {
      const st = getSettings(u.tenant_id), file = path.join(fileDir(u.tenant_id), st.logoFile || 'logo');
      if (!st.logo || !fs.existsSync(file)) boom(404, '未设置 Logo');
      res.writeHead(200, { 'Content-Type': st.logo, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      return sendFileStream(res, file);
    }
    if (u.role !== 'admin') boom(403, '仅管理员可修改 Logo');
    const st = getSettings(u.tenant_id);
    if (m === 'POST') {
      const mime = String(req.headers['content-type'] || '').split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) boom(415, 'Logo 仅支持 PNG / JPG / WebP');
      // 每次上传使用新文件名（不可变），便于增量备份；旧文件保留在备份文件池中
      const name = 'logo-' + newId().slice(0, 8), prev = st.logoFile || (st.logo ? 'logo' : '');
      await receiveFile(req, path.join(fileDir(u.tenant_id), name), 512 * 1024);
      if (prev) fs.rmSync(path.join(fileDir(u.tenant_id), prev), { force: true });
      st.logo = mime; st.logoFile = name;
    } else if (m === 'DELETE') { if (st.logoFile || st.logo) fs.rmSync(path.join(fileDir(u.tenant_id), st.logoFile || 'logo'), { force: true }); st.logo = ''; st.logoFile = ''; }
    else boom(405, '不支持的操作');
    db.prepare('UPDATE tenants SET settings=? WHERE id=?').run(JSON.stringify(st), u.tenant_id);
    audit(u, 'update', 'settings', u.tenant_id, { logo: st.logo });
    return send(res, 200, { settings: publicSettings(u) });
  }
  return NEXT;
}

module.exports = { settingsRoutes };
