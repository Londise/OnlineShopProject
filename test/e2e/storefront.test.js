import { test, expect, buildCart, submitGuestOrder } from './fixtures.js';
import { catalogCard, mediaUpload, mediaLibrary } from './locators.js';

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
  // Aqui a posição é o comportamento verificado: ordem de foco e retorno cíclico.
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
    const back = page.getByRole('button', { name: 'Voltar e editar', exact: true });
    await expectOperableControl(page, back);
    const logo = page.getByRole('banner').getByRole('button', { name: 'Ferchu Modas, voltar ao início', exact: true });
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
    expect(saved[0].totalCents).toBe(viewport.width > 1000 ? 39690 : 37500);
    expect((await shop.prisma.inventoryLevel.findFirst()).reserved).toBe(0);
    const link = page.getByRole('link', { name: 'Abrir WhatsApp', exact: true });
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
      await expect(popup.getByRole('heading', { name: 'Local handoff', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Ainda não tenho conta', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Criar conta', exact: true });
  await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill('Ana Silva');
  await dialog.getByRole('textbox', { name: 'E-mail', exact: true }).fill('ana@example.test');
  await dialog.getByLabel('Senha', { exact: true }).fill('correct-horse-42');
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('sua conta foi criada');
  expect(await shop.prisma.authSession.count()).toBe(0);
  const unverified = await shop.prisma.user.findUnique({ where: { email: 'ana@example.test' } });
  expect(unverified.emailVerifiedAt).toBeNull();
  await dialog.getByRole('button', { name: 'Já tenho uma conta', exact: true }).click();
  await page.getByRole('dialog', { name: 'Entrar', exact: true }).getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana.', exact: true })).toBeVisible();
  await page.goto(`${shop.origin}/account`);
  await expect(page.getByRole('complementary', { name: 'Verificação de e-mail', exact: true })).toBeVisible();
  await expect(page.getByText('Confirme seu e-mail para liberar o histórico e enviar pedidos pela sua conta.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/unverified-account.png', fullPage: true });
  const message = shop.verificationMessages.find(item => item.email === 'ana@example.test');
  expect(message).toBeTruthy();
  await page.goto(`${shop.origin}/verify-email#token=${message.token}`);
  await expect(page.getByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/verified-email.png', fullPage: true });
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('complementary', { name: 'Verificação de e-mail', exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Ir para minha conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana.', exact: true })).toBeVisible();
  await buildCart(page, shop);
  await submitGuestOrder(page);
  const saved = await shop.prisma.order.findFirst();
  expect(saved.userId).not.toBeNull();
  await page.goto(`${shop.origin}/account`);
  await expect(page.getByRole('article')).toContainText(saved.publicNumber);
  await expect(page.getByRole('article')).toContainText('375,00');
  await page.reload();
  await expect(page.getByRole('article')).toContainText(saved.publicNumber);
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect((await shop.prisma.authSession.findFirst()).revokedAt).not.toBeNull();
  await page.goto(`${shop.origin}/management`);
  await expect(page).toHaveURL(`${shop.origin}/`);
});

async function signUp(page, shop, email) {
  await page.goto(shop.origin);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Ainda não tenho conta', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Criar conta', exact: true });
  await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill('Ana Silva');
  await dialog.getByRole('textbox', { name: 'E-mail', exact: true }).fill(email);
  await dialog.getByLabel('Senha', { exact: true }).fill('correct-horse-42');
  await dialog.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('sua conta foi criada');
  return dialog;
}

test('same-browser confirmation uses only the mail token and browser proof, without an automatic login or new password', async ({ page, context, shop }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const dialog = await signUp(page, shop, 'proof@example.test');
  const before = await shop.prisma.user.findUnique({ where: { email: 'proof@example.test' } });
  expect(before.emailVerifiedAt).toBeNull();
  expect((await context.cookies()).some(cookie => cookie.name === 'ferchu_session_verification' && cookie.httpOnly)).toBe(true);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Verificação de e-mail', exact: true })).toHaveCount(0);
  const message = shop.verificationMessages.find(item => item.email === 'proof@example.test');
  await page.goto(`${shop.origin}/verify-email#token=${message.token}`);
  await expect(page.getByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/verified-email-mobile.png', fullPage: true });
  await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0);
  expect(await shop.prisma.authSession.count()).toBe(0);
  const after = await shop.prisma.user.findUnique({ where: { id: before.id } });
  expect(after.passwordHash).toBe(before.passwordHash);
  expect(after.name).toBe(before.name);
  expect(after.emailVerifiedAt).not.toBeNull();
});

