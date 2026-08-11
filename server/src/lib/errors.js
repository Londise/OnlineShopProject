export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = 'Recurso não encontrado.') => new AppError(404, 'NOT_FOUND', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'FORBIDDEN', message);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, 'UNAUTHORIZED', message);
