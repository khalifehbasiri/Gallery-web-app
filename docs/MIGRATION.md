# Migration and rollback

The live app uses MongoDB for artwork documents and PostgreSQL for relational data. The previous Firestore source and original local `uploads/` remain intact. Keep snapshots inside ignored `exports/`, protect access, and never upload them to Git or Vercel. Legacy exports can contain password hashes and account data.

## Firestore-to-MongoDB cutover

The dedicated Atlas Gallery project runs a Free M0 cluster. Only artwork documents move; accounts, passwords, sessions, likes, comments, workshop enrollments, counters and storage objects keep their existing homes and IDs.

1. Configure server-only `MONGODB_URI` and `MONGODB_DATABASE=gallery`. Keep the existing `REDIS_SCOPE_ID` on both API and processor so cached revocation proofs and queued notification IDs retain their namespace.
2. Deploy the migration-capable API with `ARTWORK_BACKEND=firestore` and `ARTWORK_WRITES_PAUSED=true`. Confirm authenticated upload/publication requests return 503 while browsing still works. Allow existing requests to drain before the final export. Pause other scripts/clients that could publish artwork too.
3. Export current documents through their SQL registry, not the old seed file. Reconcile any pending/missing documents first. Exports refuse to overwrite an existing snapshot.
4. Create/verify MongoDB's strict collection validator, then copy and verify every field against the retained snapshot and SQL projection. Existing matching IDs are skipped; conflicting content stops the copy without overwriting it. No relational rows are rewritten. A failed copy can leave partial target documents, and a rerun safely completes them.
5. Recheck the source before cutover. Set `ARTWORK_BACKEND=mongodb`, remove Firebase credentials from the live API environment, and deploy with `ARTWORK_WRITES_PAUSED=false`. Verify existing logins, detail pages, uploads/publication, likes/comments and session continuity. Keep the source and snapshots until acceptance.

```sh
npm run artworks:migrate -- export exports/firestore-artworks-cutover.json
npm run mongo:prepare
npm run artworks:migrate -- copy exports/firestore-artworks-cutover.json
npm run artworks:migrate -- verify exports/firestore-artworks-cutover.json
npm run artworks:migrate -- verify-source exports/firestore-artworks-cutover.json
```

The Gallery cutover verified all 30 current documents and an immediate rerun inserted zero records. The first backup is retained separately from the final cutover snapshot. Runtime requests do not mutate collection schemas. The native driver stores the original string artwork ID as `_id` and returns the shared `id` contract to the API.

Before reopening publication, rollback can use the retained source and the explicit `ARTWORK_BACKEND=firestore` adapter with its original credentials. After MongoDB accepts new publications, first freeze writes and export/reconcile those documents into Firestore and its SQL registry; the old source is then stale and switching back blindly would lose access to newer artwork. There is no automatic dual-write or fallback.

## Legacy MongoDB migration sequence

1. Freeze legacy writes and back up MongoDB plus uploads. Keep the previous application revision/configuration for rollback.
2. Set `LEGACY_MONGODB_URI` explicitly in ignored `.env`. The exporter only reads collections.
3. Export and validate. Review warning messages, record counts, missing artists and ID/username/title conflicts.
4. Copy image bytes into Supabase and create a separate prepared snapshot. Restore unavailable external images into local uploads and update only a working snapshot. Original fixtures may contain dead URLs or HTTP URLs that need manual HTTPS verification. The exporter intentionally rejects insecure source URLs.
5. Import into the isolated Gallery target, verify records/relationships/counters, and check browser images/search/account features. Keep source snapshots and backups until acceptance.

```sh
npm run migrate -- export exports/legacy.json
npm run migrate -- dry-run exports/legacy.json
npm run migrate -- prepare-assets exports/legacy.json exports/prepared.json
npm run migrate -- dry-run exports/prepared.json
npm run migrate -- import exports/prepared.json
npm run migrate -- verify exports/prepared.json
```

`prepare-assets` accepts local `/uploads/` paths that resolve inside the upload directory. Remote HTTPS image hosts need an explicit comma-separated `MIGRATION_IMAGE_HOSTS` allowlist. Redirects, credentials in URLs, unsupported raster signatures and images over 5 MB are rejected; batches cap at 50 MB. Target paths include artwork ID plus SHA-256 content digest, so retries preserve immutable assets. Original snapshots are not overwritten. Partial copying can leave unreferenced assets; inspect/remove them after a failed batch. Importing old external/local URLs without asset preparation will not make those bytes available on Vercel.

`seed-json` prepares an optional snapshot from original JSON fixtures; it does not publish it or create weak known-password production accounts. Review/fix their source URLs before proceeding. Missing legacy artists receive random unknown passwords and warnings; existing account passwords are hashed without changing the source. IDs remain stable, and likes/follows/reviews/workshops/enrollments become normalized SQL relationships. Sessions and bearer tokens are not transferred: users sign in again.

Dry-run validates snapshot shape, identities, field bounds and references without touching target services. Import rejects conflicting identities/content, preserves existing password hashes, inserts relationships idempotently and recomputes imported artwork counters. Verification checks documents, projections, accounts, relationships, review/workshop content and counters. Retry a pending import only after resolving conflicts; no record is silently overwritten.

## Rollback and recovery

Before cutover, keep the legacy database/upload backup and note the previous deployment revision. Revert traffic/code to the old application and its original credentials if validation fails; retain the new Gallery target for diagnosis. Do not delete the source or reset unrelated Supabase projects. New writes made after cutover are not automatically copied back into MongoDB: export/reconcile them before rollback to avoid data loss.

MongoDB and SQL cannot share a transaction. Pending rows are hidden publicly. Import retry can recreate a missing document and finish a matching pending projection, but conflicting document content needs operator review. For normal upload interruptions, inspect the pending document and image before publishing or removing resources; see [deployment recovery](DEPLOYMENT.md). Never delete an image while committed state is uncertain.

The legacy MongoDB source was unavailable during restoration. The original `JSON/` catalog was restored with `npm run seed:hosted`: 24 artwork records, six recovered original images and 18 labeled replacement images. Six portfolio samples, two intentionally public demo accounts and a workshop were added as sample data. Historical user activity was not recovered or invented. The prepared ignored snapshot is reused on retries, preserving accounts and content; hosted seeds now target the selected MongoDB store by default. The eight original local upload files remain untouched.
