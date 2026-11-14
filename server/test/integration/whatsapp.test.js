import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { env } from '../../src/config/env.js';
import { createApp, resetDatabase, closeDatabase, serve } from '../../test-support/integration.js';

beforeEach(resetDatabase);
after(closeDatabase);

test('W2: redirect encodes the message exactly and visitors cannot replace the configured number', async t => {
  const api = await serve(); t.after(api.close);
  const text = 'Olá & verão + azul\n15 peças';
  const response = await api.request(`/api/v1/whatsapp?${new URLSearchParams({ text, phone: '5511000000000', number: '5511222222222' })}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://api.whatsapp.com');
  assert.equal(location.pathname, '/send');
  assert.equal(location.searchParams.get('phone'), '5511999998888');
  assert.equal(location.searchParams.get('text'), text);
  assert.deepEqual([...location.searchParams.keys()], ['phone', 'text']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('W2: missing contact and repeated text return JSON errors, never a redirect', async t => {
  const api = await serve(); t.after(api.close);
  const repeated = await api.request('/api/v1/whatsapp?text=one&text=two', { redirect: 'manual' });
  assert.equal(repeated.status, 400);
  assert.equal((await repeated.json()).error.code, 'INVALID_WHATSAPP_MESSAGE');
  const unavailable = await serve(createApp({ config: { ...env, WHATSAPP_NUMBER: '' } })); t.after(unavailable.close);
  const response = await unavailable.request('/api/v1/whatsapp?text=hello', { redirect: 'manual' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'WHATSAPP_UNAVAILABLE');
  assert.equal(response.headers.get('location'), null);
});

test('W2: the application rejects messages above its limit even behind an ingress accepting larger URLs', async t => {
  // Node's default header cap rejects these URLs before Express. A larger test
  // ingress exercises our own limit too, without changing production settings.
  const server = createServer({ maxHeaderSize: 65536 }, createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/whatsapp?text=`;
  // The client's response-header limit must also accommodate the accepted
  // redirect's Location. Fetch's smaller limit otherwise masks this boundary.
  const request = url => new Promise((resolve, reject) => {
    const req = get(url, { maxHeaderSize: 65536, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local redirect request timed out')));
  });
  const accepted = await request(base + 'a'.repeat(20000));
  assert.equal(accepted.status, 302);
  assert.equal(new URL(accepted.headers.location).searchParams.get('text').length, 20000);
  const rejected = await request(base + 'a'.repeat(20001));
  assert.equal(rejected.status, 400);
  assert.equal(JSON.parse(rejected.body).error.code, 'INVALID_WHATSAPP_MESSAGE');
});
