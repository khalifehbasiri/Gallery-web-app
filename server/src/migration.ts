import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, isPasswordHash } from './passwords.js';
import { textField, HttpError } from './http.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';
import type { Sql } from './database.js';
import { publish } from './catalog.js';
type Raw = Record<string, any>;
export interface Snapshot {
  format: 1;
  users: {
    id: string;
    username: string;
    passwordHash: string;
    role: 'artist' | 'patron';
  }[];
  artworks: ArtworkDocument[];
  likes: { userId: string; artworkId: string }[];
  follows: { userId: string; artistId: string }[];
  reviews: { id: string; userId: string; artworkId: string; text: string }[];
  workshops: {
    id: string;
    artistId: string;
    name: string;
    goal: string;
    weeks: number;
  }[];
  enrollments: { userId: string; workshopId: string }[];
  warnings: string[];
}
const stable = (...parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
const id = (value: unknown) => {
  const s = String(value);
  if (!/^[a-f0-9]{24}$/i.test(s))
    throw new HttpError(400, 'Invalid legacy ID.');
  return s.toLowerCase();
};
export async function normalizeLegacy(
  users: Raw[],
  artworks: Raw[],
): Promise<Snapshot> {
  const result: Snapshot = {
    format: 1,
    users: [],
    artworks: [],
    likes: [],
    follows: [],
    reviews: [],
    workshops: [],
    enrollments: [],
    warnings: [],
  };
  const byName = new Map<string, string>(),
    knownIds = new Set<string>();
  for (const user of users) {
    const username = textField(user, 'username', 80),
      userId = id(user['_id']);
    if (byName.has(username) || knownIds.has(userId))
      throw new Error('Duplicate legacy account.');
    byName.set(username, userId);
    knownIds.add(userId);
    const password =
      typeof user['password'] === 'string' && user['password']
        ? user['password']
        : randomBytes(32).toString('hex');
    result.users.push({
      id: userId,
      username,
      passwordHash: isPasswordHash(password)
        ? password
        : await hashPassword(password),
      role: user['aType'] === 'artist' ? 'artist' : 'patron',
    });
  }
  const ensureArtist = async (name: string) => {
    if (byName.has(name)) return byName.get(name)!;
    const userId = stable('legacy-artist', name);
    byName.set(name, userId);
    knownIds.add(userId);
    result.users.push({
      id: userId,
      username: name,
      passwordHash: await hashPassword(randomBytes(32).toString('hex')),
      role: 'artist',
    });
    result.warnings.push(
      `Created an account with an unknown random password for missing artist: ${name}`,
    );
    return userId;
  };
  const titles = new Set<string>(),
    artIds = new Set<string>();
  for (const raw of artworks) {
    const title = textField(raw, 'name'),
      artist = textField(raw, 'artist', 80),
      artworkId = raw['_id']
        ? id(raw['_id'])
        : stable('legacy-artwork', artist, title);
    if (titles.has(title) || artIds.has(artworkId))
      throw new Error('Duplicate legacy artwork title or ID.');
    titles.add(title);
    artIds.add(artworkId);
    const imageUrl = textField(raw, 'image', 2048);
    if (!imageUrl.startsWith('/uploads/') && !/^https:\/\//.test(imageUrl))
      throw new Error('Legacy image must use HTTPS or a local upload path.');
    const art = {
      id: artworkId,
      artistId: await ensureArtist(artist),
      title,
      year: textField(raw, 'year', 4),
      category: textField(raw, 'category'),
      medium: textField(raw, 'medium'),
      description: textField(raw, 'description', 10000),
      imageUrl,
    };
    if (!/^\d{1,4}$/.test(art.year))
      throw new Error('Invalid legacy artwork year.');
    result.artworks.push(art);
    for (const [i, r] of (raw['reviews'] || []).entries()) {
      const userId =
        r['userId'] && knownIds.has(String(r['userId']))
          ? String(r['userId'])
          : byName.get(r['user']);
      if (!userId)
        throw new Error('Legacy review references a missing account.');
      const text = textField({ text: r['review'] }, 'text', 2000);
      result.reviews.push({
        id:
          r['reviewId'] || stable('review', artworkId, String(i), userId, text),
        userId,
        artworkId,
        text,
      });
    }
    if ((raw['numLikes'] || []).length)
      result.warnings.push(
        `Artwork ${artworkId}: like counts will be rebuilt from user relationships.`,
      );
  }
  for (const raw of users) {
    const userId = id(raw['_id']);
    for (const r of raw['like'] || []) {
      const artworkId = String(r['_id']);
      if (!artIds.has(artworkId))
        throw new Error('Legacy like references a missing artwork.');
      result.likes.push({ userId, artworkId });
    }
    for (const r of raw['following'] || []) {
      const artistId = byName.get(r['username']) || String(r['_id']);
      if (!knownIds.has(artistId) || artistId === userId)
        throw new Error('Invalid legacy following relationship.');
      result.follows.push({ userId, artistId });
    }
    for (const w of raw['workshops'] || []) {
      const name = textField(w, 'name'),
        goal = textField(w, 'goal', 2000),
        weeks = Number(w['duration']);
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 9999)
        throw new Error('Invalid legacy workshop duration.');
      const workshopId = w['workshopId'] || stable('workshop', userId, name);
      result.workshops.push({
        id: workshopId,
        artistId: userId,
        name,
        goal,
        weeks,
      });
      for (const e of w['signed'] || []) {
        const attendee = byName.get(e['name']);
        if (!attendee)
          throw new Error('Legacy enrollment references a missing account.');
        result.enrollments.push({ userId: attendee, workshopId });
      }
    }
  }
  return result;
}
export async function importSnapshot(
  sql: Sql,
  store: ArtworkStore,
  snapshot: Snapshot,
) {
  validateSnapshot(snapshot);
  // Never overwrite records on retry. Conflicting identities/content require operator resolution.
  for (const u of snapshot.users) {
    const old = (
      await sql.query(
        'SELECT id,username FROM gallery.users WHERE id=$1 OR username=$2',
        [u.id, u.username],
      )
    ).rows[0];
    if (old && (old['id'] !== u.id || old['username'] !== u.username))
      throw new Error('Target account conflicts with the snapshot.');
    await sql.query(
      'INSERT INTO gallery.users(id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
      [u.id, u.username, u.passwordHash, u.role],
    );
  }
  for (const a of snapshot.artworks) {
    const old = (
      await sql.query(
        'SELECT id,status FROM gallery.artworks WHERE id=$1 OR title=$2',
        [a.id, a.title],
      )
    ).rows[0];
    if (old && old['id'] !== a.id)
      throw new Error('Target artwork title conflicts with the snapshot.');
    if (old) {
      const doc = await store.get(a.id);
      if (doc && JSON.stringify(doc) !== JSON.stringify(a)) {
        for (const key of Object.keys(a) as (keyof ArtworkDocument)[])
          if (doc[key] !== a[key])
            throw new Error(
              'Target artwork content conflicts with the snapshot.',
            );
      }
      if (!doc) await store.create(a);
      await sql.query(
        "UPDATE gallery.artworks SET status='published' WHERE id=$1",
        [a.id],
      );
    } else await publish(sql, store, a);
  }
  await sql.transaction(async (tx) => {
    for (const r of snapshot.likes)
      await tx.query(
        'INSERT INTO gallery.likes(user_id,artwork_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [r.userId, r.artworkId],
      );
    for (const r of snapshot.follows)
      await tx.query(
        'INSERT INTO gallery.follows(user_id,artist_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [r.userId, r.artistId],
      );
    for (const r of snapshot.reviews)
      await tx.query(
        'INSERT INTO gallery.reviews(id,user_id,artwork_id,text) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
        [r.id, r.userId, r.artworkId, r.text],
      );
    for (const r of snapshot.workshops)
      await tx.query(
        'INSERT INTO gallery.workshops(id,artist_id,name,goal,weeks) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
        [r.id, r.artistId, r.name, r.goal, r.weeks],
      );
    for (const r of snapshot.enrollments)
      await tx.query(
        'INSERT INTO gallery.enrollments(user_id,workshop_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [r.userId, r.workshopId],
      );
    await tx.query(
      'UPDATE gallery.artworks a SET like_count=(SELECT count(*) FROM gallery.likes l WHERE l.artwork_id=a.id),review_count=(SELECT count(*) FROM gallery.reviews r WHERE r.artwork_id=a.id) WHERE a.id=ANY($1::text[])',
      [snapshot.artworks.map((a) => a.id)],
    );
  });
}

export function validateSnapshot(s: Snapshot) {
  if (
    s.format !== 1 ||
    ![
      'users',
      'artworks',
      'likes',
      'follows',
      'reviews',
      'workshops',
      'enrollments',
      'warnings',
    ].every((k) => Array.isArray(s[k as keyof Snapshot]))
  )
    throw new Error('Invalid snapshot.');
  const unique = <T>(items: T[], key: (item: T) => string) => {
    const ids = items.map(key);
    if (new Set(ids).size !== ids.length)
      throw new Error('Duplicate snapshot identity.');
    return new Set(ids);
  };
  const users = unique(s.users, (u) => id(u.id)),
    arts = unique(s.artworks, (a) => id(a.id)),
    workshops = unique(s.workshops, (w) => w.id);
  unique(s.users, (u) => u.username);
  unique(s.artworks, (a) => a.title);
  unique(s.reviews, (r) => r.id);
  for (const u of s.users) {
    textField(u, 'username', 80);
    if (
      !isPasswordHash(u.passwordHash) ||
      !['artist', 'patron'].includes(u.role)
    )
      throw new Error('Invalid snapshot account.');
  }
  for (const a of s.artworks) {
    if (!users.has(a.artistId)) throw new Error('Missing snapshot artist.');
    for (const f of ['title', 'category', 'medium'] as const) textField(a, f);
    textField(a, 'description', 10000);
    if (
      !/^\d{1,4}$/.test(a.year) ||
      !/^(https:\/\/|\/uploads\/)/.test(a.imageUrl)
    )
      throw new Error('Invalid snapshot artwork.');
  }
  for (const r of s.likes)
    if (!users.has(r.userId) || !arts.has(r.artworkId))
      throw new Error('Missing snapshot like reference.');
  for (const r of s.follows)
    if (
      !users.has(r.userId) ||
      !users.has(r.artistId) ||
      r.userId === r.artistId
    )
      throw new Error('Invalid snapshot follow reference.');
  for (const r of s.reviews) {
    textField(r, 'text', 2000);
    if (!users.has(r.userId) || !arts.has(r.artworkId))
      throw new Error('Missing snapshot review reference.');
  }
  for (const w of s.workshops) {
    textField(w, 'name');
    textField(w, 'goal', 2000);
    if (
      !users.has(w.artistId) ||
      !Number.isInteger(w.weeks) ||
      w.weeks < 1 ||
      w.weeks > 9999
    )
      throw new Error('Invalid snapshot workshop.');
  }
  for (const r of s.enrollments)
    if (!users.has(r.userId) || !workshops.has(r.workshopId))
      throw new Error('Missing snapshot enrollment reference.');
}

export async function verifySnapshot(
  sql: Sql,
  store: ArtworkStore,
  s: Snapshot,
) {
  validateSnapshot(s);
  for (const a of s.artworks) {
    const doc = await store.get(a.id);
    if (
      !doc ||
      Object.keys(a).some(
        (k) =>
          doc[k as keyof ArtworkDocument] !== a[k as keyof ArtworkDocument],
      )
    )
      throw new Error('Artwork document missing or differs from snapshot.');
    const row = (
      await sql.query(
        'SELECT *, (SELECT count(*)::int FROM gallery.likes WHERE artwork_id=$1) AS actual_likes,(SELECT count(*)::int FROM gallery.reviews WHERE artwork_id=$1) AS actual_reviews FROM gallery.artworks WHERE id=$1',
        [a.id],
      )
    ).rows[0];
    if (
      row?.['status'] !== 'published' ||
      row['artist_id'] !== a.artistId ||
      row['title'] !== a.title ||
      row['image_url'] !== a.imageUrl ||
      Number(row['like_count']) !== Number(row['actual_likes']) ||
      Number(row['review_count']) !== Number(row['actual_reviews'])
    )
      throw new Error('Artwork projection or counters differ.');
  }
  for (const u of s.users) {
    const row = (
      await sql.query('SELECT username,role FROM gallery.users WHERE id=$1', [
        u.id,
      ])
    ).rows[0];
    if (row?.['username'] !== u.username || row['role'] !== u.role)
      throw new Error('Account missing or differs.');
  }
  for (const r of s.likes)
    if (
      !(
        await sql.query(
          'SELECT 1 FROM gallery.likes WHERE user_id=$1 AND artwork_id=$2',
          [r.userId, r.artworkId],
        )
      ).rows.length
    )
      throw new Error('Like missing.');
  for (const r of s.follows)
    if (
      !(
        await sql.query(
          'SELECT 1 FROM gallery.follows WHERE user_id=$1 AND artist_id=$2',
          [r.userId, r.artistId],
        )
      ).rows.length
    )
      throw new Error('Follow missing.');
  for (const r of s.reviews)
    if (
      !(
        await sql.query(
          'SELECT 1 FROM gallery.reviews WHERE id=$1 AND user_id=$2 AND artwork_id=$3 AND text=$4',
          [r.id, r.userId, r.artworkId, r.text],
        )
      ).rows.length
    )
      throw new Error('Review missing or differs.');
  for (const w of s.workshops)
    if (
      !(
        await sql.query(
          'SELECT 1 FROM gallery.workshops WHERE id=$1 AND artist_id=$2 AND name=$3 AND goal=$4 AND weeks=$5',
          [w.id, w.artistId, w.name, w.goal, w.weeks],
        )
      ).rows.length
    )
      throw new Error('Workshop missing or differs.');
  for (const r of s.enrollments)
    if (
      !(
        await sql.query(
          'SELECT 1 FROM gallery.enrollments WHERE user_id=$1 AND workshop_id=$2',
          [r.userId, r.workshopId],
        )
      ).rows.length
    )
      throw new Error('Enrollment missing.');
}
