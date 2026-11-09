'use strict';
/** 通知：邮件、企业微信 / 钉钉工作通知、每日摘要、站内通知 */
const SMTP = require('../lib/smtp');
const WECOM = require('../lib/wecom');
const DINGTALK = require('../lib/dingtalk');
const { publicOrigin } = require('./config');
const { db } = require('./db');
const { TABLES } = require('./constants');
const { now, row, ymd } = require('./util');
const { getRecord } = require('./store');
const { scoped } = require('./scope');
const { getSettings } = require('./settings');
const { logJson } = require('./http');
const { canApprove, currentLevel, notifyWebhook } = require('./records');

// ---------- 邮件通知 ----------
const escHtml = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mailBody(st, title, lines, link) {
  const url = link && publicOrigin() ? publicOrigin() + '/' + link : '';
  const text = [title, '', ...lines, ...(url ? ['', '查看详情：' + url] : []), '', `—— ${st.systemName}（自动通知，可在个人菜单中关闭邮件通知）`].join('\n');
  const html = `<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:560px;color:#1b2437"><h3 style="color:#1f6bff;margin:0 0 12px">${escHtml(title)}</h3>${lines.map(l => `<p style="margin:4px 0">${escHtml(l)}</p>`).join('')}${url ? `<p style="margin:18px 0"><a href="${escHtml(url)}" style="background:#1f6bff;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">查看详情</a></p>` : ''}<p style="color:#8a96ab;font-size:12px;margin-top:24px">${escHtml(st.systemName)} 自动通知 · 可在个人菜单中关闭邮件通知</p></div>`;
  return { text, html };
}
/** 向指定成员发送邮件（异步，失败仅记录日志）；返回 Promise 便于测试等待 */
function notifyEmail(u, event, userIds, title, lines, link = '') {
  const st = getSettings(u.tenant_id), cfg = st.smtp;
  if (!cfg.enabled || !cfg.host || !(cfg.events || []).includes(event)) return Promise.resolve(0);
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return Promise.resolve(0);
  const users = db.prepare(`SELECT email FROM users WHERE tenant_id=? AND active=1 AND email_notify=1 AND id IN (${ids.map(() => '?').join(',')})`).all(u.tenant_id, ...ids);
  if (!users.length) return Promise.resolve(0);
  const { text, html } = mailBody(st, title, lines, link);
  const job = Promise.all(users.map(x => SMTP.sendMail(cfg, { to: [x.email], subject: `[${st.systemName}] ${title}`, text, html })
    .then(() => 1).catch(e => { logJson({ type: 'mail_error', event, to: x.email, message: e.message }); return 0; })))
    .then(r => r.reduce((a, b) => a + b, 0));
  pendingMail.add(job); job.finally(() => pendingMail.delete(job));
  return job;
}
const pendingMail = new Set();
/** 企业微信应用消息 / 钉钉工作通知：按成员绑定的第三方账号推送给个人 */
function notifyIM(u, event, userIds, title, lines, link = '') {
  const st = getSettings(u.tenant_id), ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return Promise.resolve(0);
  const url = link && publicOrigin() ? publicOrigin() + '/' + link : '';
  const jobs = [];
  for (const prov of ['wecom', 'dingtalk']) {
    const cfg = st[prov];
    if (!cfg.enabled || !cfg.notify || !(cfg.notifyEvents || []).includes(event)) continue;
    const rows = db.prepare(`SELECT i.subject,i.ext_userid FROM identities i JOIN users x ON x.id=i.user_id WHERE i.tenant_id=? AND i.provider=? AND x.active=1 AND x.im_notify=1 AND i.user_id IN (${ids.map(() => '?').join(',')})`).all(u.tenant_id, prov, ...ids);
    if (!rows.length) continue;
    jobs.push((async () => {
      if (prov === 'wecom') { const r = await WECOM.sendMessage(cfg, rows.map(x => x.subject), { title, lines, url }); return rows.length - r.invalid.length; }
      const userids = [];
      for (const r of rows) {
        let id = r.ext_userid;
        if (!id) {
          id = await DINGTALK.userIdByUnionId(cfg, r.subject).catch(e => { logJson({ type: 'im_error', provider: prov, message: e.message }); return ''; });
          if (id) db.prepare("UPDATE identities SET ext_userid=? WHERE tenant_id=? AND provider='dingtalk' AND subject=?").run(id, u.tenant_id, r.subject);
        }
        if (id) userids.push(id);
      }
      if (userids.length) await DINGTALK.sendWorkNotice(cfg, userids, { title, lines, url });
      return userids.length;
    })().catch(e => { logJson({ type: 'im_error', provider: prov, event, message: e.message }); return 0; }));
  }
  if (!jobs.length) return Promise.resolve(0);
  const job = Promise.all(jobs).then(r => r.reduce((a, b) => a + b, 0));
  pendingMail.add(job); job.finally(() => pendingMail.delete(job));
  return job;
}
/** 个人通知：邮件 + 企业微信/钉钉（各自按开关与事件过滤），返回送达人次 */
const notifyUsers = (u, event, userIds, title, lines, link = '') =>
  Promise.all([notifyEmail(u, event, userIds, title, lines, link), notifyIM(u, event, userIds, title, lines, link)]).then(([a, b]) => a + b);
