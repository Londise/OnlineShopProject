import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { publicOrderNumber } from "../lib/security.js";
import { calculateShipping } from "./shipping.service.js";
import { writeAudit } from "./audit.service.js";

const variantInclude = {
  productOption: {
    include: {
      variantOption: true,
      product: {
        include: {
          images: {
            where: { type: "PRIMARY" },
            include: { asset: true },
            take: 1,
          },
        },
      },
    },
  },
  size: true,
  inventory: true,
};

const aggregateItems = (items) =>
  [
    ...items.reduce((map, item) => {
      map.set(item.variantId, (map.get(item.variantId) || 0) + item.quantity);
      return map;
    }, new Map()),
  ].map(([variantId, quantity]) => ({ variantId, quantity }));

async function lockInventories(tx, variantIds) {
  if (!variantIds.length) return new Map();
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT variant_id AS variantId, on_hand AS onHand, reserved
    FROM inventory_levels
    WHERE variant_id IN (${Prisma.join(variantIds)})
    FOR UPDATE
  `);
  return new Map(
    rows.map((row) => [
      row.variantId,
      { onHand: Number(row.onHand), reserved: Number(row.reserved) },
    ]),
  );
}

async function loadActiveVariants(tx, items) {
  const variantIds = items.map((item) => item.variantId);
  const variants = await tx.productVariant.findMany({
    where: {
      id: { in: variantIds },
      active: true,
      productOption: { active: true, product: { active: true } },
      size: { active: true },
    },
    include: variantInclude,
  });
  if (variants.length !== variantIds.length)
    throw new AppError(
      422,
      "INVALID_VARIANT",
      "Uma ou mais variações não estão disponíveis.",
    );
  return new Map(variants.map((variant) => [variant.id, variant]));
}

function snapshotItem(variant, quantity, previousItem) {
  const product = variant.productOption.product;
  const unitPriceCents =
    previousItem?.unitPriceCentsSnapshot ??
    variant.priceCents ??
    product.priceCents;
  const unitWeightGrams =
    previousItem?.unitWeightGramsSnapshot ?? product.weightGrams;
  return {
    productVariantId: variant.id,
    productNameSnapshot: previousItem?.productNameSnapshot ?? product.name,
    optionNameSnapshot:
      previousItem?.optionNameSnapshot ??
      variant.productOption.variantOption.name,
    sizeSnapshot: previousItem?.sizeSnapshot ?? variant.size.code,
    imageUrlSnapshot:
      previousItem?.imageUrlSnapshot ?? product.images[0]?.asset.url ?? null,
    unitPriceCentsSnapshot: unitPriceCents,
    unitWeightGramsSnapshot: unitWeightGrams,
    quantity,
    lineTotalCentsSnapshot: unitPriceCents * quantity,
  };
}

async function writeInventory(
  tx,
  variantId,
  next,
  delta,
  type,
  orderId,
  actorId,
  reason,
) {
  if (next.onHand < 0 || next.reserved < 0 || next.reserved > next.onHand)
    throw new AppError(
      409,
      "INSUFFICIENT_STOCK",
      "Estoque insuficiente para uma das variações.",
    );
  await tx.inventoryLevel.update({
    where: { variantId },
    data: { onHand: next.onHand, reserved: next.reserved },
  });
  if (delta.onHand || delta.reserved)
    await tx.inventoryMovement.create({
      data: {
        variantId,
        orderId,
        actorId,
        type,
        onHandDelta: delta.onHand,
        reservedDelta: delta.reserved,
        reason,
      },
    });
}

function assertTransition(from, to) {
  if (from === to) return;
  const transitions = {
    NOVO: ["CONFIRMADO", "CANCELADO"],
    CONFIRMADO: ["CONCLUIDO", "CANCELADO"],
    CANCELADO: ["NOVO"],
    CONCLUIDO: [],
  };
  if (!transitions[from].includes(to))
    throw new AppError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Não é possível alterar um pedido ${from} para ${to}.`,
    );
}

