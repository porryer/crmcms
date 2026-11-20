# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
发布流程见 [docs/RELEASE.md](docs/RELEASE.md)；各版本的设计说明与验证记录见 [docs/REVIEW_V1.1.md](docs/REVIEW_V1.1.md)。

## [Unreleased]

### 新增
- `LICENSE`：专有软件许可（保留所有权利）；`package.json` 标注 `UNLICENSED`；`docs/THIRD_PARTY.md` 补充 dingtalk-jsapi 的 MIT 许可全文。

### 变更
- 发布流程中的 Docker 官方 Action 升级到基于 Node 24 的版本（setup-qemu / setup-buildx / login v4、metadata v6、build-push v7），消除 Node 20 停用警告。

## [1.7.1] - 2026-11-17

### 新增
- 发布流程：推送 `v*` 标签后自动校验版本号、运行全部测试，推送多架构镜像到 GHCR，并创建 GitHub Release（源码包、离线镜像包、SHA256 校验文件）。
- `compose.yaml` 支持通过 `CRM_IMAGE` 直接使用已发布的镜像，生产环境不必在服务器上构建。

### 变更
- Docker 基础镜像固定为 `node:22.23.5-bookworm-slim`；新增 `.dockerignore`。

## [1.7.0] - 2026-11-09

### 新增
- 会话有效期可通过 `SESSION_HOURS` 配置（1–720 小时）。
- CI 增加 ESLint 检查。

### 变更
- 前端由单文件 `public/app.js` 拆分为 `public/js/` 下 22 个 ES 模块，无构建步骤，CSP 不变。
- 服务端由单文件 `server.js` 拆分为 `src/` 模块与分组路由。

## [1.6.0] - 2026-11-09

### 新增
- 企业微信 / 钉钉个人工作通知；通知链接登录后直达原页面。
- SMTP 加密通道（SSL / STARTTLS）测试。

### 安全
- 安全自查修复（详见 REVIEW 第八节）。

## [1.5.0] - 2026-11-09

### 新增
- 钉钉客户端内免登。

## [1.4.0] - 2026-11-09

### 新增
- 企业微信 / 钉钉扫码登录、客户端内免登、个人菜单自助绑定。

### 安全
- 修复超限上传导致服务进程崩溃。

## [1.3.0] - 2026-11-09

### 新增
- 附件纳入备份与恢复、Excel（.xlsx）导入导出、邮件通知（SMTP）、两步验证二维码、OIDC 单点登录。

### 修复
- 两步验证启用弹窗缺陷；测试端口冲突与超限上传连接重置。

## [1.2.0] - 2026-11-09

### 新增
- 行级数据权限、金额改为整数分存储、定时备份、HTTPS 部署。
- 批量导入、附件、对账单、自定义字段、站内通知、多级审批、两步验证。
- 大数据量查询优化、可观测性、E2E 测试与 CI。

### 修复
- 表单枚举空值导致新建商机失败。

## [1.1.0] - 2026-11-09

### 变更
- 对照原型完成代码审查与功能补全（详见 REVIEW 第一至四节）。

[Unreleased]: https://github.com/porryer/crmcms/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/porryer/crmcms/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/porryer/crmcms/releases/tag/v1.7.0
