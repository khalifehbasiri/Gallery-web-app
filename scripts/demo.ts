import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/src/app.js';
import { readConfig, clientDirectory } from '../server/src/config.js';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { localStorage } from '../server/src/local-storage.js';
import { demoData } from '../server/src/demo-data.js';
import {
  applyCommunitySeed,
  buildCommunitySeed,
} from '../server/src/community-seed.js';
if (process.env.NODE_ENV === 'production')
  throw new Error('Demo disabled in production.');
if (!existsSync(path.join(clientDirectory, 'index.html')))
  throw new Error('Build first with npm run build.');
const config = readConfig({ PORT: process.env.PORT || '3000' }),
  sql = await localDatabase(),
  artworks = new LocalArtworkStore();
await demoData(sql, artworks);
const targets = (
  await sql.query<{ id: string; title: string }>(
    'SELECT id,title FROM gallery.artworks ORDER BY id',
  )
).rows;
const patron = String(
  (await sql.query("SELECT id FROM gallery.users WHERE username='demo'"))
    .rows[0]!['id'],
);
await applyCommunitySeed(
  sql,
  artworks,
  await buildCommunitySeed('', targets, patron),
);
const directory = await mkdtemp(path.join(os.tmpdir(), 'gallery-demo-'));
const { storage, router } = localStorage(
  directory,
  `http://localhost:${config.port}`,
);
const app = express();
app.use('/demo-upload', router);
app.use(
  createApp({ config, sql, artworks, storage, uploadDirectory: directory }),
);
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Temporary gallery demo: http://localhost:${config.port}`);
  console.log('Patron: demo / gallery-demo-2026');
  console.log('Artist: Maya Laurent / gallery-demo-2026');
});
async function cleanup() {
  await sql.close();
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('gallery-demo-')
  )
    throw new Error('Unexpected temporary directory.');
  await rm(resolved, { recursive: true, force: true });
}
server.on('error', () => void cleanup());
const stop = () => server.close(() => void cleanup());
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
