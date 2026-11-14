import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, owner, resetDatabase, closeDatabase, serve, sessionFixture, catalogFixture, orderInput } from '../../test-support/integration.js';
import { behindLock } from '../../test-support/concurrency.js';
import { createOrder } from '../../src/services/order.service.js';

beforeEach(resetDatabase);
after(closeDatabase);
const adjustment = (cookie, delta) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ delta, reason: 'Physical stock count' }) });

test('O13: manual delta preserves reservations and persists movement/audit with the returned availability', async t => {
  const { variant } = await catalogFixture();
  await createOrder(orderInput(variant.id));
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const response = await api.request(`/api/v1/admin/inventory/${variant.id}/adjust`, adjustment(admin.cookie, -10));
  assert.equal(response.status, 200);
  const { inventory } = await response.json();
  assert.deepEqual([inventory.onHand, inventory.reserved, inventory.available], [20, 15, 5]);
  const movement = await prisma.inventoryMovement.findFirst({ where: { type: 'ADJUSTMENT' } });
  assert.equal(movement.onHandDelta, -10); assert.equal(movement.actorId, admin.user.id);
  const audit = await prisma.auditLog.findFirst({ where: { entityId: variant.id } });
  assert.equal(audit.action, 'ADJUSTED'); assert.equal(audit.actorId, admin.user.id);
});

test('O13: zero/invalid/over-reserved and nonexistent adjustments leave stock and business history untouched', async t => {
  const { variant } = await catalogFixture();
  await createOrder(orderInput(variant.id));
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const before = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
  const movements = await prisma.inventoryMovement.count(), audits = await prisma.auditLog.count();
  for (const [id, delta, expected] of [[variant.id, 0, 422], [variant.id, 1.5, 422], [variant.id, 'invalid', 422], [variant.id, -16, 409], ['missing', 1, 404]]) {
    const response = await api.request(`/api/v1/admin/inventory/${id}/adjust`, adjustment(admin.cookie, delta));
    assert.equal(response.status, expected);
  }
  assert.deepEqual(await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } }), before);
  assert.equal(await prisma.inventoryMovement.count(), movements);
  assert.equal(await prisma.auditLog.count(), audits);
});

test('O13: failed adjustment audit rolls back both the physical delta and movement', async t => {
  const { variant } = await catalogFixture();
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test adjustment audit'; END $$`);
  await owner.$executeRawUnsafe('CREATE TRIGGER test_adjustment BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_adjustment()');
  try {
    assert.equal((await api.request(`/api/v1/admin/inventory/${variant.id}/adjust`, adjustment(admin.cookie, 5))).status, 500);
    assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).onHand, 30);
    assert.equal(await prisma.inventoryMovement.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_adjustment ON app.audit_logs');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_adjustment()');
  }
});

test('O13: adjustment racing a reservation cannot remove newly committed stock', async t => {
  const { variant } = await catalogFixture({ onHand: 20 });
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const results = await behindLock(tx => tx.$queryRaw`SELECT variant_id FROM app.inventory_levels WHERE variant_id = ${variant.id} FOR UPDATE`, [
    () => createOrder(orderInput(variant.id)),
    () => api.request(`/api/v1/admin/inventory/${variant.id}/adjust`, adjustment(admin.cookie, -10)),
  ]);
  const order = results[0], adjustmentResponse = results[1];
  assert.equal(adjustmentResponse.status, 'fulfilled');
  const response = adjustmentResponse.value;
  const level = await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } });
  if (order.status === 'fulfilled') {
    assert.equal(response.status, 409);
    assert.deepEqual([level.onHand, level.reserved], [20, 15]);
  } else {
    assert.equal(order.reason.code, 'INSUFFICIENT_STOCK');
    assert.equal(response.status, 200);
    assert.deepEqual([level.onHand, level.reserved], [10, 0]);
  }
});
