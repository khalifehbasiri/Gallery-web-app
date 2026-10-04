import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readConfig } from '../server/src/config.js';
import { postgres } from '../server/src/database.js';
import { artworkStore } from '../server/src/artwork-store.js';
import { createDiscoveryCache } from '../server/src/cache.js';
import {
  applyCommunitySeed,
  buildCommunitySeed,
  checkCommunitySeed,
  type CommunitySeed,
} from '../server/src/community-seed.js';
import type { Snapshot } from '../server/src/migration.js';
import { collectionImages } from '../shared/collection-images.js';

async function main() {
  const config = readConfig();
  if (
    !config.databaseUrl ||
    config.artworkBackend !== 'mongodb' ||
    !config.clientOrigin.startsWith('https://')
  )
    throw new Error(
      'Configure MongoDB, PostgreSQL and the canonical HTTPS CLIENT_ORIGIN.',
    );
  for (const image of collectionImages)
    if (
      createHash('sha256')
        .update(await readFile(`client/public/artworks/${image.file}`))
        .digest('hex') !== image.sha256
    )
      throw new Error('Public museum asset verification failed.');
  const sql = postgres(config.databaseUrl, config.databaseCa),
    store = await artworkStore(config),
    cache = createDiscoveryCache(config);
  const filename = 'exports/community-seed.json';
  try {
    let seed: CommunitySeed;
    try {
      seed = JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const snapshot: Snapshot = JSON.parse(
        await readFile('exports/hosted-catalog.json', 'utf8'),
      );
      const demo = snapshot.users.find((u) => u.username === 'demo');
      if (!demo) throw new Error('Prepare the original hosted catalog first.');
      seed = await buildCommunitySeed(
        config.clientOrigin,
        snapshot.artworks.map((a) => ({ id: a.id, title: a.title })),
        demo.id,
      );
      await mkdir('exports', { recursive: true });
      await writeFile(filename, JSON.stringify(seed, null, 2), { flag: 'wx' });
    }
    if (seed.origin !== config.clientOrigin)
      throw new Error('Prepared seed origin differs from CLIENT_ORIGIN.');
    await checkCommunitySeed(sql, store, seed);
    const totals = {
      profiles: seed.users.length,
      posts: seed.artworks.length,
      likes: seed.likes.length,
      comments: seed.reviews.length,
      follows: seed.follows.length,
    };
    if (!process.argv.includes('--apply')) {
      console.log(
        JSON.stringify({ mode: 'dry-run', ...totals, notificationEmails: 0 }),
      );
      return;
    }
    await cache.connect();
    try {
      await applyCommunitySeed(sql, store, seed);
    } finally {
      await cache.invalidate();
    }
    await checkCommunitySeed(sql, store, seed);
    const rows = (
      await sql.query(
        `SELECT count(*)::int AS posts,count(*) FILTER (WHERE like_count<>(SELECT count(*) FROM gallery.likes l WHERE l.artwork_id=a.id) OR review_count<>(SELECT count(*) FROM gallery.reviews r WHERE r.artwork_id=a.id))::int AS mismatched_counts FROM gallery.artworks a WHERE id=ANY($1::text[])`,
        [[...seed.targets, ...seed.artworks].map((a) => a.id)],
      )
    ).rows[0]!;
    if (rows['mismatched_counts'] !== 0)
      throw new Error('Stored activity counters require reconciliation.');
    console.log(
      JSON.stringify({
        mode: 'applied-and-verified',
        ...totals,
        scopedPosts: rows['posts'],
        notificationEmails: 0,
      }),
    );
  } finally {
    await Promise.allSettled([sql.close(), store.close(), cache.close()]);
  }
}
main().catch(() => {
  console.error(
    'Community seeding stopped. Check the scoped fixture and database connectivity; no credentials were printed.',
  );
  process.exitCode = 1;
});
