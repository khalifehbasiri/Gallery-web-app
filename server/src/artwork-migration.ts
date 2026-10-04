import type { Sql } from './database.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';
import { objectId, textField } from './http.js';

export interface ArtworkSnapshot {
  format: 1;
  artworks: ArtworkDocument[];
}
const fields = [
  'id',
  'artistId',
  'title',
  'year',
  'category',
  'medium',
  'description',
  'imageUrl',
] as const;
export function validateArtworkSnapshot(
  value: unknown,
): asserts value is ArtworkSnapshot {
  const snapshot = value as ArtworkSnapshot | null;
  if (!snapshot || snapshot.format !== 1 || !Array.isArray(snapshot.artworks))
    throw new Error('Invalid artwork snapshot.');
  const ids = new Set<string>();
  for (const art of snapshot.artworks) {
    if (
      !art ||
      Object.keys(art).length !== fields.length ||
      fields.some((key) => typeof art[key] !== 'string')
    )
      throw new Error('Invalid artwork document.');
    objectId(art.id);
    objectId(art.artistId);
    if (ids.has(art.id)) throw new Error('Duplicate artwork ID in snapshot.');
    ids.add(art.id);
    for (const key of ['title', 'category', 'medium'] as const)
      textField(art, key);
    textField(art, 'description', 10000);
    if (!/^\d{1,4}$/.test(art.year) || !art.imageUrl.startsWith('https://'))
      throw new Error('Invalid artwork year or image URL.');
  }
}
function sameArtwork(a: ArtworkDocument, b: ArtworkDocument) {
  return fields.every((key) => a[key] === b[key]);
}
export async function verifyArtworkRegistry(
  sql: Sql,
  snapshot: ArtworkSnapshot,
) {
  validateArtworkSnapshot(snapshot);
  const rows = (
    await sql.query(
      'SELECT id,artist_id,title,year,category,medium,description_preview,image_url,status FROM gallery.artworks ORDER BY id',
    )
  ).rows;
  if (
    rows.length !== snapshot.artworks.length ||
    rows.some((row) => row['status'] !== 'published')
  )
    throw new Error(
      'SQL catalog changed or contains pending publications. Freeze publishing and export again.',
    );
  const byId = new Map(snapshot.artworks.map((art) => [art.id, art]));
  for (const row of rows) {
    const art = byId.get(String(row['id']));
    if (
      !art ||
      row['artist_id'] !== art.artistId ||
      row['title'] !== art.title ||
      row['year'] !== art.year ||
      row['category'] !== art.category ||
      row['medium'] !== art.medium ||
      row['description_preview'] !== art.description.slice(0, 280) ||
      row['image_url'] !== art.imageUrl
    )
      throw new Error('SQL projection differs from the artwork snapshot.');
  }
}
export async function exportArtworkSnapshot(
  sql: Sql,
  source: ArtworkStore,
): Promise<ArtworkSnapshot> {
  const rows = (
    await sql.query('SELECT id,status FROM gallery.artworks ORDER BY id')
  ).rows;
  if (rows.some((row) => row['status'] !== 'published'))
    throw new Error('Reconcile pending publications before exporting.');
  const artworks: ArtworkDocument[] = [];
  for (const row of rows) {
    const art = await source.get(String(row['id']));
    if (!art)
      throw new Error(
        'Published artwork is missing from the source document store.',
      );
    artworks.push(art);
  }
  const snapshot: ArtworkSnapshot = { format: 1, artworks };
  await verifyArtworkRegistry(sql, snapshot);
  return snapshot;
}
export async function verifyArtworkCopy(
  sql: Sql,
  target: ArtworkStore,
  snapshot: ArtworkSnapshot,
) {
  await verifyArtworkRegistry(sql, snapshot);
  for (const art of snapshot.artworks) {
    const copy = await target.get(art.id);
    if (!copy || !sameArtwork(copy, art))
      throw new Error('Artwork copy is missing or differs from the snapshot.');
  }
}
export async function copyArtworkSnapshot(
  sql: Sql,
  target: ArtworkStore,
  snapshot: ArtworkSnapshot,
) {
  await verifyArtworkRegistry(sql, snapshot);
  const missing: ArtworkDocument[] = [];
  // Detect conflicts before any writes; never overwrite documents or relational data.
  for (const art of snapshot.artworks) {
    const existing = await target.get(art.id);
    if (existing && !sameArtwork(existing, art))
      throw new Error('Target artwork conflicts with the snapshot.');
    if (!existing) missing.push(art);
  }
  for (const art of missing) {
    try {
      await target.create(art);
    } catch (error) {
      // A retryable write may have succeeded despite a timeout or competing copy.
      const copy = await target.get(art.id);
      if (!copy || !sameArtwork(copy, art)) throw error;
    }
  }
  await verifyArtworkCopy(sql, target, snapshot);
  return { artworks: snapshot.artworks.length, inserted: missing.length };
}
