import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadCapacity } from '../src/lib/upload-capacity.js';

test('upload capacity is bounded and each slot is released only once', () => {
  const capacity = createUploadCapacity(1);
  const release = capacity.acquire();
  assert.equal(capacity.active(), 1);
  assert.equal(capacity.acquire(), null);
  release(); release();
  assert.equal(capacity.active(), 0);
  const second = capacity.acquire();
  assert.equal(typeof second, 'function');
  second();
});
