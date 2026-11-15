import { test as base, expect } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { startTestDatabase } from '../../server/test-support/postgres.js';
import { startStorage } from '../../server/test-support/storage.js';

export { expect };
export const test = base.extend({
  shop: [async ({}, use) => {
    const database = await startTestDatabase();
    let vite, api, integration, storage, melhorEnvio;
    try {
      const portProbe = createServer();
      await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
      const port = portProbe.address().port;
      await new Promise(resolve => portProbe.close(resolve));
      const origin = `http://127.0.0.1:${port}`;
      storage = await startStorage();
      melhorEnvio = await startMelhorEnvioStub();
      Object.assign(process.env, database.environment, { FRONTEND_ORIGIN: origin,
        SUPABASE_URL: storage.url, SUPABASE_SECRET_KEY: 'sb_secret_only_a_local_fixture',
        MELHOR_ENVIO_BASE_URL: melhorEnvio.url, MELHOR_ENVIO_TOKEN: 'e2e-local-token',
        SHIPPING_ORIGIN_POSTAL_CODE: '03031000' });
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
      await melhorEnvio?.close();
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
  await page.getByRole('button', { name: correios ? /Transportadora/ : /Excursão/ }).click();
  if (correios) {
    await page.getByRole('textbox', { name: 'Seu CEP' }).fill('01001000');
    await page.getByRole('button', { name: 'Calcular estimativa' }).click();
    await page.getByRole('button', { name: /Correios PAC/ }).waitFor();
  }
  const submit = page.getByRole('button', { name: 'Enviar pedido pelo WhatsApp' });
  await beforeSubmit?.(submit);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Pedido recebido' })).toBeVisible();
}

// O backend do teste nunca deve alcançar o Melhor Envio real: um stub local
// reproduz apenas o endpoint de cotação usado pela loja.
export async function startMelhorEnvioStub() {
  const quotes = [
    { id: 1, name: 'PAC', price: '21.00', custom_price: '21.90', discount: null, delivery_time: 7, custom_delivery_time: 5, company: { id: 1, name: 'Correios', picture: '' } },
    { id: 18, name: 'Jadlog .Package', price: '23.00', custom_price: '23.40', discount: null, delivery_time: 4, custom_delivery_time: 3, company: { id: 3, name: 'Jadlog', picture: '' } },
    { id: 2, name: 'SEDEX', price: '30.00', custom_price: '30.10', discount: null, delivery_time: 3, custom_delivery_time: 2, company: { id: 1, name: 'Correios', picture: '' } },
    { id: 99, name: 'LATAM X', price: '1.00', custom_price: '1.00', discount: null, delivery_time: 1, custom_delivery_time: 1, company: { id: 9, name: 'LATAM Cargo', picture: '' } },
  ];
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.method !== 'POST' || new URL(req.url, 'http://localhost').pathname !== '/api/v2/me/shipment/calculate') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(quotes));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}
