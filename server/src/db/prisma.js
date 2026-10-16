import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  // Raw Prisma errors may include query data. The HTTP/logger paths redact
  // failures before emitting structured logs; do not also print raw errors.
  log: [],
});
