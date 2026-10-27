import { getVariant } from "./domainFunctions.js";

const isText = value => typeof value === "string" && value.trim().length > 0;
const isAmount = value => Number.isFinite(value) && value >= 0;
const isStock = value => value == null || (Number.isSafeInteger(value) && value >= 0);
const isQuantity = value => Number.isSafeInteger(value) && value > 0;

// Persisted data is untrusted: never coerce quantities, prices or identifiers.
export function isValidCartLine(line) {
  return line !== null && typeof line === "object" && !Array.isArray(line)
    && isText(line.key) && line.key === line.variantId && isText(line.productId)
    && isText(line.name) && isText(line.color) && isText(line.size)
    && isQuantity(line.quantity) && isAmount(line.price) && isAmount(line.weight)
    && isStock(line.available)
    && (line.image == null || typeof line.image === "string");
}

export function sanitizeCartLines(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(line => {
    if (!isValidCartLine(line) || seen.has(line.variantId)) return false;
    seen.add(line.variantId);
    return true;
  });
}

export function addCartLines(lines, product, color, quantities) {
  if (!product || !color || !Array.isArray(color.variants)
    || !quantities || typeof quantities !== "object" || Array.isArray(quantities)) return lines;

  const next = [...lines];
  for (const [size, quantity] of Object.entries(quantities)) {
    if (!isQuantity(quantity)) continue;
    const variant = getVariant(color, size);
    if (!variant || !isStock(variant.available)) continue;
    const index = next.findIndex(line => line.variantId === variant.id);
    const existing = next[index];
    const available = variant.available ?? Number.MAX_SAFE_INTEGER;
    const current = existing?.quantity ?? 0;
    const quantityToAdd = Math.min(quantity, Math.max(0, available - current), Number.MAX_SAFE_INTEGER - current);
    if (quantityToAdd <= 0) continue;

    const line = {
      key: variant.id,
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      color: color.name,
      size,
      quantity: current + quantityToAdd,
      price: variant.price ?? product.price,
      weight: product.weight,
      image: product.image,
      available: variant.available,
    };
    if (!isValidCartLine(line)) continue;
    if (existing) next[index] = { ...existing, quantity: line.quantity, price: line.price, available: line.available };
    else next.push(line);
  }
  return next;
}

export function changeCartLine(lines, key, quantity) {
  // Zero is the explicit removal operation; malformed input is a no-op.
  if (!Number.isSafeInteger(quantity) || quantity < 0) return lines;
  return lines.flatMap(line => {
    if (line.key !== key) return [line];
    const nextQuantity = Math.min(quantity, line.available ?? Number.MAX_SAFE_INTEGER);
    return nextQuantity > 0 ? [{ ...line, quantity: nextQuantity }] : [];
  });
}

// A confirmation may arrive after navigation/editing. Do not erase pieces
// added while the submitted order was in flight.
export function removeSubmittedCartLines(lines, submittedLines) {
  const submitted = new Map(submittedLines.map(line => [line.variantId, line.quantity]));
  return lines.flatMap(line => {
    const quantity = line.quantity - (submitted.get(line.variantId) ?? 0);
    return quantity > 0 ? [{ ...line, quantity }] : [];
  });
}
