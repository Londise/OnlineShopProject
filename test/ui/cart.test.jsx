import React, { useState } from 'react';
import { test, expect, vi } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartProvider, useCartContext } from '../../src/contexts/CartContext';
import Builder from '../../src/components/BuilderModalButton';
import Cart from '../../src/components/Cart';
import { respond, requests, deferred, json } from '../support/network';
import { cartLine, catalogProduct } from '../support/fixtures';
import useCatalog from '../../src/hooks/useCatalog';

const product = { id: 'product-1', name: 'Calça Linho', price: 25, weight: 0.4, image: '/pants.jpg', images: ['/pants.jpg'], options: [
  { name: 'Preto', variants: [{ id: 'variant-1', size: 'M', price: 25, available: 30 }, { id: 'variant-2', size: '48', price: 30, available: 2 }] },
  { name: 'Rose', variants: [{ id: 'variant-3', size: '48', price: 0, available: 3 }] },
] };
function Shop({ catalog = product }) {
  const [open, setOpen] = useState(true);
  const { totalWeight } = useCartContext();
  return <>
    <output aria-label="Peso">{totalWeight}</output>
    {open && <Builder product={catalog} showToast={() => {}} onClose={() => setOpen(false)} />}
    <Cart onProceed={() => setOpen(false)} />
  </>;
}
function openShop(catalog) {
  respond('GET', '/api/v1/products', { products: [] });
  return render(<CartProvider><Shop catalog={catalog} /></CartProvider>);
}

test('C6/C10: restored quantities drive subtotal, weight and the 15-piece checkout boundary', async () => {
  localStorage.setItem('ferchu-cart', JSON.stringify([cartLine({ quantity: 14 })]));
  const view = openShop();
  const cart = within(screen.getByRole('complementary', { name: 'Seu pedido' }));
  expect(cart.getByRole('button', { name: /Faltam 1 peças/ })).toBeDisabled();
  expect(cart.getByText(/350,00/)).toBeVisible();
  await userEvent.click(cart.getByRole('button', { name: 'Aumentar' }));
  expect(cart.getByRole('button', { name: 'Continuar pedido' })).toBeEnabled();
  expect(cart.getByText(/375,00/)).toBeVisible();
  expect(screen.getByLabelText('Peso')).toHaveTextContent('6');
  view.unmount();
  openShop();
  expect(screen.getByRole('heading', { name: '15 peças' })).toBeVisible();
  await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Diminuir' }));
  expect(screen.getByRole('button', { name: /Faltam 1 peças/ })).toBeDisabled();
});

test('C8/C9: custom sizes respect remaining stock and changing color clears the selection', async () => {
  openShop();
  const dialog = within(screen.getByRole('dialog'));
  const quantity = dialog.getByRole('textbox', { name: 'Quantidade tamanho 48' });
  await userEvent.type(quantity, '9');
  expect(quantity).toHaveValue('2');
  await userEvent.click(dialog.getByRole('button', { name: 'Adicionar 2 peças' }));
  expect(screen.getByRole('heading', { name: '2 peças' })).toBeVisible();
  expect(quantity).toHaveValue('');
  expect(dialog.getByRole('button', { name: 'Adicionar ao pedido' })).toBeDisabled();
  await userEvent.click(dialog.getByRole('button', { name: 'Rose' }));
  await userEvent.type(quantity, '1');
  await userEvent.click(dialog.getByRole('button', { name: 'Preto' }));
  expect(quantity).toHaveValue('');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '2 peças' })).toBeVisible();
});

test('C8: an empty option list cannot add an invalid line', () => {
  openShop({ ...product, options: [] });
  expect(screen.getByRole('button', { name: 'Adicionar ao pedido' })).toBeDisabled();
  expect(screen.queryByRole('textbox', { name: /Quantidade tamanho/ })).not.toBeInTheDocument();
});

test.each(['{broken', 'null'])('C6: malformed persisted cart %j does not prevent shopping', async stored => {
  localStorage.setItem('ferchu-cart', stored);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  openShop();
  await userEvent.type(screen.getByRole('textbox', { name: 'Quantidade tamanho M' }), '1');
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar 1 peça' }));
  expect(screen.getByRole('heading', { name: '1 peça' })).toBeVisible();
  if (stored === '{broken') expect(error).toHaveBeenCalledWith(expect.any(String), expect.any(SyntaxError));
});

test('C6: unavailable localStorage cannot prevent cart updates', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
  openShop();
  await userEvent.type(screen.getByRole('textbox', { name: 'Quantidade tamanho M' }), '1');
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar 1 peça' }));
  expect(screen.getByRole('heading', { name: '1 peça' })).toBeVisible();
  expect(error).toHaveBeenCalled();
});

