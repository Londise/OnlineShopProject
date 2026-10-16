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
  const proxy = src => ({
    src,
    dest: `${url.origin}/api/$1`,
    headers: {
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'x-vercel-enable-rewrite-caching': '0',
    },
    transforms: [{
      type: 'request.headers', op: 'set',
      target: { key: 'x-ferchu-proxy-secret' },
      args: '$ORIGIN_PROXY_SECRET', env: ['ORIGIN_PROXY_SECRET'],
    }],
  });
  return {
    framework: 'vite',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    routes: [
      proxy('^/api(?:/(.*))?$'),
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
  };
}
