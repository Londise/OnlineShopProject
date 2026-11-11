import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('checkout keeps its own header layout independent of the storefront header', async () => {
  const checkout = await readFile(new URL('../src/pages/Checkout.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(checkout, /<header className="checkout-header">/);
  assert.match(checkout, /className="back-link checkout-back-link"/);
  const header = css.match(/\.checkout \.checkout-header\s*\{([^}]+)\}/)?.[1];
  assert.ok(header, 'checkout must not depend on the storefront header selector');
  assert.match(header, /display:\s*flex/);
  assert.match(header, /align-items:\s*center/);
  assert.match(header, /justify-content:\s*space-between/);
  const back = css.match(/\.checkout-header \.checkout-back-link\s*\{([^}]+)\}/)?.[1];
  assert.match(back, /min-height:\s*44px/);
  assert.match(back, /white-space:\s*nowrap/);
});
