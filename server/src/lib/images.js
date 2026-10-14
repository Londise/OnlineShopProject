import sharp from "sharp";
import { createHash } from "node:crypto";
import { AppError } from "./errors.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function inspectImage(buffer) {
  if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new AppError(413, "IMAGE_SIZE", "Envie uma imagem de até 5 MB.");
  }
  try {
    const image = sharp(buffer, { limitInputPixels: 16_000_000, failOn: "error" });
    const meta = await image.metadata();
    if (!IMAGE_TYPES[meta.format] || (meta.pages ?? 1) > 1) throw new Error("Unsupported image");
    // Decode the complete file: MIME headers and an image extension are not proof.
    await image.raw().toBuffer();
    return { mimeType: IMAGE_TYPES[meta.format], extension: meta.format === "jpeg" ? "jpeg" : meta.format,
      width: meta.width, height: meta.height, byteSize: buffer.length,
      checksumSha256: createHash("sha256").update(buffer).digest("hex") };
  } catch {
    throw new AppError(422, "INVALID_IMAGE", "Use uma imagem JPEG, PNG ou WebP válida, não animada, de até 16 megapixels.");
  }
}
