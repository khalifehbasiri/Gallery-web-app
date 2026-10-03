import { Router, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { AuthSession, User } from './models.js';
import { HttpError, textField } from './http.js';
import { hashPassword, isPasswordHash, verifyPassword } from './passwords.js';
import { publicUser } from './serializers.js';
import type { Config } from './config.js';

const cookieName = 'gallery_token';
const sessionLifetime = 24 * 60 * 60 * 1000;
const cookieOptions = (config: Config) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.production,
  path: '/',
});

function passwordField(body: unknown, minimum = 1): string {
  const password =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)['password']
      : undefined;
  if (
    typeof password !== 'string' ||
    password.length < minimum ||
    password.length > 256
  )
    throw new HttpError(
      400,
      `Password must contain ${minimum}–256 characters.`,
    );
  return password;
}

export function authenticate(config: Config): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[cookieName];
    if (typeof token !== 'string') return next();
    let payload: JwtPayload;
    try {
      const decoded = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'gallery-api',
        audience: 'gallery-client',
      });
      if (
        typeof decoded === 'string' ||
        typeof decoded.sub !== 'string' ||
        typeof decoded['sid'] !== 'string' ||
        !/^[a-f0-9]{24}$/i.test(decoded.sub)
      )
        throw new Error('Invalid token.');
      payload = decoded;
    } catch {
      res.clearCookie(cookieName, cookieOptions(config));
      return next();
    }
    const session = await AuthSession.findOne({
      sessionId: payload['sid'],
      userId: payload.sub,
      expiresAt: { $gt: new Date() },
    });
    if (session) {
      req.user = (await User.findById(payload.sub)) || undefined;
      if (req.user) req.authSessionId = session.sessionId;
    }
    if (!req.user) res.clearCookie(cookieName, cookieOptions(config));
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue.');
  next();
};

export function authRoutes(config: Config, rateLimitEnabled = true) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many attempts. Try again in 15 minutes.' },
  });
  if (rateLimitEnabled) router.use(['/login', '/register'], limiter);
  router.get('/me', (req, res) =>
    res.json({ user: req.user ? publicUser(req.user) : null }),
  );
  router.post('/register', async (req, res) => {
    const username = textField(req.body, 'username', 80);
    const password = passwordField(req.body, 8);
    if (await User.exists({ username }))
      throw new HttpError(409, 'That username is already taken.');
    const user = await User.create({
      username,
      password: await hashPassword(password),
    });
    res.status(201).json({ user: publicUser(user) });
  });
  router.post('/login', async (req, res) => {
    const username = textField(req.body, 'username', 80);
    const password = passwordField(req.body);
    const user = await User.findOne({ username }).select('+password');
    if (!user || !(await verifyPassword(password, user.password)))
      throw new HttpError(401, 'Invalid username or password.');
    if (!isPasswordHash(user.password))
      await User.updateOne(
        { _id: user._id },
        { $set: { password: await hashPassword(password) } },
      );
    if (req.authSessionId)
      await AuthSession.deleteOne({ sessionId: req.authSessionId });
    const sessionId = randomUUID();
    await AuthSession.create({
      sessionId,
      userId: user._id,
      expiresAt: new Date(Date.now() + sessionLifetime),
    });
    const token = jwt.sign({ sid: sessionId }, config.jwtSecret, {
      algorithm: 'HS256',
      subject: user._id.toString(),
      issuer: 'gallery-api',
      audience: 'gallery-client',
      expiresIn: '24h',
    });
    res.cookie(cookieName, token, {
      ...cookieOptions(config),
      maxAge: sessionLifetime,
    });
    res.json({ user: publicUser(user) });
  });
  router.post('/logout', async (req, res) => {
    if (req.authSessionId)
      await AuthSession.deleteOne({ sessionId: req.authSessionId });
    res.clearCookie(cookieName, cookieOptions(config));
    res.sendStatus(204);
  });
  return router;
}
