import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app.js';
import { readConfig } from '../lib/config.js';
import {
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from '../lib/passwords.js';
import { seedDatabase } from '../database-initializer.js';
import User from '../userModel.js';
import Gallery from '../galleriesModel.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=',
  'base64',
);
const artworkFields = {
  name: 'First artwork',
  artist: 'Artist',
  year: '2020',
  category: 'painting',
  medium: 'oil',
  description: 'Example artwork',
  image: '/example.png',
};
let mongo;
let uploadDirectory;
let app;
let patron;
let artist;
let artwork;

async function login(username = 'Patron', password = 'password123') {
  const agent = request.agent(app);
  await agent.post('/login').send({ username, password }).expect(303);
  return agent;
}

function uploadArt(agent, image = png, name = 'Uploaded artwork') {
  return agent
    .post('/addArt')
    .field('name', name)
    .field('year', '2024')
    .field('category', 'painting')
    .field('medium', 'digital')
    .field('description', 'Uploaded image')
    .attach('image', image, {
      filename: 'image.png',
      contentType: 'image/png',
    });
}

describe('Gallery application', { timeout: 180000 }, () => {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { autoIndex: true });
    await User.init();
    uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'gallery-tests-'));
    const store = MongoStore.create({
      client: mongoose.connection.getClient(),
      stringify: false,
      autoRemove: 'disabled',
    });
    app = createApp({
      config: readConfig({ SESSION_SECRET: 'test-secret' }),
      store,
      uploadDirectory,
    });
  });
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Gallery.deleteMany({})]);
    const password = await hashPassword('password123');
    [patron, artist] = await User.create([
      { username: 'Patron', password },
      { username: 'Artist', password, aType: 'artist' },
    ]);
    artwork = await Gallery.create(artworkFields);
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

  it('requires authentication for private pages and all gallery mutations', async () => {
    await request(app).get('/').expect(200);
    await request(app).get('/register').expect(200);
    for (const page of [
      '/account',
      '/artwork',
      '/searchArt',
      '/addArtwork',
      '/addWorkshop',
    ]) {
      await request(app).get(page).expect(302).expect('Location', '/home');
    }
    for (const route of [
      '/accType',
      '/follow',
      '/unfollow',
      '/like',
      '/unlike',
      '/rsubmit',
      '/rRemove',
      '/addArt',
      '/addWorkshop',
      '/signup',
      '/searchArt',
    ]) {
      await request(app).post(route).send({}).expect(401);
    }
  });

  it('registers only allowed fields, hashes passwords, and rejects invalid or duplicate accounts', async () => {
    await request(app)
      .post('/register')
      .send({
        username: 'New user',
        password: 'new-password',
        aType: 'artist',
        following: [artist],
      })
      .expect(201);
    const user = await User.findOne({ username: 'New user' }).select(
      '+password',
    );
    assert.equal(user.aType, 'patron');
    assert.deepEqual(user.following, []);
    assert.ok(isPasswordHash(user.password));
    assert.ok(await verifyPassword('new-password', user.password));
    await request(app)
      .post('/register')
      .send({ username: 'New user', password: 'new-password' })
      .expect(409);
    await request(app)
      .post('/register')
      .send({ username: { $ne: null }, password: 'new-password' })
      .expect(400);
    await request(app)
      .post('/register')
      .send({ username: 'Weak', password: 'short' })
      .expect(400);
  });

  it('upgrades legacy passwords on login and invalidates the session on logout', async () => {
    await User.updateOne(
      { _id: patron._id },
      { $set: { password: 'old password' } },
    );
    const agent = await login('Patron', 'old password');
    const user = await User.findById(patron._id).select('+password');
    assert.ok(isPasswordHash(user.password));
    const response = await agent.get('/account').expect(200);
    assert.ok(!response.text.includes(user.password));
    assert.ok(!response.text.includes('old password'));
    await agent.get('/logout').expect(302).expect('Location', '/home');
    await agent.post('/like').send({ value: artwork.id }).expect(401);
  });

  it('rejects invalid login credentials and query objects', async () => {
    await request(app)
      .post('/login')
      .send({ username: 'Patron', password: 'wrong' })
      .expect(401);
    await request(app)
      .post('/login')
      .send({ username: { $ne: '' }, password: 'password123' })
      .expect(400);
    await request(app)
      .post('/login')
      .send({ username: 'Patron', password: { $ne: '' } })
      .expect(400);
  });

  it('returns 404 for malformed and missing artwork/artist IDs', async () => {
    const agent = await login();
    for (const id of ['invalid', 'a'.repeat(24)]) {
      await agent.get(`/art/${id}`).expect(404);
      await agent.get(`/artist/${id}`).expect(404);
      await agent.post('/like').send({ value: id }).expect(404);
    }
  });

  it('keeps searches isolated between sessions and rejects MongoDB operators', async () => {
    await Gallery.create({
      ...artworkFields,
      name: 'Second artwork',
      category: 'sculpture',
    });
    const first = await login();
    const second = await login('Artist');
    await first.post('/searchArt').send({ category: 'painting' }).expect(200);
    await second.post('/searchArt').send({ category: 'sculpture' }).expect(200);
    const firstResults = await first.get('/searchArt').expect(200);
    const secondResults = await second.get('/searchArt').expect(200);
    assert.ok(firstResults.text.includes('First artwork'));
    assert.ok(!firstResults.text.includes('Second artwork'));
    assert.ok(secondResults.text.includes('Second artwork'));
    assert.ok(!secondResults.text.includes('First artwork'));
    await first
      .post('/searchArt')
      .send({ name: { $ne: null } })
      .expect(400);
    await first.post('/searchArt').send({ $where: 'true' }).expect(400);
    await first.post('/searchArt').send({}).expect(400);
  });

  it('makes duplicate and concurrent likes/unlikes idempotent', async () => {
    const agent = await login();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        agent.post('/like').send({ value: artwork.id }).expect(200),
      ),
    );
    assert.equal((await Gallery.findById(artwork._id)).numLikes.length, 1);
    assert.equal((await User.findById(patron._id)).like.length, 1);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        agent.post('/unlike').send({ value: artwork.id }).expect(200),
      ),
    );
    assert.equal((await Gallery.findById(artwork._id)).numLikes.length, 0);
    assert.equal((await User.findById(patron._id)).like.length, 0);
  });

  it('removes only the selected review owned by the current user', async () => {
    const first = await login();
    const second = await login('Artist');
    const body = { id: artwork.id, value: 'Same review' };
    const reviewA = (await first.post('/rsubmit').send(body).expect(200)).body
      .review;
    const reviewB = (await first.post('/rsubmit').send(body).expect(200)).body
      .review;
    const reviewC = (await second.post('/rsubmit').send(body).expect(200)).body
      .review;
    await second
      .post('/rRemove')
      .send({ ...body, reviewId: reviewA.reviewId })
      .expect(200);
    assert.equal((await Gallery.findById(artwork._id)).reviews.length, 3);
    await first
      .post('/rRemove')
      .send({ ...body, reviewId: reviewA.reviewId })
      .expect(200);
    const remaining = (await Gallery.findById(artwork._id)).reviews;
    assert.deepEqual(
      remaining.map((review) => review.reviewId),
      [reviewB.reviewId, reviewC.reviewId],
    );
    assert.equal((await User.findById(patron._id)).reviews.length, 1);
    await first
      .post('/rsubmit')
      .send({ id: artwork.id, value: '  ' })
      .expect(400);
  });

  it('scopes legacy review deletion by artwork and author', async () => {
    const otherArtwork = await Gallery.create({
      ...artworkFields,
      name: 'Other artwork',
    });
    await Gallery.updateOne(
      { _id: artwork._id },
      {
        $push: {
          reviews: { user: 'Patron', userId: patron._id, review: 'Legacy' },
        },
      },
    );
    await Gallery.updateOne(
      { _id: artwork._id },
      {
        $push: {
          reviews: { user: 'Artist', userId: artist._id, review: 'Legacy' },
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
              { artId: otherArtwork._id, review: 'Legacy' },
            ],
          },
        },
      },
    );
    const agent = await login();
    await agent
      .post('/rRemove')
      .send({ id: artwork.id, value: 'Legacy' })
      .expect(200);
    assert.equal(
      (await Gallery.findById(artwork._id)).reviews[0].user,
      'Artist',
    );
    assert.equal(
      (await User.findById(patron._id)).reviews[0].artId.toString(),
      otherArtwork.id,
    );
  });

  it('follows artists once without copying their private account data', async () => {
    const agent = await login();
    await Promise.all(
      Array.from({ length: 3 }, () =>
        agent.post('/follow').send({ value: artist.id }).expect(200),
      ),
    );
    const following = (await User.findById(patron._id)).following;
    assert.equal(following.length, 1);
    assert.deepEqual(Object.keys(following[0]).sort(), [
      '_id',
      'aType',
      'username',
    ]);
    await agent.post('/follow').send({ value: patron.id }).expect(400);
    await agent.post('/unfollow').send({ value: 'Artist' }).expect(200);
    assert.equal((await User.findById(patron._id)).following.length, 0);
  });

  it('checks artist permissions using the saved account type', async () => {
    const agent = await login();
    await agent.get('/addArtwork').expect(403);
    await agent.get('/addWorkshop').expect(403);
    await agent.post('/addArt').send({}).expect(403);
    await agent.post('/addWorkshop').send({}).expect(403);
    await agent.post('/accType').send({ value: 'artist' }).expect(200);
    assert.equal((await User.findById(patron._id)).aType, 'artist');
    await agent.get('/addArtwork').expect(200);
  });

  it('uploads validated images and rejects invalid/oversized/duplicate uploads without leaving files', async () => {
    const agent = await login('Artist');
    const beforeCount = (await readdir(uploadDirectory)).length;
    await uploadArt(agent).expect(201);
    const uploaded = await Gallery.findOne({ name: 'Uploaded artwork' });
    assert.equal(uploaded.artist, 'Artist');
    assert.ok(uploaded.image.endsWith('.png'));
    await agent
      .get(uploaded.image)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('X-Content-Type-Options', 'nosniff');
    await uploadArt(agent).expect(409);
    await uploadArt(
      agent,
      Buffer.from('<script>alert(1)</script>'),
      'Fake image',
    ).expect(400);
    await uploadArt(
      agent,
      Buffer.alloc(5 * 1024 * 1024 + 1),
      'Oversized',
    ).expect(413);
    await agent
      .post('/addArt')
      .field('name', 'Incomplete')
      .attach('image', png, 'image.png')
      .expect(400);
    assert.equal((await readdir(uploadDirectory)).length, beforeCount + 1);
  });

  it('creates workshops with server-owned attendees and prevents duplicate signups', async () => {
    const creator = await login('Artist');
    const attendee = await login();
    const workshop = {
      name: 'Painting "basics"',
      goal: 'Learn painting',
      duration: '2',
      signed: [{ name: 'Fake' }],
      user: 'Fake',
    };
    await creator.post('/addWorkshop').send(workshop).expect(201);
    await creator.post('/addWorkshop').send(workshop).expect(409);
    await creator
      .post('/addWorkshop')
      .send({ ...workshop, name: 'Invalid', duration: '0' })
      .expect(400);
    await attendee
      .post('/signup')
      .send({ name: workshop.name, user: 'Artist' })
      .expect(200);
    await attendee
      .post('/signup')
      .send({ name: workshop.name, user: 'Artist' })
      .expect(200);
    const saved = (await User.findById(artist._id)).workshops[0];
    assert.equal(saved.user, 'Artist');
    assert.deepEqual(saved.signed, [{ name: 'Patron' }]);
    await attendee
      .post('/signup')
      .send({ name: 'Missing', user: 'Artist' })
      .expect(404);
    const page = await attendee.get(`/artist/${artist.id}`).expect(200);
    assert.ok(page.text.includes('You have already signed up'));
  });

  it('renders every page with shared artwork cards and existing static scripts', async () => {
    const agent = await login('Artist');
    for (const page of [
      '/',
      '/register',
      '/account',
      '/artwork',
      '/searchArt',
      `/artist/${artist.id}`,
      `/art/${artwork.id}`,
      '/addArtwork',
      '/addWorkshop',
    ]) {
      const response = await agent.get(page).expect(200);
      assert.ok(response.text.includes('name="viewport"'));
      for (const match of response.text.matchAll(/<script src="([^"]+)"/g)) {
        await agent.get(match[1]).expect(200);
      }
    }
    await User.deleteOne({ _id: artist._id });
    const patronAgent = await login();
    await patronAgent.get(`/art/${artwork.id}`).expect(200);
  });

  it('seeds missing demo data without resetting accounts, likes, or artwork', async () => {
    await User.create({
      username: 'khalifa',
      password: 'keep-me',
      workshops: [{ name: 'Existing' }],
    });
    await seedDatabase();
    const firstCounts = [
      await User.countDocuments(),
      await Gallery.countDocuments(),
    ];
    const seededArt = await Gallery.findOne({ artist: 'Midjourney' });
    await Gallery.updateOne(
      { _id: seededArt._id },
      { $set: { description: 'Preserved description' } },
    );
    await seedDatabase();
    assert.deepEqual(
      [await User.countDocuments(), await Gallery.countDocuments()],
      firstCounts,
    );
    const existingUser = await User.findOne({ username: 'khalifa' }).select(
      '+password',
    );
    assert.equal(existingUser.password, 'keep-me');
    assert.equal(existingUser.workshops.length, 1);
    assert.equal(
      (await Gallery.findById(seededArt._id)).description,
      'Preserved description',
    );
    const seededUser = await User.findOne({ username: 'Midjourney' }).select(
      '+password',
    );
    assert.ok(await verifyPassword('no', seededUser.password));
  });
});

it('validates production configuration and password hashes', async () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  assert.throws(() => readConfig({ PORT: 'not-a-port' }), /PORT/);
  const password = await hashPassword('secret');
  assert.ok(await verifyPassword('secret', password));
  assert.equal(await verifyPassword('wrong', password), false);
  assert.equal(await verifyPassword('secret', 'scrypt$invalid$hash'), false);
});
