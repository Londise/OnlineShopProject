import { AppError } from '../lib/errors.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(new AppError(422, 'VALIDATION_ERROR', 'Dados inválidos.', result.error.flatten()));
  }
  req[source] = result.data;
  next();
};
