import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test, { before, after } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// SQL real em PostgreSQL WASM na memória; nunca toca DATABASE_URL/Supabase.
let db;
before(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;");
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  const entries = await readdir(migrations, { withFileTypes: true });
  for (const entry of entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await db.exec(await readFile(new URL(`${entry.name}/migration.sql`, migrations), "utf8"));
    if (entry.name.endsWith("_postgresql_init")) {
      await db.exec("CREATE TABLE app._prisma_migrations (id text PRIMARY KEY);");
    }
  }
  await db.exec("CREATE ROLE test_api LOGIN; GRANT ferchu_backend TO test_api;");
});
after(async () => { if (db) await db.close(); });

test("log_entry é particionada por mês, com partição default e RLS em tudo", async () => {
  const { rows: parent } = await db.query(`SELECT c.relkind, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relname = 'log_entry'`);
  assert.equal(parent[0].relkind, "p");
  assert.equal(parent[0].relrowsecurity, true);
  const { rows: partitions } = await db.query(`SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'app' AND p.relname = 'log_entry' ORDER BY c.relname`);
  assert.equal(partitions.length, 4);
  assert.ok(partitions.every((row) => row.relrowsecurity));
  assert.ok(partitions.some((row) => row.relname === "log_entry_default"));
  const { rows: policies } = await db.query(`SELECT c.relname
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relname IN ('log_entry', 'log_dead')`);
  assert.equal(policies.length, 2);
});

test("grupo do backend insere e lê via tabela-mãe; nível fora da faixa é rejeitado", async () => {
  await db.exec("SET ROLE test_api;");
  try {
    await db.exec(`INSERT INTO app.log_entry (level, service, event, message)
      VALUES (30, 'api', 'order.created', 'Pedido FM-TEST criado')`);
    const { rows } = await db.query("SELECT level, event FROM app.log_entry");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 30);
    await assert.rejects(
      db.exec(`INSERT INTO app.log_entry (level, service, event, message) VALUES (23, 'api', 'x', 'y')`),
      (error) => error.code === "23514",
    );
  } finally {
    await db.exec("RESET ROLE;");
  }
});

test("roles de navegador não acessam as tabelas de log", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role};`);
    try {
      await assert.rejects(db.query("SELECT * FROM app.log_entry"), (error) => error.code === "42501");
      await assert.rejects(db.query("SELECT * FROM app.log_dead"), (error) => error.code === "42501");
    } finally {
      await db.exec("RESET ROLE;");
    }
  }
});

test("existe índice BRIN físico de ts nas partições", async () => {
  const { rows } = await db.query(`SELECT c.relname FROM pg_class c
    JOIN pg_am am ON am.oid = c.relam
    WHERE am.amname = 'brin' AND c.relname LIKE 'log\\_entry%'`);
  assert.ok(rows.length >= 1);
});

test("manutenção cria partições futuras e remove as fora da retenção", async () => {
  await db.exec(`CREATE TABLE app.log_entry_2020_01 PARTITION OF app.log_entry
    FOR VALUES FROM ('2020-01-01') TO ('2020-02-01')`);
  const { rows: expected } = await db.query(`SELECT
    to_char(date_trunc('month', now()) + interval '1 month', 'YYYY_MM') AS next1,
    to_char(date_trunc('month', now()) + interval '2 month', 'YYYY_MM') AS next2`);
  await db.query("SELECT app.log_entry_maintenance()");
  const { rows: dropped } = await db.query("SELECT to_regclass('app.log_entry_2020_01') AS ref");
  assert.equal(dropped[0].ref, null);
  for (const suffix of [expected[0].next1, expected[0].next2]) {
    const { rows } = await db.query("SELECT to_regclass($1) AS ref", [`app.log_entry_${suffix}`]);
    assert.equal(rows[0].ref, `app.log_entry_${suffix}`);
  }
});

test("log_dead registra lotes rejeitados com motivo", async () => {
  await db.exec("SET ROLE test_api;");
  try {
    await db.exec(`INSERT INTO app.log_dead (fail_reason, payload)
      VALUES ('db down', '[{"event":"order.created"}]'::jsonb)`);
    const { rows } = await db.query("SELECT fail_reason, payload FROM app.log_dead");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fail_reason, "db down");
    assert.equal(rows[0].payload[0].event, "order.created");
  } finally {
    await db.exec("RESET ROLE;");
  }
});
