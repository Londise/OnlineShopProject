import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { inspectImage } from '../src/lib/images.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwMMeFkAzXYj3br64kYAAAAASUVORK5CYII=', 'base64');
test('U1: image metadata and checksum describe the re-encoded output served to Storage', async () => {
  const result = await inspectImage(png);
  assert.deepEqual({ mimeType: result.mimeType, extension: result.extension, width: result.width, height: result.height },
    { mimeType: 'image/png', extension: 'png', width: 3, height: 4 });
  const expected = await sharp(png).rotate().toFormat('png').toBuffer();
  assert.equal(result.byteSize, expected.length);
  assert.equal(result.checksumSha256, createHash('sha256').update(expected).digest('hex'));
  assert.deepEqual(result.buffer, expected);
});
for (const [format, mime] of [['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) test(`U1: real ${format} bytes are accepted regardless of the upload filename`, async () => {
  const bytes = await sharp(png)[format]().toBuffer();
  const result = await inspectImage(bytes);
  assert.equal(result.mimeType, mime); assert.equal(result.width, 3); assert.equal(result.height, 4);
});
test('U1: EXIF metadata never reaches Storage', async () => {
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'PRIVATE-GPS-DO-NOT-LEAK' } } }).toBuffer();
  assert.ok(source.includes(Buffer.from('PRIVATE-GPS-DO-NOT-LEAK')), 'fixture must embed EXIF');
  const result = await inspectImage(source);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.ok(!result.buffer.includes(Buffer.from('PRIVATE-GPS-DO-NOT-LEAK')), 'EXIF strings must be stripped');
  assert.ok(!result.buffer.includes(Buffer.from([0xff, 0xe1])), 'no EXIF APP1 segment may remain');
});
test('U1: text, SVG, incomplete images, empty files and oversized uploads are rejected', async () => {
  for (const bytes of [Buffer.from('not a jpeg'), Buffer.from('<svg/>'), png.subarray(0, 40)]) {
    await assert.rejects(inspectImage(bytes), { code: 'INVALID_IMAGE' });
  }
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(5242881)]) await assert.rejects(inspectImage(bytes), { code: 'IMAGE_SIZE' });
});
test('U1: an animated WebP cannot bypass the static-image restriction', async () => {
  const bytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(bytes, { animated: true }).metadata()).pages, 2, 'fixture must contain two frames');
  await assert.rejects(inspectImage(bytes), { code: 'INVALID_IMAGE' });
});
test('U1: dimensions above 16 megapixels are rejected even for a small compressed file', async () => {
  const bytes = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(inspectImage(bytes), { code: 'INVALID_IMAGE' });
});
