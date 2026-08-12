import { z } from "zod";

const password = z
  .string()
  .min(10, "A senha deve ter ao menos 10 caracteres.")
  .max(128);
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(191),
  password,
});
export const loginSchema = z.object({
  email: z.string().trim().email().max(191),
  password: z.string().min(1).max(128),
});
