import assert from "node:assert/strict";
import test from "node:test";

// A dummy local URL only initializes the lazy Prisma client. These tests stub
// its transactions and never connect to any database or load real credentials.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=app";
const { prisma } = await import("../src/db/prisma.js");
const { createOrder, updateOrder } = await import("../src/services/order.service.js");

test("creation rejects fewer than 15 pieces before touching the database", async () => {
  await assert.rejects(createOrder({ items: [{ variantId: "variant", quantity: 14 }] }),
    (error) => error.code === "MINIMUM_ORDER" && error.message.includes("15"));
});

test("creation accepts 15 pieces, including repeated variants", async () => {
  const original = prisma.$transaction;
  let called = 0;
  prisma.$transaction = async (_callback, options) => {
    called++;
    assert.equal(options.isolationLevel, "Serializable");
    return "accepted";
  };
  try {
    assert.equal(await createOrder({ items: [{ variantId: "variant", quantity: 15 }] }), "accepted");
    assert.equal(await createOrder({ items: [{ variantId: "variant", quantity: 8 }, { variantId: "variant", quantity: 7 }] }), "accepted");
    assert.equal(called, 2);
  } finally { prisma.$transaction = original; }
});

test("editing items uses the same 15-piece minimum", async () => {
  const original = prisma.$transaction;
  prisma.$transaction = async (work) => work({ order: { findFirst: async () => ({
    id: "order", status: "NOVO", paidAmountCents: 0, items: [],
  }) } });
  try {
    await assert.rejects(updateOrder("order", { items: [{ variantId: "variant", quantity: 14 }] }, { id: "staff" }),
      (error) => error.code === "MINIMUM_ORDER" && error.message.includes("15"));
  } finally { prisma.$transaction = original; }
});
