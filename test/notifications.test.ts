import assert from 'node:assert/strict';
import { before, after, beforeEach, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Webhook } from 'svix';
import {
  localDatabase,
  LocalArtworkStore,
} from '../server/src/local-database.js';
import { createApp } from '../server/src/app.js';
import { readConfig } from '../server/src/config.js';
import { demoData } from '../server/src/demo-data.js';
import {
  enqueueLike,
  processNotifications,
  MailFailure,
  mailTemplate,
  emailEnabled,
  type Mail,
} from '../server/src/notifications.js';
import type { Sql } from '../server/src/database.js';
import { newId } from '../server/src/domain.js';
const config = readConfig({
  JWT_SECRET: 'test-secret-with-at-least-32-characters',
  RESEND_API_KEY: 'fake-provider-key',
  RESEND_FROM: 'Atelier <mail@example.com>',
  RESEND_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 1).toString('base64')}`,
  CLIENT_ORIGIN: 'https://gallery.example',
});
let sql: Sql, actor: string, recipient: string, art: Record<string, unknown>;
const store = new LocalArtworkStore();
const storage = {
  reserve: async () => '',
  inspect: async () => {},
  publish: async () => '',
  remove: async () => {},
};
const app = () =>
  createApp({ config, sql, artworks: store, storage, rateLimitEnabled: false });
before(async () => {
  sql = await localDatabase();
});
after(async () => {
  await sql.close();
});
beforeEach(async () => {
  await sql.query('TRUNCATE gallery.users CASCADE');
  await sql.query(
    'TRUNCATE gallery.email_budget,gallery.email_suppressions,gallery.email_webhooks,gallery.email_verification_limits',
  );
  store.documents.clear();
  await demoData(sql, store);
  recipient = String(
    (await sql.query("SELECT id FROM gallery.users WHERE role='artist'"))
      .rows[0]!['id'],
  );
  actor = String(
    (await sql.query("SELECT id FROM gallery.users WHERE role='patron'"))
      .rows[0]!['id'],
  );
  await sql.query(
    "UPDATE gallery.users SET username=CASE WHEN role='artist' THEN 'Private artist' ELSE 'Private patron' END",
  );
  await sql.query(
    "INSERT INTO gallery.notification_preferences(user_id,email,version,enabled,verified_at) VALUES($1,'artist@example.com',$2,true,now())",
    [recipient, randomUUID()],
  );
  art = (await sql.query('SELECT * FROM gallery.artworks LIMIT 1')).rows[0]!;
});
async function login(username = 'Private patron') {
  const server = app(),
    anon = await request(server).get('/api/auth/csrf');
  const jar = (anon.headers['set-cookie'] as unknown as string[]).map(
    (c) => c.split(';')[0]!,
  );
  const proof = decodeURIComponent(
    jar.find((c) => c.startsWith('XSRF-TOKEN='))!.slice(11),
  );
  const result = await request(server)
    .post('/api/auth/login')
    .set('Cookie', jar)
    .set('X-XSRF-TOKEN', proof)
    .send({ username, password: 'gallery-demo-2026' })
    .expect(200);
  const cookies = (result.headers['set-cookie'] as unknown as string[]).map(
    (c) => c.split(';')[0]!,
  );
  return {
    server,
    cookies,
    proof: decodeURIComponent(
      cookies.find((c) => c.startsWith('XSRF-TOKEN='))!.slice(11),
    ),
  };
}
async function queue() {
  return sql.transaction((tx) =>
    enqueueLike(tx, config, actor, 'Private patron', art),
  );
}
it('commits a like and its outbox intent atomically; duplicate likes do not generate more mail', async () => {
  const auth = await login();
  for (let i = 0; i < 2; i++)
    await request(auth.server)
      .put(`/api/artworks/${art['id']}/like`)
      .set('Cookie', auth.cookies)
      .set('X-XSRF-TOKEN', auth.proof)
      .expect(200);
  assert.equal(
    (await sql.query('SELECT count(*)::int AS n FROM gallery.likes')).rows[0]![
      'n'
    ],
    1,
  );
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM gallery.notification_outbox',
      )
    ).rows[0]!['n'],
    1,
  );
  const tx: Sql = {
    ...sql,
    transaction: (work) =>
      sql.transaction((real) =>
        work({
          ...real,
          query: async <T>(text: string, values?: unknown[]) => {
            if (text.startsWith('INSERT INTO gallery.notification_outbox'))
              throw new Error('Outbox failed');
            return real.query<T>(text, values);
          },
        }),
      ),
  };
  await sql.query('DELETE FROM gallery.likes');
  await sql.query('UPDATE gallery.artworks SET like_count=0');
  await sql.query('DELETE FROM gallery.notification_outbox');
  const failing = createApp({
    config,
    sql: tx,
    artworks: store,
    storage,
    rateLimitEnabled: false,
  });
  await request(failing)
    .put(`/api/artworks/${art['id']}/like`)
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof)
    .expect(500);
  assert.equal(
    (await sql.query('SELECT count(*)::int AS n FROM gallery.likes')).rows[0]![
      'n'
    ],
    0,
  );
  assert.equal(
    (
      await sql.query('SELECT like_count FROM gallery.artworks WHERE id=$1', [
        art['id'],
      ])
    ).rows[0]!['like_count'],
    0,
  );
});
it('leases jobs once, recovers expired leases, freezes payloads and retries with the same provider key', async () => {
  const [id] = await queue();
  const messages: Mail[] = [],
    ids: string[] = [];
  const sender = {
    send: async (mail: Mail, key: string) => {
      messages.push(mail);
      ids.push(key);
      if (messages.length === 1) throw new Error('timeout');
      return 'provider-id';
    },
  };
  assert.equal(
    (await processNotifications(sql, config, sender, undefined, 1)).retried,
    1,
  );
  await sql.query(
    "UPDATE gallery.notification_outbox SET status='processing',lease_until=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await sql.query(
    "UPDATE gallery.users SET username='<script>changed</script>' WHERE id=$1",
    [actor],
  );
  const result = await Promise.all([
    processNotifications(sql, config, sender, undefined, 1),
    processNotifications(sql, config, sender, undefined, 1),
  ]);
  assert.equal(
    result.reduce((sum, r) => sum + r.sent, 0),
    1,
  );
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], messages[1]);
  assert.deepEqual(ids, [id, id]);
  assert.equal(
    (
      await sql.query(
        'SELECT status FROM gallery.notification_outbox WHERE id=$1',
        [id],
      )
    ).rows[0]!['status'],
    'done',
  );
});
it('cancels unsubscribed or changed-address jobs and suppresses self-likes and shared demo accounts', async () => {
  assert.deepEqual(
    await enqueueLike(sql, config, recipient, 'Private artist', art),
    [],
  );
  assert.deepEqual(await enqueueLike(sql, config, actor, 'demo', art), []);
  await queue();
  await sql.query('UPDATE gallery.notification_preferences SET enabled=false');
  const result = await processNotifications(sql, config, {
    send: async () => {
      throw new Error('must not send');
    },
  });
  assert.equal(result.cancelled, 1);
  await sql.query('DELETE FROM gallery.notification_outbox');
  await sql.query('UPDATE gallery.notification_preferences SET enabled=true');
  await queue();
  await sql.query('UPDATE gallery.notification_preferences SET version=$1', [
    randomUUID(),
  ]);
  assert.equal(
    (
      await processNotifications(sql, config, {
        send: async () => {
          throw new Error('must not send');
        },
      })
    ).cancelled,
    1,
  );
});
it('dead-letters permanent errors and uncertain sends outside the idempotency window; enforces daily budget', async () => {
  await queue();
  assert.equal(
    (
      await processNotifications(sql, config, {
        send: async () => {
          throw new MailFailure(true);
        },
      })
    ).dead,
    1,
  );
  await sql.query(
    "UPDATE gallery.notification_outbox SET status='pending',available_at=now(),first_attempt_at=now()-interval '24 hours'",
  );
  assert.equal(
    (
      await processNotifications(sql, config, {
        send: async () => {
          throw new Error('must not send');
        },
      })
    ).dead,
    1,
  );
  await sql.query(
    "UPDATE gallery.notification_outbox SET status='pending',first_attempt_at=NULL",
  );
  await sql.query(
    'INSERT INTO gallery.email_budget(period,attempts) VALUES($1,90) ON CONFLICT(period) DO UPDATE SET attempts=90',
    [`day:${new Date().toISOString().slice(0, 10)}`],
  );
  assert.equal(
    (
      await processNotifications(sql, config, {
        send: async () => {
          throw new Error('must not send');
        },
      })
    ).retried,
    1,
  );
});
it('requires consent, verifies email ownership, limits code guesses, and blocks personal email on public demos', async () => {
  const auth = await login();
  const send = (body: unknown) =>
    request(auth.server)
      .post('/api/notifications/email')
      .set('Cookie', auth.cookies)
      .set('X-XSRF-TOKEN', auth.proof)
      .send(body);
  await send({ email: 'patron@example.com', consent: false }).expect(400);
  await send({ email: 'patron@example.com', consent: true }).expect(202);
  await send({ email: 'patron@example.com', consent: true }).expect(429);
  const mails: Mail[] = [];
  await processNotifications(sql, config, {
    send: async (mail) => {
      mails.push(mail);
      return 'verify-id';
    },
  });
  const code = mails[0]!.text.match(/\b\d{6}\b/)![0];
  const outbox = (
    await sql.query('SELECT payload FROM gallery.notification_outbox')
  ).rows[0]!;
  assert.ok(!String(outbox['payload']).includes(code));
  assert.ok(!String(outbox['payload']).includes('patron@example.com'));
  await request(auth.server)
    .post('/api/notifications/verify')
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof)
    .send({ code })
    .expect(200);
  await request(auth.server)
    .post('/api/notifications/verify')
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof)
    .send({ code })
    .expect(400);
  await sql.query("UPDATE gallery.users SET username='demo' WHERE id=$1", [
    actor,
  ]);
  const demo = await login('demo');
  await request(demo.server)
    .post('/api/notifications/email')
    .set('Cookie', demo.cookies)
    .set('X-XSRF-TOKEN', demo.proof)
    .send({ email: 'someone@example.com', consent: true })
    .expect(403);
});
it('allows three verification requests per recipient across accounts, preventing signup email spam', async () => {
  for (let index = 0; index < 4; index++) {
    await sql.query(
      'INSERT INTO gallery.users(id,username,password_hash,role) SELECT $1,$2,password_hash,role FROM gallery.users WHERE id=$3',
      [newId(), `Account ${index}`, actor],
    );
    const auth = await login(`Account ${index}`);
    await request(auth.server)
      .post('/api/notifications/email')
      .set('Cookie', auth.cookies)
      .set('X-XSRF-TOKEN', auth.proof)
      .send({ email: 'same@example.com', consent: true })
      .expect(index < 3 ? 202 : 429);
  }
});
it('expires verification codes and locks the challenge after five wrong guesses', async () => {
  const auth = await login();
  await request(auth.server)
    .post('/api/notifications/email')
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof)
    .send({ email: 'guess@example.com', consent: true })
    .expect(202);
  let code = '';
  await processNotifications(sql, config, {
    send: async (mail) => {
      code = mail.text.match(/\b\d{6}\b/)![0];
      return 'code-id';
    },
  });
  for (let i = 0; i < 5; i++)
    await request(auth.server)
      .post('/api/notifications/verify')
      .set('Cookie', auth.cookies)
      .set('X-XSRF-TOKEN', auth.proof)
      .send({ code: '000000' })
      .expect(400);
  await request(auth.server)
    .post('/api/notifications/verify')
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof)
    .send({ code })
    .expect(400);
  await sql.query(
    "UPDATE gallery.notification_preferences SET verification_attempts=0,verification_expires_at=now()-interval '1 second' WHERE user_id=$1",
    [actor],
  );
  await request(auth.server)
    .post('/api/notifications/verify')
    .set('Cookie', auth.cookies)
    .set('X-XSRF-TOKEN', auth.proof)
    .send({ code })
    .expect(400);
});
it('verifies raw webhook signatures, deduplicates callbacks, and applies bounce suppression before sending', async () => {
  await queue();
  const body = JSON.stringify({
      type: 'email.bounced',
      data: { to: ['artist@example.com'] },
    }),
    id = 'msg_test',
    timestamp = new Date();
  const signature = new Webhook(config.resendWebhookSecret!).sign(
    id,
    timestamp,
    body,
  );
  const callback = (payload: string) =>
    request(app())
      .post('/api/notifications/webhook')
      .set('Content-Type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', String(Math.floor(timestamp.getTime() / 1000)))
      .set('svix-signature', signature)
      .send(payload);
  await callback(body + ' ').expect(400);
  await callback(body).expect(204);
  await callback(body).expect(204);
  assert.equal(
    (await sql.query('SELECT count(*)::int AS n FROM gallery.email_webhooks'))
      .rows[0]!['n'],
    1,
  );
  assert.equal(
    (
      await processNotifications(sql, config, {
        send: async () => {
          throw new Error('must not send');
        },
      })
    ).cancelled,
    1,
  );
});
it('offers signed one-click opt-out, while GET links do not change preferences; escapes email HTML', async () => {
  await queue();
  let mail: Mail | undefined;
  await processNotifications(sql, config, {
    send: async (message) => {
      mail = message;
      return 'mail-id';
    },
  });
  const url = new URL(mail!.headers!['List-Unsubscribe']!.slice(1, -1));
  await request(app())
    .get(url.pathname + url.search)
    .expect(200);
  assert.equal(
    (await sql.query('SELECT enabled FROM gallery.notification_preferences'))
      .rows[0]!['enabled'],
    true,
  );
  await request(app())
    .post(url.pathname + url.search)
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send('List-Unsubscribe=One-Click')
    .expect(200);
  assert.equal(
    (await sql.query('SELECT enabled FROM gallery.notification_preferences'))
      .rows[0]!['enabled'],
    false,
  );
  await request(app())
    .post('/api/notifications/unsubscribe?token=forged')
    .expect(400);
  const html = mailTemplate(
    '<script>',
    '<img onerror=alert(1)>',
    'https://example.com',
    'Open account',
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
});
it('protects the daily recovery endpoint and wakes the processor only for real due work', async () => {
  let ids: string[] = [];
  const server = createApp({
    config: { ...config, cronSecret: 'cron-test-secret' },
    sql,
    artworks: store,
    storage,
    rateLimitEnabled: false,
    notifications: {
      close: () => {},
      kick: async (jobs) => {
        ids = jobs;
      },
    },
  });
  await request(server).get('/api/internal/notifications').expect(401);
  await request(server)
    .get('/api/internal/notifications')
    .set('Authorization', 'Bearer cron-test-secret')
    .expect(200);
  assert.deepEqual(ids, []);
  const pending = await queue();
  await request(server)
    .get('/api/internal/notifications')
    .set('Authorization', 'Bearer cron-test-secret')
    .expect(200);
  assert.deepEqual(ids, pending);
});
it('keeps production delivery disabled without a verified public configuration or restricted owner test', () => {
  assert.equal(emailEnabled({ ...config, production: true }), false);
  assert.equal(
    emailEnabled({ ...config, production: true, resendPublicSending: true }),
    false,
  );
  assert.equal(
    emailEnabled({
      ...config,
      production: true,
      resendPublicSending: true,
      notificationEncryptionKey: 'mail-key-with-at-least-32-random-characters',
    }),
    true,
  );
});
it('stops claiming new jobs during graceful shutdown', async () => {
  await queue();
  const result = await processNotifications(
    sql,
    config,
    {
      send: async () => {
        throw new Error('must not send');
      },
    },
    undefined,
    5,
    () => true,
  );
  assert.equal(result.sent, 0);
  assert.equal(
    (await sql.query('SELECT status FROM gallery.notification_outbox'))
      .rows[0]!['status'],
    'pending',
  );
});
