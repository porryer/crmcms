'use strict';
/** 附件上传、下载与删除 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./config');
const { db } = require('./db');
const { boom, httpError, newId, now } = require('./util');
const { audit } = require('./store');
const { canDelete, canWrite, getVisible } = require('./scope');
const { send, sendFileStream } = require('./http');

// ---------- 附件 ----------
const ATTACH_ENTITIES = ['accounts', 'opportunities', 'contracts', 'leads'];
const ATTACH_EXT = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip' };
const ATTACH_MAX = Number(process.env.ATTACH_MAX_MB || 20) * 1024 * 1024;
const fileDir = tenantId => path.join(DATA_DIR, 'files', tenantId);
/** 流式写入请求体到文件并计算 sha256，超过 max 则中止 */
function receiveFile(req, dest, max) {
  return new Promise((resolve, reject) => {
    // 先写临时文件，完整接收后原子改名（备份只复制正式文件名，避免收录半截文件）
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const out = fs.createWriteStream(tmp, { flags: 'wx' });
    // 必须监听 error：超限时主动 destroy 会让未完成的写入报错，无监听器将导致进程崩溃
    out.on('error', e => { if (!failed) finish(e); });
    const hash = crypto.createHash('sha256'); let size = 0, failed = null, settled = false;
    const finish = (err, val) => { if (settled) return; settled = true; if (err) { out.destroy(); fs.rm(tmp, { force: true }, () => {}); reject(err); } else resolve(val); };
    const tooBig = () => httpError(413, `文件不能超过 ${Math.round(max / 1048576)}MB`);
    // 超限后继续读完请求体再响应（最多再读 64MB），否则客户端可能收到连接重置而非 413
    if (Number(req.headers['content-length']) > max + 64 * 1048576) { finish(tooBig()); req.destroy(); return; }
    req.on('data', chunk => {
      size += chunk.length;
      if (failed) { if (size > max + 64 * 1048576) { req.destroy(); finish(failed); } return; }
      if (size > max) { failed = tooBig(); out.destroy(); return; }
      hash.update(chunk);
      if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => {
      if (failed) return finish(failed);
      out.end(() => {
        if (!size) return finish(httpError(400, '文件为空'));
        try { fs.renameSync(tmp, dest); } catch (e) { return finish(e); }
        finish(null, { size, sha256: hash.digest('hex') });
      });
    });
    req.on('error', e => finish(failed || e));
  });
}
function fileName(req) {
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { boom(400, '文件名编码错误'); }
  name = path.basename(name).replace(/[\x00-\x1f"\\/]/g, '').slice(0, 200).trim();
  if (!name) boom(400, '缺少文件名');
  return name;
}
const attachRow = a => ({ id: a.id, entity: a.entity, entityId: a.entity_id, name: a.name, mime: a.mime, size: a.size, createdBy: a.created_by, createdByName: a.by_name, createdAt: a.created_at });
async function attachmentsApi(u, req, res, url, attId, sub) {
  const m = req.method;
  if (!attId && m === 'GET') {
    const entity = url.searchParams.get('entity'), entityId = url.searchParams.get('entityId');
    if (!ATTACH_ENTITIES.includes(entity) || !getVisible(u, entity, entityId)) boom(404, '记录不存在');
    const items = db.prepare('SELECT a.*,x.display_name by_name FROM attachments a LEFT JOIN users x ON x.id=a.created_by WHERE a.tenant_id=? AND a.entity=? AND a.entity_id=? AND a.deleted=0 ORDER BY a.created_at DESC').all(u.tenant_id, entity, entityId);
    return send(res, 200, { items: items.map(attachRow) });
  }
  if (!attId && m === 'POST') {
    if (!canWrite(u)) boom(403, '无上传权限');
    const entity = url.searchParams.get('entity'), entityId = url.searchParams.get('entityId');
    if (!ATTACH_ENTITIES.includes(entity) || !getVisible(u, entity, entityId)) boom(404, '记录不存在');
    const name = fileName(req), ext = path.extname(name).slice(1).toLowerCase();
    if (!ATTACH_EXT[ext]) boom(415, `不支持的文件类型：${ext || '无扩展名'}（允许 ${Object.keys(ATTACH_EXT).join('/')}）`);
    const aid = newId(), dest = path.join(fileDir(u.tenant_id), aid);
    const { size, sha256 } = await receiveFile(req, dest, ATTACH_MAX);
    db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?,?,0)').run(aid, u.tenant_id, entity, entityId, name, ATTACH_EXT[ext], size, sha256, u.id, now());
    audit(u, 'upload', entity, entityId, { attachmentId: aid, name, size });
    return send(res, 201, { item: { id: aid, name, size, mime: ATTACH_EXT[ext] } });
  }
  const a = attId && db.prepare('SELECT * FROM attachments WHERE id=? AND tenant_id=? AND deleted=0').get(attId, u.tenant_id);
  if (!a || !getVisible(u, a.entity, a.entity_id)) boom(404, '附件不存在');
  if (m === 'GET' && sub === 'download') {
    const file = path.join(fileDir(u.tenant_id), a.id);
    if (!fs.existsSync(file)) boom(410, '附件文件已丢失');
    res.writeHead(200, {
      'Content-Type': a.mime.startsWith('image/') && a.mime !== 'image/svg+xml' ? a.mime : 'application/octet-stream', 'Content-Length': a.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store',
    });
    return sendFileStream(res, file);
  }
  if (m === 'DELETE' && !sub) {
    if (!canDelete(u) && a.created_by !== u.id) boom(403, '仅上传人、经理或管理员可删除附件');
    db.prepare('UPDATE attachments SET deleted=1 WHERE id=?').run(a.id);
    fs.rm(path.join(fileDir(u.tenant_id), a.id), { force: true }, () => {});
    audit(u, 'delete', 'attachments', a.id, { name: a.name, entity: a.entity, entityId: a.entity_id });
    return send(res, 200, { ok: true });
  }
  boom(405, '不支持的操作');
}

module.exports = { attachmentsApi, fileDir, receiveFile };
