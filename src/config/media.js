export const IMAGE_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='800'%3E%3Crect width='100%25' height='100%25' fill='%23eee8e3'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23665' font-size='24'%3EImagem indispon%C3%ADvel%3C/text%3E%3C/svg%3E";

const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const PUBLIC_RENDER_PATH = "/storage/v1/render/image/public/";
const positiveInteger = value => Number.isFinite(value) && value > 0 ? Math.round(value) : null;

// Keep the source pixels and aspect ratio. CSS remains responsible for the
// final crop and its existing object-position, so server transforms do not
// change how a garment is framed.
export function getImageVariant(src, {
  width,
  sourceWidth,
  sourceHeight,
  quality = 75,
} = {}) {
  const targetWidth = positiveInteger(width);
  const originalWidth = positiveInteger(sourceWidth);
  const originalHeight = positiveInteger(sourceHeight);
  if (!targetWidth || !originalWidth || !originalHeight) return src;

  try {
    const url = new URL(src);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !url.pathname.startsWith(PUBLIC_OBJECT_PATH)) return src;
    url.pathname = PUBLIC_RENDER_PATH + url.pathname.slice(PUBLIC_OBJECT_PATH.length);
    url.searchParams.set("width", String(Math.min(targetWidth, originalWidth)));
    url.searchParams.set("height", String(Math.max(1, Math.round(Math.min(targetWidth, originalWidth) * originalHeight / originalWidth))));
    url.searchParams.set("resize", "contain");
    url.searchParams.set("quality", String(Math.min(100, Math.max(20, Math.round(quality)))));
    return url.toString();
  } catch {
    return src;
  }
}

export function getImageSrcSet(src, {
  widths = [320, 480, 640, 800],
  sourceWidth,
  sourceHeight,
  quality = 75,
} = {}) {
  const originalWidth = positiveInteger(sourceWidth);
  const originalHeight = positiveInteger(sourceHeight);
  if (!originalWidth || !originalHeight) return "";

  const candidates = [...new Set([
    ...widths.map(positiveInteger).filter(width => width && width <= originalWidth),
    originalWidth,
  ])].sort((a, b) => a - b);

  const variants = candidates.map(width => ({
    width,
    url: getImageVariant(src, {
      width,
      sourceWidth: originalWidth,
      sourceHeight: originalHeight,
      quality,
    }),
  }));
  if (variants.some(variant => variant.url === src)) return "";
  return variants.map(({ width, url }) => `${url} ${width}w`).join(", ");
}
