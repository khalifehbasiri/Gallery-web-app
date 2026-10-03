import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Sql } from './database.js';
import { HttpError } from './http.js';
export const maxImageBytes = 5 * 1024 * 1024;
export const imageTypes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];
export function imageType(buffer: Buffer) {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)))
    return 'image/gif';
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new HttpError(400, 'Upload a PNG, JPEG, GIF, or WebP image.');
}
export interface ImageStorage {
  reserve(path: string, type: string): Promise<string>;
  inspect(path: string, type: string, bytes: number): Promise<void>;
  publish(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}
export function supabaseStorage(config: Config): ImageStorage {
  if (!config.supabaseUrl || !config.supabaseServiceKey)
    throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const staging = client.storage.from(`${config.storageBucket}-pending`),
    publicBucket = client.storage.from(config.storageBucket);
  return {
    async reserve(path) {
      const { data, error } = await staging.createSignedUploadUrl(path, {
        upsert: false,
      });
      if (error) throw error;
      return data.signedUrl;
    },
    async inspect(path, type, bytes) {
      const { data: meta, error } = await staging.info(path);
      if (error) throw error;
      if (
        !meta ||
        Number(meta['size']) !== bytes ||
        bytes > maxImageBytes ||
        meta['contentType'] !== type
      )
        throw new HttpError(
          400,
          'Uploaded image does not match its reservation.',
        );
      const { data, error: downloadError } = await staging.download(path);
      if (downloadError) throw downloadError;
      if (
        !data ||
        data.size !== bytes ||
        imageType(Buffer.from(await data.arrayBuffer())) !== type
      )
        throw new HttpError(400, 'Invalid image content.');
    },
    async publish(path) {
      const { data, error } = await staging.download(path);
      if (error) throw error;
      const uploaded = await publicBucket.upload(path, data!, {
        contentType: data!.type,
        upsert: false,
        cacheControl: '31536000',
      });
      if (uploaded.error) throw uploaded.error;
      // Remove the staging copy after promotion; failure cannot affect public authorization.
      await staging.remove([path]);
      return publicBucket.getPublicUrl(path).data.publicUrl;
    },
    async remove(path) {
      const results = await Promise.all([
        staging.remove([path]),
        publicBucket.remove([path]),
      ]);
      for (const result of results) if (result.error) throw result.error;
    },
  };
}
export async function reserveUpload(
  sql: Sql,
  storage: ImageStorage,
  userId: string,
  type: unknown,
  bytes: unknown,
) {
  if (
    typeof type !== 'string' ||
    !imageTypes.includes(type) ||
    typeof bytes !== 'number' ||
    !Number.isInteger(bytes) ||
    bytes < 1 ||
    bytes > maxImageBytes
  )
    throw new HttpError(
      400,
      'Choose a PNG, JPEG, GIF, or WebP image of at most 5 MB.',
    );
  const id = randomUUID(),
    path = `${userId}/${id}.${type.split('/')[1]}`;
  await sql.transaction(async (tx) => {
    await tx.query('SELECT id FROM gallery.users WHERE id=$1 FOR UPDATE', [
      userId,
    ]);
    const quota = (
      await tx.query(
        'SELECT count(*)::int AS count FROM gallery.uploads WHERE user_id=$1 AND expires_at>now()',
        [userId],
      )
    ).rows[0]!;
    if (Number(quota['count']) >= 10)
      throw new HttpError(
        429,
        'Upload limit reached. Please wait before uploading again.',
      );
    await tx.query(
      'INSERT INTO gallery.uploads (id,user_id,path,content_type,max_bytes,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, userId, path, type, bytes, new Date(Date.now() + 15 * 60000)],
    );
  });
  const url = await storage.reserve(path, type);
  return { id, url };
}
