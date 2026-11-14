import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';

assert.equal(process.env.FERCHU_ISOLATED_TEST, 'embedded-postgres', 'Run npm run test:integration; never supply a development DATABASE_URL.');
for (const key of ['DATABASE_URL', 'TEST_INSTALL_URL']) {
  const url = new URL(process.env[key]);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/ferchu_test');
  assert.equal(url.searchParams.get('schema'), 'app');
}
export const owner = new PrismaClient({ datasourceUrl: process.env.TEST_INSTALL_URL });
export const { prisma } = await import('../src/db/prisma.js');
export const { createApp } = await import('../src/app.js');
const { flush, flushAndClose } = await import('../src/lib/logger.js');

export async function resetDatabase() {
  await flush();
  await owner.$executeRawUnsafe(`TRUNCATE app.users, app.categories, app.variant_options,
    app.sizes, app.media_assets, app.orders, app.audit_logs, app.log_entry, app.log_dead CASCADE`);
}
export async function closeDatabase() {
  await flushAndClose();
  await prisma.$disconnect();
  await owner.$disconnect();
}
export async function serve(app = createApp(), { port = 0 } = {}) {
  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    request: (path, options = {}) => fetch(`${base}${path}`, { ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
export async function catalogFixture({ onHand = 30, priceCents = 2500 } = {}) {
  const category = await prisma.category.create({ data: { name: 'Calças', slug: 'calcas' } });
  const option = await prisma.variantOption.create({ data: { type: 'COLOR', name: 'Preto', slug: 'preto' } });
  const size = await prisma.size.create({ data: { code: 'M' } });
  const product = await prisma.product.create({ data: { categoryId: category.id, name: 'Calça Linho', slug: 'calca-linho', material: 'Linho', priceCents, weightGrams: 400 } });
  const productOption = await prisma.productOption.create({ data: { productId: product.id, variantOptionId: option.id } });
  const variant = await prisma.productVariant.create({ data: { productOptionId: productOption.id, sizeId: size.id, sku: 'LINHO-PRETO-M', inventory: { create: { onHand } } } });
  return { category, option, size, product, productOption, variant };
}
export const orderInput = (variantId, quantity = 15) => ({
  customer: { name: 'Ana Silva', whatsapp: '11999998888' },
  delivery: { method: 'EXCURSAO' }, items: [{ variantId, quantity }],
});

export async function sessionFixture(role = 'ADMIN', overrides = {}) {
  const token = randomBytes(32).toString('hex');
  const user = await prisma.user.create({ data: {
    name: role, email: `${token.slice(0, 10)}@example.test`, passwordHash: 'not-used-for-login', role,
    ...overrides,
  } });
  const session = await prisma.authSession.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 86400000),
  } });
  return { user, session, cookie: `ferchu_session=${token}` };
}
