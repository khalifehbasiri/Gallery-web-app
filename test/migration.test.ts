import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  normalizeLegacy,
  importSnapshot,
  validateSnapshot,
  verifySnapshot,
} from '../server/src/migration.js';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { verifyPassword } from '../server/src/passwords.js';
import { publish } from '../server/src/catalog.js';
const artist = 'a'.repeat(24),
  patron = 'b'.repeat(24),
  art = 'c'.repeat(24);
const legacyUsers = [
  {
    _id: artist,
    username: 'Artist',
    password: 'old password',
    aType: 'artist',
    workshops: [
      {
        name: 'Workshop',
        goal: 'Learn',
        duration: '2',
        signed: [{ name: 'Patron' }],
      },
    ],
  },
  {
    _id: patron,
    username: 'Patron',
    password: 'legacy',
    aType: 'patron',
    like: [{ _id: art }],
    following: [{ _id: artist, username: 'Artist' }],
  },
];
const legacyArt = [
  {
    _id: art,
    name: 'Original',
    artist: 'Artist',
    year: '2020',
    category: 'Painting',
    medium: 'Oil',
    description: 'Original description',
    image: 'https://example.org/painting.png',
    reviews: [{ user: 'Patron', userId: patron, review: 'Thoughtful' }],
    numLikes: ['like', 'like'],
  },
];
it('migrates stable IDs, hashes credentials, normalizes relationships and safely retries imports', async () => {
  const snapshot = await normalizeLegacy(legacyUsers, legacyArt),
    db = await localDatabase(),
    store = new LocalArtworkStore();
  try {
    assert.ok(
      await verifyPassword('old password', snapshot.users[0]!.passwordHash),
    );
    await importSnapshot(db, store, snapshot);
    await importSnapshot(db, store, snapshot);
    await verifySnapshot(db, store, snapshot);
    for (const [table, expected] of [
      ['users', 2],
      ['artworks', 1],
      ['likes', 1],
      ['reviews', 1],
      ['follows', 1],
      ['workshops', 1],
      ['enrollments', 1],
    ] as const)
      assert.equal(
        Number(
          (await db.query(`SELECT count(*) AS count FROM gallery.${table}`))
            .rows[0]!['count'],
        ),
        expected,
      );
    const row = (
      await db.query('SELECT * FROM gallery.artworks WHERE id=$1', [art])
    ).rows[0]!;
    assert.equal(row['like_count'], 1);
    assert.equal(row['review_count'], 1);
    assert.equal((await store.get(art))?.description, 'Original description');
    assert.ok(snapshot.warnings.length);
    assert.equal(
      (await db.query('SELECT count(*) AS count FROM gallery.sessions'))
        .rows[0]!['count'],
      0,
    );
    await db.query('DELETE FROM gallery.enrollments');
    await assert.rejects(
      verifySnapshot(db, store, snapshot),
      /Enrollment missing/,
    );
  } finally {
    await db.close();
  }
});
it('validates edited snapshots before any target writes', async () => {
  const snapshot = await normalizeLegacy(legacyUsers, legacyArt);
  snapshot.likes.push({ userId: 'd'.repeat(24), artworkId: art });
  assert.throws(() => validateSnapshot(snapshot), /reference/);
});
it('rejects dangling legacy references and duplicate content before touching a target', async () => {
  await assert.rejects(
    normalizeLegacy(
      [{ ...legacyUsers[1], like: [{ _id: 'd'.repeat(24) }] }],
      [],
    ),
    /missing artwork/,
  );
  await assert.rejects(
    normalizeLegacy(legacyUsers, [...legacyArt, ...legacyArt]),
    /Duplicate/,
  );
  await assert.rejects(
    normalizeLegacy(legacyUsers, [
      { ...legacyArt[0], image: 'javascript:alert(1)' },
    ]),
    /HTTPS/,
  );
});
it('keeps interrupted Firestore publications out of public queries and permits a clean retry', async () => {
  const db = await localDatabase(),
    store = new LocalArtworkStore();
  const snapshot = await normalizeLegacy(legacyUsers, legacyArt);
  try {
    await db.query(
      'INSERT INTO gallery.users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
      [artist, 'Artist', snapshot.users[0]!.passwordHash, 'artist'],
    );
    const broken = {
      ...store,
      get: store.get.bind(store),
      create: async () => {
        throw new Error('Firestore offline');
      },
      remove: store.remove.bind(store),
      close: store.close.bind(store),
    };
    await assert.rejects(
      publish(db, broken, snapshot.artworks[0]!),
      /Firestore offline/,
    );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS count FROM gallery.artworks'))
          .rows[0]!['count'],
      ),
      0,
    );
    await publish(db, store, snapshot.artworks[0]!);
    assert.equal(
      (await db.query('SELECT status FROM gallery.artworks')).rows[0]![
        'status'
      ],
      'published',
    );
  } finally {
    await db.close();
  }
});
it('does not overwrite an existing account or artwork during migration retries', async () => {
  const db = await localDatabase(),
    store = new LocalArtworkStore(),
    snapshot = await normalizeLegacy(legacyUsers, legacyArt);
  try {
    await importSnapshot(db, store, snapshot);
    await db.query('UPDATE gallery.users SET password_hash=$1 WHERE id=$2', [
      'keep this existing password',
      artist,
    ]);
    await importSnapshot(db, store, snapshot);
    assert.equal(
      (
        await db.query('SELECT password_hash FROM gallery.users WHERE id=$1', [
          artist,
        ])
      ).rows[0]!['password_hash'],
      'keep this existing password',
    );
    snapshot.artworks[0]!.description = 'Conflict';
    await assert.rejects(importSnapshot(db, store, snapshot), /conflicts/);
    assert.equal((await store.get(art))!.description, 'Original description');
  } finally {
    await db.close();
  }
});
