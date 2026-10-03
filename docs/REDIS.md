# Redis setup and behavior

## Connect a Redis server

Redis accelerates public discovery; it does not replace MongoDB. Use Redis 7.2 or newer with a running local server or a hosted Redis-compatible endpoint, following the client’s [supported versions](https://github.com/redis/node-redis#supported-redis-versions). Windows users can follow the [official Redis Windows installation guide](https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-windows/). This repository does not install a Redis server or require Docker.

Copy `.env.example` to `.env` and configure:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
REDIS_CACHE_TTL_SECONDS=60
REDIS_KEY_PREFIX=gallery-web-app
```

Hosted Redis with TLS uses a URL such as `rediss://username:password@your-redis-host:6380/0`. URL-encode special characters in credentials. Keep connection URLs in the ignored `.env` file or your hosting environment; do not commit them. Then start the app with `npm run dev`, or `npm run build` followed by `npm start`.

A blank `REDIS_URL` disables caching. Invalid URLs, TTLs outside 1–3600 seconds, or invalid prefixes fail configuration validation with messages that do not echo credentials. The client uses normal TLS certificate validation for `rediss://` connections.

For the temporary portfolio demo, set `REDIS_URL` in your shell before `npm run demo`. The command does not read `.env`; it always overrides the MongoDB URI with its temporary database. Each temporary database receives an isolated Redis namespace, and all keys expire.

## What is cached

| Endpoint                | Cached content                                                  | Behavior                |
| ----------------------- | --------------------------------------------------------------- | ----------------------- |
| `GET /api/stats`        | Public artwork/artist/workshop counts and categories            | Shared across visitors  |
| `GET /api/artworks`     | Public DTO page for validated search/category/artist/page/limit | Anonymous visitors only |
| Signed-in artwork lists | Personalized saved-work flags                                   | Always bypassed         |
| Other endpoints         | Account, auth, detail, workshop, mutation data                  | Not cached              |

`X-Cache: MISS` means the public response was loaded from MongoDB for a cache miss. `HIT` means Redis supplied it. `BYPASS` means the cache was disabled, unavailable, or deliberately bypassed for a signed-in user. HTTP responses use `no-store`; Redis's application cache operates separately from browser caching.

## Check the connection

```sh
curl -i http://localhost:3000/api/health
curl -i http://localhost:3000/api/stats
curl -i http://localhost:3000/api/stats
```

In Windows PowerShell, use `curl.exe` to avoid the legacy `curl` alias. Health includes `redis: "ready"` after connection and initialization, `"disabled"` without a URL, or `"unavailable"` during an outage. Repeated requests should show `MISS` then `HIT`. No host, URL, credential, or cache key is exposed in health responses.

The Redis user needs `GET`, `SET`, and `EVAL` access to the configured cache prefix, plus connection-handshake commands required by node-redis. An ACL or command error causes MongoDB fallback. Fix the Redis configuration and restart or reconnect the app if health remains unavailable.

## Expiry, invalidation, and consistency

Cached responses expire after the configured TTL. Generation tokens expire after twice that TTL so abandoned demo namespaces do not leave permanent keys. Keys include a schema version and a SHA-256 fingerprint of the configured MongoDB URI; filters are hashed rather than stored in key names. Application instances that share a database should use the same MongoDB URI and Redis prefix so they share invalidation.

Successful likes/unlikes, review creation/deletion, artwork publishing, account role changes, and workshop creation invalidate public discovery before the API responds. A Lua script accepts a cache fill only when its original generation is still current, avoiding stale fills after a concurrent write. Entries in older generations expire naturally. No `KEYS`, `FLUSHDB`, or `FLUSHALL` commands are used.

Redis errors are handled separately from database errors. The app falls back to MongoDB, disables offline command queuing, limits command waits to 500 ms and connection attempts to one second, and reconnects with bounded backoff. A reconnect replaces the generation before cache reads resume. Cache failures do not turn successful database mutations into HTTP failures. Shutdown destroys the optional Redis connection and cancels reconnect attempts.

This is a best-effort cache, not a transactional consistency layer. A writer isolated from Redis cannot invalidate another server's cache immediately; TTL bounds that stale period. Direct MongoDB edits and CLI seeding also rely on TTL. Source queries started before a write may still return their original snapshot to that request, but cannot fill the new generation. No measured latency or scalability claim is implied by the integration.

## Verification

`npm test` covers cache hit/expiry, concurrent misses, cross-instance invalidation, in-flight races, malformed cached JSON, query validation, personalized-response isolation, relevant API writes, and read/write outages using a deterministic Redis test double. It also tests connection refusal and shutdown with the actual node-redis client. MongoDB integration tests remain isolated from your database.

The real Redis test requires an explicit `TEST_REDIS_URL`. Add it to `.env` and run:

```sh
npm run test:redis
```

That command reads `.env`, exercises real cache hits, TTL expiry, invalidation, and Lua race protection, and writes only uniquely namespaced test keys that expire automatically. It never flushes the server. Without `TEST_REDIS_URL`, the test is explicitly skipped. No live Redis server was available during the initial integration, so the live-server test was not executed at that stage.

Implementation references: [node-redis connection configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md), [Redis production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/).
