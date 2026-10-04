import assert from 'node:assert/strict';
import { before, beforeEach, after, it } from 'node:test';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/src/app.js';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { demoData } from '../server/src/demo-data.js';
import { readConfig } from '../server/src/config.js';
import { RedisDiscoveryCache } from '../server/src/cache.js';
import { FakeRedis } from './helpers/fake-redis.js';
import type { Sql } from '../server/src/database.js';
import type { FeedPage } from '../shared/contracts.js';
const config = readConfig({
  JWT_SECRET: 'feed-test-secret-with-at-least-32-characters',
});
const documents = new LocalArtworkStore();
let sql: Sql,
  app: ReturnType<typeof createApp>,
  cache: RedisDiscoveryCache,
  redis: FakeRedis,
  artist: string,
  patron: string;
let pending: Promise<void>[] = [],
  reads = { pool: 0, follows: 0, older: 0 };
const cookies = (r: request.Response) =>
  (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!);
const csrf = (jar: string[]) =>
  decodeURIComponent(jar.find((c) => c.startsWith('XSRF-TOKEN='))!.slice(11));
async function login(username = 'demo') {
  const anon = cookies(await request(app).get('/api/auth/csrf').expect(204));
  const jar = cookies(
    await request(app)
      .post('/api/auth/login')
      .set('Cookie', anon)
      .set('X-XSRF-TOKEN', csrf(anon))
      .send({ username, password: 'gallery-demo-2026' })
      .expect(200),
  );
  return { jar, csrf: csrf(jar) };
}
const mutate = (
  method: 'put' | 'delete' | 'post',
  url: string,
  auth: { jar: string[]; csrf: string },
) =>
  request(app)
    [method](url)
    .set('Cookie', auth.jar)
    .set('X-XSRF-TOKEN', auth.csrf);
