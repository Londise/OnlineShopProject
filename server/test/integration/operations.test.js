import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { prisma, resetDatabase, closeDatabase, catalogFixture } from '../../test-support/integration.js';
import { startStorage } from '../../test-support/storage.js';
import { scratchDatabase } from '../../test-support/scratch-database.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
beforeEach(resetDatabase);
after(closeDatabase);
async function run(program, args = [], overrides = {}) {
  try {
    return { code: 0, ...await exec(process.execPath, [program, ...args], { env: { ...process.env, ...overrides }, timeout: 60000 }) };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}
test('T1: database check reports only health/counts and sanitizes connection failure', async () => {
  await catalogFixture();
  await prisma.user.create({ data: { name: 'Private name', email: 'private@example.test', passwordHash: 'fixture' } });
  const result = await run(join(root, 'scripts/check-database.js'));
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { database: 'ferchu_test', role: 'ferchu_test_runtime', counts: { users: 1, products: 1, orders: 0, inventory: 1 } });
  assert.ok(!result.stdout.includes('private@example.test'));
  const failed = await run(join(root, 'scripts/check-database.js'), [], { DATABASE_URL: 'postgresql://fixture:private-test-password@127.0.0.1:9/test?schema=app&connect_timeout=1' });
  assert.equal(failed.code, 1); assert.ok(!failed.stderr.includes('private-test-password'));
});

test('T1: check refuses a reachable database whose application schema was not deployed', async t => {
  const { url } = await scratchDatabase(t);
  const response = await run(join(root, 'scripts/check-database.js'), [], { DATABASE_URL: url, DIRECT_URL: url });
  assert.equal(response.code, 1);
  assert.match(response.stderr, /Falha na verificação PostgreSQL/);
  assert.ok(!response.stderr.includes(new URL(url).password));
});

test('T4: seed rejects invalid credentials before writing and initializes a usable admin with zero stock in a fresh test database', async () => {
  const script = join(root, 'prisma/seed.js');
  const invalid = await run(script, [], { ADMIN_EMAIL: '', ADMIN_PASSWORD: 'short' });
  assert.equal(invalid.code, 1); assert.equal(await prisma.user.count(), 0); assert.equal(await prisma.product.count(), 0);
  const seeded = await run(script, [], { ADMIN_EMAIL: 'ADMIN@example.test', ADMIN_PASSWORD: 'correct-horse-42', ADMIN_NAME: 'Fixture Admin' });
  assert.equal(seeded.code, 0, seeded.stderr);
  const user = await prisma.user.findUnique({ where: { email: 'admin@example.test' } });
  assert.equal(user.role, 'ADMIN'); assert.equal(await argon2.verify(user.passwordHash, 'correct-horse-42'), true);
  assert.ok(await prisma.product.count() > 0);
  assert.ok(await prisma.inventoryLevel.count() > 0);
  assert.equal(await prisma.inventoryLevel.count({ where: { OR: [{ onHand: { not: 0 } }, { reserved: { not: 0 } }] } }), 0);
});

test('T2: media verification executes against local bytes/records and never writes or uploads', async t => {
  const storage = await startStorage(); t.after(storage.close);
  const temp = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'ferchu-script-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const manifest = join(temp, 'manifest.json');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwMMeFkAzXYj3br64kYAAAAASUVORK5CYII=', 'base64');
  const path = 'library/site/photo.png'; storage.objects.set(path, bytes);
  const checksum = '10dcd97cd04f0a9fef24cc52137c46dffc38c280edf5a26ddc549caf52e1a4a8';
  const file = { source: 'photo.png', storagePath: path, byteSize: 92, checksumSha256: checksum, url: `${storage.url}/storage/v1/object/public/storefront-images/${path}` };
  await writeFile(manifest, JSON.stringify({ files: [file] }));
  const asset = await prisma.mediaAsset.create({ data: { url: file.url, storageBucket: 'storefront-images', storagePath: path, checksumSha256: checksum } });
  const script = join(root, 'scripts/migrate-images.js');
  const verify = () => run(script, ['--verify', `--manifest=${manifest}`]);
  const verified = await verify(); assert.equal(verified.code, 0, verified.stderr);
  storage.objects.delete(path);
  assert.equal((await verify()).code, 1);
  storage.objects.set(path, Buffer.from('wrong bytes'));
  assert.equal((await verify()).code, 1);
  storage.objects.set(path, bytes);
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  assert.equal((await verify()).code, 1);
  assert.ok(storage.requests.every(request => request.method === 'GET'));
  assert.equal(await prisma.mediaAsset.count(), 0); assert.equal(await prisma.auditLog.count(), 0);
});

