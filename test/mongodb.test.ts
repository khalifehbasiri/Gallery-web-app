import assert from 'node:assert/strict';
import { before, after, beforeEach, it } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readConfig } from '../server/src/config.js';
import {
  mongoArtworks,
  mongoClient,
  prepareMongoArtworks,
} from '../server/src/mongodb.js';
import { localDatabase } from '../server/src/local-database.js';
import { publish } from '../server/src/catalog.js';
import {
  copyArtworkSnapshot,
  exportArtworkSnapshot,
  verifyArtworkCopy,
} from '../server/src/artwork-migration.js';
import { LocalArtworkStore } from '../server/src/local-database.js';
import { redisScope } from '../server/src/redis-connection.js';
import type { ArtworkDocument, ArtworkStore } from '../server/src/domain.js';
import type { Sql } from '../server/src/database.js';

let mongo: MongoMemoryServer,
  target: ArtworkStore,
  sql: Sql,
  config: ReturnType<typeof readConfig>;
const art: ArtworkDocument = {
  id: 'a'.repeat(24),
  artistId: 'b'.repeat(24),
  title: 'Preserved artwork',
  year: '2026',
  category: 'Painting',
  medium: 'Oil',
  description: 'Preserve Unicode, punctuation, and the full description: café.',
  imageUrl: 'https://example.org/original.jpg',
};
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '8.0.15' },
    instance: {
      launchTimeout: 30000,
      args: ['--wiredTigerCacheSizeGB', '0.25'],
    },
  });
  config = readConfig({
    MONGODB_URI: mongo.getUri(),
    MONGODB_DATABASE: 'gallery_test',
  });
  await prepareMongoArtworks(config);
  target = await mongoArtworks(config);
  sql = await localDatabase();
  await sql.query(
    'INSERT INTO gallery.users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
    [art.artistId, 'Artist', 'unused-test-password-hash', 'artist'],
  );
});
beforeEach(async () => {
  const client = mongoClient(config);
  try {
    await client.connect();
    await client.db(config.mongoDatabase).collection('artworks').deleteMany({});
  } finally {
    await client.close();
  }
  await sql.query('DELETE FROM gallery.likes');
  await sql.query('DELETE FROM gallery.artworks');
});
after(async () => {
  await Promise.all([target?.close(), sql?.close()]);
  await mongo?.stop();
});

it('stores artwork under its original indexed ID, rejects duplicates and invalid documents, and deletes by ID', async () => {
  await prepareMongoArtworks(config);
  await target.create(art);
  assert.deepEqual(await target.get(art.id), art);
  await assert.rejects(
    target.create(art),
    (error) => (error as { code: number }).code === 11000,
  );
  await assert.rejects(
    target.create({
      ...art,
      id: 'c'.repeat(24),
      imageUrl: 'javascript:alert(1)',
    }),
    (error) => (error as { code: number }).code === 121,
  );
  await assert.rejects(
    target.create({
      ...art,
      id: 'd'.repeat(24),
      unknown: 'no extra fields',
    } as ArtworkDocument),
    (error) => (error as { code: number }).code === 121,
  );
  await target.remove(art.id);
  assert.equal(await target.get(art.id), null);
});
it('copies and verifies all fields without changing SQL relationships, and safely reruns after an ambiguous successful write', async () => {
  const source = new LocalArtworkStore();
  await publish(sql, source, art);
  await sql.query(
    'INSERT INTO gallery.likes(user_id,artwork_id) VALUES($1,$2)',
    [art.artistId, art.id],
  );
  const snapshot = await exportArtworkSnapshot(sql, source);
  const ambiguous: ArtworkStore = {
    ...target,
    create: async (value) => {
      await target.create(value);
      throw new Error('Acknowledgement lost');
    },
  };
  assert.deepEqual(await copyArtworkSnapshot(sql, ambiguous, snapshot), {
    artworks: 1,
    inserted: 1,
  });
  assert.deepEqual(await copyArtworkSnapshot(sql, target, snapshot), {
    artworks: 1,
    inserted: 0,
  });
  await verifyArtworkCopy(sql, target, snapshot);
  assert.deepEqual(await source.get(art.id), art);
  assert.equal(
    (await sql.query('SELECT count(*)::int AS count FROM gallery.likes'))
      .rows[0]!['count'],
    1,
  );
});
it('rejects conflicting target content before copying any missing documents', async () => {
  const source = new LocalArtworkStore(),
    second = { ...art, id: 'e'.repeat(24), title: 'Second artwork' };
  await publish(sql, source, art);
  await publish(sql, source, second);
  const snapshot = await exportArtworkSnapshot(sql, source);
  await target.create({
    ...second,
    description: 'Conflicting existing content',
  });
  await assert.rejects(copyArtworkSnapshot(sql, target, snapshot), /conflicts/);
  assert.equal(await target.get(art.id), null);
  assert.equal(
    (await target.get(second.id))!.description,
    'Conflicting existing content',
  );
});
it('refuses changed or pending SQL catalogs before copying documents', async () => {
  const source = new LocalArtworkStore();
  await publish(sql, source, art);
  const snapshot = await exportArtworkSnapshot(sql, source);
  await sql.query("UPDATE gallery.artworks SET status='pending' WHERE id=$1", [
    art.id,
  ]);
  await assert.rejects(copyArtworkSnapshot(sql, target, snapshot), /pending/);
  assert.equal(await target.get(art.id), null);
  await sql.query(
    "UPDATE gallery.artworks SET status='published',title='Changed title' WHERE id=$1",
    [art.id],
  );
  await assert.rejects(copyArtworkSnapshot(sql, target, snapshot), /differs/);
});
it('requires safe MongoDB configuration and preserves Redis authority across backend and credential changes', () => {
  assert.throws(() => mongoClient(readConfig({})), /MONGODB_URI/);
  assert.throws(
    () => readConfig({ MONGODB_DATABASE: 'admin' }),
    /application database/,
  );
  assert.throws(
    () => readConfig({ MONGODB_URI: 'https://invalid.example' }),
    /connection string/,
  );
  for (const option of [
    'tls=false',
    'ssl=false',
    'tlsInsecure=true',
    'tlsAllowInvalidCertificates=true',
    'tlsAllowInvalidHostnames=true',
  ])
    assert.throws(
      () =>
        readConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'x'.repeat(32),
          MONGODB_URI: `mongodb://example.org/?${option}`,
        }),
      /verified TLS/,
    );
  const old = readConfig({
      DATABASE_URL: 'postgres://app:secret@sql.example/gallery',
      FIREBASE_PROJECT_ID: 'existing-scope',
    }),
    next = readConfig({
      DATABASE_URL: 'postgres://app:rotated@sql.example/gallery',
      MONGODB_URI: 'mongodb+srv://example.org',
      REDIS_SCOPE_ID: 'existing-scope',
    });
  assert.equal(redisScope(old), redisScope(next));
});
