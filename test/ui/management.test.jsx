import React from 'react';
import { expect, test, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Management from '../../src/pages/Management';
import { renderPage } from '../support/render';
import { respond, requests, deferred, json } from '../support/network';
import { admin, order, catalogProduct } from '../support/fixtures';

const items = [
  { id: 'item-1', productVariantId: 'variant-1', productNameSnapshot: 'Calça Linho', optionNameSnapshot: 'Preto', sizeSnapshot: 'M', quantity: 15, unitPriceCentsSnapshot: 2500, lineTotalCentsSnapshot: 37500 },
  { id: 'item-2', productVariantId: 'variant-2', productNameSnapshot: 'Calça Linho', optionNameSnapshot: 'Preto', sizeSnapshot: 'G', quantity: 5, unitPriceCentsSnapshot: 2500, lineTotalCentsSnapshot: 12500 },
];
const savedOrder = () => order({ customerName: 'Ana', customerWhatsApp: '11999998888', items });
const mutations = () => requests.filter(request => request.method !== 'GET');
async function openManagement(handler = { orders: [savedOrder()] }) {
  respond('GET', '/api/v1/auth/me', { user: admin });
  respond('GET', '/api/v1/admin/orders', handler);
  respond('GET', '/api/v1/admin/inventory', { variants: [] });
  renderPage(<Management />, { waitForSession: true });
  await screen.findByRole('button', { name: 'Estoque', exact: true });
}

test('G4: leaving and returning to a tab cannot revive its original pending load', async () => {
  const old = deferred(); let calls = 0;
  await openManagement(() => ++calls === 1 ? old.promise : json({ orders: [savedOrder()] }));
  await userEvent.click(screen.getByRole('button', { name: 'Estoque', exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Pedidos', exact: true }));
  await screen.findByText('FM-20261111-ABC12345');
  await act(async () => old.resolve(json({ orders: [order({ publicNumber: 'STALE-ORDER' })] })));
  expect(screen.getByText('FM-20261111-ABC12345')).toBeVisible();
  expect(screen.queryByText('STALE-ORDER')).not.toBeInTheDocument();
});

test('G4: refresh blocks repeated interactions while its request is pending', async () => {
  await openManagement(); await screen.findByText('FM-20261111-ABC12345');
  const pending = deferred(); let calls = 0;
  respond('GET', '/api/v1/admin/orders', () => { calls++; return pending.promise; });
  await userEvent.dblClick(screen.getByRole('button', { name: 'Atualizar' }));
  expect(calls).toBe(1);
  expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled();
  await act(async () => pending.resolve(json({ orders: [savedOrder()] })));
  expect(screen.getByRole('button', { name: 'Editar pedido' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled();
});

test('G4: a mutation from an abandoned tab cannot close the editor opened after returning', async () => {
  await openManagement();
  await userEvent.click(await screen.findByRole('button', { name: 'Editar pedido' }));
  const pending = deferred();
  respond('PATCH', '/api/v1/admin/orders/order-internal-1', () => pending.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await userEvent.click(screen.getByRole('button', { name: 'Estoque', exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Pedidos', exact: true }));
  await userEvent.click(await screen.findByRole('button', { name: 'Editar pedido' }));
  const paid = screen.getByRole('textbox', { name: 'Valor pago (R$)' });
  await userEvent.clear(paid); await userEvent.type(paid, '45,67');
  await act(async () => pending.resolve(json({ order: savedOrder() })));
  expect(screen.getByRole('textbox', { name: 'Valor pago (R$)' })).toHaveValue('45,67');
});

test('G5: edits send cents and omit removed items, preserving the editor on error before successful retry', async () => {
  await openManagement();
  await userEvent.click(await screen.findByRole('button', { name: 'Editar pedido' }));
  const paid = screen.getByRole('textbox', { name: 'Valor pago (R$)' });
  await userEvent.clear(paid); await userEvent.type(paid, '12,34');
  const quantity = screen.getByRole('spinbutton', { name: 'Calça Linho – Preto / G' });
  await userEvent.clear(quantity); await userEvent.type(quantity, '0');
  respond('PATCH', '/api/v1/admin/orders/order-internal-1', () => json({ error: { message: 'Conflict saving order' } }, 409));
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  expect(await screen.findByText('Conflict saving order')).toBeVisible();
  expect(paid).toHaveValue('12,34'); expect(quantity).toHaveValue(0);
  expect(JSON.parse(mutations()[0].body)).toEqual({ paidAmountCents: 1234, items: [{ variantId: 'variant-1', quantity: 15 }] });
  respond('PATCH', '/api/v1/admin/orders/order-internal-1', { order: savedOrder() });
  respond('GET', '/api/v1/admin/orders', { orders: [order({ ...savedOrder(), paidAmountCents: 1234, totalCents: 37500, items: [items[0]] })] });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument());
  expect(await screen.findByText(/15 peças/)).toBeVisible();
});

test('G5: cancelling archive does not mutate; confirmed archive disappears after server success', async () => {
  await openManagement();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await userEvent.click(await screen.findByRole('button', { name: 'Arquivar', exact: true }));
  expect(mutations()).toHaveLength(0);
  confirm.mockReturnValue(true);
  respond('DELETE', '/api/v1/admin/orders/order-internal-1', () => new Response(null, { status: 204 }));
  respond('GET', '/api/v1/admin/orders', { orders: [] });
  await userEvent.click(screen.getByRole('button', { name: 'Arquivar', exact: true }));
  expect(await screen.findByText('Nenhum pedido ativo.')).toBeVisible();
  expect(mutations()).toHaveLength(1);
});

test.each([['Catálogo', 'products', { ...catalogProduct(), active: true }], ['Banners', 'banners', { id: 'banner-1', title: 'Novidades', active: true, asset: { url: '/banner.png' } }]])(
  'G6: %s toggles display authoritative reloaded state and recover from failure', async (tab, path, item) => {
    await openManagement();
    respond('GET', `/api/v1/admin/${path}`, { [path]: [item] });
    await userEvent.click(screen.getByRole('button', { name: tab, exact: true }));
    respond('PATCH', `/api/v1/admin/${path}/${item.id}`, { [path === 'products' ? 'product' : 'banner']: { ...item, active: false } });
    respond('GET', `/api/v1/admin/${path}`, { [path]: [{ ...item, active: false }] });
    const label = path === 'products' ? 'Calça Linho' : 'Novidades';
    await userEvent.click(await screen.findByRole('button', { name: `Desativar ${label}` }));
    expect(await screen.findByRole('button', { name: `Ativar ${label}` })).toBeVisible();
    expect(JSON.parse(mutations()[0].body)).toEqual({ active: false });
    respond('PATCH', `/api/v1/admin/${path}/${item.id}`, () => json({ error: { message: 'Toggle failed' } }, 409));
    await userEvent.click(screen.getByRole('button', { name: `Ativar ${label}` }));
    expect(await screen.findByText('Toggle failed')).toBeVisible();
    expect(screen.getByRole('button', { name: `Ativar ${label}` })).toBeVisible();
  },
);

test('G6: an empty administrative listing differs from failure and can recover by refresh', async () => {
  await openManagement();
  respond('GET', '/api/v1/admin/products', { products: [] });
  await userEvent.click(screen.getByRole('button', { name: 'Catálogo', exact: true }));
  expect(await screen.findByText('Nenhum registro encontrado.')).toBeVisible();
  respond('GET', '/api/v1/admin/products', () => json({ error: { message: 'Catalog load failed' } }, 409));
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
  expect(await screen.findByText('Catalog load failed')).toBeVisible();
  respond('GET', '/api/v1/admin/products', { products: [catalogProduct()] });
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
  expect(await screen.findByText('Calça Linho')).toBeVisible();
  expect(screen.queryByText('Catalog load failed')).not.toBeInTheDocument();
});
