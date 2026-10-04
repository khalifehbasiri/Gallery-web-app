import { readConfig } from './config.js';
import { postgres } from './database.js';
import { artworkStore } from './artwork-store.js';
import type { ArtworkStore } from './domain.js';
import { supabaseStorage } from './storage.js';
import { createDiscoveryCache } from './cache.js';
import { createSecurityCache } from './security-cache.js';
import { createApp } from './app.js';
import { notificationDispatch } from './notifications.js';
export async function createRuntime(
  options: { defer?: (work: Promise<void>) => void } = {},
) {
  const config = readConfig();
  if (!config.databaseUrl)
    throw new Error(
      'Configure DATABASE_URL. For a credential-free demo, run npm run demo.',
    );
  const sql = postgres(config.databaseUrl, config.databaseCa);
  let artworks: ArtworkStore | undefined;
  const cache = createDiscoveryCache(config);
  try {
    artworks = await artworkStore(config);
    const storage = supabaseStorage(config);
    await sql.query('SELECT 1 FROM gallery.users LIMIT 1');
    await cache.connect();
    const security = await createSecurityCache(config);
    const notifications = await notificationDispatch(config);
    return {
      config,
      app: createApp({
        config,
        sql,
        artworks,
        storage,
        cache,
        security,
        notifications,
        ...options,
      }),
      async close() {
        cache.close();
        security.close();
        notifications.close();
        await Promise.all([sql.close(), artworks!.close()]);
      },
    };
  } catch (error) {
    cache.close();
    await Promise.all([sql.close(), artworks?.close()]);
    throw error;
  }
}
