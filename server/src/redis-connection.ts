import { createClient } from 'redis';
import type { Config } from './config.js';
import type { RedisConnection } from './cache.js';
import { createHash } from 'node:crypto';
export function redisScope(config: Config) {
  const url = new URL(config.databaseUrl || 'mongodb://127.0.0.1/gallery');
  // Credentials and pooler mode can rotate without splitting the revocation authority.
  const identity =
    config.supabaseUrl ||
    `${url.hostname}:${url.pathname}:${url.username.split('.').at(-1)}`;
  return createHash('sha256')
    .update(`${identity}:${config.redisScopeId}`)
    .digest('hex')
    .slice(0, 16);
}
// Upstash HTTP avoids idle TCP sockets in serverless functions. Both transports use the same Lua protocol.
class RestRedis implements RedisConnection {
  isReady = false;
  isOpen = false;
  private listeners: Record<string, (() => void)[]> = {};
  constructor(
    private url: string,
    private token: string,
  ) {}
  on(event: 'ready' | 'error', listener: () => void) {
    (this.listeners[event] ??= []).push(listener);
  }
  private async command(args: unknown[], timeout = 1500): Promise<unknown> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error('Redis HTTP request failed.');
    const value = (await response.json()) as {
      result: unknown;
      error?: string;
    };
    if (value.error) throw new Error('Redis command failed.');
    return value.result;
  }
  get(key: string) {
    return this.command(['GET', key]) as Promise<string | null>;
  }
  set(key: string, value: string, options?: { EX?: number; NX?: boolean }) {
    return this.command([
      'SET',
      key,
      value,
      ...(options?.EX ? ['EX', options.EX] : []),
      ...(options?.NX ? ['NX'] : []),
    ]) as Promise<string | null>;
  }
  eval(script: string, options: { keys: string[]; arguments: string[] }) {
    return this.command([
      'EVAL',
      script,
      options.keys.length,
      ...options.keys,
      ...options.arguments,
    ]);
  }
  async connect() {
    // HTTP has no persistent socket; later commands may recover after a failed initial probe.
    this.isOpen = true;
    this.isReady = true;
    await this.command(['PING'], 5000);
    this.listeners['ready']?.forEach((l) => l());
  }
  destroy() {
    this.isOpen = false;
    this.isReady = false;
  }
}
export function redisConnection(config: Config): RedisConnection | null {
  if (config.upstashUrl && config.upstashToken)
    return new RestRedis(config.upstashUrl, config.upstashToken);
  if (!config.redisUrl) return null;
  return createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    commandOptions: { timeout: 800 },
    socket: {
      connectTimeout: 1500,
      reconnectStrategy: (attempt) => Math.min(3000, 200 * (attempt + 1)),
    },
  }) as unknown as RedisConnection;
}
