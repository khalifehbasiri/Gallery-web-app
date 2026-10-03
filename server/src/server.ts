import { createRuntime } from './runtime.js';
try {
  const runtime = await createRuntime();
  const server = runtime.app.listen(runtime.config.port, () =>
    console.log(`Gallery running at http://localhost:${runtime.config.port}`),
  );
  const shutdown = () => server.close(() => void runtime.close());
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', () => {
    void runtime.close();
    process.exitCode = 1;
  });
} catch (error) {
  console.error(
    'Unable to start Gallery:',
    error instanceof Error ? error.message : 'Configuration unavailable.',
  );
  process.exitCode = 1;
}
