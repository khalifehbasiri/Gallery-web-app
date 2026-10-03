import assert from 'node:assert/strict';
import { before, after, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { createApp } from '../server/src/app.js';
import { readConfig } from '../server/src/config.js';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { demoData } from '../server/src/demo-data.js';
import { RedisDiscoveryCache } from '../server/src/cache.js';
import { FakeRedis } from './helpers/fake-redis.js';
import type { Sql } from '../server/src/database.js';
import type { ImageStorage } from '../server/src/storage.js';
import { imageType } from '../server/src/storage.js';
import { hashPassword, verifyPassword } from '../server/src/passwords.js';
let sql: Sql,
  app: ReturnType<typeof createApp>,
  artist: string,
  patron: string,
  art: string;
const config = readConfig({
    JWT_SECRET: 'test-secret-with-at-least-32-characters',
  }),
  artworks = new LocalArtworkStore();
const storage: ImageStorage = {
  reserve: async () => 'https://example.invalid/upload',
  inspect: async () => {},
  publish: async () => '/test.png',
  remove: async () => {},
};
const cache = new RedisDiscoveryCache(
  new FakeRedis(),
  'api-test',
  60,
  () => {},
);
const csrf = (cookies: string[]) =>
  decodeURIComponent(
    cookies
      .find((c) => c.startsWith('XSRF-TOKEN='))!
      .split(';')[0]!
      .slice(11),
  );
const cookies = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]).map(
    (c) => c.split(';')[0]!,
  );
async function login(username = 'demo') {
  const anon = await request(app).get('/api/auth/csrf').expect(204),
    c = cookies(anon);
  const response = await request(app)
    .post('/api/auth/login')
    .set('Cookie', c)
    .set('X-XSRF-TOKEN', csrf(c))
    .send({ username, password: 'gallery-demo-2026' })
    .expect(200);
  const jar = cookies(response);
  return { jar, csrf: csrf(jar), response };
}
const mutate = (
  method: 'post' | 'put' | 'delete' | 'patch',
  url: string,
  auth: { jar: string[]; csrf: string },
) =>
  request(app)
    [method](url)
    .set('Cookie', auth.jar)
    .set('X-XSRF-TOKEN', auth.csrf);
