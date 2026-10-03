# Proposed free-tier hosting and security design

Status: design only. The application still uses MongoDB, its existing 24-hour JWT/session authentication, SameSite=Lax cookies, and the existing discovery cache. No cloud services, migrations, or billing changes have been made by this document.

## Cost constraint

Use free plans only. Do not attach a Google Cloud billing account, upgrade Firebase to Blaze, enable paid add-ons, or accept a pay-as-you-go plan. When quotas are exhausted, reduce functionality or return a clear temporary-unavailability response rather than purchasing capacity. Budget alerts on a paid plan are not a spending cap.

Pricing checked on October 3, 2026:

| Service       | Plan           | Purpose                                             | Relevant limits                                                                                                                                                                      |
| ------------- | -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firestore     | Firebase Spark | Artwork descriptions and flexible metadata          | Standard: 1 GiB, 50,000 document reads/day, 20,000 writes/day. Enterprise: 1 GiB, 50,000 read units/day, 40,000 write units/day. Units are not interchangeable with document counts. |
| Supabase      | Free           | PostgreSQL relational records and image storage     | 500 MB database, 1 GB storage; project can pause after a week of inactivity.                                                                                                         |
| Upstash Redis | Free           | Public response cache and distributed rate limiting | 256 MB, 500,000 commands/month, 10 GB bandwidth/month.                                                                                                                               |
| Vercel        | Hobby          | Angular assets and Express API under one origin     | Personal, noncommercial use; functions and bandwidth have quotas.                                                                                                                    |

