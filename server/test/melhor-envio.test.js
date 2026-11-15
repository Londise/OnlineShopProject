import test from 'node:test';
import assert from 'node:assert/strict';
import { requestQuote, quoteShippingOptions } from '../src/services/melhor-envio.service.js';

const config = {
  SHIPPING_ORIGIN_POSTAL_CODE: '03031000',
  MELHOR_ENVIO_BASE_URL: 'https://melhorenvio.example.test',
  MELHOR_ENVIO_TOKEN: 'test-token-value',
};

test('M1: quotes require a configured token and never fall back silently', async () => {
  await assert.rejects(
    requestQuote({ ...config, MELHOR_ENVIO_TOKEN: '' }, { postalCode: '01001000', volumes: [{ width: 30, height: 30, length: 30, weightKg: 2 }] }),
    { code: 'SHIPPING_UNAVAILABLE' },
  );
});

test('M1: the quote request carries bearer auth, origin CEP and only quote data', async () => {
  let seen = null;
  const fetchImpl = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const quotes = await requestQuote(config, { postalCode: '01310-100', volumes: [{ width: 30, height: 30, length: 30, weightKg: 2 }] }, fetchImpl);
  assert.deepEqual(quotes, []);
  assert.equal(seen.url, 'https://melhorenvio.example.test/api/v2/me/shipment/calculate');
  assert.equal(seen.options.headers.Authorization, 'Bearer test-token-value');
  const body = JSON.parse(seen.options.body);
  assert.deepEqual(body, {
    from: { postal_code: '03031000' },
    to: { postal_code: '01310100' },
    volumes: [{ width: 30, height: 30, length: 30, weight: 2, insurance: 0 }],
    options: { receipt: false, own_hand: false },
  });
});

test('M1: network and provider failures surface as unavailable instead of a fake price', async () => {
  await assert.rejects(
    requestQuote(config, { postalCode: '01001000', volumes: [{ width: 30, height: 30, length: 30, weightKg: 2 }] }, async () => { throw new Error('down'); }),
    { code: 'SHIPPING_UNAVAILABLE' },
  );
  const failing = async () => new Response('{"error":"nope"}', { status: 401 });
  await assert.rejects(
    requestQuote(config, { postalCode: '01001000', volumes: [{ width: 30, height: 30, length: 30, weightKg: 2 }] }, failing),
    { code: 'SHIPPING_QUOTE_FAILED' },
  );
  const notJson = async () => new Response('not json', { status: 200 });
  await assert.rejects(
    requestQuote(config, { postalCode: '01001000', volumes: [{ width: 30, height: 30, length: 30, weightKg: 2 }] }, notJson),
    { code: 'SHIPPING_QUOTE_FAILED' },
  );
});

const raw = (company, name, price, days = 4) => ({ company: { name: company }, name, price: String(price), custom_price: String(price), delivery_time: days, custom_delivery_time: days });
const rawError = (company, name) => ({ company: { name: company }, name, error: 'Transportadora não atende este trecho.' });
const providers = [
  raw('Correios', 'PAC', 19.5, 7),
  raw('Correios', 'SEDEX', 30, 2),
  raw('Jadlog', '.Package', 18, 3),
  raw('LATAM Cargo', 'LATAM X', 1, 2),
];

test('M2: carrier error entries (no price) are dropped before selecting options', async () => {
  const result = await quoteShippingOptions(config, { postalCode: '01310-100', pieces: 15 }, {
    request: async () => [...providers, rawError('Correios', 'PAC')],
  });
  // PAC com erro não substitui nem aparece; a lista continua sem preço inválido.
  assert.ok(!result.options.some((option) => !Number.isFinite(option.price)));
  assert.ok(!result.options.some((option) => /latam/i.test(option.company)));
  assert.deepEqual(result.options.map((option) => option.key), ['Jadlog|.Package|1', 'Correios|PAC|1', 'Correios|SEDEX|1']);
});

test('M2: when only error entries exist no fake options are returned', async () => {
  const result = await quoteShippingOptions(config, { postalCode: '01310-100', pieces: 15 }, {
    request: async () => [rawError('Correios', 'PAC'), rawError('LATAM Cargo', 'X')],
  });
  assert.deepEqual(result.options, []);
});

test('M2: light orders quote every eligible carrier once and exclude LATAM', async () => {
  const calls = [];
  const request = async (_config, { postalCode, volumes }) => {
    calls.push({ postalCode, volumes });
    return providers;
  };
  const result = await quoteShippingOptions(config, { postalCode: '01310-100', pieces: 15 }, { request });
  assert.equal(calls.length, 1); // um único volume atende todos
  assert.equal(calls[0].volumes.length, 1);
  assert.deepEqual(result.options.map((option) => option.key), ['Jadlog|.Package|1', 'Correios|PAC|1', 'Correios|SEDEX|1']);
  assert.ok(!result.options.some((option) => /latam/i.test(option.company)));
});

test('M2: heavy orders quote Jadlog in one volume and other carriers per split volume, summed', async () => {
  const calls = [];
  const request = async (_config, { volumes }) => {
    calls.push(volumes);
    return providers;
  };
  const result = await quoteShippingOptions(config, { postalCode: '01310-100', pieces: 120 }, { request });
  // 120 peças = 35 kg: cenário JADLOG com 1 volume + cenário OTHER com 2 volumes.
  assert.equal(calls.length, 3);
  assert.equal(calls[0].length, 1); // Jadlog, volume único de 35 kg
  assert.equal(calls[1].length, 1); // embalagem 1 das outras transportadoras
  assert.equal(calls[2].length, 1); // embalagem 2 das outras transportadoras
  assert.deepEqual(result.options.map((option) => option.key), [
    'Jadlog|.Package|1', // 18
    'Correios|PAC|2',    // 19.5 × 2 = 39
    'Correios|SEDEX|2',  // 30 × 2 = 60
  ]);
  assert.equal(result.options[1].price, 39);
  assert.equal(result.options[1].days, 7);
});

test('M2: split shipments only combine the same service available for every package', async () => {
  let call = 0;
  const request = async () => {
    call += 1;
    if (call === 1) return providers; // volume único da Jadlog
    if (call === 2) return [raw('Correios', 'PAC', 10), raw('Correios', 'SEDEX', 15)];
    return [raw('Correios', 'PAC', 12)]; // SEDEX ausente na segunda embalagem
  };
  const result = await quoteShippingOptions(config, { postalCode: '01310-100', pieces: 120 }, { request });
  assert.deepEqual(result.options.map((option) => option.key), [
    'Jadlog|.Package|1', // 18
    'Correios|PAC|2',    // 10 + 12 = 22; SEDEX descartado por faltar em uma embalagem
  ]);
});
