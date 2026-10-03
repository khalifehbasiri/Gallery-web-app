import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import type { QueryFilter, Types } from 'mongoose';
import {
  Gallery,
  User,
  type GalleryRecord,
  type EmbeddedWorkshop,
} from './models.js';
import {
  HttpError,
  artistOnly,
  objectId,
  pageParameters,
  requireDocument,
  textField,
} from './http.js';
import { requireAuth } from './auth.js';
import {
  artworkSummary,
  publicArtist,
  publicArtwork,
  publicReview,
  publicUser,
  publicWorkshop,
  reviewId,
  workshopId,
} from './serializers.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 10000 },
});
function imageExtension(buffer: Buffer): string {
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

export function galleryRoutes(uploadDirectory: string) {
  const router = Router();
  router.get('/stats', async (_req, res) => {
    const [artworks, artists, workshopCounts, categories] = await Promise.all([
      Gallery.countDocuments(),
      User.countDocuments({ aType: 'artist' }),
      User.aggregate<{ total: number }>([
        {
          $group: {
            _id: null,
            total: { $sum: { $size: { $ifNull: ['$workshops', []] } } },
          },
        },
      ]),
      Gallery.distinct('category'),
    ]);
    res.json({
      artworks,
      artists,
      workshops: workshopCounts[0]?.total || 0,
      categories: categories.sort(),
    });
  });
  router.get('/artworks', async (req, res) => {
    if (
      Object.keys(req.query).some(
        (key) =>
          !['page', 'limit', 'search', 'category', 'artist'].includes(key),
      )
    )
      throw new HttpError(400, 'Unknown artwork filter.');
    const { page, limit, skip } = pageParameters(req.query);
    const filter: QueryFilter<GalleryRecord> = {};
    for (const field of ['category', 'artist'] as const) {
      if (req.query[field] !== undefined && req.query[field] !== '')
        filter[field] = textField(req.query, field);
    }
    if (req.query['search'] !== undefined && req.query['search'] !== '')
      filter.$text = { $search: textField(req.query, 'search', 120) };
    const [items, total] = await Promise.all([
      Gallery.find(filter).sort({ _id: -1 }).skip(skip).limit(limit),
      Gallery.countDocuments(filter),
    ]);
    res.json({
      items: items.map((art) => artworkSummary(art, req.user)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  });
  router.get('/artworks/:id', async (req, res) => {
    const art = requireDocument(
      await Gallery.findById(objectId(req.params['id'])),
      'Artwork not found.',
    );
    const artist = await User.findOne({ username: art.artist });
    res.json({
      artwork: publicArtwork(art, req.user),
      artist: artist ? publicUser(artist) : null,
    });
  });
  router.get('/artists/:id', async (req, res) => {
    const artist = requireDocument(
      await User.findById(objectId(req.params['id'])),
      'Artist not found.',
    );
    const artworks = await Gallery.find({ artist: artist.username })
      .sort({ _id: -1 })
      .limit(48);
    res.json(publicArtist(artist, artworks, req.user));
  });
  router.get('/workshops', async (req, res) => {
    const { page, limit, skip } = pageParameters(req.query);
    const [result] = await User.aggregate<{
      items: {
        _id: Types.ObjectId;
        username: string;
        workshops: EmbeddedWorkshop;
      }[];
      count: { total: number }[];
    }>([
      { $match: { 'workshops.0': { $exists: true } } },
      { $unwind: '$workshops' },
      { $sort: { _id: -1, 'workshops.name': 1 } },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limit },
            { $project: { username: 1, workshops: 1 } },
          ],
          count: [{ $count: 'total' }],
        },
      },
    ]);
    const total = result?.count[0]?.total || 0;
    const items = (result?.items || []).map((entry) =>
      publicWorkshop(entry.workshops, entry, req.user),
    );
    res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
  });
  router.get('/account', requireAuth, async (req, res) => {
    const user = req.user!;
    const [following, likes, artworks] = await Promise.all([
      User.find({ _id: { $in: user.following.map((person) => person._id) } }),
      Gallery.find({ _id: { $in: user.like.map((like) => like._id) } }),
      Gallery.find({ artist: user.username }).sort({ _id: -1 }).limit(48),
    ]);
    res.json({
      user: publicUser(user),
      following: following.map(publicUser),
      likes: likes.map((art) => artworkSummary(art, user)),
      reviews: user.reviews.map((review) => ({
        artworkId: String(review.artId),
        text: review.review,
      })),
      artworks: artworks.map((art) => artworkSummary(art, user)),
      workshops: user.workshops.map((workshop) =>
        publicWorkshop(workshop, user, user),
      ),
    });
  });
  router.patch('/account', requireAuth, async (req, res) => {
    const role = textField(req.body, 'role', 10);
    if (role !== 'patron' && role !== 'artist')
      throw new HttpError(400, 'Choose a patron or artist account.');
    const user = requireDocument(
      await User.findByIdAndUpdate(
        req.user!._id,
        { $set: { aType: role } },
        { returnDocument: 'after' },
      ),
      'Account not found.',
    );
    res.json({ user: publicUser(user) });
  });
  router.put('/artists/:id/follow', requireAuth, async (req, res) => {
    const artist = requireDocument(
      await User.findById(objectId(req.params['id'])),
      'Artist not found.',
    );
    if (artist.aType !== 'artist' || artist.username === req.user!.username)
      throw new HttpError(400, 'Choose another artist to follow.');
    await User.updateOne(
      { _id: req.user!._id, 'following.username': { $ne: artist.username } },
      {
        $push: {
          following: {
            _id: artist._id,
            username: artist.username,
            aType: 'artist',
          },
        },
      },
    );
    res.json({ following: true });
  });
  router.delete('/artists/:id/follow', requireAuth, async (req, res) => {
    const artist = requireDocument(
      await User.findById(objectId(req.params['id'])),
      'Artist not found.',
    );
    await User.updateOne(
      { _id: req.user!._id },
      { $pull: { following: { username: artist.username } } },
    );
    res.json({ following: false });
  });
  for (const method of ['put', 'delete'] as const) {
    router[method]('/artworks/:id/like', requireAuth, async (req, res) => {
      const id = objectId(req.params['id']);
      const art = requireDocument(
        await Gallery.findById(id),
        'Artwork not found.',
      );
      const liking = method === 'put';
      const result = await User.updateOne(
        { _id: req.user!._id, 'like._id': liking ? { $ne: id } : id },
        liking
          ? { $push: { like: { _id: art._id, name: art.name } } }
          : { $pull: { like: { _id: id } } },
      );
      if (result.modifiedCount)
        await Gallery.updateOne(
          { _id: id },
          liking ? { $push: { numLikes: 'like' } } : { $pop: { numLikes: -1 } },
        );
      const updated = requireDocument(
        await Gallery.findById(id),
        'Artwork not found.',
      );
      res.json({ liked: liking, likeCount: updated.numLikes.length });
    });
  }
  router.post('/artworks/:id/reviews', requireAuth, async (req, res) => {
    const id = objectId(req.params['id']);
    const review = textField(req.body, 'text', 2000);
    const art = requireDocument(
      await Gallery.findById(id),
      'Artwork not found.',
    );
    const entry = {
      reviewId: randomUUID(),
      user: req.user!.username,
      userId: req.user!._id,
      review,
    };
    await Gallery.updateOne({ _id: id }, { $push: { reviews: entry } });
    await User.updateOne(
      { _id: req.user!._id },
      {
        $push: {
          reviews: {
            reviewId: entry.reviewId,
            art: art.artist,
            artId: id,
            review,
          },
        },
      },
    );
    res.status(201).json(publicReview(entry, req.user));
  });
  router.delete(
    '/artworks/:id/reviews/:reviewId',
    requireAuth,
    async (req, res) => {
      const id = objectId(req.params['id']);
      const art = requireDocument(
        await Gallery.findById(id),
        'Artwork not found.',
      );
      const review = requireDocument(
        art.reviews.find((item) => reviewId(item) === req.params['reviewId']) ||
          null,
        'Review not found.',
      );
      if (review.user !== req.user!.username)
        throw new HttpError(403, 'You can only remove your own reviews.');
      const match = review.reviewId
        ? { reviewId: review.reviewId }
        : { review: review.review };
      await Gallery.updateOne(
        { _id: id },
        { $pull: { reviews: { ...match, user: req.user!.username } } },
      );
      await User.updateOne(
        { _id: req.user!._id },
        { $pull: { reviews: { ...match, artId: id } } },
      );
      res.sendStatus(204);
    },
  );
  router.post(
    '/artworks',
    requireAuth,
    artistOnly,
    upload.single('image'),
    async (req, res) => {
      const artwork = {
        name: textField(req.body, 'title'),
        year: textField(req.body, 'year', 4),
        category: textField(req.body, 'category'),
        medium: textField(req.body, 'medium'),
        description: textField(req.body, 'description', 10000),
      };
      if (!/^\d{1,4}$/.test(artwork.year))
        throw new HttpError(400, 'Year must contain up to four digits.');
      if (!req.file) throw new HttpError(400, 'Image upload is required.');
      if (await Gallery.exists({ name: artwork.name }))
        throw new HttpError(409, 'An artwork with that title already exists.');
      const filename = `${randomUUID()}${imageExtension(req.file.buffer)}`;
      const destination = path.join(uploadDirectory, filename);
      await writeFile(destination, req.file.buffer);
      try {
        const art = await Gallery.create({
          ...artwork,
          artist: req.user!.username,
          image: `/uploads/${filename}`,
        });
        res.status(201).json(publicArtwork(art, req.user));
      } catch (error) {
        await unlink(destination);
        throw error;
      }
    },
  );
  router.post('/workshops', requireAuth, artistOnly, async (req, res) => {
    const name = textField(req.body, 'name');
    const goal = textField(req.body, 'goal', 2000);
    const weeks: unknown = req.body?.weeks;
    if (
      typeof weeks !== 'number' ||
      !Number.isInteger(weeks) ||
      weeks < 1 ||
      weeks > 9999
    )
      throw new HttpError(400, 'Duration must be 1–9999 whole weeks.');
    const workshop = {
      workshopId: randomUUID(),
      name,
      goal,
      duration: String(weeks),
      user: req.user!.username,
      signed: [],
    };
    const result = await User.updateOne(
      { _id: req.user!._id, 'workshops.name': { $ne: name } },
      { $push: { workshops: workshop } },
    );
    if (!result.modifiedCount)
      throw new HttpError(409, 'A workshop with that name already exists.');
    res.status(201).json(publicWorkshop(workshop, req.user!, req.user));
  });
  router.put(
    '/artists/:id/workshops/:workshopId/registration',
    requireAuth,
    async (req, res) => {
      const artist = requireDocument(
        await User.findById(objectId(req.params['id'])),
        'Artist not found.',
      );
      const workshop = requireDocument(
        artist.workshops.find(
          (item) => workshopId(item) === req.params['workshopId'],
        ) || null,
        'Workshop not found.',
      );
      await User.updateOne(
        { _id: artist._id, 'workshops.name': workshop.name },
        { $addToSet: { 'workshops.$.signed': { name: req.user!.username } } },
      );
      const updated = requireDocument(
        await User.findById(artist._id),
        'Artist not found.',
      );
      res.json(
        publicWorkshop(
          updated.workshops.find((item) => item.name === workshop.name)!,
          updated,
          req.user,
        ),
      );
    },
  );
  return router;
}
