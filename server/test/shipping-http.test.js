import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

// Exercita o pipeline HTTP real sem sessão, banco ou serviços externos.
// Impede o logger de tentar persistir telemetria desta fixture sem banco.
process.env.LOG_LEVEL = 'fatal';
const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { quoteShippingOptions } = await import('../src/services/melhor-envio.service.js');

async function serve(t, shippingQuote, config = env) {
  const server = createApp({ config, database: {}, attachSession: (_req, _res, next) => next(), shippingQuote }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return async (body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/shipping/quote`, {
    method: 'POST', headers: { origin: env.FRONTEND_ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
}

const input = { postalCode: '01310-100', pieces: 15 };
const provider = (name, price) => ({
  name, price, custom_price: price, delivery_time: 5, company: { name: 'Correios' },
  internalToken: 'fixture-provider-private-value',
});

test('M4: public quotes whitelist inputs/outputs, sort prices, return two options and do not cache', async t => {
  let seen;
  const request = await serve(t, async data => {
    seen = data;
    return quoteShippingOptions({ SHIPPING_ORIGIN_POSTAL_CODE: '03031000' }, data, {
      request: async () => [provider('SEDEX', '30.00'), provider('PAC', '20.00'), provider('Mini', '10.00')],
    });
  });
  const response = await request({ ...input, url: 'http://127.0.0.1/private', token: 'client-chosen', price: 0, volumes: [] });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(seen, input);
  const body = await response.json();
  assert.deepEqual(body.options.map(option => option.price), [10, 20]);
  assert.ok(!JSON.stringify(body).includes('fixture-provider-private-value'));
  assert.ok(!JSON.stringify(body).includes('client-chosen'));
});

test('M4: invalid CEPs, piece counts and cross-origin requests never reach the quoter', async t => {
  let calls = 0;
  const request = await serve(t, async () => { calls++; return { options: [] }; });
  for (const body of [
    { ...input, postalCode: 'https://attacker.test' }, { ...input, postalCode: '01310-100/anything' },
    ...[9, 401, -1, 1.5, {}, []].map(pieces => ({ ...input, pieces })),
  ]) {
    const response = await request(body);
    assert.equal(response.status, 422);
    await response.json();
  }
  for (const origin of ['', 'null', 'https://attacker.test']) {
    const response = await request(input, { origin });
    assert.equal(response.status, 403);
    await response.json();
  }
  assert.equal(calls, 0);
});

test('M4: visitor-supplied forwarding headers cannot bypass the 40-request freight limit', async t => {
  let calls = 0;
  const request = await serve(t, async () => { calls++; return { options: [] }; });
  for (let index = 1; index <= 41; index++) {
    const response = await request(input, {
      'x-forwarded-for': `192.0.2.${index}`, 'x-ferchu-client-ip': `192.0.2.${index}`,
    });
    assert.equal(response.status, index <= 40 ? 200 : 429);
    await response.json();
  }
  assert.equal(calls, 40);
});

test('M4: shipping preserves the authenticated proxy boundary without requiring a store login', async t => {
  let calls = 0;
  const secret = 'local-fixture-proxy-secret-1234567890';
  const request = await serve(t, async () => { calls++; return { options: [] }; }, { ...env, ORIGIN_PROXY_SECRET: secret });
  for (const headers of [{}, { 'x-ferchu-proxy-secret': 'wrong', 'x-ferchu-client-ip': '192.0.2.1' }]) {
    const response = await request(input, headers);
    assert.equal(response.status, 403);
    await response.json();
  }
  const accepted = await request(input, { 'x-ferchu-proxy-secret': secret, 'x-ferchu-client-ip': '192.0.2.1' });
  assert.equal(accepted.status, 200);
  await accepted.json();
  assert.equal(calls, 1);
});
