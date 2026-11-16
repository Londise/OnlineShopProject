import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { behindLock } from '../../test-support/concurrency.js';
import { prisma, owner, resetDatabase, closeDatabase, serve, catalogFixture, orderInput, sessionFixture } from '../../test-support/integration.js';
import { createOrder, updateOrder as update, archiveOrder as archive } from '../../src/services/order.service.js';

let actor;
const updateOrder = (id, input) => update(id, input, actor);
const archiveOrder = id => archive(id, actor);
// Cotador injetável para os casos em que a criação usa o método CORREIOS:
// o preço retornado é sempre o preço autoritativo do servidor.
const quoteShipping = (price) => () => Promise.resolve({
  options: [{ key: 'Correios|PAC|1', company: 'Correios', service: 'PAC', price, days: 5, volumes: 1 }],
});
beforeEach(async () => {
  await resetDatabase();
  actor = await prisma.user.create({ data: { name: 'Gestora', email: 'admin@example.test', passwordHash: 'unused-service-fixture', role: 'ADMIN' } });
});
after(closeDatabase);

test('D1: committed migrations support the real runtime role and health query', async t => {
  const [{ current_user: role }] = await prisma.$queryRaw`SELECT current_user`;
  assert.equal(role, 'ferchu_test_runtime');
  const api = await serve();
  t.after(api.close);
  const response = await api.request('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('O1/O4: repeated variants aggregate into one waiting snapshot without reserving stock', async () => {
  const { variant } = await catalogFixture();
  const input = orderInput(variant.id);
  await assert.rejects(createOrder(orderInput(variant.id, 9)), { code: 'MINIMUM_ORDER' });
  assert.equal(await prisma.order.count(), 0);
  input.items = [{ variantId: variant.id, quantity: 8 }, { variantId: variant.id, quantity: 7 }];
  const result = await createOrder(input);
  assert.equal(result.totalCents, 37500);
  assert.equal(result.shippingAmountCents, null);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 15);
  assert.equal(result.items[0].productNameSnapshot, 'Calça Linho');
  assert.equal(result.items[0].unitWeightGramsSnapshot, 400);
  const stock = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
  assert.equal(stock.onHand, 30);
  assert.equal(stock.reserved, 0);
  assert.deepEqual(await prisma.inventoryMovement.findMany(), []);
  assert.equal(await prisma.auditLog.count({ where: { orderId: result.id } }), 1);
  await assert.rejects(updateOrder(result.id, { items: [{ variantId: variant.id, quantity: 9 }] }), { code: 'MINIMUM_ORDER' });
  await assert.rejects(updateOrder(result.id, { items: [{ variantId: variant.id, quantity: 401 }] }), { code: 'MAXIMUM_ORDER' });
  assert.equal((await prisma.orderItem.findFirst({ where: { orderId: result.id } })).quantity, 15);
});

const states = ['NOVO', 'CONFIRMADO', 'CANCELADO', 'CONCLUIDO'];
const transitions = {
  'NOVO:CONFIRMADO': [15, 0], 'NOVO:CANCELADO': [30, 0],
  'CONFIRMADO:CANCELADO': [30, 0], 'CONFIRMADO:CONCLUIDO': [15, 0],
  'CANCELADO:NOVO': [30, 0],
};
for (const from of states) for (const to of states) {
  test(`O6: ${from} → ${to} preserves inventory invariants`, async () => {
    const { variant } = await catalogFixture();
    const order = await createOrder(orderInput(variant.id));
    if (from === 'CONFIRMADO' || from === 'CONCLUIDO') await updateOrder(order.id, { status: 'CONFIRMADO' });
    if (from === 'CANCELADO') await updateOrder(order.id, { status: 'CANCELADO' });
    if (from === 'CONCLUIDO') await updateOrder(order.id, { status: 'CONCLUIDO' });
    const before = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
    const movementCount = await prisma.inventoryMovement.count();
    const expected = transitions[`${from}:${to}`];
    if (from === to || expected) {
      const changed = await updateOrder(order.id, { status: to });
      assert.equal(changed.status, to);
      const stock = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
      assert.deepEqual([stock.onHand, stock.reserved], expected ?? [before.onHand, before.reserved]);
      if (from === to) assert.equal(await prisma.inventoryMovement.count(), movementCount);
    } else {
      await assert.rejects(updateOrder(order.id, { status: to }), { code: 'INVALID_STATUS_TRANSITION' });
      assert.deepEqual(await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } }), before);
      assert.equal(await prisma.inventoryMovement.count(), movementCount);
    }
  });
}

