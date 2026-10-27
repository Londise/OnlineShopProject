import assert from 'node:assert/strict';
import test from 'node:test';

// Lazy Prisma client only: route operations and log persistence are stubbed.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=app';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.ORIGIN_PROXY_SECRET = '';
const { createApp } = await import('../src/app.js');
const { prisma } = await import('../src/db/prisma.js');
const { AppError } = await import('../src/lib/errors.js');
const { __testing, flushAndClose } = await import('../src/lib/logger.js');

test('Express 5 forwards native controller promise rejections to the real JSON error handler with trace context', async (t) => {
  const entries = [];
  __testing.setSink(async (batch) => { entries.push(...batch); });
  __testing.setDeadSink(async () => { assert.fail('log sink must not fail'); });
  t.after(async () => {
    await flushAndClose();
    __testing.resetSink();
    __testing.resetDeadSink();
  });

  let rejection;
  let calls = 0;
  const originalFindMany = prisma.product.findMany;
  t.after(() => { prisma.product.findMany = originalFindMany; });
  prisma.product.findMany = () => {
    calls += 1;
    return Promise.reject(rejection);
  };
  const app = createApp({ attachSession: (_req, _res, next) => next() });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const traceId = '4b37aa50-875a-4b66-91ac-56c5bb731efd';
  const cases = [
    {
      error: new Error('Database unavailable (test only)'), status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' } },
    },
    {
      error: new AppError(409, 'TEST_CONFLICT', 'Test conflict'), status: 409,
      body: { error: { code: 'TEST_CONFLICT', message: 'Test conflict' } },
    },
  ];
  for (const scenario of cases) {
    rejection = scenario.error;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/products`, {
      headers: { 'x-trace-id': traceId }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, scenario.status);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('x-trace-id'), traceId);
    assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.deepEqual(await response.json(), scenario.body);
  }
  assert.equal(calls, cases.length);
  await flushAndClose();
  const unhandled = entries.filter((entry) => entry.event === 'http.unhandled');
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0].traceId, traceId);
  assert.equal(unhandled[0].message, cases[0].error.message);
});
