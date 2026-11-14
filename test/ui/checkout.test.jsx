import React from 'react';
import { expect, test, vi } from 'vitest';
import { screen, within, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Checkout from '../../src/pages/Checkout';
import Cart from '../../src/components/Cart';
import { renderPage } from '../support/render';
import { respond, requests, deferred, json } from '../support/network';
import { cartLine, order } from '../support/fixtures';
import { shippingCases } from '../support/shipping-cases';

function openCheckout(lines = [cartLine()], extra = null) {
  localStorage.setItem('ferchu-cart', JSON.stringify(lines));
  respond('GET', '/api/v1/auth/me', { user: null });
  respond('GET', '/api/v1/products', { products: [] });
  return renderPage(<><Checkout />{extra}</>, { path: '/checkout' });
}
const posts = () => requests.filter(request => request.method === 'POST');
async function fillCustomer() {
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana Silva');
  await userEvent.type(screen.getByRole('textbox', { name: 'WhatsApp', exact: true }), '(11) 99999-8888');
}

test('Q1: a direct checkout visit with 14 pieces returns to the store', async () => {
  openCheckout([cartLine({ quantity: 14 })]);
  expect(await screen.findByRole('heading', { name: 'Loja' })).toBeVisible();
  expect(posts()).toHaveLength(0);
});

test('Q2: invalid customer data never creates an order', async () => {
  openCheckout();
  const submit = screen.getByRole('button', { name: /Enviar pedido/ });
  expect(submit).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /Excursão/ }));
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent(/nome/);
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana');
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent(/WhatsApp/);
  await userEvent.type(screen.getByRole('textbox', { name: 'WhatsApp', exact: true }), '11999998888');
  await userEvent.type(screen.getByRole('textbox', { name: /E-mail/ }), 'invalid');
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent(/e-mail/);
  expect(posts()).toHaveLength(0);
});

test('Q4/Q5: a pending submission creates one order using IDs and quantities, then preserves confirmation', async () => {
  const pending = deferred();
  respond('POST', '/api/v1/orders', () => pending.promise);
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: /Excursão/ }));
  await userEvent.dblClick(screen.getByRole('button', { name: /Enviar pedido/ }));
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0].body)).toEqual({
    customer: { name: 'Ana Silva', whatsapp: '(11) 99999-8888' },
    delivery: { method: 'EXCURSAO' }, items: [{ variantId: 'variant-1', quantity: 15 }],
  });
  await act(async () => pending.resolve(json({ order: order() })));
  expect(screen.getByRole('heading', { name: 'Pedido recebido' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('FM-20261111-ABC12345');
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))).toEqual([]);
  const link = screen.getByRole('link', { name: /Abrir WhatsApp/ });
  const url = new URL(link.href);
  expect(url.pathname).toBe('/api/v1/whatsapp');
  expect(url.searchParams.get('text')).toContain('FM-20261111-ABC12345');
  expect(posts()).toHaveLength(1);
});

