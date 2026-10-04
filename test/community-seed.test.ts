import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { demoData } from '../server/src/demo-data.js';
import {
  applyCommunitySeed,
  buildCommunitySeed,
  checkCommunitySeed,
  validateCommunitySeed,
} from '../server/src/community-seed.js';
import { collectionImages } from '../shared/collection-images.js';

async function setup() {
  const sql = await localDatabase(),
    store = new LocalArtworkStore();
  await demoData(sql, store);
  const targets = (
    await sql.query<{ id: string; title: string }>(
      'SELECT id,title FROM gallery.artworks ORDER BY id',
    )
  ).rows;
  const patron = String(
    (await sql.query("SELECT id FROM gallery.users WHERE username='demo'"))
      .rows[0]!['id'],
  );
  const seed = await buildCommunitySeed(
    'https://gallery.example',
    targets,
    patron,
  );
  return { sql, store, seed, patron };
}

it('adds labeled community fixtures idempotently while preserving existing content, activity and credentials', async () => {
  const { sql, store, seed, patron } = await setup();
  try {
    const originalDocs = [...store.documents.values()].map((a) =>
      structuredClone(a),
    );
    const originalUsers = (
      await sql.query('SELECT * FROM gallery.users ORDER BY id')
    ).rows;
    await sql.query(
      'INSERT INTO gallery.likes(user_id,artwork_id) VALUES($1,$2)',
      [patron, seed.targets[0]!.id],
    );
    await sql.query(
      "INSERT INTO gallery.reviews(id,user_id,artwork_id,text) VALUES('real-comment',$1,$2,'Existing visitor comment')",
      [patron, seed.targets[0]!.id],
    );
    await checkCommunitySeed(sql, store, seed);
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.users'))
        .rows[0]!['n'],
      2,
    );
    await applyCommunitySeed(sql, store, seed);
    const first = (
      await sql.query(
        'SELECT id,created_at,like_count,review_count FROM gallery.artworks ORDER BY id',
      )
    ).rows;
    await applyCommunitySeed(sql, store, seed);
    assert.deepEqual(
      (
        await sql.query(
          'SELECT id,created_at,like_count,review_count FROM gallery.artworks ORDER BY id',
        )
      ).rows,
      first,
    );
    for (const [table, expected] of [
      ['users', 18],
      ['artworks', 30],
      ['likes', seed.likes.length + 1],
      ['reviews', seed.reviews.length + 1],
      ['follows', seed.follows.length],
      ['notification_outbox', 0],
      ['notification_preferences', 0],
      ['sessions', 0],
    ] as const) {
      assert.equal(
        (await sql.query(`SELECT count(*)::int AS n FROM gallery.${table}`))
          .rows[0]!['n'],
        expected,
        table,
      );
    }
    assert.deepEqual(
      (
        await sql.query(
          'SELECT * FROM gallery.users WHERE id=ANY($1::text[]) ORDER BY id',
          [originalUsers.map((u) => u['id'])],
        )
      ).rows,
      originalUsers,
    );
    for (const art of originalDocs)
      assert.deepEqual(await store.get(art.id), art);
    assert.equal(
      (
        await sql.query(
          "SELECT text FROM gallery.reviews WHERE id='real-comment'",
        )
      ).rows[0]!['text'],
      'Existing visitor comment',
    );
    const counters = (
      await sql.query(
        `SELECT id FROM gallery.artworks a WHERE like_count<>(SELECT count(*) FROM gallery.likes l WHERE l.artwork_id=a.id) OR review_count<>(SELECT count(*) FROM gallery.reviews r WHERE r.artwork_id=a.id)`,
      )
    ).rows;
    assert.equal(counters.length, 0);
    assert.equal(
      (
        await sql.query(
          'SELECT id FROM gallery.users WHERE id=ANY($1::text[]) AND (email IS NOT NULL OR email_verified_at IS NOT NULL OR terms_accepted_at IS NOT NULL)',
          [seed.users.map((u) => u.id)],
        )
      ).rows.length,
      0,
    );
    assert.ok(seed.users.every((u) => u.username.endsWith('(Demo)')));
    assert.ok(seed.reviews.every((r) => r.text.startsWith('[Demo comment]')));
    assert.ok(
      seed.artworks.every(
        (a) =>
          collectionImages.some(
            (i) => a.imageUrl === `${seed.origin}/artworks/${i.file}`,
          ) && a.description.includes('did not create the artwork'),
      ),
    );
  } finally {
    await sql.close();
  }
});

it('rejects account and post collisions before adding or overwriting data', async () => {
  const { sql, store, seed } = await setup();
  try {
    await sql.query(
      'INSERT INTO gallery.users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
      [seed.users[0]!.id, 'An existing user', 'untouched', 'patron'],
    );
    await assert.rejects(
      applyCommunitySeed(sql, store, seed),
      /conflicts with an existing account/,
    );
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.users'))
        .rows[0]!['n'],
      3,
    );
    assert.equal(store.documents.size, 6);
    await sql.query('DELETE FROM gallery.users WHERE id=$1', [
      seed.users[0]!.id,
    ]);
    await store.create({
      ...seed.artworks[0]!,
      description: 'Existing independent content',
    });
    await assert.rejects(
      applyCommunitySeed(sql, store, seed),
      /conflicts with existing content/,
    );
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.users'))
        .rows[0]!['n'],
      2,
    );
  } finally {
    await sql.close();
  }
});

it('rolls back relationship additions when a seeded comment ID already belongs to other content', async () => {
  const { sql, store, seed, patron } = await setup();
  try {
    await sql.query(
      'INSERT INTO gallery.reviews(id,user_id,artwork_id,text) VALUES($1,$2,$3,$4)',
      [
        seed.reviews[0]!.id,
        patron,
        seed.targets[0]!.id,
        'Keep my original comment',
      ],
    );
    await assert.rejects(
      applyCommunitySeed(sql, store, seed),
      /comment conflicts/,
    );
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.likes'))
        .rows[0]!['n'],
      0,
    );
    assert.equal(
      (await sql.query('SELECT count(*)::int AS n FROM gallery.follows'))
        .rows[0]!['n'],
      0,
    );
    assert.equal(
      (
        await sql.query('SELECT text FROM gallery.reviews WHERE id=$1', [
          seed.reviews[0]!.id,
        ])
      ).rows[0]!['text'],
      'Keep my original comment',
    );
  } finally {
    await sql.close();
  }
});

it('resumes known pending publications and rejects private image or unlabeled fixture edits', async () => {
  const { sql, store, seed } = await setup();
  try {
    const privateImage = structuredClone(seed);
    privateImage.artworks[0]!.imageUrl =
      'https://storage.example/private-photo.jpg';
    assert.throws(
      () => validateCommunitySeed(privateImage),
      /public-source fixture/,
    );
    const fakePerson = structuredClone(seed);
    fakePerson.users[0]!.username = 'A real person';
    assert.throws(
      () => validateCommunitySeed(fakePerson),
      /public-source fixture/,
    );
    await applyCommunitySeed(sql, store, seed);
    await sql.query(
      "UPDATE gallery.artworks SET status='pending' WHERE id=$1",
      [seed.artworks[0]!.id],
    );
    await store.remove(seed.artworks[0]!.id);
    await applyCommunitySeed(sql, store, seed);
    assert.deepEqual(await store.get(seed.artworks[0]!.id), seed.artworks[0]);
    assert.equal(
      (
        await sql.query('SELECT status FROM gallery.artworks WHERE id=$1', [
          seed.artworks[0]!.id,
        ])
      ).rows[0]!['status'],
      'published',
    );
  } finally {
    await sql.close();
  }
});
