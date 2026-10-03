import { readConfig } from './config.js';
import { postgres } from './database.js';
import { firestoreArtworks } from './firestore.js';
import { supabaseStorage } from './storage.js';
import { createDiscoveryCache } from './cache.js';
import { createSecurityCache } from './security-cache.js';
import { createApp } from './app.js';
export async function createRuntime() {
  const config = readConfig();
  if (!config.databaseUrl)
    throw new Error(
      'Configure DATABASE_URL. For a credential-free demo, run npm run demo.',
    );
  const sql = postgres(config.databaseUrl, config.databaseCa),
    artworks = firestoreArtworks(config),
    storage = supabaseStorage(config);
  const cache = createDiscoveryCache(config);
  try {
    await sql.query('SELECT 1 FROM gallery.users LIMIT 1');
    await cache.connect();
    const security = await createSecurityCache(config);
    return {
      config,
      app: createApp({ config, sql, artworks, storage, cache, security }),
      async close() {
        cache.close();
        security.close();
        await Promise.all([sql.close(), artworks.close()]);
      },
    };
  } catch (error) {
    cache.close();
    await Promise.all([sql.close(), artworks.close()]);
    throw error;
  }
}
