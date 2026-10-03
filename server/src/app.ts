import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { clientDirectory, uploadsDirectory, type Config } from './config.js';
import { HttpError } from './http.js';
import { authenticate, authRoutes } from './auth.js';
import { galleryRoutes } from './gallery.js';
import { disabledCache, type DiscoveryCache } from './cache.js';

export function createApp({
  config,
  uploadDirectory = uploadsDirectory,
  frontendDirectory = clientDirectory,
  rateLimitEnabled = true,
  cache = disabledCache,
}: {
  config: Config;
  uploadDirectory?: string;
  frontendDirectory?: string;
  rateLimitEnabled?: boolean;
  cache?: DiscoveryCache;
}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'https:', 'http:', 'data:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'upgrade-insecure-requests': config.production ? [] : null,
        },
      },
    }),
  );
  app.use('/uploads', express.static(uploadDirectory, { maxAge: '1d' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
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
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', redis: cache.status() }),
  );
  app.use('/api', authenticate(config));
  app.use('/api/auth', authRoutes(config, rateLimitEnabled));
  app.use('/api', galleryRoutes(uploadDirectory, cache));
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
    if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Images must be 5 MB or smaller.'
          : 'Invalid upload.';
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON body.';
    } else if (error.code === 11000) {
      status = 409;
      message = 'That record already exists.';
    } else if (error.name === 'ValidationError' || error.name === 'CastError') {
      status = 400;
      message = 'Invalid data. Check the required fields.';
    }
    if (status >= 500) {
      console.error('Request failed:', error.message);
      message = 'Something went wrong. Please try again.';
    }
    res.status(status).json({ error: message });
  };
  app.use(errors);
  return app;
}
