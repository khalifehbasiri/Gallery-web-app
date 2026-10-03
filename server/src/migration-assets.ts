import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { imageType, maxImageBytes } from './storage.js';
import type { Config } from './config.js';
import type { Snapshot } from './migration.js';
// Operator-only migration command. HTTP hosts require an explicit allowlist;
// redirects are rejected to keep private network targets outside the exporter.
export async function prepareSnapshotAssets(
  snapshot: Snapshot,
  config: Config,
  hosts: string[],
) {
  if (!config.supabaseUrl || !config.supabaseServiceKey)
    throw new Error('Configure Supabase storage credentials.');
  const copy = structuredClone(snapshot),
    bucket = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from(config.storageBucket);
  let total = 0;
  for (const art of copy.artworks) {
    if (
      art.imageUrl.startsWith(
        `${config.supabaseUrl}/storage/v1/object/public/${config.storageBucket}/`,
      )
    )
      continue;
    let bytes: Buffer;
    if (art.imageUrl.startsWith('/uploads/')) {
      const root = await realpath('uploads'),
        target = await realpath(
          path.resolve('uploads', art.imageUrl.slice('/uploads/'.length)),
        );
      if (!target.startsWith(root + path.sep))
        throw new Error('Image path escapes uploads directory.');
      if ((await stat(target)).size > maxImageBytes)
        throw new Error('Legacy image exceeds 5 MB.');
      bytes = await readFile(target);
    } else {
      const url = new URL(art.imageUrl);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443') ||
        !hosts.includes(url.hostname)
      )
        throw new Error(
          'Add the trusted HTTPS source hostname to MIGRATION_IMAGE_HOSTS before copying remote images.',
        );
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.body)
        throw new Error(
          'Legacy image is unavailable. Restore it locally before migration.',
        );
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxImageBytes) throw new Error('Legacy image exceeds 5 MB.');
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks);
    }
    if (bytes.length > maxImageBytes)
      throw new Error('Legacy image exceeds 5 MB.');
    total += bytes.length;
    if (total > 50 * 1024 * 1024)
      throw new Error('Split asset migration into batches of at most 50 MB.');
    const type = imageType(bytes),
      digest = createHash('sha256').update(bytes).digest('hex'),
      objectPath = `migrated/${art.id}-${digest}.${type.split('/')[1]}`;
    const uploaded = await bucket.upload(objectPath, bytes, {
      contentType: type,
      upsert: false,
      cacheControl: '31536000',
    });
    if (
      uploaded.error &&
      String((uploaded.error as { statusCode?: string }).statusCode) !== '409'
    )
      throw uploaded.error;
    art.imageUrl = bucket.getPublicUrl(objectPath).data.publicUrl;
  }
  return copy;
}
