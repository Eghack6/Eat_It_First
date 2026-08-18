# Eat It First Deployment Guide

这份说明给负责部署的服务器 AI 使用。请先阅读完整流程，再执行命令。不要把数据库、备份目录或设备令牌放到公开的 Nginx 静态目录中。

## 1. 变量

先根据服务器实际情况替换以下变量：

```bash
APP_DIR=/opt/eat-it-first
DATA_DIR=/var/lib/eat-it-first
BACKUP_DIR=/var/backups/eat-it-first
DOMAIN=food.example.com
RELEASE_ZIP=/tmp/eat-it-first-release.zip
```

如果服务器已有 Nginx、Node.js 或其他站点，不要覆盖现有配置；使用新的 server block，并先执行 `nginx -t`。

## 2. 系统检查

确认系统是 Ubuntu，且有足够磁盘空间：

```bash
cat /etc/os-release
free -h
df -h
node --version
nginx -v
```

Node.js 需要 20 或更新版本。若需要安装 Node.js，请使用服务器现有的软件源或官方 LTS 安装方式，不要安装开发版。

安装 SQLite 命令行工具和构建工具：

```bash
sudo apt-get update
sudo apt-get install -y sqlite3 build-essential
```

## 3. 解压和安装

```bash
sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin eat-it-first || true
sudo mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" /var/log/eat-it-first
sudo unzip -q "$RELEASE_ZIP" -d /opt
sudo chown -R eat-it-first:eat-it-first "$APP_DIR" "$DATA_DIR" /var/log/eat-it-first
cd "$APP_DIR"
sudo -u eat-it-first npm ci --omit=dev
```

如果压缩包解压后多了一层目录，请将实际应用目录调整为 `$APP_DIR`，确保下面文件存在：

```text
$APP_DIR/package.json
$APP_DIR/src/server.js
$APP_DIR/public/index.html
```

## 4. 手动启动检查

先不要安装 systemd，直接用生产变量启动：

```bash
sudo -u eat-it-first env NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATABASE_FILE="$DATA_DIR/eat-it-first.db" node "$APP_DIR/src/server.js"
```

另开一个终端执行：

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

必须返回：

```json
{"ok":true,"name":"Eat It First"}
```

通过 `Ctrl+C` 停止手动进程。

## 5. 安装 systemd 服务

```bash
sudo cp "$APP_DIR/deploy/eat-it-first.service" /etc/systemd/system/eat-it-first.service
sudo systemctl daemon-reload
sudo systemctl enable --now eat-it-first
sudo systemctl status eat-it-first --no-pager
curl -fsS http://127.0.0.1:3000/api/health
```

如果服务失败，检查：

```bash
sudo journalctl -u eat-it-first -n 100 --no-pager
sudo -u eat-it-first test -w "$DATA_DIR" && echo writable
```

## 6. 配置 Nginx

复制 `deploy/nginx.conf.example` 到 Nginx 的站点配置目录，将 `server_name` 改成实际域名。推荐先使用 HTTP 验证反向代理：

```bash
sudo cp "$APP_DIR/deploy/nginx.conf.example" /etc/nginx/sites-available/eat-it-first
sudo sed -i "s/food.example.com/$DOMAIN/g" /etc/nginx/sites-available/eat-it-first
sudo ln -sf /etc/nginx/sites-available/eat-it-first /etc/nginx/sites-enabled/eat-it-first
sudo nginx -t
sudo systemctl reload nginx
curl -fsS "http://$DOMAIN/api/health"
```

如果域名已有 HTTPS 配置，应将 `/api` 和网页请求代理到 `127.0.0.1:3000`，并保留原有证书配置。若还没有证书，使用服务器现有的 Certbot 流程申请证书，然后再次执行 `nginx -t` 和 reload。

## 7. 配置备份

```bash
sudo install -m 0750 "$APP_DIR/deploy/backup.sh" /usr/local/sbin/eat-it-first-backup
sudo chown root:root /usr/local/sbin/eat-it-first-backup
sudo mkdir -p "$BACKUP_DIR"
sudo chown -R eat-it-first:eat-it-first "$BACKUP_DIR"
sudo -u eat-it-first env DATABASE_FILE="$DATA_DIR/eat-it-first.db" BACKUP_DIR="$BACKUP_DIR" /usr/local/sbin/eat-it-first-backup
```

创建每日 timer 或 cron。使用 systemd timer 时，执行脚本的用户必须能读取数据库并写入备份目录。至少保留 14 个备份，并定期将备份复制到另一台存储位置。

恢复前停止应用：

```bash
sudo systemctl stop eat-it-first
sudo cp "$BACKUP_DIR/选择的备份文件.db" "$DATA_DIR/eat-it-first.db"
sudo chown eat-it-first:eat-it-first "$DATA_DIR/eat-it-first.db"
sudo systemctl start eat-it-first
curl -fsS http://127.0.0.1:3000/api/health
```

## 8. 发布更新和回滚

发布更新前：

```bash
sudo systemctl stop eat-it-first
sudo -u eat-it-first env DATABASE_FILE="$DATA_DIR/eat-it-first.db" BACKUP_DIR="$BACKUP_DIR" /usr/local/sbin/eat-it-first-backup
```

将新版本解压到临时目录，确认 `npm ci --omit=dev` 成功后，再替换 `$APP_DIR` 中的应用文件。不要替换 `$DATA_DIR`。启动并验证：

```bash
sudo systemctl start eat-it-first
curl -fsS "https://$DOMAIN/api/health"
sudo systemctl status eat-it-first --no-pager
```

如果验证失败，停止服务，恢复上一版应用文件或数据库备份，再启动并重复健康检查。不要在未备份的情况下删除数据库。

## 9. 最终验证清单

- `systemctl is-active eat-it-first` 返回 `active`
- `curl -fsS https://DOMAIN/api/health` 返回 `ok: true`
- 浏览器可以打开 Eat It First 首页
- 可以创建家庭并看到邀请码
- 可以用另一台设备通过邀请码加入
- 可以添加食品、消耗 1 个、筛选分类和查看操作记录
- 手机宽度没有横向滚动，桌面端列表正常显示
- `nginx -t` 成功
- 至少有一份可读的 SQLite 备份
- 日志中没有打印设备令牌或邀请码
