import assert from "node:assert/strict";
import test from "node:test";
import { databaseUrlSchema } from "../src/config/database.js";

test("accepts local PostgreSQL and the private app schema", () => {
  for (const protocol of ["postgres", "postgresql"]) {
    assert.equal(databaseUrlSchema.safeParse(`${protocol}://test:test@localhost:5432/test?schema=app`).success, true);
  }
});

test("accepts remote direct and session-pooler connections with TLS", () => {
  for (const host of ["db.example.supabase.co", "aws-0-region.pooler.supabase.com"]) {
    assert.equal(databaseUrlSchema.safeParse(`postgresql://test:test@${host}:5432/postgres?schema=app&sslmode=require`).success, true);
  }
});

test("rejects the old provider, a public schema, missing database and remote plaintext", () => {
  for (const url of [
    "mysql://test:test@localhost:3306/test?schema=app",
    "postgresql://test:test@localhost:5432/test",
    "postgresql://test:test@localhost:5432/test?schema=public",
    "postgresql://test:test@localhost:5432/?schema=app",
    "postgresql://test:test@remote.example:5432/test?schema=app",
    "not a connection",
  ]) assert.equal(databaseUrlSchema.safeParse(url).success, false);
});

test("validation guidance does not reveal credentials", () => {
  const result = databaseUrlSchema.safeParse("mysql://test:do-not-print-this@localhost/test");
  assert.equal(result.success, false);
  assert.equal(JSON.stringify(result.error.flatten()).includes("do-not-print-this"), false);
});
