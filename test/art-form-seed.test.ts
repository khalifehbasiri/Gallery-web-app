import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { demoData } from '../server/src/demo-data.js';
import {
  applyArtFormSeed,
  buildArtFormSeed,
} from '../server/src/art-form-seed.js';
import { parseArtDetails } from '../server/src/art-details.js';
import { artFormCollection } from '../shared/art-form-collection.js';

async function setup() {
  const sql = await localDatabase(),
    store = new LocalArtworkStore();
  await demoData(sql, store);
  const artist = String(
    (
      await sql.query(
        "SELECT id FROM gallery.users WHERE username='Maya Laurent'",
      )
    ).rows[0]!['id'],
  );
  return { sql, store, seed: buildArtFormSeed('', artist) };
}

it('adds repeatable art fixtures while preserving existing accounts, posts and activity', async () => {
  const { sql, store, seed } = await setup();
  try {
    const original = structuredClone([...store.documents.values()]);
    const users = (await sql.query('SELECT * FROM gallery.users ORDER BY id'))
      .rows;
    await sql.query(
      'INSERT INTO gallery.likes(user_id,artwork_id) VALUES($1,$2)',
      [seed[0]!.artistId, original[0]!.id],
    );
    const result = await applyArtFormSeed(sql, store, seed);
    assert.equal(result.inserted, 8);
    for (const art of original) assert.deepEqual(await store.get(art.id), art);
    await sql.query(
      'INSERT INTO gallery.likes(user_id,artwork_id) VALUES($1,$2)',
      [seed[0]!.artistId, seed[0]!.id],
    );
    const rows = (await sql.query('SELECT * FROM gallery.artworks ORDER BY id'))
      .rows;
    assert.equal((await applyArtFormSeed(sql, store, seed)).inserted, 0);
    assert.deepEqual(
      (await sql.query('SELECT * FROM gallery.artworks ORDER BY id')).rows,
      rows,
    );
    assert.deepEqual(
      (await sql.query('SELECT * FROM gallery.users ORDER BY id')).rows,
      users,
    );
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.likes'))
        .rows[0]!['n'],
      2,
    );
    assert.equal(
      (
        await sql.query(
          'SELECT count(*)::int AS n FROM gallery.notification_outbox',
        )
      ).rows[0]!['n'],
      0,
    );
  } finally {
    await sql.close();
  }
});

it('checks all conflicts and fixture integrity before publishing any new entries', async () => {
  const { sql, store, seed } = await setup();
  try {
    store.documents.set(seed.at(-1)!.id, {
      ...seed.at(-1)!,
      medium: 'Conflicting content',
    });
    await assert.rejects(applyArtFormSeed(sql, store, seed), /conflicts/);
    assert.equal(await store.get(seed[0]!.id), null);
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.artworks'))
        .rows[0]!['n'],
      6,
    );
    store.documents.delete(seed.at(-1)!.id);
    const changed = structuredClone(seed);
    changed[0]!.description = 'Uncredited invented work';
    await assert.rejects(applyArtFormSeed(sql, store, changed), /differs/);
    assert.equal(store.documents.size, 6);
  } finally {
    await sql.close();
  }
});

it('recovers matching pending publications with and without an acknowledged document', async () => {
  const { sql, store, seed } = await setup();
  try {
    await applyArtFormSeed(sql, store, seed);
    await sql.query(
      "UPDATE gallery.artworks SET status='pending' WHERE id=ANY($1::text[])",
      [[seed[0]!.id, seed[1]!.id]],
    );
    await store.remove(seed[0]!.id);
    await applyArtFormSeed(sql, store, seed);
    for (const art of seed) assert.deepEqual(await store.get(art.id), art);
    assert.equal(
      (
        await sql.query(
          "SELECT count(*)::int AS n FROM gallery.artworks WHERE status='pending'",
        )
      ).rows[0]!['n'],
      0,
    );
  } finally {
    await sql.close();
  }
});

it('validates every supported shape and rejects malformed, mismatched and unbounded details', () => {
  for (const { details } of artFormCollection) {
    const category = {
      painting: 'Painting',
      sculpture: 'Sculpture',
      ceramics: 'Ceramics',
      photography: 'Photography',
      printmaking: 'Printmaking',
      textile: 'Textile',
    }[details.type];
    assert.deepEqual(parseArtDetails(details, category), details);
  }
  assert.equal(parseArtDetails(undefined, 'Legacy category'), undefined);
  for (const value of [
    null,
    [],
    'sculpture',
    { type: '$where' },
    { type: 'sculpture', material: 'Bronze' },
    { type: 'sculpture', material: 'Bronze', dimensions: 42 },
    { type: 'sculpture', material: 'x'.repeat(201), dimensions: '1 m' },
    { type: 'sculpture', material: '\u0000', dimensions: '1 m' },
    { type: 'sculpture', material: 'Bronze', dimensions: '1 m', paint: 'Oil' },
  ])
    assert.throws(() => parseArtDetails(value, 'Sculpture'));
  assert.throws(
    () => parseArtDetails(artFormCollection[2]!.details, 'Photography'),
    /match/,
  );
});
