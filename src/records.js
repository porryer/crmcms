'use strict';
/** 记录校验、负责人、引用完整性、合同审批与增删改 */
const { db } = require('./db');
const { CONTRACT_APPROVED, LABELS, LEGACY, TABLES } = require('./constants');
const { boom, cents, newId, now, row, serialize, sumCents } = require('./util');
const { all, audit, childrenOf, getRecord } = require('./store');
const { canManage, effectiveScope, getVisible } = require('./scope');
const { customFieldsOf, getSettings } = require('./settings');

// ---------- 校验 ----------
function sanitize(type, obj, existing = {}, u = null) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) boom(400, '提交内容无效');
  const def = TABLES[type];
  const data = { ...existing, ...(!Object.keys(existing).length ? def.defaults : {}) };
  for (const field of def.fields) {
    if (!Object.hasOwn(obj, field)) continue;
    let v = obj[field];
    if (field === 'amount') {
      if (typeof v !== 'number' && typeof v !== 'string') boom(400, '金额格式错误');
      v = Number(v);
      if (!Number.isFinite(v) || v < 0 || v > 1e12 || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) boom(400, '金额必须为非负、最多两位小数');
    } else if (def.numbers?.[field]) {
      const [min, max] = def.numbers[field];
      v = v === '' || v === null ? min : Number(v);
      if (!Number.isFinite(v) || v < min || v > max) boom(400, `${LABELS[field] || field} 必须在 ${min}-${max} 之间`);
    } else if (field === 'isPrimary') {
      v = v === true || v === 'true' || v === '1' || v === 1;
    } else if (typeof v !== 'string' || v.length > 3000) {
      boom(400, `${field} 必须为长度不超过3000的文本`);
    }
    const legacy = LEGACY[type]?.[field]?.[v];
    if (legacy) v = legacy;
    if (def.enums?.[field] && v === '') v = existing[field] ?? def.defaults[field] ?? v;
    if (def.enums?.[field] && !def.enums[field].includes(v)) boom(400, `${LABELS[field] || field} 取值无效：${v}`);
    data[field] = v;
  }
  for (const k of def.required) if (!String(data[k] ?? '').trim()) boom(400, `缺少必填字段: ${LABELS[k] || k}`);
  const custom = customFieldsOf(u, type), creating = !Object.keys(existing).length;
  for (const f of custom) {
    if (!Object.hasOwn(obj, f.key)) continue;
    let v = obj[f.key] ?? '';
    if (f.type === 'number') {
      if (v !== '') { v = Number(v); if (!Number.isFinite(v)) boom(400, `${f.label} 必须为数字`); }
    } else {
      if (typeof v !== 'string' && typeof v !== 'number') boom(400, `${f.label} 格式错误`);
      v = String(v);
      if (v.length > 3000) boom(400, `${f.label} 过长`);
      if (f.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) boom(400, `${f.label} 日期格式应为 YYYY-MM-DD`);
      if (f.type === 'select' && v && !(f.options || []).includes(v)) boom(400, `${f.label} 取值无效：${v}`);
    }
    data[f.key] = v;
  }
  for (const f of custom) if (f.required && (creating || Object.hasOwn(obj, f.key)) && String(data[f.key] ?? '').trim() === '') boom(400, `缺少必填字段: ${f.label}`);
  return data;
}

function collectedCents(u, contractId) {
  return sumCents(childrenOf(u, 'payments', 'contractId', contractId));
}

/**
 * 负责人解析：优先 ownerId（成员 ID）；兼容旧接口按姓名传 owner。
 * 新建未指定时默认当前用户；仅“全部”范围可分配给任意人，“本部门”限本部门，“本人”仅能给自己。
 */
