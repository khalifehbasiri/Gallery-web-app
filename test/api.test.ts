import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../server/src/app.js';
import { readConfig } from '../server/src/config.js';
import {
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from '../server/src/passwords.js';
import { seedDatabase } from '../server/src/seed.js';
import {
  AuthSession,
  User,
  Gallery,
  type UserDocument,
  type GalleryDocument,
} from '../server/src/models.js';
import type { ArtworkSummary, Review } from '../shared/contracts.js';
import { RedisDiscoveryCache } from '../server/src/cache.js';
import { FakeRedis } from './helpers/fake-redis.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=',
  'base64',
);
const fields = {
  name: 'First artwork',
  artist: 'Artist',
  year: '2020',
  category: 'painting',
  medium: 'oil',
  description: 'Example artwork',
  image: '/example.png',
};
const config = readConfig({
  JWT_SECRET: 'test-secret-for-gallery-authentication',
});
let mongo: MongoMemoryServer;
let uploadDirectory: string;
let app: ReturnType<typeof createApp>;
let patron: UserDocument;
let artist: UserDocument;
let artwork: GalleryDocument;
async function login(username = 'Patron', password = 'password123') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password }).expect(200);
  return agent;
}
function uploadArt(
  agent: Awaited<ReturnType<typeof login>>,
  image = png,
  title = 'Uploaded artwork',
) {
  return agent
    .post('/api/artworks')
    .field('title', title)
    .field('year', '2024')
    .field('category', 'painting')
    .field('medium', 'digital')
    .field('description', 'Uploaded image')
    .attach('image', image, {
      filename: 'image.png',
      contentType: 'image/png',
    });
}

async function cachedTestApp() {
  const redis = new FakeRedis();
  const cache = new RedisDiscoveryCache(redis, 'api-tests', 60, () => {});
  await cache.connect();
  return {
    redis,
    cache,
    app: createApp({ config, uploadDirectory, cache, rateLimitEnabled: false }),
  };
}

