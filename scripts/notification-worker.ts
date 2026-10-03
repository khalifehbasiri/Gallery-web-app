import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { redisConnection } from '../server/src/redis-connection.js';
import {
  RedisNotificationQueue,
  processNotifications,
  emailEnabled,
} from '../server/src/notifications.js';
// The processor receives only the mail encryption key, never the application's JWT signing secret.
const config = readConfig({
  ...process.env,
  JWT_SECRET: process.env.NOTIFICATION_ENCRYPTION_KEY,
});
if (
  !config.databaseUrl ||
  !config.notificationWorkerSecret ||
  (config.notificationEncryptionKey?.length || 0) < 32 ||
  config.notificationWorkerSecret.length < 32
)
  throw new Error(
    'Configure DATABASE_URL and a random NOTIFICATION_WORKER_SECRET (32+ characters).',
  );
const sql = postgres(config.databaseUrl, config.databaseCa),
  redis = redisConnection(config);
redis?.on('error', () => {});
try {
  await redis?.connect();
} catch {
  /* SQL fallback retains jobs. */
}
const queue = new RedisNotificationQueue(redis, config);
const app = express();
app.disable('x-powered-by');
let draining = false,
  stopping = false;
let inFlight: Promise<unknown> | undefined;
function drain() {
  if (draining || stopping) return inFlight || Promise.resolve();
  draining = true;
  inFlight = processNotifications(
    sql,
    config,
    undefined,
    queue,
    5,
    () => stopping,
  )
    .then((result) => {
      if (Object.values(result).some(Boolean))
        console.log('Notification batch:', JSON.stringify(result));
    })
    .catch(() =>
      console.error(
        'Notification processing unavailable; durable jobs retained.',
      ),
    )
    .finally(() => {
      draining = false;
    });
  return inFlight;
}
app.get('/health', (_req, res) =>
  res.json({
    status: stopping ? 'stopping' : 'ok',
    emailConfigured: emailEnabled(config),
  }),
);
app.post('/jobs/process', (req, res) => {
  const actual = Buffer.from(req.get('authorization') || ''),
    expected = Buffer.from(`Bearer ${config.notificationWorkerSecret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.sendStatus(401);
    return;
  }
  if (stopping) {
    res.sendStatus(503);
    return;
  }
  // This is a persistent Render process, not fire-and-forget serverless execution.
  void drain();
  res.status(202).json({ accepted: true });
});
const server = app.listen(config.port, '0.0.0.0', () =>
  console.log('Notification processor listening.'),
);
// Real jobs wake this Free HTTP service. No synthetic keepalive traffic is sent.
const interval = setInterval(() => {
  void drain();
}, 60000);
void drain();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  server.close();
  await inFlight;
  redis?.destroy();
  await sql.close();
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