before(async () => {
  sql = await localDatabase();
  await cache.connect();
  app = createApp({
    config,
    sql,
    artworks,
    storage,
    cache,
    rateLimitEnabled: false,
  });
});
after(async () => {
  cache.close();
  await sql.close();
});
beforeEach(async () => {
  await sql.query('TRUNCATE gallery.users CASCADE');
  artworks.documents.clear();
  await cache.invalidate();
  await demoData(sql, artworks);
  artist = String(
    (await sql.query("SELECT id FROM gallery.users WHERE role='artist'"))
      .rows[0]!['id'],
  );
  patron = String(
    (await sql.query("SELECT id FROM gallery.users WHERE role='patron'"))
      .rows[0]!['id'],
  );
  art = String(
    (await sql.query('SELECT id FROM gallery.artworks ORDER BY id LIMIT 1'))
      .rows[0]!['id'],
  );
});
describe('PostgreSQL API and cookie security', () => {
  it('issues independent Strict HttpOnly JWT and opaque refresh cookies, storing hashes only', async () => {
    const auth = await login();
    const raw = auth.response.headers['set-cookie'] as unknown as string[];
    for (const name of [
      'gallery_token',
      'gallery_refresh',
      'gallery_csrf_binding',
    ]) {
      const cookie = raw.find((c) => c.startsWith(name + '='))!;
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
    }
    const token = auth.jar
        .find((c) => c.startsWith('gallery_token='))!
        .slice(14),
      refresh = auth.jar
        .find((c) => c.startsWith('gallery_refresh='))!
        .slice(16);
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    assert.equal(payload.exp! - payload.iat!, 600);
    assert.ok(payload.jti);
    assert.notEqual(payload['sid'], refresh);
    assert.match(refresh, /^[\w-]{43}$/);
    const stored = (await sql.query('SELECT hash FROM gallery.refresh_tokens'))
      .rows[0]!['hash'];
    assert.equal(stored, createHash('sha256').update(refresh).digest('hex'));
    assert.ok(!JSON.stringify(auth.response.body).includes('password'));
  });
  it('rejects missing, wrong, session-mismatched and cross-origin CSRF proofs', async () => {
    const auth = await login();
    await request(app)
      .put(`/api/artworks/${art}/like`)
      .set('Cookie', auth.jar)
      .expect(403);
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'demo', password: 'gallery-demo-2026' })
      .expect(403);
    await mutate('put', `/api/artworks/${art}/like`, auth)
      .set('X-XSRF-TOKEN', 'wrong')
      .expect(403);
    await mutate('put', `/api/artworks/${art}/like`, auth)
      .set('Origin', 'https://evil.example')
      .expect(403);
    const other = await login();
    await request(app)
      .put(`/api/artworks/${art}/like`)
      .set('Cookie', [
        ...auth.jar.filter((c) => c.startsWith('gallery_token=')),
        ...other.jar.filter((c) => !c.startsWith('gallery_token=')),
      ])
      .set('X-XSRF-TOKEN', other.csrf)
      .expect(403);
  });
  it('rotates refresh secrets once and revokes the entire family on replay', async () => {
    const auth = await login();
    const refreshed = await mutate('post', '/api/auth/refresh', auth)
      .send({})
      .expect(200);
    const updated = cookies(refreshed);
    assert.notEqual(
      updated.find((c) => c.startsWith('gallery_refresh=')),
      auth.jar.find((c) => c.startsWith('gallery_refresh=')),
    );
    await request(app).get('/api/account').set('Cookie', updated).expect(200);
    await mutate('post', '/api/auth/refresh', auth).send({}).expect(401);
    await request(app).get('/api/account').set('Cookie', updated).expect(401);
  });
  it('refreshes with an expired JWT and enforces idle and absolute expiry', async () => {
    const auth = await login();
    const sid = String(
      (await sql.query('SELECT id FROM gallery.sessions')).rows[0]!['id'],
    );
    const expired = jwt.sign({ sid }, config.jwtSecret, {
      subject: patron,
      jwtid: '00000000-0000-4000-a000-000000000001',
      issuer: 'gallery-api',
      audience: 'gallery-client',
      expiresIn: -10,
    });
    const old = {
      ...auth,
      jar: auth.jar.map((c) =>
        c.startsWith('gallery_token=') ? `gallery_token=${expired}` : c,
      ),
    };
    await request(app).get('/api/auth/me').set('Cookie', old.jar).expect(401);
    const renewed = await mutate('post', '/api/auth/refresh', old)
      .send({})
      .expect(200);
    await sql.query(
      "UPDATE gallery.sessions SET idle_expires_at=now()-interval '1 second' WHERE id=$1",
      [sid],
    );
    await mutate('post', '/api/auth/refresh', {
      jar: cookies(renewed),
      csrf: csrf(cookies(renewed)),
    })
      .send({})
      .expect(401);
  });
  it('durably blacklists a jti and rejects replay without blacklisting raw bearer tokens', async () => {
    const auth = await login();
    await mutate('post', '/api/auth/deny-token', auth).send({}).expect(204);
    await request(app).get('/api/account').set('Cookie', auth.jar).expect(401);
    const denial = (await sql.query('SELECT jti FROM gallery.token_denials'))
      .rows[0]!;
    assert.match(String(denial['jti']), /^[\da-f-]{36}$/);
  });
  it('revokes logout and all-device sessions, including expired access credentials', async () => {
    const first = await login(),
      second = await login();
    await mutate('post', '/api/auth/logout', first).send({}).expect(204);
    await request(app).get('/api/account').set('Cookie', first.jar).expect(401);
    await request(app)
      .get('/api/account')
      .set('Cookie', second.jar)
      .expect(200);
    await mutate('post', '/api/auth/logout-all', second).send({}).expect(204);
    await request(app)
      .get('/api/account')
      .set('Cookie', second.jar)
      .expect(401);
  });
  it('lists only owned sessions and prevents revoking somebody else’s session', async () => {
    const auth = await login(),
      other = await login('Maya Laurent');
    const sessions = await request(app)
      .get('/api/auth/sessions')
      .set('Cookie', auth.jar)
      .expect(200);
    assert.equal(sessions.body.length, 1);
    assert.equal(sessions.body[0].current, true);
    await mutate(
      'delete',
      `/api/auth/sessions/${sessions.body[0].id}`,
      other,
    ).expect(404);
    await mutate(
      'delete',
      `/api/auth/sessions/${sessions.body[0].id}`,
      auth,
    ).expect(204);
    await request(app).get('/api/account').set('Cookie', auth.jar).expect(401);
  });
  it('registers server-owned roles and preserves password whitespace', async () => {
    const anon = await request(app).get('/api/auth/csrf').expect(204),
      jar = cookies(anon),
      auth = { jar, csrf: csrf(jar) };
    await mutate('post', '/api/auth/register', auth)
      .send({ username: 'New', password: ' password ', role: 'artist' })
      .expect(201);
    const row = (
      await sql.query("SELECT * FROM gallery.users WHERE username='New'")
    ).rows[0]!;
    assert.equal(row['role'], 'patron');
    assert.ok(await verifyPassword(' password ', String(row['password_hash'])));
    await mutate('post', '/api/auth/register', auth)
      .send({ username: 'New', password: ' password ' })
      .expect(409);
  });
  it('searches indexed SQL projections and rejects malformed filters and pagination', async () => {
    const result = await request(app)
      .get('/api/artworks?search=color&limit=1')
      .expect(200);
    assert.equal(result.body.total, 6);
    assert.equal(result.body.items.length, 1);
    await request(app).get('/api/artworks?search[$ne]=x').expect(400);
    await request(app).get('/api/artworks?limit=999').expect(400);
    await request(app).get('/api/artworks?page=0').expect(400);
    const indexes = (
      await sql.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname='gallery'",
      )
    ).rows;
    assert.ok(indexes.some((r) => r['indexname'] === 'artworks_search'));
  });
  it('caches public detail, comments, artists and workshops without leaking personal flags', async () => {
    const auth = await login();
    await mutate('put', `/api/artworks/${art}/like`, auth).expect(200);
    await mutate('post', `/api/artworks/${art}/reviews`, auth)
      .send({ text: '<img src=x onerror=alert(1)>' })
      .expect(201);
    for (const url of [
      `/api/artworks/${art}`,
      `/api/artworks/${art}/reviews`,
      `/api/artists/${artist}`,
      '/api/workshops',
    ]) {
      await request(app).get(url).expect(200).expect('X-Cache', 'MISS');
      await request(app)
        .get(url)
        .set('Cookie', auth.jar)
        .expect(200)
        .expect('X-Cache', 'HIT');
    }
    const personal = (
      await request(app)
        .get(`/api/artworks/${art}`)
        .set('Cookie', auth.jar)
        .expect(200)
    ).body.artwork;
    const publicArt = (
      await request(app).get(`/api/artworks/${art}`).expect(200)
    ).body.artwork;
    assert.equal(personal.liked, true);
    assert.equal(personal.reviews[0].owned, true);
    assert.equal(publicArt.liked, false);
    assert.equal(publicArt.reviews[0].owned, false);
    assert.equal(publicArt.reviews[0].text, '<img src=x onerror=alert(1)>');
  });
  it('keeps concurrent duplicate likes and unlike counters consistent', async () => {
    const auth = await login();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        mutate('put', `/api/artworks/${art}/like`, auth).expect(200),
      ),
    );
    assert.equal(
      Number(
        (
          await sql.query(
            'SELECT like_count FROM gallery.artworks WHERE id=$1',
            [art],
          )
        ).rows[0]!['like_count'],
      ),
      1,
    );
    await Promise.all(
      Array.from({ length: 5 }, () =>
        mutate('delete', `/api/artworks/${art}/like`, auth).expect(200),
      ),
    );
    assert.equal(
      Number(
        (
          await sql.query(
            'SELECT like_count FROM gallery.artworks WHERE id=$1',
            [art],
          )
        ).rows[0]!['like_count'],
      ),
      0,
    );
  });
  it('checks review ownership and updates counts transactionally', async () => {
    const auth = await login(),
      other = await login('Maya Laurent');
    const r = await mutate('post', `/api/artworks/${art}/reviews`, auth)
      .send({ text: 'Same text' })
      .expect(201);
    await mutate(
      'delete',
      `/api/artworks/${art}/reviews/${r.body.id}`,
      other,
    ).expect(403);
    await mutate(
      'delete',
      `/api/artworks/${art}/reviews/${r.body.id}`,
      auth,
    ).expect(204);
    assert.equal(
      Number(
        (
          await sql.query(
            'SELECT review_count FROM gallery.artworks WHERE id=$1',
            [art],
          )
        ).rows[0]!['review_count'],
      ),
      0,
    );
    await mutate('post', `/api/artworks/${art}/reviews`, auth)
      .send({ text: '\u0000' })
      .expect(400);
  });
  it('enforces artist permissions and idempotent follows/enrollment', async () => {
    const auth = await login(),
      creator = await login('Maya Laurent');
    await mutate('post', '/api/uploads', auth)
      .send({ contentType: 'image/png', bytes: 10 })
      .expect(403);
    for (let i = 0; i < 3; i++) {
      await mutate('put', `/api/artists/${artist}/follow`, auth).expect(200);
      await mutate(
        'put',
        `/api/artists/${artist}/workshops/demo-workshop/registration`,
        auth,
      ).expect(200);
    }
    assert.equal(
      (
        await request(app)
          .get('/api/workshops')
          .set('Cookie', auth.jar)
          .expect(200)
      ).body.items[0].attendeeCount,
      1,
    );
    await mutate('post', '/api/workshops', creator)
      .send({ name: 'New', goal: 'Learn', weeks: 2 })
      .expect(201);
    await mutate('patch', '/api/account', auth)
      .send({ role: 'admin' })
      .expect(400);
    await mutate('patch', '/api/account', auth)
      .send({ role: 'artist' })
      .expect(200);
  });
  it('bounds signed upload reservations and publishes only validated images', async () => {
    const auth = await login('Maya Laurent');
    await mutate('post', '/api/uploads', auth)
      .send({ contentType: 'image/svg+xml', bytes: 10 })
      .expect(400);
    await mutate('post', '/api/uploads', auth)
      .send({ contentType: 'image/png', bytes: 5242881 })
      .expect(400);
    const upload = await mutate('post', '/api/uploads', auth)
      .send({ contentType: 'image/png', bytes: 10 })
      .expect(201);
    const body = {
      title: 'Published',
      year: '2026',
      category: 'Painting',
      medium: 'Oil',
      description: 'A story.',
      uploadId: upload.body.id,
    };
    const result = await mutate('post', '/api/artworks', auth)
      .send(body)
      .expect(201);
    assert.ok(await artworks.get(result.body.id));
    const retry = await mutate('post', '/api/artworks', auth)
      .send(body)
      .expect(200);
    assert.equal(retry.body.id, result.body.id);
    await mutate('post', '/api/artworks', auth)
      .send({ ...body, title: 'Changed retry' })
      .expect(409);
    assert.throws(() => imageType(Buffer.from('<script>x</script>')), /PNG/);
  });
  it('hides partial Firestore publications, SQL errors and private account credentials', async () => {
    await sql.query(
      "UPDATE gallery.artworks SET status='pending' WHERE id=$1",
      [art],
    );
    await request(app).get(`/api/artworks/${art}`).expect(404);
    assert.equal(
      (await request(app).get('/api/artworks').expect(200)).body.total,
      5,
    );
    const auth = await login();
    const account = (
      await request(app).get('/api/account').set('Cookie', auth.jar).expect(200)
    ).body;
    assert.ok(!JSON.stringify(account).includes('password'));
    const malformed = await mutate('post', '/api/auth/login', auth)
      .set('Content-Type', 'application/json')
      .send('{"password":"secret"')
      .expect(400);
    assert.equal(malformed.body.error, 'Invalid JSON body.');
  });
});
it('validates production secrets and password verification', async () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  const hash = await hashPassword('test');
  assert.ok(await verifyPassword('test', hash));
  assert.equal(await verifyPassword('wrong', hash), false);
});
