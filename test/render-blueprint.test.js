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
