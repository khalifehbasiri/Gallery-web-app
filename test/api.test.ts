import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
