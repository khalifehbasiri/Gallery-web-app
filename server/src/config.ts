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
  mongoUri?: string;
  mongoDatabase: string;
  artworkBackend: 'mongodb' | 'firestore';
  artworkWritesPaused: boolean;
  jwtSecret: string;
  production: boolean;
  trustProxy: boolean;
  clientOrigin: string;
  redisUrl?: string;
  redisCacheTtlSeconds: number;
  redisKeyPrefix: string;
  redisScopeId: string;
  databaseUrl?: string;
  databaseCa?: string;
  firebaseProjectId?: string;
  firebaseCredentials?: string;
  firestoreDatabaseId: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  storageBucket: string;
  upstashUrl?: string;
  upstashToken?: string;
  resendKey?: string;
  resendFrom?: string;
  resendWebhookSecret?: string;
  resendTestRecipient?: string;
  resendPublicSending: boolean;
  notificationEncryptionKey?: string;
  notificationWorkerUrl?: string;
  notificationWorkerSecret?: string;
  cronSecret?: string;
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
  const mongoUri = env.MONGODB_URI?.trim() || undefined;
  const mongoDatabase = env.MONGODB_DATABASE || 'gallery';
  const artworkBackend = env.ARTWORK_BACKEND || 'mongodb';
  if (!['mongodb', 'firestore'].includes(artworkBackend))
    throw new Error('ARTWORK_BACKEND must be mongodb or firestore.');
  if (mongoUri && !/^mongodb(?:\+srv)?:\/\//.test(mongoUri))
    throw new Error('MONGODB_URI must be a MongoDB connection string.');
  if (
    !/^[a-zA-Z0-9_-]{1,63}$/.test(mongoDatabase) ||
    ['admin', 'config', 'local'].includes(mongoDatabase)
  )
    throw new Error('MONGODB_DATABASE must name an application database.');
  if (production && mongoUri) {
    const options = new URLSearchParams(mongoUri.split('?')[1] || '');
    for (const [key, value] of options) {
      const name = key.toLowerCase();
      if (
        (['tls', 'ssl'].includes(name) && value.toLowerCase() === 'false') ||
        ([
          'tlsinsecure',
          'tlsallowinvalidcertificates',
          'tlsallowinvalidhostnames',
        ].includes(name) &&
          value.toLowerCase() === 'true')
      )
        throw new Error('Production MongoDB requires verified TLS.');
    }
  }
  if (
    Boolean(env.UPSTASH_REDIS_REST_URL) !==
    Boolean(env.UPSTASH_REDIS_REST_TOKEN)
  )
    throw new Error('Configure both Upstash REST variables.');
  if (
    env.UPSTASH_REDIS_REST_URL &&
    !/^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/.test(env.UPSTASH_REDIS_REST_URL)
  )
    throw new Error('Invalid UPSTASH_REDIS_REST_URL.');
  if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(redisKeyPrefix))
    throw new Error(
      'REDIS_KEY_PREFIX must contain 1–64 letters, digits, colons, underscores, or hyphens.',
    );
  if (
    env.NOTIFICATION_WORKER_URL &&
    !/^https:\/\/[a-z0-9-]+\.onrender\.com\/?$/.test(
      env.NOTIFICATION_WORKER_URL,
    )
  )
    throw new Error(
      'NOTIFICATION_WORKER_URL must be the HTTPS Render service origin.',
    );
  if (env.RESEND_FROM && /[\r\n]/.test(env.RESEND_FROM))
    throw new Error('RESEND_FROM cannot contain line breaks.');
  return {
    port,
    mongoUri,
    mongoDatabase,
    artworkBackend: artworkBackend as Config['artworkBackend'],
    artworkWritesPaused: env.ARTWORK_WRITES_PAUSED === 'true',
    jwtSecret: secret || randomBytes(32).toString('hex'),
    production,
    trustProxy: env.TRUST_PROXY === '1',
    clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:4200',
    redisUrl,
    redisCacheTtlSeconds,
    redisKeyPrefix,
    // Preserve the existing namespace during the document-store migration.
    redisScopeId: env.REDIS_SCOPE_ID || env.FIREBASE_PROJECT_ID || 'local',
    databaseUrl: env.DATABASE_URL,
    databaseCa: env.DATABASE_CA_CERT,
    firebaseProjectId: env.FIREBASE_PROJECT_ID,
    firebaseCredentials: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    firestoreDatabaseId: env.FIRESTORE_DATABASE_ID || '(default)',
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: env.STORAGE_BUCKET || 'gallery-images',
    upstashUrl: env.UPSTASH_REDIS_REST_URL,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
    resendKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
    resendWebhookSecret: env.RESEND_WEBHOOK_SECRET,
    resendTestRecipient: env.RESEND_TEST_RECIPIENT?.trim().toLowerCase(),
    resendPublicSending: env.RESEND_PUBLIC_SENDING === 'true',
    notificationEncryptionKey: env.NOTIFICATION_ENCRYPTION_KEY,
    notificationWorkerUrl: env.NOTIFICATION_WORKER_URL,
    notificationWorkerSecret: env.NOTIFICATION_WORKER_SECRET,
    cronSecret: env.CRON_SECRET,
  };
}