test('O9: a real audit failure rolls back order, snapshot, inventory and movement writes', async () => {
  const { variant } = await catalogFixture();
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$`);
  await owner.$executeRawUnsafe(`CREATE TRIGGER test_audit BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_audit()`);
  try {
    await assert.rejects(createOrder(orderInput(variant.id)), /test audit failure/);
    assert.equal(await prisma.order.count(), 0);
    assert.equal(await prisma.orderItem.count(), 0);
    assert.equal(await prisma.inventoryMovement.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);
    assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 0);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_audit ON app.audit_logs');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_audit()');
  }
});

for (const status of ['NOVO', 'CONFIRMADO', 'CANCELADO']) test(`O9: failed ${status} edit audit rolls back items, payment, stock and history together`, async () => {
  const { variant, productOption } = await catalogFixture();
  const size = await prisma.size.create({ data: { code: 'G' } });
  const second = await prisma.productVariant.create({ data: { productOptionId: productOption.id, sizeId: size.id,
    sku: 'EDIT-SECOND', priceCents: 3500, inventory: { create: { onHand: 30 } } } });
  const order = await createOrder(orderInput(variant.id));
  if (status !== 'NOVO') await updateOrder(order.id, { status });
  const before = await persistedOrderState();
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action = 'UPDATED' THEN RAISE EXCEPTION 'test edit audit failure'; END IF; RETURN NEW; END $$`);
  await owner.$executeRawUnsafe('CREATE TRIGGER test_edit BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_edit()');
  try {
    await assert.rejects(updateOrder(order.id, { paidAmountCents: 1234, note: 'Must roll back',
      items: [{ variantId: variant.id, quantity: 10 }, { variantId: second.id, quantity: 5 }] }), /test edit audit failure/);
    assert.deepEqual(await persistedOrderState(), before);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_edit ON app.audit_logs');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_edit()');
  }
});

test('O10: two simultaneous confirmations cannot both consume insufficient shared stock', async () => {
  const { variant } = await catalogFixture({ onHand: 20 });
  const first = await createOrder(orderInput(variant.id)), second = await createOrder(orderInput(variant.id));
  const results = await behindLock(tx => tx.$queryRaw`SELECT variant_id FROM app.inventory_levels WHERE variant_id = ${variant.id} FOR UPDATE`,
    [() => updateOrder(first.id, { status: 'CONFIRMADO' }), () => updateOrder(second.id, { status: 'CONFIRMADO' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'INSUFFICIENT_STOCK');
  assert.equal(await prisma.order.count(), 2);
  assert.equal(await prisma.inventoryMovement.count(), 1);
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 0);
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).onHand, 5);
});

test('O10: archive racing a reopen cannot leave an archived reservation', async () => {
  const { variant } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  await updateOrder(order.id, { status: 'CANCELADO' });
  const results = await behindLock(tx => tx.$queryRaw`SELECT id FROM app.orders WHERE id = ${order.id} FOR UPDATE`,
    [() => archiveOrder(order.id), () => updateOrder(order.id, { status: 'NOVO' })]);
  assert.equal(results[0].status, 'fulfilled');
  if (results[1].status === 'rejected') assert.equal(results[1].reason.code, 'NOT_FOUND');
  const saved = await prisma.order.findUnique({ where: { id: order.id } });
  assert.ok(saved.archivedAt); assert.equal(saved.status, 'CANCELADO');
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 0);
});

test('O9: failure of the final archive audit rolls back cancellation and stock restoration too', async () => {
  const { variant } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  await updateOrder(order.id, { status: 'CONFIRMADO' });
  const before = await persistedOrderState();
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ARCHIVED' THEN RAISE EXCEPTION 'test archive failure'; END IF; RETURN NEW; END $$`);
  await owner.$executeRawUnsafe(`CREATE TRIGGER test_archive BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_archive()`);
  try {
    await assert.rejects(archiveOrder(order.id), /test archive failure/);
    assert.deepEqual(await persistedOrderState(), before);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_archive ON app.audit_logs');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_archive()');
  }
});

