import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verifySameOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // State-changing requests must carry the exact frontend Origin. An absent
  // Origin is not "same-origin enough": browsers send it on every cross-site
  // and same-origin POST/PATCH/DELETE, so only non-browser clients lose access.
  if (req.get('origin') !== env.FRONTEND_ORIGIN) return next(forbidden('Origem da requisição não permitida.'));
  next();
}
