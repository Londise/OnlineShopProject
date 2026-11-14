import React from 'react';
import { expect, test } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Management from '../../src/pages/Management';
import { renderPage } from '../support/render';
import { respond, requests, deferred, json } from '../support/network';
import { admin, inventory } from '../support/fixtures';

async function openInventory(variants = [inventory()]) {
  respond('GET', '/api/v1/auth/me', { user: admin });
  respond('GET', '/api/v1/admin/orders', { orders: [] });
  respond('GET', '/api/v1/admin/inventory', { variants });
  renderPage(<Management />, { waitForSession: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Estoque' }));
  await userEvent.click(await screen.findByRole('button', { name: /Calça Linho/ }));
  await userEvent.click(screen.getByRole('button', { name: /Preto/ }));
  return screen.getByRole('spinbutton', { name: 'Novo estoque de LINHO-PRETO-M' });
}
const mutations = () => requests.filter(request => request.method === 'POST');

test('G2: stock adjustment displays authoritative inventory returned by the API', async () => {
  const pending = deferred();
  respond('POST', '/api/v1/admin/inventory/variant-1/adjust', () => pending.promise);
  const input = await openInventory();
  await userEvent.type(input, '35');
  await userEvent.dblClick(screen.getByRole('button', { name: 'Definir', exact: true }));
  expect(mutations()).toHaveLength(1);
  expect(JSON.parse(mutations()[0].body)).toEqual({ delta: 5, reason: expect.any(String) });
  // Another reservation/adjustment happened on the server in the meantime.
  pending.resolve(json({ inventory: { productVariantId: 'variant-1', onHand: 33, reserved: 9, available: 24 } }));
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveAttribute('placeholder', '33');
  expect(screen.getByText('LINHO-PRETO-M')).toBeVisible();
  expect(screen.getByText('9', { selector: 'strong' })).toBeVisible();
  expect(screen.getByText('24', { selector: '.inventory-size-stock strong' })).toBeVisible();
});

test.each(['', ' ', '-1', '1.5'])('G1: invalid stock %j cannot be submitted with Enter', async value => {
  const input = await openInventory();
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mutations()).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Definir', exact: true })).toBeDisabled();
});

test('G1: unchanged stock is a no-op and stock below reservations cannot be submitted', async () => {
  const input = await openInventory();
  await userEvent.type(input, '30{Enter}');
  expect(mutations()).toHaveLength(0);
  expect(input).toHaveValue(null);
  await userEvent.type(input, '4{Enter}');
  expect(mutations()).toHaveLength(0);
  expect(await screen.findByText(/abaixo do reservado/)).toBeVisible();
});

test('G1: explicit zero clears unreserved physical stock', async () => {
  respond('POST', '/api/v1/admin/inventory/variant-1/adjust', { inventory: { onHand: 0, reserved: 0, available: 0 } });
  const input = await openInventory([inventory({ reserved: 0, available: 30 })]);
  await userEvent.type(input, '0{Enter}');
  await waitFor(() => expect(input).toHaveAttribute('placeholder', '0'));
  expect(JSON.parse(mutations()[0].body).delta).toBe(-30);
});

test('G2: rejected adjustment preserves editable quantity for correction', async () => {
  respond('POST', '/api/v1/admin/inventory/variant-1/adjust', () => json({ error: { code: 'INSUFFICIENT_STOCK', message: 'Estoque reservado' } }, 409));
  const input = await openInventory();
  await userEvent.type(input, '35{Enter}');
  expect(await screen.findByText('Estoque reservado')).toBeVisible();
  expect(input).toHaveValue(35);
  expect(input).toBeEnabled();
  expect(input).toHaveAttribute('placeholder', '30');
});

test('G3: batch retry does not repeat adjustments already accepted', async () => {
  let secondAttempts = 0;
  respond('POST', '/api/v1/admin/inventory/variant-1/adjust', { inventory: { onHand: 40, reserved: 5, available: 35 } });
  respond('POST', '/api/v1/admin/inventory/variant-2/adjust', () => {
    secondAttempts++;
    return secondAttempts === 1 ? json({ error: { message: 'Conflict' } }, 409)
      : json({ inventory: { onHand: 40, reserved: 0, available: 40 } });
  });
  await openInventory([inventory(), inventory({ id: 'variant-2', sku: 'LINHO-PRETO-G', size: 'G', reserved: 0, available: 30 })]);
  await userEvent.type(screen.getByPlaceholderText('Novo estoque'), '40');
  await userEvent.click(screen.getByRole('button', { name: 'Definir lote' }));
  expect(await screen.findByText(/aplicado parcialmente/)).toHaveTextContent('G');
  await userEvent.click(screen.getByRole('button', { name: 'Definir lote' }));
  await waitFor(() => expect(screen.getByPlaceholderText('Novo estoque')).toHaveValue(null));
  expect(mutations().map(request => [request.url.pathname, JSON.parse(request.body).delta])).toEqual([
    ['/api/v1/admin/inventory/variant-1/adjust', 10],
    ['/api/v1/admin/inventory/variant-2/adjust', 10],
    ['/api/v1/admin/inventory/variant-2/adjust', 10],
  ]);
});

test('G3: a reservation in any size blocks the entire batch, and unchanged sizes never produce adjustments', async () => {
  await openInventory([inventory({ reserved: 0 }), inventory({ id: 'variant-2', sku: 'LINHO-PRETO-G', size: 'G', onHand: 40, reserved: 5, available: 35 })]);
  const batch = screen.getByPlaceholderText('Novo estoque');
  await userEvent.type(batch, '4');
  await userEvent.click(screen.getByRole('button', { name: 'Definir lote' }));
  expect(mutations()).toHaveLength(0);
  expect(await screen.findByText(/possui 5 unidades reservadas/)).toBeVisible();
  respond('POST', '/api/v1/admin/inventory/variant-2/adjust', { inventory: { onHand: 30, reserved: 5, available: 25 } });
  await userEvent.clear(batch); await userEvent.type(batch, '30');
  await userEvent.click(screen.getByRole('button', { name: 'Definir lote' }));
  await waitFor(() => expect(batch).toHaveValue(null));
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.pathname).toBe('/api/v1/admin/inventory/variant-2/adjust');
  expect(JSON.parse(mutations()[0].body).delta).toBe(-10);
});
