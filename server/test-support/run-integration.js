import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { terminateTestTree } from './process-tree.js';

let database, child, stopping, timer;
let phase = 'module-import';
let exitCode = 1;
const cancellation = new AbortController();
const notify = value => {
  if (process.connected) process.send(value, error => { if (error) cancel('parent channel closed'); });
};
const cancel = reason => {
  if (!cancellation.signal.aborted) {
    exitCode = 1;
    cancellation.abort(new Error(reason));
    console.error(`Integration cancelled: ${reason}`);
  }
};
const onMessage = message => { if (message?.type === 'cancel') cancel('parent cancellation'); };
const onDisconnect = () => cancel('parent disconnected');
const onSigint = () => cancel('SIGINT');
const onSigterm = () => cancel('SIGTERM');
process.on('message', onMessage);
process.on('disconnect', onDisconnect);
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);
const stopTests = () => {
  if (child && !stopping) stopping = terminateTestTree(child);
  // Register a rejection handler immediately; the failure is awaited in finally.
  stopping?.catch(() => {});
};
cancellation.signal.addEventListener('abort', stopTests);
try {
  const selected = process.argv.slice(2);
  const deadline = (name, fallback) => {
    const index = selected.findIndex(value => value.startsWith(`--${name}=`));
    if (index === -1) return fallback;
    const value = Number(selected.splice(index, 1)[0].split('=')[1]);
    if (!Number.isSafeInteger(value) || value < 1 || value > 3600000) throw new Error(`Invalid ${name}`);
    return value;
  };
  const timeoutMs = deadline('timeout-ms', 600000);
  const startupTimeoutMs = deadline('startup-timeout-ms', 110000);
  timer = setTimeout(() => cancel(`startup deadline (${phase})`), startupTimeoutMs);
  const { startTestDatabase } = await import('./postgres.js');
  database = await startTestDatabase({ signal: cancellation.signal,
    onProgress: progress => { phase = progress.phase; notify({ type: 'database', ...progress }); } });
  clearTimeout(timer);
  cancellation.signal.throwIfAborted();
  const files = selected.some(argument => !argument.startsWith('--')) ? selected
    : [...selected, ...(await readdir(new URL('../test/integration/', import.meta.url)))
    .filter(name => name.endsWith('.test.js')).map(name => `test/integration/${name}`)];
  if (!files.length) throw new Error('No integration tests were found.');
  cancellation.signal.throwIfAborted(); // cancellation can arrive during readdir
  child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: database.environment, stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  notify({ type: 'tests-started', pid: child.pid });
  timer = setTimeout(() => cancel('test deadline'), timeoutMs);
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  if (cancellation.signal.aborted) exitCode = 1;
} catch (error) {
  console.error(error);
} finally {
  clearTimeout(timer);
  try { await stopping; }
  catch (error) { exitCode = 1; console.error('Cannot stop test process tree:', error.code); }
  try { await database?.close(); }
  catch (error) { exitCode = 1; console.error(error); }
  process.off('message', onMessage);
  process.off('disconnect', onDisconnect);
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
}
// embedded-postgres registers a beforeExit hook that otherwise forces code 0.
// All owned resources and child output have been drained before this exit.
process.exit(exitCode);
