import {
  MongoClient,
  MongoServerError,
  type CreateCollectionOptions,
} from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import type { Config } from './config.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';
import { artForms } from '../../shared/art-forms.js';

type StoredArtwork = Omit<ArtworkDocument, 'id'> & { _id: string };
export const artworkCollectionName = 'artworks_v2';

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
export const legacyArtworkCollectionOptions: CreateCollectionOptions = {
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

export const artworkCollectionOptions: CreateCollectionOptions = {
  ...legacyArtworkCollectionOptions,
  validator: {
    $jsonSchema: {
      ...legacyArtworkCollectionOptions.validator!['$jsonSchema'],
      properties: {
        ...legacyArtworkCollectionOptions.validator!['$jsonSchema'].properties,
        artDetails: { bsonType: 'object' },
      },
      oneOf: [
        { not: { required: ['artDetails'] } },
        ...Object.entries(artForms).map(([type, form]) => ({
          required: ['artDetails'],
          properties: {
            category: { enum: [form.category] },
            artDetails: {
              bsonType: 'object',
              required: ['type', ...form.fields.map((field) => field.key)],
              additionalProperties: false,
              properties: {
                type: { enum: [type] },
                ...Object.fromEntries(
                  form.fields.map((field) => [
                    field.key,
                    {
                      bsonType: 'string',
                      minLength: 1,
                      maxLength: 200,
                      pattern:
                        '^(?=.*\\S)[^\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]*$',
                    },
                  ]),
                ),
              },
            },
          },
        })),
      ],
    },
  },
};

export async function mongoArtworks(config: Config): Promise<ArtworkStore> {
  const client = mongoClient(config);
  try {
    await client.connect();
    const db = client.db(config.mongoDatabase);
    await db.command({ ping: 1 });
    const collection = db.collection<StoredArtwork>(artworkCollectionName);
    const legacy = db.collection<StoredArtwork>('artworks');
    return {
      async get(id) {
        const document =
          (await collection.findOne({ _id: id })) ??
          (await legacy.findOne({ _id: id }));
        if (!document) return null;
        const { _id, ...content } = document;
        return { id: _id, ...content };
      },
      async create(art) {
        const { id, ...content } = art;
        if (await legacy.findOne({ _id: id }, { projection: { _id: 1 } }))
          throw new MongoServerError({
            code: 11000,
            errmsg: 'Artwork ID already exists in the legacy collection.',
          });
        await collection.insertOne({ _id: id, ...content });
      },
      async remove(id) {
        await collection.deleteOne({ _id: id });
        await legacy.deleteOne({ _id: id });
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
      .listCollections({ name: artworkCollectionName }, { nameOnly: false })
      .next();
    if (!existing) {
      await db.createCollection(
        artworkCollectionName,
        artworkCollectionOptions,
      );
    } else if (
      !isDeepStrictEqual(
        existing.options?.validator,
        artworkCollectionOptions.validator,
      ) ||
      existing.options?.validationLevel !== 'strict' ||
      existing.options?.validationAction !== 'error'
    ) {
      throw new Error(
        'Existing artworks_v2 collection has a different validator. Review its schema before migration.',
      );
    }
    // Detail reads use the built-in unique _id index. Search/listing indexes remain in SQL.
  } finally {
    await client.close();
  }
}
