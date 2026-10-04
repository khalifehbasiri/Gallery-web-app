# Deployment and free-plan operations

Live app: [gallery-web-app-two.vercel.app](https://gallery-web-app-two.vercel.app). Vercel assigned the `-two` alias because the shorter name was already occupied.

| Resource | Configuration                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel   | gallery-web-app, Angular CDN + Express function, Node 22.x, iad1                                                                                                           |
| MongoDB  | Gallery project / 6ac1abf835b2838e26afb613; Gallery Atlas Free M0 cluster, MongoDB 8.0, AWS US_EAST_1; gallery.artworks                                                    |
| Firebase | gallery-web-app-kb-2026, Spark; retained Firestore migration source in Montreal, no longer the live artwork database                                                       |
| Supabase | Gallery / obtatkjgfthiapdyczed, khalifehbasiri's Org, Free, ca-central-1                                                                                                   |
| Storage  | private gallery-images-pending; public gallery-images; 5 MB; raster types only                                                                                             |
| Upstash  | Account-owned Free database claimed by the project owner; HTTP REST transport                                                                                              |
| Render   | [gallery-notifications.onrender.com](https://gallery-notifications.onrender.com), Free HTTP processor in My Workspace; Node 22, Virginia; idle sleep and cold starts apply |
| Resend   | Integration prepared; public sending awaits owned-domain verification and signed callback configuration                                                                    |

No paid upgrade or Google billing account was attached. Free plans have quotas and suspension/cold-start behavior. Watch the provider dashboards; alerts are not spending caps. Keep MongoDB at Free M0; do not enable paid clusters/backups, Firebase Blaze, Cloud Functions/App Hosting, paid Redis plans or Vercel add-ons without a separate budget decision. Vercel Hobby is for personal, noncommercial projects. Current limits and terms are in [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Supabase pricing](https://supabase.com/pricing), [Upstash pricing](https://upstash.com/pricing/redis) and [Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Provisioning and environment

SQL migrations live in `supabase/migrations/` and their remote history is registered. The backend role has only gallery schema privileges and RLS policies. Its randomly generated login password was set outside migrations. Use the transaction pool, port 6543, with the trusted Supabase CA and certificate verification. The connection pool holds one socket per warm instance.

Atlas uses a dedicated Gallery project, isolated from the existing Atlas projects. The `gallery_artworks` database user has `readWrite` on `gallery` and is scoped to the Gallery cluster. `npm run mongo:prepare` explicitly creates/verifies strict JSON Schema validation; HTTP handlers never change schemas. Existing artwork IDs are the unique `_id` index, so detail reads require no collection scans. Production forces verified TLS, requests majority writes and reuses a small bounded client pool. Vercel Hobby lacks a fixed outbound IP, so the dedicated project has a `0.0.0.0/0` network allowlist; database authentication and TLS remain mandatory. Private/static egress is a future hosting option, not part of the $0 deployment.

Firestore remains a preserved migration source with deny-all browser rules. Its dedicated service identity and the retained adapter are needed only for explicit export/rollback operations. MongoDB failures never automatically fall back to Firestore.

Vercel production environment contains `MONGODB_URI`, `MONGODB_DATABASE=gallery`, `ARTWORK_BACKEND=mongodb`, `ARTWORK_WRITES_PAUSED=false`, PostgreSQL URL/CA, Supabase URL/service key, JWT signing secret, Upstash REST URL/token, proxy setting and allowed frontend origin. `REDIS_SCOPE_ID=gallery-web-app-kb-2026` preserves the old authorization/cache/queue namespace and is shared with Render; it is a stable namespace label, not a dependency on Firebase. The notification processor receives no MongoDB credentials. Keep all values server-only and enter exact values without an unintended trailing newline. Do not expose these as Angular build constants or public environment variables.

Local `.env`, `.env.test`, `.codex-local`, service-account keys, `.vercel`, exports and uploads are excluded from Git/deployment. Vercel derives NODE_ENV=production; cookies are Secure. Review `.vercelignore` before adding new sensitive files.

```sh
npm ci
npm test
npm run build
npm run format:check
vercel deploy --prod
```

The project is linked to GitHub; GitHub Actions now gates main releases; automatic Vercel Git deployments are disabled. Configure the dedicated deployment secrets described in CI_CD.md. The production root requires the rewrite `/api/(.*)` to `/api/index`; named wildcard captures can otherwise become unknown query filters. CSP/security headers cover the static frontend as well as API responses. A successful build alone is not deployment verification.

## Verification and maintenance

Check `/api/health`, `/api/stats`, paginated discovery, registration/login, direct signed upload, review/like changes, refresh and logout after deployment. Inspect browser console/CSP failures and provider logs. Health reports runtime initialization/cache status, not exhaustive dependency readiness.

`npm run maintenance` removes expired refresh records, expired sessions without remaining refresh records, expired jti denials, and up to ten expired unused uploads after their signed upload capabilities expire. The existing daily authenticated cron also runs bounded retention/deletion maintenance; operators can run the command to process backlogs. No paid scheduler is configured. It does not erase used/ambiguous publication objects. Review those and abandoned migration assets in Storage periodically. Never remove a referenced public object.

For a pending publication: inspect its SQL row and MongoDB document by ID. If both match and the image exists, complete publication and invalidate Redis. If the document/image is missing, repair from the retained snapshot or remove the pending registry and unreferenced resources. Stop writes during manual reconciliation. Security mutations must use the fenced protocol; see [Redis](REDIS.md). Preserve manual SQL/document/image exports before changes; no paid managed backups are enabled.

The initial deployment used Firestore and was checked against all hosted stores and real Redis. The gallery was subsequently populated with the original 24 artwork fixture records, six portfolio samples, 13 accounts and one workshop. Six original images were recovered; 18 fixture images have labeled substitutions. All 30 current artwork documents were then copied and verified in MongoDB, preserving SQL accounts, activity and image references. Legacy MongoDB was unreachable during the original restoration, so historical account activity could not be recovered. [Migration](MIGRATION.md) covers both the new cutover and the legacy exporter.

Notification deployment uses [the separate processor and sender setup](NOTIFICATIONS.md). A free daily Vercel recovery check is configured for real due jobs; routine retention/deletion maintenance now shares that daily check, with an operator command for backlogs. Public demo account roles are fixed, and they cannot store personal email addresses or produce mail jobs.

## Account lifecycle release

Apply the additive account_lifecycle migration before this release. It preserves legacy/demo logins, adds private unique emails and consent/terms records, hashed recovery challenges, restricted processor access and durable deletion cleanup. The daily cron now processes bounded retention/deletion work even with email disabled. Signup email verification and recovery delivery still require an owned sender. CI/CD credentials and Gallery Render Auto-Deploy settings are operator setup steps; see [CI/CD](CI_CD.md).
