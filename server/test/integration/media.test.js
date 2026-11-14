import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { setImmediate } from 'node:timers/promises';
import { startStorage } from '../../test-support/storage.js';

const storage = await startStorage();
process.env.SUPABASE_URL = storage.url;
process.env.SUPABASE_SECRET_KEY = 'sb_secret_only_a_local_fixture';
const { prisma, owner, createApp, resetDatabase, closeDatabase, catalogFixture, sessionFixture, serve: serveApp } = await import('../../test-support/integration.js');
const { behindLock } = await import('../../test-support/concurrency.js');
const { env } = await import('../../src/config/env.js');
let client = 0;
const proxySecret = 'isolated-media-proxy-'.repeat(3);
async function serve() {
  const api = await serveApp(createApp({ config: { ...env, ORIGIN_PROXY_SECRET: proxySecret } }));
  const request = api.request;
  const ip = `198.51.100.${client}`;
  return { ...api, request: (path, options = {}) => request(path, { ...options, headers: {
    'x-ferchu-proxy-secret': proxySecret, 'x-ferchu-client-ip': ip, ...options.headers,
  } }) };
}
beforeEach(async () => { await resetDatabase(); storage.reset(); client++; });
after(async () => { await closeDatabase(); await storage.close(); });
const bytes = await sharp({ create: { width: 3, height: 4, channels: 3, background: 'white' } }).png().toBuffer();
function upload(purpose = 'library', fields = {}, file = bytes) {
  const form = new FormData();
  form.append('purpose', purpose);
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  if (file) form.append('file', new Blob([file], { type: 'image/png' }), 'photo.png');
  return form;
}

for (const purpose of ['library', 'favicon', 'category', 'banner', 'product']) test(`U2: ${purpose} upload stores re-encoded bytes and creates the right persistent association`, async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const fields = purpose === 'product' ? { targetId: f.product.id, optionId: f.productOption.id, primary: true }
    : purpose === 'category' ? { targetId: f.category.id } : {};
  const response = await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload(purpose, fields) });
  assert.equal(response.status, 201);
  const { asset } = await response.json();
  const expected = await sharp(bytes).rotate().toFormat('png').toBuffer();
  assert.equal(asset.width, 3); assert.equal(asset.height, 4); assert.equal(asset.byteSize, expected.length);
  assert.equal(asset.mimeType, 'image/png');
  assert.ok(asset.url.startsWith(storage.url));
  assert.deepEqual(storage.objects.get(asset.storagePath), expected);
  assert.equal(storage.requests[0].upsert, 'false');
  assert.equal(storage.requests[0].contentType, 'image/png');
  assert.equal((await prisma.auditLog.findFirst({ where: { entityId: asset.id } })).actorId, admin.user.id);
  if (purpose === 'product') {
    const image = await prisma.productImage.findFirst(); assert.equal(image.assetId, asset.id); assert.equal(image.productOptionId, f.productOption.id); assert.equal(image.type, 'PRIMARY');
  } else if (purpose === 'category') assert.equal((await prisma.category.findFirst()).imageAssetId, asset.id);
  else if (purpose === 'banner') assert.equal((await prisma.siteBanner.findFirst()).assetId, asset.id);
  else if (purpose === 'favicon') assert.equal((await (await api.request('/api/v1/site-media')).json()).faviconUrl, asset.url);
});

test('U3: invalid image/form data never reaches Storage or persists an asset', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  for (const form of [upload('product'), upload('invalid'), upload('library', { extra: true }), upload('library', {}, null), upload('library', {}, Buffer.from('<svg/>'))]) {
    const response = await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: form });
    assert.equal(response.status, 422);
  }
  assert.equal(storage.requests.length, 0); assert.equal(await prisma.mediaAsset.count(), 0);
});

