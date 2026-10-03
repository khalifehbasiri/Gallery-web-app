import mongoose from 'mongoose';
import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { readConfig, uploadsDirectory } from './config.js';
import {
  createDiscoveryCache,
  disabledCache,
  type DiscoveryCache,
} from './cache.js';

let cache: DiscoveryCache = disabledCache;

async function start() {
  const config = readConfig();
  await mkdir(uploadsDirectory, { recursive: true });
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  cache = createDiscoveryCache(config);
  void cache.connect();
  const server = createApp({ config, cache }).listen(config.port, () =>
    console.log(`Gallery running at http://localhost:${config.port}`),
  );
  server.on('error', async (error) => {
    console.error('Server error:', error.message);
    cache.close();
    await mongoose.disconnect();
    process.exitCode = 1;
  });
  const shutdown = () => {
    cache.close();
    server.close(async () => {
      await mongoose.disconnect();
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
start().catch(async (error: unknown) => {
  cache.close();
  console.error(
    'Unable to start Gallery:',
    error instanceof Error ? error.message : error,
  );
  await mongoose.disconnect();
  process.exitCode = 1;
});
