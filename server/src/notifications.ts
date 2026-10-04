import { Router, raw } from 'express';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Webhook } from 'svix';
import type { Config } from './config.js';
import type { Sql } from './database.js';
import { requireAuth } from './auth.js';
import { HttpError, textField } from './http.js';
import { publicDemoNames } from './public-demo.js';
import { redisConnection, redisScope } from './redis-connection.js';
import type { RedisConnection } from './cache.js';

export interface Mail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}
export interface MailSender {
  send(mail: Mail, id: string): Promise<string>;
}
export function emailEnabled(config: Config) {
  return Boolean(
    config.resendKey &&
    config.resendFrom &&
    (!config.production ||
      config.resendTestRecipient ||
      (config.resendPublicSending && config.resendWebhookSecret)) &&
    (!config.production ||
      (config.notificationEncryptionKey?.length || 0) >= 32),
  );
}
export class MailFailure extends Error {
  constructor(readonly permanent: boolean) {
    super('Email provider request failed.');
  }
}
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const key = (config: Config) =>
  createHash('sha256')
    .update(
      `gallery-mail:${config.notificationEncryptionKey || config.jwtSecret}`,
    )
    .digest();
export function sealMail(config: Config, mail: Mail) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(config), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(mail), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
function openMail(config: Config, payload: string): Mail {
  const bytes = Buffer.from(payload, 'base64url'),
    decipher = createDecipheriv(
      'aes-256-gcm',
      key(config),
      bytes.subarray(0, 12),
    );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString(),
  ) as Mail;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function mailTemplate(
  title: string,
  body: string,
  url: string,
  label: string,
) {
  return `<!doctype html><html lang="en" dir="ltr"><head><title>${escape(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#fff;color:#222;font:16px/1.6 Arial,sans-serif"><main lang="en" dir="ltr" style="max-width:560px;margin:auto;padding:24px"><h1>${escape(title)}</h1><p>${escape(body)}</p><p><a style="color:#0645ad;display:inline-block;padding:12px" href="${escape(url)}">${escape(label)}</a></p><p>Atelier Gallery · You requested these account notifications.</p></main></body></html>`;
}
export function resendSender(config: Config): MailSender {
  return {
    async send(mail, id) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `gallery/${id}`,
        },
        body: JSON.stringify(mail),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok)
        throw new MailFailure(
          response.status >= 400 &&
            response.status < 500 &&
            ![409, 429].includes(response.status),
        );
      const result = (await response.json()) as { id?: string };
      if (!result.id) throw new MailFailure(false);
      return result.id;
    },
  };
}
export interface NotificationDispatch {
  kick(ids: string[]): Promise<void>;
  close(): void;
}
export class RedisNotificationQueue {
  readonly queueKey: string;
  constructor(
    private redis: RedisConnection | null,
    config: Config,
  ) {
    this.queueKey = `${config.redisKeyPrefix}:${redisScope(config)}:mail-queue:v1`;
  }
  async add(ids: string[]) {
    if (!this.redis || !ids.length) return;
    const bounded = ids.slice(0, 100);
    await this.redis.eval(
      "for i=2,#ARGV do redis.call('ZADD',KEYS[1],ARGV[1],ARGV[i]) end return 1",
      { keys: [this.queueKey], arguments: [String(Date.now()), ...bounded] },
    );
  }
  async take(): Promise<string[]> {
    if (!this.redis) return [];
    return (await this.redis.eval(
      "local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[1],'LIMIT',0,20) for _,id in ipairs(ids) do redis.call('ZREM',KEYS[1],id) end return ids",
      { keys: [this.queueKey], arguments: [String(Date.now())] },
    )) as string[];
  }
}
export async function notificationDispatch(
  config: Config,
): Promise<NotificationDispatch> {
  if (!emailEnabled(config)) return disabledDispatch;
  const redis = redisConnection(config);
  redis?.on('error', () => {});
  try {
    await redis?.connect();
  } catch {
    /* SQL remains authoritative. */
  }
  const queue = new RedisNotificationQueue(redis, config);
  return {
    async kick(ids) {
      if (!ids.length) return;
      try {
        await queue.add(ids);
      } catch {
        /* Worker discovers SQL outbox even if queue hints are lost. */
      }
      if (config.notificationWorkerUrl && config.notificationWorkerSecret) {
        try {
          await fetch(new URL('/jobs/process', config.notificationWorkerUrl), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.notificationWorkerSecret}`,
            },
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          /* Cold-start delivery is retried by the awakened worker/operator. */
        }
      }
    },
    close() {
      redis?.destroy();
    },
  };
}
export const disabledDispatch: NotificationDispatch = {
  kick: async () => {},
  close: () => {},
};
function unsubscribeToken(config: Config, user: string, version: string) {
  const data = Buffer.from(JSON.stringify([user, version])).toString(
    'base64url',
  );
  return `${data}.${createHmac('sha256', config.jwtSecret).update(`unsubscribe:${data}`).digest('base64url')}`;
}
function readUnsubscribe(config: Config, token: unknown): string[] {
  if (typeof token !== 'string' || token.length > 300)
    throw new HttpError(400, 'Invalid unsubscribe link.');
  const [data, sig] = token.split('.');
  const expected = createHmac('sha256', config.jwtSecret)
    .update(`unsubscribe:${data}`)
    .digest();
  const actual = Buffer.from(sig || '', 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new HttpError(400, 'Invalid unsubscribe link.');
  const result: unknown = JSON.parse(
    Buffer.from(data!, 'base64url').toString(),
  );
  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    !result.every((v) => typeof v === 'string')
  )
    throw new HttpError(400, 'Invalid unsubscribe link.');
  return result as string[];
}
export async function enqueueLike(
  sql: Sql,
  config: Config,
  actorId: string,
  actorName: string,
  art: Record<string, unknown>,
): Promise<string[]> {
  if (
    !emailEnabled(config) ||
    publicDemoNames.has(actorName) ||
    actorId === art['artist_id']
  )
    return [];
  const preference = (
    await sql.query(
      `SELECT p.*,u.username FROM gallery.notification_preferences p JOIN gallery.users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.enabled AND p.verified_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gallery.email_suppressions s WHERE s.email=p.email) FOR UPDATE OF p`,
      [art['artist_id']],
    )
  ).rows[0];
  if (!preference || publicDemoNames.has(String(preference['username'])))
    return [];
  if (
    config.resendTestRecipient &&
    preference['email'] !== config.resendTestRecipient
  )
    return [];
  const user = String(preference['user_id']),
    version = String(preference['version']),
    token = unsubscribeToken(config, user, version);
  const unsubscribe = `${config.clientOrigin}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
  const url = `${config.clientOrigin}/artworks/${art['id']}`,
    title = 'Your artwork received a new appreciation';
  const body = `${actorName} appreciated “${art['title']}”. You can turn these notifications off at any time. Notices are limited to one per hour.`;
  const mail: Mail = {
    from: config.resendFrom!,
    to: [String(preference['email'])],
    subject: title,
    text: `${body}\nView artwork: ${url}\nTurn off notifications: ${unsubscribe}`,
    html: mailTemplate(title, body, url, 'View your artwork').replace(
      '</main>',
      `<p><a href="${escape(unsubscribe)}">Turn off appreciation emails</a></p></main>`,
    ),
    headers: {
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
  const id = randomUUID();
  const result = await sql.query(
    `INSERT INTO gallery.notification_outbox(id,user_id,preference_version,kind,dedupe_key,payload) SELECT $1,$2,$3,'like',$4,$5 WHERE NOT EXISTS(SELECT 1 FROM gallery.notification_outbox WHERE user_id=$2 AND kind='like' AND created_at>now()-interval '1 hour') ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
    [
      id,
      user,
      version,
      `like:${actorId}:${art['id']}:${new Date().toISOString().slice(0, 10)}`,
      sealMail(config, mail),
    ],
  );
  return result.rows.map((r) => String(r['id']));
}
export function notificationRoutes(
  sql: Sql,
  config: Config,
  dispatch: NotificationDispatch,
  defer: (work: Promise<void>) => void,
) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    const preference = (
      await sql.query(
        'SELECT email,enabled,verified_at FROM gallery.notification_preferences WHERE user_id=$1',
        [req.user!.id],
      )
    ).rows[0];
    res.json({
      available: emailEnabled(config),
      publicDemo: publicDemoNames.has(req.user!.username),
      email: preference?.['email'] || '',
      enabled: Boolean(preference?.['enabled']),
      verified: Boolean(preference?.['verified_at']),
    });
  });
  router.post('/email', async (req, res) => {
    if (publicDemoNames.has(req.user!.username))
      throw new HttpError(
        403,
        'Create your own account to add a personal email.',
      );
    if (!emailEnabled(config))
      throw new HttpError(503, 'Email delivery is not configured yet.');
    const email = textField(req.body, 'email', 254).toLowerCase();
    const accountEmail = (
      await sql.query('SELECT email FROM gallery.users WHERE id=$1', [
        req.user!.id,
      ])
    ).rows[0]?.['email'];
    if (accountEmail && accountEmail !== email)
      throw new HttpError(
        400,
        'Use your account email. Change it in account email settings first.',
      );
    if (config.resendTestRecipient && email !== config.resendTestRecipient)
      throw new HttpError(
        400,
        'Test delivery is restricted to the Resend account owner. Public email requires a verified sending domain.',
      );
    if (
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
        email,
      )
    )
      throw new HttpError(400, 'Enter a valid email address.');
    if (req.body?.consent !== true)
      throw new HttpError(
        400,
        'Consent is required to send appreciation emails.',
      );
    const code = String(randomInt(100000, 1000000)),
      version = randomUUID(),
      id = randomUUID();
    const ids = await sql.transaction(async (tx) => {
      await tx.query('SELECT id FROM gallery.users WHERE id=$1 FOR UPDATE', [
        req.user!.id,
      ]);
      const limit = (
        await tx.query(
          `SELECT (SELECT count(*)::int FROM gallery.notification_outbox WHERE user_id=$1 AND kind='verify' AND created_at>now()-interval '1 hour') AS total,(SELECT requested_at>now()-interval '60 seconds' FROM gallery.notification_preferences WHERE user_id=$1) AS cooldown`,
          [req.user!.id],
        )
      ).rows[0]!;
      if (Number(limit['total']) >= 3 || limit['cooldown'])
        throw new HttpError(
          429,
          'Wait before requesting another verification email (maximum three per hour).',
        );
      if (
        (
          await tx.query(
            'SELECT 1 FROM gallery.email_suppressions WHERE email=$1',
            [email],
          )
        ).rows.length
      )
        throw new HttpError(400, 'This address cannot receive notifications.');
      // Atomic per-address limit survives email changes and concurrent accounts; no plaintext address in the key.
      const perAddress = await tx.query(
        `INSERT INTO gallery.email_verification_limits(address_hash) VALUES($1) ON CONFLICT(address_hash) DO UPDATE SET attempts=CASE WHEN gallery.email_verification_limits.window_started<now()-interval '1 hour' THEN 1 ELSE gallery.email_verification_limits.attempts+1 END,window_started=CASE WHEN gallery.email_verification_limits.window_started<now()-interval '1 hour' THEN now() ELSE gallery.email_verification_limits.window_started END WHERE gallery.email_verification_limits.attempts<3 OR gallery.email_verification_limits.window_started<now()-interval '1 hour' RETURNING address_hash`,
        [createHmac('sha256', config.jwtSecret).update(email).digest('hex')],
      );
      if (!perAddress.rows.length)
        throw new HttpError(
          429,
          'This address has reached its verification limit.',
        );
      await tx.query(
        `INSERT INTO gallery.notification_preferences(user_id,email,version,verification_hash,verification_expires_at,consent_at,consent_version) VALUES($1,$2,$3,$4,now()+interval '30 minutes',now(),'2026-10-04') ON CONFLICT(user_id) DO UPDATE SET email=$2,version=$3,enabled=false,verified_at=NULL,verification_hash=$4,verification_expires_at=now()+interval '30 minutes',verification_attempts=0,requested_at=now(),consent_at=now(),consent_version='2026-10-04'`,
        [
          req.user!.id,
          email,
          version,
          hash(`${config.jwtSecret}:${version}:${code}`),
        ],
      );
      const title = 'Verify your Atelier notification email',
        body = `Your verification code is ${code}. It expires in 30 minutes. Enter it in your account settings while signed in. If you did not request this, ignore this message.`;
      const mail: Mail = {
        from: config.resendFrom!,
        to: [email],
        subject: title,
        text: body,
        html: mailTemplate(
          title,
          body,
          `${config.clientOrigin}/account`,
          'Open account settings',
        ),
      };
      await tx.query(
        `INSERT INTO gallery.notification_outbox(id,user_id,preference_version,kind,dedupe_key,payload) VALUES($1,$2,$3,'verify',$4,$5)`,
        [
          id,
          req.user!.id,
          version,
          `verify:${version}`,
          sealMail(config, mail),
        ],
      );
      return [id];
    });
    defer(dispatch.kick(ids));
    res.status(202).json({
      message:
        'Verification email queued. Delivery may be delayed while the free worker wakes.',
    });
  });
  router.post('/verify', async (req, res) => {
    const code = textField(req.body, 'code', 6);
    const valid = await sql.transaction(async (tx) => {
      const row = (
        await tx.query(
          'SELECT * FROM gallery.notification_preferences WHERE user_id=$1 FOR UPDATE',
          [req.user!.id],
        )
      ).rows[0];
      if (
        !row ||
        !row['verification_hash'] ||
        new Date(String(row['verification_expires_at'])).getTime() <=
          Date.now() ||
        Number(row['verification_attempts']) >= 5
      )
        return false;
      await tx.query(
        'UPDATE gallery.notification_preferences SET verification_attempts=verification_attempts+1 WHERE user_id=$1',
        [req.user!.id],
      );
      if (
        hash(`${config.jwtSecret}:${row['version']}:${code}`) !==
        row['verification_hash']
      )
        return false;
      await tx.query(
        'UPDATE gallery.notification_preferences SET verified_at=now(),enabled=true,verification_hash=NULL WHERE user_id=$1',
        [req.user!.id],
      );
      return true;
    });
    if (!valid)
      throw new HttpError(400, 'Verification code is invalid or expired.');
    res.json({ verified: true, enabled: true });
  });
  router.delete('/', async (req, res) => {
    await sql.query(
      'UPDATE gallery.notification_preferences SET enabled=false,consent_at=NULL,consent_version=NULL,verification_hash=NULL WHERE user_id=$1',
      [req.user!.id],
    );
    res.sendStatus(204);
  });
  router.patch('/', async (req, res) => {
    if (publicDemoNames.has(req.user!.username))
      throw new HttpError(
        403,
        'Shared demo accounts cannot enable email notifications.',
      );
    if (typeof req.body?.enabled !== 'boolean')
      throw new HttpError(400, 'Choose whether notifications are enabled.');
    if (!req.body.enabled) {
      await sql.query(
        'UPDATE gallery.notification_preferences SET enabled=false,consent_at=NULL,consent_version=NULL,verification_hash=NULL WHERE user_id=$1',
        [req.user!.id],
      );
    } else {
      const updated = await sql.query(
        `UPDATE gallery.notification_preferences p SET enabled=true,consent_at=now(),consent_version='2026-10-04' FROM gallery.users u WHERE p.user_id=$1 AND u.id=p.user_id AND u.email=p.email AND u.email_verified_at IS NOT NULL AND p.verified_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gallery.email_suppressions s WHERE s.email=p.email) RETURNING p.user_id`,
        [req.user!.id],
      );
      if (!updated.rows.length)
        throw new HttpError(
          400,
          'Verify your account email before enabling notifications.',
        );
    }
    res.json({ enabled: req.body.enabled });
  });
  return router;
}
// These authenticated external callbacks are mounted before JSON parsing / browser CSRF checks.
export function notificationCallbacks(sql: Sql, config: Config) {
  const router = Router();
  const unsubscribe = async (token: unknown) => {
    const [user, version] = readUnsubscribe(config, token);
    await sql.query(
      'UPDATE gallery.notification_preferences SET enabled=false,consent_at=NULL,consent_version=NULL,verification_hash=NULL WHERE user_id=$1 AND version=$2::uuid',
      [user, version],
    );
  };
  router.get('/unsubscribe', async (req, res) => {
    readUnsubscribe(config, req.query['token']);
    const token = escape(String(req.query['token']));
    res
      .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .type('html')
      .send(
        `<!doctype html><html lang="en"><title>Turn off Atelier notifications</title><body><h1>Turn off appreciation emails</h1><form method="post"><input type="hidden" name="token" value="${token}"><button>Confirm unsubscribe</button></form></body></html>`,
      );
  });
  router.post(
    '/unsubscribe',
    raw({ type: 'application/x-www-form-urlencoded', limit: '2kb' }),
    async (req, res) => {
      const form = Buffer.isBuffer(req.body)
        ? new URLSearchParams(req.body.toString())
        : undefined;
      await unsubscribe(req.query['token'] || form?.get('token'));
      res.type('text').send('Appreciation emails are turned off.');
    },
  );
  router.post(
    '/webhook',
    raw({ type: 'application/json', limit: '64kb' }),
    async (req, res) => {
      if (!config.resendWebhookSecret || !Buffer.isBuffer(req.body))
        throw new HttpError(503, 'Webhook is not configured.');
      type MailEvent = { type?: string; data?: { to?: string[] } };
      let event: MailEvent;
      try {
        new Webhook(config.resendWebhookSecret).verify(req.body.toString(), {
          'svix-id': req.get('svix-id') || '',
          'svix-timestamp': req.get('svix-timestamp') || '',
          'svix-signature': req.get('svix-signature') || '',
        });
        event = JSON.parse(req.body.toString()) as MailEvent;
      } catch {
        throw new HttpError(400, 'Invalid webhook signature.');
      }
      await sql.transaction(async (tx) => {
        const inserted = await tx.query(
          'INSERT INTO gallery.email_webhooks(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
          [req.get('svix-id')],
        );
        if (!inserted.rows.length) return;
        if (['email.bounced', 'email.complained'].includes(event.type || ''))
          for (const email of (event.data?.to || []).slice(0, 100)) {
            if (typeof email !== 'string' || email.length > 254) continue;
            await tx.query(
              'INSERT INTO gallery.email_suppressions(email,reason) VALUES($1,$2) ON CONFLICT(email) DO NOTHING',
              [email.toLowerCase(), event.type],
            );
            await tx.query(
              'UPDATE gallery.notification_preferences SET enabled=false WHERE email=$1',
              [email.toLowerCase()],
            );
          }
      });
      res.sendStatus(204);
    },
  );
  return router;
}

export async function processNotifications(
  sql: Sql,
  config: Config,
  sender: MailSender = resendSender(config),
  queue?: RedisNotificationQueue,
  limit = 5,
  shouldStop: () => boolean = () => false,
) {
  const results = { sent: 0, cancelled: 0, retried: 0, dead: 0 };
  if (!emailEnabled(config)) return results;
  let hints: string[] = [];
  try {
    hints = (await queue?.take()) || [];
  } catch {
    /* Durable SQL fallback. */
  }
  for (let index = 0; index < Math.min(limit, 5) && !shouldStop(); index++) {
    const lease = randomUUID();
    const row = (
      await sql.query(
        `WITH candidate AS (SELECT id FROM gallery.notification_outbox WHERE (status='pending' AND available_at<=now()) OR (status='processing' AND lease_until<now()) ORDER BY (id=ANY($1::uuid[])) DESC,available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE gallery.notification_outbox o SET status='processing',lease_id=$2,lease_until=now()+interval '2 minutes' FROM candidate c WHERE o.id=c.id RETURNING o.*`,
        [hints, lease],
      )
    ).rows[0];
    if (!row) break;
    const id = String(row['id']);
    const finish = async (status: string, error?: string) => {
      await sql.query(
        'UPDATE gallery.notification_outbox SET status=$3,finished_at=now(),last_error=$4,lease_until=NULL WHERE id=$1 AND lease_id=$2',
        [id, lease, status, error || null],
      );
    };
    const p = (
      await sql.query(
        'SELECT * FROM gallery.notification_preferences WHERE user_id=$1',
        [row['user_id']],
      )
    ).rows[0];
    let mail: Mail;
    try {
      mail = openMail(config, String(row['payload']));
    } catch {
      await finish('dead', 'payload-key-unavailable');
      results.dead++;
      continue;
    }
    const accountMail = ['account-verify', 'password-reset'].includes(
      String(row['kind']),
    );
    const challenge = accountMail
      ? (
          await sql.query(
            'SELECT email,expires_at,used_at FROM gallery.account_challenges WHERE id=$1',
            [row['preference_version']],
          )
        ).rows[0]
      : null;
    const eligible = accountMail
      ? Boolean(
          challenge &&
          !challenge['used_at'] &&
          new Date(String(challenge['expires_at'])).getTime() > Date.now() &&
          challenge['email'] === mail.to[0],
        )
      : Boolean(
          p &&
          p['version'] === row['preference_version'] &&
          p['email'] === mail.to[0] &&
          (row['kind'] !== 'like' || (p['enabled'] && p['verified_at'])) &&
          (row['kind'] !== 'verify' ||
            (p['verification_hash'] &&
              new Date(String(p['verification_expires_at'])).getTime() >
                Date.now())),
        );
    if (
      (config.resendTestRecipient &&
        mail.to[0] !== config.resendTestRecipient) ||
      !eligible ||
      (
        await sql.query(
          'SELECT 1 FROM gallery.email_suppressions WHERE email=$1',
          [mail.to[0]],
        )
      ).rows.length
    ) {
      await finish('cancelled');
      results.cancelled++;
      continue;
    }
    if (
      Number(row['attempts']) >= 8 ||
      (row['first_attempt_at'] &&
        Date.now() - new Date(String(row['first_attempt_at'])).getTime() >=
          23 * 60 * 60 * 1000)
    ) {
      await finish('dead', 'retry-window-exhausted');
      results.dead++;
      continue;
    }
    // Conservative caps reserve every attempt, including retries, below Resend Free limits.
    const budget = await sql.transaction(async (tx) => {
      const now = new Date().toISOString(),
        periods = [
          [`day:${now.slice(0, 10)}`, 90],
          [`month:${now.slice(0, 7)}`, 2700],
        ] as const;
      for (const [period] of periods)
        await tx.query(
          'INSERT INTO gallery.email_budget(period) VALUES($1) ON CONFLICT DO NOTHING',
          [period],
        );
      for (const [period, maximum] of periods) {
        const b = (
          await tx.query(
            'SELECT attempts FROM gallery.email_budget WHERE period=$1 FOR UPDATE',
            [period],
          )
        ).rows[0]!;
        if (Number(b['attempts']) >= maximum) return false;
      }
      for (const [period] of periods)
        await tx.query(
          'UPDATE gallery.email_budget SET attempts=attempts+1 WHERE period=$1',
          [period],
        );
      await tx.query(
        'UPDATE gallery.notification_outbox SET attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) WHERE id=$1 AND lease_id=$2',
        [id, lease],
      );
      return true;
    });
    if (!budget) {
      await sql.query(
        "UPDATE gallery.notification_outbox SET status='pending',available_at=now()+interval '1 hour',lease_until=NULL WHERE id=$1 AND lease_id=$2",
        [id, lease],
      );
      results.retried++;
      continue;
    }
    try {
      const provider = await sender.send(mail, id);
      await sql.query(
        "UPDATE gallery.notification_outbox SET status='done',provider_id=$3,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_id=$2",
        [id, lease, provider],
      );
      results.sent++;
    } catch (error) {
      if (error instanceof MailFailure && error.permanent) {
        await finish('dead', 'provider-permanent-error');
        results.dead++;
      } else {
        const delay =
          Math.min(3600, 30 * 2 ** Number(row['attempts'])) + randomInt(0, 30);
        await sql.query(
          "UPDATE gallery.notification_outbox SET status='pending',available_at=now()+($3*interval '1 second'),lease_until=NULL,last_error='provider-transient-error' WHERE id=$1 AND lease_id=$2",
          [id, lease, delay],
        );
        results.retried++;
      }
    }
  }
  return results;
}
