# Web application engineering checklist

This maps the 37 requested areas to code, operational evidence and remaining work. It is an engineering checklist, not certification of universal standards, accessibility or legal compliance. See [architecture](ARCHITECTURE.md), [security](SECURITY.md), [accounts/privacy](ACCOUNT_LIFECYCLE.md), [CI/CD](CI_CD.md) and [deployment](DEPLOYMENT.md).

| #   | Area                    | Implementation / remaining limits                                                                               |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Responsive design       | Grid/Flexbox, breakpoints, fluid images/layouts                                                                 |
| 2   | Accessibility           | Labels, landmarks, skip link, focus, alerts, reduced motion; formal WCAG audit pending                          |
| 3   | Navigation/routing      | Lazy Angular routes, guards, direct URL support and not-found page                                              |
| 4   | Forms/validation        | Reactive forms, server validation, SQL/Mongo constraints                                                        |
| 5   | Authentication          | Salted scrypt, signed JWT, server-side session/revocation checks; no OAuth/2FA                                  |
| 6   | Login/logout            | Rotation, device revocation, sign-out-all and cookie clearing                                                   |
| 7   | Registration            | Required private email, username/password, legal acknowledgement, separate optional consent                     |
| 8   | Password reset          | Verified-email, random hashed 30-minute single-use secret; all sessions revoked; sender configuration required  |
| 9   | Authorization/roles     | Server role and ownership enforcement; protected demo roles                                                     |
| 10  | Sessions/cookies/tokens | Strict/Secure/HttpOnly auth cookies, opaque refresh, durable sessions and CSRF proof                            |
| 11  | Frontend state          | NgRx SignalStore, signals and RxJS cancellation                                                                 |
| 12  | Backend/API             | Express REST, TypeScript/shared contracts, server-only credentials                                              |
| 13  | Business logic          | Unique relationships, transactional counts, durable outbox and idempotent retries                               |
| 14  | Database                | Relational PostgreSQL plus MongoDB artwork documents                                                            |
| 15  | Models/relationships    | Foreign keys/composite keys, strict document validator, SQL publication projection                              |
| 16  | Storage/uploads         | Private staging, signed uploads, byte/MIME/size checks, public immutable images                                 |
| 17  | Discovery               | GIN full-text search, filters, stable newest-first order, bounded offset pages; cursor pagination future        |
| 18  | Errors                  | Consistent HTTP errors, safe 500 responses, UI feedback, rollback and retry/dead letters                        |
| 19  | Security                | Ownership, credential hashing, CSRF/CSP, scoped identities, fenced revocation                                   |
| 20  | HTTPS                   | HTTPS hosting, Secure cookies and verified database TLS                                                         |
| 21  | Input safety            | Plain-text fields, output escaping, typed validation and parameterized SQL                                      |
| 22  | Rate limits             | Shared Redis IP limits, SQL upload/mail limits; weaker local fallback during Redis outage                       |
| 23  | Performance             | Lazy assets/routes, OnPush, indexed/bounded queries and small pools; no large-scale benchmark                   |
| 24  | Caching                 | Redis public/proof TTLs, generation invalidation, private overlays, durable fallback                            |
| 25  | Scalability             | CDN/static separation, shared state, bounded pools and separate leased email processing; free-tier limits apply |
| 26  | Logging                 | Basic safe application/provider logs; structured tracing/audit logging pending                                  |
| 27  | Monitoring/alerts       | Liveness/cache status, provider dashboards; dedicated automated alerts pending                                  |
| 28  | Backups/recovery        | Migration snapshots and reconciliation procedures; automated backups/restore drills pending                     |
| 29  | Testing                 | API, Angular, real MongoDB/Redis, security/race/failure regressions and hosted smoke checks                     |
| 30  | Deployment              | Vercel, Atlas, Supabase, Upstash and Render Free; staged promotion pipeline                                     |
| 31  | Secrets/config          | Ignored local files, server-only provider settings, narrow processor credentials                                |
| 32  | CI/CD                   | Automated tests/build/format/runtime audit; gated deployment workflow needs owner-provided credentials          |
| 33  | Analytics               | No advertising/product analytics tracker installed                                                              |
| 34  | SEO                     | Basic route titles/description; SSR, rich artwork previews and sitemap pending                                  |
| 35  | Privacy/legal           | Notices, consent, export/deletion and retention; formal legal review/contact/provider assessment pending        |
| 36  | Documentation           | Architecture/API/security/operations/migration/account guides and evidence-linked checklist                     |
| 37  | Maintenance             | Daily bounded retention/deletion sweep, operator commands, lockfile and Dependabot; updates need review         |

Recruiter-facing claims should describe demonstrated techniques rather than assume a job title or certification: Angular/RxJS/NgRx, TypeScript Express APIs, MongoDB/PostgreSQL modeling, indexed queries, Redis consistency, token recovery/revocation, cloud storage, transactional outbox, Git and CI/CD. Docker application deployment, GraphQL, OAuth2, professional legal review and unlimited-scale performance are not claimed.
