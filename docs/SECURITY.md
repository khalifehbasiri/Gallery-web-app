# Security implementation

## Credentials and locations

| Item                  | Browser                                                                                         | PostgreSQL                                                          | Redis                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Access JWT            | HttpOnly, Secure in production, SameSite=Strict cookie `gallery_token`, path `/`                | No raw JWT; durable `jti` denials with expiry                       | Expiring proof keyed by jti; no raw JWT               |
| Opaque refresh secret | Independent 32-byte random secret in HttpOnly Strict cookie `gallery_refresh`, path `/api/auth` | SHA-256 digest, session reference, expiry and consumption timestamp | No refresh secret or digest                           |
| Session ID            | Non-secret `sid` inside the signed JWT; device UI exposes owned IDs                             | Durable UUID session with user, idle/absolute expiry and revocation | Proof epoch and public user DTO accelerate validation |
| CSRF token            | Readable `XSRF-TOKEN` cookie sent as `X-XSRF-TOKEN`; signed binding cookie is HttpOnly          | Not needed                                                          | Not needed                                            |

JWT payloads are signed, not encrypted. A `sid` identifies a session; knowing it cannot authenticate, refresh, or revoke a session without the required credentials and CSRF proof. The refresh secret is separate and never included in a JWT or API response.

Access tokens expire after **10 minutes**, with five seconds of clock tolerance. Cookie expiry follows the session so an expired JWT can still trigger refresh after reopening an idle tab. Refresh rotates a random secret, with a **7-day sliding idle expiry** capped at **30 days from login**. Activity extends the idle expiry when refresh occurs, not on every HTTP request. Absolute expiry requires sign-in again.

Refresh locks the SQL session/token, atomically consumes the old digest and inserts its replacement. Reuse of a consumed secret revokes the session family. Angular coalesces concurrent refreshes; browsers with Web Locks serialize refresh across tabs. Without Web Locks, only same-tab coalescing is available and unusual concurrent multi-tab refreshes can trigger replay protection. No secrets use localStorage/sessionStorage.

## Revocation and compromise

JWT-only verification cannot detect immediate revocation. This app checks a durable session/denylist through Redis proofs and SQL fallback, using distributed mutation fences. `POST /api/auth/deny-token` denies the current signed-in JWT's jti until its expiry plus clock tolerance, then clears its cookie. It intentionally does not accept arbitrary user-supplied raw tokens. The refresh session remains usable: a legitimate holder can obtain a replacement JWT.

For a leaked refresh credential or unknown stolen token, revoke the device/session or use sign-out-all-devices. The same device is the token family. A blacklist alone cannot detect theft automatically. A successful revocation rejects subsequent authorizations across instances; it cannot cancel work already authorized. Security state must be changed through the fenced protocol. See [Redis consistency](REDIS.md).

## Browser defenses

Access, refresh and binding cookies are HttpOnly; all are Secure in production and SameSite=Strict. Auth uses same-origin username/password flows. Strict can omit cookies on the initial navigation from an external site; future OAuth callbacks would need a deliberate callback policy.

Every mutation, including login, registration, refresh and logout, needs a signed session-bound double-submit CSRF proof. Origin and Fetch Metadata checks reject external cross-site mutations. SameSite alone does not cover all same-site cross-origin situations. Cookie paths reduce exposure but are not an authorization boundary.

Comments, titles, descriptions and workshop text are plain text. The server checks types, lengths and control characters. Angular interpolation renders `<script>`, `onerror`, encoded payloads, apostrophes and Unicode as text. It does not strip legitimate punctuation or store pre-escaped HTML. Passwords preserve whitespace. Structured IDs, image types and numeric values have separate validation; SQL queries use parameters.

CSP covers both Express responses and Vercel static HTML: scripts/connects are limited to the app and the configured Storage host where appropriate; objects and framing are denied. Angular runtime styles require `style-src 'unsafe-inline'`. Uploads reject SVG and accept only PNG/JPEG/GIF/WebP with verified size/MIME/signature before publication. CSP and HttpOnly reduce risk; they do not completely eliminate XSS. Script already executing in the app can still perform actions, even if it cannot read an HttpOnly secret.

## Server identities and checks

PostgreSQL uses a restricted `gallery_backend` role, verified TLS and a private schema with RLS. Browser Data API roles have no gallery grants. Firestore client Security Rules deny access; the server SDK bypasses those rules and uses a dedicated custom IAM role for document get/create/delete and database metadata only. Express enforces ownership. Supabase's Storage service key is server-only; signed private upload URLs are short-lived bearer capabilities and must not be logged.

Tests cover Strict/HttpOnly cookies, expiry, CSRF binding, origin rejection, refresh replay, session ownership, logout, jti denial, parallel likes, personal cache isolation, malformed data, and Angular DOM injection regression. Live tests verify the actual hosted databases, signed Storage upload, refresh and revocation.
