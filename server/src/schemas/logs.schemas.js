import { z } from 'zod';
import { LOG_LEVELS } from '../lib/logger.js';

const dateParam = z.coerce.date().refine((value) => !Number.isNaN(value.getTime()), 'Data inválida.');

export const logsQuerySchema = z.object({
  level: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value?.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean))
    .refine(
      (parts) =>
        !parts ||
        parts.every((part) => part in LOG_LEVELS || /^(10|20|30|40|50|60)$/.test(part)),
      'Nível inválido. Use nomes (ex.: warn,error) ou números (10–60).',
    ),
  service: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
  event: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_.-]{0,79}$/).optional(),
  traceId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  cursor: z.string().trim().max(160).regex(/^[A-Za-z0-9_-]+=*$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
