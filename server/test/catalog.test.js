import assert from "node:assert/strict";
import test from "node:test";

// Only initializes Prisma's lazy client; every operation below is a double.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=app";
const { prisma } = await import("../src/db/prisma.js");
const catalog = await import("../src/controllers/catalog.controller.js");
const { listBanners } = await import("../src/controllers/public.controller.js");

const product = {
  id: "product", slug: "dress", name: "Dress", active: true,
  priceCents: 1000, category: { id: "category", name: "Dresses", slug: "dresses" },
  images: [{ id: "image", asset: { url: "https://example.test/image", altText: "Dress", width: 1066, height: 1600 } }],
  options: [{
    id: "option", active: true, variantOption: { name: "Blue", type: "COLOR" },
    variants: [{ id: "variant", active: true, size: { code: "M" }, inventory: { onHand: 8, reserved: 3 } }],
  }],
};

function stub(t, target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  t.after(() => { target[key] = original; });
}

async function invoke(handler, overrides = {}) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({
    params: { id: "product", optionId: "option", variantId: "variant", slug: "dress" },
    user: { id: "admin" }, body: { active: false }, ...overrides,
  }, res);
  return res;
}

test("public list/detail use identical active relation filters; admin includes inactive records", async (t) => {
  const queries = [];
  stub(t, prisma.product, "findMany", async (query) => { queries.push(query); return [product]; });
  stub(t, prisma.product, "findFirst", async (query) => { queries.push(query); return product; });
  const list = await invoke(catalog.listProducts);
  const detail = await invoke(catalog.getProduct);
  await invoke(catalog.listAdminProducts);
  const [listQuery, detailQuery, adminQuery] = queries;
  assert.deepEqual(listQuery.where, { active: true, category: { active: true } });
  assert.deepEqual(detailQuery.where, { slug: "dress", ...listQuery.where });
  assert.deepEqual(detailQuery.include, listQuery.include);
  assert.deepEqual(listQuery.include.options.where, { active: true, variantOption: { active: true } });
  assert.deepEqual(listQuery.include.options.include.variants.where, { active: true, size: { active: true } });
  assert.equal(adminQuery.where, undefined);
  assert.equal(adminQuery.include.options.where, undefined);
  assert.equal(adminQuery.include.options.include.variants.where, undefined);
  assert.deepEqual(detail.body.product, list.body.products[0]);
  assert.equal(detail.body.product.options[0].variants[0].available, 5);
  assert.equal(detail.body.product.options[0].variants[0].priceCents, 1000);
  assert.equal(detail.body.product.images[0].url, product.images[0].asset.url);
  assert.equal(detail.body.product.images[0].width, 1066);
  assert.equal(detail.body.product.images[0].height, 1600);
});

test("public banners expose the dimensions needed for responsive images", async (t) => {
  stub(t, prisma.siteBanner, "findMany", async () => [{
    id: "banner", title: "Banner", subtitle: null, linkUrl: null, sortOrder: 0,
    asset: { url: "https://example.test/banner", altText: "Banner", width: 1600, height: 750 },
  }]);
  const res = await invoke(listBanners);
  assert.equal(res.body.banners[0].width, 1600);
  assert.equal(res.body.banners[0].height, 750);
});

test("public detail returns not found when the filtered query finds nothing", async (t) => {
  stub(t, prisma.product, "findFirst", async () => null);
  await assert.rejects(invoke(catalog.getProduct), { status: 404 });
});

