import { ipAddress, next } from '@vercel/functions';
import { isIP } from 'node:net';

// Standard proxy headers can be rewritten by the Render ingress. Capture the
// Vercel-verified visitor IP before forwarding it in our own header namespace.
// Never accept the incoming x-ferchu-client-ip or proxy secret from a visitor.
export default function middleware(request) {
  const secret = process.env.ORIGIN_PROXY_SECRET;
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret ?? '')) {
    return Response.json({ error: { code: 'PROXY_CONFIG_UNAVAILABLE', message: 'O encaminhamento está temporariamente indisponível.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const ip = ipAddress(request);
  if (!ip || !isIP(ip)) {
    return Response.json({ error: { code: 'PROXY_IP_UNAVAILABLE', message: 'Não foi possível validar a origem da chamada.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const headers = new Headers(request.headers);
  headers.set('x-ferchu-client-ip', ip);
  // request.headers modifies the upstream request, not browser response headers.
  headers.set('x-ferchu-proxy-secret', secret);
  return next({ request: { headers }, headers: { 'x-ferchu-proxy': 'middleware' } });
}
