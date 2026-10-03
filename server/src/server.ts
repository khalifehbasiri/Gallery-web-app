import mongoose from 'mongoose';
import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { readConfig, uploadsDirectory } from './config.js';

async function start() {
  const config = readConfig();
  await mkdir(uploadsDirectory, { recursive: true });
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const server = createApp({ config }).listen(config.port, () =>
    console.log(`Gallery running at http://localhost:${config.port}`),
  );
  server.on('error', async (error) => {
    console.error('Server error:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
  const shutdown = () =>
    server.close(async () => {
      await mongoose.disconnect();
    });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
start().catch(async (error: unknown) => {
  console.error(
    'Unable to start Gallery:',
    error instanceof Error ? error.message : error,
  );
  await mongoose.disconnect();
  process.exitCode = 1;
});
