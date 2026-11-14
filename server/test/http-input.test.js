import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import test from 'node:test';

function message(child, type, diagnostics = () => '', timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`worker did not send ${type}; pid=${child.pid}; exit=${child.exitCode}; ${diagnostics()}`)), timeoutMs);
    const onMessage = value => { if (value.type === type) done(null, value); };
    const onExit = (code, signal) => done(new Error(`worker exited: ${code ?? signal}`));
    const done = (error, value) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error); else resolve(value);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

test('H9/U5: malformed HTTP and aborted multipart cannot crash or exhaust the disposable API', { timeout: 60_000 }, async t => {
  let diagnostics = '';
  const child = fork(new URL('../test-support/http-input-worker.js', import.meta.url), {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: ['--max-old-space-size=192'],
    env: { ...process.env, DOTENV_CONFIG_PATH: 'nonexistent-security-test.env' },
  });
  child.stdout.on('data', data => { diagnostics += data; });
  child.stderr.on('data', data => { diagnostics += data; });
  child.on('message', value => { if (value.type === 'startup') diagnostics += `startup:${value.stage} at ${value.elapsedMs}ms\n`; });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.connected) child.disconnect();
    const killTimer = setTimeout(() => child.kill(), 3000);
    const [code] = await exited;
    clearTimeout(killTimer);
    // Windows may keep inherited pipe handles alive after the worker's exit.
    // They are no longer useful after process termination and must not retain
    // this test file's coordinator.
    child.stdout.destroy();
    child.stderr.destroy();
    assert.equal(code, 0, diagnostics);
  });
  // The former 10s budget also included cold native/module imports, which the
  // failure diagnostics located in import-app. HTTP deadlines stay at 5s.
  const ready = await message(child, 'ready', () => diagnostics, 30000);
  const base = `http://127.0.0.1:${ready.port}`;
  const request = (path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST', body, headers, signal: AbortSignal.timeout(5000),
  });
  const health = async () => {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, diagnostics);
    await response.text();
    assert.equal(child.exitCode, null, diagnostics);
  };

  await t.test('compressed JSON with trailing bytes cannot crash the process', async () => {
    for (const [encoding, compress] of [['gzip', gzipSync], ['br', brotliCompressSync]]) {
      const headers = { 'content-type': 'application/json', 'content-encoding': encoding };
      const valid = await request('/api/v1/unknown', compress(Buffer.from('{}')), headers);
      assert.equal(valid.status, 404);
      await valid.text();
      const malformed = await request('/api/v1/unknown', Buffer.concat([
        compress(Buffer.from('{}')), Buffer.alloc(32, 0xff),
      ]), headers);
      assert.ok([400, 404, 500].includes(malformed.status));
      await malformed.text();
      // Errors from a completed decoder can arrive after its HTTP response.
      await delay(50);
      await health();
    }
  });

  await t.test('the JSON size limit applies after decompression', async () => {
    const response = await request('/api/v1/unknown', gzipSync(Buffer.from(JSON.stringify({ value: 'x'.repeat(110_000) }))), {
      'content-type': 'application/json', 'content-encoding': 'gzip',
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
    await health();
  });

  await t.test('aborted multipart requests release the only upload slot', async () => {
    const boundary = 'security-test-boundary';
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nhello`;
    const contentType = `multipart/form-data; boundary=${boundary}`;
    const started = message(child, 'upload-started');
    const req = http.request(`${base}/test-upload`, { method: 'POST', headers: { 'content-type': contentType } });
    req.on('error', () => {}); // Expected local cancellation, not a server error.
    req.write(prefix);
    await started;
    const closed = message(child, 'upload-closed');
    req.destroy();
    await closed;
    await health();
    const response = await request('/test-upload', `${prefix}\r\n--${boundary}--\r\n`, { 'content-type': contentType });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { bytes: 5 });
  });

});
