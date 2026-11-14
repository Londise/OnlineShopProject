import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { owner, prisma, resetDatabase, closeDatabase, catalogFixture, orderInput, sessionFixture } from '../../test-support/integration.js';
import { createOrder } from '../../src/services/order.service.js';
import { readFile } from 'node:fs/promises';
import { scratchDatabase } from '../../test-support/scratch-database.js';

beforeEach(resetDatabase);
after(closeDatabase);
const sqlState = code => error => error.meta?.code === code;

test('D2: the runtime can use domain data but cannot perform DDL, read migration history or run privileged maintenance', async () => {
  await catalogFixture();
  assert.equal(await prisma.product.count(), 1);
  await assert.rejects(prisma.$executeRawUnsafe('CREATE TABLE app.forbidden(id int)'), sqlState('42501'));
  await assert.rejects(prisma.$queryRawUnsafe('SELECT * FROM app._prisma_migrations'), sqlState('42501'));
  await assert.rejects(prisma.$queryRawUnsafe('SELECT true FROM app.log_entry_maintenance()'), sqlState('42501'));
});

test('D2: browser roles cannot read private tables, including direct log partitions; accidental grants still cannot expose rows', async () => {
  const { variant } = await catalogFixture();
  await sessionFixture(); await createOrder(orderInput(variant.id));
  const tables = await owner.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'app' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  for (const role of ['anon', 'authenticated']) {
    for (const { tablename } of tables) await assert.rejects(owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      await tx.$queryRawUnsafe(`SELECT * FROM app."${tablename.replaceAll('"', '""')}"`);
    }), sqlState('42501'));
  }
  const policies = await owner.$queryRaw`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'`;
  assert.ok(policies.every(table => table.relrowsecurity));
  try {
    await owner.$executeRawUnsafe('GRANT USAGE ON SCHEMA app TO anon, authenticated');
    await owner.$executeRawUnsafe('GRANT SELECT ON ALL TABLES IN SCHEMA app TO anon, authenticated');
    for (const role of ['anon', 'authenticated']) await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      for (const { tablename } of tables) assert.deepEqual(await tx.$queryRawUnsafe(`SELECT * FROM app."${tablename.replaceAll('"', '""')}"`), [], `${role}: ${tablename}`);
    });
  } finally {
    await owner.$executeRawUnsafe('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated');
    await owner.$executeRawUnsafe('REVOKE ALL ON SCHEMA app FROM anon, authenticated');
  }
});

test('D3: SQL writers cannot violate stock, quantity, amount, email, relation or cover constraints', async () => {
  const { variant, product } = await catalogFixture();
  const order = await createOrder(orderInput(variant.id));
  for (const sql of [
    `UPDATE app.inventory_levels SET on_hand = -1 WHERE variant_id = '${variant.id}'`,
    `UPDATE app.inventory_levels SET reserved = -1 WHERE variant_id = '${variant.id}'`,
    `UPDATE app.inventory_levels SET reserved = 31 WHERE variant_id = '${variant.id}'`,
    `UPDATE app.order_items SET quantity = 0 WHERE order_id = '${order.id}'`,
    `UPDATE app.products SET price_cents = -1 WHERE id = '${product.id}'`,
    `UPDATE app.orders SET total_cents = -1 WHERE id = '${order.id}'`,
    `UPDATE app.product_variants SET price_cents = -1 WHERE id = '${variant.id}'`,
    `UPDATE app.orders SET paid_amount_cents = -1 WHERE id = '${order.id}'`,
    `UPDATE app.order_items SET unit_price_cents_snapshot = -1 WHERE order_id = '${order.id}'`,
  ]) await assert.rejects(owner.$executeRawUnsafe(sql), sqlState('23514'));
  await prisma.user.create({ data: { name: 'Ana', email: 'ana@example.test', passwordHash: 'fixture' } });
  await assert.rejects(prisma.user.create({ data: { name: 'Outra Ana', email: 'ANA@example.test', passwordHash: 'fixture' } }), { code: 'P2002' });
  await assert.rejects(prisma.product.update({ where: { id: product.id }, data: { categoryId: 'missing-category' } }), { code: 'P2003' });
  const a = await prisma.mediaAsset.create({ data: { url: 'https://example.test/a.png' } });
  const b = await prisma.mediaAsset.create({ data: { url: 'https://example.test/b.png' } });
  await prisma.productImage.create({ data: { productId: product.id, assetId: a.id, type: 'PRIMARY' } });
  await assert.rejects(prisma.productImage.create({ data: { productId: product.id, assetId: b.id, type: 'PRIMARY' } }), { code: 'P2002' });
  await assert.rejects(prisma.productImage.create({ data: { productId: product.id, assetId: a.id, type: 'SECONDARY' } }), { code: 'P2002' });
  const size = await prisma.size.create({ data: { code: 'G' } });
  await assert.rejects(prisma.productVariant.create({ data: { productOptionId: variant.productOptionId, sizeId: size.id, sku: variant.sku } }), { code: 'P2002' });
  assert.equal((await prisma.inventoryLevel.findUnique({ where: { variantId: variant.id } })).reserved, 15);
});

