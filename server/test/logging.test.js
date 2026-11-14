import '../test-support/unit-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
const { createBufferedLogger, passesFilters } = await import('../src/lib/logger.js');
const { runWithTrace } = await import('../src/lib/trace-context.js');
const settings = { minLevel: 10, sample: 1, bufferMax: 100, flushMs: 250, mirror: false, queueMaxEntries: 1000, queueMaxBytes: 2097152 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('L1/L4: all output boundaries receive redacted, bounded data even when the primary sink fails', async t => {
  const output = [], dead = [];
  const logger = createBufferedLogger({ settings: { ...settings, mirror: true }, autoFlush: false,
    sink: async () => { throw new Error('postgresql://user:private-test@host.invalid/db'); },
    deadSink: async (entries, reason) => dead.push({ entries, reason }), output: entry => output.push(entry),
  });
  t.after(logger.close);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(logger.log('error', 'test.event', 'contact private@example.invalid token=private-test', {
    stack: 'Bearer private-test postgresql://user:private-test@host.invalid/db',
    data: { password: 'private-test', nested: { authorization: 'Bearer private-test' },
      cpf: '123.456.789-00', card: '4111 1111 1111 1111', ordinary: 'public note', cyclic },
  }), true);
  await logger.flush();
  const serialized = JSON.stringify({ output, dead });
  for (const sensitive of ['private-test', 'private@example.invalid', '123.456.789-00', '4111 1111 1111 1111']) assert.ok(!serialized.includes(sensitive));
  assert.equal(dead.length, 1);
  assert.equal(dead[0].entries[0].data.ordinary, 'public note');
  assert.equal(dead[0].entries[0].data.password, '[REDACTED]');
  assert.ok(serialized.includes('[Truncated]'));
});

test('L2: the minimum level applies everywhere, while sampling applies only to debug', () => {
  for (const [level, minLevel, sample, random, accepted] of [
    [20, 30, 1, 0, false], [20, 10, 0, 0, false], [20, 10, 1, 1, true],
    [20, 10, .5, .49, true], [20, 10, .5, .5, false], [30, 10, 0, .9, true], [50, 10, 0, .9, true],
  ]) assert.equal(passesFilters(level, { minLevel, sample }, () => random), accepted);
});

test('L3/L7: close waits for in-flight work, drains later entries once, and rejects new logs', async () => {
  const started = deferred(), release = deferred(), batches = [];
  const logger = createBufferedLogger({ settings, autoFlush: false, sink: async entries => {
    batches.push(entries.map(entry => entry.message));
    if (batches.length === 1) { started.resolve(); await release.promise; }
  } });
  logger.log('info', 'test.event', 'first');
  const flushing = logger.flush(); await started.promise;
  logger.log('info', 'test.event', 'second');
  let closed = false;
  const closing = logger.close(); closing.then(() => { closed = true; });
  assert.equal(logger.close(), closing);
  await setImmediate(); assert.equal(closed, false);
  release.resolve(); await Promise.all([flushing, closing]);
  assert.deepEqual(batches, [['first'], ['second']]);
  assert.equal(logger.log('info', 'test.event', 'after close'), false);
});

test('L3: entry and byte caps include the batch held by an external sink', async t => {
  for (const limit of ['entries', 'bytes']) {
    const started = deferred(), release = deferred(), output = [];
    const logger = createBufferedLogger({ settings: { ...settings, queueMaxEntries: limit === 'entries' ? 2 : 1000, queueMaxBytes: limit === 'bytes' ? 600 : 2097152 }, autoFlush: false,
      sink: async () => { started.resolve(); await release.promise; }, output: entry => output.push(entry),
    });
    t.after(logger.close);
    logger.log('info', 'test.event', 'first');
    const flushing = logger.flush(); await started.promise;
    try {
      assert.equal(logger.log('info', 'test.event', 'second'), true);
      assert.equal(logger.log('info', 'test.event', 'third'), false);
      assert.equal(logger.stats().dropped, 1);
      assert.ok(output.some(entry => entry.event === 'logger.queue_full'));
    } finally { release.resolve(); await flushing; }
    assert.equal(logger.stats().bytes, 0);
  }
});

test('L4: failure of persistence, dead-letter and diagnostic output cannot throw into business code', async t => {
  const logger = createBufferedLogger({ settings, autoFlush: false,
    sink: async () => { throw new Error('sink failed'); }, deadSink: async () => { throw new Error('dead sink failed'); },
    output: () => { throw new Error('stdout failed'); },
  });
  t.after(logger.close);
  assert.equal(logger.log('error', 'test.event', 'one'), true);
  await assert.doesNotReject(logger.flush());
  assert.equal(logger.stats().dropped, 1);
});

test('L3/L6: threshold flush preserves the actual asynchronous trace context', async t => {
  const received = deferred();
  const logger = createBufferedLogger({ settings: { ...settings, bufferMax: 2 }, autoFlush: false, sink: received.resolve });
  t.after(logger.close);
  await Promise.all(['one', 'two'].map(async id => runWithTrace({ traceId: id, requestId: `request-${id}`, service: 'worker' }, async () => {
    await setImmediate(); logger.log('info', 'test.event', id);
  })));
  const batch = await received.promise;
  assert.deepEqual(batch.map(entry => [entry.message, entry.traceId, entry.requestId, entry.service]), [
    ['one', 'one', 'request-one', 'worker'], ['two', 'two', 'request-two', 'worker'],
  ]);
});

test('L3: the timer flushes low traffic without an explicit flush call', { timeout: 1000 }, async t => {
  const received = deferred();
  const logger = createBufferedLogger({ settings: { ...settings, flushMs: 1 }, sink: received.resolve });
  t.after(logger.close);
  logger.log('info', 'test.event', 'low traffic');
  const entries = await received.promise;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'low traffic');
});
