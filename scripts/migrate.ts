import mongoose from 'mongoose';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeLegacy,
  importSnapshot,
  validateSnapshot,
  verifySnapshot,
  type Snapshot,
} from '../server/src/migration.js';
import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { firestoreArtworks } from '../server/src/firestore.js';
import { prepareSnapshotAssets } from '../server/src/migration-assets.js';
const [command, filename, output] = process.argv.slice(2);
if (
  !filename ||
  ![
    'export',
    'dry-run',
    'import',
    'verify',
    'seed-json',
    'prepare-assets',
  ].includes(command || '')
)
  throw new Error(
    'Usage: npm run migrate -- export|dry-run|import|verify|seed-json|prepare-assets exports/snapshot.json [exports/prepared.json]',
  );
if (!path.resolve(filename).startsWith(path.resolve('exports') + path.sep))
  throw new Error(
    'Store sensitive snapshots inside the ignored exports/ directory.',
  );
await mkdir('exports', { recursive: true });
if (command === 'export') {
  if (!process.env.LEGACY_MONGODB_URI)
    throw new Error(
      'Set LEGACY_MONGODB_URI explicitly. The source is read only.',
    );
  try {
    await mongoose.connect(process.env.LEGACY_MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    const db = mongoose.connection.db!;
    const users = await db.collection('users').find({}).toArray(),
      artworks = await db.collection('galleries').find({}).toArray();
    const snapshot = await normalizeLegacy(
      JSON.parse(JSON.stringify(users)),
      JSON.parse(JSON.stringify(artworks)),
    );
    await writeFile(filename, JSON.stringify(snapshot, null, 2), {
      flag: 'wx',
    });
    console.log(
      `Exported ${users.length} accounts and ${artworks.length} artworks; source unchanged.`,
    );
  } finally {
    await mongoose.disconnect();
  }
} else if (command === 'seed-json') {
  const artworks = (
    await Promise.all(
      (await readdir('JSON'))
        .filter((f) => f.endsWith('.json'))
        .map(async (f) =>
          JSON.parse(await readFile(path.join('JSON', f), 'utf8')),
        ),
    )
  ).flat();
  const httpImages = artworks.filter(
    (a) => typeof a.image === 'string' && a.image.startsWith('http://'),
  ).length;
  const snapshot = await normalizeLegacy(
    [],
    artworks.map((a) => ({
      ...a,
      image:
        typeof a.image === 'string'
          ? a.image.replace(/^http:/, 'https:')
          : a.image,
    })),
  );
  if (httpImages)
    snapshot.warnings.push(
      `Upgraded ${httpImages} fixture image URLs to HTTPS; verify availability before asset preparation.`,
    );
  await writeFile(filename, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  console.log(
    'Prepared original sample artwork snapshot. Artist passwords are random and unknown.',
  );
} else {
  const snapshot = JSON.parse(await readFile(filename, 'utf8')) as Snapshot;
  validateSnapshot(snapshot);
  if (command === 'prepare-assets') {
    if (
      !output ||
      !path.resolve(output).startsWith(path.resolve('exports') + path.sep)
    )
      throw new Error('Choose a separate output inside exports/.');
    try {
      await readFile(output);
      throw new Error('Output already exists; preserve snapshots.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const prepared = await prepareSnapshotAssets(
      snapshot,
      readConfig(),
      (process.env.MIGRATION_IMAGE_HOSTS || '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    );
    await writeFile(output, JSON.stringify(prepared, null, 2), { flag: 'wx' });
    console.log(
      `Prepared ${prepared.artworks.length} image references; original snapshot unchanged.`,
    );
  } else if (command === 'dry-run') {
    console.log(
      JSON.stringify(
        {
          users: snapshot.users.length,
          artworks: snapshot.artworks.length,
          likes: snapshot.likes.length,
          reviews: snapshot.reviews.length,
          workshops: snapshot.workshops.length,
          warnings: snapshot.warnings,
        },
        null,
        2,
      ),
    );
  } else {
    const config = readConfig();
    if (!config.databaseUrl) throw new Error('Configure the new DATABASE_URL.');
    const sql = postgres(config.databaseUrl, config.databaseCa),
      store = firestoreArtworks(config);
    try {
      if (command === 'import') await importSnapshot(sql, store, snapshot);
      await verifySnapshot(sql, store, snapshot);
      console.log(
        `Verified ${snapshot.users.length} accounts and ${snapshot.artworks.length} documents. Sessions are intentionally not migrated.`,
      );
    } finally {
      await Promise.all([sql.close(), store.close()]);
    }
  }
}
