import test from 'node:test';
import assert from 'node:assert/strict';
import { createVercelConfig } from '../deploy/vercel-config.js';

const environment = { RENDER_BACKEND_URL: 'https://example.onrender.com', ORIGIN_PROXY_SECRET: 'x'.repeat(40) };
test('deployment fails closed until the real backend origin and secret are configured', () => {
  assert.throws(() => createVercelConfig({}), /RENDER_BACKEND_URL/);
  assert.throws(() => createVercelConfig({ RENDER_BACKEND_URL: environment.RENDER_BACKEND_URL }), /ORIGIN_PROXY_SECRET/);
  for (const url of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/api', 'https://localhost']) {
    assert.throws(() => createVercelConfig({ ...environment, RENDER_BACKEND_URL: url }));
  }
});

test('API proxy precedes SPA fallback, enables trusted middleware and disables caching', () => {
  const config = createVercelConfig(environment);
  assert.deepEqual(config.proxy, { entrypoint: 'middleware.js', matcher: '/api/:path*' });
  assert.equal(config.routes, undefined);
  const [proxy, fallback] = config.rewrites;
  assert.equal(proxy.source, '/api/:path*');
  assert.equal(proxy.destination, 'https://example.onrender.com/api/:path*');
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['x-vercel-enable-rewrite-caching'], '0');
  assert.equal(JSON.stringify(config).includes(environment.ORIGIN_PROXY_SECRET), false);
  assert.equal(fallback.destination, '/index.html');
  for (const url of ['/api', '/api/v1/products', '/api/v1/unknown']) assert.equal(new RegExp(`^${fallback.source}$`).test(url), false);
  assert.equal(new RegExp(`^${fallback.source}$`).test('/management'), true);
});
