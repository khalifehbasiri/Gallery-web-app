import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { supabaseStorage } from '../server/src/storage.js';
import { artworkStore } from '../server/src/artwork-store.js';
import { createDiscoveryCache } from '../server/src/cache.js';
import { runMaintenance } from '../server/src/maintenance.js';
const config = readConfig();
if (!config.databaseUrl) throw new Error('Configure DATABASE_URL.');
const sql = postgres(config.databaseUrl, config.databaseCa),
  storage = supabaseStorage(config),
  store = await artworkStore(config),
  cache = await createDiscoveryCache(config);
await cache.connect();
try {
  console.log(JSON.stringify(await runMaintenance(sql, store, storage, cache)));
} finally {
  cache.close();
  await store.close();
  await sql.close();
}