for (const [name, priceCents, weightGrams, quantities, code] of [
  ['line amount', 10000000, 400, [400], 'ORDER_AMOUNT_OVERFLOW'],
  ['repeated variant aggregation', 5368710, 400, [200, 200], 'ORDER_AMOUNT_OVERFLOW'],
  ['line weight', 1, 6000000, [400], 'ORDER_AMOUNT_OVERFLOW'],
  ['total weight across variants', 1, 6000000, [200, 200, 'second'], 'ORDER_AMOUNT_OVERFLOW'],
  ['subtotal across variants', 6000000, 400, [200, 200, 'second'], 'ORDER_AMOUNT_OVERFLOW'],
  ['pieces above the maximum', 1, 400, [300, 200], 'MAXIMUM_ORDER'],
]) for (const editing of [false, true]) {
  test(`O12: ${editing ? 'edit' : 'create'} rejects ${name} with no partial persistence`, async () => {
    const { variant, product, productOption } = await catalogFixture({ onHand: 2000, priceCents });
    await prisma.product.update({ where: { id: product.id }, data: { weightGrams } });
    const size = await prisma.size.create({ data: { code: 'G' } });
    const second = await prisma.productVariant.create({ data: { productOptionId: productOption.id, sizeId: size.id, sku: 'LINHO-PRETO-G', inventory: { create: { onHand: 2000 } } } });
    const order = editing ? await createOrder(orderInput(variant.id)) : null;
    const items = quantities.filter(quantity => typeof quantity === 'number').map((quantity, index) => ({
      variantId: quantities.includes('second') && index === 1 ? second.id : variant.id, quantity,
    }));
    const before = await persistedOrderState();
    const input = { ...orderInput(variant.id), items };
    await assert.rejects(editing ? updateOrder(order.id, { items }) : createOrder(input), { code });
    assert.deepEqual(await persistedOrderState(), before);
  });
}

async function persistedOrderState() {
  return {
    orders: await prisma.order.findMany({ orderBy: { id: 'asc' } }),
    items: await prisma.orderItem.findMany({ orderBy: { id: 'asc' } }),
    stock: await prisma.inventoryLevel.findMany({ orderBy: { variantId: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
  };
}

test('O4/O12: freight participates in overflow checks and a valid near-Int total persists', async () => {
  const { variant, product } = await catalogFixture({ onHand: 2000, priceCents: 5368711 });
  const input = { ...orderInput(variant.id, 400), delivery: { method: 'CORREIOS', postalCode: '01001000', shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1 } } };
  await assert.rejects(createOrder(input, null, { quoteShipping: quoteShipping(10) }), { code: 'ORDER_AMOUNT_OVERFLOW' });
  assert.equal(await prisma.order.count(), 0);
  await prisma.product.update({ where: { id: product.id }, data: { priceCents: 5368709 } });
  const order = await createOrder(orderInput(variant.id, 400));
  assert.equal(order.totalCents, 2147483600);
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 0);
});

test('O12: an overflowing shipping quote is rejected before order persistence', async () => {
  const { variant } = await catalogFixture({ onHand: 2000, priceCents: 1 });
  const input = { ...orderInput(variant.id, 400), delivery: { method: 'CORREIOS', postalCode: '01001000', shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1 } } };
  const before = await persistedOrderState();
  await assert.rejects(createOrder(input, null, { quoteShipping: quoteShipping(30_000_000) }), { code: 'ORDER_AMOUNT_OVERFLOW' });
  assert.deepEqual(await persistedOrderState(), before);
});

test('O12: edits reject overflowing paid amount and preserved shipping without partial changes', async () => {
  const { variant } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  let before = await persistedOrderState();
  await assert.rejects(updateOrder(order.id, { paidAmountCents: 2147483648 }), { code: 'ORDER_AMOUNT_OVERFLOW' });
  assert.deepEqual(await persistedOrderState(), before);
  await prisma.order.update({ where: { id: order.id }, data: { shippingAmountCents: 2147483647 } });
  before = await persistedOrderState();
  await assert.rejects(updateOrder(order.id, { items: [{ variantId: variant.id, quantity: 15 }] }), { code: 'ORDER_AMOUNT_OVERFLOW' });
  assert.deepEqual(await persistedOrderState(), before);
});

