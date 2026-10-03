import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
export const uploadsDirectory = path.join(rootDirectory, 'uploads');

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && !env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production.');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return {
    port,
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/TP',
    sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
    production,
    trustProxy: env.TRUST_PROXY === '1',
  };
}