test('T3: import resumes without overwrites, preserves managed media, and publishes no manifest or links on conflict', async t => {
  const storage = await startStorage(); t.after(storage.close);
  const temp = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'ferchu-import-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const originals = join(temp, 'originals'), manifest = join(temp, 'manifest.json');
  const layouts = [
    ['calca-malha-viscolycra', 'calca_viscolycra_lisa', 'calcaviscolycrafotomodelo'],
    ['calca-viscolycra-estampada', 'calca_viscolycra_estampada', 'calcaestampadamodelo'],
    ['calca-linho', 'calca_linho', 'calcalinhomodelo'],
    ['pantacourt-linho', 'pantacourt_linho', 'pantacourtlinhomodelo'],
    ['bermuda-linho', 'bermuda_linho', 'bermudalinhomodelo'],
    ['capri-viscolycra-estampada', 'capri_estampada', 'capriestampadamodelo'],
  ];
  const files = ['hero.jpeg', 'logoferchumodas.jpeg', 'products/shortviscolycra.png', 'products/bermuda_viscolycra_lisa/bermudaviscolycralisapeca1.jpeg'];
  for (const [, folder, prefix] of layouts) for (let number = 1; number <= 3; number++) files.push(`products/${folder}/${prefix}${number}.jpeg`);
  const category = await prisma.category.create({ data: { name: 'Fixture category', slug: 'calcas' } });
  for (const slug of [...layouts.map(([slug]) => slug), 'short-viscolycra', 'bermuda-viscolycra-lisa']) {
    await prisma.product.create({ data: { categoryId: category.id, name: slug, slug, material: 'Linho', priceCents: 100, weightGrams: 1 } });
  }
  for (const [index, file] of files.entries()) {
    const path = join(originals, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, await sharp({ create: { width: 3, height: 4, channels: 3, background: { r: index * 7, g: 10, b: 20 } } }).png().toBuffer());
  }
  const script = join(root, 'scripts/migrate-images.js');
  const args = [`--assets-dir=${originals}`, `--manifest=${manifest}`];
  const environment = { SUPABASE_URL: storage.url, SUPABASE_SECRET_KEY: 'sb_secret_local_import_fixture' };
  const imported = await run(script, args, environment); assert.equal(imported.code, 0, imported.stderr);
  const firstManifest = await readFile(manifest, 'utf8');
  const assets = await prisma.mediaAsset.findMany({ orderBy: { id: 'asc' } });
  const firstBytes = new Map(storage.objects);
  assert.ok(assets.some(asset => asset.purpose === 'favicon'));
  const product = await prisma.product.findUnique({ where: { slug: 'calca-linho' } });
  const image = await prisma.productImage.findFirst({ where: { productId: product.id, type: 'PRIMARY' } });
  await prisma.productImage.update({ where: { id: image.id }, data: { sortOrder: 99 } });
  const managed = await prisma.mediaAsset.create({ data: { url: 'https://example.test/managed.png' } });
  await prisma.category.update({ where: { id: category.id }, data: { imageAssetId: managed.id } });
  const requestsBefore = storage.requests.filter(request => request.method === 'POST').length;
  const resumed = await run(script, args, environment); assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(storage.requests.filter(request => request.method === 'POST').length, requestsBefore);
  assert.equal(await prisma.mediaAsset.count(), assets.length + 1);
  assert.equal((await prisma.productImage.findUnique({ where: { id: image.id } })).sortOrder, 99);
  assert.equal((await prisma.category.findUnique({ where: { id: category.id } })).imageAssetId, managed.id);
  for (const [path, bytes] of firstBytes) assert.deepEqual(storage.objects.get(path), bytes);
  // Managed gallery content must cause atomic conflict, not be replaced.
  await prisma.productImage.create({ data: { productId: product.id, assetId: managed.id, type: 'SECONDARY' } });
  await writeFile(join(originals, 'additional-library.png'), await sharp({ create: { width: 3, height: 4, channels: 3, background: 'magenta' } }).png().toBuffer());
  const before = await prisma.productImage.findMany({ orderBy: { id: 'asc' } });
  const assetCountBeforeConflict = await prisma.mediaAsset.count();
  const manifestBeforeConflict = await readFile(manifest, 'utf8');
  const conflict = await run(script, args, environment);
  assert.equal(conflict.code, 1); assert.match(conflict.stderr, /Galeria já alterada/);
  assert.deepEqual(await prisma.productImage.findMany({ orderBy: { id: 'asc' } }), before);
  assert.equal(await prisma.mediaAsset.count(), assetCountBeforeConflict);
  assert.equal(await readFile(manifest, 'utf8'), manifestBeforeConflict);
  assert.equal(firstManifest, manifestBeforeConflict);
  const missingManifest = join(temp, 'missing-manifest.json');
  const requestCount = storage.requests.length;
  const missing = await run(script, [`--assets-dir=${join(temp, 'missing-originals')}`, `--manifest=${missingManifest}`], environment);
  assert.equal(missing.code, 1); assert.match(missing.stderr, /originais não encontrado/); assert.equal(storage.requests.length, requestCount);
  await assert.rejects(access(missingManifest), { code: 'ENOENT' });
});
