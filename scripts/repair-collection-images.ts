import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  collectionImages,
  demoCollectionEntries,
  demoCollectionDescription,
  referenceImageDescription,
} from '../shared/collection-images.js';
import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { mongoClient } from '../server/src/mongodb.js';
import { createDiscoveryCache } from '../server/src/cache.js';
import type { ArtworkDocument } from '../server/src/domain.js';
import type { Snapshot } from '../server/src/migration.js';

type Document = Omit<ArtworkDocument, 'id'> & { _id: string };
type Change = { before: Document; after: Document };
type Journal = { origin: string; changes: Change[] };
class OperatorError extends Error {}
const filename = 'exports/collection-image-repair.json';
const oldImageNote =
  'Image note: the original image is unavailable; the illustration shown is a sample placeholder.\n\n';
const demoId = (key: string) =>
  createHash('sha256')
    .update(`gallery-public-demo:${key}`)
    .digest('hex')
    .slice(0, 24);
const legacyId = (artist: string, title: string) =>
  createHash('sha256')
    .update(JSON.stringify(['legacy-artwork', artist, title]))
    .digest('hex')
    .slice(0, 24);
const metadata = (art: Document) => ({
  title: art.title,
  year: art.year,
  category: art.category,
  medium: art.medium,
  image_url: art.imageUrl,
  description_preview: art.description.slice(0, 280),
});

