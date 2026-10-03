# Migration and rollback

The live app no longer uses MongoDB. Existing MongoDB data and local `uploads/` remain untouched. The source must be reachable before exporting. Snapshots contain password hashes and account data: keep them inside ignored `exports/`, protect access, and never upload them to Git or Vercel.

## Migration sequence

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

Firestore and SQL cannot share a transaction. Pending rows are hidden publicly. Import retry can recreate a missing document and finish a matching pending projection, but conflicting document content needs operator review. For normal upload interruptions, inspect the pending document and image before publishing or removing resources; see [deployment recovery](DEPLOYMENT.md). Never delete an image while committed state is uncertain.

The local MongoDB connection remains unavailable. The original `JSON/` catalog has been restored with `npm run seed:hosted`: 24 artwork records, six recovered original images and 18 labeled replacement images. Six portfolio samples, two intentionally public demo accounts and a workshop were added as sample data. Historical user activity was not recovered or invented. The prepared ignored snapshot is reused on retries, preserving accounts and content. The eight original local upload files remain untouched.
