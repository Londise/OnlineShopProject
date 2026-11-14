import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { setImmediate } from 'node:timers/promises';

// Kept separate from fast units: this regression creates a real cluster.
async function launch(t, args, onProgress = () => {}) {
  const child = fork(new URL('./run-integration.js', import.meta.url), args, {
    cwd: new URL('../', import.meta.url), execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '', stderr = '';
  const events = [];
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => { events.push(message); onProgress(message, child); });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', async code => {
      await setImmediate();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, stdout, stderr, events });
    });
  });
  // A test failure or its own deadline must request cleanup, not kill the DB owner.
  t.after(async () => {
    if (child.connected) child.send({ type: 'cancel' });
    await finished;
  });
  return finished;
}
async function assertCleaned(result) {
  const allocated = result.events.find(event => event.phase === 'allocated');
  assert.ok(allocated, result.stderr);
  await assert.rejects(access(allocated.directory), { code: 'ENOENT' });
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: allocated.port });
    socket.once('connect', () => { socket.destroy(); reject(new Error('test PostgreSQL still accepts connections')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('test PostgreSQL probe timed out')); });
  });
}
test('a failed integration exits nonzero after removing its disposable cluster', { timeout: 240000 }, async t => {
  const result = await launch(t, ['--test-name-pattern=launcher failure fixture', 'test-support/fixtures/failing-integration.js']);
  assert.match(result.stdout, /EXPECTED_LAUNCHER_FAILURE/, result.stderr);
  assert.equal(result.code, 1, 'a red integration must stop test:all');
  await assertCleaned(result);
});

test('the execution deadline stops test workers before removing their real cluster', { timeout: 240000 }, async t => {
  const result = await launch(t, ['--timeout-ms=1000', 'test-support/fixtures/hanging-integration.js']);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /test deadline/);
  const started = result.events.find(event => event.type === 'tests-started');
  assert.ok(started);
  assert.throws(() => process.kill(started.pid, 0), { code: 'ESRCH' });
  await assertCleaned(result);
});

test('cancelling during database startup also stops and removes the owned cluster', { timeout: 240000 }, async t => {
  const result = await launch(t, ['test-support/fixtures/failing-integration.js'], (event, child) => {
    if (event.phase === 'postgres-started') child.send({ type: 'cancel' });
  });
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /parent cancellation/);
  assert.equal(result.events.some(event => event.type === 'tests-started'), false);
  await assertCleaned(result);
});
