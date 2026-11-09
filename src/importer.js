'use strict';
/** 批量导入（CSV / Excel） */
const CSV = require('../lib/csv');
const XLSX = require('../lib/xlsx');
const { boom } = require('./util');
const { all, audit, transaction } = require('./store');
const { scoped } = require('./scope');
const { customFieldsOf } = require('./settings');
const { insertRecord, resolveOwner, sanitize, validRefs } = require('./records');

// ---------- 批量导入 ----------
const IMPORT_COLUMNS = {
  leads: { name: ['线索姓名', '姓名', '线索名称', 'name'], company: ['公司名称', '公司', 'company'], phone: ['手机号', '电话', '联系电话', 'phone'], email: ['邮箱', 'email'], source: ['线索来源', '来源', 'source'], status: ['状态', 'status'], owner: ['负责人', 'owner'], notes: ['备注', 'notes'] },
  accounts: { name: ['客户名称', '名称', 'name'], type: ['客户类型', '类型', 'type'], industry: ['所属行业', '行业', 'industry'], level: ['客户级别', '级别', 'level'], source: ['客户来源', '来源', 'source'], status: ['客户状态', '状态', 'status'], phone: ['联系电话', '电话', 'phone'], email: ['邮箱', 'email'], owner: ['负责人', 'owner'], address: ['地址', 'address'], foundedAt: ['成立时间', 'foundedAt'], notes: ['备注', 'notes'] },
  contacts: { name: ['姓名', '联系人', 'name'], account: ['所属客户', '客户名称', '客户', 'account'], title: ['职位', 'title'], phone: ['电话', '手机号', 'phone'], email: ['邮箱', 'email'], isPrimary: ['主联系人', 'isPrimary'], notes: ['备注', 'notes'] },
  opportunities: { name: ['商机名称', '名称', 'name'], account: ['客户名称', '客户', '所属客户', 'account'], amount: ['预计金额', '金额', 'amount'], probability: ['成交概率', '赢率', 'probability'], stage: ['商机阶段', '阶段', 'stage'], owner: ['负责人', 'owner'], expectedDate: ['预计成交日', '预计成交', 'expectedDate'], notes: ['备注', 'notes'] },
};
const IMPORT_EXAMPLE = {
  leads: { name: '张三', company: '示例科技有限公司', phone: '13800000000', source: '官网', status: '未联系' },
  accounts: { name: '示例科技有限公司', type: '企业客户', industry: '科技/IT', level: '重要', source: '官网', phone: '010-88886666', address: '北京市海淀区', foundedAt: '2018-06-12' },
  contacts: { name: '李四', account: '示例科技有限公司', title: '采购经理', phone: '13900000000', isPrimary: '是' },
  opportunities: { name: '年度采购项目', account: '示例科技有限公司', amount: '120000', probability: '40', stage: '需求确认', expectedDate: '2026-12-31' },
};
function importColumns(u, type) {
  const cols = Object.entries(IMPORT_COLUMNS[type]).map(([key, aliases]) => ({ key, aliases }));
  for (const f of customFieldsOf(u, type)) cols.push({ key: f.key, aliases: [f.label, f.key] });
  return cols;
}
function importTemplate(u, type) {
  const cols = importColumns(u, type);
  return { headers: cols.map(c => c.aliases[0]), rows: [cols.map(c => IMPORT_EXAMPLE[type][c.key] ?? '')] };
}
function importRecords(u, type, input, commit) {
  let rows;
  if (input.xlsx) {
    try { rows = XLSX.readRows(Buffer.from(String(input.xlsx), 'base64')); } catch (e) { boom(400, `无法读取 Excel 文件：${e.message}`); }
  } else rows = CSV.parse(String(input.csv || ''));
  if (rows.length < 2) boom(400, '文件中没有数据行（第一行须为表头）');
  if (rows.length > 5001) boom(400, '单次最多导入 5000 行');
  const cols = importColumns(u, type);
  const header = rows[0].map(h => String(h).trim().replace(/^[*＊]/, '').replace(/[（(].*?[)）]$/, '').trim());
  const mapping = header.map(h => cols.find(c => c.aliases.some(a => a.toLowerCase() === h.toLowerCase()))?.key || null);
  const unknown = header.filter((h, i) => h && !mapping[i]);
  if (!mapping.includes('name')) boom(400, `缺少必需列“${cols[0].aliases[0]}”。可识别的列：${cols.map(c => c.aliases[0]).join('、')}`);
  const accountsByName = new Map();
  if (['contacts', 'opportunities'].includes(type)) for (const a of scoped(u, 'accounts')) accountsByName.set(a.name, accountsByName.has(a.name) ? null : a.id);
  const existingNames = type === 'accounts' ? new Set(all(u, 'accounts').map(a => a.name)) : null;
  const errors = [], prepared = [], seen = new Set();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    try {
      const submitted = {};
      mapping.forEach((key, i) => { if (key) submitted[key] = String(r[i] ?? '').trim(); });
      for (const k of Object.keys(submitted)) if (submitted[k] === '' && k !== 'name') delete submitted[k];
      if (Object.hasOwn(submitted, 'account')) {
        const id = accountsByName.get(submitted.account);
        if (id === undefined) boom(400, `客户“${submitted.account}”不存在或无权访问`);
        if (id === null) boom(400, `存在多个名为“${submitted.account}”的客户，请手工录入`);
        submitted.accountId = id; delete submitted.account;
      }
      if (Object.hasOwn(submitted, 'isPrimary')) submitted.isPrimary = ['是', 'y', 'yes', 'true', '1'].includes(submitted.isPrimary.toLowerCase());
      if (Object.hasOwn(submitted, 'amount')) submitted.amount = submitted.amount.replace(/[,，¥￥\s]/g, '');
      if (Object.hasOwn(submitted, 'probability')) submitted.probability = submitted.probability.replace(/%$/, '');
      for (const k of ['foundedAt', 'expectedDate']) if (submitted[k]) submitted[k] = submitted[k].replace(/[/.]/g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
      const data = sanitize(type, submitted, {}, u);
      resolveOwner(u, type, data, submitted);
      validRefs(u, type, data);
      if (existingNames) {
        if (existingNames.has(data.name)) boom(409, `客户“${data.name}”已存在`);
        if (seen.has(data.name)) boom(409, `文件内客户“${data.name}”重复`);
        seen.add(data.name);
      }
      prepared.push(data);
    } catch (e) {
      if (!e.status) throw e;
      errors.push({ line, error: e.message });
    }
  });
  const result = { total: rows.length - 1, valid: prepared.length, errors: errors.slice(0, 200), errorCount: errors.length, ignoredColumns: unknown, imported: 0 };
  if (commit) {
    if (errors.length) boom(400, `存在 ${errors.length} 行错误，请修正后再导入`);
    transaction(() => { for (const d of prepared) insertRecord(u, type, d); audit(u, 'import', type, '*', { count: prepared.length }); });
    result.imported = prepared.length;
  }
  return result;
}

module.exports = { IMPORT_COLUMNS, importRecords, importTemplate };
