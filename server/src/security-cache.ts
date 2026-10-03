import { randomUUID } from 'node:crypto';
import { redisConnection, redisScope } from './redis-connection.js';
import type { User } from '../../shared/contracts.js';
import type { Config } from './config.js';
import type { RedisConnection } from './cache.js';
import { HttpError } from './http.js';
export interface SecurityCache {
  verify(
    jti: string,
    load: () => Promise<{ user: User; expires: number } | null>,
    expires: number,
  ): Promise<User | null>;
  change<T>(work: () => Promise<T>): Promise<T>;
  close(): void;
  limit?(
    key: string,
    limit: number,
    seconds: number,
  ): Promise<boolean | undefined>;
}
export const uncachedSecurity: SecurityCache = {
  verify: async (_id, load) => (await load())?.user || null,
  change: (work) => work(),
  close() {},
};
// Proofs require the current epoch and no SQL mutation in progress. State has no TTL.
// Eviction creates a fresh epoch; losing Redis cannot resurrect revoked sessions.
const read = `
  if not redis.call('HGET', KEYS[1], 'epoch') then redis.call('HSET', KEYS[1], 'epoch', ARGV[1]) end
  local epoch = redis.call('HGET', KEYS[1], 'epoch')
  if redis.call('HLEN', KEYS[1]) > 1 then return {epoch, ''} end
  local proof = redis.call('GET', KEYS[2])
  if proof and cjson.decode(proof).epoch == epoch then return {epoch, proof} end
  return {epoch, ''}
`;
const fill = `
  if redis.call('HGET', KEYS[1], 'epoch') == ARGV[1] and redis.call('HLEN', KEYS[1]) == 1 then
    return redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]) end
  return nil
`;
const fence = `redis.call('HSET', KEYS[1], 'epoch', ARGV[1], ARGV[2], 'pending'); return 1`;
const release = `redis.call('HSET', KEYS[1], 'epoch', ARGV[1]); redis.call('HDEL', KEYS[1], ARGV[2]); return 1`;
export class RedisSecurityCache implements SecurityCache {
  constructor(
    private client: RedisConnection,
    private namespace: string,
  ) {}
  private async call(script: string, keys: string[], args: string[]) {
    if (!this.client.isReady) throw new Error('Security cache unavailable.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.client.eval(script, { keys, arguments: args }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis timeout.')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async verify(
    jti: string,
    load: () => Promise<{ user: User; expires: number } | null>,
    expires: number,
  ) {
    const state = `${this.namespace}:state`,
      key = `${this.namespace}:proof:${jti}`;
    let epoch: string | undefined;
    try {
      const result = (await this.call(
        read,
        [state, key],
        [randomUUID()],
      )) as string[];
      epoch = result[0];
      if (result[1]) return (JSON.parse(result[1]) as { user: User }).user;
    } catch {}
    const record = await load(),
      ttl = Math.min(
        60,
        Math.floor(Math.min(expires, record?.expires || 0) - Date.now() / 1000),
      );
    if (record && epoch && ttl > 0) {
      try {
        await this.call(
          fill,
          [state, key],
          [epoch, JSON.stringify({ epoch, user: record.user }), String(ttl)],
        );
      } catch {}
    }
    return record?.user || null;
  }
  async change<T>(work: () => Promise<T>): Promise<T> {
    const state = `${this.namespace}:state`,
      id = randomUUID();
    try {
      await this.call(fence, [state], [randomUUID(), id]);
    } catch {
      throw new HttpError(503, 'Revocation service unavailable. Please retry.');
    }
    try {
      return await work();
    } finally {
      // Failed release leaves a durable fence: readers keep using PostgreSQL.
      try {
        await this.call(release, [state], [randomUUID(), id]);
      } catch {}
    }
  }
  close() {
    if (this.client.isOpen) this.client.destroy();
  }
  async limit(key: string, limit: number, seconds: number) {
    try {
      const count = await this.call(
        `local count=redis.call('INCR',KEYS[1]);if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return count`,
        [`${this.namespace}:rate:${key}`],
        [String(seconds)],
      );
      return Number(count) <= limit;
    } catch {
      return undefined;
    }
  }
}
export async function createSecurityCache(
  config: Config,
): Promise<SecurityCache> {
  const client = redisConnection(config);
  if (!client) return uncachedSecurity;
  client.on('error', () => {});
  await Promise.race([
    client.connect().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 1600)),
  ]);
  const scope = redisScope(config);
  return new RedisSecurityCache(
    client as unknown as RedisConnection,
    `${config.redisKeyPrefix}:{${scope}}:security`,
  );
}