async function moveForStatus(
  tx,
  currentStatus,
  nextStatus,
  items,
  stock,
  orderId,
  actorId,
) {
  if (currentStatus === nextStatus) return;
  assertTransition(currentStatus, nextStatus);
  for (const item of items) {
    const level = stock.get(item.productVariantId);
    let next = { ...level };
    let delta = { onHand: 0, reserved: 0 };
    let type;
    if (currentStatus === "NOVO" && nextStatus === "CONFIRMADO") {
      next = {
        onHand: level.onHand - item.quantity,
        reserved: level.reserved - item.quantity,
      };
      delta = { onHand: -item.quantity, reserved: -item.quantity };
      type = "ORDER_CONSUME";
    }
    if (currentStatus === "NOVO" && nextStatus === "CANCELADO") {
      next.reserved -= item.quantity;
      delta.reserved = -item.quantity;
      type = "ORDER_RELEASE";
    }
    if (currentStatus === "CONFIRMADO" && nextStatus === "CANCELADO") {
      next.onHand += item.quantity;
      delta.onHand = item.quantity;
      type = "ORDER_RESTORE";
    }
    if (currentStatus === "CANCELADO" && nextStatus === "NOVO") {
      next.reserved += item.quantity;
      delta.reserved = item.quantity;
      type = "ORDER_RESERVE";
    }
    if (type) {
      await writeInventory(
        tx,
        item.productVariantId,
        next,
        delta,
        type,
        orderId,
        actorId,
        `Alteração de status: ${currentStatus} → ${nextStatus}`,
      );
      stock.set(item.productVariantId, next);
    }
  }
}

