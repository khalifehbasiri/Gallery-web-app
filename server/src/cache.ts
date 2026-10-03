import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import type { Config } from './config.js';

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';
export interface DiscoveryCache {
  connect(): Promise<void>;
  remember<T>(
    key: string,
    load: () => Promise<T>,
  ): Promise<{ value: T; status: CacheStatus }>;
  invalidate(): Promise<void>;
  status(): 'disabled' | 'ready' | 'unavailable';
  close(): void;
}

export const disabledCache: DiscoveryCache = {
  async connect() {},
  async remember(_key, load) {
    return { value: await load(), status: 'BYPASS' };
  },
  async invalidate() {},
  status: () => 'disabled',
  close() {},
};

// A small connection boundary also lets tests simulate outages and races.
export interface RedisConnection {
  readonly isReady: boolean;
  readonly isOpen: boolean;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean },
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  connect(): Promise<unknown>;
  destroy(): void;
  on(event: 'ready' | 'error', listener: () => void): unknown;
}

// An older in-flight read must not repopulate the current generation after a write.
const writeIfCurrent = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
  end
  return nil
`;

export class RedisDiscoveryCache implements DiscoveryCache {
  private healthy = false;
  private warned = false;
  private closed = false;
  private readyTask: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly generationKey: string;

  constructor(
    private readonly client: RedisConnection,
    private readonly namespace: string,
    private readonly ttlSeconds: number,
    private readonly warn: (message: string) => void = console.warn,
  ) {
    this.generationKey = `${namespace}:generation`;
    client.on('error', () => this.unavailable());
    client.on('ready', () => {
      // Drop pre-outage entries: writes may have succeeded in MongoDB while offline.
      this.readyTask = this.resetGeneration()
        .then(() => {
          if (!this.closed && client.isReady) {
            this.healthy = true;
            this.warned = false;
          }
        })
        .catch(() => this.unavailable());
    });
  }

  async connect() {
    try {
      await this.client.connect();
      await this.readyTask;
    } catch {
      this.unavailable();
    }
  }

  status(): 'ready' | 'unavailable' {
    return this.healthy && this.client.isReady && !this.closed
      ? 'ready'
      : 'unavailable';
  }

  private unavailable() {
    this.healthy = false;
    if (!this.warned && !this.closed) {
      // Never log an error object or a connection URL containing credentials.
      this.warn('Redis cache unavailable; continuing with MongoDB.');
      this.warned = true;
    }
  }

  private resetGeneration() {
    return this.client.set(this.generationKey, randomUUID(), {
      EX: this.ttlSeconds * 2,
    });
  }

  private async generation() {
    let generation = await this.client.get(this.generationKey);
    if (!generation) {
      await this.client.set(this.generationKey, randomUUID(), {
        NX: true,
        EX: this.ttlSeconds * 2,
      });
      generation = await this.client.get(this.generationKey);
    }
    if (!generation) throw new Error('Cache generation unavailable.');
    return generation;
  }

  async remember<T>(
    resource: string,
    load: () => Promise<T>,
  ): Promise<{ value: T; status: CacheStatus }> {
    if (this.status() !== 'ready')
      return disabledCache.remember(resource, load);
    let generation: string;
    let key: string;
    try {
      generation = await this.generation();
      key = `${this.namespace}:${generation}:${createHash('sha256').update(resource).digest('hex')}`;
      const cached = await this.client.get(key);
      if (cached !== null) {
        try {
          return { value: JSON.parse(cached) as T, status: 'HIT' };
        } catch {
          /* Repair malformed cache entries by loading the source again. */
        }
      }
    } catch {
      this.unavailable();
      return disabledCache.remember(resource, load);
    }

    let pending = this.pending.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = (async () => {
        const value = await load();
        if (this.status() === 'ready') {
          try {
            await this.client.eval(writeIfCurrent, {
              keys: [this.generationKey, key],
              arguments: [
                generation,
                JSON.stringify(value),
                String(this.ttlSeconds),
              ],
            });
          } catch {
            this.unavailable();
          }
        }
        return value;
      })();
      this.pending.set(key, pending);
    }
    try {
      return { value: await pending, status: 'MISS' };
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  async invalidate() {
    if (!this.client.isReady || this.closed) return;
    try {
      await this.resetGeneration();
    } catch {
      this.unavailable();
    }
  }

  close() {
    this.closed = true;
    this.healthy = false;
    if (this.client.isOpen) this.client.destroy();
  }
}

export function createDiscoveryCache(config: Config): DiscoveryCache {
  if (!config.redisUrl) return disabledCache;
  const client = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    commandOptions: { timeout: 500 },
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: (retries) =>
        Math.min(100 * 2 ** Math.min(retries, 5), 3000),
    },
  });
  // Keep deployments and temporary demo databases apart on a shared Redis server.
  const database = createHash('sha256')
    .update(config.mongoUri)
    .digest('hex')
    .slice(0, 16);
  return new RedisDiscoveryCache(
    client,
    `${config.redisKeyPrefix}:v1:{${database}}`,
    config.redisCacheTtlSeconds,
  );
}