test('a link opened in a different browser requires the original account login, then verifies without changing credentials', async ({ page, browser, shop }) => {
  await signUp(page, shop, 'cross-browser@example.test');
  const before = await shop.prisma.user.findUnique({ where: { email: 'cross-browser@example.test' } });
  const message = shop.verificationMessages.find(item => item.email === before.email);
  const other = await browser.newContext();
  try {
    await other.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
    const second = await other.newPage();
    await second.goto(`${shop.origin}/verify-email#token=${message.token}`);
    await expect(second.getByRole('heading', { name: 'Só falta entrar na sua conta', exact: true })).toBeVisible();
    expect((await shop.prisma.user.findUnique({ where: { id: before.id } })).emailVerifiedAt).toBeNull();
    await second.getByRole('button', { name: 'Entrar na minha conta', exact: true }).click();
    const login = second.getByRole('dialog', { name: 'Entrar', exact: true });
    await login.getByRole('textbox', { name: 'E-mail', exact: true }).fill(before.email);
    await login.getByLabel('Senha', { exact: true }).fill('correct-horse-42');
    await login.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(second.getByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
    const after = await shop.prisma.user.findUnique({ where: { id: before.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await shop.prisma.auditLog.count({ where: { action: 'EMAIL_VERIFIED' } })).toBe(1);
  } finally { await other.close(); }
});

test('an expired link offers authenticated resend and the new link verifies while preserving the original password', async ({ page, shop }) => {
  const dialog = await signUp(page, shop, 'resend@example.test');
  await dialog.getByRole('button', { name: 'Já tenho uma conta', exact: true }).click();
  await page.getByRole('dialog', { name: 'Entrar', exact: true }).getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana.', exact: true })).toBeVisible();
  await page.goto(`${shop.origin}/account`);
  const first = shop.verificationMessages.find(item => item.email === 'resend@example.test');
  await shop.owner.pendingRegistration.updateMany({ data: { createdAt: new Date(0), expiresAt: new Date(0) } });
  await page.goto(`${shop.origin}/verify-email#token=${first.token}`);
  const verification = page.getByRole('region', { name: 'Vamos tentar de novo?', exact: true });
  await expect(verification.getByRole('alert')).toContainText('vencido');
  await verification.getByRole('button', { name: 'Reenviar e-mail', exact: true }).click();
  await expect(verification.getByRole('status')).toContainText('Enviamos um link');
  const resent = shop.verificationMessages.filter(item => item.email === 'resend@example.test').at(-1);
  expect(resent.token).not.toBe(first.token);
  await page.goto(`${shop.origin}/verify-email#token=${resent.token}`);
  await expect(page.getByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Verificação de e-mail', exact: true })).toHaveCount(0);
});

test('E2: reduced-motion keyboard navigation stays inside dialogs and returns focus on Escape', async ({ page, shop }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(shop.origin);
  const opener = catalogCard(page, 'Calça Linho').getByRole('button', { name: 'Montar pedido', exact: true });
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Calça Linho', exact: true });
  await expect(dialog.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await traverseDialog(page, dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(opener).toBeFocused();
  const login = page.getByRole('button', { name: 'Entrar', exact: true });
  await login.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await traverseDialog(page, page.getByRole('dialog'));
  // The last control switches mode; registration must also trap focus.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Criar conta', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: /^Calça Linho(?: |$)/ }).click();
  await page.getByRole('button', { name: /^Preto(?: |$)/ }).click();
  await page.getByRole('spinbutton', { name: 'Novo estoque de LINHO-PRETO-M', exact: true }).fill('65');
  await page.getByRole('button', { name: 'Definir', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Novo estoque de LINHO-PRETO-M', exact: true })).toHaveAttribute('placeholder', '65');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  const orderCard = page.getByRole('article').filter({ has: page.getByText(order.publicNumber, { exact: true }) });
  await orderCard.getByRole('combobox').selectOption('CONFIRMADO');
  await expect(orderCard.getByRole('combobox')).toHaveValue('CONFIRMADO');
  await expect.poll(async () => (await shop.prisma.inventoryLevel.findFirst()).onHand).toBe(50);
  await orderCard.getByRole('combobox').selectOption('CANCELADO');
  await expect.poll(async () => (await shop.prisma.inventoryLevel.findFirst()).onHand).toBe(65);
  page.once('dialog', dialog => dialog.accept());
  await orderCard.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(page.getByText('Nenhum pedido ativo.')).toBeVisible();
  const saved = await shop.prisma.order.findUnique({ where: { id: order.id } });
  expect(saved.archivedById).toBe(admin.user.id);
  expect(saved.archivedAt).not.toBeNull();
  expect((await shop.prisma.inventoryLevel.findFirst()).reserved).toBe(0);
  expect(await shop.prisma.auditLog.count({ where: { actorId: admin.user.id, orderId: order.id } })).toBeGreaterThanOrEqual(3);
});

test('commercial WhatsApp edits replace a waiting item and consume stock only on admin confirmation', async ({ page, context, shop }) => {
  const admin = await shop.sessionFixture();
  await context.addCookies([{ name: 'ferchu_session', value: admin.cookie.split('=')[1], url: shop.origin }]);
  const original = await shop.prisma.productVariant.findFirst();
  const size = await shop.prisma.size.create({ data: { code: 'G' } });
  const added = await shop.prisma.productVariant.create({ data: { productOptionId: original.productOptionId,
    sizeId: size.id, sku: 'LINHO-PRETO-G', inventory: { create: { onHand: 40 } } } });
  const { createOrder } = await import('../../server/src/services/order.service.js');
  const order = await createOrder(shop.orderInput(original.id));
  await page.goto(`${shop.origin}/management`);
  const card = page.getByRole('article').filter({ has: page.getByText(order.publicNumber, { exact: true }) });
  await card.getByRole('button', { name: 'Editar pedido', exact: true }).click();
  const selector = card.getByRole('combobox', { name: 'Adicionar variação ao pedido', exact: true });
  await expect(selector).toBeEnabled();
  await selector.selectOption(added.id);
  await card.getByRole('spinbutton', { name: 'Calça Linho – Preto / M', exact: true }).fill('0');
  await card.getByRole('spinbutton', { name: 'Calça Linho – Preto / G', exact: true }).fill('20');
  await card.getByRole('textbox', { name: 'Observações do pedido', exact: true }).fill('Troca combinada no WhatsApp');
  await card.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Editar pedido', exact: true })).toBeVisible();
  const saved = await shop.prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
  expect(saved.note).toBe('Troca combinada no WhatsApp');
  expect(saved.items.map(item => [item.productVariantId, item.quantity])).toEqual([[added.id, 20]]);
  expect((await shop.prisma.inventoryLevel.findUnique({ where: { variantId: added.id } })).onHand).toBe(40);
  await card.getByRole('combobox', { name: `Status do pedido ${order.publicNumber}`, exact: true }).selectOption('CONFIRMADO');
  await expect.poll(async () => (await shop.prisma.inventoryLevel.findUnique({ where: { variantId: added.id } })).onHand).toBe(20);
  expect((await shop.prisma.inventoryLevel.findUnique({ where: { variantId: original.id } })).onHand).toBe(60);
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
  const upload = mediaUpload(page);
  await upload.getByRole('combobox', { name: 'Selecione', exact: true }).selectOption(product.id);
  const option = await shop.prisma.productOption.findFirst();
  await upload.getByRole('combobox', { name: 'Cor ou estampa (opcional)', exact: true }).selectOption(option.id);
  await upload.getByRole('textbox', { name: 'Descrição', exact: true }).fill('Nova capa');
  await upload.getByRole('checkbox', { name: 'Usar como capa', exact: true }).check();
  await upload.getByLabel('Escolher arquivo', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: bytes });
  await upload.getByRole('button', { name: 'Enviar imagem', exact: true }).click();
  await expect(mediaLibrary(page).getByRole('img', { name: 'Nova capa', exact: true })).toBeVisible();
  const cover = await shop.prisma.productImage.findFirst({ where: { productId: product.id, type: 'PRIMARY' }, include: { asset: true } });
  expect(cover.assetId).not.toBe(old.id);
  expect(cover.productOptionId).toBe(option.id);
  await page.goto(shop.origin);
  await expect(catalogCard(page, product.name).getByRole('img', { name: `${product.name} feminina`, exact: true })).toHaveAttribute('src', cover.asset.url);
  expect((await shop.prisma.orderItem.findFirst({ where: { orderId: order.id } })).imageUrlSnapshot).toBe(oldUrl);
  expect(shop.storage.objects.size).toBe(2);
});
