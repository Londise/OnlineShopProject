import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test, { before, after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { inventoryLockQuery, lockInventories } from "../src/db/inventory.js";

// Actual PostgreSQL SQL runs in WASM memory, never against DATABASE_URL/Supabase.
let db;
before(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  const entries = await readdir(migrations, { withFileTypes: true });
  for (const entry of entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await db.exec(await readFile(new URL(`${entry.name}/migration.sql`, migrations), "utf8"));
    if (entry.name.endsWith("_postgresql_init")) {
      // Prisma owns this table in real deployments; runtime must not access it.
      await db.exec("CREATE TABLE app._prisma_migrations (id text PRIMARY KEY);");
    }
  }
  await db.exec(`
    CREATE ROLE test_api LOGIN;
    GRANT ferchu_backend TO test_api;
    INSERT INTO app.users (id, name, email, password_hash, updated_at)
      VALUES ('customer', 'Test', 'customer@example.invalid', 'test-hash', now());
    INSERT INTO app.auth_sessions (id, token_hash, user_id, expires_at)
      VALUES ('session', repeat('a',64), 'customer', now() + interval '1 day');
    INSERT INTO app.categories (id, name, slug, updated_at)
      VALUES ('category', 'Test', 'test', now());
    INSERT INTO app.products (id, category_id, name, slug, material, price_cents, weight_grams, updated_at)
      VALUES ('product', 'category', 'Test', 'test', 'Linho', 2500, 400, now());
    INSERT INTO app.variant_options (id, type, name, slug)
      VALUES ('option', 'COLOR', 'Preto', 'preto');
    INSERT INTO app.product_options (id, product_id, variant_option_id)
      VALUES ('product-option', 'product', 'option');
    INSERT INTO app.sizes (id, code) VALUES ('size-p','P'), ('size-m','M');
    INSERT INTO app.product_variants (id, product_option_id, size_id, sku, updated_at)
      VALUES ('variant-a','product-option','size-p','TEST-P',now()),
             ('variant-b','product-option','size-m','TEST-M',now());
    INSERT INTO app.inventory_levels (variant_id, on_hand, reserved, updated_at)
      VALUES ('variant-a',20,2,now()), ('variant-b',30,3,now());
    INSERT INTO app.orders (id, public_number, user_id, customer_name, customer_whatsapp,
      delivery_method, subtotal_cents, total_cents, updated_at)
      VALUES ('order','FM-TEST','customer','Test','11999999999','EXCURSAO',37500,37500,now());
    INSERT INTO app.order_items (id, order_id, product_variant_id, product_name_snapshot,
      option_name_snapshot, size_snapshot, unit_price_cents_snapshot, unit_weight_grams_snapshot,
      quantity, line_total_cents_snapshot)
      VALUES ('item','order','variant-a','Test','Preto','P',2500,400,15,37500);
  `);
});
after(async () => { if (db) await db.close(); });

test("migrations create all 21 tables only in app, with RLS enabled", async () => {
  const { rows } = await db.query(`SELECT c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`);
  // 16 de domínio + 4 partições de log_entry (3 mensais + default) + log_dead.
  assert.equal(rows.length, 21);
  assert.equal(rows.every((row) => row.relrowsecurity), true);
  const publicTables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  assert.equal(publicTables.rows.length, 0);
  const enums = await db.query(`SELECT count(*)::int AS count FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'app' AND t.typtype = 'e'`);
  assert.equal(enums.rows[0].count, 6);
});

test("inventory locking preserves camelCase fields and deterministic ordering", async () => {
  const query = inventoryLockQuery(["variant-b", "variant-a", "variant-a"]);
  assert.deepEqual(query.values, ["variant-a", "variant-b"]);
  await db.exec("SET ROLE test_api; BEGIN;");
  try {
    const { rows } = await db.query(query.text, query.values);
    assert.deepEqual(rows, [
      { variantId: "variant-a", onHand: 20, reserved: 2 },
      { variantId: "variant-b", onHand: 30, reserved: 3 },
    ]);
    const tx = { $queryRaw: async (sql) => (await db.query(sql.text, sql.values)).rows };
    const stock = await lockInventories(tx, ["variant-b", "variant-a"]);
    assert.deepEqual(stock.get("variant-a"), { onHand: 20, reserved: 2 });
  } finally { await db.exec("ROLLBACK; RESET ROLE;"); }
});

test("inventory queries are parameterized and empty inventory needs no query", async () => {
  const dangerous = "variant' OR true --";
  const query = inventoryLockQuery([dangerous]);
  assert.equal(query.text.includes(dangerous), false);
  assert.deepEqual(query.values, [dangerous]);
  assert.deepEqual(await lockInventories({}, []), new Map());
  assert.throws(() => inventoryLockQuery([]));
});

