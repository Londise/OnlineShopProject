import React from 'react';
import { test, expect } from 'vitest';
import { screen, within, waitFor, render, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from '../../src/pages/Home';
import AppRoutes from '../../src/routes/AppRoutes';
import { renderPage } from '../support/render';
import { respond, json, deferred, requests } from '../support/network';
import { catalogProduct, admin, customer } from '../support/fixtures';
import { useAuthContext } from '../../src/contexts/AuthContext';

function publicRoutes(products = [catalogProduct()]) {
  respond('GET', '/api/v1/auth/me', { user: null });
  respond('GET', '/api/v1/products', { products });
  respond('GET', '/api/v1/banners', { banners: [] });
  respond('GET', '/api/v1/site-media', { faviconUrl: null });
}
test('catalog renders database swatches for every linen color, including names absent from the legacy palette', async () => {
  const palette = [
    ['Preto', '#191919'], ['Creme', '#EAD5C2'], ['Verde Menta', '#94BDAA'],
    ['Verde musgo', '#585A46'], ['Verde Oliva', '#7B824C'], ['Castor', '#C9A480'],
    ['Caramelo', '#A76F46'], ['Terracota', '#893126'], ['Azul / Petróleo', '#2F83D2'],
    ['Rosê', '#C96780'],
  ];
  publicRoutes([catalogProduct({ options: palette.map(([name, swatchHex], index) => ({
    ...catalogProduct().options[0], id: `color-${index}`, name, swatchHex,
  })) })]);
  renderPage(<Home />);
  await screen.findAllByRole('heading', { name: 'Calça Linho' });
  await userEvent.click(screen.getAllByRole('button', { name: 'Montar pedido' })[0]);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByRole('button', { name: 'Preto', exact: true }).parentElement)
    .toHaveStyle({ '--color-rows': '5' });
  for (const [name, hex] of palette) {
    expect(dialog.getByRole('button', { name, exact: true })).toHaveStyle({ background: hex });
  }
  await userEvent.click(dialog.getByRole('button', { name: 'Terracota', exact: true }));
  expect(dialog.getByRole('button', { name: 'Terracota', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(dialog.getByRole('button', { name: 'Preto', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(dialog.getByText('Terracota')).toBeVisible();
  expect(dialog.getByText('Terracota').closest('.color-heading')).not.toBeNull();
  expect(dialog.getByRole('button', { name: 'Terracota', exact: true }).closest('.builder-choices'))
    .toBe(dialog.getByRole('textbox', { name: 'Quantidade tamanho M' }).closest('.builder-choices'));
});

test.each([[7, 7], [8, 5], [14, 7], [15, 7]])('color grid with %i colors fills %i desktop rows before the next column', async (count, rows) => {
  publicRoutes([catalogProduct({ options: Array.from({ length: count }, (_, index) => ({
    ...catalogProduct().options[0], id: `color-${index}`, name: `Cor ${index}`, swatchHex: '#94BDAA',
  })) })]);
  renderPage(<Home />);
  await screen.findAllByRole('heading', { name: 'Calça Linho' });
  await userEvent.click(screen.getAllByRole('button', { name: 'Montar pedido' })[0]);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByRole('button', { name: 'Cor 0', exact: true }).parentElement)
    .toHaveStyle({ '--color-rows': String(rows) });
});

test('EXG uses its own price when added to the order, not the product base price', async () => {
  publicRoutes([catalogProduct({
    name: 'Pantacourt Linho', priceCents: 3300,
    options: [{ ...catalogProduct().options[0], variants: [
      { ...catalogProduct().options[0].variants[0], size: 'P', priceCents: 3300 },
      { id: 'variant-exg', sku: 'PANTACOURT-PRETO-EXG', size: 'EXG', priceCents: 3500, active: true, available: 10 },
    ] }],
  })]);
  renderPage(<Home />);
  await screen.findAllByRole('heading', { name: 'Pantacourt Linho' });
  await userEvent.click(screen.getAllByRole('button', { name: 'Montar pedido' })[0]);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('EXG').closest('.size-row')).toHaveTextContent('35,00');
  expect(dialog.getByText('P', { exact: true }).closest('.size-row')).toHaveTextContent('33,00');
  await userEvent.type(dialog.getByRole('textbox', { name: 'Quantidade tamanho EXG' }), '1');
  await userEvent.click(dialog.getByRole('button', { name: 'Adicionar 1 peça' }));
  expect(screen.getByRole('heading', { name: '1 peça' })).toBeVisible();
  expect(screen.getByText('Preto · EXG').closest('.cart-line')).toHaveTextContent('35,00');
});

test('V1: category and case-insensitive search combine without changing API price/weight units', async () => {
  publicRoutes([catalogProduct(), catalogProduct({ id: 'product-2', slug: 'vestido-algodao', name: 'Vestido Algodão', options: [], category: { id: 'category-2', name: 'Vestidos', slug: 'vestidos', imageUrl: null, imageWidth: null, imageHeight: null } })]);
  renderPage(<Home />);
  await screen.findAllByRole('heading', { name: 'Calça Linho' });
  const catalog = within(screen.getByRole('heading', { name: 'Monte seu pedido.' }).closest('section'));
  await userEvent.type(catalog.getByRole('searchbox'), 'LINHO');
  expect(catalog.getAllByRole('article')).toHaveLength(1);
  expect(catalog.getByRole('article')).toHaveTextContent('25,00');
  await userEvent.click(catalog.getByRole('button', { name: 'Vestidos', exact: true }));
  expect(catalog.queryByRole('article')).not.toBeInTheDocument();
  await userEvent.clear(catalog.getByRole('searchbox'));
  expect(catalog.getByRole('heading', { name: 'Vestido Algodão' })).toBeVisible();
  await userEvent.click(catalog.getByRole('button', { name: 'Todos', exact: true }));
  expect(catalog.getAllByRole('article')).toHaveLength(2);
});

test('V2/V5: catalog failure is visible and retry restores real product interactions', async () => {
  publicRoutes();
  respond('GET', '/api/v1/products', () => json({ error: { message: 'Catálogo indisponível' } }, 500));
  renderPage(<Home />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Catálogo indisponível');
  const gate = deferred();
  respond('GET', '/api/v1/products', () => gate.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  await act(async () => gate.resolve(json({ products: [catalogProduct()] })));
  expect((await screen.findAllByRole('heading', { name: 'Calça Linho' })).length).toBeGreaterThan(0);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Montar pedido' })[0]);
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.type(dialog.getByRole('textbox', { name: 'Quantidade tamanho M' }), '1');
  await userEvent.click(dialog.getByRole('button', { name: 'Adicionar 1 peça' }));
  expect(screen.getByRole('heading', { name: '1 peça' })).toBeVisible();
});

test('S7: management waits for session verification before fetching administrative data', async () => {
  publicRoutes();
  const session = deferred();
  respond('GET', '/api/v1/auth/me', () => session.promise);
  respond('GET', '/api/v1/admin/orders', { orders: [] });
  window.history.replaceState({}, '', '/management');
  render(<AppRoutes />);
  expect(screen.getByRole('status')).toHaveTextContent(/Verificando/);
  expect(requests.some(request => request.url.pathname.startsWith('/api/v1/admin/'))).toBe(false);
  await act(async () => session.resolve(json({ user: admin })));
  expect(await screen.findByRole('button', { name: 'Estoque', exact: true })).toBeVisible();
});

test.each([null, customer, { ...customer, role: 'STAFF' }])('S7: management does not grant UI access to role $role', async user => {
  publicRoutes(); respond('GET', '/api/v1/auth/me', { user });
  window.history.replaceState({}, '', '/management');
  render(<AppRoutes />);
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(requests.some(request => request.url.pathname.startsWith('/api/v1/admin/'))).toBe(false);
});

function RefreshSession() {
  const { refreshSession } = useAuthContext();
  return <button onClick={() => refreshSession()}>Atualizar sessão</button>;
}
test('V5: identical failures produce one notice, dismiss stays dismissed, and a different failure becomes visible', async () => {
  publicRoutes();
  respond('GET', '/api/v1/auth/me', () => json({ error: { message: 'Servidor indisponível' } }, 409));
  respond('GET', '/api/v1/products', () => json({ error: { message: 'Servidor indisponível' } }, 409));
  renderPage(<><Home /><RefreshSession /></>);
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getAllByText('Servidor indisponível')).toHaveLength(1));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  respond('GET', '/api/v1/auth/me', () => json({ error: { message: 'Sessão temporariamente indisponível' } }, 409));
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar sessão' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sessão temporariamente indisponível');
});
test.each([[], 'failure'])('V6: optional banner result %j cannot prevent catalog use', async result => {
  publicRoutes();
  respond('GET', '/api/v1/banners', result === 'failure' ? () => json({ error: { message: 'Banner unavailable' } }, 409) : { banners: result });
  renderPage(<Home />);
  expect((await screen.findAllByRole('heading', { name: 'Calça Linho' })).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: 'Montar pedido' })[0]).toBeEnabled();
});
test('V6: banner controls select their image and favicon is applied without blocking catalog', async () => {
  publicRoutes();
  respond('GET', '/api/v1/banners', { banners: [
    { id: 'banner-1', imageUrl: '/first.png', altText: 'Primeiro banner', width: 1600, height: 750, subtitle: 'Primeira coleção' },
    { id: 'banner-2', imageUrl: '/second.png', altText: 'Segundo banner', width: 1600, height: 750, subtitle: 'Segunda coleção' },
  ] });
  respond('GET', '/api/v1/site-media', { faviconUrl: '/custom-icon.png' });
  const icon = document.createElement('link'); icon.rel = 'icon'; document.head.append(icon);
  try {
    renderPage(<Home />);
    fireEvent.load(await screen.findByAltText('Primeiro banner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Próximo banner' }));
    expect(screen.getByRole('img', { name: 'Segundo banner' })).toHaveAttribute('src', '/second.png');
    await userEvent.click(screen.getByRole('button', { name: 'Banner anterior' }));
    expect(screen.getByRole('img', { name: 'Primeiro banner' })).toHaveAttribute('src', '/first.png');
    await waitFor(() => expect(icon).toHaveAttribute('href', '/custom-icon.png'));
    expect(screen.getAllByRole('button', { name: 'Montar pedido' })[0]).toBeEnabled();
  } finally { icon.remove(); }
});
test('V2: a malformed catalog is an error, not a valid empty store', async () => {
  publicRoutes(); respond('GET', '/api/v1/products', { products: null });
  renderPage(<Home />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/catálogo inválida/);
});

test('V2: a valid empty catalog finishes loading without reporting an unavailable store', async () => {
  publicRoutes([]);
  renderPage(<Home />);
  await waitFor(() => expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Montar pedido' })).not.toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toBeEnabled();
});

test('S7: session failure keeps the management guard recoverable without redirecting or loading admin data', async () => {
  publicRoutes();
  respond('GET', '/api/v1/auth/me', () => json({ error: { message: 'Verificação indisponível' } }, 500));
  respond('GET', '/api/v1/admin/orders', { orders: [] });
  window.history.replaceState({}, '', '/management');
  render(<AppRoutes />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Verificação indisponível');
  expect(window.location.pathname).toBe('/management');
  expect(requests.some(request => request.url.pathname.startsWith('/api/v1/admin/'))).toBe(false);
  respond('GET', '/api/v1/auth/me', { user: admin });
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('button', { name: 'Estoque', exact: true })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(requests.filter(request => request.url.pathname === '/api/v1/admin/orders')).toHaveLength(1);
});
