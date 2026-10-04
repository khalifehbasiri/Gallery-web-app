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
      art.imageUrl = `${config.clientOrigin}/${['hero-art.svg', 'blue-hour.svg', 'paper-study.svg'][index % 3]}`;
      art.description =
        `Image note: the original image is unavailable; the illustration shown is a sample placeholder.\n\n${art.description}`.slice(
          0,
          10000,
        );
      snapshot.warnings.push(
        `Original image unavailable: ${art.id}. Sample illustration substituted.`,
      );
      console.log(
        `Preserved artwork ${index + 1}/${snapshot.artworks.length} with a labeled sample image.`,
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
  const samples = [
    [
      'A different perspective',
      'hero-art.svg',
      'Painting',
      'Acrylic & digital',
      '2026',
    ],
    [
      'The quiet between',
      'blue-hour.svg',
      'Digital',
      'Digital illustration',
      '2025',
    ],
    [
      'Collected moments',
      'paper-study.svg',
      'Mixed media',
      'Paper & pigment',
      '2026',
    ],
    [
      'An ordinary kind of magic',
      'paper-study.svg',
      'Mixed media',
      'Hand-cut collage',
      '2024',
    ],
    [
      'Where the light stays',
      'hero-art.svg',
      'Painting',
      'Acrylic on linen',
      '2025',
    ],
    [
      'Before the city wakes',
      'blue-hour.svg',
      'Digital',
      'Digital painting',
      '2026',
    ],
  ];
  for (const [title, image, category, medium, year] of samples)
    snapshot.artworks.push({
      id: stable(title!),
      artistId: artist,
      title: title!,
      imageUrl: `${config.clientOrigin}/${image}`,
      category: category!,
      medium: medium!,
      year: year!,
      description:
        'Portfolio sample illustration: a study of color, composition, and everyday moments.',
    });
  snapshot.workshops.push({
    id: 'hosted-demo-workshop',
    artistId: artist,
    name: 'The art of looking closer',
    goal: 'Explore color and composition.',
    weeks: 3,
  });
  snapshot.likes.push({ userId: patron, artworkId: stable(samples[0]![0]!) });
  snapshot.follows.push({ userId: patron, artistId: artist });
  snapshot.reviews.push({
    id: 'hosted-demo-review',
    userId: patron,
    artworkId: stable(samples[0]![0]!),
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
      substitutedImages: snapshot.warnings.filter((w) =>
        w.includes('Sample illustration substituted'),
      ).length,
    }),
  );
} finally {
  cache.close();
  await Promise.all([sql.close(), store.close()]);
}
