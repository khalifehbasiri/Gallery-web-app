import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { it } from 'node:test';
import { createClient } from 'redis';
import { RedisDiscoveryCache } from '../server/src/cache.js';

const url = process.env.TEST_REDIS_URL;
it(
  'caches, expires, and invalidates results against a real Redis server',
  {
    skip: !url && 'Set TEST_REDIS_URL to run the live Redis integration test.',
    timeout: 10000,
  },
  async () => {
    const namespace = `gallery-redis-test:{${randomUUID()}}`;
    const client = createClient({
      url,
      disableOfflineQueue: true,
      commandOptions: { timeout: 1000 },
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    const cache = new RedisDiscoveryCache(client, namespace, 1, () => {});
    try {
      await cache.connect();
      assert.equal(
        cache.status(),
        'ready',
        'TEST_REDIS_URL must identify a reachable Redis server.',
      );
      let queries = 0;
      const load = async () => ({ count: ++queries });
      assert.equal((await cache.remember('stats', load)).status, 'MISS');
      assert.deepEqual(await cache.remember('stats', load), {
        value: { count: 1 },
        status: 'HIT',
      });
      await cache.invalidate();
      assert.equal((await cache.remember('stats', load)).value.count, 2);
      await setTimeout(1100);
      assert.equal((await cache.remember('stats', load)).value.count, 3);
      let resolve!: (value: { count: number }) => void;
      let started!: () => void;
      const loading = new Promise<void>((done) => {
        started = done;
      });
      const old = cache.remember('race', () => {
        started();
        return new Promise<{ count: number }>((done) => {
          resolve = done;
        });
      });
      await Promise.race([loading, old]);
      await cache.invalidate();
      await cache.remember('race', async () => ({ count: 100 }));
      resolve({ count: 0 });
      await old;
      assert.deepEqual(await cache.remember('race', load), {
        value: { count: 100 },
        status: 'HIT',
      });
    } finally {
      // All test keys have a TTL and a unique namespace; never flush a shared server.
      cache.close();
    }
  },
);
