// Mantenha o contexto equivalente ao de test/support/locators.js, usando as
// APIs nativas do Playwright (sem adaptar nem enfraquecer o modo estrito).
export function catalogCard(page, name) {
  const catalog = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Monte seu pedido.', exact: true }),
  });
  return catalog.getByRole('article').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

export const mediaUpload = page => page.getByRole('region', { name: 'Enviar imagem', exact: true });
export const mediaLibrary = page => page.getByRole('region', { name: 'Biblioteca de imagens', exact: true });
