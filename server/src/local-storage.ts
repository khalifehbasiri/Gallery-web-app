import express from 'express';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { imageType, maxImageBytes, type ImageStorage } from './storage.js';
import { HttpError } from './http.js';
// Credential-free demo only. Production uses private, signed Supabase uploads.
export function localStorage(directory: string, origin: string) {
  const reservations = new Map<string, string>();
  const file = (key: string) => path.join(directory, path.basename(key));
  const storage: ImageStorage = {
    async reserve(key, type) {
      reservations.set(path.basename(key), type);
      return `${origin}/demo-upload/${path.basename(key)}`;
    },
    async inspect(key, type, bytes) {
      const data = await readFile(file(key));
      if (data.length !== bytes || imageType(data) !== type)
        throw new HttpError(400, 'Invalid image content.');
    },
    async publish(key) {
      return `/uploads/${path.basename(key)}`;
    },
    async remove(key) {
      await unlink(file(key)).catch(() => {});
    },
  };
  const router = express.Router();
  router.put(
    '/:file',
    express.raw({ type: () => true, limit: maxImageBytes }),
    async (req, res) => {
      const key = String(req.params['file']);
      if (!reservations.has(key)) throw new HttpError(404, 'Upload not found.');
      if (
        !Buffer.isBuffer(req.body) ||
        imageType(req.body) !== reservations.get(key)
      )
        throw new HttpError(400, 'Invalid image content.');
      await writeFile(file(key), req.body, { flag: 'wx' });
      reservations.delete(key);
      res.sendStatus(200);
    },
  );
  return { storage, router };
}