export async function createOrder(input, user) {
  const items = aggregateItems(input.items);
  if (items.reduce((total, item) => total + item.quantity, 0) < 20)
    throw new AppError(422, "MINIMUM_ORDER", "O pedido mínimo é de 20 peças.");
  return prisma.$transaction(
    async (tx) => {
      const variants = await loadActiveVariants(tx, items);
      const stock = await lockInventories(
        tx,
        items.map((item) => item.variantId),
      );
      if (stock.size !== items.length)
        throw new AppError(
          409,
          "MISSING_INVENTORY",
          "Estoque de uma variação ainda não foi configurado.",
        );
      const snapshots = items.map((item) =>
        snapshotItem(variants.get(item.variantId), item.quantity),
      );
      const subtotalCents = snapshots.reduce(
        (sum, item) => sum + item.lineTotalCentsSnapshot,
        0,
      );
      const totalWeightGrams = snapshots.reduce(
        (sum, item) => sum + item.unitWeightGramsSnapshot * item.quantity,
        0,
      );
      const quote = calculateShipping({
        method: input.delivery.method,
        postalCode: input.delivery.postalCode,
        totalWeightGrams,
      });
      const order = await tx.order.create({
        data: {
          publicNumber: publicOrderNumber(),
          userId: user?.role === "CUSTOMER" ? user.id : null,
          customerName: input.customer.name,
          customerEmail: input.customer.email ?? user?.email ?? null,
          customerWhatsApp: input.customer.whatsapp,
          deliveryMethod: input.delivery.method,
          postalCode: input.delivery.postalCode?.replace(/\D/g, "") ?? null,
          shippingAmountCents: quote.amountCents,
          shippingDetail: quote.detail,
          subtotalCents,
          totalCents: subtotalCents + (quote.amountCents ?? 0),
          note: input.note ?? null,
          items: { create: snapshots },
        },
        include: { items: true },
      });
      for (const item of items) {
        const level = stock.get(item.variantId);
        const next = {
          onHand: level.onHand,
          reserved: level.reserved + item.quantity,
        };
        await writeInventory(
          tx,
          item.variantId,
          next,
          { onHand: 0, reserved: item.quantity },
          "ORDER_RESERVE",
          order.id,
          user?.id,
          "Reserva de pedido novo",
        );
      }
      await writeAudit(tx, {
        actorId: user?.id,
        orderId: order.id,
        entityType: "ORDER",
        entityId: order.id,
        action: "CREATED",
        afterJson: { status: "NOVO", publicNumber: order.publicNumber },
      });
      return order;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateOrder(orderId, input, actor) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, archivedAt: null },
        include: { items: true },
      });
      if (!order) throw notFound("Pedido não encontrado.");
      const before = {
        status: order.status,
        paidAmountCents: order.paidAmountCents,
        itemCount: order.items.length,
      };
      let effectiveItems = order.items;
      const itemIds = new Set(order.items.map((item) => item.productVariantId));
      const requested = input.items ? aggregateItems(input.items) : null;
      if (
        requested &&
        requested.reduce((total, item) => total + item.quantity, 0) < 20
      ) {
        throw new AppError(
          422,
          "MINIMUM_ORDER",
          "O pedido mÃ­nimo Ã© de 20 peÃ§as.",
        );
      }
      requested?.forEach((item) => itemIds.add(item.variantId));
      const stock = await lockInventories(tx, [...itemIds]);

      if (requested) {
        if (order.status === "CONCLUIDO")
          throw new AppError(
            409,
            "ORDER_LOCKED",
            "Pedidos concluídos não podem ter itens alterados.",
          );
        const variants = await loadActiveVariants(tx, requested);
        const oldByVariant = new Map(
          order.items.map((item) => [item.productVariantId, item]),
        );
        const requestedByVariant = new Map(
          requested.map((item) => [item.variantId, item.quantity]),
        );
        for (const variantId of itemIds) {
          const oldQuantity = oldByVariant.get(variantId)?.quantity ?? 0;
          const newQuantity = requestedByVariant.get(variantId) ?? 0;
          const delta = newQuantity - oldQuantity;
          if (!delta || order.status === "CANCELADO") continue;
          const level = stock.get(variantId);
          if (!level)
            throw new AppError(
              409,
              "MISSING_INVENTORY",
              "Estoque de uma variação não foi configurado.",
            );
          const inventoryNext =
            order.status === "NOVO"
              ? { onHand: level.onHand, reserved: level.reserved + delta }
              : { onHand: level.onHand - delta, reserved: level.reserved };
          const movementType =
            delta > 0
              ? order.status === "NOVO"
                ? "ORDER_RESERVE"
                : "ORDER_CONSUME"
              : order.status === "NOVO"
                ? "ORDER_RELEASE"
                : "ORDER_RESTORE";
          const movementDelta =
            order.status === "NOVO"
              ? { onHand: 0, reserved: delta }
              : { onHand: -delta, reserved: 0 };
          await writeInventory(
            tx,
            variantId,
            inventoryNext,
            movementDelta,
            movementType,
            order.id,
            actor.id,
            "Ajuste de itens do pedido",
          );
          stock.set(variantId, inventoryNext);
        }
        const snapshots = requested.map((item) =>
          snapshotItem(
            variants.get(item.variantId),
            item.quantity,
            oldByVariant.get(item.variantId),
          ),
        );
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.orderItem.createMany({
          data: snapshots.map((item) => ({ ...item, orderId: order.id })),
        });
        effectiveItems = snapshots;
      }

      const targetStatus = input.status ?? order.status;
      await moveForStatus(
        tx,
        order.status,
        targetStatus,
        effectiveItems,
        stock,
        order.id,
        actor.id,
      );
      const subtotalCents = effectiveItems.reduce(
        (sum, item) => sum + item.lineTotalCentsSnapshot,
        0,
      );
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: targetStatus,
          paidAmountCents: input.paidAmountCents ?? order.paidAmountCents,
          note: input.note === undefined ? order.note : input.note,
          subtotalCents,
          totalCents: subtotalCents + (order.shippingAmountCents ?? 0),
        },
        include: { items: true },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        orderId: order.id,
        entityType: "ORDER",
        entityId: order.id,
        action: "UPDATED",
        beforeJson: before,
        afterJson: {
          status: updated.status,
          paidAmountCents: updated.paidAmountCents,
          itemCount: updated.items.length,
        },
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function archiveOrder(orderId, actor) {
  const existing = await prisma.order.findFirst({
    where: { id: orderId, archivedAt: null },
  });
  if (!existing) throw notFound("Pedido não encontrado.");
  if (existing.status === "NOVO" || existing.status === "CONFIRMADO")
    await updateOrder(orderId, { status: "CANCELADO" }, actor);
  return prisma.$transaction(async (tx) => {
    const archived = await tx.order.update({
      where: { id: orderId },
      data: { archivedAt: new Date(), archivedById: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      orderId,
      entityType: "ORDER",
      entityId: orderId,
      action: "ARCHIVED",
    });
    return archived;
  });
}
