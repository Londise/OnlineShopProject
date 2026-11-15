import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, closeDatabase, serve, createApp, catalogFixture, sessionFixture, orderInput } from '../../test-support/integration.js';

beforeEach(resetDatabase);
after(closeDatabase);
const post = (data, cookie = '') => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(data) });

const fakeShippingQuote = ({ postalCode, pieces }) => Promise.resolve({
  originPostalCode: '03031000',
  pieces,
  options: [
    { key: 'Correios|PAC|1', company: 'Correios', service: 'PAC', price: 21.9, days: 5, volumes: 1 },
    { key: 'Jadlog|.Package|1', company: 'Jadlog', service: '.Package', price: 25.4, days: 3, volumes: 1 },
    { key: 'Correios|SEDEX|1', company: 'Correios', service: 'SEDEX', price: 30.1, days: 2, volumes: 1 },
  ],
});

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
    { ...valid, delivery: { method: 'CORREIOS', postalCode: '01001000' } },
    { ...valid, delivery: { method: 'CORREIOS', postalCode: '01001000', shippingQuote: { company: '', service: 'PAC', volumes: 1 } } },
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

test('O5: the public quote endpoint returns the two cheapest options from the server quoter', async t => {
  const api = await serve(createApp({ shippingQuote: fakeShippingQuote })); t.after(api.close);
  const response = await api.request('/api/v1/shipping/quote', post({ postalCode: '01310-100', pieces: 15 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.originPostalCode, '03031000');
  assert.equal(body.pieces, 15);
  assert.deepEqual(body.options.map(option => option.key), ['Correios|PAC|1', 'Jadlog|.Package|1']);
  assert.deepEqual(body.options.map(option => option.volumes), [1, 1]);
  const invalid = await api.request('/api/v1/shipping/quote', post({ postalCode: '01310-100', pieces: 9 }));
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
  const overLimit = await api.request('/api/v1/shipping/quote', post({ postalCode: '01310-100', pieces: 401 }));
  assert.equal(overLimit.status, 422);
});

test('O5: CORREIOS orders persist the server-quoted estimate and reject stale or missing quotes', async t => {
  const { variant } = await catalogFixture(); const api = await serve(createApp({ shippingQuote: fakeShippingQuote })); t.after(api.close);
  const response = await api.request('/api/v1/orders', post({
    ...orderInput(variant.id),
    delivery: { method: 'CORREIOS', postalCode: '01310-100', shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1 } },
  }));
  assert.equal(response.status, 201);
  const { order } = await response.json();
  assert.equal(order.shippingAmountCents, 2190);
  assert.equal(order.shippingDetail, 'Frete estimado: Correios PAC · 1 volume');
  assert.equal(order.totalCents, 37500 + 2190);
  const persisted = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
  assert.equal(persisted.shippingAmountCents, 2190);
  const stale = await api.request('/api/v1/orders', post({
    ...orderInput(variant.id),
    delivery: { method: 'CORREIOS', postalCode: '01310-100', shippingQuote: { company: 'Loggi', service: 'X', volumes: 1 } },
  }));
  assert.equal(stale.status, 422);
  assert.equal((await stale.json()).error.code, 'SHIPPING_QUOTE_CHANGED');
});

test('O5: CORREIOS orders fail cleanly when freight quoting is unavailable and persist nothing', async t => {
  const { variant } = await catalogFixture();
  // Sem MELHOR_ENVIO_TOKEN o cotador real recusa a consulta.
  const api = await serve(); t.after(api.close);
  const response = await api.request('/api/v1/orders', post({
    ...orderInput(variant.id),
    delivery: { method: 'CORREIOS', postalCode: '01310-100', shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1 } },
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'SHIPPING_UNAVAILABLE');
  assert.equal(await prisma.order.count(), 0);
  assert.equal(await prisma.inventoryMovement.count(), 0);
});

test('O5: creation ignores client freight prices and persists the recalculated server amount', async t => {
  const { variant } = await catalogFixture();
  const quoteShipping = async input => {
    const result = await fakeShippingQuote(input);
    result.options[0].price = 35.5;
    return result;
  };
  const api = await serve(createApp({ shippingQuote: quoteShipping })); t.after(api.close);
  const response = await api.request('/api/v1/orders', post({
    ...orderInput(variant.id),
    shippingAmountCents: 0, totalCents: 1,
    delivery: {
      method: 'CORREIOS', postalCode: '01310-100', price: 0,
      shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1, price: 0, amountCents: 0 },
    },
  }));
  assert.equal(response.status, 201);
  const { order } = await response.json();
  assert.equal(order.shippingAmountCents, 3550);
  assert.equal(order.totalCents, 37500 + 3550);
  const persisted = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(persisted.shippingAmountCents, 3550);
});

test('O1: orders outside the 10–400 piece range are rejected with the matching code', async t => {
  const { variant } = await catalogFixture(); const api = await serve(); t.after(api.close);
  const below = await api.request('/api/v1/orders', post(orderInput(variant.id, 9)));
  assert.equal(below.status, 422);
  assert.equal((await below.json()).error.code, 'MINIMUM_ORDER');
  const above = await api.request('/api/v1/orders', post({ ...orderInput(variant.id), items: [{ variantId: variant.id, quantity: 300 }, { variantId: variant.id, quantity: 101 }] }));
  assert.equal(above.status, 422);
  assert.equal((await above.json()).error.code, 'MAXIMUM_ORDER');
  assert.equal(await prisma.order.count(), 0);
});
