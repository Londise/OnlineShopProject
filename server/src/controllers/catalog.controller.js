import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, notFound } from '../lib/errors.js';
import { writeAudit } from '../services/audit.service.js';

const productInclude = {
  category: true,
  images: { include: { asset: true }, orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] },
  options: { where: { active: true }, include: { variantOption: true, imageAsset: true, variants: { where: { active: true }, include: { size: true, inventory: true }, orderBy: { size: { sortOrder: 'asc' } } } }, orderBy: { sortOrder: 'asc' } },
};

const adminProductInclude = {
  category: true,
  images: { include: { asset: true }, orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] },
  options: { include: { variantOption: true, imageAsset: true, variants: { include: { size: true, inventory: true }, orderBy: { size: { sortOrder: 'asc' } } } }, orderBy: { sortOrder: 'asc' } },
};

const presentProduct = (product, includeStock = false) => ({
  id: product.id, slug: product.slug, name: product.name, description: product.description, material: product.material, priceCents: product.priceCents, weightGrams: product.weightGrams, category: { id: product.category.id, name: product.category.name, slug: product.category.slug },
  images: product.images.map((image) => ({ id: image.id, type: image.type, url: image.asset.url, altText: image.asset.altText, sortOrder: image.sortOrder, productOptionId: image.productOptionId })),
  options: product.options.map((option) => ({ id: option.id, name: option.variantOption.name, type: option.variantOption.type, swatchHex: option.variantOption.swatchHex, imageUrl: option.imageAsset?.url ?? null, active: option.active, sortOrder: option.sortOrder, variants: option.variants.map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size.code, priceCents: variant.priceCents ?? product.priceCents, active: variant.active, ...(includeStock ? { onHand: variant.inventory?.onHand ?? 0, reserved: variant.inventory?.reserved ?? 0, available: (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0) } : {}) })) })),
});

export const listProducts = asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({ where: { active: true, category: { active: true } }, include: productInclude, orderBy: { name: 'asc' } });
  res.json({ products: products.map((product) => presentProduct(product)) });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({ where: { slug: req.params.slug, active: true }, include: productInclude });
  if (!product) throw notFound('Produto não encontrado.');
  res.json({ product: presentProduct(product) });
});

export const listAdminProducts = asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({ include: adminProductInclude, orderBy: { updatedAt: 'desc' } });
  res.json({ products: products.map((product) => presentProduct(product, true)) });
});

export const createProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.create({ data: req.body, include: productInclude });
  await prisma.$transaction((tx) => writeAudit(tx, { actorId: req.user.id, entityType: 'PRODUCT', entityId: product.id, action: 'CREATED', afterJson: { name: product.name } }));
  res.status(201).json({ product: presentProduct(product, true) });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.update({ where: { id: req.params.id }, data: req.body, include: productInclude });
  await prisma.$transaction((tx) => writeAudit(tx, { actorId: req.user.id, entityType: 'PRODUCT', entityId: product.id, action: 'UPDATED', afterJson: { name: product.name } }));
  res.json({ product: presentProduct(product, true) });
});

export const addProductOption = asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw notFound('Produto não encontrado.');
  const option = await prisma.$transaction(async (tx) => {
    const created = await tx.productOption.create({ data: { productId: product.id, variantOptionId: req.body.variantOptionId, imageAssetId: req.body.imageAssetId, sortOrder: req.body.sortOrder } });
    for (const variant of req.body.variants) {
      const productVariant = await tx.productVariant.create({ data: { productOptionId: created.id, sizeId: variant.sizeId, sku: variant.sku, priceCents: variant.priceCents, inventory: { create: { onHand: variant.openingStock } } } });
      if (variant.openingStock) await tx.inventoryMovement.create({ data: { variantId: productVariant.id, actorId: req.user.id, type: 'INITIAL', onHandDelta: variant.openingStock, reason: 'Estoque inicial da variação' } });
    }
    await writeAudit(tx, { actorId: req.user.id, entityType: 'PRODUCT_OPTION', entityId: created.id, action: 'CREATED', afterJson: { productId: product.id } });
    return created;
  });
  res.status(201).json({ option });
});

export const updateProductOption = asyncHandler(async (req, res) => {
  const option = await prisma.productOption.findFirst({ where: { id: req.params.optionId, productId: req.params.id } });
  if (!option) throw notFound('OpÃ§Ã£o do produto nÃ£o encontrada.');
  const updated = await prisma.productOption.update({ where: { id: option.id }, data: req.body });
  await prisma.$transaction((tx) => writeAudit(tx, { actorId: req.user.id, entityType: 'PRODUCT_OPTION', entityId: updated.id, action: 'UPDATED', afterJson: req.body }));
  res.json({ option: updated });
});

export const updateProductVariant = asyncHandler(async (req, res) => {
  const variant = await prisma.productVariant.findUnique({ where: { id: req.params.variantId }, include: { productOption: true } });
  if (!variant || variant.productOption.productId !== req.params.id) throw notFound('VariaÃ§Ã£o do produto nÃ£o encontrada.');
  const updated = await prisma.productVariant.update({ where: { id: variant.id }, data: req.body });
  await prisma.$transaction((tx) => writeAudit(tx, { actorId: req.user.id, entityType: 'PRODUCT_VARIANT', entityId: updated.id, action: 'UPDATED', afterJson: req.body }));
  res.json({ variant: updated });
});

export const addProductImage = asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw notFound('Produto nÃ£o encontrado.');
  if (req.body.productOptionId) {
    const option = await prisma.productOption.findFirst({ where: { id: req.body.productOptionId, productId: product.id } });
    if (!option) throw new AppError(422, 'INVALID_PRODUCT_OPTION', 'A imagem deve pertencer a uma opÃ§Ã£o deste produto.');
  }
  const image = await prisma.productImage.create({ data: { productId: product.id, ...req.body }, include: { asset: true } });
  await prisma.$transaction((tx) => writeAudit(tx, { actorId: req.user.id, entityType: 'PRODUCT_IMAGE', entityId: image.id, action: 'CREATED', afterJson: { productId: product.id, assetId: image.assetId } }));
  res.status(201).json({ image });
});
