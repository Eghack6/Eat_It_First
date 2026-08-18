import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

export function getConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3000),
    databaseFile: env.DATABASE_FILE || path.join(rootDir, 'data', 'eat-it-first.db'),
    publicDir: path.join(rootDir, 'public'),
    uploadDir: env.UPLOAD_DIR || path.join(rootDir, 'uploads'),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
  };
}
