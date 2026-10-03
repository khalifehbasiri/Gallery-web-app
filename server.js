import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { readConfig, uploadsDirectory } from './lib/config.js';

async function start() {
  const config = readConfig();
  await mkdir(uploadsDirectory, { recursive: true });
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });

  const store = MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: 'sessions',
    stringify: false,
  });
  store.on('error', (error) =>
    console.error('Session store error:', error.message),
  );
  const app = createApp({ config, store });
  const server = app.listen(config.port, () => {
    console.log(`Gallery running at http://localhost:${config.port}`);
  });
  server.on('error', async (error) => {
    console.error('Server error:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });

  const shutdown = () => {
    server.close(async () => {
      await mongoose.disconnect();
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('Unable to start Gallery:', error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
