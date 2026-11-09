'use strict';
/** 通用实体路由：列表 / 新增 / 导入 / 批量 / 转化 / 审批 / 详情 / 修改 / 删除 */
const { TABLES } = require('../constants');
const { boom, now, row, ymd } = require('../util');
const { audit, childrenOf, decorate, getRecord, transaction } = require('../store');
const { canDelete, canWrite, getVisible, resetScope } = require('../scope');
const { isExport, readBody, send, sendCSV } = require('../http');
const { assertCanAssign, canApprove, currentLevel, deleteBlocker, findUser, guardContractStatus, insertRecord, nextContractNumber, notifyWebhook, resolveOwner, sanitize, softDelete, startApproval, updateRecord, validRefs } = require('../records');
const { accountOverview, exportRows, listRecords } = require('../query');
const { notifyApprovalPending, notifyAssign, notifyUsers } = require('../notify');
const { IMPORT_COLUMNS, importRecords, importTemplate } = require('../importer');

async function recordRoutes(req, res, url, u) {
  const p = url.pathname, m = req.method;
  const match = p.match(/^\/api\/([a-z]+)(?:\/([^/]+)(?:\/([a-z]+))?)?$/);
  if (!match || !TABLES[match[1]]) boom(404, '接口不存在');
  const [, type, recordId, act] = match;

  if (!recordId && m === 'GET') {
    const result = listRecords(u, type, url.searchParams);
    if (isExport(url)) {
      if (!canWrite(u)) boom(403, '没有导出权限');
      const all = listRecords(u, type, new URLSearchParams([...url.searchParams].filter(([k]) => !['page', 'pageSize'].includes(k))));
      audit(u, 'export', type, '*', { count: all.items.length });
      const { headers, rows } = exportRows(u, type, all.items);
      return sendCSV(res, `${type}.csv`, headers, rows);
    }
    return send(res, 200, result);
  }
  if (!recordId && m === 'POST') {
    if (!canWrite(u)) boom(403, '无新增权限');
    const submitted = await readBody(req);
    if (type === 'leads' && Object.hasOwn(submitted, 'convertedAccountId')) boom(400, '不能自行设置转换关联');
    const data = sanitize(type, submitted, {}, u);
    resolveOwner(u, type, data, submitted);
    let submitNow = false;
    if (type === 'contracts') {
      submitNow = guardContractStatus(u, { status: '草稿' }, data) === 'submit';
      if (submitNow) data.status = '草稿';
      if (!data.number) data.number = nextContractNumber(u);
    }
    validRefs(u, type, data);
    if (submitNow) startApproval(u, data);
    const item = transaction(() => {
      const it = insertRecord(u, type, data); audit(u, 'create', type, it.id);
      if (submitNow) audit(u, 'submit', 'contracts', it.id);
      if (data.ownerId && data.ownerId !== u.id) audit(u, 'assign', type, it.id, { ownerId: data.ownerId, owner: data.owner });
      return it;
    });
    if (submitNow) notifyApprovalPending(u, item);
    return send(res, 201, { item });
  }

  // 批量导入：GET 下载模板，POST {csv, commit}
  if (recordId === 'import' && !act) {
    if (!IMPORT_COLUMNS[type]) boom(404, '该对象不支持导入');
    if (m === 'GET') { const t = importTemplate(u, type); return sendCSV(res, `${type}_import_template.csv`, t.headers, t.rows); }
    if (m === 'POST') {
      if (!canWrite(u)) boom(403, '无导入权限');
      const b = await readBody(req, 6 * 1024 * 1024);
      return send(res, 200, importRecords(u, type, b, b.commit === true));
    }
  }

  // 批量操作：POST /api/{type}/batch {ids, action:'delete'|'assign', owner}
  if (recordId === 'batch' && !act && m === 'POST') {
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 500) : [];
    if (!ids.length) boom(400, '请选择记录');
    const done = [], failed = [];
    if (b.action === 'delete') {
      if (!canDelete(u)) boom(403, '仅经理或管理员可删除');
      transaction(() => {
        for (const key of ids) {
          if (!getVisible(u, type, key)) { failed.push({ id: key, error: '记录不存在' }); continue; }
          const why = deleteBlocker(u, type, key);
          if (why) { failed.push({ id: key, error: why }); continue; }
          softDelete(u, type, key); done.push(key);
        }
      });
    } else if (b.action === 'assign') {
      if (!canWrite(u)) boom(403, '无编辑权限');
      if (!TABLES[type].fields.includes('ownerId')) boom(400, '该对象不支持分配负责人');
      const target = b.ownerId ? findUser(u, { id: String(b.ownerId) }) : b.owner ? findUser(u, { name: String(b.owner) }) : undefined;
      if (!target) boom(400, '请选择有效的负责人');
      assertCanAssign(u, target);
      const owner = target.display_name;
      transaction(() => {
        for (const key of ids) {
          const old = getVisible(u, type, key);
          if (!old) { failed.push({ id: key, error: '记录不存在' }); continue; }
          const before = row(old), data = { ...before, owner, ownerId: target.id };
          if (type === 'leads' && before.status === '未联系') data.status = '已分配';
          updateRecord(u, key, data);
          audit(u, 'assign', type, key, { before: { owner: before.owner, ownerId: before.ownerId }, owner, ownerId: target.id });
          done.push(key);
        }
      });
      if (done.length && target.id !== u.id) notifyAssign(u, type, target.id, `${TABLES[type].label}分配`, [`${done.length} 条${TABLES[type].label}已分配给 ${owner}`, `操作人：${u.display_name}`], `#/${type}`);
    } else boom(400, '不支持的批量操作');
    return send(res, 200, { done, failed });
  }

  const old = getVisible(u, type, recordId);
  if (!old) boom(404, '记录不存在');

  if (act) {
    if (m === 'GET' && type === 'accounts' && act === 'overview') return send(res, 200, accountOverview(u, recordId));
    if (m !== 'POST') boom(404, '接口不存在');
    if (!canWrite(u)) boom(403, '无操作权限');

    if (type === 'leads' && act === 'convert') {
      const lead = row(old);
      if (lead.convertedAccountId) boom(409, '该线索已转化');
      const t = now();
      const account = sanitize('accounts', { name: lead.company || lead.name, phone: lead.phone || '', email: lead.email || '', owner: lead.owner || u.display_name, ownerId: lead.ownerId || u.id, source: lead.source || '' });
      const result = transaction(() => {
        const acc = insertRecord(u, 'accounts', account, t);
        let contactId = null;
        if (lead.company) contactId = insertRecord(u, 'contacts', sanitize('contacts', { name: lead.name, accountId: acc.id, phone: lead.phone || '', email: lead.email || '', isPrimary: true }), t).id;
        updateRecord(u, recordId, { ...lead, convertedAccountId: acc.id, status: '已转化' });
        audit(u, 'convert', 'leads', recordId, { accountId: acc.id, contactId });
        return { accountId: acc.id, contactId };
      });
      return send(res, 200, result);
    }

    if (type === 'opportunities' && act === 'contract') {
      const opp = row(old);
      if (childrenOf(u, 'contracts', 'opportunityId', recordId).some(c => c.status !== '已作废')) boom(409, '该商机已生成合同');
      if (opp.stage === '输单') boom(409, '输单商机不能转合同');
      const result = transaction(() => {
        const data = sanitize('contracts', { name: opp.name, accountId: opp.accountId, opportunityId: recordId, amount: opp.amount || 0, owner: opp.owner || u.display_name, ownerId: opp.ownerId || u.id });
        data.number = nextContractNumber(u);
        const c = insertRecord(u, 'contracts', data);
        updateRecord(u, recordId, { ...opp, stage: '赢单', probability: 100 });
        audit(u, 'create', 'contracts', c.id, { fromOpportunity: recordId });
        audit(u, 'update', 'opportunities', recordId, { before: opp });
        return c;
      });
      return send(res, 201, { item: result });
    }

    if (type === 'contracts' && act === 'submit') {
      const c = row(old);
      if (c.status !== '草稿') boom(409, '仅草稿合同可以提交审批');
      startApproval(u, c);
      transaction(() => { updateRecord(u, recordId, c); audit(u, 'submit', 'contracts', recordId); });
      notifyApprovalPending(u, c);
      return send(res, 200, { ok: true, levels: c.approvalLevels });
    }
    if (type === 'contracts' && act === 'approve') {
      const c = row(old), b = await readBody(req);
      if (c.status !== '审批中') boom(409, '合同不在审批中');
      if (!canApprove(u, c)) boom(403, c.submittedBy === u.id ? '不能审批自己提交的合同' : `当前节点「${currentLevel(c)?.name || '审批'}」无权审批`);
      const approved = b.approved === true, note = String(b.note || '').slice(0, 500);
      const level = currentLevel(c)?.name || '审批';
      const history = [...(c.approvalHistory || []), { action: approved ? 'approve' : 'reject', level, by: u.id, byName: u.display_name, note, at: now() }].slice(-50);
      let next, final = false;
      if (!approved) next = { ...c, status: '草稿', approvalStep: 0, approvalNote: note, approvalHistory: history };
      else {
        const step = (c.approvalStep || 0) + 1;
        final = step >= (c.approvalLevels || []).length;
        next = { ...c, approvalStep: step, approvalNote: note, approvalHistory: history, ...(final ? { status: '已签订', signedAt: c.signedAt || ymd(new Date()) } : {}) };
      }
      transaction(() => { updateRecord(u, recordId, next); audit(u, approved ? 'approve' : 'reject', 'contracts', recordId, { note, level, final }); });
      if (approved && !final) notifyApprovalPending(u, next);
      else {
        const title = approved ? '合同审批通过' : '合同被驳回';
        const lines = [`${c.number} ${c.name}`, `金额：¥${Number(c.amount).toLocaleString('zh-CN')}`, `审批人：${u.display_name}（${level}）`, ...(note ? [`意见：${note}`] : [])];
        notifyWebhook(u, 'approval', title, lines);
        notifyUsers(u, 'approval', [c.submittedBy, c.ownerId].filter(id => id !== u.id), title, lines, `#/contracts?q=${encodeURIComponent(c.number || '')}`);
      }
      return send(res, 200, { ok: true, status: next.status, pending: approved && !final ? currentLevel(next) : null });
    }
    boom(404, '接口不存在');
  }

  if (m === 'GET') return send(res, 200, { item: decorate(u, [row(old)])[0] });
  if (m === 'PATCH') {
    if (!canWrite(u)) boom(403, '无编辑权限');
    if (type === 'payments') boom(403, '回款不可修改，请删除错误登记后重建');
    const submitted = await readBody(req);
    if (type === 'leads' && Object.hasOwn(submitted, 'convertedAccountId')) boom(400, '不能自行设置转换关联');
    const before = row(old);
    const existing = { ...before }; for (const k of ['id', 'createdAt', 'updatedAt', 'createdBy']) delete existing[k];
    const data = sanitize(type, submitted, existing, u);
    resolveOwner(u, type, data, submitted, before);
    const submitNow = type === 'contracts' && guardContractStatus(u, before, data) === 'submit';
    validRefs(u, type, data, recordId);
    if (submitNow) startApproval(u, data);
    if (type === 'contracts' && before.status === '审批中' && data.status === '草稿') data.approvalHistory = [...(data.approvalHistory || []), { action: 'withdraw', by: u.id, byName: u.display_name, at: now() }];
    transaction(() => {
      updateRecord(u, recordId, data); audit(u, 'update', type, recordId, { before });
      if (submitNow) audit(u, 'submit', 'contracts', recordId);
      if (data.ownerId && data.ownerId !== before.ownerId && data.ownerId !== u.id) audit(u, 'assign', type, recordId, { ownerId: data.ownerId, owner: data.owner });
    });
    if (submitNow) notifyApprovalPending(u, { id: recordId, ...data });
    if (data.ownerId && data.ownerId !== before.ownerId && data.ownerId !== u.id) notifyAssign(u, type, data.ownerId, `${TABLES[type].label}分配`, [`${data.name || data.title || ''} 已分配给 ${data.owner}`, `操作人：${u.display_name}`], type === 'accounts' ? `#/accounts/${recordId}` : type === 'opportunities' ? `#/opportunities/${recordId}` : `#/${type}`);
    resetScope(u);
    return send(res, 200, { item: row(getRecord(u, type, recordId)) });
  }
  if (m === 'DELETE') {
    if (!canDelete(u)) boom(403, '仅经理或管理员可删除');
    const why = deleteBlocker(u, type, recordId);
    if (why) boom(409, why);
    softDelete(u, type, recordId);
    return send(res, 200, { ok: true });
  }
  boom(405, '不支持的操作');
}

module.exports = { recordRoutes };
