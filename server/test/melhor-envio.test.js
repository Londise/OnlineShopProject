import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { requestQuote, quoteShippingOptions, createShippingQuoter } from '../src/services/melhor-envio.service.js';

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
  assert.equal(seen.options.redirect, 'error');
  assert.ok(seen.options.signal instanceof AbortSignal);
  const body = JSON.parse(seen.options.body);
  assert.deepEqual(body, {
    from: { postal_code: '03031000' },
    to: { postal_code: '01310100' },
    volumes: [{ width: 30, height: 30, length: 30, weight: 2, insurance: 0 }],
    options: { receipt: false, own_hand: false },
  });
});

test('M1: oversized provider bodies and service lists fail closed', async () => {
  for (const body of [JSON.stringify([{ data: 'x'.repeat(600_000) }]), JSON.stringify(Array.from({ length: 201 }, () => ({})))]) {
    await assert.rejects(
      requestQuote(config, { postalCode: '01001000', volumes: [] },
        async () => new Response(body, { headers: { 'content-type': 'application/json' } })),
      { code: 'SHIPPING_QUOTE_FAILED' },
    );
  }
});

test('M1: a streaming oversized response is cancelled even with a false Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(64 * 1024).fill(32)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(
    requestQuote(config, { postalCode: '01001000', volumes: [] },
      async () => new Response(stream, { headers: { 'content-type': 'application/json', 'content-length': '2' } })),
    { code: 'SHIPPING_QUOTE_FAILED' },
  );
  assert.equal(cancelled, true);
});

test('M1: HTTP redirects never forward the quote body or bearer token to another path', async t => {
  let redirectedCalls = 0;
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === '/api/v2/me/shipment/calculate') {
      res.writeHead(307, { location: '/unexpected-target' }).end();
    } else {
      redirectedCalls++;
      res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await assert.rejects(
    requestQuote({ ...config, MELHOR_ENVIO_BASE_URL: `http://127.0.0.1:${server.address().port}` }, { postalCode: '01001000', volumes: [] }),
    { code: 'SHIPPING_UNAVAILABLE' },
  );
  assert.equal(redirectedCalls, 0);
});

test('M1: provider diagnostics and credentials are never reflected in public errors', async () => {
  const secret = config.MELHOR_ENVIO_TOKEN;
  for (const fetchImpl of [
    async () => { throw new Error(`Authorization: Bearer ${secret}`); },
    async () => new Response(JSON.stringify({ error: secret }), { status: 401 }),
    async () => new Response(secret, { headers: { 'content-type': 'text/html' } }),
  ]) {
    await assert.rejects(requestQuote(config, { postalCode: '01001000', volumes: [] }, fetchImpl), error => {
      assert.ok(!`${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(secret));
      return error.status === 502 || error.status === 503;
    });
  }
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

test('M2: malformed entries and explicit provider errors cannot become free shipping', async () => {
  const invalid = [
    null, 1, {}, { company: null },
    { company: { name: 'Correios' }, name: 'PAC', price: null, custom_price: null },
    { company: { name: 'Correios' }, name: 'PAC', price: '' },
    { company: { name: 'Correios' }, name: 'PAC', price: '  ' },
    { company: { name: 'Correios' }, name: 'PAC', price: false },
    { company: { name: 'Correios' }, name: 'PAC', price: [] },
    { ...raw('Correios', 'PAC', 10), error: 'Service unavailable' },
    raw('Correios', 'PAC', -1),
    raw('Correios', 'PAC', 21474836.48),
    { ...raw('Correios', 'PAC', 10), name: '' },
    { ...raw('Correios', 'PAC', 10), name: 123 },
    { ...raw('Correios', 'PAC', 10), company: { name: { unexpected: true } } },
  ];
  const result = await quoteShippingOptions(config, { postalCode: '01001000', pieces: 15 }, {
    request: async () => [...invalid, raw('Jadlog', '.Package', 18)],
  });
  assert.deepEqual(result.options.map(option => [option.company, option.price]), [['Jadlog', 18]]);
});

test('M2: an explicit zero price stays valid, null customizations fall back, and only public fields survive', async () => {
  const result = await quoteShippingOptions(config, { postalCode: '01001000', pieces: 15 }, {
    request: async () => [
      { ...raw('Correios', 'PAC', 0), privateMetadata: config.MELHOR_ENVIO_TOKEN },
      { ...raw('Jadlog', '.Package', 18), custom_price: null },
    ],
  });
  assert.deepEqual(result.options.map(option => option.price), [0, 18]);
  assert.ok(!JSON.stringify(result).includes(config.MELHOR_ENVIO_TOKEN));
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

test('M3: shared quote capacity rejects excess work without a queue and is released on success and failure', async () => {
  let resolveRequest;
  let calls = 0;
  const quoter = createShippingQuoter({ ...config, SHIPPING_QUOTE_CONCURRENCY: 1 }, {
    request: () => {
      calls++;
      return new Promise(resolve => { resolveRequest = resolve; });
    },
  });
  const input = { postalCode: '01001000', pieces: 15 };
  const first = quoter(input);
  await assert.rejects(quoter(input), { code: 'SHIPPING_BUSY', status: 503 });
  assert.equal(calls, 1);
  resolveRequest(providers);
  await first;
  const second = quoter(input);
  resolveRequest(null); // A falha de processamento também precisa devolver a vaga.
  await assert.rejects(second);
  const third = quoter(input);
  resolveRequest(providers);
  await third;
  assert.equal(calls, 3);
});

test('M3: capacity stays occupied across every volume of a heavy quote', async () => {
  const releases = [];
  const starts = Array.from({ length: 7 }, () => {
    let start;
    const promise = new Promise(resolve => { start = resolve; });
    return { promise, start };
  });
  const quoter = createShippingQuoter({ ...config, SHIPPING_QUOTE_CONCURRENCY: 1 }, {
    request: () => new Promise(resolve => {
      releases.push(() => resolve(providers));
      starts[releases.length - 1].start();
    }),
  });
  const pending = quoter({ postalCode: '01001000', pieces: 400 });
  // 3 volumes Jadlog + 4 volumes das demais transportadoras.
  for (let index = 0; index < 7; index++) {
    await starts[index].promise;
    assert.equal(releases.length, index + 1);
    await assert.rejects(quoter({ postalCode: '01001000', pieces: 15 }), { code: 'SHIPPING_BUSY' });
    releases[index]();
  }
  const result = await pending;
  assert.ok(result.options.some(option => option.company === 'Jadlog' && option.volumes === 3));
  assert.ok(result.options.some(option => option.company === 'Correios' && option.volumes === 4));
});
