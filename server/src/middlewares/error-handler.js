import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { logError } from '../lib/logger.js';

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada.'));
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Já existe um registro com estes dados.' } });
  }
  logError('http.unhandled', error.message, {
    status: 500,
    stack: error.stack,
    data: { name: error.name, code: error.code },
  });
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' } });
}
