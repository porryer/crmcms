# NovaCRM 生产部署与运维

## 1. HTTPS 部署（推荐：Docker Compose + Caddy 自动证书）

前提：一台可公网访问 80/443 的 Linux 主机，域名 A 记录已指向该主机，Docker Compose ≥ 2.24（`!reset` 语法）。

```bash
cp .env.example .env
# 编辑 .env：CRM_ADMIN_PASSWORD（≥12位强密码）、CRM_DOMAIN（如 crm.example.com）
docker compose -f compose.yaml -f compose.https.yaml up -d --build
docker compose logs crm      # 首次启动信息
```

`compose.https.yaml` 会：
- 去掉 CRM 容器的宿主端口映射，只允许 Caddy 访问；
- 设置 `COOKIE_SECURE=1`（Cookie 仅 HTTPS 发送，且响应附带 HSTS）、`TRUST_PROXY=1`（登录限流按真实客户端 IP 统计）、`PUBLIC_ORIGIN=https://$CRM_DOMAIN`；
- 由 Caddy 自动申请并续期 Let's Encrypt 证书，上传上限 25MB。

使用自有 Nginx 时，等价配置要点：`proxy_pass http://127.0.0.1:3100;`、`proxy_set_header X-Forwarded-For $remote_addr;`、`client_max_body_size 25m;`，并在 CRM 环境变量中设置上述三项。

## 2. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3100 | 监听端口 |
| `DATA_DIR` | `./data` | 数据库、备份、附件目录 |
| `TZ` | 容器 `Asia/Shanghai` | 统计“本月/今天”的业务时区 |
| `CRM_ADMIN_EMAIL` / `CRM_ADMIN_PASSWORD` | — | 仅首次建库时使用 |
| `COOKIE_SECURE` | 0 | HTTPS 下设为 1 |
| `PUBLIC_ORIGIN` | — | 允许的站点来源，可逗号分隔多个 |
| `TRUST_PROXY` | 0 | 位于反向代理之后设为 1 |
| `BACKUP_INTERVAL_HOURS` | 24 | 自动备份间隔，0 关闭 |
| `BACKUP_KEEP` | 14 | 保留快照份数 |

## 3. 备份

- **自动**：服务每 `BACKUP_INTERVAL_HOURS` 小时生成一次 SQLite 一致性快照到 `DATA_DIR/backups/`，超出 `BACKUP_KEEP` 的旧快照自动删除；启动时若距最近一次超过间隔，1 分钟后补做一次。
- **手动**：管理员在“系统设置 → 安全与运维”点“立即备份”，或执行 `npm run backup`（Docker：`docker compose exec crm node scripts/backup.js`）。
- **附件**：每次备份把 `data/files/` 中新增的附件增量复制到 `backups/files/` 文件池（附件写入后不再修改，多份快照共享），清理旧快照时一并删除不再被引用的文件。
- **异地**：快照仍在同一磁盘/卷上，务必把整个 `backups/` 目录（快照 + `files/` 文件池）同步到异地（对象存储、NAS），例如每日 `rclone copy`。

## 4. 恢复演练（建议每季度一次）

```bash
docker compose stop crm
docker compose run --rm crm node scripts/restore.js /app/data/backups/<快照文件> --yes
docker compose start crm
```

恢复脚本会先执行 `PRAGMA integrity_check` 并确认快照内有用户数据，然后把当前库及 `-wal/-shm` 移到 `data/pre-restore-<时间>/`，再替换为快照，并从 `backups/files/` 补回快照引用的附件（有缺失时退出码为 2 并列出）。从异地取回快照时，需要把 `backups/files/` 一并放回数据目录。确认无误后可删除该目录。

## 5. 升级

1. 先手动备份并记录当前镜像版本（`docker image ls`）。
2. `git pull && docker compose ... up -d --build`。
3. 数据结构迁移在启动时按 `PRAGMA user_version` 自动、幂等执行（V1.0 → V1.1：枚举值、金额转整数分、负责人姓名转成员 ID）。
4. 回滚：恢复第 1 步的快照并使用旧镜像启动。
