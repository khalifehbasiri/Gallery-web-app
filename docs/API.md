# REST API

JSON endpoints under `/api`; errors are `{ "error": "message" }`. Bearer credentials use cookies, never response bodies. All mutations require the `X-XSRF-TOKEN` header matching the signed CSRF binding. Call `/auth/csrf` first; Angular handles this automatically. Server Origin/Fetch Metadata checks also apply.

| Method       | Endpoint                                        | Purpose / access                                                                   |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET          | /health                                         | Runtime health and Redis state; public                                             |
| GET          | /stats                                          | Public counts/categories                                                           |
| GET          | /auth/csrf                                      | Issue/reuse CSRF cookies; public                                                   |
| POST         | /auth/register                                  | `{username,password}`; creates patron; rate limited                                |
| POST         | /auth/login                                     | `{username,password}`; issue access/refresh cookies; rate limited                  |
| POST         | /auth/refresh                                   | Rotate refresh secret and JWT; cookie-bound; rate limited                          |
| POST         | /auth/logout                                    | Revoke current session and clear cookies; supports expired access JWT              |
| GET          | /auth/me                                        | Public user or null; 401 when cookies require refresh                              |
| GET          | /auth/sessions                                  | Up to 100 owned active sessions; signed in                                         |
| DELETE       | /auth/sessions/:id                              | Revoke owned device/session; signed in                                             |
| POST         | /auth/logout-all                                | Revoke all owned sessions; signed in                                               |
| POST         | /auth/deny-token                                | Deny current JWT jti; signed in                                                    |
| GET          | /artworks                                       | Public paginated discovery                                                         |
| GET          | /artworks/:id                                   | Public detail, first 12 reviews and artist                                         |
| GET          | /artworks/:id/reviews                           | Public paginated reviews                                                           |
| POST         | /uploads                                        | `{contentType,bytes}`; signed private upload reservation; artist                   |
| POST         | /artworks                                       | `{title,year,category,medium,description,uploadId}`; validated publication; artist |
| PUT / DELETE | /artworks/:id/like                              | Idempotent save/unsave; signed in                                                  |
| POST         | /artworks/:id/reviews                           | `{text}`; signed in                                                                |
| DELETE       | /artworks/:id/reviews/:reviewId                 | Review author only                                                                 |
| GET          | /artists/:id                                    | Public profile/artworks/workshops, bounded sections                                |
| PUT / DELETE | /artists/:id/follow                             | Idempotent follow/unfollow; signed in                                              |
| GET          | /workshops                                      | Public paginated workshops                                                         |
| POST         | /workshops                                      | `{name,goal,weeks}`; artist                                                        |
| PUT          | /artists/:id/workshops/:workshopId/registration | Idempotent enrollment; signed in                                                   |
| GET          | /account                                        | Private collection/studio, sections capped at 48                                   |
| PATCH        | /account                                        | `{role:artist}` or `{role:patron}`; owned account                                  |

Artwork filters: `page` 1–500, `limit` 1–48 (default 12), `search` up to 120 characters (PostgreSQL full-text), exact `category`, exact artist username. Unknown filters are rejected. Workshop/review pages accept page/limit. Lists return `{items,total,page,limit,pages}`. Art/account IDs are 24 hex characters; session IDs are non-secret UUIDs.

User DTOs contain only id/username/role. Registration passwords require 8–256 characters; whitespace is preserved. Reviews allow 1–2000 plain-text characters. New workshop duration is 1–9999 whole weeks. Field controls and bounds apply server-side.

Public content may be cached for 60 seconds. Signed-in requests receive separately overlaid liked/following/joined/owned flags. Final responses are private/no-store; `X-Cache` reports HIT/MISS/BYPASS. Authoritative ownership checks always run outside content-cache data.

Image upload flow: reserve, PUT raw bytes to the returned signed Storage URL, then POST artwork metadata with uploadId. Allowed types: PNG/JPEG/GIF/WebP; maximum 5 MB. Publication returns 201; a completed retry with identical metadata returns 200 and the same artwork ID. Different retry metadata returns 409. Reservation expiry is 15 minutes; signed storage capabilities can outlive that, but publication cannot use an expired reservation. Consumed failed reservations require a fresh upload or operator reconciliation. Storage bytes are never multipart-posted through Vercel.

API throttling returns 429; configured security-fence unavailability returns 503; validation 400; authentication 401; ownership/CSRF 403; missing records 404; identity conflicts 409. See [security](SECURITY.md) and [Redis](REDIS.md).

# Email notifications

All account routes require authentication and the usual CSRF proof for mutations:

| Method | Path                        | Behavior                                                            |
| ------ | --------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/notifications`        | Delivery availability and this account's email preferences.         |
| POST   | `/api/notifications/email`  | `{email, consent:true}`; queue a rate-limited verification message. |
| POST   | `/api/notifications/verify` | `{code}`; confirm address ownership and enable notices.             |
| DELETE | `/api/notifications`        | Disable notices and invalidate outstanding verification.            |

`GET/POST /api/notifications/unsubscribe` accepts a signed, version-bound opt-out capability; GET does not mutate. `POST /api/notifications/webhook` verifies the Resend/Svix signature over raw bytes instead of using browser CSRF. `GET /api/internal/notifications` requires `Authorization: Bearer <CRON_SECRET>` and wakes the processor only for due SQL jobs. The Render processor's `POST /jobs/process` requires its separate worker secret.

## Account lifecycle extension

All browser mutations require the same origin and signed CSRF proof, including anonymous recovery. Registration now requires `username`, `email`, `password`, `acceptedTerms: true` and optional `notifications: false`. Email is private and uniquely indexed; existing usernames still log in.

| Method/path                    | Behavior                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| POST /api/auth/forgot-password | Email; generic 202 regardless of account eligibility, bounded address/IP attempts                    |
| POST /api/auth/reset-password  | Single-use token + new password; revoke all sessions, clear cookies, require login                   |
| POST /api/auth/verify-email    | Single-use token; verify current email, enable notifications only with active consent                |
| GET /api/account/identity      | Owned private email/verification status, sender availability and demo restriction                    |
| POST /api/account/email        | Current password + email; save/change and request verification; old challenges invalidated on change |
| PATCH /api/notifications       | Boolean enabled; opt-out clears active consent, opt-in needs verified linked email                   |
| POST /api/account/export       | Current password; attachment JSON excluding credential material; oversized exports return 413        |
| DELETE /api/account            | Current password + confirmation DELETE; 202 retirement with durable cleanup                          |

The authenticated daily `/api/internal/notifications` cron also runs bounded retention/deletion maintenance even when email sending is disabled. Recovery/verification require a configured sender; registration remains available while email delivery is disabled. See [account lifecycle](ACCOUNT_LIFECYCLE.md).
