import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import type { Config } from './config.js';
import { HttpError } from './http.js';
const mac = (value: string, config: Config) =>
  createHmac('sha256', config.jwtSecret)
    .update(`csrf:${value}`)
    .digest('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function csrfBinding(req: Request, config: Config): string | null {
  const value: unknown = req.cookies?.['gallery_csrf_binding'];
  if (typeof value !== 'string' || value.length > 200) return null;
  const split = value.lastIndexOf('.');
  return split > 0 &&
    equal(mac(value.slice(0, split), config), value.slice(split + 1))
    ? value
    : null;
}
export function issueCsrf(
  req: Request,
  res: Response,
  config: Config,
  sid = 'anonymous',
) {
  const old = csrfBinding(req, config);
  const payload = old?.startsWith(`${sid}:`)
    ? old.slice(0, old.lastIndexOf('.'))
    : `${sid}:${randomBytes(24).toString('base64url')}`;
  const binding = `${payload}.${mac(payload, config)}`;
  const options = {
    sameSite: 'strict' as const,
    secure: config.production,
    path: '/',
    maxAge: 30 * 86400000,
  };
  res.cookie('gallery_csrf_binding', binding, { ...options, httpOnly: true });
  res.cookie('XSRF-TOKEN', mac(binding, config), options);
}
export function csrfGuard(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const binding = csrfBinding(req, config),
      header = req.get('X-XSRF-TOKEN');
    if (
      !binding ||
      !header ||
      !equal(mac(binding, config), header) ||
      (req.authSessionId && !binding.startsWith(`${req.authSessionId}:`))
    )
      throw new HttpError(
        403,
        'Invalid CSRF token. Reload this page and try again.',
      );
    next();
  };
}
