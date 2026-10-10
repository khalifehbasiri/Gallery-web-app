import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { artFormCollection } from '../../shared/art-form-collection.js';
import { artForms } from '../../shared/art-forms.js';
import { demoCollectionDescription } from '../../shared/collection-images.js';
import { parseArtDetails } from './art-details.js';
import { publish } from './catalog.js';
import type { Sql } from './database.js';
import type { ArtworkDocument, ArtworkStore } from './domain.js';
import { objectId } from './http.js';

export function buildArtFormSeed(
  origin: string,
  artistId: string,
): ArtworkDocument[] {
  objectId(artistId);
  if (
    origin &&
    (new URL(origin).origin !== origin || !origin.startsWith('https://'))
  )
    throw new Error('Use a canonical HTTPS origin.');
  return artFormCollection.map(({ image, details }) => ({
    id: createHash('sha256')
      .update(`gallery-art-forms:v1:${image.id}`)
      .digest('hex')
      .slice(0, 24),
    artistId,
    title: `Art forms: ${image.title}`,
    year: image.year,
    category: artForms[details.type].category,
    medium: image.medium,
    description: demoCollectionDescription(image),
    imageUrl: `${origin}/artworks/${image.file}`,
    artDetails: structuredClone(details),
  }));
}

// Preflight the whole fixture before any writes; reruns never overwrite content.
export async function checkArtFormSeed(
  sql: Sql,
  store: ArtworkStore,
  seed: ArtworkDocument[],
) {
  if (
    !seed.length ||
    !isDeepStrictEqual(
      seed,
      buildArtFormSeed(
        new URL(seed[0]!.imageUrl, 'https://local.invalid').origin ===
          'https://local.invalid'
          ? ''
          : new URL(seed[0]!.imageUrl).origin,
        seed[0]!.artistId,
      ),
    )
  )
    throw new Error('Art form seed differs from the credited museum fixture.');
  const owner = (
    await sql.query(
      "SELECT id FROM gallery.users WHERE id=$1 AND username='Maya Laurent' AND role='artist' AND deletion_requested_at IS NULL",
      [seed[0]!.artistId],
    )
  ).rows[0];
  if (!owner) throw new Error('The existing demo artist is unavailable.');
  const rows = (
    await sql.query(
      'SELECT * FROM gallery.artworks WHERE id=ANY($1::text[]) OR title=ANY($2::text[])',
      [seed.map((art) => art.id), seed.map((art) => art.title)],
    )
  ).rows;
  for (const art of seed) {
    parseArtDetails(art.artDetails, art.category);
    const row = rows.find(
      (row) => row['id'] === art.id || row['title'] === art.title,
    );
    const projection = {
      id: art.id,
      artist_id: art.artistId,
      title: art.title,
      year: art.year,
      category: art.category,
      medium: art.medium,
      description_preview: art.description.slice(0, 280),
      image_url: art.imageUrl,
    };
    const doc = await store.get(art.id);
    if (
      row &&
      (Object.entries(projection).some(([key, value]) => row[key] !== value) ||
        !['pending', 'published'].includes(String(row['status'])))
    )
      throw new Error(
        'Art form seed conflicts with an existing gallery entry.',
      );
    if (doc && !isDeepStrictEqual(doc, art))
      throw new Error('Art form seed conflicts with an existing document.');
    if ((row?.['status'] === 'published' && !doc) || (!row && doc))
      throw new Error('Art form publication requires manual reconciliation.');
  }
}

export async function applyArtFormSeed(
  sql: Sql,
  store: ArtworkStore,
  seed: ArtworkDocument[],
) {
  await checkArtFormSeed(sql, store, seed);
  let inserted = 0;
  for (const art of seed) {
    const row = (
      await sql.query('SELECT status FROM gallery.artworks WHERE id=$1', [
        art.id,
      ])
    ).rows[0];
    if (!row) {
      await publish(sql, store, art);
      inserted++;
    } else if (row['status'] === 'pending') {
      if (!(await store.get(art.id))) await store.create(art);
      await sql.query(
        "UPDATE gallery.artworks SET status='published' WHERE id=$1 AND status='pending'",
        [art.id],
      );
    }
  }
  await checkArtFormSeed(sql, store, seed);
  const rows = (
    await sql.query(
      "SELECT count(*)::int AS total FROM gallery.artworks WHERE id=ANY($1::text[]) AND status='published'",
      [seed.map((art) => art.id)],
    )
  ).rows;
  if (rows[0]?.['total'] !== seed.length)
    throw new Error('Seed publication verification failed.');
  return {
    posts: seed.length,
    inserted,
    forms: [...new Set(seed.map((art) => art.category))],
  };
}
