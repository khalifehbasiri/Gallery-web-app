import { createHmac } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { Config } from './config.js';
import type { SecurityCache } from './security-cache.js';
export function apiLimit(
  config: Config,
  security: SecurityCache,
): RequestHandler {
  const local = rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a minute.' },
  });
  return async (req, res, next) => {
    const auth =
      req.path.startsWith('/auth/') &&
      ['login', 'register', 'refresh'].some((p) => req.path.endsWith('/' + p));
    const digest = createHmac('sha256', config.jwtSecret)
      .update(`${auth ? 'auth' : 'api'}:${req.ip || 'unknown'}`)
      .digest('hex');
    const allowed = await security.limit?.(
      digest,
      auth ? 30 : 120,
      auth ? 900 : 60,
    );
    if (allowed === false) {
      res
        .set('Retry-After', auth ? '900' : '60')
        .status(429)
        .json({ error: 'Too many requests. Please try again later.' });
      return;
    }
    if (allowed === undefined) return local(req, res, next);
    next();
  };
}
