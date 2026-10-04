# Notification setup and operations

Appreciation emails are opt-in. SQL is the durable source for both likes and delivery intent; Redis carries notification IDs as expendable scheduling hints. The processor never batches likes into a delayed database write.

## Current deployment and prerequisites

The code supports Resend delivery and a Render Free HTTP processor. Public sending remains disabled until a domain you own is verified and signed callbacks are configured. An Outlook/Gmail mailbox cannot verify the provider's domain. Resend's `onboarding@resend.dev` sender is restricted to the account owner's address; see [Resend's testing rules](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

The deployed Redis → Render → Resend path passed a delivery-simulator test and one authorized account-owner inbox test, each in one send attempt. Resend reported `delivered` for the simulator and `opened` for the inbox test. Both temporary SQL test fixtures were removed, and the processor was returned to disabled delivery configuration. The owner's address remains private. This checks the provider integration without claiming public sender setup is complete. [Resend's simulation addresses](https://resend.com/docs/dashboard/emails/send-test-emails) count against the sending quota.

Keep these values in ignored `.env` and provider secret settings:

| Variable                                             | Where                                 | Purpose                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                                     | API and processor                     | Email API authorization; never sent to Angular.                                                                                                |
| `RESEND_FROM`                                        | API and processor                     | Sender on an owned verified domain, or `Atelier <onboarding@resend.dev>` for restricted tests.                                                 |
| `RESEND_PUBLIC_SENDING=true`                         | API and processor, after verification | Explicitly enables production public delivery, together with the webhook secret. Default is false.                                             |
| `RESEND_TEST_RECIPIENT`                              | API and processor, test mode only     | Exact Resend account-owner address. Other recipients are rejected. Remove before enabling public sending.                                      |
| `RESEND_WEBHOOK_SECRET`                              | API and processor                     | Resend/Svix signing secret. API verifies callbacks; public-mode processor configuration also requires this gate.                               |
| `NOTIFICATION_ENCRYPTION_KEY`                        | API and processor                     | Independent random 32+ character key for AES-GCM email payloads. Preserve it while jobs are pending; key changes make old jobs unreadable.     |
| `NOTIFICATION_WORKER_SECRET`                         | API and processor                     | Independent random 32+ character secret authenticating wake requests.                                                                          |
| `NOTIFICATION_WORKER_URL`                            | API                                   | HTTPS Render origin.                                                                                                                           |
| `CRON_SECRET`                                        | API                                   | Independent random secret authenticating daily recovery.                                                                                       |
| `DATABASE_URL`                                       | Each service, different roles         | API uses `gallery_backend`; processor uses `gallery_mail_worker`, whose login password is provisioned outside Git.                             |
| `DATABASE_CA_CERT`                                   | Both                                  | Trusted PostgreSQL TLS CA.                                                                                                                     |
| `SUPABASE_URL`, `REDIS_SCOPE_ID`, `REDIS_KEY_PREFIX` | Both                                  | Same non-secret project identity/prefix so both services use the same queue namespace. Preserve the existing scope ID across database changes. |
| Upstash REST URL/token                               | Both                                  | Redis queue transport, avoiding idle TCP connections.                                                                                          |

Generate independent keys with Node's `crypto.randomBytes(32)`. The processor receives no application JWT signing secret, MongoDB/Firestore credentials or Supabase storage service key. Its database role can read notification preferences/suppressions, lease/update outbox rows and reserve email budgets; it cannot read users, password hashes, sessions or refresh tokens.

## Enable a verified sender

1. Add an owned domain in Resend. Publish the exact DNS records Resend provides, verify SPF/DKIM, and configure DMARC for that domain. No paid plan or purchased domain is provisioned by this project.
2. Set the sender and API key. Create a webhook targeting `https://gallery-web-app-two.vercel.app/api/notifications/webhook` for `email.bounced` and `email.complained`. Put its signing secret in the API configuration, and the public-mode gate configuration on the processor.
3. Set `RESEND_PUBLIC_SENDING=true`, remove `RESEND_TEST_RECIPIENT`, and redeploy both services. The application blocks production sending without its independent encryption key and signed-webhook configuration.
4. Sign in with a private account, visit Account → Email notifications, explicitly opt in, request a verification code, and confirm it. Shared demo accounts cannot accept an address or produce notifications.

For a restricted owner-only test, keep public sending false, use `onboarding@resend.dev`, and set the owner address as `RESEND_TEST_RECIPIENT`. This mode exercises delivery without pretending public notifications are available. Do not publish the owner's address in README or source.

## Render deployment

`render.yaml` intentionally defines `type: web`, `plan: free`. Build with `npm ci --include=dev && npm run build:api`, start with `npm run worker`, and set `/health` as the health check. `NPM_CONFIG_INCLUDE=dev` ensures TypeScript is installed for builds even with `NODE_ENV=production`; it does not enable development mode in the running service. The service listens on Render's `PORT`. Set its `DATABASE_URL` to the mail-worker connection, not the API connection. Use Node 22.

The server accepts only authenticated `POST /jobs/process` requests. It responds 202 and drains real jobs in its persistent process. Startup and a 60-second loop recover due SQL work while it is awake. SIGTERM stops dequeueing, waits for the active bounded batch, then closes resources.

Render Free sleeps after idle inbound traffic. Cold-start delays, service suspension, free-hour limits and delivery backlog are accepted constraints. There is no synthetic keepalive. Vercel runs a recovery check once daily, around 12:00 UTC, with Hobby scheduling precision; it wakes Render only for due jobs. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). An always-on processor can later run the same command on a paid worker plan, but no such plan is enabled.

