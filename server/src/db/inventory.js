import { Prisma } from "@prisma/client";

export function inventoryLockQuery(variantIds) {
  const ids = [...new Set(variantIds)].sort();
  if (!ids.length) throw new Error("Informe ao menos uma variante para bloquear.");
  // PostgreSQL folds unquoted aliases to lowercase. Preserve the JS field names.
  return Prisma.sql`
    SELECT variant_id AS "variantId", on_hand AS "onHand", reserved
    FROM "app"."inventory_levels"
    WHERE variant_id IN (${Prisma.join(ids)})
    ORDER BY variant_id
    FOR UPDATE
  `;
}

export async function lockInventories(tx, variantIds) {
  if (!variantIds.length) return new Map();
  const rows = await tx.$queryRaw(inventoryLockQuery(variantIds));
  return new Map(rows.map((row) => [
    row.variantId,
    { onHand: Number(row.onHand), reserved: Number(row.reserved) },
  ]));
}
