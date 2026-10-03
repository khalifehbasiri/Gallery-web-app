# Redis caching and revocation

Production uses account-owned Upstash Free over REST. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or use `REDIS_URL` with `rediss://` for hosted TCP/TLS. Keep credentials in ignored files and server environment settings.

## Public content

Cache statistics, filtered gallery pages, artwork details, public reviews, artist summaries and workshops. Public counts are cached; authoritative likes/comments remain in PostgreSQL. Signed-in requests reuse public entries, then overlay personal flags separately. Content entries contain no personalized response objects, passwords, raw JWTs or refresh secrets.

Default expiry is 60 seconds, configurable from 1–3600. Namespaces use project identity and a key prefix; credentials can rotate without splitting revocation authority. Writes change a shared generation. Conditional Lua fills prevent an older read from repopulating the new generation. Identical misses coalesce within a process. Global invalidation trades some hit rate for simpler consistency; old entries expire naturally.

Public invalidation is best effort: other instances may serve stale counts until expiry when invalidation fails. Authorization checks remain independent. Outages, malformed entries and timeouts fall back to bounded database queries. Recovery resets the generation before reuse. HTTP recovery attempts are spaced ten seconds apart per process; successful write invalidation also restores readiness. TCP offline queues are disabled.

`GET /api/health` returns Redis `ready`, `unavailable` or `disabled`; this is runtime liveness rather than a full dependency probe. Cached endpoints return `X-Cache: HIT`, `MISS` or `BYPASS`. Final API responses remain `private, no-store`.

## Authorization proofs

JWT signature, issuer, audience and expiry are verified on every request. Positive Redis proofs last at most 60 seconds, bounded further by JWT/session expiry. They contain a public user DTO and epoch; keys contain `jti`, never raw bearer secrets. SQL owns session validity and the `jti` denylist.

Revocation, refresh and role changes acquire a shared fence **before** SQL writes. Cached proofs require the current epoch and no pending mutation. Releasing a fence rotates the epoch again. Successful logout/denial invalidates older proofs across instances; requests already authorized can finish.

Evicted state creates a fresh epoch, rejecting surviving older proofs. Conditional fills reject stale SQL reads across mutations. Redis read failure falls back to SQL; unavailable SQL rejects authorization. Configured Redis write-fence failure returns 503 before changing security state. Failed release leaves readers on SQL, preserving correctness at a performance cost.

A crashed mutation can leave a persistent pending fence. During a maintenance window, stop incoming requests, allow functions/transactions to finish, inspect SQL state, and reset only this project's security state to a **new random epoch**, removing confirmed abandoned fields. Never clear fences while mutations could run, restore old Redis snapshots, or manually edit SQL security state while cached proofs are active.

## Quotas and tests

One page view can consume multiple Redis commands: throttling, generation reads, lookup/fill and authorization checks. Command allowances are not page-view allowances. Monitor Redis and database usage; no unlimited-scale claim is made.

Run `npm run test:redis` with a dedicated endpoint in ignored `.env.test`: `TEST_REDIS_URL`, or `TEST_UPSTASH_REDIS_REST_URL` and `TEST_UPSTASH_REDIS_REST_TOKEN`. Real-server tests cover expiry, invalidation, cross-instance fences, eviction and stale-fill races. Ordinary tests cover unavailable transports and durable fallback.
