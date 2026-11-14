import { test as base, expect } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { startTestDatabase } from '../../server/test-support/postgres.js';
import { startStorage } from '../../server/test-support/storage.js';

export { expect };
export const test = base.extend({
  shop: [async ({}, use) => {
    const database = await startTestDatabase();
    let vite, api, integration, storage;
    try {
      const portProbe = createServer();
      await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
      const port = portProbe.address().port;
      await new Promise(resolve => portProbe.close(resolve));
      const origin = `http://127.0.0.1:${port}`;
      storage = await startStorage();
      Object.assign(process.env, database.environment, { FRONTEND_ORIGIN: origin,
        SUPABASE_URL: storage.url, SUPABASE_SECRET_KEY: 'sb_secret_only_a_local_fixture' });
      integration = await import('../../server/test-support/integration.js');
      api = await integration.serve();
      // Derive the URL from a real response rather than accepting an external API.
      const health = await api.request('/health');
      const backend = new URL(health.url).origin;
      const backendPort = Number(new URL(backend).port);
      vite = await createViteServer({
        root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, envFile: false,
        define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
        server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': backend } },
      });
      await vite.listen();
      await use({ ...integration, origin, storage,
        restartApi: async () => {
          await api.close();
          api = await integration.serve(integration.createApp(), { port: backendPort });
        },
      });
    } finally {
      // No browser work remains. Close proxy keep-alives/HMR sockets before
      // awaiting Vite; otherwise an upstream socket can delay worker teardown.
      vite?.ws.close();
      vite?.httpServer?.closeAllConnections();
      await vite?.close();
      await api?.close();
      await integration?.closeDatabase();
      await storage?.close();
      await database.close();
    }
  }, { scope: 'worker', timeout: 120000 }],
  isolateShop: [async ({ shop, page }, use) => {
    // A hook registered while importing this module only attaches to the first
    // spec in a cached worker. An automatic test fixture applies to every spec.
    // Recreate application-owned in-memory state (including rate limiters),
    // rather than disabling production protections for this shared client IP.
    await shop.restartApi();
    await shop.resetDatabase();
    shop.storage.reset();
    await shop.catalogFixture({ onHand: 60 });
    // No browser requests (fonts, WhatsApp, images) may reach external services.
    await page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
    });
    await use();
  }, { auto: true }],
});

export async function buildCart(page, shop) {
  await page.goto(shop.origin);
  await page.getByRole('button', { name: 'Montar pedido' }).first().click();
  await page.getByRole('textbox', { name: 'Quantidade tamanho M' }).fill('15');
  await page.getByRole('button', { name: 'Adicionar 15 peças' }).click();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: /^Pedido/ }).click();
  await page.getByRole('button', { name: 'Continuar pedido' }).click();
}

export async function submitGuestOrder(page, { correios = false, beforeSubmit } = {}) {
  await page.getByRole('textbox', { name: 'Seu nome' }).fill('Ana Silva');
  await page.getByRole('textbox', { name: 'WhatsApp', exact: true }).fill('11999998888');
  await page.getByRole('button', { name: correios ? /Correios/ : /Excursão/ }).click();
  if (correios) {
    await page.getByRole('textbox', { name: 'Seu CEP' }).fill('01001000');
    await page.getByRole('button', { name: 'Calcular estimativa' }).click();
  }
  const submit = page.getByRole('button', { name: 'Enviar pedido pelo WhatsApp' });
  await beforeSubmit?.(submit);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Pedido recebido' })).toBeVisible();
}
