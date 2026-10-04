# Modernization change log

## Account lifecycle, privacy controls and quality-gated delivery

- Added private signup email, versioned terms acknowledgement, separate notification consent and ownership verification.
- Added expiring, single-use password recovery with hashed secrets, encrypted delivery and full session revocation.
- Added password-confirmed export and retirement/deletion with leased checkpointed MongoDB/Storage cleanup.
- Added public privacy/terms pages, daily retention processing and a technical legal readiness report with explicit review gaps.
- Added isolated GitHub Actions quality checks, staged Vercel promotion, Render hook release configuration and Dependabot.
- Added evidence-linked engineering standards documentation and regression tests; no universal compliance claim.

## MongoDB document-store cutover and diagram repair

- Fixed the Mermaid sequence diagram's unescaped semicolon and validated all three documented diagrams with the Mermaid parser.
- Added the native MongoDB driver, a bounded reusable pool, verified production TLS, majority writes and strict artwork collection validation.
- Provisioned a dedicated free Atlas project/cluster and database-scoped credentials, preserving existing Atlas projects.
- Exported and verified all 30 current Firestore artworks, copied them without modifying SQL relationships/accounts/security records, and verified a duplicate-free rerun.
- Added explicit migration/rollback selection, a temporary publication pause, conflict/ambiguous-write tests and stable Redis scope configuration.
- Updated architecture, security, migration, deployment and notification documentation for active MongoDB storage; Firestore remains a retained migration source.

## 1. Clean up and repair the original application

- Corrected case-sensitive model imports and removed unused packages, vendor fixtures, and duplicate documentation.
- Centralized configuration, validation, asynchronous errors, and reusable page/browser logic.
- Replaced global search results with isolated search criteria.
- Added salted password hashing, legacy password upgrades, session rotation/revocation, and protected account/artwork actions.
- Restricted registration fields, review deletion, and artist-only actions.
- Made repeated likes, follows, and workshop registrations safe against duplicates.
- Validated image signatures and upload sizes, generated filenames, and removed failed uploads.
- Made seeding repeatable without dropping data; added integration tests and formatting conventions.

This stage was committed before the architecture migration so the original cleanup remains independently reviewable.

## 2. Convert the backend to a TypeScript REST API

- Moved Node.js server code into `server/src/` and enabled strict TypeScript.
- Upgraded Express to version 5 and replaced rendered-page routes with JSON endpoints.
- Added frontend/backend contracts in `shared/contracts.ts` and documented every API endpoint.
- Replaced Express sessions with JWT cookies backed by revocable MongoDB auth-session records.
- Added safe response serializers, validated query filters, pagination, search indexes, origin checks, and login throttling.
- Retained existing MongoDB account/artwork collections and embedded relationships.
- Ported integration coverage to the REST API, including token replay, injection attempts, concurrent likes, and private-field exclusion.

## 3. Replace Pug with Angular

- Removed every Pug template and the old plain JavaScript page scripts/styles.
- Added a standalone Angular 21 client using TypeScript, RxJS, and NgRx SignalStore.
- Implemented gallery search/filtering, artwork details/reviews, artist profiles/follows, workshop discovery/registration, authentication, collections, artwork uploads, and workshop creation.
- Added lazy routes, reactive forms, guards, loading/error/empty states, responsive styling, and bundled artwork illustrations.
- Added state-management and review-form tests. Browser checks caught and corrected a CSP/style-loader conflict and an unbound review form.

## 4. Document and verify the portfolio project

- Added an isolated demo using temporary MongoDB and uploads, with reproducible credentials and local sample images.
- Replaced the old setup guide with development, build, demo, and environment instructions.
- Documented architecture, API behavior, resume wording, legacy-data compatibility, dependency advisories, and production limitations.
- Verified automated tests, strict builds, formatting, runtime audit, and desktop/mobile browser behavior.

## 5. Integrate Redis for public discovery

- Added the official node-redis client with optional connection URL, configurable TTL, and namespaced keys.
- Cached public statistics and anonymous artwork searches; signed-in responses bypass caching.
- Added invalidation after likes, reviews, artwork publishing, account role changes, and workshop creation.
- Protected invalidation against older in-flight reads with generation tokens and a conditional Lua write.
- Added concurrent-miss coalescing, automatic expiry, Redis outage fallback, reconnect initialization, and shutdown cleanup.
- Exposed cache status through API headers and health without revealing credentials.
- Added API/cache regression coverage and an opt-in live Redis integration test, plus setup and consistency documentation.

## 6. Free-tier cloud persistence and security

- Added normalized PostgreSQL tables, foreign keys, search/expiry indexes, RLS and a restricted TLS backend role.
- Replaced live Mongoose persistence with native Firestore artwork documents and PostgreSQL search/publication projections.
- Added independently random rotating refresh secrets, hashed storage, seven-day sliding/thirty-day absolute sessions, replay revocation, device controls and durable jti denial.
- Adopted Strict HttpOnly cookies, signed session-bound CSRF, Origin/Fetch Metadata checks and static/API CSP.
- Expanded public Redis caching to artwork detail, comment pages, artist summaries and workshops; personal flags remain separately queried.
- Added distributed revocation fences and SQL fallback that resists cache eviction/stale fills; Redis REST transport suits Vercel.
- Added private signed uploads and validated promotion to Supabase Storage with concurrency-safe quotas and completed-publication retries.
- Replaced the temporary MongoDB demo with isolated PGlite, added exporter/asset preparation/import/verification and expiry maintenance commands.
- Provisioned Gallery-only free cloud resources and deployed Angular/Express to Vercel; verified real registration, upload, Firestore writes, reviews/likes, workshops, refresh and revocation, then removed test fixtures.
- Updated setup, architecture, security, API, migration/rollback and operating documentation. Existing source data and Git history remain intact.

# Hosted catalog and asynchronous notifications — October 3, 2026

- Restored 24 original catalog records and six original image files; 18 missing images have labeled sample substitutions. Added six portfolio samples, two public demo accounts and a workshop. The repeatable seed was run twice against the hosted stores.
- Added an atomic SQL notification outbox, Redis UUID queue, leased Render Free HTTP processor, retries/dead letters, provider idempotency and app-level free-quota budgets.
- Added opt-in verified email preferences, code/recipient rate limits, signed one-click opt-out, signed webhook suppression and shared-demo restrictions. Public delivery requires an owned verified domain; the supplied Outlook mailbox is not a verified sender.
- Added optimistic likes with failure rollback, a once-daily authenticated recovery check, restricted processor credentials and notification maintenance.
- Fixed creation-time sorting and aligned gallery indexes; added the missing token-denial foreign-key index. Verified the live Redis/Render/Resend delivery simulator and removed its temporary account.
- Expanded README with architecture decisions, security tradeoffs, data ownership, free-tier limits and an evidence-based job-skill mapping.
