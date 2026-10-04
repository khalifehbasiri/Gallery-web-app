import type { Config } from './config.js';
import { mongoArtworks } from './mongodb.js';

export async function artworkStore(config: Config) {
  if (config.artworkBackend === 'mongodb') return mongoArtworks(config);
  // Explicit migration/rollback mode only; never silently fall back after a MongoDB error.
  const { firestoreArtworks } = await import('./firestore.js');
  return firestoreArtworks(config);
}
