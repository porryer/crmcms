'use strict';
/** 租户设置的读取、对外视图与校验 */
const crypto = require('node:crypto');
const { publicOrigin } = require('./config');
const { db } = require('./db');
const { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, DEFAULT_SETTINGS } = require('./constants');
const { boom } = require('./util');

// ---------- 设置 ----------
function getSettings(tenantId) {
  const t = db.prepare('SELECT name,settings FROM tenants WHERE id=?').get(tenantId);
  let s = {};
  try { s = JSON.parse(t?.settings || '{}'); } catch { s = {}; }
  return {
    ...DEFAULT_SETTINGS, ...s, companyName: s.companyName || t?.name || DEFAULT_SETTINGS.companyName,
    dicts: { ...DEFAULT_SETTINGS.dicts, ...(s.dicts || {}) },
    customFields: s.customFields || {}, approval: s.approval?.levels?.length ? s.approval : DEFAULT_SETTINGS.approval,
    webhook: { ...DEFAULT_SETTINGS.webhook, ...(s.webhook || {}) },
    smtp: { ...DEFAULT_SETTINGS.smtp, ...(s.smtp || {}) },
    sso: { ...DEFAULT_SETTINGS.sso, ...(s.sso || {}) },
    wecom: { ...DEFAULT_SETTINGS.wecom, ...(s.wecom || {}) },
    dingtalk: { ...DEFAULT_SETTINGS.dingtalk, ...(s.dingtalk || {}) },
  };
}
/** 返回给前端的设置：Webhook 地址含密钥，仅管理员可见 */
function publicSettings(u) {
  const st = getSettings(u.tenant_id);
  if (u.role !== 'admin') { st.webhook = { configured: !!st.webhook.url }; st.smtp = { enabled: !!st.smtp.enabled }; st.sso = { enabled: !!st.sso.enabled }; st.wecom = { enabled: !!st.wecom.enabled }; st.dingtalk = { enabled: !!st.dingtalk.enabled }; }
  else { st.smtp = { ...st.smtp, pass: '', passSet: !!st.smtp.pass }; st.sso = { ...st.sso, clientSecret: '', secretSet: !!st.sso.clientSecret, redirectUri: ssoRedirectUri() };
    st.wecom = { ...st.wecom, secret: '', secretSet: !!st.wecom.secret, redirectUri: ssoRedirectUri(null, 'wecom') };
    st.dingtalk = { ...st.dingtalk, clientSecret: '', secretSet: !!st.dingtalk.clientSecret, redirectUri: ssoRedirectUri(null, 'dingtalk') }; }
  return st;
}
const customFieldsOf = (u, type) => (u ? getSettings(u.tenant_id).customFields?.[type] || [] : []);

function ssoRedirectUri(req, provider = 'oidc') {
  const origin = publicOrigin() || (req ? `${process.env.COOKIE_SECURE === '1' ? 'https' : 'http'}://${req.headers.host}` : '');
  return origin ? origin + (provider === 'oidc' ? '/api/sso/callback' : `/api/sso/${provider}/callback`) : '(请设置 PUBLIC_ORIGIN)';
}
function validateCustomFields(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) boom(400, '自定义字段格式错误');
  const out = { ...current };
  for (const [entity, list] of Object.entries(input)) {
    if (!CUSTOM_FIELD_ENTITIES.includes(entity)) boom(400, `不支持为 ${entity} 添加自定义字段`);
    if (!Array.isArray(list) || list.length > 30) boom(400, '每个对象最多 30 个自定义字段');
    const keys = new Set();
    out[entity] = list.map(f => {
      const label = String(f?.label || '').trim().slice(0, 30);
      if (!label) boom(400, '自定义字段名称不能为空');
      const type = CUSTOM_FIELD_TYPES.includes(f.type) ? f.type : 'text';
      const key = /^cf_[a-z0-9]{4,16}$/.test(f.key || '') ? f.key : 'cf_' + crypto.randomBytes(4).toString('hex');
      if (keys.has(key)) boom(400, '自定义字段键重复');
      keys.add(key);
      const options = type === 'select' ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(/[\n,，]/)).map(x => String(x).trim()).filter(Boolean))].slice(0, 50) : [];
      if (type === 'select' && !options.length) boom(400, `下拉字段“${label}”至少需要一个选项`);
      return { key, label, type, options, required: !!f.required, inList: !!f.inList };
    });
  }
  return out;
}
function validateApproval(input) {
  const levels = Array.isArray(input?.levels) ? input.levels : [];
  if (!levels.length || levels.length > 5) boom(400, '审批级别需 1-5 级');
  return {
    levels: levels.map(l => {
      const name = String(l?.name || '').trim().slice(0, 30);
      if (!name) boom(400, '审批级别名称不能为空');
      if (!['manager', 'admin'].includes(l.role)) boom(400, '审批人角色只能是销售经理或管理员');
      const minAmount = Number(l.minAmount || 0);
      if (!Number.isFinite(minAmount) || minAmount < 0) boom(400, '金额阈值无效');
      return { name, role: l.role, minAmount };
    }),
  };
}

module.exports = { customFieldsOf, getSettings, publicSettings, ssoRedirectUri, validateApproval, validateCustomFields };
