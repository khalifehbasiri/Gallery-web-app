import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './config.js';
import type { Sql } from './database.js';
import type { ArtworkStore } from './domain.js';
import type { ImageStorage } from './storage.js';
import type { SecurityCache } from './security-cache.js';
import type { DiscoveryCache } from './cache.js';
import { requireAuth, clearAuthCookies } from './auth.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { HttpError } from './http.js';
import { publicDemoNames } from './public-demo.js';
import { emailEnabled, type NotificationDispatch } from './notifications.js';
import {
  emailField,
  passwordInput,
  queueAccountMail,
  reserveAccountMail,
  tokenHash,
} from './account-mail.js';

export function accountLifecycleRoutes(
  sql: Sql,
  config: Config,
  security: SecurityCache,
  cache: DiscoveryCache,
  dispatch: NotificationDispatch,
  defer: (work: Promise<void>) => void,
  store: ArtworkStore,
  storage: ImageStorage,
) {
  const router = Router();
  router.post('/auth/forgot-password', async (req, res) => {
    const started = performance.now(),
      email = emailField(req.body);
    const ids = await sql.transaction(async (tx) => {
      // Apply identical address limits and response shape even for unknown addresses.
      if (!(await reserveAccountMail(tx, config, email))) return [];
      const user = (
        await tx.query(
          'SELECT id,username FROM gallery.users WHERE email=$1 AND email_verified_at IS NOT NULL AND deletion_requested_at IS NULL FOR UPDATE',
          [email],
        )
      ).rows[0];
      if (!user || publicDemoNames.has(String(user['username']))) return [];
      return queueAccountMail(
        tx,
        config,
        String(user['id']),
        email,
        'password-reset',
      );
    });
    defer(dispatch.kick(ids));
    await delay(Math.max(0, 300 - (performance.now() - started)));
    res.status(202).json({
      message:
        'If an eligible account exists, a password reset email will be sent when delivery is available. Check your inbox and spam folder.',
    });
  });
  router.post('/auth/reset-password', async (req, res) => {
    const secret = req.body?.token;
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
      throw new HttpError(400, 'Reset link is invalid or expired.');
    const password = await hashPassword(passwordInput(req.body));
    const reset = await security.change(() =>
      sql.transaction(async (tx) => {
        const candidate = (
          await tx.query(
            "SELECT user_id FROM gallery.account_challenges WHERE token_hash=$1 AND kind='password-reset'",
            [tokenHash(secret)],
          )
        ).rows[0];
        if (!candidate) return false;
        const user = (
          await tx.query(
            'SELECT * FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL FOR UPDATE',
            [candidate['user_id']],
          )
        ).rows[0];
        const challenge = (
          await tx.query(
            "SELECT * FROM gallery.account_challenges WHERE token_hash=$1 AND kind='password-reset' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
            [tokenHash(secret)],
          )
        ).rows[0];
        if (
          !user ||
          !challenge ||
          user['email'] !== challenge['email'] ||
          !user['email_verified_at'] ||
          publicDemoNames.has(String(user['username']))
        )
          return false;
        await tx.query(
          'UPDATE gallery.users SET password_hash=$2 WHERE id=$1',
          [user['id'], password],
        );
        await tx.query(
          'UPDATE gallery.account_challenges SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
          [user['id']],
        );
        await tx.query(
          'UPDATE gallery.sessions SET revoked_at=now() WHERE user_id=$1',
          [user['id']],
        );
        return true;
      }),
    );
    if (!reset) throw new HttpError(400, 'Reset link is invalid or expired.');
    clearAuthCookies(res, config);
    res.json({
      message:
        'Password changed. All sessions were revoked. Sign in with your new password.',
    });
  });
  router.post('/auth/verify-email', async (req, res) => {
    const secret = req.body?.token;
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
      throw new HttpError(400, 'Verification link is invalid or expired.');
    const verified = await sql.transaction(async (tx) => {
      const candidate = (
        await tx.query(
          "SELECT user_id FROM gallery.account_challenges WHERE token_hash=$1 AND kind='account-verify'",
          [tokenHash(secret)],
        )
      ).rows[0];
      if (!candidate) return false;
      const user = (
        await tx.query(
          'SELECT * FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL FOR UPDATE',
          [candidate['user_id']],
        )
      ).rows[0];
      const challenge = (
        await tx.query(
          "SELECT * FROM gallery.account_challenges WHERE token_hash=$1 AND kind='account-verify' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
          [tokenHash(secret)],
        )
      ).rows[0];
      if (!user || !challenge || user['email'] !== challenge['email'])
        return false;
      await tx.query(
        'UPDATE gallery.users SET email_verified_at=now() WHERE id=$1',
        [user['id']],
      );
      await tx.query(
        'UPDATE gallery.account_challenges SET used_at=now() WHERE id=$1',
        [challenge['id']],
      );
      await tx.query(
        'UPDATE gallery.notification_preferences SET verified_at=now(),enabled=(consent_at IS NOT NULL) WHERE user_id=$1 AND email=$2',
        [user['id'], user['email']],
      );
      return true;
    });
    if (!verified)
      throw new HttpError(400, 'Verification link is invalid or expired.');
    res.json({
      message:
        'Email verified. Password recovery is now available when email delivery is configured.',
    });
  });
  router.get('/account/identity', requireAuth, async (req, res) => {
    const user = (
      await sql.query(
        'SELECT email,email_verified_at,terms_version,terms_accepted_at FROM gallery.users WHERE id=$1',
        [req.user!.id],
      )
    ).rows[0]!;
    res.json({
      email: user['email'] || '',
      verified: Boolean(user['email_verified_at']),
      termsVersion: user['terms_version'],
      deliveryAvailable: emailEnabled(config),
      publicDemo: publicDemoNames.has(req.user!.username),
    });
  });
  router.post('/account/email', requireAuth, async (req, res) => {
    if (publicDemoNames.has(req.user!.username))
      throw new HttpError(
        403,
        'Shared demo accounts cannot store personal email addresses.',
      );
    const email = emailField(req.body),
      password =
        typeof req.body?.password === 'string' &&
        req.body.password.length <= 256
          ? req.body.password
          : '';
    const ids = await sql.transaction(async (tx) => {
      const user = (
        await tx.query(
          'SELECT * FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL FOR UPDATE',
          [req.user!.id],
        )
      ).rows[0];
      if (
        !user ||
        !(await verifyPassword(password, String(user['password_hash'])))
      )
        throw new HttpError(401, 'Confirm your current password.');
      if (!(await reserveAccountMail(tx, config, email)))
        throw new HttpError(
          429,
          'Maximum three account emails per hour. Try again later.',
        );
      if (user['email'] !== email) {
        await tx.query(
          'UPDATE gallery.users SET email=$2,email_verified_at=NULL WHERE id=$1',
          [req.user!.id, email],
        );
        await tx.query(
          'UPDATE gallery.account_challenges SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
          [req.user!.id],
        );
        await tx.query(
          'DELETE FROM gallery.notification_preferences WHERE user_id=$1',
          [req.user!.id],
        );
      }
      await tx.query(
        'INSERT INTO gallery.notification_preferences(user_id,email,version,verified_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING',
        [
          req.user!.id,
          email,
          randomUUID(),
          user['email'] === email ? user['email_verified_at'] : null,
        ],
      );
      return queueAccountMail(
        tx,
        config,
        req.user!.id,
        email,
        'account-verify',
      );
    });
    defer(dispatch.kick(ids));
    res.status(202).json({
      message: ids.length
        ? 'Verification email queued. Delivery may be delayed.'
        : 'Email saved. Verification delivery is awaiting sender configuration; request it again when available.',
    });
  });
  router.post('/account/export', requireAuth, async (req, res) => {
    await confirmPassword(sql, req.user!.id, req.body?.password);
    const user = req.user!.id;
    const data = await sql.transaction(async (tx) => {
      const identity = (
        await tx.query(
          'SELECT id,username,role,email,email_verified_at,terms_version,terms_accepted_at,created_at FROM gallery.users WHERE id=$1',
          [user],
        )
      ).rows[0];
      const result: Record<string, unknown> = {
        format: 1,
        exportedAt: new Date().toISOString(),
        account: identity,
      };
      for (const [key, query] of Object.entries({
        likes: 'SELECT artwork_id FROM gallery.likes WHERE user_id=$1',
        reviews:
          'SELECT id,artwork_id,text,created_at FROM gallery.reviews WHERE user_id=$1',
        follows: 'SELECT artist_id FROM gallery.follows WHERE user_id=$1',
        followers: 'SELECT user_id FROM gallery.follows WHERE artist_id=$1',
        workshops:
          'SELECT id,name,goal,weeks,created_at FROM gallery.workshops WHERE artist_id=$1',
        enrollments:
          'SELECT workshop_id FROM gallery.enrollments WHERE user_id=$1',
        artworks:
          'SELECT id,title,image_url,status,created_at FROM gallery.artworks WHERE artist_id=$1',
        uploads:
          'SELECT id,path,content_type,max_bytes,expires_at,used_at FROM gallery.uploads WHERE user_id=$1',
        sessions:
          'SELECT created_at,idle_expires_at,absolute_expires_at,revoked_at FROM gallery.sessions WHERE user_id=$1',
        notifications:
          'SELECT email,enabled,verified_at,consent_at,consent_version FROM gallery.notification_preferences WHERE user_id=$1',
        mailHistory:
          'SELECT kind,status,created_at,finished_at FROM gallery.notification_outbox WHERE user_id=$1',
      })) {
        const rows = (await tx.query(query + ' LIMIT 1001', [user])).rows;
        if (rows.length > 1000)
          throw new HttpError(
            413,
            'Your export needs operator assistance. Contact the privacy contact on the privacy page.',
          );
        result[key] = rows;
      }
      return result;
    });
    const documents = [];
    for (const art of data['artworks'] as { id: string }[])
      documents.push(await store.get(art.id));
    data['artworkDocuments'] = documents;
    if (Buffer.byteLength(JSON.stringify(data)) > 4 * 1024 * 1024)
      throw new HttpError(
        413,
        'Your export needs operator assistance. Contact the privacy contact.',
      );
    res.set(
      'Content-Disposition',
      'attachment; filename="atelier-account.json"',
    );
    res.json(data);
  });
  router.delete('/account', requireAuth, async (req, res) => {
    if (publicDemoNames.has(req.user!.username))
      throw new HttpError(403, 'Shared demo accounts cannot be deleted.');
    if (req.body?.confirmation !== 'DELETE')
      throw new HttpError(
        400,
        'Type DELETE to confirm permanent account deletion.',
      );
    await confirmPassword(sql, req.user!.id, req.body?.password);
    await security.change(() =>
      sql.transaction(async (tx) => {
        const user = req.user!.id;
        await tx.query('SELECT id FROM gallery.users WHERE id=$1 FOR UPDATE', [
          user,
        ]);
        const arts = (
          await tx.query(
            'SELECT id,image_url FROM gallery.artworks WHERE artist_id=$1',
            [user],
          )
        ).rows;
        const paths = (
          await tx.query('SELECT path FROM gallery.uploads WHERE user_id=$1', [
            user,
          ])
        ).rows.map((r) => String(r['path']));
        for (const art of arts) {
          const path = ownedImagePath(config, String(art['image_url']));
          if (path) paths.push(path);
        }
        await tx.query(
          "INSERT INTO gallery.account_deletions(user_id,artwork_ids,image_paths,image_paths_final,not_before) VALUES($1,$2::jsonb,$3::jsonb,$3::jsonb,greatest(now(),coalesce((SELECT max(expires_at)+interval '105 minutes' FROM gallery.uploads WHERE user_id=$1),now()))) ON CONFLICT DO NOTHING",
          [
            user,
            JSON.stringify(arts.map((r) => r['id'])),
            JSON.stringify([...new Set(paths)]),
          ],
        );
        await tx.query(
          "UPDATE gallery.users SET deletion_requested_at=now(),email=NULL,email_verified_at=NULL,password_hash='scrypt$retired',username='deleted-'||id,role='patron',terms_version=NULL,terms_accepted_at=NULL WHERE id=$1",
          [user],
        );
        await tx.query(
          'UPDATE gallery.sessions SET revoked_at=now() WHERE user_id=$1',
          [user],
        );
        await tx.query(
          "UPDATE gallery.artworks SET status='pending' WHERE artist_id=$1",
          [user],
        );
        await tx.query(
          'DELETE FROM gallery.notification_preferences WHERE user_id=$1',
          [user],
        );
        await tx.query(
          'DELETE FROM gallery.notification_outbox WHERE user_id=$1 OR dedupe_key LIKE $2',
          [user, `like:${user}:%`],
        );
        await tx.query(
          'DELETE FROM gallery.account_challenges WHERE user_id=$1',
          [user],
        );
        await removeActivity(tx, user);
      }),
    );
    await cache.invalidate();
    clearAuthCookies(res, config);
    defer(processAccountDeletions(sql, store, storage, cache).then(() => {}));
    res.status(202).json({
      message:
        'Account access revoked and public content hidden. Permanent document and image cleanup is queued; provider outages may delay completion.',
    });
  });
  return router;
}
async function confirmPassword(sql: Sql, user: string, password: unknown) {
  const row = (
    await sql.query(
      'SELECT password_hash FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NULL',
      [user],
    )
  ).rows[0];
  if (
    typeof password !== 'string' ||
    password.length > 256 ||
    !row ||
    !(await verifyPassword(password, String(row['password_hash'])))
  )
    throw new HttpError(401, 'Confirm your current password.');
}
function ownedImagePath(config: Config, value: string) {
  try {
    const url = new URL(value),
      base = new URL(config.supabaseUrl || 'https://invalid.local');
    const prefix = `/storage/v1/object/public/${config.storageBucket}/`;
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix))
      return null;
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    return path && !path.split('/').some((p) => p === '..' || p === '.')
      ? path
      : null;
  } catch {
    return null;
  }
}
async function removeActivity(tx: Sql, user: string) {
  const affected = (
    await tx.query(
      'SELECT artwork_id FROM gallery.likes WHERE user_id=$1 UNION SELECT artwork_id FROM gallery.reviews WHERE user_id=$1',
      [user],
    )
  ).rows.map((r) => r['artwork_id']);
  await tx.query(
    'SELECT id FROM gallery.artworks WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
    [affected],
  );
  await tx.query('DELETE FROM gallery.likes WHERE user_id=$1', [user]);
  await tx.query('DELETE FROM gallery.reviews WHERE user_id=$1', [user]);
  await tx.query(
    'UPDATE gallery.artworks a SET like_count=(SELECT count(*) FROM gallery.likes l WHERE l.artwork_id=a.id),review_count=(SELECT count(*) FROM gallery.reviews r WHERE r.artwork_id=a.id) WHERE a.id=ANY($1::text[])',
    [affected],
  );
  await tx.query(
    'DELETE FROM gallery.follows WHERE user_id=$1 OR artist_id=$1',
    [user],
  );
  await tx.query(
    'DELETE FROM gallery.enrollments WHERE user_id=$1 OR workshop_id IN (SELECT id FROM gallery.workshops WHERE artist_id=$1)',
    [user],
  );
  await tx.query('DELETE FROM gallery.workshops WHERE artist_id=$1', [user]);
}
export async function processAccountDeletions(
  sql: Sql,
  store: ArtworkStore,
  storage: ImageStorage,
  cache: DiscoveryCache,
  limit = 5,
) {
  let completed = 0;
  for (let index = 0; index < limit; index++) {
    const lease = randomUUID();
    const job = (
      await sql.query(
        "WITH candidate AS (SELECT user_id FROM gallery.account_deletions WHERE (lease_until IS NULL OR lease_until<now()) AND (not_before<=now() OR jsonb_array_length(artwork_ids)>0 OR jsonb_array_length(image_paths)>0) ORDER BY last_attempt_at NULLS FIRST,created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE gallery.account_deletions d SET lease_id=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1,last_attempt_at=now() FROM candidate c WHERE d.user_id=c.user_id RETURNING d.*",
        [lease],
      )
    ).rows[0];
    if (!job) break;
    try {
      // Bounded, checkpointed cleanup. Repeat image removal after signed upload URLs expire.
      for (const id of (job['artwork_ids'] as string[]).slice(0, 5)) {
        await store.remove(id);
        await sql.query(
          'UPDATE gallery.account_deletions SET artwork_ids=artwork_ids-$3 WHERE user_id=$1 AND lease_id=$2',
          [job['user_id'], lease, id],
        );
      }
      for (const path of (job['image_paths'] as string[]).slice(0, 5)) {
        await storage.remove(path);
        await sql.query(
          'UPDATE gallery.account_deletions SET image_paths=image_paths-$3 WHERE user_id=$1 AND lease_id=$2',
          [job['user_id'], lease, path],
        );
      }
      await sql.transaction(async (tx) => {
        const user = job['user_id'];
        const state = (
          await tx.query(
            'SELECT *,not_before<=now() AS ready FROM gallery.account_deletions WHERE user_id=$1 AND lease_id=$2 AND lease_until>now() FOR UPDATE',
            [user, lease],
          )
        ).rows[0];
        if (
          !state ||
          (state['artwork_ids'] as string[]).length ||
          (state['image_paths'] as string[]).length ||
          !state['ready']
        )
          return;
        if (
          !state['final_pass'] &&
          (state['image_paths_final'] as string[]).length
        ) {
          await tx.query(
            "UPDATE gallery.account_deletions SET image_paths=image_paths_final,image_paths_final='[]',final_pass=true WHERE user_id=$1",
            [user],
          );
          return;
        }
        await tx.query('SELECT id FROM gallery.users WHERE id=$1 FOR UPDATE', [
          user,
        ]);
        await removeActivity(tx, String(user));
        await tx.query(
          'DELETE FROM gallery.likes WHERE artwork_id IN (SELECT id FROM gallery.artworks WHERE artist_id=$1)',
          [user],
        );
        await tx.query(
          'DELETE FROM gallery.reviews WHERE artwork_id IN (SELECT id FROM gallery.artworks WHERE artist_id=$1)',
          [user],
        );
        await tx.query('DELETE FROM gallery.artworks WHERE artist_id=$1', [
          user,
        ]);
        await tx.query(
          'DELETE FROM gallery.refresh_tokens WHERE session_id IN (SELECT id FROM gallery.sessions WHERE user_id=$1)',
          [user],
        );
        for (const table of [
          'sessions',
          'token_denials',
          'uploads',
          'account_challenges',
          'notification_outbox',
          'notification_preferences',
        ])
          await tx.query(`DELETE FROM gallery.${table} WHERE user_id=$1`, [
            user,
          ]);
        await tx.query(
          'DELETE FROM gallery.users WHERE id=$1 AND deletion_requested_at IS NOT NULL',
          [user],
        );
        completed++;
      });
      await cache.invalidate();
    } catch {
      console.error(
        'Account cleanup postponed; durable deletion request retained.',
      );
    } finally {
      await sql.query(
        'UPDATE gallery.account_deletions SET lease_until=NULL WHERE user_id=$1 AND lease_id=$2',
        [job['user_id'], lease],
      );
    }
  }
  return completed;
}
