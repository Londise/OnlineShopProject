import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const directory = await mkdtemp(join(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir(), 'ferchu-build-'));
const marker = 'FERCHU_SERVER_ONLY_CANARY_8c9492e9';
const canaries = { ORIGIN_PROXY_SECRET: marker, RENDER_BACKEND_URL: 'https://FERCHU_PRIVATE_BACKEND_CANARY.example.test' };
const originals = Object.fromEntries(Object.keys(canaries).map(key => [key, process.env[key]]));
Object.assign(process.env, canaries);
try {
  await build({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envFile: false,
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
    build: { outDir: directory, emptyOutDir: true },
  });
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  assert.match(html, /<script[^>]+type="module"/);
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(references.some(reference => reference.endsWith('.js')));
  assert.ok(references.some(reference => reference.endsWith('.css')));
  for (const reference of references) {
    if (/^(?:https?:|data:)/.test(reference)) continue;
    const asset = resolve(directory, reference.replace(/^\//, '').split(/[?#]/)[0]);
    const path = relative(directory, asset);
    assert.ok(!path.startsWith('..') && !isAbsolute(path), 'HTML asset must stay inside build');
    assert.ok((await readFile(asset)).length > 0, `HTML asset must exist: ${reference}`);
  }
  const files = await readdir(join(directory, 'assets'));
  assert.ok(files.some(name => name.endsWith('.js')));
  for (const name of files) {
    const content = await readFile(join(directory, 'assets', name), 'utf8');
    for (const value of Object.values(canaries)) assert.ok(!content.includes(value), 'server-only configuration must not reach browser assets');
  }
  for (const value of Object.values(canaries)) assert.ok(!html.includes(value));
  console.log('Production build verified; server-only canary absent from browser assets.');
} finally {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(directory, { recursive: true, force: true });
}
