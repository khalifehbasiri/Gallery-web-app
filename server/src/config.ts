import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

// Resolve assets relative to the repository in both source and compiled layouts.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const rootDirectory = path.resolve(
  moduleDirectory,
  moduleDirectory.includes(`${path.sep}dist${path.sep}`) ? '../../..' : '../..',
);
export const uploadsDirectory = path.join(rootDirectory, 'uploads');
export const clientDirectory = path.join(rootDirectory, 'dist/client/browser');

export interface Config {
  port: number;
  mongoUri: string;
  jwtSecret: string;
  production: boolean;
  trustProxy: boolean;
  clientOrigin: string;
  redisUrl?: string;
  redisCacheTtlSeconds: number;
  redisKeyPrefix: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const secret = env.JWT_SECRET || env.SESSION_SECRET;
  if (production && (!secret || secret.length < 32))
    throw new Error(
      'JWT_SECRET must contain at least 32 characters in production.',
    );
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535.');
  const redisUrl = env.REDIS_URL?.trim() || undefined;
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      if (
        !['redis:', 'rediss:'].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.search ||
        parsed.hash
      )
        throw new Error();
    } catch {
      throw new Error(
        'REDIS_URL must be a valid redis:// or rediss:// connection URL.',
      );
    }
  }
  const redisCacheTtlSeconds = Number(env.REDIS_CACHE_TTL_SECONDS || 60);
  if (
    !Number.isInteger(redisCacheTtlSeconds) ||
    redisCacheTtlSeconds < 1 ||
    redisCacheTtlSeconds > 3600
  )
    throw new Error(
      'REDIS_CACHE_TTL_SECONDS must be an integer between 1 and 3600.',
    );
  const redisKeyPrefix = env.REDIS_KEY_PREFIX || 'gallery-web-app';
  if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(redisKeyPrefix))
    throw new Error(
      'REDIS_KEY_PREFIX must contain 1–64 letters, digits, colons, underscores, or hyphens.',
    );
  return {
    port,
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/TP',
    jwtSecret: secret || randomBytes(32).toString('hex'),
    production,
    trustProxy: env.TRUST_PROXY === '1',
    clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:4200',
    redisUrl,
    redisCacheTtlSeconds,
    redisKeyPrefix,
  };
}