// Explicit operator repair: only the original fixtures and six known demo IDs.
// An immutable journal allows a retry to finish an interrupted MongoDB/SQL copy.
async function main() {
  const config = readConfig();
  if (
    !config.databaseUrl ||
    config.artworkBackend !== 'mongodb' ||
    !config.clientOrigin.startsWith('https://')
  )
    throw new OperatorError(
      'Configure PostgreSQL, MongoDB and the canonical HTTPS CLIENT_ORIGIN.',
    );
  for (const image of collectionImages) {
    const bytes = await readFile(`client/public/artworks/${image.file}`);
    if (createHash('sha256').update(bytes).digest('hex') !== image.sha256)
      throw new OperatorError(
        'A collection asset differs from its verified source digest.',
      );
  }
  const client = mongoClient(config),
    sql = postgres(config.databaseUrl, config.databaseCa),
    cache = createDiscoveryCache(config);
  try {
    await client.connect();
    const collection = client
      .db(config.mongoDatabase)
      .collection<Document>('artworks');
    let journal: Journal;
    try {
      journal = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const original = (
        await Promise.all(
          (await readdir('JSON'))
            .filter((f) => f.endsWith('.json'))
            .sort()
            .map(async (f) => JSON.parse(await readFile(`JSON/${f}`, 'utf8'))),
        )
      ).flat() as { _id?: string; name: string; artist: string }[];
      const changes: Change[] = [];
      for (const record of original) {
        const before = await collection.findOne({
          _id: record._id || legacyId(record.artist, record.name),
        });
        if (!before || before.title !== record.name)
          throw new OperatorError(
            'An original catalog record changed; review it before repairing.',
          );
        if (!before.description.startsWith(oldImageNote)) continue; // Keep recovered originals.
        const image = collectionImages.slice(6)[changes.length % 18]!;
        changes.push({
          before,
          after: {
            ...before,
            imageUrl: `${config.clientOrigin}/artworks/${image.file}`,
            description: referenceImageDescription(
              image,
              before.description.slice(oldImageNote.length),
            ),
          },
        });
      }
      for (const { image, seedKey } of demoCollectionEntries) {
        const before = await collection.findOne({ _id: demoId(seedKey) });
        if (
          !before ||
          before.artistId !== demoId('Maya Laurent') ||
          before.title !== seedKey ||
          !before.description.startsWith('Portfolio sample illustration:')
        )
          throw new OperatorError(
            'A demo record changed; review it before repairing.',
          );
        changes.push({
          before,
          after: {
            ...before,
            title: image.title,
            year: image.year,
            category: 'Painting',
            medium: image.medium,
            imageUrl: `${config.clientOrigin}/artworks/${image.file}`,
            description: demoCollectionDescription(image),
          },
        });
      }
      journal = { origin: config.clientOrigin, changes };
      await mkdir('exports', { recursive: true });
      await writeFile(filename, JSON.stringify(journal, null, 2), {
        flag: 'wx',
      });
    }
    if (journal.origin !== config.clientOrigin)
      throw new OperatorError(
        'The repair journal belongs to a different origin.',
      );
    console.log(
      `Prepared ${journal.changes.length} scoped image repairs; original metadata is backed up in ignored exports.`,
    );
    if (!process.argv.includes('--apply')) {
      console.log('Dry run. Deploy the assets, then rerun with --apply.');
      return;
    }
    // Confirm all public assets before changing either database. No external redirects.
    for (const imageUrl of new Set(
      journal.changes.map((change) => change.after.imageUrl),
    )) {
      const response = await fetch(imageUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new OperatorError(
          'Deploy the collection assets before applying database repairs.',
        );
      const image = collectionImages.find((item) =>
        imageUrl.endsWith(item.file),
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        !image ||
        createHash('sha256').update(bytes).digest('hex') !== image.sha256
      )
        throw new OperatorError(
          'A hosted asset does not match its verified digest.',
        );
    }
    await cache.connect();
    try {
      for (const { before, after } of journal.changes) {
        await sql.transaction(async (tx) => {
          const row = (
            await tx.query(
              'SELECT title,year,category,medium,image_url,description_preview,status FROM gallery.artworks WHERE id=$1 FOR UPDATE',
              [before._id],
            )
          ).rows[0];
          if (!row || row['status'] !== 'published')
            throw new OperatorError('A catalog record is no longer published.');
          const { status: _status, ...projection } = row;
          if (
            !isDeepStrictEqual(projection, metadata(before)) &&
            !isDeepStrictEqual(projection, metadata(after))
          )
            throw new OperatorError(
              'SQL metadata changed; the repair will not overwrite it.',
            );
          const current = await collection.findOne({ _id: before._id });
          if (!isDeepStrictEqual(current, after)) {
            if (!isDeepStrictEqual(current, before))
              throw new OperatorError(
                'MongoDB metadata changed; the repair will not overwrite it.',
              );
            const result = await collection.replaceOne(before, after);
            if (result.matchedCount !== 1)
              throw new OperatorError(
                'MongoDB metadata changed during the repair.',
              );
          }
          await tx.query(
            "UPDATE gallery.artworks SET title=$2,year=$3,category=$4,medium=$5,image_url=$6,description_preview=$7,search_document=to_tsvector('english',$8) WHERE id=$1",
            [
              after._id,
              after.title,
              after.year,
              after.category,
              after.medium,
              after.imageUrl,
              after.description.slice(0, 280),
              [
                after.title,
                after.description,
                after.category,
                after.medium,
              ].join(' '),
            ],
          );
        });
      }
      // Keep the existing operator seed snapshot consistent, without reseeding accounts/activity.
      try {
        const snapshot = JSON.parse(
          await readFile('exports/hosted-catalog.json', 'utf8'),
        ) as Snapshot;
        for (const { after } of journal.changes) {
          const index = snapshot.artworks.findIndex(
            (art) => art.id === after._id,
          );
          if (index >= 0) {
            const { _id, ...content } = after;
            snapshot.artworks[index] = { id: _id, ...content };
          }
        }
        await writeFile(
          'exports/hosted-catalog.collection-repair.tmp',
          JSON.stringify(snapshot, null, 2),
        );
        await rename(
          'exports/hosted-catalog.collection-repair.tmp',
          'exports/hosted-catalog.json',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      console.log(
        `Verified and repaired ${journal.changes.length} artwork documents and SQL projections. IDs, ownership, dates of publication, likes and reviews are preserved.`,
      );
    } finally {
      await cache.invalidate();
    }
  } finally {
    cache.close();
    await Promise.all([sql.close(), client.close()]);
  }
}

// Driver errors can contain connection details; keep operator output credential-free.
main().catch((error: unknown) => {
  if (error instanceof OperatorError) console.error(error.message);
  else if (error instanceof Error)
    console.error(`Repair failure type: ${error.name}.`);
  console.error(
    'Collection repair stopped. Check configuration, deployment and the ignored repair journal; rerun to reconcile an interrupted copy.',
  );
  process.exitCode = 1;
});
