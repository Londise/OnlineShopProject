import 'dotenv/config';
import { z } from 'zod';
import { databaseUrlSchema } from './database.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: databaseUrlSchema,
  FRONTEND_ORIGIN: z.string().url().refine(value => {
    const url = new URL(value);
    return value === url.origin;
  }, 'Informe apenas a origem, sem caminho ou barra final.').default('http://localhost:5173'),
  ORIGIN_PROXY_SECRET: z.preprocess(value => value || undefined,
    z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, 'Use um token aleatório de 32–256 caracteres, sem espaços.').optional()),
  SESSION_COOKIE_NAME: z.string().min(1).default('ferchu_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  SUPABASE_URL: z.preprocess(value => value || undefined, z.string().url().optional()),
  SUPABASE_SECRET_KEY: z.preprocess(value => value || undefined, z.string().startsWith('sb_secret_').optional()),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_DEBUG_SAMPLE: z.coerce.number().min(0).max(1).default(0.1),
  LOG_BUFFER_MAX: z.coerce.number().int().min(1).max(1000).default(100),
  LOG_FLUSH_MS: z.coerce.number().int().min(250).max(30_000).default(2000),
  LOG_QUEUE_MAX_ENTRIES: z.coerce.number().int().min(100).max(10_000).default(1000),
  LOG_QUEUE_MAX_BYTES: z.coerce.number().int().min(65_536).max(16_777_216).default(2_097_152),
  MEDIA_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    if (!value.FRONTEND_ORIGIN.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: 'Produção exige uma origem HTTPS.' });
    }
    if (!value.ORIGIN_PROXY_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['ORIGIN_PROXY_SECRET'], message: 'Configure o segredo compartilhado com o proxy Vercel.' });
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
