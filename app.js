import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'node:path';
import { rootDirectory, uploadsDirectory } from './lib/config.js';
import { HttpError } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { galleryRoutes } from './routes/gallery.js';

// Creating the app does not connect to MongoDB or open a port, allowing isolated tests.
export function createApp({
  config,
  store,
  uploadDirectory = uploadsDirectory,
}) {
  if (config.production && !store)
    throw new Error('A persistent session store is required in production.');
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.set('views', path.join(rootDirectory, 'views'));
  app.set('view engine', 'pug');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(path.join(rootDirectory, 'public')));
  app.use('/uploads', express.static(uploadDirectory));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(
    session({
      secret: config.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.production,
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
  });
  app.get(['/', '/home'], (req, res) => res.render('pages/home'));
  app.use(authRoutes());
  app.use(galleryRoutes({ uploadDirectory }));
  app.use((req, res, next) => next(new HttpError(404, 'Page not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500;
    let message = error.message;
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
      message = 'That username is already taken.';
    } else if (error.name === 'ValidationError' || error.name === 'CastError') {
      status = 400;
      message = 'Invalid data. Check the required fields.';
    }
    if (status >= 500) {
      console.error('Request failed:', error.message);
      message = 'Something went wrong. Please try again.';
    }
    res.status(status).json({ error: message });
  });
  return app;
}
