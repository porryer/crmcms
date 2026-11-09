'use strict';
/** 免登录接口：健康检查、单点登录、账号密码登录 */
const backups = require('../../lib/backup');
const TOTP = require('../../lib/totp');
const { DATA_DIR, VERSION } = require('../config');
const { db } = require('../db');
const { boom, now } = require('../util');
const { audit } = require('../store');
const { publicUser } = require('../scope');
const { getSettings, publicSettings } = require('../settings');
const { DUMMY_HASH, LOGIN_MAX_PER_ACCOUNT, LOGIN_MAX_PER_IP, clearLoginFailures, clientIp, createSession, loginBlocked, recordLoginFailure, verifyPwd } = require('../auth');
const { NEXT, readBody, send } = require('../http');
const { dingtalkInApp, enabledProviders, imCallback, imStart, ssoCallback, ssoStart, ssoTenantId } = require('../sso');

async function publicRoutes(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/health') {
    // 数据库可读 + 可获取写锁（磁盘只读/满、文件损坏时返回 503，供容器健康检查与监控告警使用）
    let dbOk = true;
    try { db.prepare('SELECT 1').get(); db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); } catch { dbOk = false; }
    const last = backups.listBackups(DATA_DIR)[0];
    return send(res, dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'degraded', version: VERSION, storage: 'sqlite', db: dbOk ? 'ok' : 'error', uptimeSec: Math.round(process.uptime()), lastBackupAt: last?.createdAt || null });
  }

  if (p === '/api/sso/config' && m === 'GET') {
    const st = getSettings(ssoTenantId()), providers = enabledProviders(st);
    return send(res, 200, {
      enabled: !!st.sso.enabled, buttonText: st.sso.buttonText || '企业账号登录', enforce: !!st.sso.enforce && providers.length > 0, providers,
      // 钉钉客户端内免登所需的公开参数（非密钥）
      ...(st.dingtalk.enabled ? { dingtalk: { corpId: st.dingtalk.corpId, clientId: st.dingtalk.clientId } } : {}),
      ...(st.wecom.enabled ? { wecom: { inApp: true } } : {}),
    });
  }
  const imMatch = p.match(/^\/api\/sso\/(wecom|dingtalk)\/(start|callback)$/);
  if (p === '/api/sso/dingtalk/inapp' && m === 'POST') return dingtalkInApp(req, res);
  if (imMatch && m === 'GET') return imMatch[2] === 'start' ? imStart(req, res, url, imMatch[1]) : imCallback(req, res, url, imMatch[1]);
  if (p === '/api/sso/start' && m === 'GET') return ssoStart(req, res, url);
  if (p === '/api/sso/callback' && m === 'GET') return ssoCallback(req, res, url);

  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
    const ip = clientIp(req);
    const keys = [[`acct:${email}`, LOGIN_MAX_PER_ACCOUNT], [`ip:${ip}`, LOGIN_MAX_PER_IP]];
    if (loginBlocked(keys)) boom(429, '登录失败次数过多，请 15 分钟后再试');
    const candidates = db.prepare('SELECT * FROM users WHERE email=? AND active=1').all(email);
    // 账号不存在时也计算一次散列，避免通过响应时间判断账号是否存在
    if (!candidates.length) verifyPwd(String(b.password || ''), DUMMY_HASH);
    const found = candidates.find(x => verifyPwd(String(b.password || ''), x.password_hash));
    if (!found) { recordLoginFailure(keys); boom(401, '邮箱或密码错误'); }
    const tst = getSettings(found.tenant_id), provs = enabledProviders(tst);
    if (tst.sso.enforce && provs.length && found.role !== 'admin') boom(403, `本企业已启用单点登录，请使用${provs.map(x => `“${x.text}”`).join('或')}登录`);
    if (found.totp_enabled) {
      // 密码正确但未提供动态码：提示前端进入第二步，不计失败
      if (!b.otp) return send(res, 401, { error: '请输入身份验证器中的 6 位动态码', mfaRequired: true });
      const s2 = TOTP.verify(found.totp_secret, b.otp);
      if (s2 < 0 || s2 <= found.totp_last_step) { recordLoginFailure(keys); return send(res, 401, { error: '动态码错误或已使用', mfaRequired: true }); }
      db.prepare('UPDATE users SET totp_last_step=? WHERE id=?').run(s2, found.id);
    }
    clearLoginFailures(`acct:${email}`);
    createSession(found, res);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), found.id);
    audit(found, 'login', 'session', found.id);
    return send(res, 200, { user: publicUser(found), settings: publicSettings(found) });
  }
  return NEXT;
}

module.exports = { publicRoutes };
