import test from "node:test";
import assert from "node:assert/strict";
import { parseInventoryQuantity } from "../src/utils/inventory.js";

test("stock input rejects empty values instead of converting them to zero", () => {
  for (const value of ["", " ", "\t\n", "\u00a0", undefined, null]) {
    assert.equal(parseInventoryQuantity(value), null, `input: ${String(value)}`);
  }
});

test("stock input accepts an intentional zero and nonnegative safe integers", () => {
  for (const [value, expected] of [
    ["0", 0],
    [0, 0],
    [" 12 ", 12],
    [12, 12],
    ["001", 1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(parseInventoryQuantity(value), expected);
  }
});

test("stock input rejects negative, fractional, nonfinite and unsafe quantities", () => {
  for (const value of [
    "-1", -1, "1.5", 1.5, "NaN", NaN, "Infinity", Infinity,
    "9007199254740992", "9007199254740993", Number.MAX_SAFE_INTEGER + 1,
    "1e309", "not a number", "1,5",
  ]) {
    assert.equal(parseInventoryQuantity(value), null, `input: ${String(value)}`);
  }
});

test("stock input does not coerce booleans, arrays or objects into quantities", () => {
  for (const value of [false, true, [], [0], {}, { valueOf: () => 0 }]) {
    assert.equal(parseInventoryQuantity(value), null);
  }
});
