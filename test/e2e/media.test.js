import { test, expect } from './fixtures.js';
import { mediaUpload, mediaLibrary } from './locators.js';

test.describe.configure({ timeout: 90_000 });

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwMMeFkAzXYj3br64kYAAAAASUVORK5CYII=', 'base64');
async function openMedia(page, context, shop) {
  const admin = await shop.sessionFixture();
  await context.addCookies([{ name: 'ferchu_session', value: admin.cookie.split('=')[1], url: shop.origin }]);
  await page.goto(`${shop.origin}/management`);
  await page.getByRole('button', { name: 'Imagens', exact: true }).click();
  await expect(mediaUpload(page).getByRole('option', { name: 'Calça Linho', exact: true })).toBeAttached();
}
const chooseFile = page => mediaUpload(page).getByLabel('Escolher arquivo', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: bytes });

for (const purpose of ['category', 'new banner', 'existing banner', 'favicon', 'library']) {
  test(`G7: native upload form links ${purpose} and refreshes its media list`, async ({ page, context, shop }) => {
    const category = await shop.prisma.category.findFirst();
    const original = await shop.prisma.mediaAsset.create({ data: { url: '/original.png', altText: 'Original' } });
    const banner = await shop.prisma.siteBanner.create({ data: { assetId: original.id, title: 'Original banner', sortOrder: 7 } });
    await openMedia(page, context, shop);
    const upload = mediaUpload(page);
    const library = mediaLibrary(page);
    // Switch away from a selected product: its option/cover must not leak into
    // the new destination's multipart body.
    const product = await shop.prisma.product.findFirst();
    await upload.getByRole('combobox', { name: 'Selecione', exact: true }).selectOption(product.id);
    await upload.getByRole('combobox', { name: 'Cor ou estampa (opcional)', exact: true }).selectOption((await shop.prisma.productOption.findFirst()).id);
    await upload.getByRole('checkbox', { name: 'Usar como capa', exact: true }).check();
    const destination = purpose.includes('banner') ? 'banner' : purpose;
    await upload.getByRole('combobox', { name: 'Destino', exact: true }).selectOption(destination);
    if (purpose === 'category') await upload.getByRole('combobox', { name: 'Selecione', exact: true }).selectOption(category.id);
    if (purpose === 'existing banner') await upload.getByRole('combobox', { name: 'Selecione', exact: true }).selectOption(banner.id);
    await upload.getByRole('textbox', { name: 'Descrição', exact: true }).fill('Imagem de teste');
    await chooseFile(page);
    const response = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/uploads') && response.request().method() === 'POST');
    await upload.getByRole('button', { name: 'Enviar imagem', exact: true }).click();
    expect((await response).status()).toBe(201);
    await expect(library.getByRole('img', { name: 'Imagem de teste', exact: true })).toBeVisible();
    const uploaded = await shop.prisma.mediaAsset.findFirst({ where: { altText: 'Imagem de teste' } });
    expect(uploaded.purpose).toBe(destination);
    expect(await shop.prisma.productImage.count()).toBe(0);
    if (purpose === 'category') expect((await shop.prisma.category.findUnique({ where: { id: category.id } })).imageAssetId).toBe(uploaded.id);
    if (purpose === 'existing banner') {
      const saved = await shop.prisma.siteBanner.findUnique({ where: { id: banner.id } });
      expect(saved.assetId).toBe(uploaded.id); expect(saved.sortOrder).toBe(7);
    }
    if (purpose === 'new banner') expect(await shop.prisma.siteBanner.count({ where: { assetId: uploaded.id } })).toBe(1);
    if (purpose === 'favicon') expect((await (await page.request.get(`${shop.origin}/api/v1/site-media`)).json()).faviconUrl).toBe(uploaded.url);
  });
}

test('G7/U5: pending and failed native uploads keep selections, block duplicates and permit retry', async ({ page, context, shop }) => {
  await openMedia(page, context, shop);
  const upload = mediaUpload(page);
  await upload.getByRole('combobox', { name: 'Destino', exact: true }).selectOption('library');
  await upload.getByRole('textbox', { name: 'Descrição', exact: true }).fill('Upload recuperado');
  await chooseFile(page);
  const posts = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/admin/uploads')) posts.push(request); });
  shop.storage.failUploads();
  const gate = shop.storage.holdNext();
  await upload.getByRole('button', { name: 'Enviar imagem', exact: true }).click();
  await gate.ready;
  try {
    await expect(upload.getByRole('button', { name: 'Enviar imagem', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    expect(posts).toHaveLength(1);
  } finally { gate.release(); }
  await expect(page.getByRole('status')).toContainText(/Não foi possível/);
  expect(await shop.prisma.mediaAsset.count()).toBe(0);
  await expect(upload.getByRole('combobox', { name: 'Destino', exact: true })).toHaveValue('library');
  expect(await upload.getByLabel('Escolher arquivo', { exact: true }).evaluate(input => input.files[0].name)).toBe('cover.png');
  shop.storage.failUploads(false);
  await upload.getByRole('button', { name: 'Enviar imagem', exact: true }).click();
  await expect(mediaLibrary(page).getByRole('img', { name: 'Upload recuperado', exact: true })).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(await shop.prisma.mediaAsset.count()).toBe(1);
});
