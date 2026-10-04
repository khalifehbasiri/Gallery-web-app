# Demo community and image privacy

The gallery includes **fictional sample activity** for portfolio testing. It is not evidence of real customers, restored historical engagement, or authorship of museum works. The footer identifies the demo, fictional usernames end in `(Demo)`, comments begin with `[Demo comment]`, and collection descriptions credit the actual creators and The Metropolitan Museum of Art.

## What the community seed adds

| Fixture       | Amount | Purpose                                                       |
| ------------- | -----: | ------------------------------------------------------------- |
| Profiles      |     16 | Six artist-role curators and ten patrons                      |
| Curated posts |     24 | Four credited museum selections per curator                   |
| Likes         |    372 | Varied engagement across the 30 existing and 24 new posts     |
| Comments      |    133 | Between one and four sample comments per post                 |
| Follows       |     54 | Community relationships, including six new follows for `demo` |

These are additions to the existing hosted catalog and activity, giving 54 hosted posts. The temporary `npm run demo` starts with six collection entries and adds the same 24 community posts; activity totals there differ because its starting catalog is smaller. Both public login accounts keep their existing passwords.

Fictional profiles have random, unpublished passwords whose plaintext is discarded. They have no email addresses, verified status, accepted terms, sessions, or notification consent. Only the existing `demo` and `Maya Laurent` accounts have published login credentials. No real people are impersonated and no fabricated address receives mail.

## Image sources and private files

All 24 bundled JPEGs come from The Met's public-domain Open Access collection. The [image manifest](../shared/collection-images.ts) records public source URLs, museum object IDs, dimensions, licenses and pinned SHA-256 digests. The six restored original images came from public URLs in the original `JSON/` fixtures. Eighteen original records with missing images use explicitly credited reference images.

The community seed reads **only the verified museum image manifest and its bundled JPEGs**. It does not read `uploads/`, desktop photos, camera rolls or other personal files. It reuses these public images without uploading additional copies to Storage. The curators share collections; they do not claim to have painted the museum works.

An operator audit compared the 30 existing hosted image files against local upload-file hashes and found zero matches. Local upload bytes were not displayed or published during that audit. `uploads/`, `.env*`, `exports/` and `.codex-local/` are excluded from Git and Vercel deployment. User-requested image uploads remain a separate, intentional app feature.

## Storage, safety and repeatability

MongoDB stores each new full artwork document. PostgreSQL stores its published search projection, curator identity, unique likes, comments and follows. Publication reserves a pending SQL row, creates the document, then marks the projection public. The seed can resume an exact matching pending fixture after an interruption; conflicting content stops the command for review.

The operator prepares a fixed plan in ignored `exports/community-seed.json`. It scopes engagement to the prepared original catalog and the new demo posts, so future real user posts are not automatically filled with fake comments. Stable namespaced IDs and unique relational keys prevent duplicate activity on repeat runs. Existing accounts, passwords, documents and relationships are preserved. Sample comment ID conflicts roll back the relationship transaction instead of overwriting someone else's comment.

The relationship transaction locks users and posts in a consistent order and recomputes counters from all persisted relationships, including existing activity. PostgreSQL remains authoritative; Redis discovery/feed caches are invalidated after writes, including partial publication failures. Fresh reads rebuild the bounded feed pool. Bulk parameterized SQL avoids a network round trip per like or comment.

**Sample activity sends no emails:** this operator path does not enqueue notification jobs or call Resend. Ordinary application actions continue to use the consent and verification checks documented in the README.

## Run against hosted databases

First prepare the original catalog using `scripts/seed-hosted.ts`. Configure the ignored `.env` with the hosted MongoDB, PostgreSQL and Redis connections. Use the canonical HTTPS frontend origin so stored museum URLs resolve correctly.

PowerShell dry run:

```powershell
$env:CLIENT_ORIGIN='https://gallery-web-app-two.vercel.app'
npm run seed:community
```

After reviewing the scope, apply explicitly:

```powershell
node --env-file-if-exists=.env --import tsx scripts/seed-community.ts --apply
```

POSIX equivalent:

```sh
CLIENT_ORIGIN=https://gallery-web-app-two.vercel.app npm run seed:community
CLIENT_ORIGIN=https://gallery-web-app-two.vercel.app node --env-file-if-exists=.env --import tsx scripts/seed-community.ts --apply
```

Seeding never runs during deployment or through a public endpoint. Keep the prepared plan private: it includes password hashes, although no usable public password is assigned to fictional profiles. Retain it to retry interrupted runs. Do not delete it and reset existing profiles to newly generated passwords.

## Verification

The seed tests cover repeat runs without duplicates, preservation of existing passwords/content/activity, exact aggregate counters, absent email/consent/session data, no notification jobs, account/document collisions, transaction rollback on comment conflicts, pending-publication recovery and rejection of private-image or unlabeled-profile edits. Run `node --import tsx --test test/community-seed.test.ts` or the full project test suite.

This is a small functional dataset for pagination, profiles, follows and feeds. It is not a scalability benchmark; realistic latency and concurrency require separate load tests.
