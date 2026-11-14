import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCartLines, isValidCartLine, addCartLines, changeCartLine, removeSubmittedCartLines } from "../src/utils/cart.js";

const product = { id: "product-1", name: "Camiseta", price: 25, weight: 0.2, image: "/shirt.jpg" };
const option = (overrides = {}) => ({ name: "Preto", variants: [{ id: "variant-1", size: "M", price: 30, available: 10, ...overrides }] });
const line = (overrides = {}) => ({ key: "variant-1", variantId: "variant-1", productId: product.id,
  name: product.name, color: "Preto", size: "M", quantity: 2, price: 30, weight: 0.2,
  image: product.image, available: 10, ...overrides });

test("order confirmation removes submitted quantities, not pieces added while waiting", () => {
  const submitted = [line({ quantity: 2 })];
  assert.deepEqual(removeSubmittedCartLines(submitted, submitted), []);
  const newVariant = line({ key: "variant-2", variantId: "variant-2", quantity: 1 });
  const current = [line({ quantity: 5 }), newVariant];
  assert.deepEqual(removeSubmittedCartLines(current, submitted), [line({ quantity: 3 }), newVariant]);
  assert.equal(current[0].quantity, 5);
  assert.deepEqual(removeSubmittedCartLines([line({ quantity: 1 })], submitted), []);
  assert.deepEqual(removeSubmittedCartLines([newVariant], submitted), [newVariant]);
});

test("persisted cart rejects malformed containers and individual corrupt lines", () => {
  for (const value of [null, {}, "[]", 2]) assert.deepEqual(sanitizeCartLines(value), []);
  const valid = line();
  const invalid = [null, {}, [], line({ key: "wrong" }), line({ productId: null }),
    line({ name: {} }), line({ color: null }), line({ size: [] }), line({ price: "30" }),
    line({ price: NaN }), line({ price: -1 }), line({ weight: Infinity }),
    line({ weight: undefined }), line({ image: {} }), line({ available: 1.5 })];
  assert.deepEqual(sanitizeCartLines([valid, ...invalid, line()]), [valid]);
  assert.equal(isValidCartLine(line({ price: 0, weight: 0 })), true);
  assert.equal(isValidCartLine(line({ available: null })), true);
  const restored = sanitizeCartLines(JSON.parse(JSON.stringify([null, {}, valid])));
  assert.equal(restored.reduce((sum, item) => sum + item.quantity * item.price, 0), 60);
});

test("quantities must be positive safe integers on hydration and addition; invalid edits are no-ops", () => {
  const old = [line()];
  for (const quantity of ["2", "", null, undefined, true, {}, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(sanitizeCartLines([line({ quantity })]), [], String(quantity));
    assert.deepEqual(addCartLines([], product, option(), { M: quantity }), [], String(quantity));
    assert.equal(changeCartLine(old, "variant-1", quantity), old, String(quantity));
  }
  assert.deepEqual(sanitizeCartLines([line({ quantity: 0 })]), []);
  assert.deepEqual(addCartLines([], product, option(), { M: 0 }), []);
  assert.deepEqual(changeCartLine(old, "variant-1", 0), []);
});

test("variant price takes precedence, including zero; only missing prices fall back", () => {
  for (const [price, expected] of [[30, 30], [0, 0], [undefined, 25], [null, 25]]) {
    const result = addCartLines([], product, option({ price }), { M: 2 });
    assert.equal(result[0].price, expected);
    assert.equal(result[0].quantity, 2);
  }
  for (const price of ["30", NaN, Infinity, -1]) {
    assert.deepEqual(addCartLines([], product, option({ price }), { M: 1 }), []);
  }
});

test("addition and edits cap stock, merge by variant, and do not mutate previous state", () => {
  const old = [Object.freeze(line())];
  const added = addCartLines(old, product, option(), { M: 20, G: 1 });
  assert.equal(added.length, 1);
  assert.equal(added[0].quantity, 10);
  assert.equal(old[0].quantity, 2);
  assert.equal(changeCartLine(old, "variant-1", 20)[0].quantity, 10);
  assert.equal(changeCartLine(old, "variant-1", 3)[0].quantity, 3);
  assert.deepEqual(changeCartLine(old, "missing", 0), old);
  for (const available of [0, -1, 1.5, "10", NaN, Infinity]) {
    assert.deepEqual(addCartLines([], product, option({ available }), { M: 1 }), []);
  }
  const max = [line({ quantity: Number.MAX_SAFE_INTEGER, available: null })];
  assert.equal(addCartLines(max, product, option({ available: null }), { M: 1 })[0].quantity, Number.MAX_SAFE_INTEGER);
});

test("invalid catalog inputs cannot create invalid lines", () => {
  for (const args of [[null, option(), { M: 1 }], [product, null, { M: 1 }],
    [product, {}, { M: 1 }], [product, option(), null], [{ ...product, weight: undefined }, option(), { M: 1 }]]) {
    assert.deepEqual(addCartLines([], ...args), []);
  }
});

test('C2/C3: adding again refreshes price/availability and keeps other colors and sizes separate', () => {
  const first = line({ quantity: 2, price: 30, available: 10 });
  const otherSize = line({ key: 'variant-2', variantId: 'variant-2', size: 'G', quantity: 3 });
  const old = [Object.freeze(first), Object.freeze(otherSize)];
  const refreshed = addCartLines(old, product, option({ price: 0, available: 4 }), { M: 9 });
  assert.deepEqual(refreshed.map(({ variantId, quantity, price, available }) => ({ variantId, quantity, price, available })), [
    { variantId: 'variant-1', quantity: 4, price: 0, available: 4 },
    { variantId: 'variant-2', quantity: 3, price: 30, available: 10 },
  ]);
  const rose = { name: 'Rose', variants: [{ id: 'variant-3', size: 'M', price: 35, available: 8 }] };
  const added = addCartLines(refreshed, product, rose, { M: 2 });
  assert.deepEqual(added.map(({ variantId, color, size, quantity }) => [variantId, color, size, quantity]), [
    ['variant-1', 'Preto', 'M', 4], ['variant-2', 'Preto', 'G', 3], ['variant-3', 'Rose', 'M', 2],
  ]);
  const edited = changeCartLine(added, 'variant-1', 1);
  assert.equal(edited[0].quantity, 1);
  assert.deepEqual(edited.slice(1), added.slice(1));
  assert.deepEqual(old.map(({ quantity, price, available }) => [quantity, price, available]), [[2, 30, 10], [3, 30, 10]]);
});
