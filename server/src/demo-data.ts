import {
  demoCollectionEntries,
  demoCollectionDescription,
} from '../../shared/collection-images.js';
import type { Sql } from './database.js';
import type { ArtworkStore } from './domain.js';
import { newId } from './domain.js';
import { publish } from './catalog.js';
import { hashPassword } from './passwords.js';
export async function demoData(sql: Sql, artworks: ArtworkStore) {
  const password = await hashPassword('gallery-demo-2026');
  const artist = newId(),
    patron = newId();
  await sql.query(
    "INSERT INTO gallery.users(id,username,password_hash,role) VALUES($1,'Maya Laurent',$3,'artist'),($2,'demo',$3,'patron')",
    [artist, patron, password],
  );
  for (const { image } of demoCollectionEntries)
    await publish(sql, artworks, {
      id: newId(),
      artistId: artist,
      title: image.title,
      imageUrl: `/artworks/${image.file}`,
      category: 'Painting',
      medium: image.medium,
      year: image.year,
      description: demoCollectionDescription(image),
    });
  await sql.query(
    "INSERT INTO gallery.workshops(id,artist_id,name,goal,weeks) VALUES ('demo-workshop',$1,'The art of looking closer','Explore color and composition.',3)",
    [artist],
  );
}
