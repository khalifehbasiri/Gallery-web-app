import assert from 'node:assert/strict';
import { before, after, beforeEach, it } from 'node:test';
import request from 'supertest';
import { createHash } from 'node:crypto';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { createApp } from '../server/src/app.js';
import { readConfig } from '../server/src/config.js';
import { demoData } from '../server/src/demo-data.js';
import {
  processNotifications,
  type Mail,
} from '../server/src/notifications.js';
import { processAccountDeletions } from '../server/src/account-lifecycle.js';
import { runMaintenance } from '../server/src/maintenance.js';
import { disabledCache } from '../server/src/cache.js';
import { tokenHash } from '../server/src/account-mail.js';
import type { Sql } from '../server/src/database.js';
const config = readConfig({
  JWT_SECRET: 'lifecycle-test-secret-with-at-least-32-characters',
  RESEND_API_KEY: 'fake',
  RESEND_FROM: 'mail@example.com',
  CLIENT_ORIGIN: 'https://gallery.example',
});
let sql: Sql,
  app: ReturnType<typeof createApp>,
  fails = false;
const documents = new LocalArtworkStore();
const removed: string[] = [];
let pending: Promise<void>[] = [];
const storage = {
  reserve: async () => '',
  inspect: async () => {},
  publish: async () => '',
  remove: async (path: string) => {
    if (fails) throw new Error('storage unavailable');
    removed.push(path);
  },
};
before(async () => {
  sql = await localDatabase();
});
after(async () => {
  await Promise.allSettled(pending);
  await sql.close();
});
beforeEach(async () => {
  await Promise.allSettled(pending);
  pending = [];
  fails = false;
  removed.length = 0;
  documents.documents.clear();
  await sql.query('TRUNCATE gallery.users CASCADE');
  await sql.query(
    'TRUNCATE gallery.email_budget,gallery.email_suppressions,gallery.email_verification_limits,gallery.email_webhooks',
  );
  await demoData(sql, documents);
  app = createApp({
    config,
    sql,
    artworks: documents,
    storage,
    rateLimitEnabled: false,
    defer: (work) => pending.push(work),
  });
});
function jar(res: request.Response) {
  return (res.headers['set-cookie'] as unknown as string[]).map(
    (c) => c.split(';')[0]!,
  );
}
function proof(cookies: string[]) {
  return decodeURIComponent(
    cookies.find((c) => c.startsWith('XSRF-TOKEN='))!.slice(11),
  );
}
async function anonymous() {
  const cookies = jar(await request(app).get('/api/auth/csrf'));
  return { cookies, proof: proof(cookies) };
}
const mutation = (
  path: string,
  auth: { cookies: string[]; proof: string },
  method: 'post' | 'patch' | 'delete' = 'post',
) =>
  request(app)
    [method](path)
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof);
async function register(email = 'new@example.com', notifications = false) {
  const auth = await anonymous();
  const res = await mutation('/api/auth/register', auth)
    .send({
      username: 'Private person',
      password: 'original-password',
      email,
      acceptedTerms: true,
      notifications,
    })
    .expect(201);
  return res.body.user.id as string;
}
async function login(
  username = 'Private person',
  password = 'original-password',
) {
  const anon = await anonymous();
  const cookies = jar(
    await mutation('/api/auth/login', anon)
      .send({ username, password })
      .expect(200),
  );
  return { cookies, proof: proof(cookies) };
}
async function mails() {
  const sent: Mail[] = [];
  await processNotifications(sql, config, {
    send: async (mail) => {
      sent.push(mail);
      return 'test-provider';
    },
  });
  return sent;
}
function token(mail: Mail) {
  return /#token=([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
}
async function verifiedAccount(notifications = false) {
  const id = await register('new@example.com', notifications);
  const mail = (await mails())[0]!;
  await mutation('/api/auth/verify-email', await anonymous())
    .send({ token: token(mail) })
    .expect(200);
  return id;
}
it('requires email and terms; normalizes private email; records consent separately from verification', async () => {
  const anon = await anonymous();
  await mutation('/api/auth/register', anon)
    .send({
      username: 'No email',
      password: 'original-password',
      acceptedTerms: true,
    })
    .expect(400);
  await mutation('/api/auth/register', anon)
    .send({
      username: 'No terms',
      password: 'original-password',
      email: 'a@example.com',
    })
    .expect(400);
  const id = await register('NEW@example.com');
  const u = (await sql.query('SELECT * FROM gallery.users WHERE id=$1', [id]))
    .rows[0]!;
  assert.equal(u['email'], 'new@example.com');
  assert.equal(u['terms_version'], '2026-10-04');
  assert.equal(u['email_verified_at'], null);
  const auth = await login();
  const me = await request(app).get('/api/auth/me').set('Cookie', auth.cookies);
  assert.equal(me.body.user.email, undefined);
  const mail = (await mails())[0]!;
  const secret = token(mail);
  const challenge = (
    await sql.query(
      'SELECT * FROM gallery.account_challenges WHERE user_id=$1',
      [id],
    )
  ).rows[0]!;
  assert.equal(challenge['token_hash'], tokenHash(secret));
  assert.ok(!JSON.stringify(challenge).includes(secret));
  await mutation('/api/auth/verify-email', anon)
    .send({ token: secret })
    .expect(200);
  await mutation('/api/auth/verify-email', anon)
    .send({ token: secret })
    .expect(400);
  assert.equal(
    (await request(app).get('/api/notifications').set('Cookie', auth.cookies))
      .body.enabled,
    false,
  );
});
it('honors opt-in, allows immediate disabling and re-enabling without another verification email', async () => {
  await verifiedAccount(true);
  const auth = await login();
  assert.equal(
    (await request(app).get('/api/notifications').set('Cookie', auth.cookies))
      .body.enabled,
    true,
  );
  await mutation('/api/notifications', auth, 'patch')
    .send({ enabled: false })
    .expect(200);
  assert.equal(
    (await request(app).get('/api/notifications').set('Cookie', auth.cookies))
      .body.enabled,
    false,
  );
  await mutation('/api/notifications', auth, 'patch')
    .send({ enabled: true })
    .expect(200);
  assert.equal(
    (await request(app).get('/api/notifications').set('Cookie', auth.cookies))
      .body.enabled,
    true,
  );
});
it('reset responses conceal account existence; tokens expire and are single-use; reset revokes every session', async () => {
  const id = await verifiedAccount();
  const auth = await login(),
    other = await login();
  const anon = await anonymous();
  const unknown = await mutation('/api/auth/forgot-password', anon)
    .send({ email: 'unknown@example.com' })
    .expect(202);
  const known = await mutation('/api/auth/forgot-password', anon)
    .send({ email: 'new@example.com' })
    .expect(202);
  assert.deepEqual(known.body, unknown.body);
  const secret = token((await mails())[0]!);
  await mutation('/api/auth/reset-password', anon)
    .send({ token: secret, password: 'replacement-password' })
    .expect(200);
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.sessions WHERE user_id=$1 AND revoked_at IS NULL',
        [id],
      )
    ).rows[0]!['n'],
    0,
  );
  await request(app)
    .get('/api/account')
    .set('Cookie', auth.cookies)
    .expect(401);
  await request(app)
    .get('/api/account')
    .set('Cookie', other.cookies)
    .expect(401);
  await mutation('/api/auth/refresh', auth).send({}).expect(401);
  await mutation('/api/auth/reset-password', anon)
    .send({ token: secret, password: 'replacement-password' })
    .expect(400);
  await mutation('/api/auth/login', anon)
    .send({ username: 'Private person', password: 'original-password' })
    .expect(401);
  await login('Private person', 'replacement-password');
  await mutation('/api/auth/forgot-password', anon)
    .send({ email: 'new@example.com' })
    .expect(202);
  const expired = token((await mails())[0]!);
  await sql.query(
    "UPDATE gallery.account_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash(expired)],
  );
  await mutation('/api/auth/reset-password', anon)
    .send({ token: expired, password: 'replacement-password' })
    .expect(400);
});
it('invalidates old recovery links after an email change and cannot reset unverified or demo accounts', async () => {
  await verifiedAccount();
  const auth = await login(),
    anon = await anonymous();
  await mutation('/api/auth/forgot-password', anon).send({
    email: 'new@example.com',
  });
  const secret = token((await mails())[0]!);
  await mutation('/api/account/email', auth)
    .send({ email: 'next@example.com', password: 'bad' })
    .expect(401);
  await mutation('/api/account/email', auth)
    .send({ email: 'next@example.com', password: 'original-password' })
    .expect(202);
  await mutation('/api/auth/reset-password', anon)
    .send({ token: secret, password: 'replacement-password' })
    .expect(400);
  await mutation('/api/auth/forgot-password', anon)
    .send({ email: 'next@example.com' })
    .expect(202);
  assert.equal(
    (
      await sql.query(
        "SELECT count(*)::int AS n FROM gallery.account_challenges WHERE kind='password-reset' AND used_at IS NULL",
      )
    ).rows[0]!['n'],
    0,
  );
  const demo = await login('demo', 'gallery-demo-2026');
  await mutation('/api/account/email', demo)
    .send({ email: 'demo@example.com', password: 'gallery-demo-2026' })
    .expect(403);
  await mutation('/api/account', demo, 'delete')
    .send({ password: 'gallery-demo-2026', confirmation: 'DELETE' })
    .expect(403);
});
it('exports full owned data without password hashes, reset tokens, refresh secrets or other account emails', async () => {
  await verifiedAccount();
  const auth = await login();
  await mutation('/api/account/export', auth)
    .send({ password: 'bad' })
    .expect(401);
  const res = await mutation('/api/account/export', auth)
    .send({ password: 'original-password' })
    .expect(200);
  assert.equal(res.body.account.email, 'new@example.com');
  assert.deepEqual(res.body.artworkDocuments, []);
  assert.ok(
    !/password_hash|token_hash|gallery_refresh|verification_hash|payload/.test(
      JSON.stringify(res.body),
    ),
  );
  assert.match(res.headers['content-disposition'], /attachment/);
});
it('retires an artist immediately, retries external cleanup, waits for upload capability expiry and erases SQL relations', async () => {
  const artist = (
    await sql.query(
      "SELECT id FROM gallery.users WHERE username='Maya Laurent'",
    )
  ).rows[0]!['id'];
  await sql.query(
    "UPDATE gallery.users SET username='Private artist' WHERE id=$1",
    [artist],
  );
  const auth = await login('Private artist', 'gallery-demo-2026');
  const art = String(
    (
      await sql.query('SELECT id FROM gallery.artworks WHERE artist_id=$1', [
        artist,
      ])
    ).rows[0]!['id'],
  );
  await sql.query(
    "INSERT INTO gallery.uploads(id,user_id,path,content_type,max_bytes,expires_at) VALUES('00000000-0000-4000-8000-000000000001',$1,'owned/path.png','image/png',8,now()+interval '15 minutes')",
    [artist],
  );
  fails = true;
  await mutation('/api/account', auth, 'delete')
    .send({ password: 'gallery-demo-2026', confirmation: 'DELETE' })
    .expect(202);
  await Promise.allSettled(pending);
  await request(app)
    .get('/api/account')
    .set('Cookie', auth.cookies)
    .expect(401);
  await request(app)
    .get('/api/artworks/' + art)
    .expect(404);
  assert.equal(
    (
      await sql.query(
        'SELECT email,password_hash FROM gallery.users WHERE id=$1',
        [artist],
      )
    ).rows[0]!['password_hash'],
    'scrypt$retired',
  );
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.account_deletions',
      )
    ).rows[0]!['n'],
    1,
  );
  fails = false;
  await processAccountDeletions(sql, documents, storage, disabledCache);
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.users WHERE id=$1',
        [artist],
      )
    ).rows[0]!['n'],
    1,
  );
  await sql.query(
    "UPDATE gallery.account_deletions SET not_before=now()-interval '1 second'",
  );
  await processAccountDeletions(sql, documents, storage, disabledCache);
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.users WHERE id=$1',
        [artist],
      )
    ).rows[0]!['n'],
    0,
  );
  assert.equal(await documents.get(art), null);
  assert.ok(removed.includes('owned/path.png'));
});
it('maintenance enforces challenge, mail, suppression and unused-upload retention', async () => {
  await verifiedAccount();
  await sql.query(
    "UPDATE gallery.account_challenges SET expires_at=now()-interval '1 day'",
  );
  await sql.query(
    "UPDATE gallery.notification_outbox SET status='dead',finished_at=now()-interval '31 days'",
  );
  await sql.query(
    "INSERT INTO gallery.email_suppressions(email,reason,created_at) VALUES('old@example.com','bounce',now()-interval '4 years')",
  );
  await runMaintenance(sql, documents, storage, disabledCache);
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.account_challenges',
      )
    ).rows[0]!['n'],
    0,
  );
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.notification_outbox',
      )
    ).rows[0]!['n'],
    0,
  );
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.email_suppressions',
      )
    ).rows[0]!['n'],
    0,
  );
});
it('allows only one concurrent reset and rejects CSRF-forged recovery mutations', async () => {
  await verifiedAccount();
  const anon = await anonymous();
  await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'new@example.com' })
    .expect(403);
  await mutation('/api/auth/forgot-password', anon)
    .send({ email: 'new@example.com' })
    .expect(202);
  const secret = token((await mails())[0]!);
  const results = await Promise.all([
    mutation('/api/auth/reset-password', anon).send({
      token: secret,
      password: 'first-new-password',
    }),
    mutation('/api/auth/reset-password', anon).send({
      token: secret,
      password: 'second-new-password',
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});
it('withdrawing signup consent before ownership verification does not silently re-enable notifications', async () => {
  await register('new@example.com', true);
  const auth = await login();
  const secret = token((await mails())[0]!);
  await mutation('/api/notifications', auth, 'patch')
    .send({ enabled: false })
    .expect(200);
  await mutation('/api/auth/verify-email', await anonymous())
    .send({ token: secret })
    .expect(200);
  assert.equal(
    (await request(app).get('/api/notifications').set('Cookie', auth.cookies))
      .body.enabled,
    false,
  );
});
it('includes full owned MongoDB artwork content in an export, not only the search preview', async () => {
  const row = (
    await sql.query(
      "SELECT id FROM gallery.users WHERE username='Maya Laurent'",
    )
  ).rows[0]!;
  await sql.query(
    "UPDATE gallery.users SET username='Private artist' WHERE id=$1",
    [row['id']],
  );
  const art = (
    await sql.query(
      'SELECT id FROM gallery.artworks WHERE artist_id=$1 LIMIT 1',
      [row['id']],
    )
  ).rows[0]!;
  const doc = (await documents.get(String(art['id'])))!;
  doc.description = 'Full private artwork story. '.repeat(30);
  documents.documents.set(doc.id, doc);
  const auth = await login('Private artist', 'gallery-demo-2026');
  const res = await mutation('/api/account/export', auth)
    .send({ password: 'gallery-demo-2026' })
    .expect(200);
  assert.equal(
    res.body.artworkDocuments.find((d: { id: string }) => d.id === doc.id)
      .description,
    doc.description,
  );
});
it('retention preserves unused images until their signed upload capabilities expire', async () => {
  const id = await verifiedAccount();
  for (const [uuid, path, age] of [
    ['00000000-0000-4000-8000-000000000002', 'recent.png', '1 minute'],
    ['00000000-0000-4000-8000-000000000003', 'expired.png', '3 hours'],
  ])
    await sql.query(
      `INSERT INTO gallery.uploads(id,user_id,path,content_type,max_bytes,expires_at) VALUES($1,$2,$3,'image/png',8,now()-$4::interval)`,
      [uuid, id, path, age],
    );
  await runMaintenance(sql, documents, storage, disabledCache);
  assert.ok(removed.includes('expired.png'));
  assert.ok(!removed.includes('recent.png'));
});
it('keeps recovery digests inaccessible to the notification processor and retired users unable to publish', async () => {
  const id = await verifiedAccount();
  await assert.rejects(
    sql.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE gallery_mail_worker');
      await tx.query('SELECT token_hash FROM gallery.account_challenges');
    }),
    /permission denied/,
  );
  await sql.query(
    'UPDATE gallery.users SET deletion_requested_at=now() WHERE id=$1',
    [id],
  );
  await assert.rejects(
    sql.query(
      "INSERT INTO gallery.workshops(id,artist_id,name,goal,weeks) VALUES('retired-workshop',$1,'Invalid','Invalid',1)",
      [id],
    ),
    /Account is unavailable/,
  );
});
