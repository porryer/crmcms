'use strict';
/**
 * 演示数据：通过 HTTP API 写入（走完整校验与审计）。仅用于演示/验收环境，勿在生产库执行。
 * 用法：CRM_URL=http://localhost:3100 CRM_EMAIL=admin@local.crm CRM_PASSWORD=xxx npm run seed
 */
const BASE = (process.env.CRM_URL || 'http://localhost:3100').replace(/\/$/, '');
const EMAIL = process.env.CRM_EMAIL || 'admin@local.crm';
const PASSWORD = process.env.CRM_PASSWORD;
if (!PASSWORD) { console.error('请设置 CRM_PASSWORD 环境变量'); process.exit(1); }

let cookie = '';
async function call(path, method = 'GET', body) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${data.error}`);
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  return data;
}
const pad = n => String(n).padStart(2, '0');
const day = (offsetDays, base = new Date()) => { const d = new Date(base); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthDay = (m, d) => `${new Date().getFullYear()}-${pad(m)}-${pad(d)}`;

(async () => {
  await call('/login', 'POST', { email: EMAIL, password: PASSWORD });
  const existing = await call('/accounts');
  if (existing.items.length) { console.log('已有客户数据，跳过演示数据写入。'); return; }

  const team = [['张明', 'zhangming', 'sales', '销售部'], ['李娜', 'lina', 'sales', '销售部'], ['王强', 'wangqiang', 'manager', '销售部'], ['陈浩', 'chenhao', 'sales', '客户部'], ['刘洋', 'liuyang', 'sales', '市场部']];
  for (const [name, user, role, department] of team) {
    await call('/users', 'POST', { name, email: `${user}@demo.crm`, password: 'DemoPassword!2026', role, department }).catch(() => {});
  }
  const accounts = [
    ['华东科技有限公司', '科技/IT', 'VIP', '官网', '张明', '浙江省杭州市西湖区文三路 90 号'],
    ['星海文化传媒', '文化传媒', '重要', '广告', '李娜', '上海市徐汇区漕溪北路 18 号'],
    ['智联软件（北京）', '互联网/软件', '重要', '展会', '王强', '北京市海淀区中关村大街 1 号'],
    ['远景新能源', '能源', 'VIP', '转介绍', '陈浩', '江苏省无锡市新吴区'],
    ['蓝图建筑工程', '建筑工程', '普通', '电话', '刘洋', '广东省深圳市南山区'],
    ['恒信贸易', '其他', '普通', '公众号', '张明', '福建省厦门市思明区'],
    ['未来科技', '科技/IT', '重要', '官网', '李娜', '四川省成都市高新区'],
    ['创新网络', '互联网/软件', '普通', '广告', '王强', '湖北省武汉市洪山区'],
  ];
  const acc = [];
  for (const [name, industry, level, source, owner, address] of accounts) {
    acc.push((await call('/accounts', 'POST', { name, industry, level, source, owner, address, type: '企业客户', phone: '1380013' + String(8000 + acc.length).padStart(4, '0'), foundedAt: '2018-06-12' })).item);
  }
  const contactNames = ['张三', '李四', '王五', '赵六', '孙七', '周八', '吴九', '郑十'];
  for (const [i, a] of acc.entries()) await call('/contacts', 'POST', { name: contactNames[i], accountId: a.id, title: ['总经理', '采购经理', 'IT 总监', '运营总监'][i % 4], phone: '1390013' + String(8000 + i).padStart(4, '0'), isPrimary: true });

  const opps = [
    [0, '产品升级方案', 80000, '初步沟通', 20], [1, '品牌营销系统', 120000, '初步沟通', 20], [6, '智能客服项目', 200000, '初步沟通', 10],
    [3, '储能监控平台', 150000, '需求确认', 40], [4, '工地管理系统', 300000, '需求确认', 40],
    [6, '智能系统开发', 260000, '方案报价', 60], [7, '网络安全升级', 180000, '方案报价', 55],
    [2, '软件升级', 320000, '商务谈判', 75], [5, '供应链平台', 380000, '商务谈判', 70],
    [0, 'CRM 实施项目', 368000, '赢单', 100], [1, '内容中台', 128000, '赢单', 100], [2, '数据分析平台', 268000, '赢单', 100], [3, '运维服务', 180000, '赢单', 100],
  ];
  const oppIds = [];
  for (const [i, name, amount, stage, probability] of opps) oppIds.push((await call('/opportunities', 'POST', { name, accountId: acc[i].id, amount, stage, probability, owner: accounts[i][4], expectedDate: day(20 + oppIds.length * 3) })).item);

  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const contracts = [];
  for (const [k, m] of months.entries()) {
    if (m > new Date().getMonth() + 1) break;
    const a = acc[k % acc.length];
    const amount = 50000 + ((k * 37) % 9) * 25000;
    contracts.push((await call('/contracts', 'POST', { name: `${a.name.slice(0, 4)}年度服务合同`, accountId: a.id, amount, status: k % 5 === 4 ? '执行中' : '已签订', signedAt: monthDay(m, 5 + (k % 20)), owner: accounts[k % accounts.length][4] })).item);
  }
  for (const o of oppIds.slice(-4)) {
    const c = (await call('/contracts', 'POST', { name: o.name, accountId: o.accountId, opportunityId: o.id, amount: o.amount, status: '已签订', signedAt: day(-3 - contracts.length), owner: o.owner })).item;
    contracts.push(c);
  }
  await call('/contracts', 'POST', { name: '远景新能源二期', accountId: acc[3].id, amount: 220000, status: '审批中', owner: '陈浩' });
  await call('/contracts', 'POST', { name: '蓝图智慧工地', accountId: acc[4].id, amount: 90000, owner: '刘洋' });

  for (const [k, c] of contracts.entries()) {
    const ratio = [1, 0.6, 0.5, 0, 1, 0.3][k % 6];
    if (ratio > 0) await call('/payments', 'POST', { contractId: c.id, amount: Math.round(c.amount * ratio), paidAt: day(-(contracts.length - k) * 9), method: '银行转账' });
    if (ratio < 1) await call('/plans', 'POST', { contractId: c.id, amount: Math.round(c.amount * (1 - ratio)), dueDate: day(k % 2 ? 15 : -5) });
  }

  const leads = [['张三', '新锐科技', '官网', '跟进中'], ['李四', '海川物流', '广告', '已分配'], ['王五', '博远教育', '展会', '未联系'], ['赵六', '康宁医疗', '转介绍', '跟进中'], ['孙七', '天和地产', '电话', '已失效'], ['周八', '云帆数据', '公众号', '未联系']];
  for (const [i, [name, company, source, status]] of leads.entries()) await call('/leads', 'POST', { name, company, source, status, phone: '1370013' + String(8000 + i).padStart(4, '0'), owner: team[i % team.length][0] });

  const acts = [
    [0, '电话', '沟通产品升级方案，客户意向明确，下周安排演示。', '有效跟进', 0], [1, '会议', '发送产品介绍资料，并约定下周演示。', '安排演示', 0],
    [2, '微信', '报价方案已发送，客户正在内部评估。', '待反馈', -1], [3, '电话', '合同条款初步沟通，建议下次确认细节。', '持续跟进', -1], [4, '邮件', '方案已确认，准备进入合同签署阶段。', '推进中', -2],
  ];
  for (const [i, type, content, result, off] of acts) await call('/activities', 'POST', { accountId: acc[i].id, type, content, result, occurredAt: `${day(off)}T${pad(9 + i * 2)}:${pad(10 + i * 7)}`, owner: accounts[i][4] });

  const tasks = [['跟进“华东科技有限公司”的方案反馈', 0, 0, '高'], ['准备“星海文化传媒”的产品演示材料', 1, 0, '中'], ['“远景新能源”合同签署与回款确认', 3, 2, '高'], ['整理本月销售报表并提交', null, 3, '中'], ['下周客户拜访计划与行程安排', null, 4, '低'], ['回访“蓝图建筑工程”', 4, -2, '中']];
  for (const [title, i, off, priority] of tasks) await call('/tasks', 'POST', { title, accountId: i === null ? '' : acc[i].id, dueDate: day(off), priority, owner: '系统管理员' });
  console.log('演示数据写入完成。演示成员初始密码：DemoPassword!2026');
})().catch(e => { console.error(e.message); process.exit(1); });
