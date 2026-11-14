import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { prisma, owner, resetDatabase, closeDatabase, serve, sessionFixture, catalogFixture } from '../../test-support/integration.js';

beforeEach(resetDatabase);
after(closeDatabase);
const mutation = (method, data, cookie) => ({ method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(data) });

for (const relation of ['category', 'product', 'option', 'productOption', 'variant', 'size']) {
  test(`K1/O3: inactive ${relation} disappears from public catalog and cannot be ordered`, async t => {
    const fixture = await catalogFixture();
    const models = { category: prisma.category, product: prisma.product, option: prisma.variantOption, productOption: prisma.productOption, variant: prisma.productVariant, size: prisma.size };
    await models[relation].update({ where: { id: fixture[relation].id }, data: { active: false } });
    const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
    const list = await (await api.request('/api/v1/products')).json();
    const detail = await api.request('/api/v1/products/calca-linho');
    if (relation === 'category' || relation === 'product') {
      assert.deepEqual(list.products, []); assert.equal(detail.status, 404);
    } else {
      const product = (await detail.json()).product;
      assert.equal(detail.status, 200);
      assert.equal(relation === 'option' || relation === 'productOption' ? product.options.length : product.options[0].variants.length, 0);
      assert.deepEqual(list.products[0].options, product.options);
    }
    const all = await (await api.request('/api/v1/admin/products', { headers: { cookie: admin.cookie } })).json();
    assert.equal(all.products[0].options[0].variants.length, 1);
    const response = await api.request('/api/v1/orders', mutation('POST', { customer: { name: 'Ana', whatsapp: '11999998888' }, delivery: { method: 'EXCURSAO' }, items: [{ variantId: fixture.variant.id, quantity: 15 }] }, ''));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'INVALID_VARIANT');
    assert.equal(await prisma.order.count(), 0);
  });
}

test('K2: public catalog presents reserved availability, zero variant price and image dimensions', async t => {
  const { variant, product } = await catalogFixture();
  await prisma.inventoryLevel.update({ where: { variantId: variant.id }, data: { reserved: 7 } });
  await prisma.productVariant.update({ where: { id: variant.id }, data: { priceCents: 0 } });
  const asset = await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/pants.png', width: 600, height: 900 } });
  await prisma.productImage.create({ data: { productId: product.id, assetId: asset.id, type: 'PRIMARY' } });
  const api = await serve(); t.after(api.close);
  const data = (await (await api.request('/api/v1/products')).json()).products[0];
  assert.equal(data.options[0].variants[0].available, 23);
  assert.equal(data.options[0].variants[0].priceCents, 0);
  assert.equal(data.images[0].width, 600); assert.equal(data.images[0].height, 900);
  await prisma.inventoryLevel.delete({ where: { variantId: variant.id } });
  assert.equal((await (await api.request('/api/v1/products')).json()).products[0].options[0].variants[0].available, 0);
});

