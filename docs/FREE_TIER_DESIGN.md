# Agreed free-tier design — implemented

Implemented October 3, 2026. See [architecture](ARCHITECTURE.md), [security](SECURITY.md), [deployment](DEPLOYMENT.md), [Redis](REDIS.md) and [migration](MIGRATION.md) for current behavior and verification.

| Service  | Choice                                     | Purpose                                                                           |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| Firebase | Spark, Standard/native Firestore, Montreal | Artwork documents; server-only IAM, denied browser rules                          |
| Supabase | Free, Canadian region                      | Normalized PostgreSQL accounts/relationships/security and validated image storage |
| Upstash  | Account-owned Free                         | Public data caching, rate limits and fenced authorization proofs                  |
| Vercel   | Personal Hobby deployment, Node 22         | Angular CDN and same-origin Express API                                           |

Native Firestore replaces the artwork persistence layer; it is not a MongoDB connection-string swap. PostgreSQL's GIN projection performs bounded full-text search. MongoDB remains only in the read-only legacy exporter. No PostgreSQL/Firebase/Storage transaction spans all services; pending publication and reconciliation handle partial failure.

Security uses Strict HttpOnly cookies, ten-minute access JWTs, independently random opaque refresh secrets, hashed durable refresh records and non-secret session IDs. Refresh has a seven-day sliding idle expiry with a thirty-day absolute cap. CSRF proofs, Origin/Fetch Metadata checks, plain-text validation, Angular escaping and CSP are layered defenses. JWT jti denial and session-family/device revocation are durable; Redis never stores bearer secrets or becomes their sole authority.

Public counts, comments and details are cached while personal flags stay separate. Security mutations fence proofs across instances; unavailable reads use SQL, and unavailable write fencing rejects the mutation. Quotas, SQL queries, upload bytes, retries and cleanup are bounded, but free hosting cannot promise unlimited capacity or availability.

Only free plans were provisioned. No Google billing attachment, Firebase Blaze upgrade, paid add-on or Docker application hosting was configured. GitHub Actions quality checks and gated deployment configuration were added on October 4; see [CI/CD](CI_CD.md). Review [Firebase pricing](https://firebase.google.com/pricing), [Supabase pricing](https://supabase.com/pricing), [Upstash pricing](https://upstash.com/pricing/redis) and [Vercel Hobby terms](https://vercel.com/docs/plans/hobby) before changing services. Budget alerts on a paid plan are not a spending cap.

Existing Git history was left unchanged. The old database/uploads were not erased. The current source MongoDB is unreachable; migration tooling is verified but actual source-data transfer awaits that connection.
