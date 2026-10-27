import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadConfigFromFile } from "@prisma/config";

test("Prisma config loads schema and migration settings with the patched merger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ferchu-prisma-config-"));
  try {
    await writeFile(join(directory, "prisma.config.mjs"), `export default {
      schema: "prisma/schema.prisma",
      migrations: { path: "prisma/migrations", seed: "node prisma/seed.js" }
    };`);
    const result = await loadConfigFromFile({ configRoot: directory });
    assert.equal(result.error, undefined);
    assert.equal(result.config.schema, join(directory, "prisma/schema.prisma"));
    assert.equal(result.config.migrations.path, join(directory, "prisma/migrations"));
    assert.equal(result.config.migrations.seed, "node prisma/seed.js");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Prisma resolves the fixed merger and merging circular graphs does not exhaust the stack", async () => {
  const require = createRequire(import.meta.url);
  const prismaRequire = createRequire(require.resolve("@prisma/config"));
  const { deepmerge } = prismaRequire("deepmerge-ts");
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const mergers = Object.entries(lock.packages).filter(([path]) => path.endsWith("node_modules/deepmerge-ts"));
  assert.ok(mergers.length > 0);
  assert.ok(mergers.every(([, pkg]) => pkg.version === "8.0.2"));
  const left = { value: 1 };
  const right = { value: 2 };
  left.self = left;
  right.self = right;
  const merged = deepmerge(left, right);
  assert.equal(merged.value, 2);
  assert.equal(merged.self, merged);
  assert.equal(left.value, 1);
});
