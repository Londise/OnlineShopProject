import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, closeDatabase, serve, catalogFixture, sessionFixture, orderInput } from '../../test-support/integration.js';
import { shippingCases } from '../../../test/support/shipping-cases.js';

beforeEach(resetDatabase);
after(closeDatabase);
const post = (data, cookie = '') => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(data) });

test('O2: invalid order payloads fail at the HTTP boundary without persisting business effects', async t => {
  const { variant } = await catalogFixture(); const api = await serve(); t.after(api.close);
  const valid = orderInput(variant.id);
  const cases = [
    ...[0, -1, .5, 'not-a-number', 1000].map(quantity => ({ ...valid, items: [{ variantId: variant.id, quantity }] })),
    { ...valid, items: [] }, { ...valid, items: Array.from({ length: 81 }, () => valid.items[0]) },
    { ...valid, items: [{ variantId: 'invalid', quantity: 15 }] },
    { ...valid, customer: { ...valid.customer, name: '' } },
    { ...valid, customer: { ...valid.customer, whatsapp: '123' } },
    { ...valid, customer: { ...valid.customer, email: 'sensitive-invalid-input' } },
    { ...valid, delivery: { method: 'CORREIOS' } },
  ];
  for (const input of cases) {
    const response = await api.request('/api/v1/orders', post(input));
    assert.equal(response.status, 422);
    const payload = await response.json(); assert.equal(payload.error.code, 'VALIDATION_ERROR');
    assert.ok(!JSON.stringify(payload).includes('sensitive-invalid-input'));
  }
  assert.equal(await prisma.order.count(), 0); assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 0);
});

test('O2/O4: normalized quantity/WhatsApp are accepted but client prices and totals are not authoritative', async t => {
  const { variant } = await catalogFixture(); const api = await serve(); t.after(api.close);
  const input = orderInput(variant.id);
  input.items = [{ variantId: variant.id, quantity: '15', priceCents: 1 }];
  input.customer.whatsapp = '(11) 99999-8888'; input.totalCents = 1;
  const response = await api.request('/api/v1/orders', post(input));
  assert.equal(response.status, 201);
  const { order } = await response.json();
  assert.equal(order.customerWhatsApp, '11999998888'); assert.equal(order.totalCents, 37500);
  assert.equal(order.items[0].quantity, 15); assert.equal(order.items[0].unitPriceCentsSnapshot, 2500);
});

test('A3: option creation accepts 80 variants and atomically rejects oversized or partially duplicated batches', async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const globalOption = await prisma.variantOption.create({ data: { type: 'COLOR', name: 'Rose', slug: 'rose' } });
  await prisma.size.createMany({ data: Array.from({ length: 80 }, (_, index) => ({ code: `custom-${index}`, sortOrder: index })) });
  const sizes = await prisma.size.findMany({ where: { code: { startsWith: 'custom-' } }, orderBy: { sortOrder: 'asc' } });
  const variants = sizes.map((size, index) => ({ sizeId: size.id, sku: `ROSE-${index}`, openingStock: index === 0 ? 5 : 0 }));
  const path = `/api/v1/admin/products/${f.product.id}/options`;
  const tooLarge = await api.request(path, post({ variantOptionId: globalOption.id, variants: [...variants, variants[0]] }, admin.cookie));
  assert.equal(tooLarge.status, 422);
  assert.equal(await prisma.productOption.count(), 1);
  const accepted = await api.request(path, post({ variantOptionId: globalOption.id, variants }, admin.cookie));
  assert.equal(accepted.status, 201);
  const { option } = await accepted.json();
  assert.equal(await prisma.productVariant.count({ where: { productOptionId: option.id } }), 80);
  assert.equal(await prisma.inventoryLevel.count({ where: { variant: { productOptionId: option.id } } }), 80);
  const movements = await prisma.inventoryMovement.findMany();
  assert.equal(movements.length, 1); assert.equal(movements[0].type, 'INITIAL'); assert.equal(movements[0].onHandDelta, 5);
  const other = await prisma.variantOption.create({ data: { type: 'COLOR', name: 'Vinho', slug: 'vinho' } });
  const duplicates = sizes.slice(0, 2).map(size => ({ sizeId: size.id, sku: 'DUPLICATED-SKU', openingStock: 3 }));
  const failed = await api.request(path, post({ variantOptionId: other.id, variants: duplicates }, admin.cookie));
  assert.equal(failed.status, 409);
  assert.equal(await prisma.productOption.count({ where: { variantOptionId: other.id } }), 0);
  assert.equal(await prisma.productVariant.count({ where: { sku: 'DUPLICATED-SKU' } }), 0);
  assert.equal(await prisma.inventoryMovement.count(), 1);
  const repeatedSize = await api.request(path, post({ variantOptionId: other.id, variants: [
    { sizeId: sizes[0].id, sku: 'DISTINCT-A', openingStock: 3 },
    { sizeId: sizes[0].id, sku: 'DISTINCT-B', openingStock: 4 },
  ] }, admin.cookie));
  assert.equal(repeatedSize.status, 409);
  assert.equal(await prisma.productOption.count({ where: { variantOptionId: other.id } }), 0);
  assert.equal(await prisma.productVariant.count({ where: { sku: { in: ['DISTINCT-A', 'DISTINCT-B'] } } }), 0);
  assert.equal(await prisma.inventoryLevel.count(), 81); // original + the accepted 80; neither failed batch adds inventory
  assert.equal(await prisma.inventoryMovement.count(), 1);
});

for (const { postalCode, grams, cents } of shippingCases) test(`O5: HTTP order for ${postalCode}/${grams} g persists ${cents} shipping cents`, async t => {
  const f = await catalogFixture();
  await prisma.product.update({ where: { id: f.product.id }, data: { weightGrams: 1 } });
  const extra = await prisma.product.create({ data: { categoryId: f.category.id, name: 'Weighted product', slug: 'weighted', material: 'Linho', priceCents: 2500, weightGrams: grams - 14 } });
  const option = await prisma.productOption.create({ data: { productId: extra.id, variantOptionId: f.option.id } });
  const variant = await prisma.productVariant.create({ data: { productOptionId: option.id, sizeId: f.size.id, sku: 'WEIGHTED', inventory: { create: { onHand: 30 } } } });
  const api = await serve(); t.after(api.close);
  const response = await api.request('/api/v1/orders', post({ ...orderInput(f.variant.id), delivery: { method: 'CORREIOS', postalCode }, items: [{ variantId: f.variant.id, quantity: 14 }, { variantId: variant.id, quantity: 1 }] }));
  assert.equal(response.status, 201);
  const { order } = await response.json();
  assert.equal(order.items.reduce((sum, item) => sum + item.quantity * item.unitWeightGramsSnapshot, 0), grams);
  assert.equal(order.shippingAmountCents, cents);
  const persisted = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
  assert.equal(persisted.shippingAmountCents, cents);
  assert.equal(persisted.items.reduce((sum, item) => sum + item.quantity * item.unitWeightGramsSnapshot, 0), grams);
  assert.equal(order.totalCents, 37500 + cents);
});
