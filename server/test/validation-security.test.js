import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bannerPatchSchema, bannerSchema, categoryPatchSchema, categorySchema,
  MAX_PRODUCT_VARIANTS, productOptionSchema, variantOptionPatchSchema, variantOptionSchema,
} from '../src/schemas/admin.schemas.js';
import { createOrderSchema } from '../src/schemas/order.schemas.js';
import { validate, validateQuery } from '../src/middlewares/validate.js';

const id = 'clxxxxxxxxxxxxxxxxxxxxxxx';

test('Zod 4 creation schemas retain defaults while PATCH schemas never insert omitted defaults', () => {
  const cases = [
    { create: categorySchema, patch: categoryPatchSchema, input: { name: 'Roupas', slug: 'roupas' }, defaults: { sortOrder: 0, active: true } },
    { create: variantOptionSchema, patch: variantOptionPatchSchema, input: { type: 'COLOR', name: 'Azul', slug: 'azul' }, defaults: { active: true } },
    { create: bannerSchema, patch: bannerPatchSchema, input: { assetId: id }, defaults: { sortOrder: 0, active: true } },
  ];
  for (const { create, patch, input, defaults } of cases) {
    assert.deepEqual(create.parse(input), { ...input, ...defaults });
    assert.deepEqual(patch.parse(input), input);
    assert.deepEqual(patch.parse({}), {});
    assert.deepEqual(patch.parse({ active: false }), { active: false });
  }
  assert.deepEqual(categoryPatchSchema.parse({ sortOrder: '0' }), { sortOrder: 0 });
  assert.deepEqual(bannerPatchSchema.parse({ title: null, startsAt: null }), { title: null, startsAt: null });
  assert.equal(bannerPatchSchema.parse({ startsAt: '2026-10-26T12:00:00Z' }).startsAt.toISOString(), '2026-10-26T12:00:00.000Z');
});

test('oversized product variants are rejected before validating individual elements', () => {
  const variant = { sizeId: id, sku: 'AZUL-M' };
  const input = { variantOptionId: id, variants: Array(MAX_PRODUCT_VARIANTS).fill(variant) };
  assert.equal(productOptionSchema.safeParse(input).success, true);
  assert.equal(productOptionSchema.safeParse({ ...input, variants: [] }).success, false);
  const unreadable = { get sizeId() { assert.fail('oversized arrays must not parse their elements'); } };
  const result = productOptionSchema.safeParse({ ...input, variants: Array(10_000).fill(unreadable) });
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
  assert.deepEqual(result.error.issues[0].path, ['variants']);
});

test('orders retain coercion, collection bounds, optional email and shipping validation', () => {
  const input = {
    customer: { name: 'Cliente', whatsapp: '(11) 99999-9999' },
    delivery: { method: 'EXCURSAO' }, items: [{ variantId: id, quantity: '15' }],
  };
  const parsed = createOrderSchema.parse(input);
  assert.equal(parsed.items[0].quantity, 15);
  assert.equal(parsed.customer.whatsapp, '11999999999');
  assert.equal(Object.hasOwn(parsed.customer, 'email'), false);
  assert.equal(createOrderSchema.safeParse({ ...input, items: Array(81).fill(input.items[0]) }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...input, delivery: { method: 'CORREIOS' } }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...input, customer: { ...input.customer, email: 'invalid' } }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...input, items: [{ variantId: id, quantity: 'not-a-number' }] }).success, false);
});

test('Zod 4 validation retains the 422 error contract and never includes the submitted values', () => {
  const req = { body: { active: 'secret-invalid-value' } };
  let error;
  validate(categoryPatchSchema)(req, {}, value => { error = value; });
  assert.equal(error.status, 422);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.deepEqual(error.details.formErrors, []);
  assert.ok(error.details.fieldErrors.active.length);
  assert.equal(JSON.stringify(error.details).includes('secret-invalid-value'), false);

  const query = { active: false };
  const queryReq = { get query() { return query; } };
  validateQuery(categoryPatchSchema)(queryReq, {}, value => { assert.equal(value, undefined); });
  assert.equal(queryReq.query, query);
  assert.deepEqual(queryReq.validatedQuery, { active: false });
});