test('O7: editing uses existing snapshots and adjusts reservation differences, not historical catalog prices', async () => {
  const { variant, product } = await catalogFixture();
  const order = await createOrder({ ...orderInput(variant.id), note: 'Preserve me',
    delivery: { method: 'CORREIOS', postalCode: '01001000', shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1 } } },
  null, { quoteShipping: quoteShipping(70.3) });
  await prisma.product.update({ where: { id: product.id }, data: { priceCents: 9999, weightGrams: 999, name: 'Renamed' } });
  const result = await updateOrder(order.id, { items: [{ variantId: variant.id, quantity: 20 }], paidAmountCents: 12345 });
  assert.equal(result.items[0].unitPriceCentsSnapshot, 2500);
  assert.equal(result.items[0].unitWeightGramsSnapshot, 400);
  assert.equal(result.items[0].productNameSnapshot, 'Calça Linho');
  assert.equal(result.shippingAmountCents, 7030);
  assert.equal(result.totalCents, 57030);
  assert.equal(result.paidAmountCents, 12345);
  assert.equal(result.note, 'Preserve me');
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 0);
  const changed = await updateOrder(order.id, { note: null });
  assert.equal(changed.note, null);
});

for (const status of states) test(`O8: archive ${status} preserves history and releases only active stock`, async () => {
  const { variant } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  if (status === 'CONFIRMADO' || status === 'CONCLUIDO') await updateOrder(order.id, { status: 'CONFIRMADO' });
  if (status === 'CANCELADO') await updateOrder(order.id, { status: 'CANCELADO' });
  if (status === 'CONCLUIDO') await updateOrder(order.id, { status: 'CONCLUIDO' });
  await archiveOrder(order.id);
  const saved = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
  assert.ok(saved.archivedAt instanceof Date);
  assert.equal(saved.archivedById, actor.id);
  assert.equal(saved.items.length, 1);
  const stock = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
  assert.deepEqual([stock.onHand, stock.reserved], status === 'CONCLUIDO' ? [15, 0] : [30, 0]);
  await assert.rejects(updateOrder(order.id, { note: 'cannot edit archived' }), { code: 'NOT_FOUND' });
  const movementCount = await prisma.inventoryMovement.count();
  await assert.rejects(archiveOrder(order.id), { code: 'NOT_FOUND' });
  assert.equal(await prisma.inventoryMovement.count(), movementCount);
});

for (const [status, expected] of [
  ['NOVO', [[30, 0], [30, 0], [30, 0]]],
  ['CONFIRMADO', [[20, 0], [30, 0], [25, 0]]],
  ['CANCELADO', [[30, 0], [30, 0], [30, 0]]],
  ['CONCLUIDO', null],
]) test(`O7: item increases, decreases, removals and additions obey ${status} stock semantics`, async () => {
  const { product, productOption, variant } = await catalogFixture();
  const others = [];
  for (const code of ['G', 'GG']) {
    const size = await prisma.size.create({ data: { code } });
    others.push(await prisma.productVariant.create({ data: { productOptionId: productOption.id, sizeId: size.id,
      sku: `LINHO-PRETO-${code}`, priceCents: 3500, inventory: { create: { onHand: 30 } } } }));
  }
  const [second, third] = others;
  const order = await createOrder({ ...orderInput(variant.id), items: [{ variantId: variant.id, quantity: 8 }, { variantId: second.id, quantity: 7 }] });
  if (status === 'CONFIRMADO' || status === 'CONCLUIDO') await updateOrder(order.id, { status: 'CONFIRMADO' });
  if (status === 'CONCLUIDO') await updateOrder(order.id, { status: 'CONCLUIDO' });
  if (status === 'CANCELADO') await updateOrder(order.id, { status: 'CANCELADO' });
  const before = await persistedOrderState();
  if (!expected) {
    await assert.rejects(updateOrder(order.id, { items: [{ variantId: variant.id, quantity: 15 }] }), { code: 'ORDER_LOCKED' });
    assert.deepEqual(await persistedOrderState(), before);
    return;
  }
  await prisma.product.update({ where: { id: product.id }, data: { priceCents: 9999 } });
  await updateOrder(order.id, { items: [{ variantId: variant.id, quantity: 10 }, { variantId: second.id, quantity: 5 }] });
  const result = await updateOrder(order.id, { items: [{ variantId: variant.id, quantity: 10 }, { variantId: third.id, quantity: 5 }] });
  assert.equal(result.totalCents, 42500);
  assert.equal(result.items.find(item => item.productVariantId === variant.id).unitPriceCentsSnapshot, 2500);
  assert.equal(result.items.find(item => item.productVariantId === third.id).unitPriceCentsSnapshot, 3500);
  assert.ok(!result.items.some(item => item.productVariantId === second.id));
  for (const [index, id] of [variant.id, second.id, third.id].entries()) {
    const level = await prisma.inventoryLevel.findUnique({ where: { variantId: id } });
    assert.deepEqual([level.onHand, level.reserved], expected[index]);
  }
  const stock = await prisma.inventoryLevel.findMany();
  const movementCount = await prisma.inventoryMovement.count();
  await updateOrder(order.id, { paidAmountCents: 1000, note: 'Payment only' });
  assert.deepEqual(await prisma.inventoryLevel.findMany(), stock);
  assert.equal(await prisma.inventoryMovement.count(), movementCount);
});

