import { z } from "zod";

const item = z.object({
  variantId: z.string().cuid(),
  quantity: z.coerce.number().int().min(1).max(999),
});
const whatsapp = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().min(10).max(15));
export const createOrderSchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(2).max(120),
      whatsapp,
      email: z.string().trim().email().max(191).optional(),
    }),
    delivery: z.object({
      method: z.enum(["CORREIOS", "EXCURSAO"]),
      postalCode: z
        .string()
        .regex(/^\d{5}-?\d{3}$/)
        .optional(),
    }),
    items: z.array(item).min(1).max(80),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.delivery.method === "CORREIOS" && !value.delivery.postalCode)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delivery", "postalCode"],
        message: "CEP é obrigatório para Correios.",
      });
  });

export const updateOrderSchema = z.object({
  status: z.enum(["NOVO", "CONFIRMADO", "CANCELADO", "CONCLUIDO"]).optional(),
  paidAmountCents: z.coerce.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  items: z.array(item).min(1).max(80).optional(),
});
