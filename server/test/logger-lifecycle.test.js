import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick, setTimeout as wait } from 'node:timers/promises';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=app';
const { createBufferedLogger, redactData, passesFilters } = await import('../src/lib/logger.js');
const settings = { minLevel: 10, sample: 1, bufferMax: 100, flushMs: 10, mirror: false, queueMaxEntries: 1000, queueMaxBytes: 2_097_152 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('shutdown waits for an active flush and drains entries queued behind it exactly once', async () => {
  const first = deferred();
  const batches = [];
  const logger = createBufferedLogger({ settings, autoFlush: false, sink: async batch => {
    batches.push(batch.map(entry => entry.message));
    if (batches.length === 1) await first.promise;
  }, deadSink: async () => {} });
  logger.log('info', 'test.event', 'first');
  const active = logger.flush();
  await tick();
  logger.log('info', 'test.event', 'second');
  let closed = false;
  const closing = logger.close();
  assert.strictEqual(logger.close(), closing);
  closing.then(() => { closed = true; });
  await tick();
  assert.equal(closed, false);
  first.resolve();
  await Promise.all([active, closing]);
  assert.deepEqual(batches, [['first'], ['second']]);
  assert.equal(logger.log('info', 'test.event', 'after close'), false);
});

test('queue count includes an in-flight batch and cannot grow indefinitely', async () => {
  const gate = deferred();
  const output = [];
  const logger = createBufferedLogger({ settings: { ...settings, queueMaxEntries: 2 }, autoFlush: false,
    sink: async () => gate.promise, deadSink: async () => {}, output: record => output.push(record) });
  logger.log('info', 'test.event', 'first');
  const flushing = logger.flush();
  await tick();
  assert.equal(logger.log('info', 'test.event', 'second'), true);
  assert.equal(logger.log('info', 'test.event', 'third'), false);
  assert.equal(logger.stats().dropped, 1);
  assert.equal(logger.stats().active + logger.stats().queued, 2);
  assert.ok(output.some(entry => entry.event === 'logger.queue_full'));
  gate.resolve();
  await flushing;
  await logger.close();
  assert.equal(logger.stats().bytes, 0);
});

test('queue bytes have a hard bound, and failures in both sinks do not throw', async () => {
  const output = [];
  const logger = createBufferedLogger({ settings: { ...settings, queueMaxBytes: 600 }, autoFlush: false,
    sink: async () => { throw new Error('password=private-test'); },
    deadSink: async () => { throw new Error('another secret'); }, output: entry => output.push(entry) });
  assert.equal(logger.log('info', 'test.event', 'x'.repeat(1000)), false);
  assert.ok(logger.stats().bytes <= 600);
  assert.equal(logger.log('info', 'test.event', 'small'), true);
  await assert.doesNotReject(logger.flush());
  assert.ok(output.some(entry => entry.event === 'logger.persistence_failed'));
  assert.equal(JSON.stringify(output).includes('private-test'), false);
  await logger.close();
});

test('message, stack, data and dead-letter reasons are sanitized before leaving the logger', async () => {
  const output = [];
  const dead = [];
  const logger = createBufferedLogger({ settings: { ...settings, mirror: true }, autoFlush: false,
    sink: async () => { throw new Error('postgresql://user:private-test@host.invalid/db'); },
    deadSink: async (batch, reason) => dead.push({ batch, reason }), output: entry => output.push(entry) });
  logger.log('error', 'test.event', 'contact private@example.invalid token=private-test', {
    stack: 'Error: Bearer private-test\npostgresql://user:private-test@host.invalid/db',
    data: { secret: [1, 2, 3], nested: { password: 12345 }, email: 'private@example.invalid' },
  });
  await logger.flush();
  const serialized = JSON.stringify({ output, dead });
  assert.equal(serialized.includes('private-test'), false);
  assert.equal(serialized.includes('private@example.invalid'), false);
  assert.equal(output[0].data.secret, '[REDACTED]');
  assert.equal(output[0].data.nested.password, '[REDACTED]');
  await logger.close();
});

test('timer flushes low traffic, malformed data never fails business code, zero sampling is exact', async () => {
  const batches = [];
  const logger = createBufferedLogger({ settings, sink: async entries => batches.push(entries), deadSink: async () => {}, output: () => {} });
  logger.log('info', 'test.event', 'one');
  await wait(25);
  await logger.close();
  assert.equal(batches.flat().length, 1);
  assert.equal(passesFilters(20, { minLevel: 10, sample: 0 }, () => 0), false);
  const circular = {}; circular.self = circular;
  assert.doesNotThrow(() => redactData(circular));
  assert.equal(redactData({ token: { value: 'private' } }).token, '[REDACTED]');
});
