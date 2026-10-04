# Accounts, recovery and privacy controls

New registrations require a username, email, password and explicit terms acknowledgement. Emails are normalized to lowercase and uniquely indexed in the private PostgreSQL schema. Existing accounts remain usable; they can attach an email after confirming their current password. Shared demo accounts cannot attach private email, reset their passwords or be deleted. Public user responses never expose email. Terms version/time and optional notification consent version/time are separate records.

## Email ownership and notifications

Signup sends an account verification link when a sender is available. Its 32-byte random secret is separate from access JWTs, refresh secrets and session IDs. The challenge table stores SHA-256 only. The encrypted outbox temporarily contains the frozen email, including the link needed for delivery. The link uses a URL fragment, which browsers do not transmit in HTTP URLs; Angular removes it from history and sends it in a CSRF-protected POST when the user confirms. Opening a link does not change account state.

Verification consumes the challenge exactly once within 30 minutes and verifies the current account email. Notification signup consent is unchecked by default. A verified address enables appreciation mail only if the user previously opted in. Account settings can disable or re-enable it without repeating verification. Disabling clears active consent and cancels eligibility for queued appreciation messages; it does not disable requested password recovery/verification. A message already accepted by a provider cannot be recalled.

Changing an email requires the current password, clears verification and notification preferences, and invalidates previous recovery/verification links. Account mail requests have a shared three-per-hour address limit; IP limits also cover recovery endpoints. Suppressed addresses and public demo accounts are ineligible. Production delivery remains off until an owned Resend sender and signed bounce/complaint webhook are configured. An Outlook address is not an owned sender domain. Unverified accounts can sign in with their username, but cannot recover through an unproven address.

## Password reset

1. `POST /api/auth/forgot-password` accepts an email and returns the same 202 message for known, unknown, unverified and throttled addresses. A 300 ms minimum response duration reduces obvious timing differences; it is not a constant-time network guarantee.
2. For an eligible verified account, a transaction invalidates older reset challenges and inserts a 30-minute challenge plus encrypted outbox job. Redis carries only job IDs. No raw recovery secret is returned by the API or logged.
3. The existing Render processor leases the job, checks challenge eligibility, suppression and budget, and sends through Resend with the stable job ID as its idempotency key. Expired/consumed challenges cancel delayed mail.
4. `POST /api/auth/reset-password` validates the secret and a new 8–256 character password. It locks the user/challenge, replaces the salted scrypt hash, consumes remaining challenges and revokes every session in one transaction under the Redis security fence.
5. Cookies are cleared; the user signs in again. The old password, existing access JWTs and refresh sessions no longer authorize new requests. Work already authorized can finish.

The reset is independent of notification consent. GET requests and email link scanners cannot consume it. A password reset does not automatically sign the user in. These controls follow [OWASP's recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); they are not an OWASP certification.

## Data export

`POST /api/account/export` requires authentication, CSRF and the current password. The JSON contains the private account profile, legal acknowledgement, preferences/consent, likes, reviews, follows/followers, workshops/enrollments, upload metadata, session timing, mail status history, SQL artwork registry and full owned MongoDB artwork documents. Password hashes, refresh/reset digests, JWTs, encrypted email payloads and other users' email are excluded. Image URLs are included; image bytes can be downloaded separately. There is no persistent export file on the server.

To fit the free serverless response/time limits, exports exceeding 1,000 rows in any category or 4 MB fail with 413 and require an operator-assisted export. They are not silently truncated. Very large document exports may also need operator assistance because provider timeouts apply. The PostgreSQL snapshot and subsequent MongoDB reads do not form a cross-database snapshot.

## Account deletion

`DELETE /api/account` requires the current password and the exact confirmation `DELETE`. Shared demo accounts are protected. A fenced SQL transaction revokes sessions, scrubs username/email/password and legal acknowledgement, hides artwork, removes notification jobs/preferences/challenges and activity, recalculates affected counts, and stores a durable cleanup manifest. Foreign-key triggers lock/check active users so newly inserted content cannot revive a retired account. Publication has a separate check before becoming public.

Cleanup leases a job with `SKIP LOCKED`, removes up to five MongoDB documents and five image paths per iteration, and checkpoints successful removals. Failures retain the job; expired leases can be recovered. Final SQL deletion removes artwork dependencies, refresh/security/upload records, the retired user and the cleanup job after external cleanup succeeds. Other users' reviews/enrollments attached to deleted artwork/workshops disappear with that content.

Supabase [signed upload URLs remain valid for two hours](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), independently of app authentication. Cleanup therefore retains a final image sweep until those capabilities expire, preventing a late upload from recreating an orphan. The existing daily authenticated Vercel cron now runs retention/deletion maintenance as well as notification recovery; `npm run maintenance` can accelerate cleanup. Free quotas, provider outages and backlog can delay completion. Cached public content can persist until expiry; already downloaded copies cannot be recalled.

## Retention and operator responsibilities

| Data                                             | Retention / cleanup                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Account and published content                    | Until deletion; immediate retirement, retryable external cleanup                                                                      |
| JWT / session / refresh                          | JWT 10 min; idle 7 days, absolute 30 days; expired SQL rows removed                                                                   |
| Account verification/reset                       | 30 min single-use; expired challenges removed                                                                                         |
| Notification code                                | 30 min, five guesses; expired hash cleared                                                                                            |
| Completed/cancelled/dead email payloads          | 30 days, then deleted                                                                                                                 |
| Expired account-mail jobs                        | Cancelled when challenge is no longer eligible                                                                                        |
| Webhook deduplication                            | 30 days                                                                                                                               |
| Hashed address abuse counters                    | 7 days                                                                                                                                |
| Send budgets                                     | 90 days                                                                                                                               |
| Bounce/complaint suppressions                    | Up to 3 years; independent of account deletion                                                                                        |
| Redis content/auth proofs                        | Normally at most 60 sec; throttle keys expire by window                                                                               |
| Unused uploads                                   | 15 min reservation; cleanup after two-hour signed capability expires                                                                  |
| Provider logs/caches/backups                     | Provider-specific; audit the provider settings                                                                                        |
| Operator snapshots and retained Firestore source | Inventory, restrict access and purge within 30 days unless documented preservation is required; reconcile deletion before any restore |

The daily maintenance workload is bounded: two deletion iterations and ten expired upload removals, plus SQL expiry cleanup. A backlog must be reviewed and processed by an operator; no paid scheduler is introduced. Manual backups and the old Firestore migration source are outside automated live-store deletion. Operators must apply deletion to retained copies, record completion privately and never reintroduce deleted accounts during restore. A comprehensive automated backup/restore system is not implemented.

See [technical legal readiness review](LEGAL_REVIEW.md), [privacy notice](https://gallery-web-app-two.vercel.app/privacy) and [terms](https://gallery-web-app-two.vercel.app/terms).
