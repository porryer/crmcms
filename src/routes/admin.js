'use strict';
/** 成员、审计日志、备份 */
const path = require('node:path');
const backups = require('../../lib/backup');
const { BACKUP_INTERVAL_HOURS, BACKUP_KEEP, DATA_DIR } = require('../config');
const { db } = require('../db');
const { boom } = require('../util');
const { audit } = require('../store');
const { canManage, scopeOwners } = require('../scope');
const { NEXT, send } = require('../http');
const { createUser, listUsers, updateUser } = require('../users');

async function adminRoutes(req, res, url, u) {
  const p = url.pathname, m = req.method;
  const userMatch = p.match(/^\/api\/users(?:\/([^/]+))?$/);
  if (userMatch) {
    if (!userMatch[1] && m === 'GET') return send(res, 200, { items: listUsers(u) });
    if (!userMatch[1] && m === 'POST') return send(res, 201, await createUser(u, req));
    if (userMatch[1] && m === 'PATCH') return send(res, 200, await updateUser(u, req, userMatch[1]));
    boom(405, '不支持的操作');
  }
  if (p === '/api/audits' && m === 'GET') {
    if (!canManage(u)) boom(403, '无审计查看权限');
    const entity = url.searchParams.get('entity'), owners = scopeOwners(u);
    // 数据范围受限的经理只能看到范围内成员的操作记录
    const items = db.prepare(`SELECT a.*,u.display_name user_name FROM audits a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ${entity ? 'AND a.entity=?' : ''} ${owners ? `AND a.user_id IN (${[...owners].map(() => '?').join(',')})` : ''} ORDER BY a.at DESC LIMIT 300`)
      .all(u.tenant_id, ...(entity ? [entity] : []), ...(owners ? [...owners] : []));
    return send(res, 200, { items });
  }
  if (p === '/api/backups') {
    if (u.role !== 'admin') boom(403, '仅管理员可管理备份');
    if (m === 'GET') return send(res, 200, { items: backups.listBackups(DATA_DIR), schedule: { intervalHours: BACKUP_INTERVAL_HOURS, keep: BACKUP_KEEP } });
    if (m === 'POST') { const file = backups.backup(db, DATA_DIR, BACKUP_KEEP); audit(u, 'backup', 'system', path.basename(file)); return send(res, 201, { name: path.basename(file) }); }
  }
  return NEXT;
}

module.exports = { adminRoutes };
