import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderMessage } from "../src/utils/whatsapp.js";

test("order message preserves grouping, totals, delivery and order number", () => {
  const message = buildOrderMessage({
    lines: [
      { name: "Camiseta", size: "M", color: "Preto", quantity: 2 },
      { name: "Camiseta", size: "M", color: "Branco", quantity: 1 },
      { name: "Camiseta", size: "G", color: "Preto", quantity: 3 },
    ], qtyTotal: 6, selectedDelivery: { label: "Correios" }, orderNumber: "FM-123",
  });
  for (const content of ['FM-123', 'CAMISETA', 'Preto: 2', 'Branco: 1', 'Preto: 3', 'Total de peças: 6', 'Correios']) {
    assert.ok(message.includes(content), `missing order data: ${content}`);
  }
  assert.equal(message.split('CAMISETA').length - 1, 1);
  assert.ok(message.indexOf('M\n') < message.indexOf('Branco: 1'));
  assert.ok(message.indexOf('G\n') < message.indexOf('Preto: 3'));
  assert.equal(buildOrderMessage({ lines: [] }), "");
  assert.equal(buildOrderMessage({}), "");
});

test("prototype-like product names and sizes are ordinary grouping keys", () => {
  const keys = ["__proto__", "constructor", "toString"];
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const lines = keys.flatMap(name => keys.map(size => ({ name, size, color: "Preto", quantity: 1 })));
  const message = buildOrderMessage({ lines, qtyTotal: lines.length });
  for (const key of keys) assert.ok(message.includes(key.toUpperCase()));
  assert.equal(message.match(/Preto: 1/g).length, 9);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});
