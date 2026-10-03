import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../server/src/config.js';
import { redisConnection } from '../server/src/redis-connection.js';
import { RedisNotificationQueue } from '../server/src/notifications.js';
it('enqueues deduplicated notification IDs in real Redis and atomically drains competing consumers', async (t) => {
  const env = process.env;
  if (!env.TEST_REDIS_URL && !env.TEST_UPSTASH_REDIS_REST_URL) {
    t.skip('Configure an isolated live Redis test endpoint.');
    return;
  }
  const config = readConfig({
    REDIS_URL: env.TEST_REDIS_URL,
    UPSTASH_REDIS_REST_URL: env.TEST_UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: env.TEST_UPSTASH_REDIS_REST_TOKEN,
    REDIS_KEY_PREFIX: `test-mail-${randomUUID()}`,
  });
  const redis = redisConnection(config)!;
  redis.on('error', () => {});
  await redis.connect();
  const queue = new RedisNotificationQueue(redis, config),
    ids = [randomUUID(), randomUUID()];
  try {
    await queue.add(ids);
    await queue.add(ids);
    const results = (await Promise.all([queue.take(), queue.take()])).flat();
    assert.deepEqual(results.sort(), ids.sort());
    assert.deepEqual(await queue.take(), []);
  } finally {
    await redis.eval("return redis.call('DEL',KEYS[1])", {
      keys: [queue.queueKey],
      arguments: [],
    });
    redis.destroy();
  }
});
