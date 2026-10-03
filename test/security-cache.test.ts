import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  RedisSecurityCache,
  uncachedSecurity,
} from '../server/src/security-cache.js';
import type { RedisConnection } from '../server/src/cache.js';
import { redisConnection } from '../server/src/redis-connection.js';
import { readConfig } from '../server/src/config.js';

it('reads durable revocations with Redis disabled and fails closed on configured Redis outages', async () => {
  let revoked = false;
  const identity = async () =>
    revoked
      ? null
      : {
          user: { id: '1', username: 'Synthetic', role: 'patron' as const },
          expires: Date.now() / 1000 + 600,
        };
  assert.ok(
    await uncachedSecurity.verify('token', identity, Date.now() / 1000 + 600),
  );
  await uncachedSecurity.change(async () => {
    revoked = true;
  });
  assert.equal(
    await uncachedSecurity.verify('token', identity, Date.now() / 1000 + 600),
    null,
  );
  const offline = { isReady: false, isOpen: false } as RedisConnection,
    cache = new RedisSecurityCache(offline, 'offline');
  let wrote = false;
  await assert.rejects(
    cache.change(async () => {
      wrote = true;
    }),
    /Revocation service/,
  );
  assert.equal(wrote, false);
  assert.equal(
    await cache.verify('token', identity, Date.now() / 1000 + 600),
    null,
  );
  await assert.rejects(
    cache.verify(
      'token',
      async () => {
        throw new Error('SQL offline');
      },
      Date.now() / 1000 + 600,
    ),
    /SQL offline/,
  );
});

it(
  'fences revocations across instances, resists cache eviction and in-flight stale fills using real Redis',
  {
    skip:
      !(
        process.env.TEST_REDIS_URL || process.env.TEST_UPSTASH_REDIS_REST_URL
      ) && 'Configure a test Redis endpoint.',
    timeout: 20000,
  },
  async () => {
    const config = readConfig({
      REDIS_URL: process.env.TEST_REDIS_URL,
      UPSTASH_REDIS_REST_URL: process.env.TEST_UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.TEST_UPSTASH_REDIS_REST_TOKEN,
    });
    const client = redisConnection(config)!;
    client.on('error', () => {});
    await client.connect();
    const namespace = `security-test:{${randomUUID()}}`,
      a = new RedisSecurityCache(client, namespace),
      b = new RedisSecurityCache(client, namespace);
    let revoked = false,
      loads = 0;
    const expiry = Date.now() / 1000 + 120;
    const load = async () => {
      loads++;
      return revoked
        ? null
        : {
            user: {
              id: 'synthetic',
              username: 'Test fixture',
              role: 'patron' as const,
            },
            expires: expiry,
          };
    };
    try {
      assert.ok(await a.verify('one', load, expiry));
      assert.ok(await b.verify('one', load, expiry));
      assert.equal(loads, 1, 'Warm tokens avoid SQL across instances.');
      let began!: () => void, finish!: () => void;
      const start = new Promise<void>((r) => (began = r)),
        pause = new Promise<void>((r) => (finish = r));
      const changing = a.change(async () => {
        began();
        await pause;
        revoked = true;
      });
      await start;
      assert.ok(await b.verify('one', load, expiry));
      assert.equal(loads, 2, 'Pending mutation bypasses positive cache.');
      finish();
      await changing;
      assert.equal(
        await b.verify('one', load, expiry),
        null,
        'Committed revocation invalidates cached proofs.',
      );
      // Keep old proofs while evicting the epoch; a new epoch may not reuse them.
      await client.eval("return redis.call('DEL',KEYS[1])", {
        keys: [`${namespace}:state`],
        arguments: [],
      });
      assert.equal(await a.verify('one', load, expiry), null);
      revoked = false;
      let loaded!: () => void, resolve!: () => void;
      const loading = new Promise<void>((r) => (loaded = r)),
        wait = new Promise<void>((r) => (resolve = r));
      const stale = a.verify(
        'racing',
        async () => {
          const record = await load();
          loaded();
          await wait;
          return record;
        },
        expiry,
      );
      await loading;
      await b.change(async () => {
        revoked = true;
      });
      resolve();
      await stale;
      assert.equal(
        await b.verify('racing', load, expiry),
        null,
        'Stale SQL reads cannot repopulate a new epoch.',
      );
      revoked = false;
      assert.ok(
        await a.verify(
          'short',
          async () => ({
            user: { id: 'synthetic', username: 'Test fixture', role: 'patron' },
            expires: Date.now() / 1000 + 0.1,
          }),
          expiry,
        ),
      );
      assert.equal(
        await b.verify('short', async () => null, expiry),
        null,
        'Session expiry bounds proof TTL.',
      );
    } finally {
      await client
        .eval("return redis.call('DEL',unpack(KEYS))", {
          keys: [
            `${namespace}:state`,
            `${namespace}:proof:one`,
            `${namespace}:proof:racing`,
            `${namespace}:proof:short`,
          ],
          arguments: [],
        })
        .catch(() => {});
      client.destroy();
    }
  },
);