test('U4: failed Storage leaves no asset; audit rollback deletes only the newly uploaded object', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const request = () => api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload() });
  storage.failUploads();
  assert.equal((await request()).status, 502); assert.equal(await prisma.mediaAsset.count(), 0);
  storage.failUploads(false);
  storage.objects.set('historical/photo.png', Buffer.from('keep'));
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$`);
  await owner.$executeRawUnsafe(`CREATE TRIGGER test_audit BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_audit()`);
  try {
    assert.equal((await request()).status, 500);
    assert.equal(await prisma.mediaAsset.count(), 0);
    assert.deepEqual([...storage.objects.keys()], ['historical/photo.png']);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_audit ON app.audit_logs');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_audit()');
  }
});

test('U5: in-flight Storage work holds upload capacity until the whole operation finishes', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const gate = storage.holdNext();
  const request = () => api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload() });
  const pending = request(); await gate.ready;
  try {
    const busy = await request(); assert.equal(busy.status, 503);
    assert.equal(busy.headers.get('retry-after'), '3'); assert.equal((await busy.json()).error.code, 'UPLOAD_BUSY');
  } finally { gate.release(); }
  assert.equal((await pending).status, 201);
  assert.equal((await request()).status, 201);
  assert.equal(storage.objects.size, 2);
});

test('U4: a lost commit acknowledgement must not delete an object whose asset actually committed', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const transaction = prisma.$transaction;
  t.after(() => { prisma.$transaction = transaction; });
  // Execute the real transaction, then lose only its acknowledgement. The
  // existence check and every database side effect remain real.
  prisma.$transaction = async (...args) => {
    await transaction.apply(prisma, args);
    throw new Error('test: commit acknowledgement lost');
  };
  const response = await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload() });
  assert.equal(response.status, 500);
  const asset = await prisma.mediaAsset.findFirst();
  assert.ok(asset); assert.deepEqual(storage.objects.get(asset.storagePath), bytes);
  assert.ok(!storage.requests.some(request => request.method === 'DELETE'));
  assert.equal(await prisma.auditLog.count({ where: { entityId: asset.id } }), 1);
});

test('U6/U4: changing the cover keeps old objects and order snapshots intact', async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const request = () => api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload('product', { targetId: f.product.id, primary: true }) });
  const first = (await (await request()).json()).asset;
  const { createOrder } = await import('../../src/services/order.service.js');
  const order = await createOrder({ customer: { name: 'Ana', whatsapp: '11999998888' }, delivery: { method: 'EXCURSAO' }, items: [{ variantId: f.variant.id, quantity: 15 }] });
  const second = (await (await request()).json()).asset;
  assert.notEqual(first.storagePath, second.storagePath);
  const images = await prisma.productImage.findMany({ where: { productId: f.product.id, type: 'PRIMARY' } });
  assert.equal(images.length, 1); assert.equal(images[0].assetId, second.id);
  assert.equal((await prisma.orderItem.findFirst({ where: { orderId: order.id } })).imageUrlSnapshot, first.url);
  assert.equal(storage.objects.size, 2);
});

test('U3: multipart bounds and foreign/nonexistent destinations fail without stored objects or assets', async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const other = await prisma.product.create({ data: { categoryId: f.category.id, name: 'Other', slug: 'other', material: 'Linho', priceCents: 100, weightGrams: 1 } });
  const option = await prisma.productOption.create({ data: { productId: other.id, variantOptionId: f.option.id } });
  const multiple = upload(); multiple.append('file', new Blob([bytes], { type: 'image/png' }), 'second.png');
  const fields = upload(); for (let index = 0; index < 7; index++) fields.append(`extra${index}`, 'x');
  for (const [form, status] of [
    [multiple, 422], [fields, 422], [upload('library', { altText: 'x'.repeat(1025) }), 422],
    [upload('library', {}, Buffer.alloc(5242881)), 413],
    [upload('product', { targetId: f.product.id, optionId: option.id }), 404],
    [upload('product', { targetId: 'cmissing000000000000000000' }), 404],
  ]) assert.equal((await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: form })).status, status);
  assert.equal(storage.objects.size, 0); assert.equal(await prisma.mediaAsset.count(), 0);
  assert.equal(await prisma.auditLog.count(), 0);
});

test('U4: failed commit classification preserves the possibly committed object instead of deleting it', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const transaction = prisma.$transaction, findUnique = prisma.mediaAsset.findUnique;
  t.after(() => { prisma.$transaction = transaction; prisma.mediaAsset.findUnique = findUnique; });
  t.mock.method(console, 'error', () => {}); // expected cleanup-attention diagnostic
  prisma.$transaction = async (...args) => { await transaction.apply(prisma, args); throw new Error('lost commit response'); };
  prisma.mediaAsset.findUnique = async () => { throw new Error('classification unavailable'); };
  assert.equal((await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload() })).status, 500);
  const asset = await owner.mediaAsset.findFirst();
  assert.ok(asset); assert.deepEqual(storage.objects.get(asset.storagePath), bytes);
  assert.ok(!storage.requests.some(request => request.method === 'DELETE'));
});

test('U5: disconnect during Storage processing keeps capacity occupied until persistence finishes', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const gate = storage.holdNext(), controller = new AbortController();
  const pending = api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload(), signal: controller.signal });
  await gate.ready;
  try {
    const rejected = assert.rejects(pending, { name: 'AbortError' }); controller.abort(); await rejected;
    const busy = await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload() });
    assert.equal(busy.status, 503); assert.equal((await busy.json()).error.code, 'UPLOAD_BUSY');
  } finally { gate.release(); }
  const deadline = Date.now() + 5000;
  while (!await prisma.mediaAsset.count()) { assert.ok(Date.now() < deadline, 'aborted caller must not abandon processing cleanup'); await setImmediate(); }
  assert.equal((await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload() })).status, 201);
});

test('U6: concurrent cover patches commit at most one PRIMARY, preserve associations, and roll back failed audits', async t => {  const f = await catalogFixture(); const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const images = [];
  for (let index = 0; index < 3; index++) {
    const asset = await prisma.mediaAsset.create({ data: { url: `https://images.example.test/${index}.png` } });
    images.push(await prisma.productImage.create({ data: { productId: f.product.id, assetId: asset.id, type: index ? 'SECONDARY' : 'PRIMARY' } }));
  }
  const patch = (image, data) => api.request(`/api/v1/admin/product-images/${image.id}`, { method: 'PATCH', headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const results = await behindLock(tx => tx.$queryRaw`SELECT id FROM app.product_images WHERE product_id = ${f.product.id} FOR UPDATE`,
    images.slice(1).map(image => () => patch(image, { primary: true })));
  assert.ok(results.every(result => result.status === 'fulfilled' && [200, 409].includes(result.value.status)));
  assert.ok(results.some(result => result.value.status === 200));
  const primary = await prisma.productImage.findMany({ where: { type: 'PRIMARY' } });
  assert.equal(primary.length, 1); assert.equal(await prisma.productImage.count(), 3);
  assert.equal(await prisma.auditLog.count(), results.filter(result => result.value.status === 200).length);
  assert.equal((await patch(primary[0], { sortOrder: 0 })).status, 200);
  assert.equal((await prisma.productImage.findUnique({ where: { id: primary[0].id } })).type, 'PRIMARY');
  assert.equal((await patch(primary[0], {})).status, 422);
  assert.equal((await patch(primary[0], { sortOrder: -1 })).status, 422);
  assert.equal((await patch({ id: 'missing' }, { primary: true })).status, 404);
  const before = await prisma.productImage.findMany({ orderBy: { id: 'asc' } });
  await owner.$executeRawUnsafe(`CREATE FUNCTION app.test_reject_image_patch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'image patch audit failure'; END $$`);
  await owner.$executeRawUnsafe('CREATE TRIGGER test_image_patch BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_reject_image_patch()');
  try {
    assert.equal((await patch(primary[0], { sortOrder: 5 })).status, 500);
    assert.deepEqual(await prisma.productImage.findMany({ orderBy: { id: 'asc' } }), before);
  } finally {
    await owner.$executeRawUnsafe('DROP TRIGGER test_image_patch ON app.audit_logs');
    await owner.$executeRawUnsafe('DROP FUNCTION app.test_reject_image_patch()');
  }
});

