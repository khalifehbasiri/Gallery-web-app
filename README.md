# Atelier — Gallery web app

A full-stack art community built with Angular 21, TypeScript, RxJS, NgRx SignalStore, Node.js 22 and Express 5. Browse and search artwork, save favorites, follow artists, post reviews, publish images, and create or join workshops.

**Live app:** [gallery-web-app-two.vercel.app](https://gallery-web-app-two.vercel.app)

Firestore stores artwork documents. Supabase PostgreSQL stores accounts, relationships and security records; Supabase Storage serves validated images. Upstash Redis caches public data and accelerates durable authorization checks. Angular and Express share one origin on Vercel.

![Atelier preview using isolated sample data](docs/preview.png)

## Run the isolated portfolio demo

Use Node.js **22.14–22.x** and npm:

```sh
npm ci
npm run build
npm run demo
```

Open [localhost:3000](http://localhost:3000). No cloud credentials or external database are required. PGlite runs PostgreSQL in memory; artwork documents use an in-memory adapter and uploads use a temporary directory. This command does not load `.env`. Stop with Ctrl+C; demo changes disappear.

| Account | Username     | Password          |
| ------- | ------------ | ----------------- |
| Patron  | demo         | gallery-demo-2026 |
| Artist  | Maya Laurent | gallery-demo-2026 |

These credentials exist only in the isolated demo. The cloud deployment has no seeded accounts with these passwords.

## Develop against the hosted services

Copy `.env.example` to the ignored `.env` file and configure PostgreSQL, Firestore and Supabase Storage. Keep server credentials outside Angular and Git. Generate a persistent signing secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run dev
```

Angular runs at [localhost:4200](http://localhost:4200), proxying `/api` to Express on port 3000. Hosted development uses real data: use separate projects for destructive tests. For a compiled same-origin server, run `npm run build` followed by `npm start`.

## What the project demonstrates

- Angular standalone components, lazy routes, strict templates, reactive forms and responsive layouts.
- RxJS search cancellation/debouncing and NgRx SignalStore authentication state.
- A typed Express REST API with shared contracts, parameterized queries and ownership/role checks.
- Normalized PostgreSQL relationships, foreign keys, transactional counters, GIN full-text search and a serverless transaction pool.
- Firestore document persistence with a SQL publication registry and compensating writes across database boundaries.
- Redis public caching, generation invalidation, concurrent-miss coalescing, distributed throttling and revocation fences.
- Ten-minute JWTs and separate rotating opaque refresh secrets in Strict HttpOnly cookies; hashed refresh storage, CSRF proofs, replay detection and device/session revocation.
- Direct signed image uploads with private staging, MIME/size/signature checks and a 5 MB limit.
- Repeatable migration tooling, an isolated PostgreSQL demo, automated security tests and live cloud verification.

Resume example: “Modernized a legacy gallery into an Angular/TypeScript and Express application, integrating PostgreSQL, Firestore and Redis with rotating refresh sessions, cache invalidation and validated direct image uploads; deployed on Vercel.”

## Configuration and checks

See [.env.example](.env.example) for all variables and [deployment](docs/DEPLOYMENT.md) for the existing cloud resources. Server configuration includes `DATABASE_URL`, the trusted `DATABASE_CA_CERT`, `FIREBASE_PROJECT_ID`, single-quoted serialized `FIREBASE_SERVICE_ACCOUNT_JSON`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a persistent `JWT_SECRET` of at least 32 random characters.

Use both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `REDIS_URL` for TCP/TLS Redis. Redis is optional locally. With configured Redis unavailable, public reads fall back to the databases and authorization reads fall back to PostgreSQL. Revocation/refresh writes return 503 if their distributed fence cannot be acquired.

```sh
npm test
npm run build
npm run format:check
npm audit --omit=dev
npm run test:redis
npm run maintenance
```

Live Redis tests require `TEST_REDIS_URL` or `TEST_UPSTASH_REDIS_REST_URL` and `TEST_UPSTASH_REDIS_REST_TOKEN` in ignored `.env.test`. Ordinary tests use isolated in-memory PostgreSQL and cache adapters. Maintenance removes expired security records and up to 100 expired unused uploads; it preserves ambiguous publications for reconciliation.

The production dependency audit reports zero vulnerabilities. The full audit currently reports nine development dependency entries originating from one unpatched `http-cache-semantics` advisory in Angular CLI's package-fetching tools. Do not apply the audit's suggested Angular CLI 7 downgrade. See [the advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).

## Data migration and operating limits

MongoDB is now used only by the explicit legacy exporter, as a development dependency. Existing source data and `uploads/` are preserved. Migration requires a reachable legacy database and an operator-reviewed snapshot; the current cloud database starts empty. See [migration and rollback](docs/MIGRATION.md).

This portfolio deployment uses free plans. Free quotas, cold starts, provider outages and inactive-project suspension still apply. Requests are bounded to avoid unnecessary database work; this is not an unlimited-capacity service. Monitor provider dashboards, run maintenance regularly, and keep manual backups. No paid upgrades, Google billing account, Docker or custom CI pipeline are configured.

Read [architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [security](docs/SECURITY.md), [Redis](docs/REDIS.md), [deployment](docs/DEPLOYMENT.md) and [change history](docs/CHANGELOG.md) for details.
