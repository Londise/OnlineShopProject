import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const safeProcessEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|home|userprofile|appdata|localappdata|systemdrive)$/i.test(key)));
function configure(overrides = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js'); process.stdout.write('accepted')"], {
    cwd, timeout: 10000, encoding: 'utf8', env: {
      ...safeProcessEnvironment, NODE_ENV: 'test', DOTENV_CONFIG_PATH: 'no-test-dotenv',
      DATABASE_URL: 'postgresql://fixture:private-test-password@localhost:5432/test?schema=app', ...overrides,
    },
  });
}
test('P4: valid local configuration and a production TLS configuration load without exposing credentials', () => {
  for (const overrides of [{}, { NODE_ENV: 'production', DATABASE_URL: 'postgresql://fixture:private-test-password@db.example.test:5432/test?schema=app&sslmode=require', FRONTEND_ORIGIN: 'https://shop.example.test', ORIGIN_PROXY_SECRET: 'test-only-proxy-value-'.repeat(3) }]) {
    const result = configure(overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'accepted');
  }
});
test('P4: invalid database configuration refuses startup with credential-free guidance', () => {
  for (const DATABASE_URL of [
    'mysql://fixture:private-test-password@localhost/test',
    'postgresql://fixture:private-test-password@localhost/test?schema=public',
    'postgresql://fixture:private-test-password@db.example.test/test?schema=app',
  ]) {
    const result = configure({ DATABASE_URL });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL/);
    assert.ok(!result.stderr.includes('private-test-password'));
  }
});
test('P4: production refuses HTTP origins or missing proxy authentication', () => {
  for (const overrides of [{ FRONTEND_ORIGIN: 'http://shop.example.test', ORIGIN_PROXY_SECRET: 'test-only-proxy-value-'.repeat(3) }, { FRONTEND_ORIGIN: 'https://shop.example.test' }]) {
    const result = configure({ NODE_ENV: 'production', ...overrides });
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('private-test-password'));
  }
});
test('P4: out-of-range resource budgets fail before starting the API', () => {
  for (const overrides of [{ LOG_QUEUE_MAX_ENTRIES: '0' }, { LOG_QUEUE_MAX_BYTES: '1' }, { LOG_FLUSH_MS: '-1' }, { LOG_DEBUG_SAMPLE: '2' }, { MEDIA_UPLOAD_CONCURRENCY: '5' }]) {
    const result = configure(overrides);
    assert.equal(result.status, 1, JSON.stringify(overrides));
    assert.match(result.stderr, /Invalid server environment/);
  }
});
