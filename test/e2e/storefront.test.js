import { test, expect, buildCart, submitGuestOrder } from './fixtures.js';

async function expectOperableControl(page, control) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true); // A visible control must not sit underneath another element.
}

async function traverseDialog(page, dialog) {
  const controls = dialog.locator('button:visible:enabled, input:visible:enabled, select:visible:enabled, a[href]:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(2);
  for (let index = 0; index < count; index++) {
    await expect(controls.nth(index)).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test(`E1/E2: guest order is operable at ${viewport.width}px and persists once`, async ({ page, context, shop }) => {
    await page.setViewportSize(viewport);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const posts = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/orders')) posts.push(request); });
    await buildCart(page, shop);
    const back = page.getByRole('button', { name: 'Voltar e editar' });
    await expectOperableControl(page, back);
    const logo = page.getByRole('banner').getByRole('button', { name: 'Ferchu Modas, voltar ao início' });
    await expectOperableControl(page, logo);
    const backBox = await back.boundingBox(), logoBox = await logo.boundingBox();
    expect(backBox.x >= logoBox.x + logoBox.width || logoBox.x >= backBox.x + backBox.width
      || backBox.y >= logoBox.y + logoBox.height || logoBox.y >= backBox.y + backBox.height).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await submitGuestOrder(page, { correios: viewport.width > 1000, beforeSubmit: async submit => {
      await expectOperableControl(page, submit);
      const header = await page.getByRole('banner').boundingBox();
      const cta = await submit.boundingBox();
      expect(cta.y >= header.y + header.height || header.y >= cta.y + cta.height
        || cta.x >= header.x + header.width || header.x >= cta.x + cta.width).toBe(true);
    } });
    const saved = await shop.prisma.order.findMany({ include: { items: true } });
    expect(saved).toHaveLength(1);
    expect(saved[0].items[0].quantity).toBe(15);
    expect(saved[0].totalCents).toBe(viewport.width > 1000 ? 44530 : 37500);
    expect((await shop.prisma.inventoryLevel.findFirst()).reserved).toBe(15);
    const link = page.getByRole('link', { name: 'Abrir WhatsApp' });
    const href = await link.getAttribute('href');
    expect(new URL(href, shop.origin).searchParams.get('text')).toContain(saved[0].publicNumber);
    // Follow only the local redirect; never open a real conversation.
    const response = await page.request.get(new URL(href, shop.origin).href, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const location = new URL(response.headers().location);
    expect(location.searchParams.get('phone')).toBe('5511999998888');
    await page.request.get(new URL(href, shop.origin).href, { maxRedirects: 0 });
    // Exercise the actual link interaction too, but terminate the handoff
    // locally rather than opening a real WhatsApp conversation.
    await context.route('**/api/v1/whatsapp?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Local handoff</h1>' }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const opened = context.waitForEvent('page');
      await link.click();
      const popup = await opened;
      await expect(popup.getByRole('heading', { name: 'Local handoff' })).toBeVisible();
      await popup.close();
    }
    expect(posts).toHaveLength(1);
    expect(await shop.prisma.order.count()).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('E3: registration, order ownership, account reload and logout work across browser/API/database', async ({ page, shop }) => {
  await page.goto(shop.origin);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Ainda não tenho conta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Criar conta' });
  await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill('Ana Silva');
  await dialog.getByRole('textbox', { name: 'E-mail' }).fill('ana@example.test');
  await dialog.getByLabel('Senha').fill('correct-horse-42');
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana.' })).toBeVisible();
  await buildCart(page, shop);
  await submitGuestOrder(page);
  const saved = await shop.prisma.order.findFirst();
  expect(saved.userId).not.toBeNull();
  await page.goto(`${shop.origin}/account`);
  await expect(page.getByRole('article')).toContainText(saved.publicNumber);
  await expect(page.getByRole('article')).toContainText('375,00');
  await page.reload();
  await expect(page.getByRole('article')).toContainText(saved.publicNumber);
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect((await shop.prisma.authSession.findFirst()).revokedAt).not.toBeNull();
  await page.goto(`${shop.origin}/management`);
  await expect(page).toHaveURL(`${shop.origin}/`);
});

test('E2: reduced-motion keyboard navigation stays inside dialogs and returns focus on Escape', async ({ page, shop }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(shop.origin);
  const opener = page.getByRole('button', { name: 'Montar pedido' }).first();
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await traverseDialog(page, dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
  const login = page.getByRole('button', { name: 'Entrar', exact: true });
  await login.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await traverseDialog(page, page.getByRole('dialog'));
  // The last control switches mode; the new name field must participate too.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Criar conta' })).toBeVisible();
  await page.keyboard.press('Tab');
  await traverseDialog(page, page.getByRole('dialog'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(login).toBeFocused();
});

test('E4: administrator adjustment, confirmation, cancellation and archive agree with persistent stock/audit', async ({ page, context, shop }) => {
  const admin = await shop.sessionFixture();
  await context.addCookies([{ name: 'ferchu_session', value: admin.cookie.split('=')[1], url: shop.origin }]);
  const variant = await shop.prisma.productVariant.findFirst();
  const { createOrder } = await import('../../server/src/services/order.service.js');
  const order = await createOrder(shop.orderInput(variant.id));
  await page.goto(`${shop.origin}/management`);
  await page.getByRole('button', { name: 'Estoque', exact: true }).click();
  await page.getByRole('button', { name: /Calça Linho/ }).click();
  await page.getByRole('button', { name: /Preto/ }).click();
  await page.getByRole('spinbutton', { name: 'Novo estoque de LINHO-PRETO-M' }).fill('65');
  await page.getByRole('button', { name: 'Definir', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Novo estoque de LINHO-PRETO-M' })).toHaveAttribute('placeholder', '65');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.getByRole('combobox').selectOption('CONFIRMADO');
  await expect(page.getByRole('combobox')).toHaveValue('CONFIRMADO');
  await expect.poll(async () => (await shop.prisma.inventoryLevel.findFirst()).onHand).toBe(50);
  await page.getByRole('combobox').selectOption('CANCELADO');
  await expect.poll(async () => (await shop.prisma.inventoryLevel.findFirst()).onHand).toBe(65);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
  const saved = await shop.prisma.order.findUnique({ where: { id: order.id } });
  expect(saved.archivedById).toBe(admin.user.id);
  expect(saved.archivedAt).not.toBeNull();
  expect((await shop.prisma.inventoryLevel.findFirst()).reserved).toBe(0);
  expect(await shop.prisma.auditLog.count({ where: { actorId: admin.user.id, orderId: order.id } })).toBeGreaterThanOrEqual(3);
});

test('E5: image upload and cover replacement reach the storefront without destroying historical order media', async ({ page, context, shop }) => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwMMeFkAzXYj3br64kYAAAAASUVORK5CYII=', 'base64');
  const product = await shop.prisma.product.findFirst();
  const variant = await shop.prisma.productVariant.findFirst();
  const oldUrl = `${shop.storage.url}/storage/v1/object/public/storefront-images/old.png`;
  shop.storage.objects.set('old.png', bytes);
  const old = await shop.prisma.mediaAsset.create({ data: { url: oldUrl, width: 3, height: 4 } });
  await shop.prisma.productImage.create({ data: { productId: product.id, assetId: old.id, type: 'PRIMARY' } });
  const { createOrder } = await import('../../server/src/services/order.service.js');
  const order = await createOrder(shop.orderInput(variant.id));
  const admin = await shop.sessionFixture();
  await context.addCookies([{ name: 'ferchu_session', value: admin.cookie.split('=')[1], url: shop.origin }]);
  await page.goto(`${shop.origin}/management`);
  await page.getByRole('button', { name: 'Imagens', exact: true }).click();
  await page.getByRole('combobox', { name: 'Selecione', exact: true }).selectOption(product.id);
  const option = await shop.prisma.productOption.findFirst();
  await page.getByRole('combobox', { name: /Cor ou estampa/ }).selectOption(option.id);
  await page.getByLabel('Descrição').fill('Nova capa');
  await page.getByLabel('Usar como capa', { exact: true }).check();
  await page.getByLabel('Arquivo').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: bytes });
  await page.getByRole('button', { name: 'Enviar imagem' }).click();
  await expect(page.getByRole('img', { name: 'Nova capa' })).toBeVisible();
  const cover = await shop.prisma.productImage.findFirst({ where: { productId: product.id, type: 'PRIMARY' }, include: { asset: true } });
  expect(cover.assetId).not.toBe(old.id);
  expect(cover.productOptionId).toBe(option.id);
  await page.goto(shop.origin);
  await expect(page.getByRole('img', { name: 'Calça Linho feminina' }).first()).toHaveAttribute('src', cover.asset.url);
  expect((await shop.prisma.orderItem.findFirst({ where: { orderId: order.id } })).imageUrlSnapshot).toBe(oldUrl);
  expect(shop.storage.objects.size).toBe(2);
});
