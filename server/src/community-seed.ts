import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  collectionImages,
  demoCollectionDescription,
} from '../../shared/collection-images.js';
import type { Sql } from './database.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';
import { publish } from './catalog.js';
import { hashPassword } from './passwords.js';

const id = (key: string) =>
  createHash('sha256')
    .update(`gallery-community-demo:v1:${key}`)
    .digest('hex')
    .slice(0, 24);
const names = [
  'Elena Brooks',
  'Noah Bennett',
  'Sofia Chen',
  'Theo Martin',
  'Leila Morgan',
  'Julian Park',
  'Amelia Hart',
  'Oliver Reed',
  'Isabel Rossi',
  'Lucas Patel',
  'Amina Hassan',
  'Ethan Clarke',
  'Zoe Nguyen',
  'Gabriel Silva',
  'Chloe Evans',
  'Sam Taylor',
];
const themes = [
  'Color and rhythm',
  'A closer look',
  'Light and atmosphere',
  'Collected perspectives',
  'Notes on composition',
  'Details worth noticing',
];
const comments = [
  'The balance between light and shadow gives this composition a quiet energy.',
  'I keep coming back to the small details near the edges of the composition.',
  'The colors feel different each time I look at this piece. A lovely collection choice.',
  'The texture adds so much depth; I would enjoy seeing the original in person.',
  'The sense of movement is what caught my attention first.',
  'An interesting contrast between the foreground and the background.',
  'This would be a great piece to discuss in a workshop on composition.',
  'The restrained palette makes the brighter areas stand out beautifully.',
  'Thank you for including the museum credit and the original artist information.',
  'The atmosphere is memorable, especially the way the shapes lead the eye.',
  'I noticed a new detail on my second visit. This rewards a closer look.',
  'A thoughtful addition to the collection; the medium really suits the subject.',
];

export interface CommunitySeed {
  version: 1;
  origin: string;
  targets: { id: string; title: string }[];
  demoPatronId?: string;
  users: {
    id: string;
    username: string;
    role: 'artist' | 'patron';
    passwordHash: string;
  }[];
  artworks: ArtworkDocument[];
  likes: { userId: string; artworkId: string }[];
  reviews: { id: string; userId: string; artworkId: string; text: string }[];
  follows: { userId: string; artistId: string }[];
}

function fixture(
  origin: string,
  targets: CommunitySeed['targets'],
  demoPatronId: string | undefined,
  hashes: string[],
): CommunitySeed {
  const users: CommunitySeed['users'] = names.map((name, index) => ({
    id: id(`user:${name}`),
    username: `${name} (Demo)`,
    role: index < 6 ? 'artist' : 'patron',
    passwordHash: hashes[index]!,
  }));
  const artworks = collectionImages.map((image, index): ArtworkDocument => {
    const owner = users[Math.floor(index / 4)]!;
    return {
      id: id(`artwork:${image.id}`),
      artistId: owner.id,
      title: `${themes[Math.floor(index / 4)]}: ${image.title}`,
      description: demoCollectionDescription(image, owner.username),
      imageUrl: `${origin}/artworks/${image.file}`,
      category: 'Painting',
      medium: image.medium,
      year: image.year,
    };
  });
  const all = [...targets, ...artworks];
  const likes: CommunitySeed['likes'] = [],
    reviews: CommunitySeed['reviews'] = [],
    follows: CommunitySeed['follows'] = [];
  for (const [index, artwork] of all.entries()) {
    for (const [actor, user] of users.entries()) {
      if ('artistId' in artwork && artwork.artistId === user.id) continue;
      if (
        (actor + index * 5) % users.length <
        [3, 7, 5, 11, 4, 9, 6, 12][index % 8]!
      )
        likes.push({ userId: user.id, artworkId: artwork.id });
    }
    for (let n = 0; n < 1 + (index % 4); n++) {
      const user = users[(index * 3 + n * 5) % users.length]!;
      reviews.push({
        id: id(`comment:${artwork.id}:${user.id}`),
        userId: user.id,
        artworkId: artwork.id,
        text: `[Demo comment] ${comments[(index + n * 3) % comments.length]}`,
      });
    }
  }
  for (const [index, user] of users.entries())
    for (let n = 0; n < 3; n++) {
      const artist = users[(index + n + 1) % 6]!;
      if (artist.id !== user.id)
        follows.push({ userId: user.id, artistId: artist.id });
    }
  if (demoPatronId)
    for (const artist of users.slice(0, 6))
      follows.push({ userId: demoPatronId, artistId: artist.id });
  return {
    version: 1,
    origin,
    targets,
    demoPatronId,
    users,
    artworks,
    likes,
    reviews,
    follows,
  };
}

