import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createShutdown } from '../src/lib/shutdown.js';

test('shutdown closes HTTP, awaits log drain, then disconnects DB; repeated signals are idempotent', async () => {
  const calls = [];
  let drain;
  const draining = new Promise(resolve => { drain = resolve; });
  const shutdown = createShutdown({
    server: { close: done => { calls.push('http'); done(); } },
    flush: async () => { calls.push('flush'); await draining; },
    disconnect: async () => calls.push('db'), exit: code => calls.push(`exit:${code}`),
  });
  const first = shutdown('SIGTERM');
  assert.strictEqual(shutdown('SIGINT'), first);
  await tick();
  assert.deepEqual(calls, ['http', 'flush']);
  drain();
  await first;
  assert.deepEqual(calls, ['http', 'flush', 'db', 'exit:0']);
});

test('a stuck request cannot exceed the shutdown deadline', async t => {
  const output = [];
  t.mock.method(console, 'error', value => output.push(value));
  const calls = [];
  const shutdown = createShutdown({ server: { close: () => {}, closeAllConnections: () => calls.push('force-close') },
    flush: async () => calls.push('flush'), disconnect: async () => calls.push('db'),
    timeoutMs: 10, exit: code => calls.push(`exit:${code}`) });
  await shutdown('SIGTERM');
  assert.deepEqual(calls, ['force-close', 'exit:1']);
  assert.equal(JSON.parse(output[0]).event, 'api.shutdown_failed');
});
