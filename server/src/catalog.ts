import type { Sql } from './database.js';
import type { ArtworkStore, ArtworkDocument } from './domain.js';
import type {
  ArtworkSummary,
  Review,
  Workshop,
} from '../../shared/contracts.js';
import { HttpError, requireDocument } from './http.js';
export const artSelect = `SELECT a.*,u.username AS artist FROM gallery.artworks a JOIN gallery.users u ON u.id=a.artist_id`;
export const workshopSelect = `SELECT w.*,u.username AS artist,(SELECT count(*)::int FROM gallery.enrollments e WHERE e.workshop_id=w.id) AS attendees FROM gallery.workshops w JOIN gallery.users u ON u.id=w.artist_id`;
export function summary(r: Record<string, unknown>): ArtworkSummary {
  return {
    id: String(r['id']),
    title: String(r['title']),
    artist: String(r['artist']),
    year: String(r['year']),
    category: String(r['category']),
    medium: String(r['medium']),
    description: String(r['description_preview']),
    imageUrl: String(r['image_url']),
    likeCount: Number(r['like_count']),
    reviewCount: Number(r['review_count']),
    liked: false,
  };
}
export function workshop(r: Record<string, unknown>): Workshop {
  return {
    id: String(r['id']),
    artistId: String(r['artist_id']),
    artist: String(r['artist']),
    name: String(r['name']),
    goal: String(r['goal']),
    weeks: Number(r['weeks']),
    attendeeCount: Number(r['attendees']),
    joined: false,
  };
}
export function review(r: Record<string, unknown>): Review {
  return {
    id: String(r['id']),
    author: String(r['username']),
    authorId: String(r['user_id']),
    text: String(r['text']),
    owned: false,
  };
}
export async function liked(
  sql: Sql,
  items: ArtworkSummary[],
  userId?: string,
) {
  if (!userId || !items.length) return items;
  const ids = new Set(
    (
      await sql.query(
        'SELECT artwork_id FROM gallery.likes WHERE user_id=$1 AND artwork_id=ANY($2::text[])',
        [userId, items.map((i) => i.id)],
      )
    ).rows.map((r) => r['artwork_id']),
  );
  return items.map((i) => ({ ...i, liked: ids.has(i.id) }));
}
export async function joined(sql: Sql, items: Workshop[], userId?: string) {
  if (!userId || !items.length) return items;
  const ids = new Set(
    (
      await sql.query(
        'SELECT workshop_id FROM gallery.enrollments WHERE user_id=$1 AND workshop_id=ANY($2::text[])',
        [userId, items.map((i) => i.id)],
      )
    ).rows.map((r) => r['workshop_id']),
  );
  return items.map((i) => ({ ...i, joined: ids.has(i.id) }));
}
export async function published(sql: Sql, id: string, lock = false) {
  return requireDocument(
    (
      await sql.query(
        `SELECT * FROM gallery.artworks WHERE id=$1 AND status='published'${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0],
    'Artwork not found.',
  );
}
// Reserve title/ID, create Firestore document, then publish the SQL search projection.
// Interrupted writes remain pending and cannot leak into public gallery queries.
export async function publish(
  sql: Sql,
  store: ArtworkStore,
  art: ArtworkDocument,
) {
  await sql.query(
    `INSERT INTO gallery.artworks (id,artist_id,title,year,category,medium,description_preview,image_url,search_document)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_tsvector('english',$9))`,
    [
      art.id,
      art.artistId,
      art.title,
      art.year,
      art.category,
      art.medium,
      art.description.slice(0, 280),
      art.imageUrl,
      [art.title, art.description, art.category, art.medium].join(' '),
    ],
  );
  try {
    await store.create(art);
    await sql.query(
      "UPDATE gallery.artworks SET status='published' WHERE id=$1",
      [art.id],
    );
  } catch (error) {
    // A timed-out write may have committed. Reconcile before compensating, and
    // preserve all resources if either authority cannot confirm its state.
    try {
      const row = (
        await sql.query('SELECT status FROM gallery.artworks WHERE id=$1', [
          art.id,
        ])
      ).rows[0];
      if (row?.['status'] === 'published') return;
      if (await store.get(art.id)) await store.remove(art.id);
      await sql.query(
        "DELETE FROM gallery.artworks WHERE id=$1 AND status='pending'",
        [art.id],
      );
    } catch {
      throw new HttpError(
        503,
        'Publication interrupted. Contact the administrator to reconcile this artwork.',
      );
    }
    throw error;
  }
}
