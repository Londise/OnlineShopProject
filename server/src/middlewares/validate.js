import { AppError } from '../lib/errors.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(new AppError(422, 'VALIDATION_ERROR', 'Dados inválidos.', result.error.flatten()));
  }
  req[source] = result.data;
  next();
};

// Express 5 expõe req.query como getter: o resultado validado vai para
// req.validatedQuery em vez de substituir req.query.
export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return next(new AppError(422, 'VALIDATION_ERROR', 'Parâmetros de consulta inválidos.', result.error.flatten()));
  }
  req.validatedQuery = result.data;
  next();
};
