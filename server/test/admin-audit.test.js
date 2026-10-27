import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=app";
const { prisma } = await import("../src/db/prisma.js");
const handlers = await import("../src/controllers/admin.controller.js");

const cases = [
  ["createCategory", "category", "create", "category"],
  ["updateCategory", "category", "update", "category"],
  ["createVariantOption", "variantOption", "create", "option"],
  ["updateVariantOption", "variantOption", "update", "option"],
  ["createStaff", "user", "create", "user"],
];

// A transactional adapter double: failed callbacks never commit the draft.
// This verifies handler coordination, not PostgreSQL's rollback implementation.
for (const [name, model, method, responseKey] of cases) {
  test(`${name}: mutation and audit commit together, audit failure leaves no mutation`, async (t) => {
    let committed = { writes: [], audits: [] };
    let rejectAudit = false;
    let transactions = 0;
    const previousTransaction = prisma.$transaction;
    const previousMutation = prisma[model][method];
    prisma[model][method] = async () => { throw new Error("mutation outside transaction"); };
    prisma.$transaction = async callback => {
      transactions += 1;
      const draft = structuredClone(committed);
      const tx = {
        [model]: {
          [method]: async ({ data }) => {
            const row = { id: "test-row", ...data };
            draft.writes.push(row);
            return row;
          },
        },
        auditLog: { create: async ({ data }) => {
          if (rejectAudit) throw new Error("audit unavailable");
          draft.audits.push(data);
        } },
      };
      const result = await callback(tx);
      committed = draft;
      return result;
    };
    t.after(() => {
      prisma.$transaction = previousTransaction;
      prisma[model][method] = previousMutation;
    });
    const req = {
      user: { id: "test-admin" }, params: { id: "test-row" },
      body: { name: "Test", type: "COLOR", email: "staff@example.invalid", password: "only-a-test-password" },
    };
    let payload;
    const res = { status() { return this; }, json(value) { payload = value; return this; } };
    const next = error => { throw error; };
    await handlers[name](req, res, next);
    assert.equal(transactions, 1);
    assert.equal(committed.writes.length, 1);
    assert.equal(committed.audits.length, 1);
    assert.equal(committed.audits[0].entityId, payload[responseKey].id);
    assert.equal(committed.audits[0].actorId, "test-admin");
    if (model === "user") {
      assert.equal(payload.user.passwordHash, undefined);
      assert.equal(committed.audits[0].afterJson.passwordHash, undefined);
      assert.match(committed.writes[0].passwordHash, /^\$argon2id\$/);
    }
    const beforeFailure = structuredClone(committed);
    rejectAudit = true;
    await assert.rejects(handlers[name](req, res, next), /audit unavailable/);
    assert.deepEqual(committed, beforeFailure);
  });
}
