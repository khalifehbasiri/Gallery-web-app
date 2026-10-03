import { Firestore } from '@google-cloud/firestore';
import type { Config } from './config.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';
export function firestoreArtworks(config: Config): ArtworkStore {
  if (!config.firebaseProjectId)
    throw new Error('Configure FIREBASE_PROJECT_ID.');
  const credentials = config.firebaseCredentials
    ? JSON.parse(config.firebaseCredentials)
    : undefined;
  const db = new Firestore({
    projectId: config.firebaseProjectId,
    databaseId: config.firestoreDatabaseId,
    ...(credentials ? { credentials } : {}),
    ignoreUndefinedProperties: false,
  });
  const collection = db.collection('artworks');
  return {
    async get(id) {
      const doc = await collection.doc(id).get();
      return doc.exists ? (doc.data() as ArtworkDocument) : null;
    },
    async create(art) {
      await collection.doc(art.id).create(art);
    },
    async remove(id) {
      await collection.doc(id).delete();
    },
    close: () => db.terminate(),
  };
}
