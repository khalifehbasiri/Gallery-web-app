import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { readConfig, rootDirectory } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { firestoreArtworks } from '../server/src/firestore.js';
import { mongoArtworks, prepareMongoArtworks } from '../server/src/mongodb.js';
import {
  copyArtworkSnapshot,
  exportArtworkSnapshot,
  validateArtworkSnapshot,
  verifyArtworkCopy,
} from '../server/src/artwork-migration.js';
import type { ArtworkStore } from '../server/src/domain.js';

const [command, filename] = process.argv.slice(2);
if (
  !['export', 'copy', 'verify', 'verify-source'].includes(command || '') ||
  !filename
)
  throw new Error(
    'Usage: npm run artworks:migrate -- export|copy|verify|verify-source exports/artworks.json',
  );
const exportDirectory = path.join(rootDirectory, 'exports'),
  target = path.resolve(filename);
const relative = path.relative(exportDirectory, target);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
  throw new Error(
    'Keep artwork snapshots inside the ignored exports directory.',
  );
const config = readConfig();
if (!config.databaseUrl) throw new Error('Configure DATABASE_URL.');
const sql = postgres(config.databaseUrl, config.databaseCa);
let store: ArtworkStore | undefined;
try {
  if (command === 'export' || command === 'verify-source') {
    store = firestoreArtworks(config);
    const snapshot = await exportArtworkSnapshot(sql, store);
    if (command === 'export') {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(snapshot, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      console.log(
        `Exported ${snapshot.artworks.length} current artwork documents. Source unchanged.`,
      );
    } else {
      const original: unknown = JSON.parse(await readFile(target, 'utf8'));
      validateArtworkSnapshot(original);
      if (!isDeepStrictEqual(snapshot, original))
        throw new Error(
          'Source changed since export. Stop publishing and export again.',
        );
      console.log('Source still matches the retained snapshot.');
    }
  } else {
    const snapshot: unknown = JSON.parse(await readFile(target, 'utf8'));
    validateArtworkSnapshot(snapshot);
    if (command === 'copy') await prepareMongoArtworks(config);
    store = await mongoArtworks(config);
    if (command === 'copy')
      console.log(
        JSON.stringify(await copyArtworkSnapshot(sql, store, snapshot)),
      );
    else {
      await verifyArtworkCopy(sql, store, snapshot);
      console.log(
        `Verified ${snapshot.artworks.length} MongoDB documents and unchanged SQL projections.`,
      );
    }
  }
} finally {
  await Promise.all([sql.close(), store?.close()]);
}
