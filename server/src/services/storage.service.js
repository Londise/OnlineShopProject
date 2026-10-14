import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export const STORAGE_BUCKET = "storefront-images";
let client;
export function storageClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new AppError(503, "STORAGE_UNAVAILABLE", "O Storage ainda não foi configurado no servidor.");
  }
  client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client.storage.from(STORAGE_BUCKET);
}
export async function putImage(path, buffer, mimeType) {
  const storage = storageClient();
  const { error } = await storage.upload(path, buffer, { contentType: mimeType, cacheControl: "31536000", upsert: false });
  if (error) throw new AppError(502, "STORAGE_UPLOAD", "Não foi possível enviar a imagem.");
  return storage.getPublicUrl(path).data.publicUrl;
}
export async function removeNewImage(path) {
  const { error } = await storageClient().remove([path]);
  if (error) throw new Error("Storage cleanup failed");
}
