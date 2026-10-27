import argon2 from "argon2";
import { prisma } from "../db/prisma.js";
import { lockInventories } from "../db/inventory.js";
import { serializableTransaction } from "../db/transaction.js";
import { AppError, notFound } from "../lib/errors.js";
import { normalizeEmail } from "../lib/security.js";
import { writeAudit } from "../services/audit.service.js";

export const catalogMetadata = async (_req, res) => {
  const [categories, options, sizes] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.variantOption.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.size.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  res.json({ categories, options, sizes });
};

export const createCategory = async (req, res) => {
  const category = await prisma.$transaction(async (tx) => {
    const created = await tx.category.create({ data: req.body });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "CATEGORY",
      entityId: created.id,
      action: "CREATED",
      afterJson: { name: created.name },
    });
    return created;
  });
  res.status(201).json({ category });
};

export const updateCategory = async (req, res) => {
  const category = await prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "CATEGORY",
      entityId: updated.id,
      action: "UPDATED",
      afterJson: req.body,
    });
    return updated;
  });
  res.json({ category });
};

export const createVariantOption = async (req, res) => {
  const option = await prisma.$transaction(async (tx) => {
    const created = await tx.variantOption.create({ data: req.body });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "VARIANT_OPTION",
      entityId: created.id,
      action: "CREATED",
      afterJson: { name: created.name, type: created.type },
    });
    return created;
  });
  res.status(201).json({ option });
};

export const updateVariantOption = async (req, res) => {
  const option = await prisma.$transaction(async (tx) => {
    const updated = await tx.variantOption.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "VARIANT_OPTION",
      entityId: updated.id,
      action: "UPDATED",
      afterJson: req.body,
    });
    return updated;
  });
  res.json({ option });
};

export const listInventory = async (_req, res) => {
  const variants = await prisma.productVariant.findMany({
    include: {
      size: true,
      inventory: true,
      productOption: {
        include: {
          variantOption: true,
          product: { include: { category: true } },
        },
      },
    },
    orderBy: { sku: "asc" },
  });
  res.json({
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      active: variant.active,
      size: variant.size.code,
      option: variant.productOption.variantOption.name,
      product: variant.productOption.product.name,
      category: variant.productOption.product.category.name,
      onHand: variant.inventory?.onHand ?? 0,
      reserved: variant.inventory?.reserved ?? 0,
      available:
        (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0),
    })),
  });
};

export const adjustInventory = async (req, res) => {
  const { variantId } = req.params;
  const { delta, reason } = req.body;
  const level = await serializableTransaction(prisma, async (tx) => {
    const current = (await lockInventories(tx, [variantId])).get(variantId);
    if (!current) throw notFound("Variação de estoque não encontrada.");
    const onHand = current.onHand + delta;
    if (onHand < current.reserved)
      throw new AppError(
        409,
        "RESERVED_STOCK",
        "O ajuste deixaria menos estoque físico do que peças já reservadas.",
      );
    const updated = await tx.inventoryLevel.update({
      where: { variantId },
      data: { onHand },
    });
    await tx.inventoryMovement.create({
      data: {
        variantId,
        actorId: req.user.id,
        type: "ADJUSTMENT",
        onHandDelta: delta,
        reason,
      },
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "INVENTORY",
      entityId: variantId,
      action: "ADJUSTED",
      afterJson: { delta, reason, onHand, reserved: updated.reserved },
    });
    return updated;
  });
  res.json({
    inventory: { ...level, available: level.onHand - level.reserved },
  });
};

export const createStaff = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const passwordHash = await argon2.hash(req.body.password, {
    type: argon2.argon2id,
  });
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: req.body.name, email, passwordHash, role: "STAFF" },
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "USER",
      entityId: created.id,
      action: "STAFF_CREATED",
      afterJson: { email: created.email, role: created.role },
    });
    return created;
  });
  res
    .status(201)
    .json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
};

export const listStaff = async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "ADMIN"] } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
};

export const listAdminBanners = async (_req, res) =>
  res.json({
    banners: await prisma.siteBanner.findMany({
      include: { asset: true },
      orderBy: { sortOrder: "asc" },
    }),
  });
export const createBanner = async (req, res) => {
  const banner = await prisma.$transaction(async (tx) => {
    const created = await tx.siteBanner.create({
      data: req.body,
      include: { asset: true },
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "SITE_BANNER",
      entityId: created.id,
      action: "CREATED",
      afterJson: { title: created.title, assetId: created.assetId },
    });
    return created;
  });
  res.status(201).json({ banner });
};
export const updateBanner = async (req, res) => {
  const banner = await prisma.$transaction(async (tx) => {
    const before = await tx.siteBanner.findUnique({
      where: { id: req.params.id },
    });
    if (!before) throw notFound("Banner não encontrado.");
    const updated = await tx.siteBanner.update({
      where: { id: before.id },
      data: req.body,
      include: { asset: true },
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "SITE_BANNER",
      entityId: updated.id,
      action: "UPDATED",
      beforeJson: { title: before.title, active: before.active },
      afterJson: req.body,
    });
    return updated;
  });
  res.json({ banner });
};