function resolveOwner(u, type, data, submitted, before = null) {
  if (!TABLES[type].fields.includes('ownerId')) return;
  let target;
  if (Object.hasOwn(submitted, 'ownerId')) target = submitted.ownerId ? findUser(u, { id: submitted.ownerId }) : null;
  else if (Object.hasOwn(submitted, 'owner')) target = submitted.owner ? findUser(u, { name: submitted.owner }) : null;
  else if (!before) target = u;
  else return;
  if (target === undefined) boom(400, '负责人不存在或已停用');
  if (target && target.id !== before?.ownerId) assertCanAssign(u, target);
  data.ownerId = target ? target.id : '';
  data.owner = target ? target.display_name : '';
}
function findUser(u, { id, name }) {
  const rows = id ? db.prepare('SELECT * FROM users WHERE tenant_id=? AND id=? AND active=1').all(u.tenant_id, id)
    : db.prepare('SELECT * FROM users WHERE tenant_id=? AND display_name=? AND active=1').all(u.tenant_id, String(name).trim());
  return rows.length === 1 ? rows[0] : undefined;
}
function assertCanAssign(u, target) {
  const scope = effectiveScope(u);
  if (scope === 'self' && target.id !== u.id) boom(403, '当前数据范围为“本人”，不能分配给其他成员');
  if (scope === 'dept' && target.id !== u.id && (!u.department || target.department !== u.department)) boom(403, '只能分配给本部门成员');
}

function validRefs(u, type, data, recordId = null) {
  for (const [field, refType] of [['accountId', 'accounts'], ['opportunityId', 'opportunities'], ['contractId', 'contracts']]) {
    if (data[field] && !getVisible(u, refType, data[field])) boom(400, `${LABELS[field] || field}关联数据不存在或无权访问`);
  }
  if (type === 'payments') {
    const contract = row(getRecord(u, 'contracts', data.contractId));
    if (contract.status === '已作废') boom(409, '合同已作废，不能登记回款');
    const amount = cents(data.amount);
    if (amount <= 0) boom(400, '回款金额必须大于0');
    if (collectedCents(u, data.contractId) + amount > cents(contract.amount)) boom(409, '累计回款不能超过合同金额');
  }
  if (type === 'plans' && cents(data.amount) <= 0) boom(400, '计划金额必须大于0');
  if (type === 'contracts') {
    if (recordId && cents(data.amount) < collectedCents(u, recordId)) boom(409, '合同金额不能低于已登记回款');
    if (data.number) {
      const dup = db.prepare("SELECT id FROM records WHERE tenant_id=? AND type='contracts' AND deleted=0 AND json_extract(data,'$.number')=? AND id<>?").get(u.tenant_id, data.number, recordId || '');
      if (dup) boom(409, `合同编号 ${data.number} 已存在`);
    }
    if (data.opportunityId) {
      const opp = row(getRecord(u, 'opportunities', data.opportunityId));
      if (opp.accountId !== data.accountId) boom(400, '所选商机不属于该客户');
    }
  }
  if (type === 'leads' && data.status === '已转化' && !data.convertedAccountId) boom(400, '请使用“转客户”操作完成线索转化');
}

/** 非经理角色不得直接把合同置为审批后状态 */
/**
 * 合同状态流转规则（返回 'submit' 表示需要发起审批）：
 * 草稿 →审批中（提交）→ 按级别审批 → 已签订 → 执行中/已完成；作废需经理以上。
 * 跳过审批直接置为已签订等仅管理员可做（历史补录）。
 */
function guardContractStatus(u, before, after) {
  const signed = ['已签订', '执行中', '已完成'];
  const isAdmin = u.role === 'admin';
  if (after.status !== before.status) {
    if (after.status === '审批中') { if (before.status !== '草稿') boom(409, '仅草稿合同可以提交审批'); return 'submit'; }
    if (signed.includes(after.status) && !signed.includes(before.status) && !isAdmin) boom(403, '合同需通过审批流程签订（管理员可直接补录）');
    if (CONTRACT_APPROVED.includes(after.status) && !canManage(u)) boom(403, '合同需经理或管理员审批后才能变更为该状态');
    if (after.status === '草稿' && signed.includes(before.status) && !isAdmin) boom(403, '已签订合同不能退回草稿');
  }
  const changedMoney = after.amount !== before.amount || after.accountId !== before.accountId;
  if (before.status === '审批中' && after.status === '审批中' && changedMoney && !isAdmin) boom(409, '审批中的合同不能修改金额或客户，请先撤回');
  if (CONTRACT_APPROVED.includes(before.status) && before.status !== '已作废' && changedMoney && !canManage(u)) boom(403, '已审批合同的金额与客户仅经理或管理员可修改');
  return null;
}
function approvalLevelsFor(u, amount) {
  const levels = getSettings(u.tenant_id).approval.levels;
  const hit = levels.filter(l => cents(amount) >= cents(l.minAmount || 0));
  return (hit.length ? hit : levels.slice(0, 1)).map(l => ({ name: l.name, role: l.role }));
}
function startApproval(u, data) {
  data.status = '审批中';
  data.approvalLevels = approvalLevelsFor(u, data.amount);
  data.approvalStep = 0;
  data.submittedBy = u.id;
  data.approvalHistory = [...(data.approvalHistory || []), { action: 'submit', by: u.id, byName: u.display_name, at: now() }].slice(-50);
}
const currentLevel = c => (c.approvalLevels || [])[c.approvalStep || 0] || null;
/** 当前节点可审批：角色匹配且非提交人本人；管理员可审批任意节点 */
function canApprove(u, c) {
  if (c.status !== '审批中') return false;
  if (u.role === 'admin') return true;
  const lv = currentLevel(c);
  if (!lv) return u.role === 'manager';
  return u.role === lv.role && c.submittedBy !== u.id;
}

