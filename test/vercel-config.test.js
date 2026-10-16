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

test('API proxy precedes SPA fallback, overwrites the secret header and disables caching', () => {
  const config = createVercelConfig(environment);
  const [proxy, filesystem, fallback] = config.routes;
  assert.equal(proxy.dest, 'https://example.onrender.com/api/$1');
  assert.equal(proxy.headers['Cache-Control'], 'no-store');
  assert.equal(proxy.headers['x-vercel-enable-rewrite-caching'], '0');
  assert.equal(proxy.transforms[0].op, 'set');
  assert.equal(proxy.transforms[0].args, '$ORIGIN_PROXY_SECRET');
  assert.equal(JSON.stringify(config).includes(environment.ORIGIN_PROXY_SECRET), false);
  assert.equal(filesystem.handle, 'filesystem');
  assert.equal(fallback.dest, '/index.html');
  for (const url of ['/api', '/api/v1/products', '/api/v1/unknown']) assert.ok(new RegExp(proxy.src).test(url));
  assert.equal(new RegExp(proxy.src).test('/management'), false);
});