// Each independent command must commit its own audit in the same transaction.
const commands = [
  ['create category', 'POST', () => '/categories', () => ({ name: 'Nova', slug: 'nova' }), 'category', 'category'],
  ['update category', 'PATCH', f => `/categories/${f.category.id}`, () => ({ name: 'Atualizada' }), 'category', 'category'],
  ['create global option', 'POST', () => '/variant-options', () => ({ type: 'COLOR', name: 'Rose', slug: 'rose' }), 'variantOption', 'option'],
  ['update global option', 'PATCH', f => `/variant-options/${f.option.id}`, () => ({ name: 'Atualizada' }), 'variantOption', 'option'],
  ['create product', 'POST', () => '/products', f => ({ categoryId: f.category.id, name: 'Novo Produto', slug: 'novo', material: 'Linho', priceCents: 1200, weightGrams: 300 }), 'product', 'product'],
  ['update product', 'PATCH', f => `/products/${f.product.id}`, () => ({ name: 'Atualizado' }), 'product', 'product'],
  ['create product option', 'POST', f => `/products/${f.product.id}/options`, f => ({ variantOptionId: f.novelOption.id, variants: [{ sizeId: f.size.id, sku: 'NEW-OPTION-M', openingStock: 3 }] }), 'productOption', 'option'],
  ['update product option', 'PATCH', f => `/products/${f.product.id}/options/${f.productOption.id}`, () => ({ active: false }), 'productOption', 'option'],
  ['update variant', 'PATCH', f => `/products/${f.product.id}/variants/${f.variant.id}`, () => ({ priceCents: 0 }), 'productVariant', 'variant'],
  ['add image', 'POST', f => `/products/${f.product.id}/images`, f => ({ assetId: f.asset.id, type: 'PRIMARY' }), 'productImage', 'image'],
  ['create banner', 'POST', () => '/banners', f => ({ assetId: f.asset.id, title: 'Novo banner' }), 'siteBanner', 'banner'],
  ['update banner', 'PATCH', f => `/banners/${f.banner.id}`, () => ({ title: 'Atualizado' }), 'siteBanner', 'banner'],
  ['create staff', 'POST', () => '/users/staff', () => ({ name: 'Vendedora', email: 'staff@example.test', password: 'correct-horse-42' }), 'user', 'user'],
];
for (const [name, method, path, payload, model, responseKey] of commands) {
  test(`A1: ${name} persists with its actor audit, and audit failure rolls it back`, async t => {
    const f = await catalogFixture();
    f.novelOption = await prisma.variantOption.create({ data: { name: 'Nova cor', type: 'COLOR', slug: 'nova-cor' } });
    f.asset = await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/photo.png' } });
    f.banner = await prisma.siteBanner.create({ data: { assetId: f.asset.id, active: false, sortOrder: 7 } });
    const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
    const before = await prisma[model].findMany({ orderBy: { id: 'asc' } });
    const beforeVariants = await prisma.productVariant.count();
    const beforeMovements = await prisma.inventoryMovement.count();
    await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$`);
    await owner.$executeRawUnsafe(`CREATE TRIGGER test_audit BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_audit()`);
    try {
      const failed = await api.request(`/api/v1/admin${path(f)}`, mutation(method, payload(f), admin.cookie));
      assert.equal(failed.status, 500);
      assert.deepEqual(await prisma[model].findMany({ orderBy: { id: 'asc' } }), before);
      assert.equal(await prisma.auditLog.count(), 0);
      assert.equal(await prisma.productVariant.count(), beforeVariants);
      assert.equal(await prisma.inventoryMovement.count(), beforeMovements);
    } finally {
      await owner.$executeRawUnsafe('DROP TRIGGER test_audit ON app.audit_logs');
      await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_audit()');
    }
    const requested = payload(f);
    const response = await api.request(`/api/v1/admin${path(f)}`, mutation(method, requested, admin.cookie));
    assert.equal(response.status, method === 'POST' ? 201 : 200, name);
    const saved = (await response.json())[responseKey];
    const persisted = await prisma[model].findUnique({ where: { id: saved.id } });
    assert.ok(persisted);
    for (const [field, value] of Object.entries(requested)) {
      if (field === 'variants' || field === 'password') continue;
      const returned = model === 'product' && field === 'categoryId' ? saved.category.id : saved[field];
      assert.deepEqual(returned, value, `${name}: response ${field}`);
      assert.deepEqual(persisted[field], value, `${name}: persisted ${field}`);
    }
    if (name === 'create product option') {
      assert.equal(persisted.productId, f.product.id);
      const variants = await prisma.productVariant.findMany({ where: { productOptionId: saved.id }, include: { inventory: true } });
      assert.equal(variants.length, 1);
      assert.deepEqual([variants[0].sizeId, variants[0].sku, variants[0].inventory.onHand, variants[0].inventory.reserved], [f.size.id, 'NEW-OPTION-M', 3, 0]);
      const movement = await prisma.inventoryMovement.findFirst({ where: { variantId: variants[0].id } });
      assert.deepEqual([movement.type, movement.onHandDelta, movement.actorId], ['INITIAL', 3, admin.user.id]);
    }
    if (model === 'user') assert.equal(await argon2.verify(persisted.passwordHash, requested.password), true);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: saved.id } });
    assert.equal(audit.actorId, admin.user.id);
    assert.equal(audit.entityType, { category: 'CATEGORY', variantOption: 'VARIANT_OPTION', product: 'PRODUCT', productOption: 'PRODUCT_OPTION', productVariant: 'PRODUCT_VARIANT', productImage: 'PRODUCT_IMAGE', siteBanner: 'SITE_BANNER', user: 'USER' }[model]);
    assert.equal(audit.action, model === 'user' ? 'STAFF_CREATED' : method === 'POST' ? 'CREATED' : 'UPDATED');
    if (model === 'user') { assert.equal(saved.role, 'STAFF'); assert.equal(saved.passwordHash, undefined); }
  });
}

test('A2: unrelated PATCH fields do not reactivate or reorder category, option and banner records', async t => {
  const f = await catalogFixture();
  await prisma.category.update({ where: { id: f.category.id }, data: { active: false, sortOrder: 7 } });
  await prisma.variantOption.update({ where: { id: f.option.id }, data: { active: false } });
  const asset = await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/a.png' } });
  const banner = await prisma.siteBanner.create({ data: { assetId: asset.id, active: false, sortOrder: 7 } });
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  for (const [path, payload, key] of [[`categories/${f.category.id}`, { name: 'Nova' }, 'category'], [`variant-options/${f.option.id}`, { name: 'Nova' }, 'option'], [`banners/${banner.id}`, { title: 'Novo' }, 'banner']]) {
    const response = await api.request(`/api/v1/admin/${path}`, mutation('PATCH', payload, admin.cookie));
    assert.equal(response.status, 200);
    const value = (await response.json())[key];
    assert.equal(value.active, false);
    if (key !== 'option') assert.equal(value.sortOrder, 7);
  }
});

test('A2/A4: explicit false/zero/null survive partial patches; invalid and conflicting writes have controlled errors', async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  await prisma.product.update({ where: { id: f.product.id }, data: { active: false, description: 'Old text' } });
  await prisma.productVariant.update({ where: { id: f.variant.id }, data: { active: false, priceCents: 3500 } });
  for (const [path, payload, key] of [
    [`products/${f.product.id}`, { description: null, priceCents: 0 }, 'product'],
    [`products/${f.product.id}/variants/${f.variant.id}`, { priceCents: null }, 'variant'],
    [`categories/${f.category.id}`, { active: false, sortOrder: 0, imageAssetId: null }, 'category'],
  ]) {
    const response = await api.request(`/api/v1/admin/${path}`, mutation('PATCH', payload, admin.cookie));
    assert.equal(response.status, 200);
    const record = (await response.json())[key];
    assert.equal(record.active, false);
  }
  assert.equal((await prisma.product.findUnique({ where: { id: f.product.id } })).description, null);
  assert.equal((await prisma.productVariant.findUnique({ where: { id: f.variant.id } })).priceCents, null);
  for (const [path, data] of [[`products/${f.product.id}`, { priceCents: -1 }], [`products/${f.product.id}`, { name: 'x'.repeat(161) }], [`categories/${f.category.id}`, { sortOrder: 1000 }]]) {
    assert.equal((await api.request(`/api/v1/admin/${path}`, mutation('PATCH', data, admin.cookie))).status, 422);
  }
  assert.equal((await api.request('/api/v1/admin/categories', mutation('POST', { name: 'Duplicate', slug: 'calcas' }, admin.cookie))).status, 409);
  const missing = await api.request(`/api/v1/admin/products/${f.product.id}/images`, mutation('POST', { assetId: 'cmissing000000000000000000' }, admin.cookie));
  assert.equal(missing.status, 422); assert.equal((await missing.json()).error.code, 'INVALID_REFERENCE');
  assert.equal(await prisma.productImage.count(), 0);
  assert.equal((await api.request('/api/v1/admin/categories/missing', mutation('PATCH', { name: 'Missing' }, admin.cookie))).status, 404);
});

test('A5/S5: every administrative read is authorized for ADMIN and staff/metadata never expose hashes', async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const staff = await sessionFixture('STAFF');
  const api = await serve(); t.after(api.close);
  for (const path of ['/logs', '/logs/dead', '/logs/trace/ac6eb1a3-4e6f-4000-9000-cada5983d31c', '/catalog-metadata', '/products', '/users/staff', '/media-assets', '/site-media', '/banners']) {
    const response = await api.request(`/api/v1/admin${path}`, { headers: { cookie: admin.cookie } });
    assert.equal(response.status, 200, path);
    const payload = await response.json();
    assert.ok(!JSON.stringify(payload).includes('passwordHash'));
    if (path === '/users/staff') assert.ok(payload.users.some(user => user.id === staff.user.id && user.role === 'STAFF'));
    if (path === '/catalog-metadata') {
      assert.ok(payload.categories.some(category => category.id === f.category.id));
      assert.ok(payload.sizes.some(size => size.id === f.size.id));
    }
  }
});

test('K2: options/sizes/images are returned in display order with base-price fallback and category dimensions', async t => {
  const f = await catalogFixture();
  const size = await prisma.size.create({ data: { code: '48', sortOrder: -1 } });
  await prisma.productVariant.create({ data: { productOptionId: f.productOption.id, sizeId: size.id, sku: 'CUSTOM-48', priceCents: null } });
  const rose = await prisma.variantOption.create({ data: { type: 'COLOR', name: 'Rose', slug: 'rose' } });
  await prisma.productOption.create({ data: { productId: f.product.id, variantOptionId: rose.id, sortOrder: -1 } });
  for (const [index, type, sortOrder] of [[0, 'SECONDARY', 2], [1, 'PRIMARY', 99], [2, 'SECONDARY', 1]]) {
    const asset = await prisma.mediaAsset.create({ data: { url: `https://images.example.test/order-${index}.png`, width: 600, height: 900 } });
    await prisma.productImage.create({ data: { productId: f.product.id, assetId: asset.id, type, sortOrder } });
    if (type === 'PRIMARY') await prisma.category.update({ where: { id: f.category.id }, data: { imageAssetId: asset.id } });
  }
  const api = await serve(); t.after(api.close);
  const { product } = await (await api.request('/api/v1/products/calca-linho')).json();
  assert.deepEqual(product.options.map(option => option.name), ['Rose', 'Preto']);
  assert.deepEqual(product.options[1].variants.map(variant => variant.size), ['48', 'M']);
  assert.equal(product.options[1].variants[0].priceCents, 2500);
  assert.deepEqual(product.images.map(image => image.url.split('/').at(-1)), ['order-1.png', 'order-2.png', 'order-0.png']);
  assert.deepEqual([product.category.imageWidth, product.category.imageHeight], [600, 900]);
});

