import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { getConfig } from './config.js';
import { openDatabase } from './db.js';
import { registerAuthRoutes } from './auth.js';
import { registerInventoryRoutes } from './inventory.js';

const PHOTO_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

export async function createApp(options = {}) {
  const config = { ...getConfig(), ...options };
  const app = Fastify({ logger: false, bodyLimit: config.maxUploadBytes + 256 * 1024 });
  const db = openDatabase(config.databaseFile);

  app.decorate('db', db);
  app.get('/api/health', async () => ({ ok: true, name: 'Eat It First' }));
  registerAuthRoutes(app);
  registerInventoryRoutes(app);
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await app.register(async function uploadsStatic(scope) {
    await scope.register(fastifyStatic, { root: config.uploadDir, prefix: '/uploads/', maxAge: '7d' });
  });

  app.post('/api/photos', async (request, reply) => {
    const parsed = parseDataUrl(request.body?.data);
    if (!parsed) return reply.code(400).send({ error: 'Invalid image data' });
    if (parsed.buffer.length === 0 || parsed.buffer.length > config.maxUploadBytes) {
      return reply.code(400).send({ error: 'Image is too large' });
    }
    const ext = PHOTO_MIME[parsed.mime];
    if (!ext) return reply.code(400).send({ error: 'Unsupported image type' });
    const id = randomUUID();
    const filename = `${id}${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, filename), parsed.buffer);
    return { id, url: `/uploads/${filename}` };
  });

  await app.register(fastifyStatic, { root: config.publicDir, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
  app.addHook('onClose', async () => db.close());
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = getConfig();
  const app = await createApp(config);
  await app.listen({ host: config.host, port: config.port });
}
