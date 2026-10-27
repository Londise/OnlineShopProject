import assert from "node:assert/strict";
import test from "node:test";

// Lazy Prisma initialization only. Every transaction below is an in-memory double.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=app";
const { prisma } = await import("../src/db/prisma.js");
const { createOrder, updateOrder, archiveOrder } = await import("../src/services/order.service.js");
const actor = { id: "staff" };
const MAX_INT = 2147483647;
const variant = (id = "v", price = 100, weight = 100) => ({
  id, priceCents: price, size: { code: "M" },
  productOption: {
    variantOption: { name: "Azul" },
    product: { name: "Blusa", priceCents: price, weightGrams: weight, images: [] },
  },
});
const item = (quantity = 15, price = 100, weight = 100) => ({
  productVariantId: "v", quantity, unitPriceCentsSnapshot: price,
  unitWeightGramsSnapshot: weight, lineTotalCentsSnapshot: price * quantity,
});
function initial(status = "NOVO") {
  return {
    order: { id: "order", publicNumber: "TEST", status, archivedAt: null,
      paidAmountCents: 0, shippingAmountCents: null, note: null, items: [item()] },
    inventory: [{ variantId: "v", onHand: status === "CONFIRMADO" ? 985 : 1000,
      reserved: status === "NOVO" ? 15 : 0 }],
    movements: [], audits: [],
  };
}
const input = (items = [{ variantId: "v", quantity: 15 }], method = "EXCURSAO") => ({
  items, customer: { name: "Cliente", whatsapp: "1234567890" },
  delivery: { method, postalCode: "01001000" },
});

// Snapshot commits model serializable conflicts, not PostgreSQL's lock engine.
async function withDatabase(state, options, work) {
  const original = prisma.$transaction;
  let committed = structuredClone(state);
  let revision = 0;
  const calls = { transactions: 0, writes: 0, filters: [] };
  prisma.$transaction = async (callback, transactionOptions) => {
    assert.equal(transactionOptions.isolationLevel, "Serializable");
    calls.transactions++;
    const version = revision;
    const draft = structuredClone(committed);
    const write = async (stage, fn) => {
      calls.writes++;
      await options.beforeWrite?.(stage);
      if (options.fail === stage) throw new Error(`failed ${stage}`);
      return fn();
    };
    const tx = {
      $queryRaw: async () => structuredClone(draft.inventory),
      productVariant: { findMany: async ({ where }) => {
        calls.filters.push(where);
        return (options.variants ?? [variant()]).filter((v) => where.id.in.includes(v.id));
      } },
      order: {
        findFirst: async () => draft.order?.archivedAt ? null : structuredClone(draft.order),
        create: async ({ data }) => write("create", () => {
          draft.order = { ...data, id: "order", status: "NOVO", archivedAt: null,
            paidAmountCents: 0, items: data.items.create };
          return structuredClone(draft.order);
        }),
        update: async ({ data }) => write(data.archivedAt ? "archive" : "update", () => {
          Object.assign(draft.order, data);
          return structuredClone(draft.order);
        }),
      },
      inventoryLevel: { update: async ({ where, data }) => write("inventory", () => {
        Object.assign(draft.inventory.find((row) => row.variantId === where.variantId), data);
      }) },
      inventoryMovement: { create: async ({ data }) => write("movement", () => draft.movements.push(data)) },
      auditLog: { create: async ({ data }) => write(data.action, () => draft.audits.push(data)) },
      orderItem: {
        deleteMany: async () => write("deleteItems", () => { draft.order.items = []; }),
        createMany: async ({ data }) => write("createItems", () => { draft.order.items = data; }),
      },
    };
    const result = await callback(tx);
    if (version !== revision) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
    committed = draft;
    revision++;
    return result;
  };
  try { await work({ calls, state: () => committed }); }
  finally { prisma.$transaction = original; }
}

for (const status of ["NOVO", "CONFIRMADO", "CANCELADO", "CONCLUIDO"]) {
  test(`archive ${status} commits inventory, cancellation and audits together`, async () => {
    await withDatabase(initial(status), {}, async ({ calls, state }) => {
      await archiveOrder("order", actor);
      assert.equal(calls.transactions, 1);
      assert.ok(state().order.archivedAt);
      assert.equal(state().order.archivedById, actor.id);
      assert.equal(state().order.status, status === "CONCLUIDO" ? status : "CANCELADO");
      assert.equal(state().inventory[0].reserved, 0);
      assert.equal(state().inventory[0].onHand, 1000);
      const cancelled = ["NOVO", "CONFIRMADO"].includes(status);
      assert.deepEqual(state().audits.map((a) => a.action), cancelled ? ["UPDATED", "ARCHIVED"] : ["ARCHIVED"]);
      assert.equal(state().movements.length, cancelled ? 1 : 0);
      await assert.rejects(updateOrder("order", { status: "NOVO" }, actor), { code: "NOT_FOUND" });
    });
  });
}

for (const fail of ["inventory", "movement", "update", "UPDATED", "archive", "ARCHIVED"]) {
  test(`archive rolls back all changes if ${fail} fails`, async () => {
    const before = initial();
    await withDatabase(before, { fail }, async ({ state }) => {
      await assert.rejects(archiveOrder("order", actor), new RegExp(`failed ${fail}`));
      assert.deepEqual(state(), before);
    });
  });
}

