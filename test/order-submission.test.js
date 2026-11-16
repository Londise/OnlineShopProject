import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionKey, acknowledgeSubmission } from '../src/utils/order-submission.js';

const storage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key),
    values: () => [...map.values()] };
};
test('checkout retries keep a key, store no contact data, and acknowledge/new payload starts another attempt', async () => {
  const store = storage();
  const body = { customer: { name: 'Audit Customer', email: 'private@example.test' }, items: [{ variantId: 'one', quantity: 15 }] };
  const first = await submissionKey(body, store);
  assert.equal(await submissionKey(body, store), first);
  assert.ok(!store.values().join('').includes('private@example.test'));
  assert.ok(!store.values().join('').includes('Audit Customer'));
  assert.notEqual(await submissionKey({ ...body, note: 'changed' }, store), first);
  const current = await submissionKey(body, store);
  acknowledgeSubmission(current, store);
  assert.notEqual(await submissionKey(body, store), current);
});

test('unavailable session storage still retains the current retry key in memory', async () => {
  const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const body = { items: [{ variantId: 'private-storage', quantity: 15 }] };
  const key = await submissionKey(body, unavailable);
  assert.equal(await submissionKey(body, unavailable), key);
  acknowledgeSubmission(key, unavailable);
  assert.notEqual(await submissionKey(body, unavailable), key);
});
