# Eat It First

> 中文版：[README.zh-CN.md](./README.zh-CN.md)

A lightweight, self-hosted **household food expiry tracker** for families and roommates. Track what's in your fridge, pantry, and freezer together — and eat what needs eating first.

Built with **Node.js + Fastify + SQLite**. No Redis, no queue, no external services. One process, one file, runs on any small VPS or home server.

## Why Eat It First

Household food gets forgotten, expires, and gets thrown away. Eat It First keeps a shared inventory of everything your household has in stock, highlights what expires soonest, and makes it easy for anyone in the family to log in, add a batch, or eat one item.

## Features

- **Shared family inventory** — one household, many members, everyone sees the same food list
- **Expiry awareness** — automatic status: 已过期 / 今天到期 / 7 天内到期 / 保质期内 (expired / expiring today / within 7 days / safe)
- **One-tap consume** — press "吃掉 1" to reduce quantity; when it hits zero the item is marked completed
- **Undo** — accidentally pressed the button? Every consume action can be undone from the activity log
- **Photo per batch** — snap or upload a photo of the food (auto-compressed, stored locally)
- **Smart date entry** — optional production date + shelf life auto-calculates the expiry date; expiry becomes read-only when derived
- **Categories & locations** — organize by 分类 (category) and 存放位置 (storage location), add your own, disable or delete unused ones
- **Home dashboard** — at-a-glance cards for expired / today / next 7 days / in-stock counts, jump straight into the filtered list
- **Activity log** — every add, edit, consume, complete, and restore is recorded with who did it and when
- **Simple invite-based joining** — create a family once, join with a 10-character invite code; a nickname maps to the same identity on every device
- **Mobile-friendly** — responsive layout with a bottom navigation bar on phones
- **Zero-config privacy** — self-hosted, no cloud accounts, no telemetry

## Tech Stack

| Layer    | Choice                                                      |
|----------|-------------------------------------------------------------|
| Runtime  | Node.js 20+                                                 |
| Server   | Fastify 5                                                   |
| Database | SQLite (`better-sqlite3`), WAL mode                          |
| Frontend | Vanilla JS + CSS (no framework, no build step)              |
| Static   | `@fastify/static`                                            |
| Proxy    | Nginx (production)                                          |

## Quick Start

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:3000`, create a family with your name, and start adding food.

By default the database is created at `data/eat-it-first.db`. Point `DATABASE_FILE` elsewhere to change it.

## Environment Variables

| Variable          | Default                          | Description                        |
|-------------------|----------------------------------|------------------------------------|
| `HOST`            | `127.0.0.1`                      | Bind address                       |
| `PORT`            | `3000`                           | HTTP port                          |
| `DATABASE_FILE`   | `data/eat-it-first.db` (project) | SQLite database path               |
| `UPLOAD_DIR`      | `uploads/` (project)             | Directory for food photos          |
| `MAX_UPLOAD_BYTES`| `5242880` (5 MB)                 | Maximum photo size in bytes        |

## API Overview

| Method | Path                          | Description                        |
|--------|-------------------------------|------------------------------------|
| POST   | `/api/families`               | Create or join a family by name    |
| POST   | `/api/families/join`          | Join an existing family by invite  |
| GET    | `/api/families/current`       | Current family + members           |
| POST   | `/api/families/invite-code/rotate` | Generate a new invite code     |
| GET    | `/api/foods`                  | List foods (filterable)            |
| POST   | `/api/foods`                  | Add a food batch                   |
| PATCH  | `/api/foods/:id`              | Edit a food                        |
| POST   | `/api/foods/:id/consume`      | Consume one unit                   |
| POST   | `/api/foods/:id/complete`     | Mark completed                     |
| POST   | `/api/foods/:id/restore`      | Restore to active                  |
| POST   | `/api/logs/:id/undo`          | Undo a consume action              |
| GET    | `/api/logs`                   | Family activity log                |
| POST   | `/api/photos`                 | Upload a food photo (data URL)     |
| GET    | `/api/categories` `/api/locations` | List categories / locations    |

All `/api/*` routes except public auth routes require a `Bearer` token issued at family creation/joining. Auth is handled with per-device tokens stored as SHA-256 hashes.

## Project Layout

```
src/
  server.js     Fastify app, static files, photo upload
  config.js     Environment-driven configuration
  db.js         SQLite open + schema migration
  schema.sql    Table definitions
  auth.js       Family / member / device auth, invite codes
  inventory.js  Food, category, location, log routes
  expiry.js     Expiry status calculation
public/
  index.html    Single-page shell
  app.js        Frontend logic (no framework)
  styles.css    Responsive styles
deploy/
  eat-it-first.service   systemd unit (example)
  nginx.conf.example     Nginx reverse proxy (example)
  backup.sh              Database backup script
```

## Production Deployment

See [`DEPLOY.md`](./DEPLOY.md) for a full walkthrough: systemd service, Nginx reverse proxy, TLS, backups (daily at 03:30, 14 retained), and upgrades.

## Testing

```bash
npm test
```

Tests run with [Vitest](https://vitest.dev/) against an in-memory SQLite database — no setup required.

## License

See the project repository for license information.