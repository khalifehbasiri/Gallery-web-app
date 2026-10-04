import { MongoClient, type CreateCollectionOptions } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import type { Config } from './config.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';

type StoredArtwork = Omit<ArtworkDocument, 'id'> & { _id: string };

export function mongoClient(config: Config) {
  if (!config.mongoUri)
    throw new Error(
      'Configure MONGODB_URI. For a credential-free demo, run npm run demo.',
    );
  try {
    return new MongoClient(config.mongoUri, {
      appName: 'gallery-web-app',
      maxPoolSize: 3,
      minPoolSize: 0,
      maxConnecting: 1,
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 2000,
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 8000,
      retryWrites: true,
      writeConcern: { w: 'majority' },
      ...(config.production
        ? {
            tls: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: false,
          }
        : {}),
    });
  } catch {
    // Driver parsing errors can contain credentials; expose configuration names only.
    throw new Error('Invalid MONGODB_URI configuration.');
  }
}

// Setup is an explicit operator action; HTTP requests never change database schemas.
export const artworkCollectionOptions: CreateCollectionOptions = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: [
        '_id',
        'artistId',
        'title',
        'year',
        'category',
        'medium',
        'description',
        'imageUrl',
      ],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'string', pattern: '^[a-f0-9]{24}$' },
        artistId: { bsonType: 'string', pattern: '^[a-f0-9]{24}$' },
        title: { bsonType: 'string', minLength: 1, maxLength: 200 },
        year: { bsonType: 'string', pattern: '^\\d{1,4}$' },
        category: { bsonType: 'string', minLength: 1, maxLength: 200 },
        medium: { bsonType: 'string', minLength: 1, maxLength: 200 },
        description: { bsonType: 'string', minLength: 1, maxLength: 10000 },
        imageUrl: { bsonType: 'string', pattern: '^https://' },
      },
    },
  },
  validationLevel: 'strict',
  validationAction: 'error',
};

export async function mongoArtworks(config: Config): Promise<ArtworkStore> {
  const client = mongoClient(config);
  try {
    await client.connect();
    const db = client.db(config.mongoDatabase);
    await db.command({ ping: 1 });
    const collection = db.collection<StoredArtwork>('artworks');
    return {
      async get(id) {
        const document = await collection.findOne({ _id: id });
        if (!document) return null;
        const { _id, ...content } = document;
        return { id: _id, ...content };
      },
      async create(art) {
        const { id, ...content } = art;
        await collection.insertOne({ _id: id, ...content });
      },
      async remove(id) {
        await collection.deleteOne({ _id: id });
      },
      close: () => client.close(),
    };
  } catch {
    await client.close();
    throw new Error(
      'MongoDB connection unavailable. Check credentials, TLS and the Atlas network access list.',
    );
  }
}

export async function prepareMongoArtworks(config: Config) {
  const client = mongoClient(config);
  try {
    await client.connect();
    const db = client.db(config.mongoDatabase);
    const existing = await db
      .listCollections({ name: 'artworks' }, { nameOnly: false })
      .next();
    if (!existing) {
      await db.createCollection('artworks', artworkCollectionOptions);
    } else if (
      !isDeepStrictEqual(
        existing.options?.validator,
        artworkCollectionOptions.validator,
      ) ||
      existing.options?.validationLevel !== 'strict' ||
      existing.options?.validationAction !== 'error'
    ) {
      throw new Error(
        'Existing artworks collection has a different validator. Review its schema before migration.',
      );
    }
    // Detail reads use the built-in unique _id index. Search/listing indexes remain in SQL.
  } finally {
    await client.close();
  }
}
