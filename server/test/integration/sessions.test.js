import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { prisma, serve, resetDatabase, closeDatabase, sessionFixture, catalogFixture, orderInput } from '../../test-support/integration.js';
import { createOrder, archiveOrder } from '../../src/services/order.service.js';

beforeEach(resetDatabase);
after(closeDatabase);
const body = (data, cookie) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });

test('S1/S3: registration normalizes email, forbids role escalation and stores only password/session hashes', async t => {
  const api = await serve(); t.after(api.close);
  const response = await api.request('/api/v1/auth/register', body({ name: 'Ana Silva', email: ' Ana@Example.test ', password: 'correct-horse-42', role: 'ADMIN' }));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.user.email, 'ana@example.test');
  assert.equal(data.user.role, 'CUSTOMER');
  assert.equal(data.user.passwordHash, undefined);
  const user = await prisma.user.findUnique({ where: { id: data.user.id } });
  assert.notEqual(user.passwordHash, 'correct-horse-42');
  assert.equal(await argon2.verify(user.passwordHash, 'correct-horse-42'), true);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Path=\//i);
  assert.doesNotMatch(cookie, /Domain=/i);
  const rawCookie = cookie.split(';')[0];
  const token = rawCookie.slice(rawCookie.indexOf('=') + 1);
  const session = await prisma.authSession.findFirst({ where: { userId: user.id } });
  assert.equal(session.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(session.tokenHash, token);
  const me = await api.request('/api/v1/auth/me', { headers: { cookie: rawCookie } });
  assert.equal((await me.json()).user.id, user.id);
  const duplicate = await api.request('/api/v1/auth/register', body({ name: 'Outra Ana', email: 'ANA@example.test', password: 'correct-horse-42' }));
  assert.equal(duplicate.status, 409);
  assert.equal(await prisma.user.count(), 1);
});

test('S2/S4: invalid credentials share a public error, valid login persists until logout revokes it', async t => {
  const passwordHash = await argon2.hash('correct-horse-42');
  await prisma.user.create({ data: { name: 'Ana', email: 'ana@example.test', passwordHash } });
  await prisma.user.create({ data: { name: 'Inactive', email: 'inactive@example.test', passwordHash, active: false } });
  const api = await serve(); t.after(api.close);
  const errors = [];
  for (const [email, password] of [['ana@example.test', 'wrong'], ['missing@example.test', 'correct-horse-42'], ['inactive@example.test', 'correct-horse-42']]) {
    const response = await api.request('/api/v1/auth/login', body({ email, password }));
    assert.equal(response.status, 401);
    errors.push(await response.json());
  }
  assert.deepEqual(errors[0], errors[1]); assert.deepEqual(errors[1], errors[2]);
  assert.equal(await prisma.authSession.count(), 0);
  const response = await api.request('/api/v1/auth/login', body({ email: 'ANA@example.test', password: 'correct-horse-42' }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await api.request('/api/v1/auth/me', { headers: { cookie } })).json()).user.email, 'ana@example.test');
  const logout = await api.request('/api/v1/auth/logout', body({}, cookie));
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /ferchu_session=;/);
  assert.ok((await prisma.authSession.findFirst()).revokedAt);
  assert.equal((await (await api.request('/api/v1/auth/me', { headers: { cookie } })).json()).user, null);
  assert.equal((await api.request('/api/v1/auth/logout', body({}, cookie))).status, 204);
});

test('S4: expired, revoked, missing and disabled-user sessions cannot access protected orders', async t => {
  const fixtures = [];
  const expired = await sessionFixture('CUSTOMER');
  await prisma.authSession.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(0) } }); fixtures.push(expired);
  const revoked = await sessionFixture('CUSTOMER');
  await prisma.authSession.update({ where: { id: revoked.session.id }, data: { revokedAt: new Date() } }); fixtures.push(revoked);
  fixtures.push(await sessionFixture('CUSTOMER', { active: false }));
  fixtures.push({ cookie: '' }, { cookie: 'ferchu_session=invented' });
  const api = await serve(); t.after(api.close);
  for (const { cookie } of fixtures) {
    assert.equal((await (await api.request('/api/v1/auth/me', { headers: { cookie } })).json()).user, null);
    assert.equal((await api.request('/api/v1/orders/me', { headers: { cookie } })).status, 401);
  }
});

