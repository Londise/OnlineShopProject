import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createRequestClient, createSharedRequest, resolveApiUrl } from '../src/services/http.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = options => createRequestClient({ baseUrl: '/api/v1', sleep: async () => {}, ...options });

test('production defaults to same origin, never localhost', () => {
  assert.equal(resolveApiUrl(undefined, { production: true }), '/api/v1');
  assert.equal(resolveApiUrl(undefined), 'http://localhost:3001/api/v1');
  assert.throws(() => resolveApiUrl('http://localhost:3001/api/v1', { production: true }));
  assert.throws(() => resolveApiUrl('https://user:secret@example.test/api/v1'));
});

test('shared requests reuse only the in-flight promise and recover after failure', async () => {
  let calls = 0;
  let complete;
  const shared = createSharedRequest(() => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  });
  const first = shared();
  const second = shared();
  assert.equal(calls, 1);
  complete({ products: [] });
  assert.deepEqual(await Promise.all([first, second]), [{ products: [] }, { products: [] }]);
  const third = shared();
  complete({ products: [1] });
  assert.deepEqual(await third, { products: [1] });
  assert.equal(calls, 2);

  const recovering = createSharedRequest(async () => {
    calls++;
    if (calls === 3) throw new Error('temporary');
    return { products: [] };
  });
  await assert.rejects(recovering(), /temporary/);
  assert.deepEqual(await recovering(), { products: [] });
  assert.equal(calls, 4);
});

test('JSON reads include credentials and a trace id', async () => {
  const request = client({ fetchImpl: async (url, options) => {
    assert.equal(url, '/api/v1/products');
    assert.equal(options.credentials, 'include');
    assert.match(options.headers.get('x-trace-id'), /^[a-f0-9-]{36}$/);
    return json({ products: [] });
  } });
  assert.deepEqual(await request('/products'), { products: [] });
});

test('persistent HTML and malformed JSON fail explicitly', async () => {
  for (const makeResponse of [() => new Response('HTML'), () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), () => json(null)]) {
    const request = client({ fetchImpl: async () => makeResponse() });
    await assert.rejects(request('/products'), e => e instanceof ApiError && e.code === 'INVALID_RESPONSE');
  }
});

test('validation errors are not retried; 204 and multipart preserve their contract', async () => {
  let calls = 0;
  const invalid = client({ fetchImpl: async () => { calls++; return json({ error: { code: 'INVALID', message: 'Invalid' } }, 422); } });
  await assert.rejects(invalid('/products'), e => e.status === 422 && e.code === 'INVALID');
  assert.equal(calls, 1);
  const request = client({ fetchImpl: async (_url, options) => {
    assert.equal(options.headers.has('Content-Type'), false);
    return new Response(null, { status: 204 });
  } });
  assert.equal(await request('/uploads', { method: 'POST', body: new FormData() }), null);
});

test('timeout aborts the request and cancellation is not retried', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  const request = client({ fetchImpl, timeoutMs: 10, readRetries: 0 });
  await assert.rejects(request('/products'), e => e.code === 'TIMEOUT');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(request('/products', { signal: controller.signal }), e => e.name === 'AbortError');
});

for (const method of ['POST', 'PATCH', 'DELETE']) test(`H4: ${method} is never replayed after a transient failure`, async () => {
  for (const failure of [() => json({ error: { code: 'UNAVAILABLE' } }, 503), () => { throw new TypeError('offline'); }]) {
    let calls = 0;
    const request = client({ fetchImpl: async () => { calls++; return failure(); } });
    await assert.rejects(request('/mutation', { method, body: '{}' }));
    assert.equal(calls, 1);
  }
});

