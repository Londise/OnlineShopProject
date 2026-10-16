import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createRequestClient, resolveApiUrl } from '../src/services/http.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = options => createRequestClient({ baseUrl: '/api/v1', sleep: async () => {}, ...options });

test('production defaults to same origin, never localhost', () => {
  assert.equal(resolveApiUrl(undefined, { production: true }), '/api/v1');
  assert.equal(resolveApiUrl(undefined), 'http://localhost:3001/api/v1');
  assert.throws(() => resolveApiUrl('http://localhost:3001/api/v1', { production: true }));
  assert.throws(() => resolveApiUrl('https://user:secret@example.test/api/v1'));
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

test('an HTML startup page is not an empty successful response; read retries once', async () => {
  let calls = 0;
  const request = client({ fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('<html>Starting</html>', { headers: { 'Content-Type': 'text/html' } }) : json({ products: [1] });
  } });
  assert.deepEqual(await request('/products'), { products: [1] });
  assert.equal(calls, 2);
});

test('persistent HTML and malformed JSON fail explicitly', async () => {
  for (const makeResponse of [() => new Response('HTML'), () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), () => json(null)]) {
    const request = client({ fetchImpl: async () => makeResponse() });
    await assert.rejects(request('/products'), e => e instanceof ApiError && e.code === 'INVALID_RESPONSE');
  }
});

test('order POST never retries even on 503 or network failure', async () => {
  for (const networkFailure of [false, true]) {
    let calls = 0;
    const request = client({ fetchImpl: async () => {
      calls++;
      if (networkFailure) throw new TypeError('network unavailable');
      return json({ error: { message: 'Unavailable' } }, 503);
    } });
    await assert.rejects(request('/orders', { method: 'POST', body: '{}' }));
    assert.equal(calls, 1);
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
