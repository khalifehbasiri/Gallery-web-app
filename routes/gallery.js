import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import User from '../userModel.js';
import Gallery from '../galleriesModel.js';
import {
  asyncRoute,
  HttpError,
  objectId,
  requireDocument,
  textField,
} from '../lib/http.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 10000 },
});

function imageExtension(buffer) {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return '.png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return '.jpg';
  if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)))
    return '.gif';
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return '.webp';
  throw new HttpError(400, 'Upload a PNG, JPEG, GIF, or WebP image.');
}

function artistOnly(req, res, next) {
  if (req.user.aType !== 'artist')
    return next(new HttpError(403, 'An artist account is required.'));
  next();
}

export function galleryRoutes({ uploadDirectory }) {
  const router = Router();
  router.use(
    asyncRoute(async (req, res, next) => {
      if (!req.session.loggedin) {
        if (req.method === 'GET') return res.redirect('/home');
        throw new HttpError(401, 'Please log in first.');
      }
      req.user = await User.findOne({ username: req.session.username });
      if (!req.user) throw new HttpError(401, 'Please log in again.');
      res.locals.user = req.user;
      next();
    }),
  );

  router.get(
    '/account',
    asyncRoute(async (req, res) => {
      const art = await Gallery.find({ artist: req.user.username });
      res.render('pages/account', { art });
    }),
  );
  router.post(
    '/accType',
    asyncRoute(async (req, res) => {
      const aType = req.user.aType === 'patron' ? 'artist' : 'patron';
      await User.updateOne({ _id: req.user._id }, { $set: { aType } });
      res.sendStatus(200);
    }),
  );

  router.get(
    '/artwork',
    asyncRoute(async (req, res) => {
      const art = await Gallery.find({}).sort({ _id: -1 });
      res.render('pages/artwork', { art });
    }),
  );
  router.get(
    '/artist/:id',
    asyncRoute(async (req, res) => {
      const followed = requireDocument(
        await User.findById(objectId(req.params.id)),
        'Artist not found.',
      );
      const art = await Gallery.find({ artist: followed.username });
      res.render('pages/fAccount', { followed, art });
    }),
  );
  router.get(
    '/art/:id',
    asyncRoute(async (req, res) => {
      const art = requireDocument(
        await Gallery.findById(objectId(req.params.id)),
        'Artwork not found.',
      );
      const artist = await User.findOne({ username: art.artist });
      res.render('pages/art', { art, artist });
    }),
  );

  router.get(
    '/searchArt',
    asyncRoute(async (req, res) => {
      const criteria = req.session.searchCriteria;
      const art = criteria ? await Gallery.find(criteria) : [];
      res.render('pages/searchArt', { art });
    }),
  );
  router.post(
    '/searchArt',
    asyncRoute(async (req, res) => {
      const criteria = {};
      for (const field of ['name', 'artist', 'category']) {
        if (req.body?.[field] !== undefined && req.body[field] !== '') {
          criteria[field] = textField(req.body, field);
        }
      }
      if (!Object.keys(criteria).length)
        throw new HttpError(400, 'Enter at least one search field.');
      req.session.searchCriteria = criteria;
      res.sendStatus(200);
    }),
  );

  router.post(
    '/follow',
    asyncRoute(async (req, res) => {
      const followed = requireDocument(
        await User.findById(objectId(req.body?.value)),
        'Artist not found.',
      );
      if (
        followed.aType !== 'artist' ||
        followed.username === req.user.username
      ) {
        throw new HttpError(400, 'Choose another artist to follow.');
      }
      await User.updateOne(
        { _id: req.user._id, 'following.username': { $ne: followed.username } },
        {
          $push: {
            following: {
              _id: followed._id,
              username: followed.username,
              aType: 'artist',
            },
          },
        },
      );
      res.sendStatus(200);
    }),
  );
  router.post(
    '/unfollow',
    asyncRoute(async (req, res) => {
      const username = textField(req.body, 'value', 80);
      await User.updateOne(
        { _id: req.user._id },
        { $pull: { following: { username } } },
      );
      res.sendStatus(200);
    }),
  );

  for (const action of ['like', 'unlike']) {
    router.post(
      `/${action}`,
      asyncRoute(async (req, res) => {
        const id = objectId(req.body?.value);
        const art = requireDocument(
          await Gallery.findById(id),
          'Artwork not found.',
        );
        const liking = action === 'like';
        const filter = liking
          ? { 'like._id': { $ne: id } }
          : { 'like._id': id };
        const update = liking
          ? { $push: { like: { _id: art._id, name: art.name } } }
          : { $pull: { like: { _id: id } } };
        const result = await User.updateOne(
          { _id: req.user._id, ...filter },
          update,
        );
        // A repeated request must not increment/decrement the artwork's count again.
        if (result.modifiedCount) {
          await Gallery.updateOne(
            { _id: id },
            liking
              ? { $push: { numLikes: 'like' } }
              : { $pop: { numLikes: -1 } },
          );
        }
        const updated = await Gallery.findById(id);
        res.json({ numLikes: updated.numLikes.length });
      }),
    );
  }

  router.post(
    '/rsubmit',
    asyncRoute(async (req, res) => {
      const id = objectId(req.body?.id);
      const review = textField(req.body, 'value', 2000);
      const art = requireDocument(
        await Gallery.findById(id),
        'Artwork not found.',
      );
      const reviewId = randomUUID();
      const entry = {
        reviewId,
        user: req.user.username,
        userId: req.user._id,
        review,
      };
      await Gallery.updateOne({ _id: id }, { $push: { reviews: entry } });
      await User.updateOne(
        { _id: req.user._id },
        {
          $push: { reviews: { reviewId, art: art.artist, artId: id, review } },
        },
      );
      res.json({ review: entry });
    }),
  );
  router.post(
    '/rRemove',
    asyncRoute(async (req, res) => {
      const id = objectId(req.body?.id);
      requireDocument(await Gallery.findById(id), 'Artwork not found.');
      // Legacy reviews have no ID; scope their text to this user and this artwork.
      const match = req.body?.reviewId
        ? { reviewId: textField(req.body, 'reviewId', 36) }
        : { review: textField(req.body, 'value', 2000) };
      await Gallery.updateOne(
        { _id: id },
        { $pull: { reviews: { ...match, user: req.user.username } } },
      );
      await User.updateOne(
        { _id: req.user._id },
        { $pull: { reviews: { ...match, artId: id } } },
      );
      res.json({ removed: true });
    }),
  );

  router.get('/addArtwork', artistOnly, (req, res) =>
    res.render('pages/addArtwork'),
  );
  router.post(
    '/addArt',
    artistOnly,
    upload.single('image'),
    asyncRoute(async (req, res) => {
      const artwork = {};
      for (const field of [
        'name',
        'year',
        'category',
        'medium',
        'description',
      ]) {
        artwork[field] = textField(
          req.body,
          field,
          field === 'description' ? 10000 : 200,
        );
      }
      if (!/^\d{1,4}$/.test(artwork.year))
        throw new HttpError(400, 'Year must be a number of up to four digits.');
      if (!req.file) throw new HttpError(400, 'Image upload is required.');
      if (await Gallery.exists({ name: artwork.name }))
        throw new HttpError(409, 'An artwork with that name already exists.');
      const filename = `${randomUUID()}${imageExtension(req.file.buffer)}`;
      const destination = path.join(uploadDirectory, filename);
      await writeFile(destination, req.file.buffer);
      try {
        await Gallery.create({
          ...artwork,
          image: `/uploads/${filename}`,
          artist: req.user.username,
        });
      } catch (error) {
        await unlink(destination);
        throw error;
      }
      res.sendStatus(201);
    }),
  );

  router.get('/addWorkshop', artistOnly, (req, res) =>
    res.render('pages/addWorkshop'),
  );
  router.post(
    '/addWorkshop',
    artistOnly,
    asyncRoute(async (req, res) => {
      const name = textField(req.body, 'name');
      const goal = textField(req.body, 'goal', 2000);
      const duration = textField(req.body, 'duration', 4);
      if (!/^\d+$/.test(duration) || Number(duration) < 1)
        throw new HttpError(
          400,
          'Duration must be a positive number of weeks.',
        );
      const result = await User.updateOne(
        { _id: req.user._id, 'workshops.name': { $ne: name } },
        {
          $push: {
            workshops: {
              name,
              goal,
              duration,
              user: req.user.username,
              signed: [],
            },
          },
        },
      );
      if (!result.modifiedCount)
        throw new HttpError(409, 'A workshop with that name already exists.');
      res.sendStatus(201);
    }),
  );
  router.post(
    '/signup',
    asyncRoute(async (req, res) => {
      const username = textField(req.body, 'user', 80);
      const name = textField(req.body, 'name');
      const result = await User.updateOne(
        { username, 'workshops.name': name },
        {
          $addToSet: { 'workshops.$.signed': { name: req.user.username } },
        },
      );
      if (!result.matchedCount) throw new HttpError(404, 'Workshop not found.');
      res.sendStatus(200);
    }),
  );
  return router;
}