for (const [first, second, expectedOnHand, expectedStatus] of [
  ['CONFIRMADO', 'CONFIRMADO', 15, 'CONFIRMADO'],
  ['CONFIRMADO', 'CANCELADO', 30, 'CANCELADO'],
]) test(`O10: concurrent ${first}/${second} never double-consumes or restores stock`, async () => {
  const { variant } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  const results = await behindLock(tx => tx.$queryRaw`SELECT variant_id FROM app.inventory_levels WHERE variant_id = ${variant.id} FOR UPDATE`,
    [() => updateOrder(order.id, { status: first }), () => updateOrder(order.id, { status: second })]);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'INVALID_STATUS_TRANSITION');
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).status, expectedStatus);
  const level = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
  assert.deepEqual([level.onHand, level.reserved], [expectedOnHand, 0]);
  assert.ok(await prisma.inventoryMovement.count({ where: { type: 'ORDER_CONSUME' } }) <= 1);
});

test('O9: failure after one of several inventory lines also rolls back the earlier movement', async () => {
  const { productOption, variant } = await catalogFixture();
  const size = await prisma.size.create({ data: { code: 'G' } });
  const second = await prisma.productVariant.create({ data: { productOptionId: productOption.id, sizeId: size.id,
    sku: 'SECOND-LINE', inventory: { create: { onHand: 30 } } } });
  const pending = await createOrder({ ...orderInput(variant.id), items: [{ variantId: variant.id, quantity: 8 }, { variantId: second.id, quantity: 7 }] });
  const before = await persistedOrderState();
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_stock_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.variant_id = '${second.id}' THEN RAISE EXCEPTION 'test second stock line'; END IF; RETURN NEW; END $$`);
  await owner.$executeRawUnsafe('CREATE TRIGGER test_stock_line BEFORE UPDATE ON app.inventory_levels FOR EACH ROW EXECUTE FUNCTION app.test_reject_stock_line()');
  try {
    await assert.rejects(updateOrder(pending.id, { status: 'CONFIRMADO' }), /test second stock line/);
    assert.deepEqual(await persistedOrderState(), before);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_stock_line ON app.inventory_levels');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_stock_line()');
  }
});

for (const role of [null, 'CUSTOMER', 'STAFF', 'ADMIN']) test(`O1: ${role ?? 'guest'} ownership is derived from the authenticated role`, async () => {
  const { variant } = await catalogFixture();
  const user = role ? (await sessionFixture(role)).user : undefined;
  const result = await createOrder(orderInput(variant.id), user);
  assert.equal(result.userId, role === 'CUSTOMER' ? user.id : null);
});
for (const failure of ['missing variant', 'missing inventory', 'insufficient stock']) test(`O3: ${failure} rejects without partial persistence`, async () => {
  const { variant } = await catalogFixture({ onHand: 14 });
  if (failure === 'missing inventory') await prisma.inventoryLevel.delete({ where: { variantId: variant.id } });
  const pending = failure === 'missing variant' ? null : await createOrder(orderInput(variant.id));
  const before = await persistedOrderState();
  await assert.rejects(pending ? updateOrder(pending.id, { status: 'CONFIRMADO' }) : createOrder(orderInput('missing')), {
    code: { 'missing variant': 'INVALID_VARIANT', 'missing inventory': 'MISSING_INVENTORY', 'insufficient stock': 'INSUFFICIENT_STOCK' }[failure],
  });
  assert.deepEqual(await persistedOrderState(), before);
});
test('O4: zero variant price remains free in persisted snapshots instead of falling back to the product price', async () => {
  const { variant } = await catalogFixture();
  await prisma.productVariant.update({ where: { id: variant.id }, data: { priceCents: 0 } });
  const result = await createOrder(orderInput(variant.id));
  assert.equal(result.totalCents, 0); assert.equal(result.items[0].unitPriceCentsSnapshot, 0);
});