test('Q6: rejected creation keeps cart data and does not open a confirmation link', async () => {
  respond('POST', '/api/v1/orders', () => json({ error: { code: 'INSUFFICIENT_STOCK', message: 'Estoque insuficiente' } }, 409));
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: /Excursão/ }));
  await userEvent.click(screen.getByRole('button', { name: /Enviar pedido/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Estoque insuficiente');
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
  expect(screen.queryByRole('link', { name: /Abrir WhatsApp/ })).not.toBeInTheDocument();
  expect(posts()).toHaveLength(1);
});

test('Q3/O5: changing CEP invalidates the previous shipping quote', async () => {
  openCheckout([cartLine({ weight: 0.02 })]); // 15 × 20 g = 300 g, billed at 500 g
  await userEvent.click(screen.getByRole('button', { name: /Correios/ }));
  const submit = screen.getByRole('button', { name: /Enviar pedido/ });
  expect(submit).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP' }), '39999999');
  await userEvent.click(screen.getByRole('button', { name: /Calcular estimativa/ }));
  expect(screen.getByText(/21,90/)).toBeVisible(); // (17.5 + .5 × 8.8) × 1
  expect(submit).toBeEnabled();
  await userEvent.clear(screen.getByRole('textbox', { name: 'Seu CEP' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP' }), '40000000');
  expect(submit).toBeDisabled();
  expect(screen.queryByText(/21,90/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Calcular estimativa/ }));
  expect(screen.getByText(/26,72/)).toBeVisible(); // zone 1.22, rounded cents
});

test('Q7: returning to edit does not remove or submit the cart', async () => {
  openCheckout();
  await userEvent.click(screen.getByRole('button', { name: /Voltar e editar/ }));
  expect(screen.getByRole('heading', { name: 'Loja' })).toBeVisible();
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
  expect(posts()).toHaveLength(0);
});

test('Q3: changing cart weight invalidates a previously calculated Correios quote', async () => {
  openCheckout([cartLine({ weight: 0.033 })], <Cart onProceed={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /Correios/ }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP' }), '39999999');
  await userEvent.click(screen.getByRole('button', { name: /Calcular estimativa/ }));
  expect(screen.getByText(/21,90/)).toBeVisible(); // 15 × 33 g = 495 g
  await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Aumentar' }));
  expect(screen.getByRole('button', { name: /Enviar pedido/ })).toBeDisabled();
  expect(screen.queryByText(/21,90/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Calcular estimativa/ }));
  expect(screen.getByText(/^R\$\s*26,30$/)).toBeVisible(); // 16 × 33 g = 528 g, billed at 1 kg
});

test('Q5/Q6: a successful pending order retains its submitted message and leaves later additions in the cart', async () => {
  const pending = deferred();
  respond('POST', '/api/v1/orders', () => pending.promise);
  openCheckout([cartLine({ weight: 0.02 })], <Cart onProceed={() => {}} />);
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: /Correios/ }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP' }), '39999999');
  await userEvent.click(screen.getByRole('button', { name: /Calcular estimativa/ }));
  await userEvent.click(screen.getByRole('button', { name: /Enviar pedido/ }));
  await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Aumentar' }));
  await userEvent.click(screen.getByRole('button', { name: /Excursão/ }));
  await act(async () => pending.resolve(json({ order: order() })));
  expect(screen.getByRole('heading', { name: 'Pedido recebido' })).toBeVisible();
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(1);
  const message = new URL(screen.getByRole('link', { name: /Abrir WhatsApp/ }).href).searchParams.get('text');
  expect(message).toContain('Total de peças: 15');
  expect(message).toContain('Correios'); expect(message).not.toContain('Excursão');
  expect(posts()).toHaveLength(1);
});

test.each(shippingCases)('O5: visible quote for $postalCode and $grams grams agrees with $cents literal cents', async ({ postalCode, grams, cents }) => {
  openCheckout([cartLine({ quantity: 1, weight: grams / 1000 }), cartLine({ key: 'other', variantId: 'other', quantity: 14, weight: 0, price: 0 })]);
  await userEvent.click(screen.getByRole('button', { name: /Correios/ }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP' }), postalCode);
  await userEvent.click(screen.getByRole('button', { name: /Calcular estimativa/ }));
  const display = (cents / 100).toFixed(2).replace('.', ',');
  expect(screen.getByText(new RegExp(`^R\\$\\s*${display}$`))).toBeVisible();
});

test('Q6: timed-out POST preserves the cart and never opens WhatsApp or automatically retries', async () => {
  respond('POST', '/api/v1/orders', () => new Promise(() => {}));
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: /Excursão/ }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: /Enviar pedido/ }));
  await act(async () => vi.advanceTimersByTime(95001));
  expect(screen.getByRole('alert')).toHaveTextContent(/demorou/);
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
  expect(screen.queryByRole('link', { name: /Abrir WhatsApp/ })).not.toBeInTheDocument();
});
