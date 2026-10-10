import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { artFormCollection } from '../shared/art-form-collection.js';
import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { mongoArtworks, prepareMongoArtworks } from '../server/src/mongodb.js';
import { createDiscoveryCache } from '../server/src/cache.js';
import {
  applyArtFormSeed,
  buildArtFormSeed,
  checkArtFormSeed,
} from '../server/src/art-form-seed.js';

let phase = 'configuration';
async function main() {
  const config = readConfig();
  if (
    !config.databaseUrl ||
    config.artworkBackend !== 'mongodb' ||
    !config.clientOrigin.startsWith('https://')
  )
    throw new Error(
      'Configure MongoDB, PostgreSQL, and the canonical HTTPS CLIENT_ORIGIN.',
    );
  for (const { image } of artFormCollection)
    if (
      createHash('sha256')
        .update(await readFile(`client/public/artworks/${image.file}`))
        .digest('hex') !== image.sha256
    )
      throw new Error('Museum image verification failed.');
  const sql = postgres(config.databaseUrl, config.databaseCa);
  try {
    const store = await mongoArtworks(config);
    const cache = createDiscoveryCache(config);
    try {
      const owner = (
        await sql.query(
          "SELECT id FROM gallery.users WHERE username='Maya Laurent' AND role='artist' AND deletion_requested_at IS NULL",
        )
      ).rows[0];
      if (!owner) throw new Error('Seed the original demo artist first.');
      const seed = buildArtFormSeed(config.clientOrigin, String(owner['id']));
      await checkArtFormSeed(sql, store, seed);
      if (!process.argv.includes('--apply')) {
        console.log(
          JSON.stringify({
            mode: 'dry-run',
            posts: seed.length,
            forms: [...new Set(seed.map((art) => art.category))],
          }),
        );
        return;
      }
      // Prepare the new validated collection; the legacy collection stays intact.
      phase = 'MongoDB validator preparation';
      await prepareMongoArtworks(config);
      phase = 'cache connection';
      await cache.connect();
      let result;
      try {
        phase = 'artwork publication';
        result = await applyArtFormSeed(sql, store, seed);
      } finally {
        await cache.invalidate();
      }
      console.log(
        JSON.stringify({
          mode: 'applied-and-verified',
          ...result,
          notificationEmails: 0,
        }),
      );
    } finally {
      await Promise.allSettled([store.close(), cache.close()]);
    }
  } finally {
    await sql.close();
  }
}
main().catch((error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  console.error(
    `Art form seeding failed during ${phase}${typeof code === 'number' ? ` (database code ${code})` : ''}.`,
  );
  console.error(
    'Art form seeding stopped. Check fixture conflicts, museum assets and database connectivity; credentials were not printed.',
  );
  process.exitCode = 1;
});
