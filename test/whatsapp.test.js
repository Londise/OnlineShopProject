import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderMessage, buildWhatsAppUrl } from "../src/utils/whatsapp.js";

test("order message preserves grouping, totals, delivery and order number", () => {
  const message = buildOrderMessage({
    lines: [
      { name: "Camiseta", size: "M", color: "Preto", quantity: 2 },
      { name: "Camiseta", size: "M", color: "Branco", quantity: 1 },
      { name: "Camiseta", size: "G", color: "Preto", quantity: 3 },
    ], qtyTotal: 6, selectedDelivery: { label: "Correios" }, orderNumber: "FM-123",
  });
  assert.equal(message, "Olá! Gostaria de fazer o seguinte pedido:\nPedido: FM-123\n━━━━━━━━━━━━━━━━━━━━\n\n"
    + "📦 CAMISETA\n\nM\n• Preto: 2\n• Branco: 1\n\nG\n• Preto: 3\n\n━━━━━━━━━━━━━━━━━━━━\n\n"
    + "🧺 Total de peças: 6\n🚚 Entrega: Correios\n");
  assert.equal(buildOrderMessage({ lines: [] }), "");
  assert.equal(buildOrderMessage({}), "");
});

test("prototype-like product names and sizes are ordinary grouping keys", () => {
  const keys = ["__proto__", "constructor", "toString"];
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const lines = keys.flatMap(name => keys.map(size => ({ name, size, color: "Preto", quantity: 1 })));
  const message = buildOrderMessage({ lines, qtyTotal: lines.length });
  for (const key of keys) assert.ok(message.includes(`📦 ${key.toUpperCase()}\n`));
  assert.equal(message.match(/• Preto: 1/g).length, 9);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test("WhatsApp URL encodes message and phone without requiring window", () => {
  const message = "Olá! Pedido #1 & + 2\n📦 Camiseta?";
  const url = new URL(buildWhatsAppUrl(message, "+5511999999999"));
  assert.equal(url.origin, "https://api.whatsapp.com");
  assert.equal(url.pathname, "/send");
  assert.equal(url.searchParams.get("text"), message);
  assert.equal(url.searchParams.get("phone"), "+5511999999999");
  assert.ok(url.href.includes("%26"));
  for (const phone of [undefined, null, "", "   "]) {
    const fallback = new URL(buildWhatsAppUrl(message, phone));
    assert.equal(fallback.searchParams.has("phone"), false);
    assert.equal(fallback.searchParams.get("text"), message);
    assert.equal(fallback.href.includes("undefined"), false);
  }
});
