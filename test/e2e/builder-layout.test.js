import { test as base, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { catalogProduct } from '../support/fixtures.js';

const test = base.extend({
  storefront: [async ({}, use) => {
    const vite = await createServer({
      root: fileURLToPath(new URL('../../', import.meta.url)),
      configFile: false,
      envFile: false,
      define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:3001/api/v1') },
      server: { host: '127.0.0.1', port: 0 },
    });
    try {
      await vite.listen();
      await use(vite.resolvedUrls.local[0]);
    } finally {
      vite.ws.close();
      vite.httpServer.closeAllConnections();
      await vite.close();
    }
  }, { scope: 'worker' }],
});

async function openBuilder(page, origin, count) {
  const product = catalogProduct({ options: Array.from({ length: count }, (_, index) => ({
    ...catalogProduct().options[0], id: `color-${index}`, name: `Cor ${index + 1}`,
    variants: ['P', 'M', 'G', 'GG', 'EXG'].map(size => ({
      id: `variant-${index}-${size}`, sku: `LINHO-${index}-${size}`, size,
      priceCents: size === 'EXG' ? 3800 : 3600, active: true, available: 10,
    })),
  })) });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/')) {
      const body = url.pathname.endsWith('/products') ? { products: [product] }
        : url.pathname.endsWith('/auth/me') ? { user: null }
          : url.pathname.endsWith('/banners') ? { banners: [] } : { faviconUrl: null };
      return route.fulfill({ json: body });
    }
    return url.origin === new URL(origin).origin ? route.continue() : route.abort();
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Montar pedido', exact: true }).first().click();
  return page.getByRole('dialog');
}

for (const [width, height, count, rows] of [[1366, 768, 10, 5], [1366, 650, 14, 7], [800, 768, 8, 5]]) {
  test(`desktop ${width}x${height}: ${count} colors flow down beside sizes and the add button stays visible`, async ({ page, storefront }) => {
    await page.setViewportSize({ width, height });
    const dialog = await openBuilder(page, storefront, count);
    const dots = await dialog.locator('.color-dot').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    }));
    expect(dots[rows - 1].x).toBe(dots[0].x);
    expect(dots[rows].x).toBeGreaterThan(dots[0].x);
    expect(dots[rows].y).toBe(dots[0].y);
    expect(Math.min(...dots.map(dot => dot.width))).toBeGreaterThanOrEqual(44);
    const colors = await dialog.locator('.color-row').boundingBox();
    const sizes = await dialog.locator('.sizes').boundingBox();
    expect(sizes.x).toBeGreaterThanOrEqual(colors.x + colors.width);
    const sectionStyles = await dialog.evaluate(el => {
      const colors = el.querySelector('.color-row');
      const divider = getComputedStyle(colors, '::after');
      const colorBounds = colors.getBoundingClientRect();
      const sizesBounds = el.querySelector('.sizes').getBoundingClientRect();
      const title = selector => {
        const style = getComputedStyle(el.querySelector(selector));
        return { color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
      };
      return {
        dividerWidth: divider.width,
        dividerCenter: colorBounds.right - parseFloat(divider.right) - parseFloat(divider.width) / 2,
        gapCenter: (colorBounds.right + sizesBounds.left) / 2,
        colorsTitle: title('.color-heading>span'),
        sizesTitle: title('.sizes>div:first-child>span'),
        sizeFont: title('.size-row strong').fontSize,
        priceFont: title('.size-row strong small').fontSize,
        hintFont: title('.sizes>div:first-child small').fontSize,
      };
    });
    expect(sectionStyles.dividerWidth).toBe('1px');
    expect(Math.abs(sectionStyles.dividerCenter - sectionStyles.gapCenter)).toBeLessThanOrEqual(1);
    expect(sectionStyles.colorsTitle).toEqual(sectionStyles.sizesTitle);
    expect(sectionStyles.colorsTitle.fontWeight).toBe('500');
    expect(sectionStyles.colorsTitle.color).toBe('rgb(0, 0, 0)');
    expect(sectionStyles.sizeFont).toBe('15px');
    expect(sectionStyles.priceFont).toBe('13px');
    expect(sectionStyles.hintFont).toBe('12px');
    expect(parseFloat(sectionStyles.hintFont)).toBeLessThan(parseFloat(sectionStyles.sizesTitle.fontSize));
    const button = dialog.getByRole('button', { name: 'Adicionar ao pedido', exact: true });
    const bounds = await button.boundingBox();
    const modal = await dialog.boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(modal.y + modal.height);
    expect(bounds.y + bounds.height).toBeLessThan(height);
    expect(await dialog.evaluate(el => el.scrollTop)).toBe(0);
    expect(await button.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || el.contains(hit);
    })).toBe(true);
    await dialog.getByRole('textbox', { name: 'Quantidade tamanho EXG', exact: true }).fill('1');
    await dialog.getByRole('button', { name: 'Adicionar 1 peça', exact: true }).click();
    await expect(page.getByText('Cor 1 · EXG')).toBeVisible();
  });
}

test('mobile keeps colors above sizes without horizontal overflow', async ({ page, storefront }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const dialog = await openBuilder(page, storefront, 10);
  const colors = await dialog.locator('.color-row').boundingBox();
  const sizes = await dialog.locator('.sizes').boundingBox();
  expect(sizes.y).toBeGreaterThanOrEqual(colors.y + colors.height);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Cor 10', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cor 10', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
