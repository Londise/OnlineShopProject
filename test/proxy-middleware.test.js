import test from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware.js';

const secret = 'test-only-proxy-secret-'.repeat(3);
process.env.ORIGIN_PROXY_SECRET = secret;

test('proxy middleware overwrites a visitor-supplied client IP with Vercel verified IP', () => {
  const request = new Request('https://ferchumodas.shop/api/v1/products', { headers: {
    'x-real-ip': '203.0.113.10', 'x-ferchu-client-ip': '198.51.100.99', 'x-ferchu-proxy-secret': 'visitor-controlled',
  } });
  const response = middleware(request);
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('x-middleware-request-x-ferchu-client-ip'), '203.0.113.10');
  assert.equal(response.headers.get('x-middleware-request-x-ferchu-proxy-secret'), secret);
  assert.equal(response.headers.has('x-ferchu-proxy-secret'), false);
});

test('proxy middleware fails closed if its private runtime secret is missing', async () => {
  delete process.env.ORIGIN_PROXY_SECRET;
  try {
    const response = middleware(new Request('https://ferchumodas.shop/api/v1/products', { headers: { 'x-real-ip': '203.0.113.10' } }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'PROXY_CONFIG_UNAVAILABLE');
  } finally { process.env.ORIGIN_PROXY_SECRET = secret; }
});

test('proxy middleware does not invent an IP or trust custom/forwarded headers if Vercel IP is absent', () => {
  for (const realIp of ['', 'bad', '203.0.113.10, 203.0.113.11']) {
    const response = middleware(new Request('https://ferchumodas.shop/api/v1/products', { headers: {
      ...(realIp ? { 'x-real-ip': realIp } : {}), 'x-ferchu-client-ip': '198.51.100.99', 'x-forwarded-for': '198.51.100.99',
    } }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
