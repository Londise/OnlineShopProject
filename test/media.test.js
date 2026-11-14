import test from 'node:test';
import assert from 'node:assert/strict';
import { getImageSrcSet, getImageVariant, IMAGE_PLACEHOLDER } from '../src/config/media.js';

const original = 'https://images-test.supabase.co/storage/v1/object/public/storefront-images/product/example/photo.jpeg';

test('image variants preserve the original aspect ratio without cropping', () => {
  const transformed = new URL(getImageVariant(original, {
    width: 320,
    sourceWidth: 1066,
    sourceHeight: 1600,
  }));
  assert.equal(transformed.origin, 'https://images-test.supabase.co');
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

test('I1: transforms clamp dimensions and quality without upscaling', () => {
  for (const [quality, expected] of [[0, '20'], [101, '100']]) {
    const url = new URL(getImageVariant(original, { width: 1000, sourceWidth: 600, sourceHeight: 900, quality }));
    assert.equal(url.searchParams.get('width'), '600');
    assert.equal(url.searchParams.get('height'), '900');
    assert.equal(url.searchParams.get('quality'), expected);
  }
});

test('I1/I2: unsupported URLs and invalid dimensions never create broken transformed sources', () => {
  for (const src of [original.replace('https:', 'http:'), '/local.png', 'not a URL', original.replace('/object/public/', '/object/private/')]) {
    assert.equal(getImageVariant(src, { width: 320, sourceWidth: 600, sourceHeight: 800 }), src);
    assert.equal(getImageSrcSet(src, { sourceWidth: 600, sourceHeight: 800 }), '');
  }
  for (const value of [0, -1, NaN, Infinity, null, '600']) {
    assert.equal(getImageVariant(original, { width: 320, sourceWidth: value, sourceHeight: 800 }), original);
    assert.equal(getImageSrcSet(original, { sourceWidth: 600, sourceHeight: value }), '');
  }
  const sources = getImageSrcSet(original, { sourceWidth: 595, sourceHeight: 800, widths: [480, 320, 480, -1, NaN, 900] }).split(', ');
  assert.deepEqual(sources.map(source => Number(source.split(' ')[1].replace('w', ''))), [320, 480, 595]);
  for (const source of sources) assert.equal(new URL(source.split(' ')[0]).searchParams.get('width'), source.split(' ')[1].replace('w', ''));
});