describe('TypeScript REST API', { timeout: 180000 }, () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([User.init(), Gallery.init(), AuthSession.init()]);
    uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'gallery-tests-'));
    app = createApp({ config, uploadDirectory, rateLimitEnabled: false });
  });
  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Gallery.deleteMany({}),
      AuthSession.deleteMany({}),
    ]);
    const password = await hashPassword('password123');
    [patron, artist] = await User.create([
      { username: 'Patron', password },
      { username: 'Artist', password, aType: 'artist' },
    ]);
    artwork = await Gallery.create(fields);
  });
  after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
    if (uploadDirectory) {
      assert.equal(
        path.dirname(path.resolve(uploadDirectory)),
        path.resolve(os.tmpdir()),
      );
      assert.ok(path.basename(uploadDirectory).startsWith('gallery-tests-'));
      await rm(uploadDirectory, { recursive: true, force: true });
    }
  });
  it('exposes public discovery and protects account mutations', async () => {
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/artworks').expect(200);
    await request(app).get(`/api/artworks/${artwork.id}`).expect(200);
    await request(app).get(`/api/artists/${artist.id}`).expect(200);
    await request(app).get('/api/account').expect(401);
    await request(app)
      .patch('/api/account')
      .send({ role: 'artist' })
      .expect(401);
    await request(app).put(`/api/artworks/${artwork.id}/like`).expect(401);
    await request(app)
      .post(`/api/artworks/${artwork.id}/reviews`)
      .send({ text: 'Review' })
      .expect(401);
    await request(app).post('/api/artworks').send({}).expect(401);
    await request(app).post('/api/workshops').send({}).expect(401);
  });
  it('serves Angular deep links while keeping missing assets and API endpoints as JSON 404s', async () => {
    const frontendDirectory = path.join(uploadDirectory, 'frontend');
    await mkdir(frontendDirectory, { recursive: true });
    await writeFile(
      path.join(frontendDirectory, 'index.html'),
      '<!doctype html><app-root></app-root>',
    );
    await writeFile(
      path.join(frontendDirectory, 'main.js'),
      'console.log("Angular fixture")',
    );
    const spa = createApp({
      config,
      uploadDirectory,
      frontendDirectory,
      rateLimitEnabled: false,
    });
    const page = await request(spa)
      .get('/artworks/a-deep-link')
      .expect(200)
      .expect('Content-Type', /html/);
    assert.ok(page.text.includes('<app-root>'));
    assert.equal(page.headers['cache-control'], 'no-cache');
    assert.ok(
      page.headers['content-security-policy'].includes("script-src 'self'"),
    );
    await request(spa)
      .get('/main.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
    await request(spa)
      .get('/missing.js')
      .expect(404)
      .expect('Content-Type', /json/);
    await request(spa)
      .get('/api/unknown')
      .expect(404)
      .expect('Content-Type', /json/);
  });
  it('caches public discovery without repeating MongoDB queries and validates filters before cache access', async (context) => {
    const { app: cached, redis } = await cachedTestApp();
    const counts = context.mock.method(Gallery, 'countDocuments');
    const finds = context.mock.method(Gallery, 'find');
    await request(cached)
      .get('/api/stats')
      .expect(200)
      .expect('X-Cache', 'MISS');
    await request(cached)
      .get('/api/stats')
      .expect(200)
      .expect('X-Cache', 'HIT');
    assert.equal(counts.mock.callCount(), 1);
    await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'MISS');
    await request(cached)
      .get('/api/artworks?page=1&limit=12&search=')
      .expect(200)
      .expect('X-Cache', 'HIT');
    assert.equal(finds.mock.callCount(), 1);
    await request(cached)
      .get('/api/artworks?category=digital')
      .expect(200)
      .expect('X-Cache', 'MISS');
    assert.equal(finds.mock.callCount(), 2);
    const cacheReads = context.mock.method(redis, 'get');
    await request(cached).get('/api/artworks?limit=500').expect(400);
    await request(cached).get('/api/artworks?search[$ne]=anything').expect(400);
    assert.equal(cacheReads.mock.callCount(), 0);
    assert.equal(
      (await request(cached).get('/api/health').expect(200)).body.redis,
      'ready',
    );
  });
  it('bypasses shared caching for signed-in users and keeps saved-work state private', async () => {
    const { app: cached, redis } = await cachedTestApp();
    await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'MISS');
    const signedIn = request.agent(cached);
    await signedIn
      .post('/api/auth/login')
      .send({ username: 'Patron', password: 'password123' })
      .expect(200);
    await signedIn.put(`/api/artworks/${artwork.id}/like`).expect(200);
    const personal = await signedIn
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'BYPASS')
      .expect('Cache-Control', 'private, no-store');
    assert.equal(personal.body.items[0].liked, true);
    const publicResult = await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'MISS');
    assert.equal(publicResult.body.items[0].liked, false);
    assert.equal(publicResult.body.items[0].likeCount, 1);
    await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'HIT');
    await signedIn.delete(`/api/artworks/${artwork.id}/like`).expect(200);
    assert.equal(
      (
        await request(cached)
          .get('/api/artworks')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.items[0].likeCount,
      0,
    );
    for (const entry of redis.values.values())
      assert.ok(!/Patron|password|gallery_token/.test(entry.value));
    await signedIn.get('/api/account').expect(200);
  });
  it('refreshes discovery after reviews, uploads, role changes, and workshop creation', async () => {
    const { app: cached } = await cachedTestApp();
    const patronAgent = request.agent(cached);
    const artistAgent = request.agent(cached);
    await patronAgent
      .post('/api/auth/login')
      .send({ username: 'Patron', password: 'password123' })
      .expect(200);
    await artistAgent
      .post('/api/auth/login')
      .send({ username: 'Artist', password: 'password123' })
      .expect(200);
    await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'MISS');
    const review = await patronAgent
      .post(`/api/artworks/${artwork.id}/reviews`)
      .send({ text: 'A new perspective.' })
      .expect(201);
    assert.equal(
      (
        await request(cached)
          .get('/api/artworks')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.items[0].reviewCount,
      1,
    );
    await patronAgent
      .delete(`/api/artworks/${artwork.id}/reviews/${review.body.id}`)
      .expect(204);
    assert.equal(
      (
        await request(cached)
          .get('/api/artworks')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.items[0].reviewCount,
      0,
    );
    await request(cached)
      .get('/api/stats')
      .expect(200)
      .expect('X-Cache', 'MISS');
    await uploadArt(artistAgent).expect(201);
    assert.equal(
      (
        await request(cached)
          .get('/api/stats')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.artworks,
      2,
    );
    assert.equal(
      (
        await request(cached)
          .get('/api/artworks')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.total,
      2,
    );
    await artistAgent
      .post('/api/workshops')
      .send({ name: 'Color workshop', goal: 'Learn color theory.', weeks: 2 })
      .expect(201);
    assert.equal(
      (
        await request(cached)
          .get('/api/stats')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.workshops,
      1,
    );
    await patronAgent
      .patch('/api/account')
      .send({ role: 'artist' })
      .expect(200);
    assert.equal(
      (
        await request(cached)
          .get('/api/stats')
          .expect(200)
          .expect('X-Cache', 'MISS')
      ).body.artists,
      2,
    );
  });
  it('keeps reads and mutations working through cache read/write failures', async () => {
    const { app: cached, redis } = await cachedTestApp();
    const signedIn = request.agent(cached);
    await signedIn
      .post('/api/auth/login')
      .send({ username: 'Patron', password: 'password123' })
      .expect(200);
    await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'MISS');
    redis.failWrites = true;
    await signedIn.put(`/api/artworks/${artwork.id}/like`).expect(200);
    const fresh = await request(cached)
      .get('/api/artworks')
      .expect(200)
      .expect('X-Cache', 'BYPASS');
    assert.equal(fresh.body.items[0].likeCount, 1);
    assert.equal(
      (await request(cached).get('/api/health').expect(200)).body.redis,
      'unavailable',
    );
    await request(cached)
      .get('/api/stats')
      .expect(200)
      .expect('X-Cache', 'BYPASS');
    const { app: readFailure, redis: failingRedis } = await cachedTestApp();
    failingRedis.failReads = true;
    await request(readFailure)
      .get('/api/stats')
      .expect(200)
      .expect('X-Cache', 'BYPASS');
    assert.equal(
      (
        await request(readFailure)
          .get('/api/artworks')
          .expect(200)
          .expect('X-Cache', 'BYPASS')
      ).body.total,
      1,
    );
  });
  it('registers only allowed fields and never serializes passwords', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'New user',
        password: 'new-password',
        aType: 'artist',
        following: [artist],
      })
      .expect(201);
    assert.deepEqual(Object.keys(response.body.user).sort(), [
      'id',
      'role',
      'username',
    ]);
    const user = await User.findOne({ username: 'New user' }).select(
      '+password',
    );
    assert.equal(user!.aType, 'patron');
    assert.deepEqual(user!.following, []);
    assert.ok(isPasswordHash(user!.password));
    assert.ok(await verifyPassword('new-password', user!.password));
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'New user', password: 'new-password' })
      .expect(409);
    await request(app)
      .post('/api/auth/register')
      .send({ username: { $ne: null }, password: 'new-password' })
      .expect(400);
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'Weak', password: 'short' })
      .expect(400);
  });
  it('upgrades legacy passwords and issues an HttpOnly JWT without exposing it to JavaScript', async () => {
    await User.updateOne(
      { _id: patron._id },
      { $set: { password: 'old password' } },
    );
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'Patron', password: 'old password' })
      .expect(200);
    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(!JSON.stringify(response.body).includes('password'));
    assert.ok(
      isPasswordHash(
        (await User.findById(patron._id).select('+password'))!.password,
      ),
    );
    await request(app).get('/api/account').set('Cookie', cookie).expect(200);
  });
  it('revokes JWTs on logout, even when an old cookie is replayed', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'Patron', password: 'password123' })
      .expect(200);
    const cookie = response.headers['set-cookie'][0];
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    await request(app).get('/api/account').set('Cookie', cookie).expect(401);
    assert.equal(await AuthSession.countDocuments(), 0);
  });
  it('rejects tampered and expired JWTs and invalid credentials', async () => {
    await request(app)
      .get('/api/account')
      .set('Cookie', 'gallery_token=invalid')
      .expect(401);
    const expired = jwt.sign({ sid: 'expired' }, config.jwtSecret, {
      subject: patron.id,
      issuer: 'gallery-api',
      audience: 'gallery-client',
      expiresIn: -1,
    });
    await request(app)
      .get('/api/account')
      .set('Cookie', `gallery_token=${expired}`)
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'Patron', password: 'wrong' })
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ username: { $ne: '' }, password: 'password123' })
      .expect(400);
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'Patron', password: { $ne: '' } })
      .expect(400);
  });
  it('rejects cross-origin mutations and sanitizes malformed JSON errors', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://unrelated.example')
      .send({ username: 'Patron', password: 'password123' })
      .expect(403);
    await request(app)
      .post('/api/auth/logout')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"private-value"')
      .expect(400);
    assert.equal(response.body.error, 'Invalid JSON body.');
  });
  it('returns JSON 404s for malformed/missing IDs and API endpoints', async () => {
    for (const id of ['invalid', 'a'.repeat(24)]) {
      await request(app).get(`/api/artworks/${id}`).expect(404);
      await request(app).get(`/api/artists/${id}`).expect(404);
    }
    await request(app)
      .get('/api/not-found')
      .expect(404)
      .expect('Content-Type', /json/);
  });
  it('paginates and searches without shared mutable state or query injection', async () => {
    await Gallery.create({
      ...fields,
      name: 'Second artwork',
      category: 'sculpture',
      description: 'Bronze sculpture',
    });
    const first = await request(app)
      .get('/api/artworks?category=painting&limit=1')
      .expect(200);
    const second = await request(app)
      .get('/api/artworks?search=Bronze')
      .expect(200);
    assert.equal(first.body.items[0].title, 'First artwork');
    assert.equal(second.body.items[0].title, 'Second artwork');
    assert.equal(
      (await request(app).get('/api/artworks?limit=1').expect(200)).body.pages,
      2,
    );
    await request(app).get('/api/artworks?page=0').expect(400);
    await request(app).get('/api/artworks?limit=999').expect(400);
    await request(app).get('/api/artworks?search[$ne]=anything').expect(400);
    const indexes = await Gallery.collection.indexes();
    assert.ok(indexes.some((index) => index.name === 'artwork_search'));
  });
  it('makes duplicate/concurrent likes and unlikes idempotent', async () => {
    const agent = await login();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        agent.put(`/api/artworks/${artwork.id}/like`).expect(200),
      ),
    );
    assert.equal((await Gallery.findById(artwork._id))!.numLikes.length, 1);
    assert.equal((await User.findById(patron._id))!.like.length, 1);
    const list = await agent.get('/api/artworks').expect(200);
    assert.ok((list.body.items as ArtworkSummary[])[0].liked);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        agent.delete(`/api/artworks/${artwork.id}/like`).expect(200),
      ),
    );
    assert.equal((await Gallery.findById(artwork._id))!.numLikes.length, 0);
  });
  it('deletes only the selected review owned by the current user', async () => {
    const first = await login();
    const second = await login('Artist');
    const reviewA = (
      await first
        .post(`/api/artworks/${artwork.id}/reviews`)
        .send({ text: 'Same review' })
        .expect(201)
    ).body as Review;
    const reviewB = (
      await first
        .post(`/api/artworks/${artwork.id}/reviews`)
        .send({ text: 'Same review' })
        .expect(201)
    ).body as Review;
    await second
      .delete(`/api/artworks/${artwork.id}/reviews/${reviewA.id}`)
      .expect(403);
    await first
      .delete(`/api/artworks/${artwork.id}/reviews/${reviewA.id}`)
      .expect(204);
    assert.equal(
      (await Gallery.findById(artwork._id))!.reviews[0].reviewId,
      reviewB.id,
    );
    assert.equal((await User.findById(patron._id))!.reviews.length, 1);
    await first
      .post(`/api/artworks/${artwork.id}/reviews`)
      .send({ text: '  ' })
      .expect(400);
  });
  it('supports legacy reviews while preserving another artwork and author', async () => {
    const other = await Gallery.create({ ...fields, name: 'Other artwork' });
    await Gallery.updateOne(
      { _id: artwork._id },
      {
        $push: {
          reviews: {
            $each: [
              { user: 'Patron', userId: patron._id, review: 'Legacy' },
              { user: 'Artist', userId: artist._id, review: 'Legacy' },
            ],
          },
        },
      },
    );
    await User.updateOne(
      { _id: patron._id },
      {
        $push: {
          reviews: {
            $each: [
              { artId: artwork._id, review: 'Legacy' },
              { artId: other._id, review: 'Legacy' },
            ],
          },
        },
      },
    );
    const agent = await login();
    const response = await agent.get(`/api/artworks/${artwork.id}`).expect(200);
    await agent
      .delete(
        `/api/artworks/${artwork.id}/reviews/${response.body.artwork.reviews[0].id}`,
      )
      .expect(204);
    assert.equal(
      (await Gallery.findById(artwork._id))!.reviews[0].user,
      'Artist',
    );
    assert.equal(
      String((await User.findById(patron._id))!.reviews[0].artId),
      other.id,
    );
  });
  it('follows artists once using minimal public snapshots', async () => {
    const agent = await login();
    await Promise.all(
      Array.from({ length: 3 }, () =>
        agent.put(`/api/artists/${artist.id}/follow`).expect(200),
      ),
    );
    const following = (await User.findById(patron._id))!.following;
    assert.equal(following.length, 1);
    assert.deepEqual(Object.keys(following[0]).sort(), [
      '_id',
      'aType',
      'username',
    ]);
    await agent.put(`/api/artists/${patron.id}/follow`).expect(400);
    await agent.delete(`/api/artists/${artist.id}/follow`).expect(200);
    assert.equal((await User.findById(patron._id))!.following.length, 0);
  });
  it('enforces saved artist permissions and validates explicit account role updates', async () => {
    const agent = await login();
    await agent.post('/api/artworks').send({}).expect(403);
    await agent.post('/api/workshops').send({}).expect(403);
    await agent.patch('/api/account').send({ role: 'admin' }).expect(400);
    await agent.patch('/api/account').send({ role: 'artist' }).expect(200);
    assert.equal((await User.findById(patron._id))!.aType, 'artist');
  });
  it('validates images, enforces size limits, and leaves no rejected uploads behind', async () => {
    const agent = await login('Artist');
    const beforeCount = (await readdir(uploadDirectory)).length;
    await uploadArt(agent).expect(201);
    const uploaded = await Gallery.findOne({ name: 'Uploaded artwork' });
    assert.equal(uploaded!.artist, 'Artist');
    await agent
      .get(uploaded!.image)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('X-Content-Type-Options', 'nosniff');
    await uploadArt(agent).expect(409);
    await uploadArt(agent, Buffer.from('<script>bad</script>'), 'Fake').expect(
      400,
    );
    await uploadArt(agent, Buffer.alloc(5 * 1024 * 1024 + 1), 'Large').expect(
      413,
    );
    assert.equal((await readdir(uploadDirectory)).length, beforeCount + 1);
  });
  it('creates workshops with server-owned attendees and idempotent registrations', async () => {
    const creator = await login('Artist');
    const attendee = await login();
    const response = await creator
      .post('/api/workshops')
      .send({
        name: 'Painting basics',
        goal: 'Learn painting',
        weeks: 2,
        signed: [{ name: 'Fake' }],
      })
      .expect(201);
    await creator
      .post('/api/workshops')
      .send({ name: 'Painting basics', goal: 'Learn', weeks: 2 })
      .expect(409);
    await creator
      .post('/api/workshops')
      .send({ name: 'Invalid', goal: 'Learn', weeks: 0 })
      .expect(400);
    const url = `/api/artists/${artist.id}/workshops/${response.body.id}/registration`;
    await attendee.put(url).expect(200);
    await attendee.put(url).expect(200);
    assert.deepEqual((await User.findById(artist._id))!.workshops[0].signed, [
      { name: 'Patron' },
    ]);
    assert.equal(
      (await attendee.get('/api/workshops').expect(200)).body.items[0].joined,
      true,
    );
    await attendee
      .put(`/api/artists/${artist.id}/workshops/missing/registration`)
      .expect(404);
  });
  it('paginates workshops across artists with stable IDs and accurate totals', async () => {
    await User.updateOne(
      { _id: artist._id },
      {
        $set: {
          workshops: [
            {
              workshopId: 'first',
              name: 'First',
              goal: 'Color',
              duration: '2',
              user: artist.username,
              signed: [],
            },
            {
              workshopId: 'second',
              name: 'Second',
              goal: 'Composition',
              duration: '3',
              user: artist.username,
              signed: [],
            },
          ],
        },
      },
    );
    await User.updateOne(
      { _id: patron._id },
      {
        $set: {
          aType: 'artist',
          workshops: [
            {
              workshopId: 'third',
              name: 'Third',
              goal: 'Drawing',
              duration: '1',
              user: patron.username,
              signed: [],
            },
          ],
        },
      },
    );
    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      const response = await request(app)
        .get(`/api/workshops?page=${page}&limit=1`)
        .expect(200);
      assert.equal(response.body.total, 3);
      assert.equal(response.body.pages, 3);
      assert.equal(response.body.items.length, 1);
      seen.add(response.body.items[0].id);
    }
    assert.equal(seen.size, 3);
    assert.equal(
      (await request(app).get('/api/workshops?page=4&limit=1').expect(200)).body
        .items.length,
      0,
    );
    await request(app).get('/api/workshops?limit=500').expect(400);
  });
  it('returns account data without nested legacy password snapshots', async () => {
    await User.updateOne(
      { _id: patron._id },
      {
        $push: {
          following: {
            _id: artist._id,
            username: artist.username,
            aType: 'artist',
            password: 'legacy-secret',
          },
        },
      },
    );
    const agent = await login();
    const response = await agent.get('/api/account').expect(200);
    assert.ok(!JSON.stringify(response.body).includes('password'));
    assert.ok(!JSON.stringify(response.body).includes('legacy-secret'));
  });
  it('seeds missing records without resetting accounts, likes, or artwork', async () => {
    await User.create({ username: 'khalifa', password: 'keep-me' });
    await seedDatabase();
    const counts = [
      await User.countDocuments(),
      await Gallery.countDocuments(),
    ];
    const seeded = await Gallery.findOne({ artist: 'Midjourney' });
    await Gallery.updateOne(
      { _id: seeded!._id },
      { $set: { description: 'Preserved' } },
    );
    await seedDatabase();
    assert.deepEqual(
      [await User.countDocuments(), await Gallery.countDocuments()],
      counts,
    );
    assert.equal(
      (await User.findOne({ username: 'khalifa' }).select('+password'))!
        .password,
      'keep-me',
    );
    assert.equal(
      (await Gallery.findById(seeded!._id))!.description,
      'Preserved',
    );
  });
});

it('validates production configuration and password hashes', async () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => readConfig({ PORT: 'wrong' }), /PORT/);
  const hashed = await hashPassword('secret');
  assert.ok(await verifyPassword('secret', hashed));
  assert.equal(await verifyPassword('wrong', hashed), false);
  assert.equal(await verifyPassword('secret', 'scrypt$invalid$hash'), false);
});
