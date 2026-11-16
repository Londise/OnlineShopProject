import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, owner, serve, resetDatabase, closeDatabase, catalogFixture, orderInput, sessionFixture, createApp } from '../../test-support/integration.js';
import { createOrder, updateOrder } from '../../src/services/order.service.js';
import { reserveLoginAttempt, accountHash } from '../../src/services/auth-throttle.service.js';
import { readFile, readdir } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { scratchDatabase } from '../../test-support/scratch-database.js';

beforeEach(resetDatabase);
after(closeDatabase);
const post = (body, key = randomUUID()) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });

test('waiting orders never touch stock; only ADMIN confirmation consumes it and pending edits remain stock-neutral', async () => {
  const { variant } = await catalogFixture({ onHand: 20 });
  const admin = await sessionFixture(), staff = await sessionFixture('STAFF');
  const one = await createOrder(orderInput(variant.id)), two = await createOrder(orderInput(variant.id));
  await updateOrder(one.id, { items: [{ variantId: variant.id, quantity: 18 }] }, admin.user);
  assert.equal((await prisma.inventoryLevel.findFirst()).reserved, 0);
  assert.equal((await prisma.inventoryLevel.findFirst()).onHand, 20);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  await assert.rejects(updateOrder(one.id, { status: 'CONFIRMADO' }, staff.user), { status: 403 });
  await updateOrder(one.id, { status: 'CONFIRMADO' }, admin.user);
  assert.equal((await prisma.inventoryLevel.findFirst()).onHand, 2);
  await assert.rejects(updateOrder(two.id, { status: 'CONFIRMADO' }, admin.user), { code: 'INSUFFICIENT_STOCK' });
  assert.equal((await prisma.order.findUnique({ where: { id: two.id } })).status, 'NOVO');
  await updateOrder(one.id, { status: 'CONFIRMADO' }, admin.user);
  assert.equal(await prisma.inventoryMovement.count(), 1);
  await updateOrder(one.id, { items: [{ variantId: variant.id, quantity: 10 }] }, admin.user);
  assert.equal((await prisma.inventoryLevel.findFirst()).onHand, 10);
  await updateOrder(one.id, { status: 'CANCELADO' }, admin.user);
  assert.equal((await prisma.inventoryLevel.findFirst()).onHand, 20);
});

test('idempotency covers concurrent requests, payload conflicts, process restart, and immutable replay', async t => {
  const { variant } = await catalogFixture();
  const input = orderInput(variant.id), key = randomUUID();
  const api = await serve(); t.after(api.close);
  const replies = await Promise.all([api.request('/api/v1/orders', post(input, key)), api.request('/api/v1/orders', post(input, key))]);
  assert.deepEqual(replies.map(r => r.status), [201, 201]);
  const [a, b] = await Promise.all(replies.map(r => r.json()));
  assert.deepEqual(a, b);
  assert.equal(await prisma.order.count(), 1);
  const admin = await sessionFixture();
  await updateOrder(a.order.id, { note: 'Internal later edit' }, admin.user);
  const second = await serve(); t.after(second.close);
  assert.deepEqual(await (await second.request('/api/v1/orders', post(input, key))).json(), a);
  const conflict = await second.request('/api/v1/orders', post({ ...input, note: 'different checkout' }, key));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await api.request('/api/v1/orders', post(input, ''))).status, 422);
  assert.equal(await prisma.inventoryMovement.count(), 0);
});

test('logout and session reads remain available after the login IP budget is exhausted', async t => {
  const fixture = await sessionFixture('CUSTOMER'), api = await serve(); t.after(api.close);
  for (let index = 0; index < 21; index++) {
    await api.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  }
  for (let index = 0; index < 25; index++)
    assert.equal((await api.request('/api/v1/auth/me', { headers: { cookie: fixture.cookie } })).status, 200);
  const response = await api.request('/api/v1/auth/logout', { method: 'POST', headers: { cookie: fixture.cookie } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /ferchu_session=;/);
  assert.ok((await prisma.authSession.findUnique({ where: { id: fixture.session.id } })).revokedAt);
});

test('persistent account budget is atomic, normalizes email, expires, and does not permanently lock an account', async () => {
  const now = new Date(), email = 'audit@example.test';
  for (let i = 0; i < 6; i++) await reserveLoginAttempt(email, now);
  await assert.rejects(reserveLoginAttempt(' AUDIT@example.test ', now), { status: 429 });
  for (let i = 1; i <= 4; i++) await reserveLoginAttempt(email, new Date(now.getTime() + i * 70_000));
  await assert.rejects(reserveLoginAttempt(email, new Date(now.getTime() + 500_000)), { status: 429 });
  await reserveLoginAttempt(email, new Date(now.getTime() + 900_001));
  assert.equal((await prisma.authThrottle.findUnique({ where: { accountHash: accountHash(email) } })).attempts, 1);
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => reserveLoginAttempt('race@example.test', now)));
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 6);
});

