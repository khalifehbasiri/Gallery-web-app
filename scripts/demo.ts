import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../server/src/app.js';
import { readConfig, clientDirectory } from '../server/src/config.js';
import { AuthSession, User, Gallery } from '../server/src/models.js';
import { hashPassword } from '../server/src/passwords.js';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiscoveryCache } from '../server/src/cache.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('The temporary demo cannot run in production.');
if (!existsSync(path.join(clientDirectory, 'index.html')))
  throw new Error('Build the app first with npm run build.');
const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
await Promise.all([User.init(), Gallery.init(), AuthSession.init()]);
const password = await hashPassword('gallery-demo-2026');
const artist = await User.create({
  username: 'Maya Laurent',
  password,
  aType: 'artist',
  workshops: [
    {
      workshopId: 'demo-workshop',
      name: 'The art of looking closer',
      goal: 'Explore color, composition, and the small details that turn everyday moments into art.',
      duration: '3',
      user: 'Maya Laurent',
      signed: [],
    },
  ],
});
await User.create({ username: 'demo', password, aType: 'patron' });
await Gallery.create(
  [
    {
      name: 'A different perspective',
      image: '/hero-art.svg',
      category: 'Painting',
      medium: 'Acrylic & digital',
      year: '2026',
    },
    {
      name: 'The quiet between',
      image: '/blue-hour.svg',
      category: 'Digital',
      medium: 'Digital illustration',
      year: '2025',
    },
    {
      name: 'Collected moments',
      image: '/paper-study.svg',
      category: 'Mixed media',
      medium: 'Paper & pigment',
      year: '2026',
    },
    {
      name: 'An ordinary kind of magic',
      image: '/paper-study.svg',
      category: 'Mixed media',
      medium: 'Hand-cut collage',
      year: '2024',
    },
    {
      name: 'Where the light stays',
      image: '/hero-art.svg',
      category: 'Painting',
      medium: 'Acrylic on linen',
      year: '2025',
    },
    {
      name: 'Before the city wakes',
      image: '/blue-hour.svg',
      category: 'Digital',
      medium: 'Digital illustration',
      year: '2026',
    },
  ].map((art) => ({
    ...art,
    artist: artist.username,
    description:
      'An original abstract study of color, space, and the little moments that ask us to slow down. Temporary sample artwork for the local demonstration.',
  })),
);

const uploads = await mkdtemp(path.join(os.tmpdir(), 'gallery-demo-'));
const config = readConfig({ ...process.env, MONGODB_URI: mongo.getUri() });
const cache = createDiscoveryCache(config);
void cache.connect();
const server = createApp({ config, cache, uploadDirectory: uploads }).listen(
  config.port,
  '127.0.0.1',
  () => {
    console.log(`Temporary gallery demo: http://localhost:${config.port}`);
    console.log('Patron: demo / gallery-demo-2026');
    console.log('Artist: Maya Laurent / gallery-demo-2026');
    console.log('All demo data and uploads are isolated from your database.');
  },
);
async function cleanup() {
  cache.close();
  await mongoose.disconnect();
  await mongo.stop();
  if (
    path.dirname(path.resolve(uploads)) !== path.resolve(os.tmpdir()) ||
    !path.basename(uploads).startsWith('gallery-demo-')
  )
    throw new Error('Unexpected temporary upload directory.');
  await rm(uploads, { recursive: true, force: true });
}
server.on('error', async (error) => {
  console.error(error.message);
  await cleanup();
  process.exitCode = 1;
});
const stop = () => {
  cache.close();
  server.close(async () => {
    await cleanup();
    process.exit(0);
  });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
