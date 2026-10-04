import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import {
  HttpError,
  artistOnly,
  objectId,
  pageParameters,
  requireDocument,
  textField,
} from './http.js';
import { requireAuth } from './auth.js';
import { publicUser, userDto, type ArtworkStore } from './domain.js';
import {
  artSelect,
  workshopSelect,
  summary,
  workshop,
  review,
  liked,
  joined,
  published,
  publish,
} from './catalog.js';
import { reserveUpload, type ImageStorage } from './storage.js';
import type { Sql } from './database.js';
import type { DiscoveryCache } from './cache.js';
import type { SecurityCache } from './security-cache.js';
import type { Config } from './config.js';
import { enqueueLike, type NotificationDispatch } from './notifications.js';
import { publicDemoNames } from './public-demo.js';
import { Feeds, followingLimit } from './feeds.js';
export function galleryRoutes(
  sql: Sql,
  store: ArtworkStore,
  storage: ImageStorage,
  cache: DiscoveryCache,
  security: SecurityCache,
  config: Config,
  notifications: NotificationDispatch,
  defer: (work: Promise<void>) => void,
) {
  const router = Router();
  const feeds = new Feeds(sql, cache, config);
  router.get('/feeds/explore', async (req, res) => {
    const result = await feeds.page('explore', req.user?.id, req.query);
    res
      .set({ 'X-Cache': result.status, 'X-Feed-Candidates': result.poolStatus })
      .json(result.value);
  });
  router.get('/feeds/following', requireAuth, async (req, res) => {
    const result = await feeds.page('following', req.user!.id, req.query);
    res
      .set({ 'X-Cache': result.status, 'X-Feed-Candidates': result.poolStatus })
      .json(result.value);
  });
  router.get('/people', async (req, res) => {
    if (
      Object.keys(req.query).some(
        (key) => !['search', 'page', 'limit'].includes(key),
      )
    )
      throw new HttpError(400, 'Unknown people filter.');
    const search = req.query['search']
      ? textField(req.query, 'search', 120).toLowerCase()
      : '';
    const { page, limit, skip } = pageParameters(req.query);
    const result = await cache.remember(
      `people:v1:${JSON.stringify({ search, page, limit })}`,
      async () => {
        const where =
          'deletion_requested_at IS NULL AND position($1 in lower(username))>0';
        const rows = (
          await sql.query(
            `SELECT id,username,role FROM gallery.users WHERE ${where} ORDER BY lower(username),id LIMIT $2 OFFSET $3`,
            [search, limit, skip],
          )
        ).rows;
        const total = Number(
          (
            await sql.query(
              `SELECT count(*)::int AS total FROM gallery.users WHERE ${where}`,
              [search],
            )
          ).rows[0]!['total'],
        );
        return {
          items: rows.map((row) => publicUser(userDto(row))),
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        };
      },
    );
    const following = new Set(
      req.user ? await feeds.following(req.user.id) : [],
    );
    res.set('X-Cache', result.status).json({
      ...result.value,
      items: result.value.items.map((person) => ({
        ...person,
        following: following.has(person.id),
      })),
    });
  });
  router.get('/stats', async (_req, res) => {
    const result = await cache.remember('stats', async () => {
      const r = (
        await sql.query(`SELECT (SELECT count(*)::int FROM gallery.artworks WHERE status='published') AS artworks,
        (SELECT count(*)::int FROM gallery.users WHERE role='artist') AS artists,(SELECT count(*)::int FROM gallery.workshops) AS workshops`)
      ).rows[0]!;
      const categories = (
        await sql.query(
          "SELECT DISTINCT category FROM gallery.artworks WHERE status='published' ORDER BY category",
        )
      ).rows.map((i) => String(i['category']));
      return {
        artworks: Number(r['artworks']),
        artists: Number(r['artists']),
        workshops: Number(r['workshops']),
        categories,
      };
    });
    res.set('X-Cache', result.status).json(result.value);
  });
  router.get('/artworks', async (req, res) => {
    if (
      Object.keys(req.query).some(
        (k) => !['page', 'limit', 'search', 'category', 'artist'].includes(k),
      )
    )
      throw new HttpError(400, 'Unknown artwork filter.');
    const { page, limit, skip } = pageParameters(req.query);
    const values: unknown[] = [],
      clauses = ["a.status='published'"];
    for (const field of ['category', 'artist', 'search'] as const)
      if (req.query[field] !== undefined && req.query[field] !== '') {
        values.push(
          textField(req.query, field, field === 'search' ? 120 : 200),
        );
        clauses.push(
          field === 'search'
            ? `a.search_document @@ websearch_to_tsquery('english',$${values.length})`
            : `${field === 'artist' ? 'u.username' : 'a.category'}=$${values.length}`,
        );
      }
    const where = clauses.join(' AND ');
    const result = await cache.remember(
      `artworks:${JSON.stringify({ values, page, limit })}`,
      async () => {
        const rows = (
          await sql.query(
            `${artSelect} WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            [...values, limit, skip],
          )
        ).rows;
        const total = Number(
          (
            await sql.query(
              `SELECT count(*)::int AS total FROM gallery.artworks a JOIN gallery.users u ON u.id=a.artist_id WHERE ${where}`,
              values,
            )
          ).rows[0]!['total'],
        );
        return {
          items: rows.map(summary),
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        };
      },
    );
    res.set('X-Cache', result.status).json({
      ...result.value,
      items: await liked(sql, result.value.items, req.user?.id),
    });
  });
  const loadReviews = async (id: string, limit: number, skip: number) =>
    (
      await sql.query(
        `SELECT r.*,u.username FROM gallery.reviews r JOIN gallery.users u ON u.id=r.user_id WHERE artwork_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3`,
        [id, limit, skip],
      )
    ).rows.map(review);
  router.get('/artworks/:id/reviews', async (req, res) => {
    const id = objectId(req.params['id']),
      { page, limit, skip } = pageParameters(req.query);
    const result = await cache.remember(
      `reviews:${id}:${page}:${limit}`,
      async () => {
        const art = await published(sql, id),
          total = Number(art['review_count']);
        return {
          items: await loadReviews(id, limit, skip),
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        };
      },
    );
    res.set('X-Cache', result.status).json({
      ...result.value,
      items: result.value.items.map((r) => ({
        ...r,
        owned: r.authorId === req.user?.id,
      })),
    });
  });
  router.get('/artworks/:id', async (req, res) => {
    const id = objectId(req.params['id']);
    const result = await cache.remember(`artwork:${id}`, async () => {
      const row = requireDocument(
        (
          await sql.query(
            `${artSelect} WHERE a.id=$1 AND a.status='published'`,
            [id],
          )
        ).rows[0],
        'Artwork not found.',
      );
      const doc = requireDocument(await store.get(id), 'Artwork not found.');
      const artist = publicUser(
        userDto(
          (
            await sql.query(
              'SELECT id,username,role FROM gallery.users WHERE id=$1',
              [row['artist_id']],
            )
          ).rows[0]!,
        ),
      );
      return {
        artwork: {
          ...summary(row),
          description: doc.description,
          reviews: await loadReviews(id, 12, 0),
        },
        artist,
      };
    });
    const [art] = await liked(sql, [result.value.artwork], req.user?.id);
    res.set('X-Cache', result.status).json({
      artist: result.value.artist,
      artwork: {
        ...art,
        reviews: result.value.artwork.reviews.map((r) => ({
          ...r,
          owned: r.authorId === req.user?.id,
        })),
      },
    });
  });
  router.get(['/artists/:id', '/people/:id'], async (req, res) => {
    const id = objectId(req.params['id']);
    const result = await cache.remember(`artist:${id}`, async () => {
      const user = publicUser(
        userDto(
          requireDocument(
            (
              await sql.query(
                'SELECT id,username,role FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL',
                [id],
              )
            ).rows[0],
            'Person not found.',
          ),
        ),
      );
      const artworks = (
        await sql.query(
          `${artSelect} WHERE a.artist_id=$1 AND a.status='published' ORDER BY a.created_at DESC,a.id DESC LIMIT 48`,
          [id],
        )
      ).rows.map(summary);
      const workshops = (
        await sql.query(
          `${workshopSelect} WHERE w.artist_id=$1 ORDER BY w.id DESC LIMIT 48`,
          [id],
        )
      ).rows.map(workshop);
      return { ...user, artworks, workshops };
    });
    const following = req.user
      ? (
          await sql.query(
            'SELECT 1 FROM gallery.follows WHERE user_id=$1 AND artist_id=$2',
            [req.user.id, id],
          )
        ).rows.length > 0
      : false;
    res.set('X-Cache', result.status).json({
      ...result.value,
      following,
      artworks: await liked(sql, result.value.artworks, req.user?.id),
      workshops: await joined(sql, result.value.workshops, req.user?.id),
    });
  });
  router.get('/workshops', async (req, res) => {
    const { page, limit, skip } = pageParameters(req.query);
    const result = await cache.remember(
      `workshops:${page}:${limit}`,
      async () => {
        const items = (
          await sql.query(
            `${workshopSelect} ORDER BY w.created_at DESC,w.id DESC LIMIT $1 OFFSET $2`,
            [limit, skip],
          )
        ).rows.map(workshop);
        const total = Number(
          (
            await sql.query(
              'SELECT count(*)::int AS total FROM gallery.workshops',
            )
          ).rows[0]!['total'],
        );
        return { items, total, page, limit, pages: Math.ceil(total / limit) };
      },
    );
    res.set('X-Cache', result.status).json({
      ...result.value,
      items: await joined(sql, result.value.items, req.user?.id),
    });
  });
  router.get('/account', requireAuth, async (req, res) => {
    const id = req.user!.id;
    const following = (
      await sql.query(
        'SELECT u.id,u.username,u.role FROM gallery.users u JOIN gallery.follows f ON f.artist_id=u.id WHERE f.user_id=$1 ORDER BY u.id LIMIT 48',
        [id],
      )
    ).rows.map((r) => publicUser(userDto(r)));
    const likes = (
      await sql.query(
        `${artSelect} JOIN gallery.likes l ON l.artwork_id=a.id WHERE l.user_id=$1 AND a.status='published' ORDER BY a.id DESC LIMIT 48`,
        [id],
      )
    ).rows.map((r) => ({ ...summary(r), liked: true }));
    const artworks = await liked(
      sql,
      (
        await sql.query(
          `${artSelect} WHERE a.artist_id=$1 AND a.status='published' ORDER BY a.created_at DESC,a.id DESC LIMIT 48`,
          [id],
        )
      ).rows.map(summary),
      id,
    );
    const reviews = (
      await sql.query(
        'SELECT artwork_id,text FROM gallery.reviews WHERE user_id=$1 ORDER BY created_at DESC LIMIT 48',
        [id],
      )
    ).rows.map((r) => ({ artworkId: r['artwork_id'], text: r['text'] }));
    const workshops = await joined(
      sql,
      (
        await sql.query(
          `${workshopSelect} WHERE w.artist_id=$1 ORDER BY w.id DESC LIMIT 48`,
          [id],
        )
      ).rows.map(workshop),
      id,
    );
    res.json({
      user: req.user,
      following,
      likes,
      reviews,
      artworks,
      workshops,
    });
  });
  router.patch('/account', requireAuth, async (req, res) => {
    if (config.production && publicDemoNames.has(req.user!.username))
      throw new HttpError(
        403,
        'Public demo account roles are fixed. Create your own account to switch roles.',
      );
    const role = textField(req.body, 'role', 10);
    if (!['artist', 'patron'].includes(role))
      throw new HttpError(400, 'Choose a patron or artist account.');
    const result = await security.change(() =>
      sql.query(
        'UPDATE gallery.users SET role=$1 WHERE id=$2 AND deletion_requested_at IS NULL RETURNING id,username,role',
        [role, req.user!.id],
      ),
    );
    await cache.invalidate();
    res.json({
      user: publicUser(
        userDto(requireDocument(result.rows[0], 'Account unavailable.')),
      ),
    });
  });
  for (const method of ['put', 'delete'] as const) {
    router[method](
      ['/artists/:id/follow', '/people/:id/follow'],
      requireAuth,
      async (req, res) => {
        const id = objectId(req.params['id']);
        if (id === req.user!.id)
          throw new HttpError(400, 'Choose another person to follow.');
        await sql.transaction(async (tx) => {
          // Ordered locks serialize the bounded follow count and account retirement.
          const people = (
            await tx.query(
              'SELECT id FROM gallery.users WHERE id=ANY($1::text[]) AND deletion_requested_at IS NULL ORDER BY id FOR UPDATE',
              [[req.user!.id, id]],
            )
          ).rows;
          if (people.length !== 2)
            throw new HttpError(404, 'Person not found.');
          if (method === 'put') {
            const existing = (
              await tx.query(
                'SELECT 1 FROM gallery.follows WHERE user_id=$1 AND artist_id=$2',
                [req.user!.id, id],
              )
            ).rows.length;
            const count = Number(
              (
                await tx.query(
                  'SELECT count(*)::int AS total FROM gallery.follows WHERE user_id=$1',
                  [req.user!.id],
                )
              ).rows[0]!['total'],
            );
            if (!existing && count >= followingLimit)
              throw new HttpError(
                400,
                `You can follow up to ${followingLimit} people in this portfolio app.`,
              );
          }
          await tx.query(
            method === 'put'
              ? 'INSERT INTO gallery.follows (user_id,artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING'
              : 'DELETE FROM gallery.follows WHERE user_id=$1 AND artist_id=$2',
            [req.user!.id, id],
          );
        });
        await cache.invalidate();
        res.json({ following: method === 'put' });
      },
    );
    router[method]('/artworks/:id/like', requireAuth, async (req, res) => {
      const id = objectId(req.params['id']),
        liking = method === 'put';
      const result = await sql.transaction(async (tx) => {
        requireDocument(
          (
            await tx.query(
              'SELECT id FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL FOR SHARE',
              [req.user!.id],
            )
          ).rows[0],
          'Account unavailable.',
        );
        const art = await published(tx, id, true);
        const changed = await tx.query(
          liking
            ? 'INSERT INTO gallery.likes (user_id,artwork_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING artwork_id'
            : 'DELETE FROM gallery.likes WHERE user_id=$1 AND artwork_id=$2 RETURNING artwork_id',
          [req.user!.id, id],
        );
        if (changed.rows.length)
          await tx.query(
            'UPDATE gallery.artworks SET like_count=like_count+$1 WHERE id=$2',
            [liking ? 1 : -1, id],
          );
        const jobs =
          liking && changed.rows.length
            ? await enqueueLike(
                tx,
                config,
                req.user!.id,
                req.user!.username,
                art,
              )
            : [];
        const likeCount = Number(
          (
            await tx.query(
              'SELECT like_count FROM gallery.artworks WHERE id=$1',
              [id],
            )
          ).rows[0]!['like_count'],
        );
        return { likeCount, jobs };
      });
      await cache.invalidate();
      defer(notifications.kick(result.jobs));
      res.json({ liked: liking, likeCount: result.likeCount });
    });
  }
  router.post('/artworks/:id/reviews', requireAuth, async (req, res) => {
    const id = objectId(req.params['id']),
      text = textField(req.body, 'text', 2000),
      reviewId = randomUUID();
    await sql.transaction(async (tx) => {
      requireDocument(
        (
          await tx.query(
            'SELECT id FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL FOR SHARE',
            [req.user!.id],
          )
        ).rows[0],
        'Account unavailable.',
      );
      await published(tx, id, true);
      await tx.query(
        'INSERT INTO gallery.reviews (id,user_id,artwork_id,text) VALUES ($1,$2,$3,$4)',
        [reviewId, req.user!.id, id, text],
      );
      await tx.query(
        'UPDATE gallery.artworks SET review_count=review_count+1 WHERE id=$1',
        [id],
      );
    });
    await cache.invalidate();
    res.status(201).json({
      id: reviewId,
      author: req.user!.username,
      authorId: req.user!.id,
      text,
      owned: true,
    });
  });
  router.delete(
    '/artworks/:id/reviews/:reviewId',
    requireAuth,
    async (req, res) => {
      const id = objectId(req.params['id']);
      await sql.transaction(async (tx) => {
        requireDocument(
          (
            await tx.query(
              'SELECT id FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL FOR SHARE',
              [req.user!.id],
            )
          ).rows[0],
          'Account unavailable.',
        );
        await published(tx, id, true);
        const r = requireDocument(
          (
            await tx.query(
              'SELECT user_id FROM gallery.reviews WHERE id=$1 AND artwork_id=$2',
              [req.params['reviewId'], id],
            )
          ).rows[0],
          'Review not found.',
        );
        if (r['user_id'] !== req.user!.id)
          throw new HttpError(403, 'You can only remove your own reviews.');
        await tx.query('DELETE FROM gallery.reviews WHERE id=$1', [
          req.params['reviewId'],
        ]);
        await tx.query(
          'UPDATE gallery.artworks SET review_count=review_count-1 WHERE id=$1',
          [id],
        );
      });
      await cache.invalidate();
      res.sendStatus(204);
    },
  );
  const artworkWriteGuard = () => {
    if (config.artworkWritesPaused)
      throw new HttpError(
        503,
        'Artwork publishing is temporarily paused for maintenance. Please try again later.',
      );
  };
  router.post('/uploads', requireAuth, artistOnly, async (req, res) => {
    artworkWriteGuard();
    res
      .status(201)
      .json(
        await reserveUpload(
          sql,
          storage,
          req.user!.id,
          req.body?.contentType,
          req.body?.bytes,
        ),
      );
  });
  router.post('/artworks', requireAuth, artistOnly, async (req, res) => {
    artworkWriteGuard();
    const title = textField(req.body, 'title'),
      year = textField(req.body, 'year', 4),
      category = textField(req.body, 'category'),
      medium = textField(req.body, 'medium'),
      description = textField(req.body, 'description', 10000);
    if (!/^\d{1,4}$/.test(year))
      throw new HttpError(400, 'Year must contain up to four digits.');
    const uploadId = textField(req.body, 'uploadId', 36);
    if (!/^[a-f0-9-]{36}$/.test(uploadId))
      throw new HttpError(400, 'Invalid upload ID.');
    const artworkId = createHash('sha256')
      .update(uploadId)
      .digest('hex')
      .slice(0, 24);
    const reservation = requireDocument(
      (
        await sql.query(
          'SELECT * FROM gallery.uploads WHERE id=$1 AND user_id=$2',
          [uploadId, req.user!.id],
        )
      ).rows[0],
      'Upload not found.',
    );
    if (reservation['used_at']) {
      const existing = (
        await sql.query(
          'SELECT status,like_count,review_count FROM gallery.artworks WHERE id=$1 AND artist_id=$2',
          [artworkId, req.user!.id],
        )
      ).rows[0];
      if (existing?.['status'] !== 'published')
        throw new HttpError(
          409,
          'This upload is already being processed or failed. Choose a new upload.',
        );
      const doc = requireDocument(
        await store.get(artworkId),
        'Artwork document missing.',
      );
      if (
        doc.title !== title ||
        doc.year !== year ||
        doc.category !== category ||
        doc.medium !== medium ||
        doc.description !== description
      )
        throw new HttpError(
          409,
          'This upload has already published different artwork metadata.',
        );
      res.status(200).json({
        ...doc,
        artist: req.user!.username,
        likeCount: Number(existing['like_count']),
        reviewCount: Number(existing['review_count']),
        liked: false,
        reviews: [],
      });
      return;
    }
    // Claim atomically. A consumed reservation cannot be reused in another publication.
    const row = requireDocument(
      (
        await sql.query(
          'UPDATE gallery.uploads SET used_at=now() WHERE id=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING *',
          [uploadId, req.user!.id],
        )
      ).rows[0],
      'Upload expired or already used.',
    );
    const path = String(row['path']);
    let promoted = false;
    try {
      await storage.inspect(
        path,
        String(row['content_type']),
        Number(row['max_bytes']),
      );
      const imageUrl = await storage.publish(path);
      promoted = true;
      const art = {
        id: artworkId,
        artistId: req.user!.id,
        title,
        year,
        category,
        medium,
        description,
        imageUrl,
      };
      await publish(sql, store, art);
      await cache.invalidate();
      defer(
        feeds
          .prime()
          .catch(() =>
            console.warn(
              'Feed cache warming deferred; database fallback remains available.',
            ),
          ),
      );
      res.status(201).json({
        ...art,
        artist: req.user!.username,
        likeCount: 0,
        reviewCount: 0,
        liked: false,
        reviews: [],
      });
    } catch (error) {
      if (promoted) {
        try {
          // Preserve images for ambiguous/pending publications until reconciliation.
          const row = (
            await sql.query('SELECT id FROM gallery.artworks WHERE id=$1', [
              artworkId,
            ])
          ).rows[0];
          if (!row && !(await store.get(artworkId))) await storage.remove(path);
        } catch {
          /* Leave the object for operator reconciliation if a store is unavailable. */
        }
      }
      throw error;
    }
  });
  router.post('/workshops', requireAuth, artistOnly, async (req, res) => {
    const name = textField(req.body, 'name'),
      goal = textField(req.body, 'goal', 2000),
      weeks: unknown = req.body?.weeks;
    if (
      typeof weeks !== 'number' ||
      !Number.isInteger(weeks) ||
      weeks < 1 ||
      weeks > 9999
    )
      throw new HttpError(400, 'Duration must be 1–9999 whole weeks.');
    const id = randomUUID();
    await sql.query(
      'INSERT INTO gallery.workshops (id,artist_id,name,goal,weeks) VALUES ($1,$2,$3,$4,$5)',
      [id, req.user!.id, name, goal, weeks],
    );
    await cache.invalidate();
    res.status(201).json({
      id,
      artistId: req.user!.id,
      artist: req.user!.username,
      name,
      goal,
      weeks,
      attendeeCount: 0,
      joined: false,
    });
  });
  router.put(
    '/artists/:id/workshops/:workshopId/registration',
    requireAuth,
    async (req, res) => {
      const id = objectId(req.params['id']),
        workshopId = String(req.params['workshopId']);
      requireDocument(
        (
          await sql.query(
            'SELECT id FROM gallery.workshops WHERE id=$1 AND artist_id=$2',
            [workshopId, id],
          )
        ).rows[0],
        'Workshop not found.',
      );
      await sql.query(
        'INSERT INTO gallery.enrollments (user_id,workshop_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.user!.id, workshopId],
      );
      await cache.invalidate();
      res.json({
        ...workshop(
          (await sql.query(`${workshopSelect} WHERE w.id=$1`, [workshopId]))
            .rows[0]!,
        ),
        joined: true,
      });
    },
  );
  return router;
}
