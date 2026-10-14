import { randomUUID } from "node:crypto";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError, notFound } from "../lib/errors.js";
import { inspectImage, MAX_IMAGE_BYTES } from "../lib/images.js";
import { putImage, removeNewImage, STORAGE_BUCKET } from "../services/storage.service.js";
import { writeAudit } from "../services/audit.service.js";

const formSchema = z.object({
  purpose: z.enum(["product", "category", "banner", "favicon", "library"]),
  targetId: z.string().cuid().optional(),
  optionId: z.string().cuid().optional(),
  primary: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  altText: z.string().trim().max(255).default(""),
}).strict().superRefine((value, ctx) => {
  if (["product", "category"].includes(value.purpose) && !value.targetId) {
    ctx.addIssue({ code: "custom", message: "Selecione o produto ou categoria." });
  }
  if (value.optionId && value.purpose !== "product") ctx.addIssue({ code: "custom", message: "Opção inválida." });
});

const multipart = multer({ storage: multer.memoryStorage(), limits: {
  fileSize: MAX_IMAGE_BYTES, files: 1, fields: 6, parts: 7, fieldSize: 1024,
} }).single("file");
export const uploadLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
export function receiveImage(req, res, next) {
  multipart(req, res, error => {
    if (error) return next(new AppError(error.code === "LIMIT_FILE_SIZE" ? 413 : 422,
      "IMAGE_UPLOAD", "Envie um único arquivo de até 5 MB e os campos esperados."));
    next();
  });
}

export const listMedia = asyncHandler(async (_req, res) => {
  const assets = await prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" }, take: 200,
    include: { productImages: { include: { product: { select: { name: true } } }, orderBy: { sortOrder: "asc" } } } });
  res.json({ assets });
});

export const uploadImage = asyncHandler(async (req, res) => {
  const parsed = formSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(422, "INVALID_UPLOAD", "Verifique os dados do upload.", parsed.error.flatten());
  const input = parsed.data;
  if (!req.file) throw new AppError(422, "MISSING_IMAGE", "Selecione uma imagem.");
  const delegates = { product: prisma.product, category: prisma.category, banner: prisma.siteBanner };
  if (input.targetId && (!delegates[input.purpose] || !await delegates[input.purpose].findUnique({ where: { id: input.targetId } }))) {
    throw notFound("Destino da imagem não encontrado.");
  }
  if (input.optionId && !await prisma.productOption.findFirst({ where: { id: input.optionId, productId: input.targetId } })) {
    throw notFound("Opção deste produto não encontrada.");
  }
  const info = await inspectImage(req.file.buffer);
  const path = `${input.purpose}/${input.targetId ?? "site"}/${randomUUID()}.${info.extension}`;
  const url = await putImage(path, req.file.buffer, info.mimeType);
  let asset;
  try {
    asset = await prisma.$transaction(async tx => {
      const created = await tx.mediaAsset.create({ data: { url, storageBucket: STORAGE_BUCKET, storagePath: path,
        purpose: input.purpose, altText: input.altText, width: info.width, height: info.height,
        mimeType: info.mimeType, byteSize: info.byteSize, checksumSha256: info.checksumSha256 } });
      if (input.purpose === "product") {
        if (input.primary) await tx.productImage.updateMany({ where: { productId: input.targetId, type: "PRIMARY" }, data: { type: "SECONDARY" } });
        await tx.productImage.create({ data: { productId: input.targetId, productOptionId: input.optionId,
          assetId: created.id, type: input.primary ? "PRIMARY" : "SECONDARY", sortOrder: input.sortOrder } });
      } else if (input.purpose === "category") {
        await tx.category.update({ where: { id: input.targetId }, data: { imageAssetId: created.id } });
      } else if (input.purpose === "banner") {
        if (input.targetId) await tx.siteBanner.update({ where: { id: input.targetId }, data: { assetId: created.id } });
        else await tx.siteBanner.create({ data: { assetId: created.id, title: input.altText || "Ferchu Modas", sortOrder: input.sortOrder } });
      }
      await writeAudit(tx, { actorId: req.user.id, entityType: "MEDIA_ASSET", entityId: created.id,
        action: "UPLOADED", afterJson: { purpose: input.purpose, storagePath: path } });
      return created;
    });
  } catch (error) {
    // A lost commit response is ambiguous. Never delete a possibly committed asset.
    try {
      const exists = await prisma.mediaAsset.findUnique({ where: { storageBucket_storagePath: { storageBucket: STORAGE_BUCKET, storagePath: path } } });
      if (!exists) await removeNewImage(path);
    } catch { console.error("Media cleanup needs attention:", path); }
    throw error;
  }
  res.status(201).json({ asset });
});

export const updateImage = asyncHandler(async (req, res) => {
  const patch = z.object({ primary: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional() }).strict().safeParse(req.body);
  if (!patch.success || !Object.keys(patch.data).length) throw new AppError(422, "INVALID_IMAGE_PATCH", "Informe capa ou ordem.");
  const image = await prisma.$transaction(async tx => {
    const current = await tx.productImage.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound("Imagem não encontrada.");
    if (patch.data.primary) await tx.productImage.updateMany({ where: { productId: current.productId, type: "PRIMARY" }, data: { type: "SECONDARY" } });
    const updated = await tx.productImage.update({ where: { id: current.id }, data: {
      sortOrder: patch.data.sortOrder, ...(patch.data.primary === undefined ? {} : { type: patch.data.primary ? "PRIMARY" : "SECONDARY" }),
    } });
    await writeAudit(tx, { actorId: req.user.id, entityType: "PRODUCT_IMAGE", entityId: current.id, action: "UPDATED", afterJson: patch.data });
    return updated;
  });
  res.json({ image });
});

export const siteMedia = asyncHandler(async (_req, res) => {
  const favicon = await prisma.mediaAsset.findFirst({ where: { purpose: "favicon" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  res.json({ faviconUrl: favicon?.url ?? null });
});