export async function buildCommunitySeed(
  origin: string,
  targets: CommunitySeed['targets'],
  demoPatronId?: string,
) {
  // These fictional profiles have no published login secret, real email, or consent.
  const hashes = await Promise.all(
    names.map(() => hashPassword(randomBytes(32).toString('base64url'))),
  );
  return fixture(origin, targets, demoPatronId, hashes);
}

export function validateCommunitySeed(seed: CommunitySeed) {
  if (
    (seed.origin && !/^https:\/\//.test(seed.origin)) ||
    seed.targets.some((t) => !/^[a-f0-9]{24}$/.test(t.id)) ||
    new Set(seed.targets.map((t) => t.id)).size !== seed.targets.length ||
    seed.targets.length > 100 ||
    (seed.demoPatronId && !/^[a-f0-9]{24}$/.test(seed.demoPatronId))
  )
    throw new Error('Invalid community seed scope.');
  const expected = fixture(
    seed.origin,
    seed.targets,
    seed.demoPatronId,
    seed.users.map((u) => u.passwordHash),
  );
  if (
    !isDeepStrictEqual(seed, expected) ||
    seed.users.some((u) => !u.passwordHash.startsWith('scrypt$'))
  )
    throw new Error(
      'Community seed differs from the labeled public-source fixture.',
    );
  if (
    new Set([...seed.targets, ...seed.artworks].map((a) => a.id)).size !==
    seed.targets.length + seed.artworks.length
  )
    throw new Error('Community artwork ID collision.');
}

const projection = (a: ArtworkDocument) => ({
  artist_id: a.artistId,
  title: a.title,
  year: a.year,
  category: a.category,
  medium: a.medium,
  description_preview: a.description.slice(0, 280),
  image_url: a.imageUrl,
});

// Preflight runs before any mutation, including dry runs. Existing activity is never replaced.
export async function checkCommunitySeed(
  sql: Sql,
  store: ArtworkStore,
  seed: CommunitySeed,
) {
  validateCommunitySeed(seed);
  const users = (
    await sql.query(
      'SELECT id,username,role,password_hash,email,deletion_requested_at FROM gallery.users WHERE id=ANY($1::text[]) OR username=ANY($2::text[])',
      [seed.users.map((u) => u.id), seed.users.map((u) => u.username)],
    )
  ).rows;
  for (const row of users) {
    const user = seed.users.find((u) => u.id === row['id']);
    if (
      !user ||
      user.username !== row['username'] ||
      user.role !== row['role'] ||
      user.passwordHash !== row['password_hash'] ||
      row['email'] !== null ||
      row['deletion_requested_at'] !== null
    )
      throw new Error(
        'A demo profile conflicts with an existing account; no account will be overwritten.',
      );
  }
  if (seed.demoPatronId) {
    const demo = (
      await sql.query(
        "SELECT id FROM gallery.users WHERE id=$1 AND username='demo' AND role='patron' AND deletion_requested_at IS NULL",
        [seed.demoPatronId],
      )
    ).rows;
    if (!demo.length) throw new Error('Public demo patron not found.');
  }
  const rows = (
    await sql.query(
      'SELECT * FROM gallery.artworks WHERE id=ANY($1::text[]) OR title=ANY($2::text[])',
      [
        [...seed.targets, ...seed.artworks].map((a) => a.id),
        seed.artworks.map((a) => a.title),
      ],
    )
  ).rows;
  for (const target of seed.targets) {
    const row = rows.find((r) => r['id'] === target.id);
    if (!row || row['status'] !== 'published' || row['title'] !== target.title)
      throw new Error(
        'An explicitly scoped original post changed or is unavailable.',
      );
  }
  for (const art of seed.artworks) {
    const row = rows.find(
      (r) => r['id'] === art.id || r['title'] === art.title,
    );
    const doc = await store.get(art.id);
    if (
      row &&
      (row['id'] !== art.id ||
        Object.entries(projection(art)).some(([k, v]) => row[k] !== v))
    )
      throw new Error('A demo post conflicts with existing metadata.');
    if (doc && !isDeepStrictEqual(doc, art))
      throw new Error('A demo document conflicts with existing content.');
    if ((row?.['status'] === 'published' && !doc) || (!row && doc))
      throw new Error('A demo publication requires manual reconciliation.');
  }
}

export async function applyCommunitySeed(
  sql: Sql,
  store: ArtworkStore,
  seed: CommunitySeed,
) {
  await checkCommunitySeed(sql, store, seed);
  await sql.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO gallery.users(id,username,password_hash,role) SELECT id,username,"passwordHash",role FROM jsonb_to_recordset($1::jsonb) AS x(id text,username text,"passwordHash" text,role text) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(seed.users)],
    );
  });
  for (const art of seed.artworks) {
    const row = (
      await sql.query('SELECT status FROM gallery.artworks WHERE id=$1', [
        art.id,
      ])
    ).rows[0];
    if (!row) await publish(sql, store, art);
    else if (row['status'] === 'pending') {
      if (!(await store.get(art.id))) await store.create(art);
      await sql.query(
        "UPDATE gallery.artworks SET status='published' WHERE id=$1 AND status='pending'",
        [art.id],
      );
    }
  }
  const targets = [...seed.targets, ...seed.artworks].map((a) => a.id).sort();
  await sql.transaction(async (tx) => {
    // Same lock order as request mutations; aggregate counts include real activity.
    const actorIds = [
      ...seed.users.map((u) => u.id),
      ...(seed.demoPatronId ? [seed.demoPatronId] : []),
    ].sort();
    const actors = (
      await tx.query(
        'SELECT id FROM gallery.users WHERE id=ANY($1::text[]) AND deletion_requested_at IS NULL ORDER BY id FOR SHARE',
        [actorIds],
      )
    ).rows;
    if (actors.length !== actorIds.length)
      throw new Error('A seed actor was removed.');
    const locked = (
      await tx.query(
        "SELECT id FROM gallery.artworks WHERE id=ANY($1::text[]) AND status='published' ORDER BY id FOR UPDATE",
        [targets],
      )
    ).rows;
    if (locked.length !== targets.length)
      throw new Error('A seed target was removed.');
    await tx.query(
      `INSERT INTO gallery.likes(user_id,artwork_id) SELECT "userId","artworkId" FROM jsonb_to_recordset($1::jsonb) AS x("userId" text,"artworkId" text) ON CONFLICT DO NOTHING`,
      [JSON.stringify(seed.likes)],
    );
    await tx.query(
      `INSERT INTO gallery.reviews(id,user_id,artwork_id,text) SELECT id,"userId","artworkId",text FROM jsonb_to_recordset($1::jsonb) AS x(id text,"userId" text,"artworkId" text,text text) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(seed.reviews)],
    );
    const reviews = (
      await tx.query(
        'SELECT id,user_id,artwork_id,text FROM gallery.reviews WHERE id=ANY($1::text[])',
        [seed.reviews.map((r) => r.id)],
      )
    ).rows;
    for (const r of seed.reviews) {
      const existing = reviews.find((row) => row['id'] === r.id);
      if (
        !existing ||
        existing['user_id'] !== r.userId ||
        existing['artwork_id'] !== r.artworkId ||
        existing['text'] !== r.text
      )
        throw new Error('A sample comment conflicts with existing activity.');
    }
    await tx.query(
      `INSERT INTO gallery.follows(user_id,artist_id) SELECT "userId","artistId" FROM jsonb_to_recordset($1::jsonb) AS x("userId" text,"artistId" text) ON CONFLICT DO NOTHING`,
      [JSON.stringify(seed.follows)],
    );
    await tx.query(
      `UPDATE gallery.artworks a SET like_count=(SELECT count(*)::int FROM gallery.likes l WHERE l.artwork_id=a.id),review_count=(SELECT count(*)::int FROM gallery.reviews r WHERE r.artwork_id=a.id) WHERE a.id=ANY($1::text[])`,
      [targets],
    );
  });
  // No notification dispatch: sample likes are fixtures, not real recipient events.
  return {
    profiles: seed.users.length,
    posts: seed.artworks.length,
    likes: seed.likes.length,
    comments: seed.reviews.length,
    follows: seed.follows.length,
  };
}
