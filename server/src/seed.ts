import mongoose from 'mongoose';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { User, Gallery, type GalleryRecord } from './models.js';
import { readConfig, rootDirectory } from './config.js';
import { hashPassword } from './passwords.js';

export async function seedDatabase() {
  const directory = path.join(rootDirectory, 'JSON');
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const galleries: GalleryRecord[] = (
    await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(
            await readFile(path.join(directory, file), 'utf8'),
          ) as GalleryRecord[],
      ),
    )
  ).flat();
  const artists = [...new Set(galleries.map((art) => art.artist))];
  const users = [
    { username: 'khalifa', password: 'yes', aType: 'patron' as const },
    ...artists.map((username) => ({
      username,
      password: 'no',
      aType: 'artist' as const,
    })),
  ];
  for (const user of users)
    if (!(await User.exists({ username: user.username })))
      await User.create({
        ...user,
        password: await hashPassword(user.password),
      });
  for (const gallery of galleries)
    if (!(await Gallery.exists({ name: gallery.name, artist: gallery.artist })))
      await Gallery.create(gallery);
  return { users: users.length, artworks: galleries.length };
}

async function main() {
  const config = readConfig();
  if (config.production)
    throw new Error('Demo seeding is disabled in production.');
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    const counts = await seedDatabase();
    console.log(
      `Demo data ready (${counts.users} accounts, ${counts.artworks} artworks). Existing data preserved.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    console.error('Unable to seed Gallery:', error);
    process.exitCode = 1;
  });