test('changing verified visitor IP or restarting the app does not reset an account cooldown', async t => {
  const secret = 'local-proxy-security-fixture-only-123456';
  const { env } = await import('../../src/config/env.js');
  const apps = await Promise.all([serve(createApp({ config: { ...env, ORIGIN_PROXY_SECRET: secret } })),
    serve(createApp({ config: { ...env, ORIGIN_PROXY_SECRET: secret } }))]);
  apps.forEach(api => t.after(api.close));
  for (let i = 0; i < 7; i++) {
    const api = apps[i % apps.length];
    const response = await api.request('/api/v1/auth/login', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-ferchu-proxy-secret': secret, 'x-ferchu-client-ip': `192.0.2.${i + 1}`,
    }, body: JSON.stringify({ email: 'distributed@example.test', password: 'wrong-fixture-password' }) });
    assert.equal(response.status, i < 6 ? 401 : 429);
  }
  assert.equal(await owner.authThrottle.count(), 1);
});

for (const mismatch of [false, true]) test(`commercial migration preserves legacy orders and ${mismatch ? 'rolls back inconsistent stock' : 'audits released reservations'}`, async t => {
  const { client, url } = await scratchDatabase(t);
  const root = new URL('../../prisma/migrations/', import.meta.url);
  for (const directory of (await readdir(root)).filter(name => /^\d/.test(name) && name < '20261115100000').sort())
    await client.query(await readFile(new URL(`${directory}/migration.sql`, root), 'utf8'));
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const category = await db.category.create({ data: { name: 'Legacy', slug: 'legacy' } });
    const size = await db.size.create({ data: { code: 'M' } });
    const option = await db.variantOption.create({ data: { type: 'COLOR', name: 'Black', slug: 'black' } });
    const product = await db.product.create({ data: { categoryId: category.id, name: 'Legacy', slug: 'legacy', material: 'Linen', priceCents: 100, weightGrams: 100 } });
    const productOption = await db.productOption.create({ data: { productId: product.id, variantOptionId: option.id } });
    const variant = await db.productVariant.create({ data: { productOptionId: productOption.id, sizeId: size.id, sku: 'LEGACY', inventory: { create: { onHand: 30, reserved: mismatch ? 14 : 15 } } } });
    const order = await db.order.create({ data: { publicNumber: 'LEGACY-ORDER', customerName: 'Legacy Customer', customerWhatsApp: '11999998888',
      deliveryMethod: 'EXCURSAO', subtotalCents: 1500, totalCents: 1500,
      items: { create: { productVariantId: variant.id, productNameSnapshot: 'Legacy', optionNameSnapshot: 'Black',
        sizeSnapshot: 'M', unitPriceCentsSnapshot: 100, unitWeightGramsSnapshot: 100, quantity: 15, lineTotalCentsSnapshot: 1500 } } } });
    const migration = await readFile(new URL('20261115100000_commercial_confirmation_security/migration.sql', root), 'utf8');
    if (mismatch) {
      await assert.rejects(client.query(migration), /Reservation reconciliation failed/);
      await client.query('ROLLBACK');
      assert.equal((await db.inventoryLevel.findFirst()).reserved, 14);
      assert.equal(await db.inventoryMovement.count(), 0);
      const tables = await client.query("SELECT to_regclass('app.order_submissions') AS table_name");
      assert.equal(tables.rows[0].table_name, null);
    } else {
      await client.query(migration);
      assert.equal((await db.inventoryLevel.findFirst()).onHand, 30);
      assert.equal((await db.inventoryLevel.findFirst()).reserved, 0);
      assert.equal((await db.inventoryMovement.findFirst()).reservedDelta, -15);
      assert.equal((await db.auditLog.findFirst()).action, 'COMMERCIAL_WAIT_MIGRATED');
    }
    assert.equal((await db.order.findUnique({ where: { id: order.id }, include: { items: true } })).items[0].quantity, 15);
  } finally { await db.$disconnect(); }
});
