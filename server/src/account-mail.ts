import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Sql } from './database.js';
import { HttpError, textField } from './http.js';
import {
  emailEnabled,
  mailTemplate,
  sealMail,
  type Mail,
} from './notifications.js';

export const policyVersion = '2026-10-04';
export const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function emailField(body: unknown) {
  const email = textField(body, 'email', 254).toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    )
  )
    throw new HttpError(400, 'Enter a valid email address.');
  return email;
}
export function passwordInput(body: unknown) {
  const password =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)['password']
      : undefined;
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 256
  )
    throw new HttpError(400, 'Password must contain 8–256 characters.');
  return password;
}
export async function reserveAccountMail(
  sql: Sql,
  config: Config,
  email: string,
) {
  const result = await sql.query(
    `INSERT INTO gallery.email_verification_limits(address_hash) VALUES($1) ON CONFLICT(address_hash) DO UPDATE SET attempts=CASE WHEN gallery.email_verification_limits.window_started<now()-interval '1 hour' THEN 1 ELSE gallery.email_verification_limits.attempts+1 END,window_started=CASE WHEN gallery.email_verification_limits.window_started<now()-interval '1 hour' THEN now() ELSE gallery.email_verification_limits.window_started END WHERE gallery.email_verification_limits.attempts<3 OR gallery.email_verification_limits.window_started<now()-interval '1 hour' RETURNING address_hash`,
    [
      createHmac('sha256', config.jwtSecret)
        .update(`account-mail:${email}`)
        .digest('hex'),
    ],
  );
  return result.rows.length > 0;
}
export async function queueAccountMail(
  sql: Sql,
  config: Config,
  user: string,
  email: string,
  kind: 'account-verify' | 'password-reset',
) {
  if (
    !emailEnabled(config) ||
    (config.resendTestRecipient && email !== config.resendTestRecipient)
  )
    return [];
  if (
    (
      await sql.query(
        'SELECT 1 FROM gallery.email_suppressions WHERE email=$1',
        [email],
      )
    ).rows.length
  )
    return [];
  const id = randomUUID(),
    secret = randomBytes(32).toString('base64url');
  await sql.query(
    'UPDATE gallery.account_challenges SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL',
    [user, kind],
  );
  await sql.query(
    `INSERT INTO gallery.account_challenges(id,user_id,email,kind,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')`,
    [id, user, email, kind, tokenHash(secret)],
  );
  const reset = kind === 'password-reset';
  // A fragment is not sent in HTTP URLs/access logs; Angular removes it before submitting.
  const url = `${config.clientOrigin}/${reset ? 'reset-password' : 'verify-email'}#token=${secret}`;
  const title = reset
    ? 'Reset your Atelier password'
    : 'Verify your Atelier account email';
  const body = reset
    ? 'You requested a password reset. This single-use link expires in 30 minutes. If you did not request it, ignore this message; your password has not changed.'
    : 'Confirm this email belongs to you. This single-use link expires in 30 minutes. Account verification does not subscribe you to optional notifications.';
  const mail: Mail = {
    from: config.resendFrom!,
    to: [email],
    subject: title,
    text: `${body}\n\n${url}`,
    html: mailTemplate(
      title,
      body,
      url,
      reset ? 'Reset password' : 'Verify email',
    ),
  };
  await sql.query(
    `INSERT INTO gallery.notification_outbox(id,user_id,preference_version,kind,dedupe_key,payload) VALUES($1,$2,$1,$3,$4,$5)`,
    [id, user, kind, `account:${id}`, sealMail(config, mail)],
  );
  return [id];
}
