import test from 'node:test';

// Only selected by launcher.test.js. Keep the per-file worker alive until its
// coordinator's deadline terminates the complete process tree.
test('launcher timeout fixture', async t => {
  const timer = setInterval(() => {}, 1000);
  t.after(() => clearInterval(timer));
  await new Promise(() => {});
});
