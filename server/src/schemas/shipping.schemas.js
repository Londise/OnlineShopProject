import { z } from "zod";
import { MAX_ORDER_QUANTITY, MIN_ORDER_QUANTITY } from "../config/business.js";

export const quoteSchema = z.object({
  postalCode: z.string().regex(/^\d{5}-?\d{3}$/),
  pieces: z.coerce.number().int().min(MIN_ORDER_QUANTITY).max(MAX_ORDER_QUANTITY),
});