test("archive retries a concurrent reopen and never leaves archived reservations", async () => {
  let release;
  let reached;
  const paused = new Promise((resolve) => { reached = resolve; });
  const resume = new Promise((resolve) => { release = resolve; });
  let first = true;
  await withDatabase(initial("CANCELADO"), { beforeWrite: async (stage) => {
    if (stage === "archive" && first) { first = false; reached(); await resume; }
  } }, async ({ state, calls }) => {
    const archiving = archiveOrder("order", actor);
    await paused;
    try { await updateOrder("order", { status: "NOVO" }, actor); }
    finally { release(); }
    await archiving;
    assert.equal(calls.transactions, 3); // archive conflict, reopen, archive retry
    assert.equal(state().order.status, "CANCELADO");
    assert.ok(state().order.archivedAt);
    assert.equal(state().inventory[0].reserved, 0);
    assert.deepEqual(state().movements.map((m) => m.type), ["ORDER_RESERVE", "ORDER_RELEASE"]);
    assert.deepEqual(state().audits.map((a) => a.action), ["UPDATED", "UPDATED", "ARCHIVED"]);
  });
});

const overflowCases = [
  { name: "line price times quantity", variants: [variant("v", 10000000)], items: [{ variantId: "v", quantity: 999 }] },
  { name: "duplicate variant aggregation", variants: [variant("v", 2000000)], items: [{ variantId: "v", quantity: 600 }, { variantId: "v", quantity: 600 }] },
  { name: "aggregated quantity", items: [{ variantId: "v", quantity: MAX_INT }, { variantId: "v", quantity: 1 }] },
  { name: "subtotal", variants: [variant("v", 2000000), variant("v2", 2000000)], items: [{ variantId: "v", quantity: 600 }, { variantId: "v2", quantity: 600 }] },
  { name: "line weight", variants: [variant("v", 1, 3000000)], items: [{ variantId: "v", quantity: 999 }] },
  { name: "total weight", variants: [variant("v", 1, 2000000), variant("v2", 1, 2000000)], items: [{ variantId: "v", quantity: 600 }, { variantId: "v2", quantity: 600 }] },
];
const isOverflow = (error) => error.status === 422 && error.code === "ORDER_AMOUNT_OVERFLOW";
for (const scenario of overflowCases) {
  for (const editing of [false, true]) {
    test(`${editing ? "edit" : "create"} rejects ${scenario.name} before any write`, async () => {
      // Existing variants keep their immutable price/weight snapshots on edits.
      const before = initial();
      if (editing) before.order.items = [];
      before.inventory = (scenario.variants ?? [variant()]).map((v) => ({
        variantId: v.id, onHand: 2000, reserved: v.id === "v" && !editing ? 15 : 0,
      }));
      await withDatabase(before, { variants: scenario.variants }, async ({ calls, state }) => {
        await assert.rejects(editing
          ? updateOrder("order", { items: scenario.items }, actor)
          : createOrder(input(scenario.items), actor), isOverflow);
        assert.equal(calls.writes, 0);
        assert.deepEqual(state(), before);
      });
    });
  }
}

test("creation validates total including shipping before order persistence", async () => {
  // 999 * 2149633 = 2147483367: line fits, adding PAC shipping does not.
  await withDatabase(initial(), { variants: [variant("v", 2149633)] }, async ({ calls }) => {
    await assert.rejects(createOrder(input([{ variantId: "v", quantity: 999 }], "CORREIOS"), actor), isOverflow);
    assert.equal(calls.writes, 0);
  });
});

test("creation rejects overflowing shipping quote before persistence", async () => {
  await withDatabase(initial(), { variants: [variant("v", 1, 2149000)] }, async ({ calls }) => {
    const request = input([{ variantId: "v", quantity: 999 }], "CORREIOS");
    request.delivery.postalCode = "90000000";
    await assert.rejects(createOrder(request, actor), isOverflow);
    assert.equal(calls.writes, 0);
  });
});

test("creation accepts a valid amount near the Int boundary", async () => {
  const before = initial("CANCELADO");
  await withDatabase(before, { variants: [variant("v", 2149633)] }, async ({ state }) => {
    await createOrder(input([{ variantId: "v", quantity: 999 }]), actor);
    assert.equal(state().order.totalCents, 2147483367);
    assert.equal(state().inventory[0].reserved, 999);
  });
});

test("editing validates preserved snapshots, existing shipping and paid amounts before mutations", async () => {
  for (const changes of [
    { items: [item(15, 10000000)] },
    { items: [item(15, 1, 3000000)] },
    { shippingAmountCents: MAX_INT },
  ]) {
    const before = initial();
    Object.assign(before.order, changes);
    await withDatabase(before, {}, async ({ calls }) => {
      await assert.rejects(updateOrder("order", { items: [{ variantId: "v", quantity: 999 }] }, actor), isOverflow);
      assert.equal(calls.writes, 0);
    });
  }
  await withDatabase(initial(), {}, async ({ calls }) => {
    await assert.rejects(updateOrder("order", { paidAmountCents: MAX_INT + 1 }, actor), isOverflow);
    assert.equal(calls.writes, 0);
  });
});

test("valid creation and edit aggregate items and require active category and option", async () => {
  await withDatabase(initial(), {}, async ({ state, calls }) => {
    await createOrder(input([{ variantId: "v", quantity: 8 }, { variantId: "v", quantity: 7 }]), actor);
    assert.equal(state().order.items.length, 1);
    assert.equal(state().order.items[0].quantity, 15);
    await updateOrder("order", { items: [{ variantId: "v", quantity: 20 }] }, actor);
    assert.equal(state().order.totalCents, 2000);
    assert.equal(state().order.shippingAmountCents, null);
    for (const where of calls.filters) {
      assert.deepEqual(where.productOption, {
        active: true, variantOption: { active: true }, product: { active: true, category: { active: true } },
      });
    }
  });
});
