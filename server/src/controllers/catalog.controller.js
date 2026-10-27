import { prisma } from "../db/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { writeAudit } from "../services/audit.service.js";

const productInclude = {
  category: { include: { imageAsset: true } },
  images: {
    include: { asset: true },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  },
  options: {
    where: { active: true, variantOption: { active: true } },
    include: {
      variantOption: true,
      imageAsset: true,
      variants: {
        where: { active: true, size: { active: true } },
        include: { size: true, inventory: true },
        orderBy: { size: { sortOrder: "asc" } },
      },
    },
    orderBy: { sortOrder: "asc" },
  },
};

const adminProductInclude = {
  category: { include: { imageAsset: true } },
  images: {
    include: { asset: true },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  },
  options: {
    include: {
      variantOption: true,
      imageAsset: true,
      variants: {
        include: { size: true, inventory: true },
        orderBy: { size: { sortOrder: "asc" } },
      },
    },
    orderBy: { sortOrder: "asc" },
  },
};

const presentProduct = (product) => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  active: product.active,
  description: product.description,
  material: product.material,
  priceCents: product.priceCents,
  weightGrams: product.weightGrams,
  category: {
    id: product.category.id,
    name: product.category.name,
    slug: product.category.slug,
    imageUrl: product.category.imageAsset?.url ?? null,
  },
  images: product.images.map((image) => ({
    id: image.id,
    type: image.type,
    url: image.asset.url,
    altText: image.asset.altText,
    sortOrder: image.sortOrder,
    productOptionId: image.productOptionId,
  })),
  options: product.options.map((option) => ({
    id: option.id,
    name: option.variantOption.name,
    type: option.variantOption.type,
    swatchHex: option.variantOption.swatchHex,
    imageUrl: option.imageAsset?.url ?? null,
    active: option.active,
    sortOrder: option.sortOrder,
    variants: option.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      size: variant.size.code,
      priceCents: variant.priceCents ?? product.priceCents,
      active: variant.active,
      available:
        (variant.inventory?.onHand ?? 0) -
        (variant.inventory?.reserved ?? 0),
    })),
  })),
});

export const listProducts = async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { active: true, category: { active: true } },
    include: productInclude,
    orderBy: { name: "asc" },
  });
  res.json({ products: products.map((product) => presentProduct(product)) });
};

export const getProduct = async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { slug: req.params.slug, active: true, category: { active: true } },
    include: productInclude,
  });
  if (!product) throw notFound("Produto não encontrado.");
  res.json({ product: presentProduct(product) });
};

export const listAdminProducts = async (_req, res) => {
  const products = await prisma.product.findMany({
    include: adminProductInclude,
    orderBy: { updatedAt: "desc" },
  });
  res.json({
    products: products.map((product) => presentProduct(product)),
  });
};

export const createProduct = async (req, res) => {
  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: req.body,
      include: productInclude,
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "PRODUCT",
      entityId: created.id,
      action: "CREATED",
      afterJson: { name: created.name },
    });
    return created;
  });
  res.status(201).json({ product: presentProduct(product) });
};

export const updateProduct = async (req, res) => {
  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: req.params.id },
      data: req.body,
      include: productInclude,
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "PRODUCT",
      entityId: updated.id,
      action: "UPDATED",
      afterJson: { name: updated.name },
    });
    return updated;
  });
  res.json({ product: presentProduct(product) });
};

export const addProductOption = async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
  });
  if (!product) throw notFound("Produto não encontrado.");
  const option = await prisma.$transaction(async (tx) => {
    const created = await tx.productOption.create({
      data: {
        productId: product.id,
        variantOptionId: req.body.variantOptionId,
        imageAssetId: req.body.imageAssetId,
        sortOrder: req.body.sortOrder,
      },
    });
    for (const variant of req.body.variants) {
      const productVariant = await tx.productVariant.create({
        data: {
          productOptionId: created.id,
          sizeId: variant.sizeId,
          sku: variant.sku,
          priceCents: variant.priceCents,
          inventory: { create: { onHand: variant.openingStock } },
        },
      });
      if (variant.openingStock)
        await tx.inventoryMovement.create({
          data: {
            variantId: productVariant.id,
            actorId: req.user.id,
            type: "INITIAL",
            onHandDelta: variant.openingStock,
            reason: "Estoque inicial da variação",
          },
        });
    }
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "PRODUCT_OPTION",
      entityId: created.id,
      action: "CREATED",
      afterJson: { productId: product.id },
    });
    return created;
  });
  res.status(201).json({ option });
};

export const updateProductOption = async (req, res) => {
  const updated = await prisma.$transaction(async (tx) => {
    const option = await tx.productOption.findFirst({
      where: { id: req.params.optionId, productId: req.params.id },
    });
    if (!option) throw notFound("Opção do produto não encontrada.");
    const result = await tx.productOption.update({
      where: { id: option.id },
      data: req.body,
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "PRODUCT_OPTION",
      entityId: result.id,
      action: "UPDATED",
      afterJson: req.body,
    });
    return result;
  });
  res.json({ option: updated });
};

export const updateProductVariant = async (req, res) => {
  const updated = await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: req.params.variantId },
      include: { productOption: true },
    });
    if (!variant || variant.productOption.productId !== req.params.id)
      throw notFound("Variação do produto não encontrada.");
    const result = await tx.productVariant.update({
      where: { id: variant.id },
      data: req.body,
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "PRODUCT_VARIANT",
      entityId: result.id,
      action: "UPDATED",
      afterJson: req.body,
    });
    return result;
  });
  res.json({ variant: updated });
};

export const addProductImage = async (req, res) => {
  const image = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: req.params.id },
    });
    if (!product) throw notFound("Produto não encontrado.");
    if (req.body.productOptionId) {
      const option = await tx.productOption.findFirst({
        where: { id: req.body.productOptionId, productId: product.id },
      });
      if (!option)
        throw new AppError(
          422,
          "INVALID_PRODUCT_OPTION",
          "A imagem deve pertencer a uma opção deste produto.",
        );
    }
    const created = await tx.productImage.create({
      data: { productId: product.id, ...req.body },
      include: { asset: true },
    });
    await writeAudit(tx, {
      actorId: req.user.id,
      entityType: "PRODUCT_IMAGE",
      entityId: created.id,
      action: "CREATED",
      afterJson: { productId: product.id, assetId: created.assetId },
    });
    return created;
  });
  res.status(201).json({ image });
};
