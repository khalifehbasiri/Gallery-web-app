import type { RedisConnection } from '../../server/src/cache.js';

// Test double for deterministic expiry, connection failures, and shared-cache races.
// The separate Redis integration test exercises the actual Redis/Lua protocol.
export class FakeRedis implements RedisConnection {
  isReady = false;
  isOpen = false;
  failReads = false;
  failWrites = false;
  private now = 0;
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(
    readonly values = new Map<string, { value: string; expires: number }>(),
  ) {}
  on(event: 'ready' | 'error', listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
    return this;
  }
  async connect() {
    this.isOpen = true;
    this.isReady = true;
    for (const listener of this.listeners.get('ready') || []) listener();
  }
  destroy() {
    this.isOpen = false;
    this.isReady = false;
  }
  disconnect() {
    this.isReady = false;
    for (const listener of this.listeners.get('error') || []) listener();
  }
  advance(seconds: number) {
    this.now += seconds;
  }
  async get(key: string) {
    if (!this.isReady || this.failReads)
      throw new Error('Simulated read failure.');
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean },
  ) {
    if (!this.isReady || this.failWrites)
      throw new Error('Simulated write failure.');
    if (options?.NX && (await this.get(key)) !== null) return null;
    this.values.set(key, {
      value,
      expires: this.now + (options?.EX ?? Infinity),
    });
    return 'OK';
  }
  async eval(
    _script: string,
    { keys, arguments: args }: { keys: string[]; arguments: string[] },
  ) {
    if (this.failWrites) throw new Error('Simulated script failure.');
    if ((await this.get(keys[0]!)) !== args[0]) return null;
    return this.set(keys[1]!, args[1]!, { EX: Number(args[2]) });
  }
}
