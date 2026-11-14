import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, owner, createApp, resetDatabase, closeDatabase, sessionFixture, serve } from '../../test-support/integration.js';
import { flush, log } from '../../src/lib/logger.js';

beforeEach(resetDatabase);
after(closeDatabase);
const ts = new Date('2026-11-11T12:00:00Z');
const trace = 'ac6eb1a3-4e6f-4000-9000-cada5983d31c';
async function entry(message, { level = 30, service = 'api' } = {}) {
  await prisma.$executeRaw`INSERT INTO app.log_entry(ts, level, service, event, message, trace_id, data)
    VALUES (${ts}, ${level}, ${service}, 'fixture.event', ${message}, ${trace}::uuid, '{}'::jsonb)`;
}

test('L8: LIKE metacharacters and injection text are searched as data, not as SQL', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  await entry('literal %_\\'); await entry('ordinary'); await entry("' OR true --");
  for (const [q, expected] of [['%_\\', ['literal %_\\']], ["' OR true --", ["' OR true --"]]]) {
    const response = await api.request(`/api/v1/admin/logs?q=${encodeURIComponent(q)}`, { headers: { cookie: admin.cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).entries.map(entry => entry.message), expected);
  }
});

test('L8/L9: timestamp ties paginate by ID without duplicates and trace is chronological', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  for (const message of ['first', 'second', 'third']) await entry(message);
  const request = query => api.request(`/api/v1/admin/logs?event=fixture.event&${query}`, { headers: { cookie: admin.cookie } });
  const first = await (await request('limit=2')).json();
  assert.deepEqual(first.entries.map(entry => entry.message), ['third', 'second']);
  assert.ok(first.nextCursor);
  const next = await (await request(`limit=2&cursor=${first.nextCursor}`)).json();
  assert.deepEqual(next.entries.map(entry => entry.message), ['first']); assert.equal(next.nextCursor, null);
  const traceResponse = await api.request(`/api/v1/admin/logs/trace/${trace}`, { headers: { cookie: admin.cookie } });
  assert.deepEqual((await traceResponse.json()).entries.map(entry => entry.message), ['first', 'second', 'third']);
  assert.equal((await request('cursor=invalid')).status, 422);
});

test('L8: combined exact level, service and inclusive dates exclude other log entries', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  await entry('match', { level: 40, service: 'worker' });
  await entry('wrong level', { level: 50, service: 'worker' });
  await entry('wrong service', { level: 40, service: 'api' });
  const params = new URLSearchParams({ level: 'warn', service: 'worker', event: 'fixture.event', from: ts.toISOString(), to: ts.toISOString() });
  const response = await api.request(`/api/v1/admin/logs?${params}`, { headers: { cookie: admin.cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries.map(entry => entry.message), ['match']);
});

test('L5/L6: concurrent HTTP requests persist their own actor/trace/status and omit query secrets', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const traceA = 'ac6eb1a3-4e6f-4000-9000-cada5983d31c';
  const traceB = 'bde8f6ac-21c2-4000-9000-dffe0157ec5d';
  const [first, second] = await Promise.all([
    api.request('/api/v1/products?token=sensitive-query', { headers: { 'x-trace-id': traceA, cookie: admin.cookie } }),
    api.request('/api/v1/missing', { headers: { 'x-trace-id': traceB } }),
  ]);
  await first.text(); await second.text(); await flush();
  const entries = await prisma.$queryRaw`SELECT trace_id, request_id, actor_id, route, status, duration_ms, message
    FROM app.log_entry WHERE event = 'http.request' AND trace_id IN (${traceA}::uuid, ${traceB}::uuid) ORDER BY status`;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].trace_id, traceA); assert.equal(entries[0].actor_id, admin.user.id);
  assert.equal(entries[0].route, 'GET /api/v1/products'); assert.equal(entries[0].status, 200);
  assert.equal(entries[1].trace_id, traceB); assert.equal(entries[1].actor_id, null); assert.equal(entries[1].status, 404);
  assert.notEqual(entries[0].request_id, entries[1].request_id);
  assert.ok(entries.every(entry => entry.duration_ms >= 0));
  assert.ok(!JSON.stringify(entries).includes('sensitive-query'));
  const invalid = await api.request('/api/v1/products', { headers: { 'x-trace-id': 'invalid' } });
  assert.match(invalid.headers.get('x-trace-id'), /^[0-9a-f-]{36}$/);
});

