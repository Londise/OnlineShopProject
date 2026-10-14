import 'dotenv/config';
import { z } from 'zod';
import { databaseUrlSchema } from './database.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: databaseUrlSchema,
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_COOKIE_NAME: z.string().min(1).default('ferchu_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  SUPABASE_URL: z.preprocess(value => value || undefined, z.string().url().optional()),
  SUPABASE_SECRET_KEY: z.preprocess(value => value || undefined, z.string().startsWith('sb_secret_').optional()),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
