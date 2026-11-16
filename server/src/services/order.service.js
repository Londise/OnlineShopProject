import { prisma } from "../db/prisma.js";
import { lockInventories } from "../db/inventory.js";
import { serializableTransaction } from "../db/transaction.js";
import { MAX_ORDER_QUANTITY, MIN_ORDER_QUANTITY } from "../config/business.js";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { logInfo } from "../lib/logger.js";
import { hashSessionToken, publicOrderNumber } from "../lib/security.js";
import { volumeLabel } from "./shipping.service.js";
import { defaultShippingQuoter } from "./melhor-envio.service.js";
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

const MAX_INT = 2147483647;

function orderInt(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INT)
    throw new AppError(422, "ORDER_AMOUNT_OVERFLOW", "Quantidade, peso ou valor do pedido excede o limite permitido.");
  return value;
}

const aggregateItems = (items) =>
  [
    ...items.reduce((map, item) => {
      map.set(item.variantId, orderInt((map.get(item.variantId) || 0) + orderInt(item.quantity)));
      return map;
    }, new Map()),
  ].map(([variantId, quantity]) => ({ variantId, quantity }));

async function loadActiveVariants(tx, items) {
  const variantIds = items.map((item) => item.variantId);
  const variants = await tx.productVariant.findMany({
    where: {
      id: { in: variantIds },
      active: true,
      productOption: {
        active: true,
        variantOption: { active: true },
        product: { active: true, category: { active: true } },
      },
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
    unitPriceCentsSnapshot: orderInt(unitPriceCents),
    unitWeightGramsSnapshot: orderInt(unitWeightGrams),
    quantity,
    lineTotalCentsSnapshot: orderInt(unitPriceCents * quantity),
  };
}

function orderTotals(items, shippingAmountCents = 0) {
  const subtotalCents = items.reduce(
    (sum, item) => orderInt(sum + orderInt(item.lineTotalCentsSnapshot)), 0,
  );
  const totalWeightGrams = items.reduce(
    (sum, item) => orderInt(sum + orderInt(item.unitWeightGramsSnapshot * item.quantity)), 0,
  );
  const totalCents = orderInt(subtotalCents + orderInt(shippingAmountCents ?? 0));
  return { subtotalCents, totalWeightGrams, totalCents };
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
  if (!((currentStatus === "NOVO" && nextStatus === "CONFIRMADO")
    || (currentStatus === "CONFIRMADO" && nextStatus === "CANCELADO"))) return;
  for (const item of items) {
    const level = stock.get(item.productVariantId);
    if (!level) throw new AppError(409, "MISSING_INVENTORY", "Estoque de uma variação não foi configurado.");
    let next = { ...level };
    let delta = { onHand: 0, reserved: 0 };
    let type;
    if (currentStatus === "NOVO" && nextStatus === "CONFIRMADO") {
      next = {
        onHand: level.onHand - item.quantity,
        reserved: level.reserved,
      };
      delta = { onHand: -item.quantity, reserved: 0 };
      type = "ORDER_CONSUME";
    }
    if (currentStatus === "CONFIRMADO" && nextStatus === "CANCELADO") {
      next.onHand += item.quantity;
      delta.onHand = item.quantity;
      type = "ORDER_RESTORE";
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

function assertPieceRange(items) {
  const pieces = items.reduce((total, item) => total + item.quantity, 0);
  if (pieces < MIN_ORDER_QUANTITY)
    throw new AppError(422, "MINIMUM_ORDER", `O pedido mínimo é de ${MIN_ORDER_QUANTITY} peças.`);
  if (pieces > MAX_ORDER_QUANTITY)
    throw new AppError(422, "MAXIMUM_ORDER", `O pedido máximo é de ${MAX_ORDER_QUANTITY} peças.`);
  return pieces;
}

/**
 * O valor apresentado no checkout é uma ESTIMATIVA: o servidor consulta
 * novamente o Melhor Envio e usa o preço recalculado, nunca o preço do
 * navegador. A consulta externa acontece antes da transação de estoque.
 */
async function resolveShippingQuote(delivery, pieces, quoteShipping) {
  if (delivery.method === "EXCURSAO")
    return { amountCents: null, detail: "Valor da excursão confirmado após o pedido." };
  const quoter = quoteShipping ?? defaultShippingQuoter;
  const { options } = await quoter({
    postalCode: delivery.postalCode.replace(/\D/g, ""),
    pieces,
  });
  const match = options.find(
    (option) =>
      option.company === delivery.shippingQuote?.company &&
      option.service === delivery.shippingQuote?.service &&
      option.volumes === delivery.shippingQuote?.volumes,
  );
  if (!match)
    throw new AppError(
      422,
      "SHIPPING_QUOTE_CHANGED",
      "O frete mudou desde o cálculo. Recalcule a estimativa antes de enviar o pedido.",
    );
  return {
    amountCents: orderInt(Math.round(match.price * 100)),
    detail: `Frete estimado: ${match.company} ${match.service} · ${volumeLabel(match.volumes)}`,
  };
}

function replaySubmission(submission, requestHash) {
  if (submission.requestHash !== requestHash)
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Este envio já foi usado com outro pedido. Inicie um novo envio.");
  return submission.responseJson;
}

export async function createOrder(input, user, { quoteShipping, idempotencyKey } = {}) {
  const keyHash = idempotencyKey ? hashSessionToken(`${user?.id ?? "guest"}:${idempotencyKey}`) : null;
  const requestHash = hashSessionToken(JSON.stringify(input));
  if (keyHash) {
    const existing = await prisma.orderSubmission.findUnique({ where: { keyHash } });
    if (existing) return replaySubmission(existing, requestHash);
  }
  const items = aggregateItems(input.items);
  const pieces = assertPieceRange(items);
  // Consulta externa fora da transação: falhas de frete nunca seguram estoque.
  const quote = await resolveShippingQuote(input.delivery, pieces, quoteShipping);
  let result;
  try {
  result = await serializableTransaction(
    prisma,
    async (tx) => {
      if (keyHash) {
        const existing = await tx.orderSubmission.findUnique({ where: { keyHash } });
        if (existing) return { order: replaySubmission(existing, requestHash), replayed: true };
      }
      const variants = await loadActiveVariants(tx, items);
      const snapshots = items.map((item) =>
        snapshotItem(variants.get(item.variantId), item.quantity),
      );
      const { subtotalCents } = orderTotals(snapshots);
      const { totalCents } = orderTotals(snapshots, quote.amountCents);
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
          totalCents,
          note: input.note ?? null,
          items: { create: snapshots },
        },
        include: { items: true },
      });
      await writeAudit(tx, {
        actorId: user?.id,
        orderId: order.id,
        entityType: "ORDER",
        entityId: order.id,
        action: "CREATED",
        afterJson: { status: "NOVO", publicNumber: order.publicNumber },
      });
      if (keyHash) await tx.orderSubmission.create({ data: {
        keyHash, requestHash, responseJson: JSON.parse(JSON.stringify(order)),
      } });
      return { order, replayed: false };
    },
  );
  } catch (error) {
    // Concurrent inserts of the same key may surface as a unique conflict.
    // Never retry a different checkout or treat unrelated DB failures as success.
    if (!keyHash || error.code !== "P2002") throw error;
    const existing = await prisma.orderSubmission.findUnique({ where: { keyHash } });
    if (!existing) throw error;
    return replaySubmission(existing, requestHash);
  }
  const { order, replayed } = result;
  if (replayed) return order;
  // Telemetria nunca pode quebrar o fluxo do pedido: acessos são defensivos.
  logInfo("order.created", `Pedido ${order?.publicNumber ?? order?.id ?? "novo"} criado`, {
    actorId: user?.id ?? null,
    data: {
      orderId: order?.id ?? null,
      publicNumber: order?.publicNumber ?? null,
      totalCents: order?.totalCents ?? null,
      items: order?.items?.length ?? null,
      deliveryMethod: order?.deliveryMethod ?? null,
    },
  });
  return order;
}

async function updateOrderInTransaction(tx, orderId, input, actor) {
  const order = await tx.order.findFirst({
    where: { id: orderId, archivedAt: null },
    include: { items: true },
  });
  if (!order) throw notFound("Pedido não encontrado.");
  if (input.status === "CONFIRMADO" && order.status !== "CONFIRMADO" && actor.role !== "ADMIN")
    throw forbidden("Somente administradores podem confirmar o acordo comercial.");
  const before = {
    status: order.status,
    paidAmountCents: order.paidAmountCents,
    itemCount: order.items.length,
  };
  let effectiveItems = order.items;
  const itemIds = new Set(order.items.map((item) => item.productVariantId));
  const requested = input.items ? aggregateItems(input.items) : null;
  if (requested) assertPieceRange(requested);
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
    const snapshots = requested.map((item) =>
      snapshotItem(
        variants.get(item.variantId), item.quantity, oldByVariant.get(item.variantId),
      ),
    );
    // Validate every persisted amount before inventory, item or audit writes.
    orderTotals(snapshots, order.shippingAmountCents);
    orderInt(input.paidAmountCents ?? order.paidAmountCents);
    for (const variantId of itemIds) {
      const oldQuantity = oldByVariant.get(variantId)?.quantity ?? 0;
      const newQuantity = requestedByVariant.get(variantId) ?? 0;
      const delta = newQuantity - oldQuantity;
      if (!delta || order.status !== "CONFIRMADO") continue;
      const level = stock.get(variantId);
      if (!level)
        throw new AppError(
          409,
          "MISSING_INVENTORY",
          "Estoque de uma variação não foi configurado.",
        );
      const inventoryNext = { onHand: level.onHand - delta, reserved: level.reserved };
      const movementType = delta > 0 ? "ORDER_CONSUME" : "ORDER_RESTORE";
      const movementDelta = { onHand: -delta, reserved: 0 };
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
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    await tx.orderItem.createMany({
      data: snapshots.map((item) => ({ ...item, orderId: order.id })),
    });
    effectiveItems = snapshots;
  }

  const targetStatus = input.status ?? order.status;
  if (order.status === "NOVO" && targetStatus === "CONFIRMADO") {
    await loadActiveVariants(tx, effectiveItems.map(item => ({ variantId: item.productVariantId })));
  }
  const { subtotalCents, totalCents } = orderTotals(effectiveItems, order.shippingAmountCents);
  const paidAmountCents = orderInt(input.paidAmountCents ?? order.paidAmountCents);
  await moveForStatus(
    tx,
    order.status,
    targetStatus,
    effectiveItems,
    stock,
    order.id,
    actor.id,
  );
  const updated = await tx.order.update({
    where: { id: order.id },
    data: {
      status: targetStatus,
      paidAmountCents,
      note: input.note === undefined ? order.note : input.note,
      subtotalCents,
      totalCents,
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
  return { updated, statusChange: { from: before.status, to: updated.status } };
}

export async function updateOrder(orderId, input, actor) {
  const { updated: updatedOrder, statusChange } = await serializableTransaction(
    prisma,
    (tx) => updateOrderInTransaction(tx, orderId, input, actor),
  );
  if (statusChange && statusChange.from !== statusChange.to)
    logInfo("order.status_changed", `Pedido ${updatedOrder?.publicNumber ?? updatedOrder?.id}: ${statusChange.from} → ${statusChange.to}`, {
      actorId: actor.id,
      data: { orderId: updatedOrder?.id ?? orderId, ...statusChange },
    });
  return updatedOrder;
}

export async function archiveOrder(orderId, actor) {
  const { archived, statusChange } = await serializableTransaction(prisma, async (tx) => {
    const existing = await tx.order.findFirst({
      where: { id: orderId, archivedAt: null },
    });
    if (!existing) throw notFound("Pedido não encontrado.");
    let statusChange = null;
    if (existing.status === "NOVO" || existing.status === "CONFIRMADO")
      ({ statusChange } = await updateOrderInTransaction(tx, orderId, { status: "CANCELADO" }, actor));
    const archivedOrder = await tx.order.update({
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
    return { archived: archivedOrder, statusChange };
  });
  if (statusChange)
    logInfo("order.status_changed", `Pedido ${archived?.publicNumber ?? orderId}: ${statusChange.from} → ${statusChange.to}`, {
      actorId: actor.id,
      data: { orderId: archived?.id ?? orderId, ...statusChange },
    });
  logInfo("order.archived", `Pedido ${archived?.publicNumber ?? orderId} arquivado`, {
    actorId: actor.id,
    data: { orderId: archived?.id ?? orderId, publicNumber: archived?.publicNumber ?? null },
  });
  return archived;
}