function CatalogConsumer() {
  const { products } = useCatalog();
  return <output aria-label="Catálogo compartilhado">{products.length}</output>;
}
function Reconciliation() {
  const [catalogVisible, setCatalogVisible] = useState(true);
  const { lines, qtyTotal, orderTotal, totalWeight } = useCartContext();
  return <>
    <button onClick={() => setCatalogVisible(false)}>Fechar catálogo</button>
    {catalogVisible && <CatalogConsumer />}
    <output aria-label="Resumo persistido">{JSON.stringify({ lines, qtyTotal, orderTotal, totalWeight })}</output>
  </>;
}
test('C7: unmounting a shared catalog consumer does not cancel cart image reconciliation or change commercial data', async () => {
  localStorage.setItem('ferchu-cart', JSON.stringify([cartLine()]));
  const pending = deferred();
  respond('GET', '/api/v1/products', () => pending.promise);
  render(<CartProvider><Reconciliation /></CartProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Fechar catálogo' }));
  expect(requests.filter(request => request.url.pathname === '/api/v1/products')).toHaveLength(1);
  await act(async () => pending.resolve(json({ products: [catalogProduct({ priceCents: 9999, weightGrams: 900,
    images: [{ id: 'new-cover', type: 'PRIMARY', url: '/reconciled.png' }] })] })));
  const state = JSON.parse(screen.getByLabelText('Resumo persistido').textContent);
  expect([state.qtyTotal, state.orderTotal, state.totalWeight]).toEqual([15, 375, 6]);
  expect(state.lines[0].image).toBe('/reconciled.png');
  expect(state.lines[0].available).toBe(30);
});

test('C7: failed catalog reconciliation does not discard restored quantities or images', async () => {
  localStorage.setItem('ferchu-cart', JSON.stringify([cartLine()]));
  respond('GET', '/api/v1/products', () => json({ error: { message: 'Unavailable catalog' } }, 409));
  render(<CartProvider><Reconciliation /></CartProvider>);
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => {});
  const state = JSON.parse(screen.getByLabelText('Resumo persistido').textContent);
  expect([state.qtyTotal, state.orderTotal, state.totalWeight]).toEqual([15, 375, 6]);
  expect(state.lines[0].image).toBe('/pants.jpg');
});

test('C7: a removed variant keeps restored pieces and commercial totals, replacing only its obsolete image', async () => {
  localStorage.setItem('ferchu-cart', JSON.stringify([cartLine()]));
  respond('GET', '/api/v1/products', { products: [] });
  render(<CartProvider><Reconciliation /></CartProvider>);
  await waitFor(() => expect(JSON.parse(screen.getByLabelText('Resumo persistido').textContent).lines[0].image).not.toBe('/pants.jpg'));
  const state = JSON.parse(screen.getByLabelText('Resumo persistido').textContent);
  expect([state.qtyTotal, state.orderTotal, state.totalWeight]).toEqual([15, 375, 6]);
  expect(state.lines[0].variantId).toBe('variant-1');
});

test('C8/C9: counter buttons respect zero/remaining stock and sold-out variants cannot be added', async () => {
  openShop({ ...product, options: [{ ...product.options[0], variants: product.options[0].variants.map(variant => ({ ...variant, available: variant.size === 'M' ? 0 : 2 })) }] });
  const input = screen.getByRole('textbox', { name: 'Quantidade tamanho 48' });
  const counter = within(input.parentElement);
  expect(counter.getByRole('button', { name: 'Diminuir' })).toBeDisabled();
  await userEvent.click(counter.getByRole('button', { name: 'Aumentar' }));
  await userEvent.click(counter.getByRole('button', { name: 'Aumentar' }));
  expect(input).toHaveValue('2'); expect(counter.getByRole('button', { name: 'Aumentar' })).toBeDisabled();
  await userEvent.click(counter.getByRole('button', { name: 'Diminuir' })); expect(input).toHaveValue('1');
  const soldOut = screen.getByRole('textbox', { name: 'Quantidade tamanho M' });
  expect(within(soldOut.parentElement).getByRole('button', { name: 'Aumentar' })).toBeDisabled();
  await userEvent.type(soldOut, '9'); expect(soldOut).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar 1 peça' }));
  expect(JSON.parse(localStorage.getItem('ferchu-cart')).map(line => [line.variantId, line.quantity])).toEqual([['variant-2', 1]]);
});
