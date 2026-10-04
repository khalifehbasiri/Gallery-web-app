import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectionImages } from '../shared/collection-images.js';
import { imageType, maxImageBytes } from '../server/src/storage.js';

test('all curated images match their source digests and valid bounded JPEGs', async () => {
  assert.equal(new Set(collectionImages.map((image) => image.id)).size, 24);
  for (const image of collectionImages) {
    const bytes = await readFile(`client/public/artworks/${image.file}`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      image.sha256,
    );
    assert.equal(imageType(bytes), 'image/jpeg');
    assert.ok(bytes.length > 0 && bytes.length <= maxImageBytes);
    assert.equal(new URL(image.sourceUrl).hostname, 'www.metmuseum.org');
    assert.equal(new URL(image.downloadUrl).hostname, 'images.metmuseum.org');
    assert.equal(image.license, 'CC0 1.0');
    assert.ok(image.width > 0 && image.height > 0 && image.alt);
  }
});