before(async () => {
  sql = await localDatabase();
});
after(async () => {
  cache.close();
  await sql.close();
});
beforeEach(async () => {
  if (cache) cache.close();
  await sql.query('TRUNCATE gallery.users CASCADE');
  documents.documents.clear();
  await demoData(sql, documents);
  artist = String(
    (await sql.query("SELECT id FROM gallery.users WHERE role='artist'"))
      .rows[0]!['id'],
  );
  patron = String(
    (await sql.query("SELECT id FROM gallery.users WHERE role='patron'"))
      .rows[0]!['id'],
  );
  redis = new FakeRedis();
  cache = new RedisDiscoveryCache(redis, 'feed-test', 60, () => {});
  await cache.connect();
  reads = { pool: 0, follows: 0, older: 0 };
  pending = [];
  const counted: Sql = {
    ...sql,
    query: async <T>(text: string, values?: unknown[]) => {
      if (text.includes('jsonb_agg(p')) reads.pool++;
      if (text.includes('SELECT f.artist_id')) reads.follows++;
      if (text.includes('a.artist_id=ANY')) reads.older++;
      return sql.query<T>(text, values);
    },
  };
  app = createApp({
    config,
    sql: counted,
    artworks: documents,
    cache,
    rateLimitEnabled: false,
    defer: (work) => {
      pending.push(work);
    },
    storage: {
      reserve: async () => '/upload',
      inspect: async () => {},
      publish: async () => '/test.png',
      remove: async () => {},
    },
  });
});
it('allows people of either role to follow each other, idempotently and with CSRF/identity checks', async () => {
  const a = await login('Maya Laurent'),
    p = await login();
  await request(app)
    .put(`/api/people/${patron}/follow`)
    .set('Cookie', a.jar)
    .send({})
    .expect(403);
  for (let n = 0; n < 2; n++)
    await mutate('put', `/api/people/${patron}/follow`, a).expect(200);
  await mutate('put', `/api/artists/${artist}/follow`, p).expect(200);
  assert.equal(
    (await sql.query('SELECT * FROM gallery.follows')).rows.length,
    2,
  );
  await mutate('put', `/api/people/${artist}/follow`, a).expect(400);
  await mutate('put', '/api/people/000000000000000000000000/follow', a).expect(
    404,
  );
  const people = (
    await request(app).get('/api/people').set('Cookie', a.jar).expect(200)
  ).body;
  assert.equal(
    people.items.find((person: { id: string }) => person.id === patron)
      .following,
    true,
  );
  assert.equal(JSON.stringify(people).includes('password_hash'), false);
  assert.equal(JSON.stringify(people).includes('email'), false);
  assert.equal(
    (await request(app).get(`/api/people/${patron}`).expect(200)).body.role,
    'patron',
  );
  const empty = (
    await request(app)
      .get('/api/feeds/following')
      .set('Cookie', a.jar)
      .expect(200)
  ).body;
  assert.equal(empty.source, 'following');
  assert.deepEqual(empty.items, []);
});
it('requires authentication for Following and provides paginated random discovery with no follows', async () => {
  await request(app).get('/api/feeds/following').expect(401);
  const p = await login();
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const result: FeedPage = (
      await request(app)
        .get('/api/feeds/following')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Cookie', p.jar)
        .expect(200)
    ).body;
    assert.equal(result.source, 'explore');
    assert.equal(result.followingCount, 0);
    ids.push(...result.items.map((i) => i.id));
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(
    ids.length,
    Number(
      (
        await sql.query(
          "SELECT count(*)::int AS n FROM gallery.artworks WHERE status='published'",
        )
      ).rows[0]!['n'],
    ),
  );
  assert.equal(new Set(ids).size, ids.length);
});
it('orders followed posts chronologically with exact microsecond/id ties and caches content reads', async () => {
  const p = await login();
  await mutate('put', `/api/people/${artist}/follow`, p).expect(200);
  await sql.query(
    "UPDATE gallery.artworks SET created_at='2026-10-03T12:00:00.123456Z'",
  );
  await cache.invalidate();
  const first = await request(app)
    .get('/api/feeds/following?limit=2')
    .set('Cookie', p.jar)
    .expect(200);
  const counted = { ...reads };
  const hit = await request(app)
    .get('/api/feeds/following?limit=2')
    .set('Cookie', p.jar)
    .expect(200);
  assert.equal(hit.headers['x-cache'], 'HIT');
  assert.deepEqual(reads, counted);
  const ids = first.body.items.map((i: { id: string }) => i.id);
  let cursor = first.body.nextCursor;
  while (cursor) {
    const next = await request(app)
      .get('/api/feeds/following')
      .query({ limit: 2, cursor })
      .set('Cookie', p.jar)
      .expect(200);
    ids.push(...next.body.items.map((i: { id: string }) => i.id));
    cursor = next.body.nextCursor;
  }
  assert.deepEqual(
    ids,
    (
      await sql.query(
        "SELECT id FROM gallery.artworks WHERE status='published' ORDER BY created_at DESC,id DESC",
      )
    ).rows.map((r) => r['id']),
  );
});
it('warms shared feed candidates after durable publication and excludes pending rows', async () => {
  const a = await login('Maya Laurent'),
    p = await login();
  await mutate('put', `/api/people/${artist}/follow`, p).expect(200);
  await request(app)
    .get('/api/feeds/following')
    .set('Cookie', p.jar)
    .expect(200);
  const upload = (
    await mutate('post', '/api/uploads', a)
      .send({ contentType: 'image/png', bytes: 68 })
      .expect(201)
  ).body;
  const art = (
    await mutate('post', '/api/artworks', a)
      .send({
        title: 'Freshly published',
        year: '2026',
        category: 'Digital',
        medium: 'PNG',
        description: 'New post',
        uploadId: upload.id,
      })
      .expect(201)
  ).body;
  await Promise.all(pending);
  const counted = reads.pool;
  const feed = await request(app)
    .get('/api/feeds/following')
    .set('Cookie', p.jar)
    .expect(200);
  assert.equal(feed.headers['x-feed-candidates'], 'HIT');
  assert.equal(reads.pool, counted);
  assert.equal(feed.body.items[0].id, art.id);
  assert.ok(await documents.get(art.id));
  await sql.query("UPDATE gallery.artworks SET status='pending' WHERE id=$1", [
    art.id,
  ]);
  await cache.invalidate();
  assert.equal(
    (
      await request(app)
        .get('/api/feeds/following')
        .set('Cookie', p.jar)
        .expect(200)
    ).body.items.some((i: { id: string }) => i.id === art.id),
    false,
  );
});
it('invalidates followed selection and rejects tampered, expired, cross-account and obsolete cursors', async () => {
  const p = await login(),
    a = await login('Maya Laurent');
  await mutate('put', `/api/people/${artist}/follow`, p).expect(200);
  const cursor = (
    await request(app)
      .get('/api/feeds/following?limit=1')
      .set('Cookie', p.jar)
      .expect(200)
  ).body.nextCursor as string;
  await request(app)
    .get('/api/feeds/following')
    .query({ cursor: cursor.slice(0, -4) + 'abcd' })
    .set('Cookie', p.jar)
    .expect(400);
  await request(app)
    .get('/api/feeds/following')
    .query({ cursor })
    .set('Cookie', a.jar)
    .expect(409);
  const payload = JSON.parse(
    Buffer.from(cursor.split('.')[0]!, 'base64url').toString(),
  );
  payload.expires = 1;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const expired =
    body +
    '.' +
    createHmac('sha256', config.jwtSecret)
      .update('feed:v1:' + body)
      .digest('base64url');
  await request(app)
    .get('/api/feeds/following')
    .query({ cursor: expired })
    .set('Cookie', p.jar)
    .expect(400);
  await mutate('delete', `/api/people/${artist}/follow`, p).expect(200);
  await request(app)
    .get('/api/feeds/following')
    .query({ cursor })
    .set('Cookie', p.jar)
    .expect(409);
  assert.equal(
    (
      await request(app)
        .get('/api/feeds/following')
        .set('Cookie', p.jar)
        .expect(200)
    ).body.source,
    'explore',
  );
});
it('keeps viewer-specific likes out of shared feed caches and falls back during Redis outages', async () => {
  const p = await login(),
    a = await login('Maya Laurent');
  const id = String(
    (await sql.query('SELECT id FROM gallery.artworks LIMIT 1')).rows[0]!['id'],
  );
  await mutate('put', `/api/artworks/${id}/like`, p).expect(200);
  const read = async (jar?: string[]) => {
    let r = request(app).get('/api/feeds/explore?limit=48');
    if (jar) r = r.set('Cookie', jar);
    return (await r.expect(200)).body.items.find(
      (i: { id: string }) => i.id === id,
    );
  };
  assert.equal((await read(p.jar)).liked, true);
  assert.equal((await read(a.jar)).liked, false);
  assert.equal((await read()).liked, false);
  for (const entry of redis.values.values())
    if (entry.value.startsWith('[') || entry.value.startsWith('{'))
      assert.equal(/"liked":true/.test(entry.value), false);
  redis.failReads = true;
  const fallback = await request(app)
    .get('/api/feeds/explore?limit=48')
    .expect(200);
  assert.equal(fallback.headers['x-cache'], 'BYPASS');
  assert.equal(
    fallback.body.items.length,
    (await sql.query('SELECT id FROM gallery.artworks')).rows.length,
  );
});
it('uses indexed fallbacks for older followed posts and traverses the entire larger Explore catalog once', async () => {
  const other = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  await sql.query(
    "INSERT INTO gallery.users(id,username,password_hash,role) VALUES($1,'Older artist','scrypt$invalid','artist')",
    [other],
  );
  await sql.query(
    `INSERT INTO gallery.artworks(id,artist_id,title,year,category,medium,description_preview,image_url,search_document,status,created_at)
    SELECT lpad(to_hex(g+1000),24,'0'),$1,'Recent '||g,'2026','Test','PNG','Test','/test.png',to_tsvector('english','Test'),'published','2026-10-03T12:00:00.123456Z'::timestamptz+g*interval '1 microsecond' FROM generate_series(1,260) g`,
    [artist],
  );
  await sql.query(
    "UPDATE gallery.artworks SET artist_id=$1,created_at='2025-01-01T00:00:00.123456Z' WHERE id IN (SELECT id FROM gallery.artworks WHERE title NOT LIKE 'Recent %' ORDER BY id LIMIT 2)",
    [other],
  );
  const p = await login();
  await mutate('put', `/api/people/${other}/follow`, p).expect(200);
  const older = await request(app)
    .get('/api/feeds/following')
    .set('Cookie', p.jar)
    .expect(200);
  assert.equal(older.body.items.length, 2);
  assert.equal(reads.older, 1);
  await request(app)
    .get('/api/feeds/following')
    .set('Cookie', p.jar)
    .expect(200);
  assert.equal(reads.older, 1);
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: FeedPage = (
      await request(app)
        .get('/api/feeds/explore')
        .query({ limit: 48, ...(cursor ? { cursor } : {}) })
        .expect(200)
    ).body;
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(
    ids.length,
    (await sql.query('SELECT id FROM gallery.artworks')).rows.length,
  );
  assert.equal(new Set(ids).size, ids.length);
});
it('hides retired profiles/content and rejects invalid filters and limits', async () => {
  await sql.query(
    'UPDATE gallery.users SET deletion_requested_at=now() WHERE id=$1',
    [artist],
  );
  await cache.invalidate();
  await request(app).get(`/api/people/${artist}`).expect(404);
  assert.equal(
    (await request(app).get('/api/people').expect(200)).body.items.some(
      (p: { id: string }) => p.id === artist,
    ),
    false,
  );
  assert.deepEqual(
    (await request(app).get('/api/feeds/explore').expect(200)).body.items,
    [],
  );
  for (const query of [
    { limit: 0 },
    { limit: 49 },
    { limit: 'x' },
    { sort: 'random' },
    { cursor: 'invalid' },
  ])
    await request(app).get('/api/feeds/explore').query(query).expect(400);
});
