'use strict';
/** API 路由入口：先匹配免登录接口，再鉴权后依次交给各组路由 */
const { boom } = require('../util');
const { authenticate } = require('../auth');
const { NEXT } = require('../http');
const { publicRoutes } = require('./public');
const { accountRoutes } = require('./account');
const { settingsRoutes } = require('./settings');
const { dataRoutes } = require('./data');
const { adminRoutes } = require('./admin');
const { recordRoutes } = require('./records');

async function api(req, res, url) {
  res.exportFormat = url.searchParams.get('format');
  if (await publicRoutes(req, res, url) !== NEXT) return;

  const u = authenticate(req);
  if (!u) boom(401, '请先登录');
  req.uid = u.id;

  for (const routes of [accountRoutes, settingsRoutes, dataRoutes, adminRoutes]) {
    if (await routes(req, res, url, u) !== NEXT) return;
  }
  return recordRoutes(req, res, url, u);
}

module.exports = { api };