test('K3: inclusive banner boundaries and newest favicon are real query behavior; read failures stay errors', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T12:00:00Z') });
  const api = await serve(); t.after(api.close);
  assert.equal((await (await api.request('/api/v1/site-media')).json()).faviconUrl, null);
  const asset = await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/boundary.png' } });
  await prisma.siteBanner.create({ data: { assetId: asset.id, title: 'Exact boundary', startsAt: new Date(), endsAt: new Date() } });
  assert.deepEqual((await (await api.request('/api/v1/banners')).json()).banners.map(banner => banner.title), ['Exact boundary']);
  await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/old-icon.png', purpose: 'favicon', createdAt: new Date('2026-11-10') } });
  await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/new-icon.png', purpose: 'favicon', createdAt: new Date('2026-11-11') } });
  assert.equal((await (await api.request('/api/v1/site-media')).json()).faviconUrl, 'https://images.example.test/new-icon.png');
  await owner.$executeRawUnsafe('REVOKE SELECT ON app.site_banners FROM ferchu_backend');
  try {
    const response = await api.request('/api/v1/banners');
    assert.equal(response.status, 500); assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
  } finally { await owner.$executeRawUnsafe('GRANT SELECT ON app.site_banners TO ferchu_backend'); }
});

test('A4: an option, variant or image cannot be modified through another product', async t => {
  const f = await catalogFixture();
  const other = await prisma.product.create({ data: { categoryId: f.category.id, name: 'Outro produto', slug: 'outro', material: 'Linho', priceCents: 1200, weightGrams: 400 } });
  const asset = await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/other.png' } });
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  for (const [method, path, data, status] of [
    ['PATCH', `/products/${other.id}/options/${f.productOption.id}`, { active: false }, 404],
    ['PATCH', `/products/${other.id}/variants/${f.variant.id}`, { active: false }, 404],
    ['POST', `/products/${other.id}/images`, { assetId: asset.id, productOptionId: f.productOption.id }, 422],
  ]) {
    const response = await api.request(`/api/v1/admin${path}`, mutation(method, data, admin.cookie));
    assert.equal(response.status, status);
  }
  assert.equal((await prisma.productOption.findUnique({ where: { id: f.productOption.id } })).active, true);
  assert.equal((await prisma.productVariant.findUnique({ where: { id: f.variant.id } })).active, true);
  assert.equal(await prisma.productImage.count(), 0); assert.equal(await prisma.auditLog.count(), 0);
});

test('K3: public banners honor active windows and expose the dimensions of the linked asset', async t => {
  const asset = await prisma.mediaAsset.create({ data: { url: 'https://images.example.test/banner.png', width: 1600, height: 750 } });
  const past = new Date(Date.now() - 86400000), future = new Date(Date.now() + 86400000);
  await prisma.siteBanner.createMany({ data: [
    { assetId: asset.id, title: 'Current', sortOrder: 1, startsAt: past, endsAt: future },
    { assetId: asset.id, title: 'Future', startsAt: future },
    { assetId: asset.id, title: 'Expired', endsAt: past },
    { assetId: asset.id, title: 'Inactive', active: false },
    { assetId: asset.id, title: 'Always', sortOrder: 0 },
  ] });
  const api = await serve(); t.after(api.close);
  const { banners } = await (await api.request('/api/v1/banners')).json();
  assert.deepEqual(banners.map(banner => banner.title), ['Always', 'Current']);
  assert.equal(banners[0].width, 1600); assert.equal(banners[0].height, 750);
});
