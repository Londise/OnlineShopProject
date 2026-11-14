import { cp, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'ferchu-sensitivity-'));
const scenarios = [
  { file: 'src/utils/cart.js', test: 'test/cart.test.js', from: 'price: variant.price ?? product.price,', to: 'price: variant.price || product.price,' },
  { file: 'src/services/http.js', test: 'test/http.test.js', from: "const maxRetries = ['GET', 'HEAD'].includes(method) ? readRetries : 0;", to: 'const maxRetries = readRetries;' },
  { file: 'src/config/media.js', test: 'test/media.test.js', from: 'String(Math.min(targetWidth, originalWidth))', to: 'String(targetWidth)' },
];
try {
  await cp(join(root, 'src'), join(temp, 'src'), { recursive: true });
  await cp(join(root, 'test'), join(temp, 'test'), { recursive: true });
  await cp(join(root, 'package.json'), join(temp, 'package.json'));
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'junction');
  for (const scenario of scenarios) {
    const path = join(temp, scenario.file);
    const original = await readFile(path, 'utf8');
    if (!original.includes(scenario.from)) throw new Error(`Mutation target changed: ${scenario.file}`);
    const run = () => spawnSync(process.execPath, ['--test', scenario.test], { cwd: temp, encoding: 'utf8', timeout: 30000 });
    const baseline = run();
    if (baseline.status !== 0) throw new Error(`Baseline failed: ${scenario.test}\n${baseline.stdout}\n${baseline.stderr}`);
    await writeFile(path, original.replace(scenario.from, scenario.to));
    try {
      const mutant = run();
      if (mutant.status !== 1 || !mutant.stdout.includes('ERR_ASSERTION')) throw new Error(`Mutation was not caught by an assertion: ${scenario.file}\n${mutant.stdout}\n${mutant.stderr}`);
      console.log(`Caught regression: ${scenario.file} → ${scenario.test}`);
    } finally { await writeFile(path, original); }
  }
} finally {
  // Only the private directory created by this invocation is removed.
  await rm(temp, { recursive: true, force: true });
}
