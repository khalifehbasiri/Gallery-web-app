import {
  Router,
  type RequestHandler,
  type Request,
  type Response,
} from 'express';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { HttpError, textField } from './http.js';
import { hashPassword, isPasswordHash, verifyPassword } from './passwords.js';
import { newId, userDto, publicUser } from './domain.js';
import { csrfBinding, issueCsrf } from './csrf.js';
import type { Config } from './config.js';
import type { Sql } from './database.js';
import type { SecurityCache } from './security-cache.js';
import {
  emailField,
  policyVersion,
  queueAccountMail,
  reserveAccountMail,
} from './account-mail.js';
import {
  disabledDispatch,
  type NotificationDispatch,
} from './notifications.js';
export const accessSeconds = 600;
const idleMs = 7 * 86400000,
  absoluteMs = 30 * 86400000;
const hash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');
const options = (config: Config, path = '/') => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: config.production,
  path,
});
function passwordField(body: unknown, min = 1): string {
  const value =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)['password']
      : undefined;
  if (typeof value !== 'string' || value.length < min || value.length > 256)
    throw new HttpError(400, `Password must contain ${min}–256 characters.`);
  return value;
}
function tokens(
  req: Request,
  res: Response,
  config: Config,
  userId: string,
  sid: string,
  refresh: string,
  expires: Date,
) {
  const token = jwt.sign({ sid }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: userId,
    issuer: 'gallery-api',
    audience: 'gallery-client',
    jwtid: randomUUID(),
    expiresIn: accessSeconds,
  });
  // Preserve the expired access cookie so /me can trigger refresh when idle tabs reopen.
  res.cookie('gallery_token', token, { ...options(config), expires });
  res.cookie('gallery_refresh', refresh, {
    ...options(config, '/api/auth'),
    expires,
  });
  issueCsrf(req, res, config, sid);
}
export function clearAuthCookies(res: Response, config: Config) {
  res.clearCookie('gallery_token', options(config));
  res.clearCookie('gallery_refresh', options(config, '/api/auth'));
  res.clearCookie('gallery_csrf_binding', options(config));
  res.clearCookie('XSRF-TOKEN', { ...options(config), httpOnly: false });
}
export function authenticate(
  config: Config,
  sql: Sql,
  security: SecurityCache,
): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.['gallery_token'];
    if (typeof token !== 'string') return next();
    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'gallery-api',
        audience: 'gallery-client',
        clockTolerance: 5,
      });
      if (
        typeof decoded === 'string' ||
        typeof decoded.sub !== 'string' ||
        !/^[a-f0-9]{24}$/.test(decoded.sub) ||
        typeof decoded['sid'] !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(decoded['sid']) ||
        typeof decoded.jti !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(decoded.jti) ||
        typeof decoded.exp !== 'number'
      )
        throw new Error('Invalid token.');
      payload = decoded;
    } catch {
      return next();
    }
    req.user =
      (await security.verify(
        payload.jti!,
        async () => {
          const result = await sql.query(
            `SELECT u.id,u.username,u.role,extract(epoch FROM least(s.idle_expires_at,s.absolute_expires_at)) AS valid_until FROM gallery.users u JOIN gallery.sessions s ON s.user_id=u.id
        WHERE u.id=$1 AND u.deletion_requested_at IS NULL AND s.id=$2 AND s.revoked_at IS NULL AND s.idle_expires_at > now() AND s.absolute_expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM gallery.token_denials d WHERE d.jti=$3 AND d.expires_at > now())`,
            [payload.sub, payload['sid'], payload.jti],
          );
          return result.rows[0]
            ? {
                user: publicUser(userDto(result.rows[0])),
                expires: Number(result.rows[0]['valid_until']),
              }
            : null;
        },
        payload.exp!,
      )) || undefined;
    if (req.user) {
      req.authSessionId = payload['sid'];
      req.authTokenId = payload.jti;
      req.authTokenExpiry = payload.exp;
    }
    next();
  };
}
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue.');
  next();
};
export function authRoutes(
  config: Config,
  sql: Sql,
  security: SecurityCache,
  rateLimitEnabled = true,
  dispatch: NotificationDispatch = disabledDispatch,
  defer: (work: Promise<void>) => void = (work) => {
    void work.catch(() => {});
  },
) {
  const router = Router();
  if (rateLimitEnabled)
    router.use(
      [
        '/login',
        '/register',
        '/refresh',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
      ],
      rateLimit({
        windowMs: 15 * 60000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many attempts. Try again later.' },
      }),
    );
  router.get('/csrf', (req, res) => {
    issueCsrf(
      req,
      res,
      config,
      req.authSessionId ||
        csrfBinding(req, config)?.split(':')[0] ||
        'anonymous',
    );
    res.sendStatus(204);
  });
  router.get('/me', (req, res) => {
    if (
      !req.user &&
      (req.cookies?.['gallery_token'] || req.cookies?.['gallery_refresh'])
    )
      throw new HttpError(401, 'Session needs refreshing.');
    res.json({ user: req.user || null });
  });
  router.post('/register', async (req, res) => {
    const username = textField(req.body, 'username', 80),
      password = await hashPassword(passwordField(req.body, 8));
    const email = emailField(req.body);
    if (req.body?.acceptedTerms !== true)
      throw new HttpError(
        400,
        'Accept the terms and acknowledge the privacy notice to register.',
      );
    if (
      req.body?.notifications !== undefined &&
      typeof req.body.notifications !== 'boolean'
    )
      throw new HttpError(400, 'Invalid notification preference.');
    const { result, ids } = await sql.transaction(async (tx) => {
      const id = newId();
      const result = await tx.query(
        'INSERT INTO gallery.users (id,username,password_hash,email,terms_version,terms_accepted_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING id,username,role',
        [id, username, password, email, policyVersion],
      );
      await tx.query(
        'INSERT INTO gallery.notification_preferences(user_id,email,version,consent_at,consent_version) VALUES($1,$2,$3,$4,$5)',
        [
          id,
          email,
          randomUUID(),
          req.body.notifications === true ? new Date() : null,
          req.body.notifications === true ? policyVersion : null,
        ],
      );
      const ids = (await reserveAccountMail(tx, config, email))
        ? await queueAccountMail(tx, config, id, email, 'account-verify')
        : [];
      return { result, ids };
    });
    defer(dispatch.kick(ids));
    res.status(201).json({ user: publicUser(userDto(result.rows[0]!)) });
  });
  router.post('/login', async (req, res) => {
    const username = textField(req.body, 'username', 80),
      password = passwordField(req.body);
    const found = (
      await sql.query(
        'SELECT * FROM gallery.users WHERE username=$1 AND deletion_requested_at IS NULL',
        [username],
      )
    ).rows[0];
    if (
      !found ||
      !(await verifyPassword(password, String(found['password_hash'])))
    )
      throw new HttpError(401, 'Invalid username or password.');
    if (!isPasswordHash(String(found['password_hash'])))
      await sql.query('UPDATE gallery.users SET password_hash=$1 WHERE id=$2', [
        await hashPassword(password),
        found['id'],
      ]);
    const sid = randomUUID(),
      refresh = randomBytes(32).toString('base64url'),
      expires = new Date(Date.now() + idleMs);
    const create = () =>
      sql.transaction(async (tx) => {
        if (req.authSessionId)
          await tx.query(
            'UPDATE gallery.sessions SET revoked_at=now() WHERE id=$1',
            [req.authSessionId],
          );
        await tx.query(
          'INSERT INTO gallery.sessions (id,user_id,idle_expires_at,absolute_expires_at) VALUES ($1,$2,$3,$4)',
          [sid, found['id'], expires, new Date(Date.now() + absoluteMs)],
        );
        await tx.query(
          'INSERT INTO gallery.refresh_tokens (hash,session_id,expires_at) VALUES ($1,$2,$3)',
          [hash(refresh), sid, expires],
        );
      });
    if (req.authSessionId) await security.change(create);
    else await create();
    tokens(req, res, config, String(found['id']), sid, refresh, expires);
    res.json({ user: publicUser(userDto(found)) });
  });
  router.post('/refresh', async (req, res) => {
    const secret: unknown = req.cookies?.['gallery_refresh'];
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
      throw new HttpError(401, 'Please sign in again.');
    const tokenHash = hash(secret);
    const rotated = await security.change(() =>
      sql.transaction(async (tx) => {
        const lookup = (
          await tx.query(
            'SELECT session_id FROM gallery.refresh_tokens WHERE hash=$1',
            [tokenHash],
          )
        ).rows[0];
        if (!lookup) return null;
        const session = (
          await tx.query(
            'SELECT * FROM gallery.sessions WHERE id=$1 FOR UPDATE',
            [lookup['session_id']],
          )
        ).rows[0]!;
        if (!csrfBinding(req, config)?.startsWith(`${session['id']}:`))
          throw new HttpError(403, 'Invalid session binding.');
        const old = (
          await tx.query(
            'SELECT * FROM gallery.refresh_tokens WHERE hash=$1 FOR UPDATE',
            [tokenHash],
          )
        ).rows[0]!;
        if (old['consumed_at']) {
          await tx.query(
            'UPDATE gallery.sessions SET revoked_at=now() WHERE id=$1',
            [session['id']],
          );
          return null;
        }
        if (
          session['revoked_at'] ||
          new Date(String(session['idle_expires_at'])).getTime() <=
            Date.now() ||
          new Date(String(session['absolute_expires_at'])).getTime() <=
            Date.now() ||
          new Date(String(old['expires_at'])).getTime() <= Date.now()
        )
          return null;
        const expires = new Date(
            Math.min(
              Date.now() + idleMs,
              new Date(String(session['absolute_expires_at'])).getTime(),
            ),
          ),
          refresh = randomBytes(32).toString('base64url');
        await tx.query(
          'UPDATE gallery.refresh_tokens SET consumed_at=now() WHERE hash=$1',
          [tokenHash],
        );
        await tx.query(
          'INSERT INTO gallery.refresh_tokens (hash,session_id,expires_at) VALUES ($1,$2,$3)',
          [hash(refresh), session['id'], expires],
        );
        await tx.query(
          'UPDATE gallery.sessions SET idle_expires_at=$1 WHERE id=$2',
          [expires, session['id']],
        );
        const user = userDto(
          (
            await tx.query(
              'SELECT id,username,role FROM gallery.users WHERE id=$1',
              [session['user_id']],
            )
          ).rows[0]!,
        );
        return { user, sid: String(session['id']), refresh, expires };
      }),
    );
    if (!rotated) {
      clearAuthCookies(res, config);
      throw new HttpError(
        401,
        'Refresh token expired or reused. Please sign in again.',
      );
    }
    tokens(
      req,
      res,
      config,
      rotated.user.id,
      rotated.sid,
      rotated.refresh,
      rotated.expires,
    );
    res.json({ user: publicUser(rotated.user) });
  });
  router.post('/logout', async (req, res) => {
    let sid = req.authSessionId;
    if (!sid && typeof req.cookies?.['gallery_refresh'] === 'string') {
      const record = (
        await sql.query(
          'SELECT session_id FROM gallery.refresh_tokens WHERE hash=$1',
          [hash(req.cookies['gallery_refresh'])],
        )
      ).rows[0];
      if (
        record &&
        csrfBinding(req, config)?.startsWith(`${record['session_id']}:`)
      )
        sid = String(record['session_id']);
    }
    if (sid)
      await security.change(() =>
        sql.query('UPDATE gallery.sessions SET revoked_at=now() WHERE id=$1', [
          sid,
        ]),
      );
    clearAuthCookies(res, config);
    res.sendStatus(204);
  });
  router.get('/sessions', requireAuth, async (req, res) => {
    const rows = (
      await sql.query(
        'SELECT id,created_at,idle_expires_at,absolute_expires_at FROM gallery.sessions WHERE user_id=$1 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now() ORDER BY created_at DESC LIMIT 100',
        [req.user!.id],
      )
    ).rows;
    res.json(
      rows.map((r) => ({
        id: r['id'],
        createdAt: r['created_at'],
        idleExpiresAt: r['idle_expires_at'],
        absoluteExpiresAt: r['absolute_expires_at'],
        current: r['id'] === req.authSessionId,
      })),
    );
  });
  router.delete('/sessions/:id', requireAuth, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(String(req.params['id'])))
      throw new HttpError(404, 'Session not found.');
    const result = await security.change(() =>
      sql.query(
        'UPDATE gallery.sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id',
        [req.params['id'], req.user!.id],
      ),
    );
    if (!result.rows.length) throw new HttpError(404, 'Session not found.');
    if (req.params['id'] === req.authSessionId) clearAuthCookies(res, config);
    res.sendStatus(204);
  });
  router.post('/logout-all', requireAuth, async (req, res) => {
    await security.change(() =>
      sql.query(
        'UPDATE gallery.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [req.user!.id],
      ),
    );
    clearAuthCookies(res, config);
    res.sendStatus(204);
  });
  router.post('/deny-token', requireAuth, async (req, res) => {
    await security.change(() =>
      sql.query(
        'INSERT INTO gallery.token_denials (jti,user_id,expires_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [
          req.authTokenId,
          req.user!.id,
          new Date((req.authTokenExpiry! + 5) * 1000),
        ],
      ),
    );
    res.clearCookie('gallery_token', options(config));
    res.sendStatus(204);
  });
  return router;
}