Sources: [Firebase pricing](https://firebase.google.com/pricing), [Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Supabase pricing](https://supabase.com/pricing), [Upstash Redis pricing](https://upstash.com/pricing/redis), [Vercel Hobby](https://vercel.com/docs/plans/hobby).

Keep Firebase Cloud Functions, Firebase App Hosting, Firebase Storage, paid TTL deletion, managed backups, and point-in-time recovery outside this design. Use Supabase Storage for images and local manual exports for backup.

## Database boundaries

Firestore owns artwork documents: stable artwork ID, artist ID, title, description, medium, year, category, image reference, and creation time. PostgreSQL owns users, credentials, sessions, refresh-token records, likes, follows, reviews, workshops, and enrollment. Each fact has one authoritative owner. Public counts are derived or cached, not a second authoritative copy.

Firestore is a different database engine from MongoDB. Firebase's current pricing lists free quotas for both editions. If retaining the existing MongoDB driver API, select Enterprise MongoDB compatibility and verify that provisioning stays on Spark without a billing account. Test the actual Mongoose version, weighted text search, ordered pagination, indexes, aggregate operations, and update operators before changing the application connection. Never silently fall back to a billed configuration.

Standard/native Firestore is an alternative if the compatibility path cannot meet the cost or query requirements. It requires replacing Mongoose persistence for artwork documents. It is not a connection-string-only change; native Firestore also needs a deliberate alternative to the existing MongoDB full-text search. Keep bounded indexed filtering/pagination and do not download whole collections to search them in the browser.

Keep browser database access denied for server-owned records. Use a least-privilege backend identity for Firestore. If native Firestore uses an Admin/server SDK, its access bypasses client Security Rules: Express authorization and backend IAM still matter. Keep PostgreSQL tables in a private schema or enforce RLS and correct grants on exposed tables. The existing custom JWT does not automatically become Supabase Auth or populate auth.uid().

Stable IDs join records in Express; PostgreSQL foreign keys cannot reference Firestore. There is no atomic transaction across the two databases. Design publication/deletion as idempotent operations with recoverable partial failures and explicit orphan cleanup. Export, dry-run, verify counts and references, and retain rollback data before any migration.

## Cache design

Cache public artwork details, public review pages, gallery lists, artist summaries, workshop listings, and statistics. Start with approximately 60-second expiry and adjust from measured usage. Invalidate affected public data after successful database writes; cache failures do not undo database changes.

Assemble user-specific liked/following/joined/owned fields after loading public content. Do not place personalized response objects, credentials, raw JWTs, or refresh secrets in the shared content cache. Keep final personalized HTTP responses private and no-store.

Every cache lookup can involve multiple Redis commands; 500,000 commands is not 500,000 page views. Preserve bounded command timeouts, in-flight coalescing, and database fallback. Bound fallback queries and rate-limit expensive requests so a Redis outage does not cause unbounded Firestore reads. Authentication outages must not permit unauthorized requests; an unavailable revocation authority rejects authentication.

## Cookie and CSRF policy

Use SameSite=Strict for access and refresh cookies in the current same-origin username/password flow, with HttpOnly and Secure in production. Keep Angular and /api on the same site and preferably the same origin. A cookie might be omitted on the first request when following an external link; this is the usability tradeoff accepted for Strict. Revisit callback-specific behavior if OAuth is later added.

Keep Origin and Fetch Metadata validation, and add a session-bound CSRF token for mutations, including refresh and logout. A CSRF token may be readable by Angular; the authentication cookies remain HttpOnly. SameSite controls cross-site behavior, not all cross-origin behavior, and does not stop script already executing in our application.

Vercel serves frontend assets separately from Express, so CSP and other security headers must also cover the Angular HTML/CDN routes. Keep text interpolation, avoid unsafe HTML sinks, and tighten image/style policy without breaking Angular.

## Text fields and script injection

Comments, titles, descriptions, workshop content, and names are plain text. Enforce server-side types, field lengths, allowed structured values, and appropriate control-character rules. Passwords must not be trimmed or passed through text sanitization.

Render free-form content through Angular text interpolation/text nodes, preserving Unicode and legitimate punctuation. A string such as <script>alert(1)</script> is inert text, not a script. Avoid innerHTML, bypassSecurityTrustHtml, and regex-based script blacklists. Do not store HTML-encoded text and then encode it again at rendering time.

If formatted HTML becomes a product requirement, use a maintained allowlist HTML sanitizer, exclude scripts/event handlers/dangerous URL schemes, and continue context-appropriate output handling. Use parameterized PostgreSQL queries; HTML sanitization does not prevent SQL injection.

Verification must include script tags, image onerror, javascript URLs, encoded payloads, legacy database content, ordinary apostrophes, and non-English text. Test both API validation and actual Angular DOM rendering.

Source: [OWASP input validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).

## Access and refresh credentials

Use a short-lived access JWT (initial target: 10 minutes) plus a separate opaque refresh secret (initial absolute lifetime: 7 days). Generate at least 32 cryptographically random bytes for the refresh secret; store only its SHA-256 digest in PostgreSQL with user ID, session ID, token family, expiry, and consumption/revocation timestamps.

The session ID included in a JWT identifies a session and is not the refresh credential. The opaque refresh secret must never appear in the JWT, URLs, logs, public DTOs, or browser storage. Store it in an HttpOnly, Secure, SameSite=Strict cookie sent only where needed. Cookie paths reduce exposure but are not an authorization boundary.

POST /api/auth/refresh atomically consumes a refresh token and issues a replacement plus a new access JWT. A previously consumed credential indicates possible replay and revokes its token family. Define frontend request coalescing and multi-tab refresh coordination so normal concurrent requests do not create false replay incidents. Use database transactions/conditional updates; never implement rotation as separate unguarded reads and writes.

Logout revokes the session family and clears both cookies. Provide sign-out-all-devices. Continue checking durable session revocation for access JWTs to preserve immediate revocation; otherwise a stolen access token remains usable until its short expiry. Do not cache positive authorization in a way that restores or prolongs a revoked session. Redis may accelerate revocation checks, but data loss/eviction must not reactivate sessions.

Opaque credentials simplify server-side control but are still bearer secrets. Rotation helps detect reuse; it cannot identify theft before the credential is used.

Sources: [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP refresh-token guidance](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html).

## Implementation sequence

1. Add Strict-cookie, CSRF, field-validation, and XSS regression coverage while retaining the existing persistence.
2. Implement opaque refresh rotation and session management with expiry/replay/concurrency tests.
3. Add PostgreSQL persistence and verify migrations in an isolated database; export and validate legacy records.
4. Verify Firestore edition, Spark plan, driver/query compatibility, and credentials; migrate artwork persistence only after isolated checks.
5. Expand public caching and adopt Supabase Storage direct uploads with server-authorized publication and validation.
6. Adapt Angular assets, Express routing, connection pools, headers, and upload limits for Vercel; deploy an isolated preview and verify complete user flows.

The current API allows 5 MB image uploads; Vercel functions accept at most 4.5 MB request payloads. Direct-to-storage uploads avoid routing those bodies through a function. Preserve server-side checks before publishing uploaded content, cap storage use, and handle orphan objects after failed publication.

Account/project selection, region, and credentials are required for actual provisioning. Inspect the target resources first; do not create paid projects or use a trial that later becomes billable. Existing Git history remains unchanged.