// A copy-on-write in-memory transactional adapter, not a PostgreSQL rollback test.
function transactionalAdapter(t, { auditFails = false, invalidRelation = false } = {}) {
  const state = { writes: [], audits: [] };
  const calls = [];
  for (const [model, methods] of Object.entries({
    product: ["create", "update", "findUnique"],
    productOption: ["update", "findFirst"],
    productVariant: ["update", "findUnique"], productImage: ["create"],
  })) {
    for (const method of methods) stub(t, prisma[model], method, async () => {
      assert.fail(`${model}.${method} must run inside the transaction`);
    });
  }
  stub(t, prisma, "$transaction", async (work) => {
    const draft = structuredClone(state);
    const write = (model, result) => async (query) => {
      calls.push({ model, query });
      draft.writes.push({ model, data: query.data });
      return structuredClone(result);
    };
    const tx = {
      product: {
        create: write("product", product), update: write("product", product),
        findUnique: async (query) => {
          assert.deepEqual(query.where, { id: "product" });
          return { id: "product" };
        },
      },
      productOption: {
        findFirst: async (query) => {
          assert.deepEqual(query.where, { id: "option", productId: "product" });
          return invalidRelation ? null : { id: "option" };
        },
        update: write("productOption", { id: "option", active: false }),
      },
      productVariant: {
        findUnique: async (query) => {
          assert.deepEqual(query, { where: { id: "variant" }, include: { productOption: true } });
          return { id: "variant", productOption: { productId: invalidRelation ? "other" : "product" } };
        },
        update: write("productVariant", { id: "variant", active: false }),
      },
      productImage: { create: write("productImage", { id: "image", assetId: "asset", asset: { url: "image-url" } }) },
      auditLog: { create: async ({ data }) => {
        if (auditFails) throw new Error("Audit unavailable");
        draft.audits.push(data);
      } },
    };
    const result = await work(tx);
    Object.assign(state, draft);
    return result;
  });
  return { state, calls };
}

const mutations = [
  ["createProduct", "product", "PRODUCT", "CREATED", 201],
  ["updateProduct", "product", "PRODUCT", "UPDATED", 200],
  ["updateProductOption", "option", "PRODUCT_OPTION", "UPDATED", 200],
  ["updateProductVariant", "variant", "PRODUCT_VARIANT", "UPDATED", 200],
  ["addProductImage", "image", "PRODUCT_IMAGE", "CREATED", 201],
];

for (const [handler, key, entityType, action, status] of mutations) {
  test(`${handler} commits mutation and audit together and preserves response`, async (t) => {
    const { state, calls } = transactionalAdapter(t);
    const body = key === "image" ? { assetId: "asset", productOptionId: "option" } : { active: false };
    const result = await invoke(catalog[handler], { body });
    assert.equal(result.statusCode, status);
    assert.equal(result.body[key].id, key);
    assert.equal(state.writes.length, 1);
    assert.equal(state.audits.length, 1);
    assert.deepEqual(state.writes[0].data, key === "image" ? { productId: "product", ...body } : body);
    assert.equal(state.audits[0].actorId, "admin");
    assert.equal(state.audits[0].entityType, entityType);
    assert.equal(state.audits[0].entityId, key);
    assert.equal(state.audits[0].action, action);
    if (key === "product") {
      assert.equal(calls[0].query.include.options.include.variants.include.inventory, true);
      assert.equal(result.body.product.options[0].variants[0].available, 5);
    } else if (key === "image") {
      assert.deepEqual(calls[0].query.include, { asset: true });
      assert.equal(result.body.image.asset.url, "image-url");
    } else assert.equal(result.body[key].active, false);
  });

  test(`${handler} does not commit mutation when audit fails (in-memory adapter)`, async (t) => {
    const { state, calls } = transactionalAdapter(t, { auditFails: true });
    await assert.rejects(invoke(catalog[handler]), /Audit unavailable/);
    assert.equal(calls.length, 1, "the mutation was attempted before audit failed");
    assert.deepEqual(state, { writes: [], audits: [] });
  });
}

for (const handler of ["updateProductOption", "updateProductVariant", "addProductImage"]) {
  test(`${handler} rejects a foreign option/variant inside the transaction before writing`, async (t) => {
    const { state, calls } = transactionalAdapter(t, { invalidRelation: true });
    await assert.rejects(invoke(catalog[handler], {
      body: { productOptionId: "option", assetId: "asset" },
    }), (error) => handler === "addProductImage"
      ? error.code === "INVALID_PRODUCT_OPTION"
      : error.status === 404);
    assert.equal(calls.length, 0);
    assert.deepEqual(state, { writes: [], audits: [] });
  });
}
