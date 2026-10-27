import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Render Blueprint keeps the Free plan and omits unsupported paid lifecycle settings', () => {
  const yaml = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /^\s+plan: free$/m);
  assert.match(yaml, /^\s+rootDir: server$/m);
  assert.match(yaml, /^\s+healthCheckPath: \/health$/m);
  assert.doesNotMatch(yaml, /^\s*(?:maxShutdownDelaySeconds|preDeployCommand|initialDeployHook|disk|databases):/m);
});

test('Render runtime pins and the backend engine minimum agree on the patched Node release', () => {
  const version = readFileSync(new URL('../server/.node-version', import.meta.url), 'utf8').trim();
  const yaml = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../server/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../server/package-lock.json', import.meta.url), 'utf8'));
  assert.equal(version, '22.23.4');
  assert.ok(yaml.includes(`- key: NODE_VERSION\n        value: ${version}`));
  assert.equal(pkg.engines.node, `>=${version} <23`);
  assert.equal(lock.packages[''].engines.node, pkg.engines.node);
});
