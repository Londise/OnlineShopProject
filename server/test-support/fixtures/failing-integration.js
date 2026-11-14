import test from 'node:test';
import assert from 'node:assert/strict';
import { owner, closeDatabase } from '../integration.js';

// Deliberately red fixture: only the launcher regression test selects it.
test('launcher failure fixture', async t => {
  t.after(closeDatabase);
  const [row] = await owner.$queryRaw`SELECT current_setting('data_directory') AS directory`;
  console.log(`HARNESS_DIRECTORY=${JSON.stringify(row.directory)}`);
  assert.fail('EXPECTED_LAUNCHER_FAILURE');
});