test('U7: only unreferenced images can be deleted; linked products and order snapshots stay protected', async t => {
  const f = await catalogFixture(); const admin = await sessionFixture(); const staff = await sessionFixture('STAFF'); const api = await serve(); t.after(api.close);
  const uploadRequest = fields => api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload('library', fields) });
  const free = (await (await uploadRequest()).json()).asset;
  const linked = (await (await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload('product', { targetId: f.product.id, primary: true }) })).json()).asset;
  const { createOrder } = await import('../../src/services/order.service.js');
  const order = await createOrder({ customer: { name: 'Ana', whatsapp: '11999998888' }, delivery: { method: 'EXCURSAO' }, items: [{ variantId: f.variant.id, quantity: 15 }] });
  assert.equal((await prisma.orderItem.findFirst({ where: { orderId: order.id } })).imageUrlSnapshot, linked.url, 'order snapshot must reference the cover');
  assert.equal((await api.request(`/api/v1/admin/media-assets/${free.id}`, { method: 'DELETE', headers: { cookie: admin.cookie } })).status, 204);
  assert.equal(await prisma.mediaAsset.findUnique({ where: { id: free.id } }), null);
  assert.ok(!storage.objects.has(free.storagePath), 'unreferenced object must leave Storage');
  assert.equal(await prisma.auditLog.count({ where: { entityId: free.id, action: 'DELETED' } }), 1);
  for (const id of [linked.id]) {
    const response = await api.request(`/api/v1/admin/media-assets/${id}`, { method: 'DELETE', headers: { cookie: admin.cookie } });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'MEDIA_IN_USE');
  }
  assert.ok(await prisma.mediaAsset.findUnique({ where: { id: linked.id } }));
  assert.ok(storage.objects.has(linked.storagePath));
  assert.equal((await api.request(`/api/v1/admin/media-assets/${free.id}`, { method: 'DELETE', headers: { cookie: staff.cookie } })).status, 403);
  assert.equal((await api.request('/api/v1/admin/media-assets/cmissing000000000000000000', { method: 'DELETE', headers: { cookie: admin.cookie } })).status, 404);
  assert.equal((await api.request(`/api/v1/admin/media-assets/${free.id}`, { method: 'DELETE' })).status, 401);
});

test('U8: the media list paginates, filters and validates query bounds', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  for (let index = 0; index < 3; index++) {
    const response = await api.request('/api/v1/admin/uploads', { method: 'POST', headers: { cookie: admin.cookie }, body: upload('library', { altText: `Foto ${index}` }) });
    assert.equal(response.status, 201);
  }
  const page = await api.request('/api/v1/admin/media-assets?limit=2&offset=1', { headers: { cookie: admin.cookie } });
  assert.equal(page.status, 200);
  const { assets, total } = await page.json();
  assert.equal(assets.length, 2); assert.equal(total, 3);
  const filtered = await api.request('/api/v1/admin/media-assets?purpose=library&q=Foto', { headers: { cookie: admin.cookie } });
  const found = await filtered.json();
  assert.equal(found.total, 3);
  for (const query of ['limit=501', 'limit=0', 'offset=-1', 'purpose=invoice', `q=${'x'.repeat(101)}`]) {
    const invalid = await api.request(`/api/v1/admin/media-assets?${query}`, { headers: { cookie: admin.cookie } });
    assert.equal(invalid.status, 422);
  }
});