test('H6: abort during retry backoff prevents another request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = client({
    fetchImpl: async () => { calls++; throw new TypeError('offline'); },
    sleep: async () => controller.abort(new DOMException('User cancelled', 'AbortError')),
  });
  await assert.rejects(request('/products', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('H2: JSON mutations send content-type and caller trace', async () => {
  const request = client({ fetchImpl: async (_url, options) => {
    assert.equal(options.headers.get('content-type'), 'application/json');
    assert.equal(options.headers.get('x-trace-id'), 'client-trace');
    return json({ saved: true });
  } });
  assert.deepEqual(await request('/orders', { method: 'POST', body: '{}', headers: { 'x-trace-id': 'client-trace' } }), { saved: true });
});

test('H7: synchronous failure does not poison later shared catalog requests', async () => {
  let calls = 0;
  const shared = createSharedRequest(() => { if (++calls === 1) throw new Error('temporary'); return { products: ['fresh'] }; });
  await assert.rejects(shared(), /temporary/);
  assert.deepEqual(await shared(), { products: ['fresh'] });
});

for (const value of ['ftp://example.test/api', 'data:text/plain,api', '//example.test/api', 'https://example.test/api?q=1', 'https://example.test/api#fragment', '/api/v1?q=1', '/api/v1#fragment']) {
  test(`H1: unsafe API base ${value} is rejected before transport`, () => assert.throws(() => resolveApiUrl(value)));
}
for (const value of ['http://example.test/api', 'https://localhost/api', 'https://127.0.0.1/api', 'https://[::1]/api']) {
  test(`H1: production rejects insecure or loopback base ${value}`, () => assert.throws(() => resolveApiUrl(value, { production: true })));
}
for (const method of ['GET', 'HEAD']) for (const failure of ['network', 502, 503, 504, ...(method === 'GET' ? ['html'] : [])]) {
  test(`H3: ${method} recovers from one ${failure} response and stops after a second failure`, async () => {
    let calls = 0;
    const broken = () => {
      if (failure === 'network') throw new TypeError('offline');
      return failure === 'html' ? new Response('<html>starting</html>') : json({ error: { code: 'UNAVAILABLE' } }, failure);
    };
    const request = client({ fetchImpl: async () => ++calls === 1 ? broken() : json({ products: ['fresh'] }) });
    assert.deepEqual(await request('/products', { method }), method === 'HEAD' ? null : { products: ['fresh'] });
    assert.equal(calls, 2);
    calls = 0;
    const exhausted = client({ fetchImpl: async () => { calls++; return broken(); } });
    await assert.rejects(exhausted('/products', { method }), error => error.code === (failure === 'network' ? 'NETWORK_ERROR' : failure === 'html' ? 'INVALID_RESPONSE' : 'UNAVAILABLE'));
    assert.equal(calls, 2);
  });
}
test('H3: a successful HEAD has no JSON body contract and is not retried', async () => {
  let calls = 0;
  const request = client({ fetchImpl: async () => { calls++; return new Response(null); } });
  assert.equal(await request('/products', { method: 'HEAD' }), null);
  assert.equal(calls, 1);
});
for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) {
  test(`H3/H4: ${method} timeout ${['GET', 'HEAD'].includes(method) ? 'retries only the read' : 'never replays a mutation'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const request = client({ timeoutMs: 10, fetchImpl: async (_url, { signal }) => {
      calls++;
      if (calls === 2) return json({ recovered: true });
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    } });
    const pending = request('/resource', { method });
    const result = ['GET', 'HEAD'].includes(method)
      ? pending.then(value => assert.deepEqual(value, method === 'HEAD' ? null : { recovered: true }))
      : assert.rejects(pending, { code: 'TIMEOUT' });
    t.mock.timers.tick(10);
    await result;
    assert.equal(calls, ['GET', 'HEAD'].includes(method) ? 2 : 1);
  });
}
for (const value of [false, 7, 'empty catalog']) test(`H5: primitive JSON ${JSON.stringify(value)} is not a successful API contract`, async () => {
  const request = client({ fetchImpl: async () => json(value) });
  await assert.rejects(request('/products'), { code: 'INVALID_RESPONSE' });
});
test('H5: JSON failure preserves server code/status/trace without replacing it with an empty result', async () => {
  const request = client({ fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'DENIED', message: 'Denied' } }), {
    status: 403, headers: { 'content-type': 'application/json', 'x-trace-id': 'server-trace' },
  }) });
  await assert.rejects(request('/products'), error => error.code === 'DENIED' && error.status === 403 && error.traceId === 'server-trace');
});
for (const phase of ['fetch', 'body']) test(`H6: cancellation during ${phase} stops consumption and never retries`, async () => {
  const controller = new AbortController();
  let calls = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const request = client({ fetchImpl: async (_url, { signal }) => {
    calls++;
    if (phase === 'fetch') return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
    });
    return new Response(new ReadableStream({ start(stream) {
      signal.addEventListener('abort', () => stream.error(signal.reason), { once: true }); started();
    } }), { headers: { 'content-type': 'application/json' } });
  } });
  const pending = request('/products', { signal: controller.signal });
  await ready;
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(new DOMException('Cancelled by customer', 'AbortError'));
  await rejected;
  assert.equal(calls, 1);
});
