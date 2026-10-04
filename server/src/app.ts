import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { clientDirectory, uploadsDirectory, type Config } from './config.js';
import { HttpError } from './http.js';
import { authenticate, authRoutes } from './auth.js';
import { galleryRoutes } from './gallery.js';
import { disabledCache, type DiscoveryCache } from './cache.js';
import type { Sql } from './database.js';
import type { ArtworkStore } from './domain.js';
import type { ImageStorage } from './storage.js';
import { uncachedSecurity, type SecurityCache } from './security-cache.js';
import { csrfGuard } from './csrf.js';
import { accountLifecycleRoutes } from './account-lifecycle.js';
import { runMaintenance } from './maintenance.js';
import { apiLimit } from './rate-limit.js';
import { timingSafeEqual } from 'node:crypto';
import {
  notificationRoutes,
  notificationCallbacks,
  disabledDispatch,
  type NotificationDispatch,
  emailEnabled,
} from './notifications.js';

export function createApp({
  config,
  uploadDirectory = uploadsDirectory,
  frontendDirectory = clientDirectory,
  rateLimitEnabled = true,
  cache = disabledCache,
  sql,
  artworks,
  storage,
  security = uncachedSecurity,
  notifications = disabledDispatch,
  defer = (work: Promise<void>) => {
    void work.catch(() =>
      console.error('Notification dispatch deferred to durable outbox.'),
    );
  },
}: {
  config: Config;
  uploadDirectory?: string;
  frontendDirectory?: string;
  rateLimitEnabled?: boolean;
  cache?: DiscoveryCache;
  sql: Sql;
  artworks: ArtworkStore;
  storage: ImageStorage;
  security?: SecurityCache;
  notifications?: NotificationDispatch;
  defer?: (work: Promise<void>) => void;
}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': [
            "'self'",
            'data:',
            ...(config.supabaseUrl ? [new URL(config.supabaseUrl).origin] : []),
          ],
          'connect-src': [
            "'self'",
            ...(config.supabaseUrl ? [new URL(config.supabaseUrl).origin] : []),
          ],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'upgrade-insecure-requests': config.production ? [] : null,
        },
      },
    }),
  );
  app.use('/uploads', express.static(uploadDirectory, { maxAge: '1d' }));
  app.use('/api/notifications', notificationCallbacks(sql, config));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  if (rateLimitEnabled) app.use('/api', apiLimit(config, security));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const ownOrigin = `${req.protocol}://${req.get('host')}`;
      if (
        (origin && origin !== ownOrigin && origin !== config.clientOrigin) ||
        req.get('sec-fetch-site') === 'cross-site'
      )
        throw new HttpError(403, 'Requests must come from this application.');
    }
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', redis: cache.status() }),
  );
  app.get('/api/internal/notifications', async (req, res) => {
    const expected = Buffer.from(`Bearer ${config.cronSecret || ''}`),
      actual = Buffer.from(req.get('authorization') || '');
    if (
      !config.cronSecret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new HttpError(401, 'Unauthorized.');
    const maintenance = await runMaintenance(sql, artworks, storage, cache);
    if (!emailEnabled(config)) {
      res.json({ queued: 0, emailConfigured: false, maintenance });
      return;
    }
    const ids = (
      await sql.query(
        "SELECT id FROM gallery.notification_outbox WHERE (status='pending' AND available_at<=now()) OR (status='processing' AND lease_until<now()) ORDER BY created_at LIMIT 20",
      )
    ).rows.map((r) => String(r['id']));
    // Wake only when real work exists; no synthetic Render keepalive.
    defer(notifications.kick(ids));
    res.json({ queued: ids.length, maintenance });
  });
  app.use('/api', authenticate(config, sql, security));
  app.use('/api', csrfGuard(config));
  app.use(
    '/api/auth',
    authRoutes(config, sql, security, rateLimitEnabled, notifications, defer),
  );
  app.use(
    '/api',
    accountLifecycleRoutes(
      sql,
      config,
      security,
      cache,
      notifications,
      defer,
      artworks,
      storage,
    ),
  );
  app.use(
    '/api/notifications',
    notificationRoutes(sql, config, notifications, defer),
  );
  app.use(
    '/api',
    galleryRoutes(
      sql,
      artworks,
      storage,
      cache,
      security,
      config,
      notifications,
      defer,
    ),
  );
  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'Endpoint not found.');
  });
  if (existsSync(path.join(frontendDirectory, 'index.html'))) {
    app.use(express.static(frontendDirectory, { maxAge: '1h', index: false }));
    app.get('/{*path}', (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(frontendDirectory, 'index.html'));
    });
  }
  app.use((_req, _res) => {
    throw new HttpError(
      404,
      'Page not found. Build the Angular client with npm run build.',
    );
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    let status: number = error.status || 500;
    let message: string = error.message;
    if (error.type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON body.';
    } else if (error.code === 11000 || error.code === '23505') {
      status = 409;
      message = 'That record already exists.';
    } else if (error.code === '23514' || error.code === '22P02') {
      status = 400;
      message = 'Invalid data. Check the required fields.';
    } else if (error.name === 'ValidationError' || error.name === 'CastError') {
      status = 400;
      message = 'Invalid data. Check the required fields.';
    }
    if (status >= 500) {
      console.error('Request failed:', error.name || 'Error');
      message = 'Something went wrong. Please try again.';
    }
    res.status(status).json({ error: message });
  };
  app.use(errors);
  return app;
}
