import { randomUUID } from 'node:crypto';
import { runWithTrace } from '../lib/trace-context.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Aceita um x-trace-id válido do navegador ou gera um novo; devolve ambos os
// IDs nos headers da resposta para suporte/debug ponta a ponta.
export function traceMiddleware(req, res, next) {
  const incoming = req.get('x-trace-id');
  const traceId = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();
  const requestId = randomUUID();
  res.set({ 'x-trace-id': traceId, 'x-request-id': requestId });
  runWithTrace({ traceId, requestId, service: 'api' }, next);
}
