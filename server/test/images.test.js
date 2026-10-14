import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { inspectImage, MAX_IMAGE_BYTES } from "../src/lib/images.js";

test("image validation decodes actual bytes and reports dimensions/checksum", async () => {
  const buffer=await sharp({create:{width:3,height:4,channels:3,background:"white"}}).png().toBuffer();
  const result=await inspectImage(buffer);
  assert.equal(result.width,3);assert.equal(result.height,4);
  assert.equal(result.mimeType,"image/png");assert.equal(result.byteSize,buffer.length);
  assert.match(result.checksumSha256,/^[a-f0-9]{64}$/);
});
test("rejects arbitrary text, SVG, truncated files and oversized uploads", async () => {
  for(const bytes of [Buffer.from("not a jpeg"),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),Buffer.from([137,80,78,71]),Buffer.alloc(MAX_IMAGE_BYTES+1)]) {
    await assert.rejects(inspectImage(bytes), error=>["INVALID_IMAGE","IMAGE_SIZE"].includes(error.code));
  }
});
