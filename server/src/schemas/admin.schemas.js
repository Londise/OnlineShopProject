import { z } from 'zod';

export const inventoryAdjustmentSchema = z.object({ delta: z.coerce.number().int().min(-100_000).max(100_000).refine((value) => value !== 0), reason: z.string().trim().min(3).max(255) });
export const createStaffSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(191), password: z.string().min(10).max(128) });
export const bannerSchema = z.object({ assetId: z.string().cuid(), title: z.string().trim().max(160).nullable().optional(), subtitle: z.string().trim().max(255).nullable().optional(), linkUrl: z.string().url().max(2048).nullable().optional(), sortOrder: z.coerce.number().int().min(0).max(999).default(0), active: z.boolean().default(true), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional() });
export const productSchema = z.object({ categoryId: z.string().cuid(), name: z.string().trim().min(2).max(160), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180), description: z.string().trim().max(10_000).nullable().optional(), material: z.string().trim().min(2).max(100), priceCents: z.coerce.number().int().min(0).max(10_000_000), weightGrams: z.coerce.number().int().min(1).max(100_000), active: z.boolean().optional() });
export const productPatchSchema = productSchema.partial();
export const MAX_PRODUCT_VARIANTS = 80;
export const productOptionSchema = z.object({ variantOptionId: z.string().cuid(), imageAssetId: z.string().cuid().nullable().optional(), sortOrder: z.coerce.number().int().min(0).max(999).default(0), variants: z.array(z.object({ sizeId: z.string().cuid(), sku: z.string().trim().min(2).max(100), priceCents: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(), openingStock: z.coerce.number().int().min(0).max(100_000).default(0) })).min(1).max(MAX_PRODUCT_VARIANTS) });
export const productOptionPatchSchema = z.object({ imageAssetId: z.string().cuid().nullable().optional(), sortOrder: z.coerce.number().int().min(0).max(999).optional(), active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);
export const productVariantPatchSchema = z.object({ sku: z.string().trim().min(2).max(100).optional(), priceCents: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(), active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);
export const productImageSchema = z.object({ assetId: z.string().cuid(), productOptionId: z.string().cuid().nullable().optional(), type: z.enum(['PRIMARY', 'SECONDARY']).default('SECONDARY'), sortOrder: z.coerce.number().int().min(0).max(999).default(0) });
export const categorySchema = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), imageAssetId: z.string().cuid().nullable().optional(), sortOrder: z.coerce.number().int().min(0).max(999).default(0), active: z.boolean().default(true) });
export const variantOptionSchema = z.object({ type: z.enum(['COLOR', 'PRINT']), name: z.string().trim().min(2).max(100), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), swatchHex: z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(), active: z.boolean().default(true) });

// Zod 4 applies defaults even inside .partial(). Omitted PATCH fields must
// remain absent so an unrelated edit never resets ordering or reactivates data.
export const categoryPatchSchema = categorySchema.extend({
  sortOrder: categorySchema.shape.sortOrder.removeDefault(),
  active: categorySchema.shape.active.removeDefault(),
}).partial();
export const variantOptionPatchSchema = variantOptionSchema.extend({
  active: variantOptionSchema.shape.active.removeDefault(),
}).partial();
export const bannerPatchSchema = bannerSchema.extend({
  sortOrder: bannerSchema.shape.sortOrder.removeDefault(),
  active: bannerSchema.shape.active.removeDefault(),
}).partial();