## Delivery semantics and limits

The like transaction inserts the unique relationship, updates its count and inserts eligible notification intent. Self-likes, duplicate likes, public demo users and non-verified/non-opted-in recipients do not queue mail. Per-recipient hourly limits avoid flooding inboxes; notices describe a single eligible appreciation rather than summarize all suppressed events.

The API registers post-response dispatch through Vercel `waitUntil`, adds UUID hints to a Redis sorted set and sends an authenticated wake request. If any of that fails, the SQL outbox remains. Removing a Redis hint does not mark a job delivered. The processor reads due SQL jobs even with no hints and claims them atomically using `FOR UPDATE SKIP LOCKED`, a random lease ID and a two-minute expiry.

Payloads are frozen at enqueue time and encrypted with AES-256-GCM. Each send rechecks the current recipient version, consent/verification, suppression and configured test restriction. Five jobs are processed per batch, with an eight-second provider request timeout. Retries use exponential backoff/jitter; eight attempts or a 23-hour uncertain-retry window lead to dead-letter review. Provider idempotency is retained for 24 hours, so old uncertain sends are not automatically retried beyond that guarantee. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

Every send attempt reserves daily/monthly SQL budgets first: at most 90/day and 2,700/month for this application, including retries. Free accounts have additional provider rate/quota limits; other apps using the same account also consume those limits. Delivery acceptance is not proof the recipient read the email, and no push-notification service is implemented.

## Monitor, recover and maintain

Use authenticated operator access to inspect status counts and due-job age, without printing payloads, tokens or addresses:

```sql
select status, count(*) from gallery.notification_outbox group by status;
select min(created_at) as oldest_pending from gallery.notification_outbox where status='pending';
select period, attempts from gallery.email_budget order by period desc;
```

`npm run notifications:process` processes one bounded batch using configured credentials; it can actually send mail, so use it only when delivery is intended. `npm run maintenance` removes completed/cancelled jobs after 30 days, old webhook IDs and expired verification/abuse records. It preserves pending and dead jobs and all bounce/complaint suppressions. Dead letters require operator review; do not blindly replay an uncertain send after its provider deduplication window.

Signed opt-out links only disable the matching preference version; they are not login tokens. GET displays a confirmation and POST performs the opt-out, including mail-client one-click requests. Suppression is rechecked before sending. Already accepted/in-flight messages may still arrive after opt-out.

Tests cover atomic rollback, duplicate likes, lease recovery/concurrent consumers, stable retry payloads/keys, provider errors, quotas, ownership verification, five-guess lockout, per-address abuse limits, raw webhook signatures/deduplication, opt-out, public-demo restrictions and the authenticated daily recovery endpoint. A live Redis test verifies queue deduplication and competing consumers. Browser tests verify optimistic likes roll back on API failure.
