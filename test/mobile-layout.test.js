import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile sections use compact spacing without inheriting desktop margins', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media(max-width:700px) {\n    .storefront-header'));
  const section = mobile.match(/\.section\s*\{([^}]+)\}/)?.[1];
  assert.match(section, /margin:\s*40px auto/);
  assert.match(section, /padding:\s*20px 18px 0/);
  assert.doesNotMatch(mobile, /padding-top:\s*75px/);
  assert.match(mobile, /\.products\s*\{\s*padding-bottom:\s*40px/);
  assert.match(css, /\.section\s*\{[^}]*margin:\s*95px auto/s);
});

test('mobile benefits and navigation are readable while primary header actions stay larger', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media(max-width:700px) {\n    .storefront-header'));
  const fontSize = selector => {
    const block = mobile.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`))?.[1];
    return Number(block?.match(/font-size:\s*([\d.]+)px/)?.[1]);
  };
  assert.equal(fontSize('\\.benefits b'), 11);
  assert.equal(fontSize('\\.benefits small'), 10.5);
  assert.equal(fontSize('\\.storefront-nav'), 13);
  assert.ok(fontSize('\\.storefront-nav') < fontSize('\\.header-account'));
  assert.ok(fontSize('\\.storefront-nav') < fontSize('\\.logo'));
});
