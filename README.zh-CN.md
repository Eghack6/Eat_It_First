# Eat It First

> English version: [README.md](./README.md)

一个轻量、可自托管的**家庭食品到期追踪工具**，适合家人或室友一起使用。共同记录冰箱、橱柜、冷冻室里有什么，优先吃掉快过期的食物。

技术栈为 **Node.js + Fastify + SQLite**。无 Redis、无队列、无外部服务。单进程、单文件数据库，可在任意小 VPS 或家用服务器上运行。

## 为什么需要 Eat It First

家里的食物常常被遗忘、放过期然后扔掉。Eat It First 维护全家共享的库存清单，突出展示即将过期的食物，让家庭里任何人都能方便地登录、添加批次或吃掉一件。

## 功能特性

- **全家共享库存** — 一个家庭、多名成员，所有人看到同一份食品列表
- **到期提醒** — 自动标记状态：已过期 / 今天到期 / 7 天内到期 / 保质期内
- **一键消耗** — 点「吃掉 1」减少数量；数量归零自动标记为已完成
- **误触可撤销** — 手滑了？每条消耗记录都能从动态列表里一键撤销
- **批次照片** — 为食品拍照或上传照片（自动压缩，存本地）
- **智能日期填写** — 选填生产日期 + 保质期可自动算出到期日期；由此推算的到期日期自动锁定为只读
- **分类与位置** — 按分类和存放位置整理，可自定义、停用或删除
- **首页仪表盘** — 已过期 / 今天到期 / 7 天内到期 / 在架批次一目了然，点击直达对应列表
- **动态日志** — 每一次添加、修改、消耗、完成、恢复都记录谁在何时做了什么
- **邀请码加入** — 创建家庭后，其他人凭 10 位邀请码加入；同一昵称在所有设备上自动归为同一身份
- **移动端友好** — 响应式布局，手机上底部导航栏
- **隐私零配置** — 自托管，无云端账号，无遥测

## 技术栈

| 层面    | 选型                                                    |
|---------|----------------------------------------------------------|
| 运行时  | Node.js 20+                                              |
| 服务端  | Fastify 5                                                |
| 数据库  | SQLite（`better-sqlite3`），WAL 模式                      |
| 前端    | 原生 JS + CSS（无框架、无构建步骤）                       |
| 静态资源| `@fastify/static`                                        |
| 反向代理| Nginx（生产环境）                                        |

## 快速开始

```bash
npm install
npm test
npm start
```

打开 `http://127.0.0.1:3000`，创建家庭并填写你的名字，然后开始添加食品。

默认数据库创建在 `data/eat-it-first.db`。可通过 `DATABASE_FILE` 指向其他位置。

## 环境变量

| 变量              | 默认值                           | 说明                             |
|-------------------|----------------------------------|----------------------------------|
| `HOST`            | `127.0.0.1`                      | 监听地址                         |
| `PORT`            | `3000`                           | HTTP 端口                        |
| `DATABASE_FILE`   | `data/eat-it-first.db`（项目内） | SQLite 数据库路径                |
| `UPLOAD_DIR`      | `uploads/`（项目内）             | 食品照片存储目录                 |
| `MAX_UPLOAD_BYTES`| `5242880`（5 MB）                | 照片大小上限（字节）             |

## API 概览

| 方法 | 路径                          | 说明                              |
|------|-------------------------------|-----------------------------------|
| POST | `/api/families`               | 按家庭名创建或进入家庭            |
| POST | `/api/families/join`          | 凭邀请码加入已有家庭              |
| GET  | `/api/families/current`       | 当前家庭与成员                    |
| POST | `/api/families/invite-code/rotate` | 生成新的邀请码              |
| GET  | `/api/foods`                  | 食品列表（可筛选）                |
| POST | `/api/foods`                  | 添加食品批次                      |
| PATCH| `/api/foods/:id`              | 编辑食品                          |
| POST | `/api/foods/:id/consume`      | 消耗一份                          |
| POST | `/api/foods/:id/complete`     | 标记已完成                        |
| POST | `/api/foods/:id/restore`      | 恢复为在架                        |
| POST | `/api/logs/:id/undo`          | 撤销一次消耗                      |
| GET  | `/api/logs`                   | 家庭动态日志                      |
| POST | `/api/photos`                 | 上传食品照片（data URL）          |
| GET  | `/api/categories` `/api/locations` | 分类 / 存放位置列表        |

除公开的登录注册接口外，所有 `/api/*` 路由均需携带 `Bearer` token（创建/加入家庭时签发）。认证采用每设备 token，仅存 SHA-256 哈希。

## 目录结构

```
src/
  server.js     Fastify 应用、静态文件、照片上传
  config.js     基于环境变量的配置
  db.js         SQLite 打开与 schema 迁移
  schema.sql    表结构定义
  auth.js       家庭 / 成员 / 设备认证、邀请码
  inventory.js  食品、分类、位置、日志路由
  expiry.js     到期状态计算
public/
  index.html    单页外壳
  app.js        前端逻辑（无框架）
  styles.css    响应式样式
deploy/
  eat-it-first.service   systemd 服务单元（示例）
  nginx.conf.example     Nginx 反向代理（示例）
  backup.sh              数据库备份脚本
```

## 生产部署

完整部署流程见 [`DEPLOY.md`](./DEPLOY.md)：systemd 服务、Nginx 反向代理、TLS、备份（每日 03:30，保留 14 份）与升级。

## 测试

```bash
npm test
```

测试使用 [Vitest](https://vitest.dev/) 基于内存 SQLite 运行，无需额外配置。

## 许可

许可信息见项目仓库。