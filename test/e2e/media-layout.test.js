import { test as base, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { admin, catalogProduct } from '../support/fixtures.js';

const test = base.extend({
  storefront: [async ({}, use) => {
    const vite = await createServer({
      root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, envFile: false,
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

for (const width of [1366, 1024, 375]) {
  test(`image management aligns mixed aspect ratios, controls and actions at ${width}px`, async ({ page, storefront }) => {
    await page.setViewportSize({ width, height: 768 });
    const assets = [[600, 900], [600, 600], [900, 600]].map(([w, h], index) => ({
      id: `asset-${index}`, url: `/fixture-media/${w}-${h}.svg`, purpose: 'product',
      altText: index ? 'Foto da coleção' : 'products/pantacourt_linho/pantacourtlinhomodelo3.jpeg',
      width: w, height: h, byteSize: 120000,
      productImages: index === 1 ? [] : [{
        id: `image-${index}`, product: { name: index ? 'Calça Linho' : 'Calça de Malha Viscolycra' },
        type: 'SECONDARY', sortOrder: index,
      }],
    }));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/v1/')) {
        const body = url.pathname.endsWith('/auth/me') ? { user: admin }
          : url.pathname.endsWith('/orders') ? { orders: [] }
            : url.pathname.endsWith('/products') ? { products: [catalogProduct()] }
              : url.pathname.endsWith('/media-assets') ? { assets, total: assets.length }
                : url.pathname.endsWith('/catalog-metadata') ? { categories: [], sizes: [], variantOptions: [] }
                  : { banners: [] };
        return route.fulfill({ json: body });
      }
      if (url.pathname.startsWith('/fixture-media/')) {
        const [w, h] = url.pathname.split('/').at(-1).replace('.svg', '').split('-');
        return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#94BDAA"/></svg>` });
      }
      return url.origin === new URL(storefront).origin ? route.continue() : route.abort();
    });
    await page.goto(`${storefront}management`);
    await page.getByRole('button', { name: 'Imagens', exact: true }).click();
    await expect(page.locator('.media-card')).toHaveCount(3);
    await page.locator('.media-thumb img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    const bounds = await page.evaluate(() => {
      const box = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        upload: box('.media-panel'), library: box('.media-library'),
        uploadTitle: box('.media-panel h2'), libraryTitle: box('.media-library h2'),
        heading: box('.management-heading'), refresh: box('.management-heading>.button'),
        search: box('.media-library-head input'), filter: box('.media-library-head select'),
        cards: [...document.querySelectorAll('.media-card')].map(card => {
          const r = card.getBoundingClientRect(), t = card.querySelector('.media-thumb').getBoundingClientRect();
          const a = card.querySelector('.media-actions').getBoundingClientRect();
          return { y: r.y, height: r.height, thumbHeight: t.height, actionsBottom: a.bottom };
        }),
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.refresh.width).toBeLessThan(180);
    expect(Math.abs(bounds.search.height - bounds.filter.height)).toBeLessThanOrEqual(1);
    if (width > 900) {
      expect(Math.abs(bounds.uploadTitle.y - bounds.libraryTitle.y)).toBeLessThanOrEqual(1);
      expect(bounds.library.x).toBeGreaterThan(bounds.upload.right);
    } else {
      expect(bounds.library.y).toBeGreaterThanOrEqual(bounds.upload.bottom);
    }
    const rows = Object.values(Object.groupBy(bounds.cards, card => Math.round(card.y)));
    for (const row of rows) {
      expect(Math.max(...row.map(c => c.thumbHeight)) - Math.min(...row.map(c => c.thumbHeight))).toBeLessThanOrEqual(1);
      expect(Math.max(...row.map(c => c.actionsBottom)) - Math.min(...row.map(c => c.actionsBottom))).toBeLessThanOrEqual(1);
    }
  });
}
