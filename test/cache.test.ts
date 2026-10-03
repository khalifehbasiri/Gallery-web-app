import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  createDiscoveryCache,
  disabledCache,
  RedisDiscoveryCache,
} from '../server/src/cache.js';
import { readConfig } from '../server/src/config.js';
import { FakeRedis } from './helpers/fake-redis.js';

async function setup() {
  const redis = new FakeRedis();
  const cache = new RedisDiscoveryCache(redis, 'cache-test', 60, () => {});
  await cache.connect();
  return { redis, cache };
}

it('runs with Redis disabled and validates cache configuration without echoing credentials', async () => {
  assert.equal(createDiscoveryCache(readConfig({})), disabledCache);
  assert.deepEqual(
    await disabledCache.remember('stats', async () => ({ total: 2 })),
    { value: { total: 2 }, status: 'BYPASS' },
  );
  assert.equal(
    readConfig({ REDIS_URL: 'rediss://user:secret@example.com:6380/0' })
      .redisCacheTtlSeconds,
    60,
  );
  for (const url of [
    'https://user:secret@example.com',
    'redis://',
    'redis://example.com?password=secret',
  ]) {
    assert.throws(
      () => readConfig({ REDIS_URL: url }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('REDIS_URL') &&
        !error.message.includes('secret'),
    );
  }
  for (const ttl of ['0', '3601', '1.5', 'invalid'])
    assert.throws(
      () => readConfig({ REDIS_CACHE_TTL_SECONDS: ttl }),
      /REDIS_CACHE_TTL_SECONDS/,
    );
  assert.throws(
    () => readConfig({ REDIS_KEY_PREFIX: 'unsafe prefix' }),
    /REDIS_KEY_PREFIX/,
  );
});

it('avoids repeated source queries on a cache hit and reloads expired entries', async () => {
  const { cache, redis } = await setup();
  let queries = 0;
  const load = async () => ({ count: ++queries });
  assert.equal((await cache.remember('stats', load)).status, 'MISS');
  assert.deepEqual(await cache.remember('stats', load), {
    value: { count: 1 },
    status: 'HIT',
  });
  assert.equal(queries, 1);
  redis.advance(61);
  assert.deepEqual(await cache.remember('stats', load), {
    value: { count: 2 },
    status: 'MISS',
  });
});

it('coalesces concurrent misses without coalescing distinct filters', async () => {
  const { cache } = await setup();
  let resolve!: (value: { count: number }) => void;
  const data = new Promise<{ count: number }>((done) => {
    resolve = done;
  });
  let queries = 0;
  const load = () => {
    queries++;
    return data;
  };
  const first = cache.remember('paintings', load);
  const second = cache.remember('paintings', load);
  await setImmediate();
  assert.equal(queries, 1);
  assert.equal(
    (await cache.remember('digital', async () => ({ count: 3 }))).value.count,
    3,
  );
  resolve({ count: 2 });
  assert.deepEqual(
    (await Promise.all([first, second])).map((entry) => entry.value),
    [{ count: 2 }, { count: 2 }],
  );
});

it('invalidates shared results across application instances', async () => {
  const { cache: first, redis } = await setup();
  const second = new RedisDiscoveryCache(
    new FakeRedis(redis.values),
    'cache-test',
    60,
    () => {},
  );
  await second.connect();
  await first.remember('stats', async () => ({ count: 1 }));
  assert.equal(
    (await second.remember('stats', async () => ({ count: 999 }))).value.count,
    1,
  );
  await second.invalidate();
  assert.deepEqual(await first.remember('stats', async () => ({ count: 2 })), {
    value: { count: 2 },
    status: 'MISS',
  });
});

it('does not repopulate a fresh generation from a read started before invalidation', async () => {
  const { cache } = await setup();
  let resolve!: (value: { count: number }) => void;
  const old = cache.remember(
    'stats',
    () =>
      new Promise<{ count: number }>((done) => {
        resolve = done;
      }),
  );
  await setImmediate();
  await cache.invalidate();
  await cache.remember('stats', async () => ({ count: 2 }));
  resolve({ count: 1 });
  await old;
  assert.deepEqual(
    await cache.remember('stats', async () => ({ count: 999 })),
    { value: { count: 2 }, status: 'HIT' },
  );
});

it('repairs malformed JSON and never caches source failures', async () => {
  const { cache, redis } = await setup();
  await cache.remember('stats', async () => ({ count: 1 }));
  for (const [key, entry] of redis.values)
    if (!key.endsWith(':generation')) entry.value = 'broken-json';
  assert.deepEqual(await cache.remember('stats', async () => ({ count: 2 })), {
    value: { count: 2 },
    status: 'MISS',
  });
  await assert.rejects(
    cache.remember('failing', async () => {
      throw new Error('MongoDB failure');
    }),
    /MongoDB failure/,
  );
  assert.equal(
    (await cache.remember('failing', async () => ({ count: 3 }))).value.count,
    3,
  );
});

it('bypasses outages, bounds warning noise, and discards pre-outage results on recovery', async () => {
  const redis = new FakeRedis();
  const warnings: string[] = [];
  const cache = new RedisDiscoveryCache(redis, 'outage-test', 60, (warning) =>
    warnings.push(warning),
  );
  await cache.connect();
  await cache.remember('stats', async () => ({ count: 1 }));
  redis.failReads = true;
  assert.deepEqual(await cache.remember('stats', async () => ({ count: 2 })), {
    value: { count: 2 },
    status: 'BYPASS',
  });
  await cache.remember('stats', async () => ({ count: 2 }));
  assert.equal(warnings.length, 1);
  assert.equal(cache.status(), 'unavailable');
  redis.failReads = false;
  redis.disconnect();
  await redis.connect();
  await setImmediate();
  assert.equal(cache.status(), 'ready');
  assert.deepEqual(await cache.remember('stats', async () => ({ count: 2 })), {
    value: { count: 2 },
    status: 'MISS',
  });
  redis.failWrites = true;
  await cache.invalidate();
  assert.equal(cache.status(), 'unavailable');
  assert.equal(warnings.length, 2);
  cache.close();
  assert.equal(redis.isOpen, false);
});

it('falls back when cache storage fails after a successful source query', async () => {
  const { cache, redis } = await setup();
  redis.failWrites = true;
  assert.equal(
    (await cache.remember('stats', async () => ({ count: 5 }))).value.count,
    5,
  );
  assert.equal(cache.status(), 'unavailable');
});

it(
  'handles a refused connection using the real Redis client and releases retries on shutdown',
  { timeout: 5000 },
  async () => {
    const portReservation = createServer().listen(0, '127.0.0.1');
    await once(portReservation, 'listening');
    const port = (portReservation.address() as { port: number }).port;
    await new Promise<void>((resolve) =>
      portReservation.close(() => resolve()),
    );
    const cache = createDiscoveryCache(
      readConfig({ REDIS_URL: `redis://127.0.0.1:${port}` }),
    );
    const connecting = cache.connect();
    try {
      await setImmediate();
      assert.equal(cache.status(), 'unavailable');
      assert.deepEqual(
        await cache.remember('stats', async () => ({ count: 7 })),
        { value: { count: 7 }, status: 'BYPASS' },
      );
    } finally {
      cache.close();
    }
    await connecting;
  },
);
