import test from 'node:test';
import assert from 'node:assert/strict';
import { getImageSrcSet, getImageVariant, IMAGE_PLACEHOLDER } from '../src/config/media.js';

const original = 'https://itqzotexupaawiofqltc.supabase.co/storage/v1/object/public/storefront-images/product/example/photo.jpeg';

test('image variants preserve the original aspect ratio without cropping', () => {
  const transformed = new URL(getImageVariant(original, {
    width: 320,
    sourceWidth: 1066,
    sourceHeight: 1600,
  }));
  assert.equal(transformed.origin, 'https://itqzotexupaawiofqltc.supabase.co');
  assert.equal(transformed.pathname, '/storage/v1/render/image/public/storefront-images/product/example/photo.jpeg');
  assert.equal(transformed.searchParams.get('width'), '320');
  assert.equal(transformed.searchParams.get('height'), '480');
  assert.equal(transformed.searchParams.get('resize'), 'contain');
  assert.equal(transformed.searchParams.get('quality'), '75');
});

test('responsive sources never upscale and retain a full-size candidate', () => {
  const sources = getImageSrcSet(original, {
    sourceWidth: 595,
    sourceHeight: 595,
    widths: [320, 480, 640, 480],
  }).split(', ');
  assert.deepEqual(sources.map(source => source.split(' ')[1]), ['320w', '480w', '595w']);
  for (const source of sources) {
    const url = new URL(source.split(' ')[0]);
    assert.equal(url.searchParams.get('width'), url.searchParams.get('height'));
  }
});

test('unknown images and missing metadata keep their safe original URL', () => {
  assert.equal(getImageVariant(IMAGE_PLACEHOLDER, { width: 320, sourceWidth: 600, sourceHeight: 800 }), IMAGE_PLACEHOLDER);
  assert.equal(getImageVariant('https://example.test/image.jpg', { width: 320, sourceWidth: 600, sourceHeight: 800 }), 'https://example.test/image.jpg');
  assert.equal(getImageVariant(original, { width: 320 }), original);
  assert.equal(getImageSrcSet(original, { widths: [320] }), '');
  assert.equal(getImageSrcSet('https://example.test/image.jpg', { sourceWidth: 600, sourceHeight: 800 }), '');
});
