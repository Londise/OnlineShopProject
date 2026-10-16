import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { AppError, forbidden } from '../lib/errors.js';

// Forwarded headers are untrusted by default. Only the Vercel rewrite with the
// shared, server-only secret may supply x-ferchu-client-ip. No hop counts or
// assumptions about standard headers rewritten by intermediate load balancers.
export function requireProxyOrigin(secret) {
  if (!secret) return (_req, _res, next) => next();
  const expected = Buffer.from(secret);
  return (req, _res, next) => {
    const supplied = req.get('x-ferchu-proxy-secret');
    const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return next(forbidden('Acesse os dados pelo endereço da loja.'));
    }
    const clientIp = req.get('x-ferchu-client-ip');
    if (typeof clientIp !== 'string' || !isIP(clientIp)) {
      return next(new AppError(400, 'INVALID_PROXY_IP', 'O proxy não informou um IP válido.'));
    }
    req.clientIp = clientIp;
    next();
  };
}

// ipKeyGenerator also groups IPv6 addresses by subnet to prevent trivial
// rate-limit evasion. In local/direct mode, ignore all forwarded headers.
export const clientRateLimitKey = req =>
  ipKeyGenerator(req.clientIp ?? req.socket.remoteAddress ?? '127.0.0.1');
