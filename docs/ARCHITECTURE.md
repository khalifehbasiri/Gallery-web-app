# Architecture

## Request flow

```text
Angular standalone pages
  → reactive forms / NgRx SignalStore / RxJS
  → typed HttpClient API service
  → /api REST endpoints in Express
  → validation + JWT/session authentication + role/ownership checks
  → Mongoose models and MongoDB
  → safe DTOs defined in shared/contracts.ts
```

Public discovery reads optionally pass through Redis before loading from MongoDB. Redis stores only serialized public DTOs; MongoDB remains the source of truth for all durable data and authentication.

During development, Angular's proxy forwards API and upload requests to Express. In a compiled build, Express serves Angular's static assets and falls back to `index.html` for client routes. Missing assets and unknown API paths remain JSON 404 responses. Deep links and page refreshes work without a second web server.

## Frontend boundaries

`ApiService` owns HTTP requests and imports shared TypeScript contracts. `AuthStore` owns the current public user and computed signed-in/artist state. Startup waits for `/api/auth/me` before rendering guarded routes. Guards improve navigation; the backend independently checks every protected mutation.

`GalleryStore` is provided per gallery page. Its RxJS method debounces queries, cancels obsolete requests with `switchMap`, and catches errors inside the request stream so later searches still work. Query parameters preserve search/category/artist/page state across refresh and browser navigation. Authentication changes refresh personalized saved-work flags.

Pages use OnPush change detection and signals for local state. Routes load page components lazily. Reactive forms drive login, registration, reviews, publishing, and workshop creation. Shared artwork/workshop cards keep presentation and interactions consistent. Native labels, keyboard focus styles, a skip link, reduced-motion support, and responsive grids improve accessibility.

Angular's production build keeps stylesheet minification but disables critical-CSS inlining: the generated inline `onload` handler otherwise conflicts with Helmet's script policy. This avoids weakening the Content Security Policy for the optimization.

## Authentication and authorization

Passwords are hashed with Node's scrypt using a random salt. Existing plaintext passwords are checked only for legacy compatibility and replaced with hashes on successful login.

Login sets a 24-hour HS256 JWT with issuer, audience, subject, and a random session ID. The cookie is HttpOnly, SameSite=Lax, and Secure in production. Every authenticated request verifies both the JWT and its unexpired MongoDB session record. Logout revokes that record, so replaying the previous token fails even before its JWT expiry. Session records have a TTL index for cleanup.

Registration accepts username/password only and creates a patron. Users may switch between patron and artist accounts as in the original application. Artist accounts can publish artwork and workshops. Review deletion is restricted to the original author. This is an art-community role model, not administrative approval or privileged enterprise access.

Mutations validate browser origin and reject cross-site fetch metadata. Login/registration are rate limited. API serializers never return password hashes, tokens, or embedded legacy account snapshots.

## MongoDB compatibility and query design

The original account/artwork collections and embedded relationships are retained, avoiding a destructive data conversion. New reviews/workshops have UUIDs; legacy entries derive deterministic IDs for stable routes. Public DTOs separate the retained persistence shape from Angular's interface.

- Artwork text search uses weighted name/artist/description fields.
- Category and artist indexes include `_id` to support newest-first browsing.
- Artwork queries use bounded page sizes and database-side filtering/counting.
- Workshop lists use MongoDB unwind/sort/facet aggregation for pagination.
- Conditional updates prevent repeated likes/follows; workshop registration uses `$addToSet`.
- Username uniqueness and auth-session identity/expiry indexes support login integrity.

Relationships updated in two collections remain susceptible to partial writes. A replica-set transaction strategy or normalized relationship collection would be the next step if the application required stronger consistency at scale.

## Redis discovery cache

`server/src/cache.ts` encapsulates node-redis behind the `DiscoveryCache` interface. The server and demo create one cache client and close it during shutdown. Redis is opt-in through `REDIS_URL`; startup does not wait for an unavailable optional cache.

Statistics and anonymous artwork queries use cache-aside loading. Validated filters/page/limit form canonical keys, hashed under a versioned namespace that includes a fingerprint of the configured MongoDB URI. Signed-in artwork lists bypass the shared cache so saved-work flags cannot leak between accounts. Accounts, auth sessions, reviews, and workshop registrations remain uncached.

Each namespace has a random generation token. Relevant API writes replace it before responding. A Lua script writes loaded data only if its captured generation is still current, preventing an older in-flight read from repopulating the active generation. Old data and generation keys expire automatically; there is no keyspace scan or shared-database flush. Concurrent misses within a process share the same loader for a generation/key pair.

Connection/command deadlines, disabled offline queuing, and bounded warning output keep Redis failures from blocking MongoDB responses. Reconnection creates a fresh generation before caching resumes because MongoDB writes may have occurred during the outage. A partitioned writer can still leave another instance's cached data stale until TTL expiry; direct database edits and the seed CLI also rely on expiry. See [Redis setup and verification](REDIS.md) for operational details.

## Resume wording

Use wording that describes the implemented work and verification:

> Modernized a legacy art-community app into an Angular and TypeScript frontend backed by Node.js, Express REST APIs, MongoDB, and Redis. Implemented NgRx SignalStore/RxJS search state, JWT authentication with server-side revocation, role-based publishing, validated image uploads, indexed search, and Redis caching with TTL expiry, write invalidation, and outage fallback. Added automated API, cache, and frontend tests.

This project demonstrates the Angular/Express/MongoDB parts of the supplied job description. It does not demonstrate PostgreSQL, Docker, CI/CD, OAuth2, or a measured production scalability claim.