/** 当前审批节点的审批人（不含提交人；管理员级别仅通知管理员） */
function approverIds(u, c) {
  const lv = currentLevel(c), role = lv?.role || 'manager';
  let ids = db.prepare('SELECT id FROM users WHERE tenant_id=? AND active=1 AND role=?').all(u.tenant_id, role).map(x => x.id).filter(id => id !== c.submittedBy);
  if (!ids.length) ids = db.prepare("SELECT id FROM users WHERE tenant_id=? AND active=1 AND role='admin'").all(u.tenant_id).map(x => x.id).filter(id => id !== c.submittedBy);
  return ids;
}
function notifyApprovalPending(u, c) {
  const lv = currentLevel(c), title = `合同待审批：${lv?.name || '审批'}`;
  const lines = [`${c.number} ${c.name}`, `金额：¥${Number(c.amount).toLocaleString('zh-CN')}`, `提交人：${u.display_name}`];
  notifyWebhook(u, 'approval', title, lines);
  notifyUsers(u, 'approval', approverIds(u, c), title, lines, `#/contracts?q=${encodeURIComponent(c.number || '')}`);
}
function notifyAssign(u, type, ownerId, title, lines, link) {
  notifyWebhook(u, 'assign', title, lines);
  notifyUsers(u, 'assign', [ownerId], title, lines, link);
}

