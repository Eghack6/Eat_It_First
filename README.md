# Eat It First

Eat It First is a lightweight shared household food-expiry tracker.

## Runtime

- Node.js 20 or newer
- Fastify
- SQLite through `better-sqlite3`
- Nginx reverse proxy in production

## Local development

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:3000`.

The default local database is created at `data/eat-it-first.db`. Set `DATABASE_FILE` to use another location.

## Production

Read [`DEPLOY.md`](./DEPLOY.md). The application is designed to run as one Node.js process with SQLite and no Redis, queue, OCR service, or separate database server.