test("runtime group can access its own-auth users/sessions but cannot change DDL", async () => {
  await db.exec("SET ROLE test_api;");
  try {
    const { rows } = await db.query("SELECT id FROM app.auth_sessions WHERE user_id = 'customer'");
    assert.deepEqual(rows, [{ id: "session" }]);
    await assert.rejects(db.exec("ALTER TABLE app.users ADD COLUMN forbidden text"), (error) => error.code === "42501");
    await assert.rejects(db.exec("CREATE TABLE app.forbidden (id integer)"), (error) => error.code === "42501");
    await assert.rejects(db.query("SELECT * FROM app._prisma_migrations"), (error) => error.code === "42501");
  } finally { await db.exec("RESET ROLE;"); }
});

test("anonymous and Supabase authenticated roles cannot read private tables", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role};`);
    try {
      await assert.rejects(db.query("SELECT * FROM app.users"), (error) => error.code === "42501");
    } finally { await db.exec("RESET ROLE;"); }
  }
});

test("RLS still blocks browser roles if table grants are accidentally added", async () => {
  await db.exec("BEGIN; GRANT USAGE ON SCHEMA app TO anon; GRANT SELECT ON app.users TO anon; SET ROLE anon;");
  try {
    assert.deepEqual((await db.query("SELECT id FROM app.users")).rows, []);
  } finally { await db.exec("RESET ROLE; ROLLBACK;"); }
});

test("constraints reject invalid stock, quantities and prices", async () => {
  for (const sql of [
    "UPDATE app.inventory_levels SET on_hand = -1 WHERE variant_id = 'variant-a'",
    "UPDATE app.inventory_levels SET reserved = -1 WHERE variant_id = 'variant-a'",
    "UPDATE app.inventory_levels SET reserved = 21 WHERE variant_id = 'variant-a'",
    "UPDATE app.order_items SET quantity = 0 WHERE id = 'item'",
    "UPDATE app.product_variants SET price_cents = -1 WHERE id = 'variant-a'",
    "UPDATE app.orders SET total_cents = -1 WHERE id = 'order'",
  ]) await assert.rejects(db.exec(sql), (error) => error.code === "23514");
});

test("schema stores existing IDs, password hashes and historical snapshots unchanged", async () => {
  const { rows } = await db.query(`SELECT u.id, u.password_hash, i.product_name_snapshot,
    i.unit_price_cents_snapshot, o.total_cents FROM app.users u
    JOIN app.orders o ON o.user_id=u.id JOIN app.order_items i ON i.order_id=o.id`);
  assert.deepEqual(rows, [{ id: "customer", password_hash: "test-hash",
    product_name_snapshot: "Test", unit_price_cents_snapshot: 2500, total_cents: 37500 }]);
});

test("email uniqueness is case-insensitive and foreign keys are enforced", async () => {
  await assert.rejects(db.exec(`INSERT INTO app.users (id,name,email,password_hash,updated_at)
    VALUES ('duplicate','Test','CUSTOMER@example.invalid','hash',now())`), (error) => error.code === "23505");
  await assert.rejects(db.exec(`INSERT INTO app.auth_sessions (id,token_hash,user_id,expires_at)
    VALUES ('orphan',repeat('b',64),'absent',now())`), (error) => error.code === "23503");
});

test("timestamps retain the instant across timezone offsets", async () => {
  const { rows } = await db.query(`SELECT
    '2026-10-12 09:00:00-03'::timestamptz = '2026-10-12 12:00:00Z'::timestamptz AS same`);
  assert.equal(rows[0].same, true);
});

test("every domain foreign key has a covering index", async () => {
  const { rows } = await db.query(`SELECT c.conname FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE c.contype='f' AND n.nspname='app'
    AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid
      AND i.indisvalid AND i.indpred IS NULL AND i.indkey[0]=c.conkey[1])`);
  assert.deepEqual(rows, []);
});

test("demoting the old cover before insert/update supports the partial unique index", async () => {
  await db.exec("BEGIN;");
  try {
    await db.exec(`INSERT INTO app.media_assets (id,url) VALUES
      ('cover-old','https://example.invalid/old.png'),('cover-new','https://example.invalid/new.png');
      INSERT INTO app.product_images (id,product_id,asset_id,type) VALUES ('old-image','product','cover-old','PRIMARY');
      UPDATE app.product_images SET type='SECONDARY' WHERE product_id='product' AND type='PRIMARY';
      INSERT INTO app.product_images (id,product_id,asset_id,type) VALUES ('new-image','product','cover-new','PRIMARY');`);
    assert.deepEqual((await db.query("SELECT id FROM app.product_images WHERE product_id='product' AND type='PRIMARY'")).rows,[{id:'new-image'}]);
    await db.exec("UPDATE app.product_images SET type='SECONDARY' WHERE product_id='product' AND type='PRIMARY'; UPDATE app.product_images SET type='PRIMARY' WHERE id='old-image';");
    assert.deepEqual((await db.query("SELECT id FROM app.product_images WHERE product_id='product' AND type='PRIMARY'")).rows,[{id:'old-image'}]);
  } finally { await db.exec("ROLLBACK;"); }
});
