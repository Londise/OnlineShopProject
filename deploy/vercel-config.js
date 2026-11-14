// Executed by Vercel at configuration time, not bundled into the browser.
// No hostname or credential is guessed. Missing settings fail the deploy
// before it can replace the currently running frontend.
export function createVercelConfig(environment) {
  const raw = environment.RENDER_BACKEND_URL?.trim();
  if (!raw) throw new Error('Configure RENDER_BACKEND_URL no Vercel com a origem HTTPS real do Render.');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('RENDER_BACKEND_URL deve conter apenas uma origem HTTPS pública, sem caminho ou credenciais.');
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(environment.ORIGIN_PROXY_SECRET ?? '')) {
    throw new Error('Configure ORIGIN_PROXY_SECRET no Vercel e no Render (mesmo valor, mínimo 32 caracteres).');
  }
  // Apenas o que o frontend realmente carrega: scripts/estilos próprios,
  // fontes do Google, imagens do próprio domínio e do bucket público do
  // Supabase, e prévias de upload em blob. Nenhum frame/objeto externo.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
  return {
    framework: 'vite',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    proxy: { entrypoint: 'middleware.js', matcher: '/api/:path*' },
    // Let Vercel compose filesystem and routing middleware. An explicit legacy
    // routes table must not bypass the middleware that authenticates upstream.
    rewrites: [
      { source: '/api/:path*', destination: `${url.origin}/api/:path*` },
      { source: '/((?!api(?:/|$)).*)', destination: '/index.html' },
    ],
    headers: [
      { source: '/api/:path*', headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'CDN-Cache-Control', value: 'no-store' },
        { key: 'x-vercel-enable-rewrite-caching', value: '0' },
      ] },
      { source: '/((?!api(?:/|$)).*)', headers: [
        { key: 'Content-Security-Policy', value: CSP },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ] },
    ],
  };
}