/** 每日摘要：每位成员的今日/逾期任务、即将到期回款计划、待审批合同 */
async function sendDigests(force = false) {
  const today = ymd(new Date());
  let sent = 0;
  for (const t of db.prepare('SELECT id FROM tenants').all()) {
    const st = getSettings(t.id);
    const viaMail = st.smtp.enabled && (st.smtp.events || []).includes('digest');
    const viaIm = ['wecom', 'dingtalk'].some(k => st[k].enabled && st[k].notify && (st[k].notifyEvents || []).includes('digest'));
    if (!viaMail && !viaIm) continue;
    const key = `digest:${t.id}:${today}`;
    if (!force && db.prepare('SELECT 1 FROM meta WHERE key=?').get(key)) continue;
    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key, now());
    for (const user of db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1 AND (email_notify=1 OR im_notify=1)').all(t.id)) {
      const n = notifications(user);
      const todo = n.items.filter(x => ['task', 'approval', 'plan'].includes(x.type));
      if (!todo.length) continue;
      const lines = todo.slice(0, 20).map(x => `· ${x.title}：${x.text}`);
      if (todo.length > 20) lines.push(`…另有 ${todo.length - 20} 项`);
      sent += await notifyUsers(user, 'digest', [user.id], `今日待办提醒（${todo.length} 项）`, lines, '#/dashboard');
    }
  }
  return sent;
}
// ---------- 站内通知 ----------
function notifications(u) {
  const items = [], today = ymd(new Date()), soon = ymd(new Date(Date.now() + 3 * 86400000));
  for (const t of scoped(u, 'tasks')) {
    if (t.ownerId === u.id && t.status !== '已完成' && t.dueDate && t.dueDate <= today) {
      items.push({ type: 'task', id: t.id, title: t.dueDate < today ? '任务已逾期' : '任务今日到期', text: t.title, link: '#/tasks?view=due', at: t.dueDate + 'T00:00:00' });
    }
  }
  const contracts = scoped(u, 'contracts'), byId = new Map(contracts.map(c => [c.id, c]));
  for (const c of contracts) {
    if (!canApprove(u, c)) continue;
    const last = (c.approvalHistory || []).at(-1);
    items.push({ type: 'approval', id: c.id, title: `待审批：${currentLevel(c)?.name || '合同审批'}`, text: `${c.number} ${c.name} · ¥${Number(c.amount).toLocaleString('zh-CN')}`, link: '#/contracts?q=' + encodeURIComponent(c.number || c.name), at: last?.at || c.updatedAt });
  }
  for (const p of scoped(u, 'plans')) {
    const c = byId.get(p.contractId);
    if (p.status === '已回款' || !p.dueDate || p.dueDate > soon || !c || (c.ownerId || c.createdBy) !== u.id) continue;
    items.push({ type: 'plan', id: p.id, title: p.dueDate < today ? '回款计划已逾期' : '回款计划即将到期', text: `${c.number} ${c.name} · ¥${Number(p.amount).toLocaleString('zh-CN')} · ${p.dueDate}`, link: '#/finance', at: p.dueDate + 'T00:00:00' });
  }
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const rows = db.prepare("SELECT a.*,x.display_name by_name FROM audits a LEFT JOIN users x ON x.id=a.user_id WHERE a.tenant_id=? AND a.at>? AND a.user_id<>? AND a.action IN ('assign','approve','reject') ORDER BY a.at DESC LIMIT 300").all(u.tenant_id, since, u.id);
  for (const a of rows) {
    const d = JSON.parse(a.details || '{}');
    if (a.action === 'assign' && d.ownerId === u.id) {
      const rec = row(getRecord(u, a.entity, a.entity_id));
      if (rec) items.push({ type: 'assign', id: a.id, title: `${a.by_name || '同事'} 将${TABLES[a.entity]?.label || ''}分配给你`, text: rec.name || rec.title || '', link: a.entity === 'accounts' ? `#/accounts/${rec.id}` : a.entity === 'opportunities' ? `#/opportunities/${rec.id}` : `#/${a.entity}?q=${encodeURIComponent(rec.name || rec.title || '')}`, at: a.at });
    } else if (a.entity === 'contracts' && (a.action === 'approve' || a.action === 'reject')) {
      const c = row(getRecord(u, 'contracts', a.entity_id));
      if (c && (c.submittedBy === u.id || c.ownerId === u.id)) items.push({ type: a.action, id: a.id, title: a.action === 'approve' ? (d.final ? '合同审批通过' : `合同已通过「${d.level || '审批'}」`) : '合同被驳回', text: `${c.number} ${c.name}${d.note ? ' · ' + d.note : ''}`, link: '#/contracts?q=' + encodeURIComponent(c.number || ''), at: a.at });
    }
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const seen = u.notif_seen_at || '';
  const actionable = items.filter(x => ['task', 'approval', 'plan'].includes(x.type)).length;
  return { items: items.slice(0, 50).map(x => ({ ...x, unread: x.at > seen })), unread: items.filter(x => x.at > seen).length, actionable };
}

module.exports = { mailBody, notifications, notifyApprovalPending, notifyAssign, notifyUsers, pendingMail, sendDigests };
