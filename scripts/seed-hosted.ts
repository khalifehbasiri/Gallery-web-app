import {
  collectionImages,
  demoCollectionEntries,
  demoCollectionDescription,
  referenceImageDescription,
} from '../shared/collection-images.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { artworkStore } from '../server/src/artwork-store.js';
import {
  normalizeLegacy,
  importSnapshot,
  verifySnapshot,
  type Snapshot,
} from '../server/src/migration.js';
import { prepareSnapshotAssets } from '../server/src/migration-assets.js';
import { hashPassword } from '../server/src/passwords.js';
import { createDiscoveryCache } from '../server/src/cache.js';

// Explicit operator command, never run automatically during deployment.
const config = readConfig();
if (!config.databaseUrl || !config.clientOrigin.startsWith('https://'))
  throw new Error(
    'Configure hosted database credentials and an HTTPS CLIENT_ORIGIN.',
  );
const filename = 'exports/hosted-catalog.json';
await mkdir('exports', { recursive: true });
let snapshot: Snapshot;
try {
  snapshot = JSON.parse(await readFile(filename, 'utf8')) as Snapshot;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  const original = (
    await Promise.all(
      (await readdir('JSON'))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map(async (f) =>
          JSON.parse(await readFile(path.join('JSON', f), 'utf8')),
        ),
    )
  ).flat();
  snapshot = await normalizeLegacy(
    [],
    original.map((a) => ({ ...a, image: a.image.replace(/^http:/, 'https:') })),
  );
  let referenceIndex = 0;
  for (const [index, art] of snapshot.artworks.entries()) {
    try {
      const prepared = await prepareSnapshotAssets(
        { ...snapshot, artworks: [art] },
        config,
        [new URL(art.imageUrl).hostname],
      );
      art.imageUrl = prepared.artworks[0]!.imageUrl;
      console.log(
        `Restored original image ${index + 1}/${snapshot.artworks.length}.`,
      );
    } catch {
      const image = collectionImages.slice(6)[referenceIndex++ % 18]!;
      art.imageUrl = `${config.clientOrigin}/artworks/${image.file}`;
      art.description = referenceImageDescription(image, art.description);
      snapshot.warnings.push(
        `Original image unavailable: ${art.id}. Credited reference image substituted.`,
      );
      console.log(
        `Preserved artwork ${index + 1}/${snapshot.artworks.length} with a credited reference image.`,
      );
    }
  }
  const stable = (name: string) =>
    createHash('sha256')
      .update(`gallery-public-demo:${name}`)
      .digest('hex')
      .slice(0, 24);
  const artist = stable('Maya Laurent'),
    patron = stable('demo');
  const passwordHash = await hashPassword('gallery-demo-2026');
  snapshot.users.push(
    { id: artist, username: 'Maya Laurent', role: 'artist', passwordHash },
    { id: patron, username: 'demo', role: 'patron', passwordHash },
  );
  for (const { image, seedKey } of demoCollectionEntries)
    snapshot.artworks.push({
      id: stable(seedKey),
      artistId: artist,
      title: image.title,
      imageUrl: `${config.clientOrigin}/artworks/${image.file}`,
      category: 'Painting',
      medium: image.medium,
      year: image.year,
      description: demoCollectionDescription(image),
    });
  snapshot.workshops.push({
    id: 'hosted-demo-workshop',
    artistId: artist,
    name: 'The art of looking closer',
    goal: 'Explore color and composition.',
    weeks: 3,
  });
  snapshot.likes.push({
    userId: patron,
    artworkId: stable(demoCollectionEntries[0]!.seedKey),
  });
  snapshot.follows.push({ userId: patron, artistId: artist });
  snapshot.reviews.push({
    id: 'hosted-demo-review',
    userId: patron,
    artworkId: stable(demoCollectionEntries[0]!.seedKey),
    text: 'Sample review: I love the balance of color and shape.',
  });
  await writeFile(filename, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
}
const sql = postgres(config.databaseUrl, config.databaseCa),
  store = await artworkStore(config),
  cache = createDiscoveryCache(config);
try {
  await importSnapshot(sql, store, snapshot);
  await verifySnapshot(sql, store, snapshot);
  await cache.connect();
  await cache.invalidate();
  console.log(
    JSON.stringify({
      accounts: snapshot.users.length,
      artworks: snapshot.artworks.length,
      workshops: snapshot.workshops.length,
      referenceImages: snapshot.warnings.filter((w) =>
        w.includes('Credited reference image substituted'),
      ).length,
    }),
  );
} finally {
  cache.close();
  await Promise.all([sql.close(), store.close()]);
}
