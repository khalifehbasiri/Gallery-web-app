# Deployment and free-plan operations

Live app: [gallery-web-app-two.vercel.app](https://gallery-web-app-two.vercel.app). Vercel assigned the `-two` alias because the shorter name was already occupied.

| Resource | Configuration                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel   | gallery-web-app, Angular CDN + Express function, Node 22.x, iad1                                                                                                           |
| Firebase | gallery-web-app-kb-2026, Spark; native Standard Firestore `(default)`, Montreal northamerica-northeast1                                                                    |
| Supabase | Gallery / obtatkjgfthiapdyczed, khalifehbasiri's Org, Free, ca-central-1                                                                                                   |
| Storage  | private gallery-images-pending; public gallery-images; 5 MB; raster types only                                                                                             |
| Upstash  | Account-owned Free database claimed by the project owner; HTTP REST transport                                                                                              |
| Render   | [gallery-notifications.onrender.com](https://gallery-notifications.onrender.com), Free HTTP processor in My Workspace; Node 22, Virginia; idle sleep and cold starts apply |
| Resend   | Integration prepared; public sending awaits owned-domain verification and signed callback configuration                                                                    |

No paid upgrade or Google billing account was attached. Free plans have quotas and suspension/cold-start behavior. Watch the provider dashboards; alerts are not spending caps. Do not enable Firebase Blaze, paid backups/PITR/TTL, Cloud Functions/App Hosting, paid Redis plans or Vercel add-ons without a separate budget decision. Vercel Hobby is for personal, noncommercial projects. Current limits and terms are in [Firebase pricing](https://firebase.google.com/pricing), [Supabase pricing](https://supabase.com/pricing), [Upstash pricing](https://upstash.com/pricing/redis) and [Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Provisioning and environment

SQL migrations live in `supabase/migrations/` and their remote history is registered. The backend role has only gallery schema privileges and RLS policies. Its randomly generated login password was set outside migrations. Use the transaction pool, port 6543, with the trusted Supabase CA and certificate verification. The connection pool holds one socket per warm instance.

Firestore uses a dedicated service identity `gallery-artworks` and custom document IAM permissions. Browser Security Rules deny every client read/write. Rules/index exemptions are deployed from the Firebase files; descriptions/image references are not unnecessarily indexed. Server authorization still matters because server SDKs bypass browser rules.

Vercel production environment contains PostgreSQL URL/CA, Firebase project/service identity, Supabase URL/service key, JWT signing secret, Upstash REST URL/token, proxy setting and allowed frontend origin. Keep all values server-only and enter exact values without an unintended trailing newline. Service-account JSON should remain one serialized JSON value. Do not expose these as Angular build constants or public environment variables.

Local `.env`, `.env.test`, `.codex-local`, service-account keys, `.vercel`, exports and uploads are excluded from Git/deployment. Vercel derives NODE_ENV=production; cookies are Secure. Review `.vercelignore` before adding new sensitive files.

```sh
npm ci
npm test
npm run build
npm run format:check
vercel deploy --prod
```

The project is linked to GitHub; future main pushes can trigger Vercel builds using the same production variables. The production root requires the rewrite `/api/(.*)` to `/api/index`; named wildcard captures can otherwise become unknown query filters. CSP/security headers cover the static frontend as well as API responses. A successful build alone is not deployment verification.

## Verification and maintenance

Check `/api/health`, `/api/stats`, paginated discovery, registration/login, direct signed upload, review/like changes, refresh and logout after deployment. Inspect browser console/CSP failures and provider logs. Health reports runtime initialization/cache status, not exhaustive dependency readiness.

`npm run maintenance` removes expired refresh records, expired sessions without remaining refresh records, expired jti denials, and up to 100 expired unused uploads. Run it regularly from an authenticated operator machine; no paid scheduler is configured. It does not erase used/ambiguous publication objects. Review those and abandoned migration assets in Storage periodically. Never remove a referenced public object.

For a pending publication: inspect its SQL row and Firestore document by ID. If both match and the image exists, complete publication and invalidate Redis. If the document/image is missing, repair from the retained snapshot or remove the pending registry and unreferenced resources. Stop writes during manual reconciliation. Security mutations must use the fenced protocol; see [Redis](REDIS.md). Preserve manual SQL/document/image exports before changes; no paid managed backups are enabled.

The initial deployment was checked against all three hosted stores and real Redis. Temporary verification accounts, images and documents were removed afterward. The gallery was subsequently populated with the original 24 artwork fixture records, six portfolio samples, 13 accounts and one workshop. Six original images were recovered; 18 fixture images have labeled substitutions. Legacy MongoDB was unreachable, so historical account activity could not be recovered. [Migration](MIGRATION.md) remains available for that source.

Notification deployment uses [the separate processor and sender setup](NOTIFICATIONS.md). A free daily Vercel recovery check is configured for real due jobs; routine storage/security maintenance remains an operator command. Public demo account roles are fixed, and they cannot store personal email addresses or produce mail jobs.