test('D4: maintenance retires an expired partition without deleting recent/default logs and creates usable future ranges', async () => {
  await owner.$executeRawUnsafe(`CREATE TABLE app.log_entry_2020_01 PARTITION OF app.log_entry FOR VALUES FROM ('2020-01-01') TO ('2020-02-01')`);
  await prisma.$executeRaw`INSERT INTO app.log_entry(ts, level, service, event, message) VALUES
    ('2020-01-02'::timestamptz, 30, 'api', 'old', 'old'),
    (${new Date()}, 30, 'api', 'recent', 'keep'),
    ('2100-01-02'::timestamptz, 30, 'api', 'default', 'keep default')`;
  await owner.$queryRawUnsafe('SELECT true AS done FROM app.log_entry_maintenance()');
  assert.equal((await owner.$queryRawUnsafe("SELECT to_regclass('app.log_entry_2020_01')::text AS ref"))[0].ref, null);
  const entries = await prisma.$queryRaw`SELECT event FROM app.log_entry ORDER BY ts`;
  assert.deepEqual(entries.map(entry => entry.event), ['recent', 'default']);
  const future = new Date(); future.setUTCMonth(future.getUTCMonth() + 2, 1); future.setUTCHours(0, 0, 0, 0);
  await prisma.$executeRaw`INSERT INTO app.log_entry(ts, level, service, event, message) VALUES (${future}, 30, 'api', 'future', 'future')`;
  assert.equal((await prisma.$queryRaw`SELECT message FROM app.log_entry WHERE event = 'future'`)[0].message, 'future');
});

test('D5: the actual media migration refuses legacy identifiers atomically, then preserves IDs and references on the allowed path', async t => {
  const { client } = await scratchDatabase(t);
  await client.query(await readFile(new URL('../../prisma/migrations/20261012000000_postgresql_init/migration.sql', import.meta.url), 'utf8'));
  await client.query("INSERT INTO app.media_assets(id, url, public_id) VALUES ('historical-asset', 'https://example.test/history.png', 'legacy-external-id')");
  await client.query("INSERT INTO app.categories(id,name,slug,image_asset_id,updated_at) VALUES ('historical-category','History','history','historical-asset',now())");
  const migration = await readFile(new URL('../../prisma/migrations/20261013000000_storage_media/migration.sql', import.meta.url), 'utf8');
  await assert.rejects(client.query(migration), /Migrate external media identifiers/);
  await client.query('ROLLBACK');
  assert.deepEqual((await client.query('SELECT id, public_id FROM app.media_assets')).rows, [{ id: 'historical-asset', public_id: 'legacy-external-id' }]);
  assert.equal((await client.query('SELECT image_asset_id FROM app.categories')).rows[0].image_asset_id, 'historical-asset');
  await client.query('UPDATE app.media_assets SET public_id = NULL');
  await client.query(migration);
  assert.deepEqual((await client.query('SELECT id, url, purpose FROM app.media_assets')).rows, [{ id: 'historical-asset', url: 'https://example.test/history.png', purpose: 'library' }]);
  assert.equal((await client.query('SELECT image_asset_id FROM app.categories')).rows[0].image_asset_id, 'historical-asset');
  assert.equal((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='media_assets' AND column_name='public_id'")).rows.length, 0);
});

test('D4: an occupied DEFAULT range makes maintenance fail without losing default or expired data', async () => {
  const future = new Date(); future.setUTCMonth(future.getUTCMonth() + 1, 2); future.setUTCHours(12, 0, 0, 0);
  const partition = `log_entry_${future.getUTCFullYear()}_${String(future.getUTCMonth() + 1).padStart(2, '0')}`;
  await owner.$executeRawUnsafe(`DROP TABLE app."${partition}"`);
  try {
    await owner.$executeRawUnsafe("CREATE TABLE app.log_entry_2020_02 PARTITION OF app.log_entry FOR VALUES FROM ('2020-02-01') TO ('2020-03-01')");
    await owner.$executeRaw`INSERT INTO app.log_entry(ts,level,service,event,message) VALUES
      (${future},30,'api','default.collision','future must survive'),
      ('2020-02-02'::timestamptz,30,'api','expired.keep','old must survive failed maintenance')`;
    await assert.rejects(owner.$queryRawUnsafe('SELECT true FROM app.log_entry_maintenance()'));
    assert.deepEqual((await owner.$queryRaw`SELECT event FROM app.log_entry ORDER BY ts`).map(row => row.event), ['expired.keep', 'default.collision']);
  } finally {
    await owner.$executeRawUnsafe('TRUNCATE app.log_entry');
    await owner.$queryRawUnsafe('SELECT true FROM app.log_entry_maintenance()');
  }
});