test('S6: customers see only their own unarchived orders, never guest orders with a matching email', async t => {
  const customer = await sessionFixture('CUSTOMER', { email: 'ana@example.test' });
  const other = await sessionFixture('CUSTOMER');
  const admin = await sessionFixture();
  const { variant } = await catalogFixture({ onHand: 90 });
  const own = await createOrder(orderInput(variant.id), customer.user);
  const archived = await createOrder(orderInput(variant.id), customer.user);
  await archiveOrder(archived.id, admin.user);
  await createOrder(orderInput(variant.id), other.user);
  const guest = orderInput(variant.id); guest.customer.email = 'ana@example.test';
  await createOrder(guest);
  const api = await serve(); t.after(api.close);
  const response = await api.request('/api/v1/orders/me', { headers: { cookie: customer.cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).orders.map(order => order.id), [own.id]);
});

const staffPaths = [['GET', '/orders'], ['GET', '/orders/id'], ['PATCH', '/orders/id'], ['DELETE', '/orders/id'], ['GET', '/inventory'], ['POST', '/inventory/id/adjust']];
const adminPaths = [['GET', '/logs'], ['GET', '/logs/dead'], ['GET', '/logs/trace/id'], ['GET', '/catalog-metadata'],
  ['POST', '/categories'], ['PATCH', '/categories/id'], ['POST', '/variant-options'], ['PATCH', '/variant-options/id'],
  ['GET', '/products'], ['POST', '/products'], ['PATCH', '/products/id'], ['POST', '/products/id/options'], ['PATCH', '/products/id/options/id'],
  ['PATCH', '/products/id/variants/id'], ['POST', '/products/id/images'], ['GET', '/users/staff'], ['POST', '/users/staff'],
  ['POST', '/uploads'], ['GET', '/media-assets'], ['PATCH', '/product-images/id'], ['GET', '/site-media'], ['GET', '/banners'], ['POST', '/banners'], ['PATCH', '/banners/id']];

test('S5: every mounted administrative capability denies unauthenticated and CUSTOMER access; STAFF cannot cross the ADMIN guard', async t => {
  const customer = await sessionFixture('CUSTOMER'); const staff = await sessionFixture('STAFF');
  const api = await serve(); t.after(api.close);
  for (const [method, path] of [...staffPaths, ...adminPaths]) {
    for (const [cookie, expected] of [['', 401], [customer.cookie, 403], ...(adminPaths.some(([m, p]) => m === method && p === path) ? [[staff.cookie, 403]] : [])]) {
      const response = await api.request(`/api/v1/admin${path}`, { method, headers: { cookie } });
      assert.equal(response.status, expected, `${method} ${path}`);
    }
  }
  // Positive authorization is also exercised with actual data and effects.
  const { variant } = await catalogFixture();
  const response = await api.request(`/api/v1/admin/inventory/${variant.id}/adjust`, body({ delta: 2, reason: 'Contagem física' }, staff.cookie));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).inventory.onHand, 32);
  assert.equal((await prisma.inventoryMovement.findFirst()).actorId, staff.user.id);
});

for (const role of ['STAFF', 'ADMIN']) test(`S5: ${role} can list/read/edit/archive orders and read/adjust inventory with real effects`, async t => {
  const user = await sessionFixture(role); const { variant } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  const api = await serve(); t.after(api.close);
  for (const path of ['/orders', `/orders/${order.id}`, '/inventory']) {
    assert.equal((await api.request(`/api/v1/admin${path}`, { headers: { cookie: user.cookie } })).status, 200);
  }
  const updated = await api.request(`/api/v1/admin/orders/${order.id}`, { ...body({ status: 'CONFIRMADO' }, user.cookie), method: 'PATCH' });
  assert.equal(updated.status, 200);
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).onHand, 15);
  const adjusted = await api.request(`/api/v1/admin/inventory/${variant.id}/adjust`, body({ delta: 1, reason: 'Contagem real' }, user.cookie));
  assert.equal(adjusted.status, 200);
  const archived = await api.request(`/api/v1/admin/orders/${order.id}`, { method: 'DELETE', headers: { cookie: user.cookie } });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).order.id, order.id);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).archivedById, user.user.id);
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).onHand, 31);
});
