# NovaCRM · 可离线运行的 Web CRM

零依赖（Node.js 22 内置 `node:sqlite`）、严格 CSP、可内网离线部署的客户关系管理系统。当前版本 **1.7.x**，版本与下载见 [GitHub Releases](https://github.com/porryer/crmcms/releases)。

![工作台](docs/screenshots/01-dashboard.png)

## 版本记录

| 版本 | 内容 | 详细说明 |
|---|---|---|
| V1.7.1 | 发布流程：打标签自动推送 GHCR 镜像（amd64 / arm64）并创建 Release（源码包、离线镜像包）；基础镜像固定版本 | [CHANGELOG](CHANGELOG.md)、[docs/RELEASE.md](docs/RELEASE.md) |
| V1.7 | 会话有效期可配置（`SESSION_HOURS`）、CI 增加 ESLint、前端拆分为 ES 模块 | REVIEW 第十一节 |
| V1.6 | 企业微信 / 钉钉个人工作通知、通知链接登录后直达原页面、安全自查修复；SMTP 加密通道测试 | REVIEW 第八、九节 |
| V1.5 | 钉钉客户端内免登 | REVIEW 第七节 |
| V1.4 | 企业微信 / 钉钉扫码登录、客户端内免登、个人菜单自助绑定 | REVIEW 第七节 |
| V1.3 | 附件纳入备份、Excel 导入导出、邮件通知、两步验证二维码、OIDC 单点登录 | REVIEW 第六节 |
| V1.2 | 行级数据权限、整数分金额、定时备份、HTTPS 部署、导入 / 附件 / 对账 / 自定义字段 / 通知 / 多级审批、两步验证、E2E 与 CI | REVIEW 第五节 |
| V1.1 | 对照原型的代码审查与功能补全 | REVIEW 第一至四节 |

审查报告与各版本明细：[docs/REVIEW_V1.1.md](docs/REVIEW_V1.1.md)；部署运维：[docs/DEPLOY.md](docs/DEPLOY.md)；第三方组件：[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md)。

## 运行条件

- Node.js **22.13+**；Windows / macOS / Linux 均可。
- 不需要 `npm install`、第三方 CDN 或外部数据库。

```bash
node server.js
```

打开 <http://localhost:3100>。首次启动时终端显示管理员邮箱与**一次性生成**的初始密码，登录后请立即修改。生产环境建议首次安装前设置 `CRM_ADMIN_PASSWORD`（12 位以上，仅在第一次建库时使用）。

## Docker

```bash
cp .env.example .env    # 修改为你自己的强密码；生产环境设置 CRM_IMAGE 使用已发布镜像
docker compose up -d --build   # 已设置 CRM_IMAGE 时改用：docker compose pull crm && docker compose up -d
docker compose logs crm # 查看首次启动信息
```

默认只监听宿主机 `127.0.0.1:3100`。对外开放请使用 `compose.https.yaml`（Caddy 自动证书），见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 功能

- **销售业务**：工作台（KPI、趋势、漏斗、待办）、线索（分配、转客户）、客户与客户详情、联系人、商机看板（拖拽变更阶段、转合同）、合同（自动编号、多级审批）、财务回款（回款计划、应收、对账单）、跟进任务、数据报表、全局搜索。
- **数据**：批量导入（Excel / CSV，逐行预检）、导出 Excel / CSV（防公式注入）、附件（白名单与大小限制）、自定义字段、数据字典。
- **权限**：角色 `admin` / `manager` / `sales` / `viewer`；按成员设定数据范围（本人 / 本部门 / 全部），作用于列表、详情、统计、搜索、导出、附件、对账与通知；多租户隔离。
- **登录与安全**：scrypt 密码散列、密码复杂度、登录防爆破（持久化）、TOTP 两步验证（二维码）、OIDC 单点登录、企业微信 / 钉钉扫码与客户端内免登、强制第三方登录；HttpOnly + SameSite 会话、Origin 校验、严格 CSP、审计日志。
- **通知**：站内通知；邮件（SMTP，SSL / STARTTLS，始终校验证书）；企业微信应用消息 / 钉钉工作通知；群机器人 Webhook；每日待办摘要。
- **运维**：定时一致性快照（含附件增量文件池）与恢复脚本、JSON 访问日志与请求 ID、健康检查（数据库可写、最近备份时间）、启动时自动幂等迁移。
- **移动端**：≤900px 抽屉侧栏 + 底部标签栏。

## 测试

```bash
npm run check   # 语法检查
npm run lint    # ESLint（需先临时安装，见下）
npm test        # API 集成测试（自动启动隔离数据库与服务）
npm run e2e     # 浏览器端到端测试（需 Playwright + Chromium）
```

ESLint 不作为项目依赖，运行前临时安装（不写入 package.json）：

```bash
npm install --no-save --no-package-lock eslint@9.39.4 @eslint/js@9.39.4 globals@16.5.0
```

GitHub Actions（`.github/workflows/ci.yml`）在每次推送时运行以上各项并构建 Docker 镜像；推送 `v*` 标签时由 `release.yml` 发布版本，见 [docs/RELEASE.md](docs/RELEASE.md)。

演示数据（仅演示环境，服务启动后执行）：

```bash
CRM_URL=http://localhost:3100 CRM_PASSWORD=你的管理员密码 npm run seed
```

## 项目结构

| 路径 | 内容 |
|---|---|
| `server.js` | 入口：初始化数据、启动服务、定时摘要与备份 |
| `src/` | 服务端模块：`config` 配置、`db` 表结构、`constants` 业务字典、`auth` 密码与会话、`scope` 数据权限、`settings` 系统设置、`records` 校验与审批、`query` 列表与搜索、`stats` 统计与对账、`notify` 通知、`sso` 第三方登录、`attachments` 附件、`importer` 导入、`users` 成员、`app` HTTP 服务 |
| `src/routes/` | API 路由，按 `public`（免登录）→ `account` → `settings` → `data` → `admin` → `records`（通用实体）顺序匹配 |
| `lib/` | SMTP、OIDC、企业微信、钉钉、TOTP、二维码、xlsx、CSV、备份 |
| `public/` | 单页前端：`index.html`、`style.css`、精简的钉钉 JSAPI（`vendor/`） |
| `public/js/` | 前端 ES 模块（无构建，浏览器直接加载）：`main` 入口、`constants` 字典与表单/列定义、`state` 当前用户与设置、`util` 工具与请求、`router` 路由、`login` 登录与免登、`shell` 布局、`list` 通用列表、`forms` 表单弹窗、`files` 附件与导入、`charts` 图表、`actions` 事件委托、`pages/` 各页面 |
| `scripts/` | `backup.js`、`restore.js`、`seed.js` |
| `tests/` | API 集成测试；`tests/e2e/` 浏览器测试 |
| `docs/` | PRD、验收、审查报告、部署、第三方许可、截图 |

## 已知边界

- 架构为单进程 Node + SQLite（数据库文件、定时备份与通知均在进程内），只能单实例运行；实测 6 万条记录下分页列表 60–100ms。需要多实例或更大规模时应迁移至 PostgreSQL。
- 前端为无构建的原生 JS（约 1600 行，按功能拆为 22 个 ES 模块），未迁移 React（决策说明见 REVIEW 第五节第 12 项）。
- OIDC、企业微信、钉钉已按官方文档实现，并在模拟服务上完成测试，**尚未与真实租户联调**。
- 未提供：短信通知、SaaS 租户自助注册与计费、字段级权限、AI 辅助功能；未进行第三方渗透测试。
