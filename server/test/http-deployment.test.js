import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';

// Completely isolated HTTP tests: stub every database operation used below.
// Neither DATABASE_URL from .env nor a real Supabase project is contacted.
process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=app';
process.env.FRONTEND_ORIGIN = 'https://shop.example.test';
process.env.ORIGIN_PROXY_SECRET = 'test-only-proxy-value-'.repeat(3);
const { createApp } = await import('../src/app.js');
const { prisma } = await import('../src/db/prisma.js');
const { __testing, flush } = await import('../src/lib/logger.js');
__testing.config.mirror = false;
__testing.setSink(async () => {});
__testing.setDeadSink(async () => {});
let server, base;
const restore = [];
const sessions = new Map();
const stub = (object, key, value) => {
  const previous = object[key];
  object[key] = value;
  restore.push(() => { object[key] = previous; });
};
const headers = (ip = '198.51.100.1') => ({
  'x-ferchu-proxy-secret': process.env.ORIGIN_PROXY_SECRET,
  'x-ferchu-client-ip': ip,
  Origin: process.env.FRONTEND_ORIGIN,
});

before(async () => {
  const passwordHash = await argon2.hash('test-password-not-real', { type: argon2.argon2id });
  const user = { id: 'test-admin', name: 'Test', email: 'admin@example.invalid', role: 'ADMIN', active: true, passwordHash };
  stub(prisma.user, 'findUnique', async ({ where }) => where.email === user.email ? user : null);
  stub(prisma.authSession, 'create', async ({ data }) => { sessions.set(data.tokenHash, data); return data; });
  stub(prisma.authSession, 'findFirst', async ({ where }) => {
    const row = sessions.get(where.tokenHash);
    return row && !row.revokedAt && row.expiresAt > where.expiresAt.gt ? { ...row, user } : null;
  });
  stub(prisma.authSession, 'updateMany', async ({ where, data }) => {
    const row = sessions.get(where.tokenHash);
    if (row) Object.assign(row, data);
    return { count: row ? 1 : 0 };
  });
  stub(prisma.product, 'findMany', async () => []);
  stub(prisma, '$queryRaw', async () => []);
  const app = createApp({ database: { $queryRaw: async () => [] } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await flush();
  for (const undo of restore.reverse()) undo();
});

test('health is public; API rejects bypass and forged forwarding headers', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const bypass = await fetch(`${base}/api/v1/products`, { headers: { 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.2' } });
  assert.equal(bypass.status, 403);
  assert.equal((await bypass.json()).error.code, 'PROXY_AUTH_MISSING');
  assert.equal(bypass.headers.get('cache-control'), 'no-store');
  const wrongSecret = await fetch(`${base}/api/v1/products`, { headers: { ...headers(), 'x-ferchu-proxy-secret': 'wrong-test-value' } });
  assert.equal(wrongSecret.status, 403);
  const error = (await wrongSecret.json()).error;
  assert.equal(error.code, 'PROXY_AUTH_INVALID');
  assert.equal(error.message.includes('wrong-test-value'), false);
  const badIp = await fetch(`${base}/api/v1/products`, { headers: { ...headers(), 'x-ferchu-client-ip': '198.51.100.1, 198.51.100.2' } });
  assert.equal(badIp.status, 400);
});

test('catalog and unknown paths return JSON, with traces and no cache', async () => {
  const response = await fetch(`${base}/api/v1/products`, { headers: headers() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { products: [] });
  assert.match(response.headers.get('x-trace-id'), /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  const missing = await fetch(`${base}/api/v1/unknown`, { headers: headers() });
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
});

test('login -> me -> protected logs -> logout preserves secure host-only cookies and revokes the session', async () => {
  const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.invalid', password: 'test-password-not-real' }) });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.equal(/Domain=/i.test(setCookie), false);
  const cookie = setCookie.split(';')[0];
  const me = await fetch(`${base}/api/v1/auth/me`, { headers: { ...headers(), Cookie: cookie } });
  assert.equal((await me.json()).user.role, 'ADMIN');
  assert.equal((await fetch(`${base}/api/v1/admin/logs`, { headers: headers() })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/admin/logs`, { headers: { ...headers(), Cookie: cookie } })).status, 200);
  const logout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { ...headers(), Cookie: cookie } });
  assert.equal(logout.status, 204);
  const afterLogout = await fetch(`${base}/api/v1/auth/me`, { headers: { ...headers(), Cookie: cookie } });
  assert.equal((await afterLogout.json()).user, null);
});

test('foreign Origin is rejected and malformed JSON stays a 400', async () => {
  const foreign = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { ...headers(), Origin: 'https://evil.example.test', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const invalid = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(invalid.status, 400);
});

test('rate limit separates verified client IPs and ignores forged x-forwarded-for', async () => {
  let response;
  for (let i = 0; i < 21; i++) {
    response = await fetch(`${base}/api/v1/auth/me`, { headers: { ...headers('198.51.100.40'), 'x-forwarded-for': `203.0.113.${i + 1}` } });
  }
  assert.equal(response.status, 429);
  assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: headers('198.51.100.41') })).status, 200);
});
