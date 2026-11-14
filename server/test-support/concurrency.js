import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { owner } from './integration.js';

// Release only once every runtime connection is actually waiting in PostgreSQL,
// not after an arbitrary sleep or after merely scheduling concurrent promises.
export async function behindLock(lock, operations) {
  let release, locked;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { locked = resolve; });
  const blocker = owner.$transaction(async tx => {
    await lock(tx);
    locked(); await gate;
  }, { timeout: 15000 });
  await Promise.race([ready, blocker]);
  const pending = Promise.allSettled(operations.map(operation => operation()));
  try {
    const deadline = Date.now() + 10000;
    for (;;) {
      const [{ waiting }] = await owner.$queryRaw`SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE usename = 'ferchu_test_runtime' AND wait_event_type = 'Lock'`;
      if (waiting >= operations.length) break;
      assert.ok(Date.now() < deadline, 'all database connections must reach the lock barrier');
      await setImmediate();
    }
  } finally { release(); await blocker; }
  return pending;
}
