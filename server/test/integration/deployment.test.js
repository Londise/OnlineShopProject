import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';

// This file runs in its own test process, with the disposable DB supplied by
// run-integration. Exercise production cookies/proxy with real sessions.
process.env.NODE_ENV = 'production';
process.env.FRONTEND_ORIGIN = 'https://shop.example.test';
process.env.ORIGIN_PROXY_SECRET = 'test-only-proxy-value-'.repeat(3);
process.env.LOG_LEVEL = 'fatal';
const { prisma, createApp, serve, resetDatabase, closeDatabase } = await import('../../test-support/integration.js');
beforeEach(resetDatabase);
after(closeDatabase);
const headers = (ip = '198.51.100.1') => ({
  'x-ferchu-proxy-secret': process.env.ORIGIN_PROXY_SECRET,
  'x-ferchu-client-ip': ip, Origin: process.env.FRONTEND_ORIGIN,
});

test('P2/P5: health is public but proxy bypass and unverified forwarding fail closed', async t => {
  const api = await serve(); t.after(api.close);
  assert.equal((await api.request('/health')).status, 200);
  for (const [overrides, expected, code] of [
    [{ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.1' }, 403, 'PROXY_AUTH_MISSING'],
    [{ ...headers(), 'x-ferchu-proxy-secret': 'wrong' }, 403, 'PROXY_AUTH_INVALID'],
    [{ ...headers(), 'x-ferchu-client-ip': '198.51.100.1, 203.0.113.1' }, 400, 'INVALID_PROXY_IP'],
  ]) {
    const response = await api.request('/api/v1/products', { headers: overrides });
    assert.equal(response.status, expected);
    assert.equal((await response.json()).error.code, code);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('S3/P5: production login sets a Secure host-only cookie, returns a real session, and logout revokes it', async t => {
  await prisma.user.create({ data: { name: 'Admin', email: 'admin@example.test', role: 'ADMIN', passwordHash: await argon2.hash('correct-horse-42') } });
  const api = await serve(); t.after(api.close);
  const response = await api.request('/api/v1/auth/login', { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'correct-horse-42' }) });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/); assert.doesNotMatch(setCookie, /Domain=/);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://shop.example.test');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-expose-headers'), /x-trace-id/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await (await api.request('/api/v1/auth/me', { headers: { ...headers(), cookie } })).json()).user.role, 'ADMIN');
  assert.equal((await api.request('/api/v1/admin/logs', { headers: { ...headers(), cookie } })).status, 200);
  assert.equal((await api.request('/api/v1/auth/logout', { method: 'POST', headers: { ...headers(), cookie } })).status, 204);
  assert.ok((await prisma.authSession.findFirst()).revokedAt);
});

test('H8/L6: API errors stay JSON, no-store and correlated, without leaking submitted values', async t => {
  const api = await serve(); t.after(api.close);
  const trace = 'ac6eb1a3-4e6f-4000-9000-cada5983d31c';
  const first = await api.request('/api/v1/unknown', { headers: { ...headers(), 'x-trace-id': trace } });
  assert.equal(first.status, 404); assert.equal(first.headers.get('x-trace-id'), trace);
  assert.equal((await first.json()).error.code, 'NOT_FOUND');
  const invalid = await api.request('/api/v1/auth/login', { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
  const validation = await api.request('/api/v1/auth/login', { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sensitive-invalid-input', password: '' }) });
  assert.equal(validation.status, 422); assert.ok(!(await validation.text()).includes('sensitive-invalid-input'));
  assert.notEqual(first.headers.get('x-request-id'), invalid.headers.get('x-request-id'));
  for (const response of [first, invalid, validation]) {
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  }
});

test('P5: foreign mutation Origin is rejected and failing database health is not reported as healthy', async t => {
  const api = await serve(); t.after(api.close);
  assert.equal((await api.request('/api/v1/auth/logout', { method: 'POST', headers: { ...headers(), Origin: 'https://evil.example.test' } })).status, 403);
  const unavailable = await serve(createApp({ database: { $queryRaw: async () => { throw new Error('database unavailable password=do-not-emit'); } } }));
  t.after(unavailable.close);
  const response = await unavailable.request('/health');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' } });
});

test('P2: rate limits use verified IPs, ignore visitor chains and group the same IPv6 subnet', async t => {
  const api = await serve(); t.after(api.close);
  for (const ip of ['198.51.100.40', '2001:db8:1234:5678::1']) {
    let response;
    for (let index = 0; index < 21; index++) response = await api.request('/api/v1/auth/me', { headers: { ...headers(ip), 'x-forwarded-for': `203.0.113.${index + 1}` } });
    assert.equal(response.status, 429);
  }
  assert.equal((await api.request('/api/v1/auth/me', { headers: headers('198.51.100.41') })).status, 200);
  assert.equal((await api.request('/api/v1/auth/me', { headers: headers('2001:db8:1234:5678::2') })).status, 429);
});