// ---------- 群机器人 Webhook ----------
function notifyWebhook(u, event, title, lines) {
  const w = getSettings(u.tenant_id).webhook;
  if (!w.url || !(w.events || []).includes(event)) return;
  const text = `### ${title}\n` + lines.map(l => `> ${l}`).join('\n');
  const body = w.kind === 'dingtalk' ? { msgtype: 'markdown', markdown: { title, text } }
    : w.kind === 'wecom' ? { msgtype: 'markdown', markdown: { content: text } }
      : { event, title, lines, at: now() };
  fetch(w.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    .catch(e => console.error('[webhook]', event, e.message));
}
function validWebhookUrl(url) {
  if (!url) return true;
  try {
    const x = new URL(url);
    return x.protocol === 'https:' || (x.protocol === 'http:' && process.env.WEBHOOK_ALLOW_HTTP === '1');
  } catch { return false; }
}

function nextContractNumber(u) {
  const year = new Date().getFullYear(), prefix = `HT${year}`;
  const used = new Set(all(u, 'contracts').map(x => x.number));
  let seq = all(u, 'contracts').filter(x => String(x.number || '').startsWith(prefix)).length + 1;
  while (used.has(prefix + String(seq).padStart(3, '0'))) seq++;
  return prefix + String(seq).padStart(3, '0');
}

function insertRecord(u, type, data, t = now()) {
  const key = newId();
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?)').run(key, u.tenant_id, type, serialize(type, data), t, t, u.id, u.id, 0);
  return { id: key, createdAt: t, updatedAt: t, createdBy: u.id, ...data };
}
function updateRecord(u, recordId, data) {
  const r = db.prepare('SELECT type FROM records WHERE id=? AND tenant_id=?').get(recordId, u.tenant_id);
  db.prepare('UPDATE records SET data=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(serialize(r.type, data), now(), u.id, recordId, u.tenant_id);
}

/** 删除前的关联检查；返回错误信息或 null */
function deleteBlocker(u, type, recordId) {
  if (type === 'accounts' && ['contacts', 'opportunities', 'tasks', 'activities', 'contracts'].some(k => childrenOf(u, k, 'accountId', recordId).length)) return '存在关联数据，不能删除客户';
  if (type === 'contracts' && childrenOf(u, 'payments', 'contractId', recordId).length) return '存在回款记录，不能删除合同';
  if (type === 'contracts' && childrenOf(u, 'plans', 'contractId', recordId).length) return '存在回款计划，不能删除合同';
  if (type === 'opportunities' && childrenOf(u, 'contracts', 'opportunityId', recordId).length) return '商机已关联合同，不能删除';
  return null;
}
function softDelete(u, type, recordId) {
  db.prepare('UPDATE records SET deleted=1,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?').run(now(), u.id, recordId, u.tenant_id);
  audit(u, 'delete', type, recordId);
}

module.exports = { assertCanAssign, canApprove, currentLevel, deleteBlocker, findUser, guardContractStatus, insertRecord, nextContractNumber, notifyWebhook, resolveOwner, sanitize, softDelete, startApproval, updateRecord, validRefs, validWebhookUrl };
