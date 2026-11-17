# 发布流程

## 版本号

遵循语义化版本：修复为补丁号（1.7.1），新增功能为次版本号（1.8.0），不兼容变更（如需人工迁移数据）为主版本号。
预发布使用 `-rc.N` 后缀（如 `v1.8.0-rc.1`），会被标记为 GitHub 预发布，且不更新镜像的 `latest` 标签。

## 发布步骤

1. 在开发分支上同时修改三处版本号，并合并到 `main`：
   - `package.json` 的 `version`
   - `src/config.js` 的 `VERSION`
   - `CHANGELOG.md`：把 `[Unreleased]` 下的条目移到新的 `## [X.Y.Z] - 日期` 段落，并更新文末链接
2. 本地自检（可选）：

   ```bash
   npm run release:check -- vX.Y.Z
   ```

3. 确认 `main` 的 CI 通过后打标签并推送：

   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "NovaCRM X.Y.Z"
   git push origin vX.Y.Z
   ```

4. `.github/workflows/release.yml` 自动执行：版本一致性校验 → 完整 CI（语法、ESLint、API 测试、E2E、镜像构建）→ 推送镜像 → 创建 Release。任何一步失败都不会产生 Release。

## 发布产物

| 产物 | 位置 |
|---|---|
| 镜像（linux/amd64、linux/arm64） | `ghcr.io/porryer/crmcms:X.Y.Z`、`:X.Y`、`:latest`（仅正式版） |
| 源码包 | Release 附件 `novacrm-X.Y.Z.tar.gz` |
| 离线镜像包 | Release 附件 `novacrm-X.Y.Z-image-amd64.tar.gz` / `-arm64.tar.gz`，内网用 `docker load -i` 导入 |
| 校验文件 | Release 附件 `SHA256SUMS.txt` |
| 更新说明 | 取自 `CHANGELOG.md` 对应段落，附部署命令 |

## 首次发布前的仓库设置

- GHCR 包首次推送后默认为私有。需要匿名拉取时，在 GitHub「Packages → crmcms → Package settings」中改为 Public；保持私有时，部署机需先 `docker login ghcr.io`（使用具有 `read:packages` 权限的令牌）。
- 仓库「Settings → Actions → General → Workflow permissions」保持默认即可，工作流在 job 级别声明了 `contents: write` 与 `packages: write`。

## 发布出错时

- 标签打错（版本不一致等）：校验阶段即失败，无产物。删除标签后修正重打：`git push origin :refs/tags/vX.Y.Z`。
- 已发布的版本有缺陷：不要覆盖原标签，修复后发布新的补丁版本。
