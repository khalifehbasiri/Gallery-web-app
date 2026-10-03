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
  const samples = [
    [
      'A different perspective',
      '/hero-art.svg',
      'Painting',
      'Acrylic & digital',
      '2026',
    ],
    [
      'The quiet between',
      '/blue-hour.svg',
      'Digital',
      'Digital illustration',
      '2025',
    ],
    [
      'Collected moments',
      '/paper-study.svg',
      'Mixed media',
      'Paper & pigment',
      '2026',
    ],
    [
      'An ordinary kind of magic',
      '/paper-study.svg',
      'Mixed media',
      'Hand-cut collage',
      '2024',
    ],
    [
      'Where the light stays',
      '/hero-art.svg',
      'Painting',
      'Acrylic on linen',
      '2025',
    ],
    [
      'Before the city wakes',
      '/blue-hour.svg',
      'Digital',
      'Digital painting',
      '2026',
    ],
  ];
  for (const [title, imageUrl, category, medium, year] of samples)
    await publish(sql, artworks, {
      id: newId(),
      artistId: artist,
      title: title!,
      imageUrl: imageUrl!,
      category: category!,
      medium: medium!,
      year: year!,
      description:
        'A study of color, composition, and the beauty in everyday moments.',
    });
  await sql.query(
    "INSERT INTO gallery.workshops(id,artist_id,name,goal,weeks) VALUES ('demo-workshop',$1,'The art of looking closer','Explore color and composition.',3)",
    [artist],
  );
}