test('L5/L9: actual SQL sink failure persists a readable dead-letter batch without throwing to the caller', async t => {
  await owner.$executeRawUnsafe('REVOKE INSERT ON app.log_entry FROM ferchu_backend');
  try {
    assert.equal(log('error', 'fixture.failure', 'A normal message with token=private-test'), true);
    await assert.doesNotReject(flush());
    const rows = await prisma.$queryRaw`SELECT payload, fail_reason FROM app.log_dead`;
    assert.equal(rows.length, 1); assert.equal(rows[0].payload[0].event, 'fixture.failure');
    assert.ok(!JSON.stringify(rows).includes('private-test'));
  } finally { await owner.$executeRawUnsafe('GRANT INSERT ON app.log_entry TO ferchu_backend'); }
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  const response = await api.request('/api/v1/admin/logs/dead', { headers: { cookie: admin.cookie } });
  assert.equal(response.status, 200);
  const { batches } = await response.json();
  assert.equal(typeof batches[0].id, 'string'); assert.equal(batches[0].payload[0].event, 'fixture.failure');
});

test('H8/L6: asynchronous database failure returns sanitized JSON and persists the original trace on its diagnostic', async t => {
  const api = await serve(createApp({ database: { $queryRaw: async () => { throw new Error('Unavailable password=private-test'); } } }));
  t.after(api.close);
  const response = await api.request('/health', { headers: { 'x-trace-id': trace } });
  assert.equal(response.status, 500); assert.equal(response.headers.get('x-trace-id'), trace);
  assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
  await flush();
  const entries = await prisma.$queryRaw`SELECT trace_id, message FROM app.log_entry WHERE event = 'http.unhandled'`;
  assert.equal(entries.length, 1); assert.equal(entries[0].trace_id, trace);
  assert.ok(!entries[0].message.includes('private-test'));
});

test('L8/L9: exact level lists, validation and bounded trace/dead queries execute against real rows', async t => {
  const admin = await sessionFixture(); const api = await serve(); t.after(api.close);
  for (const [message, level] of [['debug', 20], ['warn', 40], ['error', 50]]) await entry(message, { level });
  const exact = await api.request('/api/v1/admin/logs?level=warn,50&event=fixture.event', { headers: { cookie: admin.cookie } });
  assert.deepEqual((await exact.json()).entries.map(row => row.message), ['error', 'warn']);
  for (const query of ['level=invalid', 'from=not-a-date', 'limit=201', 'traceId=invalid', 'service=INVALID SERVICE']) {
    assert.equal((await api.request(`/api/v1/admin/logs?${encodeURI(query)}`, { headers: { cookie: admin.cookie } })).status, 422);
  }
  assert.equal((await api.request('/api/v1/admin/logs/trace/invalid', { headers: { cookie: admin.cookie } })).status, 422);
  await prisma.$executeRaw`INSERT INTO app.log_entry(ts, level, service, event, message, trace_id)
    SELECT ${ts}::timestamptz + i * interval '1 second', 30, 'worker', 'bounded.trace', i::text,
      '11111111-1111-4111-8111-111111111111'::uuid FROM generate_series(1, 505) i`;
  const traced = await (await api.request('/api/v1/admin/logs/trace/11111111-1111-4111-8111-111111111111', { headers: { cookie: admin.cookie } })).json();
  assert.equal(traced.entries.length, 500);
  assert.equal(traced.entries[0].message, '1'); assert.equal(traced.entries[499].message, '500');
  await prisma.$executeRaw`INSERT INTO app.log_dead(failed_at, fail_reason, payload)
    SELECT ${ts}::timestamptz + i * interval '1 second', i::text, '[]'::jsonb FROM generate_series(1, 55) i`;
  const dead = await (await api.request('/api/v1/admin/logs/dead', { headers: { cookie: admin.cookie } })).json();
  assert.equal(dead.batches.length, 50); assert.equal(dead.batches[0].failReason, '55'); assert.equal(dead.batches[49].failReason, '6');
  assert.ok(dead.batches.every(batch => typeof batch.id === 'string'));
});
