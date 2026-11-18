import React from 'react';
import { expect, test, vi } from 'vitest';
import { screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Checkout from '../../src/pages/Checkout';
import Cart from '../../src/components/Cart';
import { renderPage } from '../support/render';
import { respond, requests, deferred, json } from '../support/network';
import { cartLine, order, customer } from '../support/fixtures';

const quoteOptions = (price = 21.9) => ({
  originPostalCode: '03031000', pieces: 15, options: [
    { key: 'Correios|PAC|1', company: 'Correios', service: 'PAC', price, days: 5, volumes: 1 },
    { key: 'Jadlog|Jadlog .Package|1', company: 'Jadlog', service: 'Jadlog .Package', price: 25.4, days: 3, volumes: 1 },
  ],
});

function openCheckout(lines = [cartLine()], extra = null, user = null) {
  localStorage.setItem('ferchu-cart', JSON.stringify(lines));
  respond('GET', '/api/v1/auth/me', { user });
  respond('GET', '/api/v1/products', { products: [] });
  return renderPage(<><Checkout />{extra}</>, { path: '/checkout' });
}
const posts = () => requests.filter(request => request.method === 'POST');
const shippingPosts = () => posts().filter(request => request.url.pathname === '/api/v1/shipping/quote');
async function fillCustomer() {
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu nome', exact: true }), 'Ana Silva');
  await userEvent.type(screen.getByRole('textbox', { name: 'WhatsApp', exact: true }), '(11) 99999-8888');
}
async function quoteFreight(cep) {
  await userEvent.click(screen.getByRole('button', { name: 'Transportadora Frete estimado pelo CEP', exact: true }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP', exact: true }), cep);
  await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa', exact: true }));
}

test('unverified signed-in accounts keep their cart but cannot submit an order', async () => {
  openCheckout([cartLine()], null, { ...customer, emailVerifiedAt: null });
  await screen.findByText('Confirme seu e-mail pelo link recebido para enviar este pedido. Seu carrinho está guardado.', { exact: true });
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  const submit = screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true });
  expect(submit).toBeDisabled();
  await userEvent.click(submit);
  expect(posts()).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
});

test('Q1: a direct checkout visit with 9 pieces returns to the store', async () => {
  openCheckout([cartLine({ quantity: 9 })]);
  expect(await screen.findByRole('heading', { name: 'Loja', exact: true })).toBeVisible();
  expect(posts()).toHaveLength(0);
});

test('Q1: a checkout above the 400-piece maximum blocks the order with a notice', async () => {
  openCheckout([cartLine({ quantity: 401, available: 401 })]);
  const submit = screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true });
  expect(submit).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent(/400 peças/);
  expect(posts()).toHaveLength(0);
});

test('Q2: invalid customer data never creates an order', async () => {
  openCheckout();
  const submit = screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true });
  expect(submit).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent(/nome/);
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu nome', exact: true }), 'Ana');
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent(/WhatsApp/);
  await userEvent.type(screen.getByRole('textbox', { name: 'WhatsApp', exact: true }), '11999998888');
  await userEvent.type(screen.getByRole('textbox', { name: 'E-mail (opcional)', exact: true }), 'invalid');
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent(/e-mail/);
  expect(posts()).toHaveLength(0);
});

test('Q4/Q5: a pending submission creates one order using IDs and quantities, then preserves confirmation', async () => {
  const pending = deferred();
  respond('POST', '/api/v1/orders', () => pending.promise);
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  await userEvent.dblClick(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0].body)).toEqual({
    customer: { name: 'Ana Silva', whatsapp: '(11) 99999-8888' },
    delivery: { method: 'EXCURSAO' }, items: [{ variantId: 'variant-1', quantity: 15 }],
  });
  await act(async () => pending.resolve(json({ order: order({ deliveryMethod: 'EXCURSAO', shippingAmountCents: null, totalCents: 37500 }) })));
  expect(screen.getByRole('heading', { name: 'Pedido recebido', exact: true })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('FM-20261111-ABC12345');
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))).toEqual([]);
  const link = screen.getByRole('link', { name: 'Abrir WhatsApp', exact: true });
  const url = new URL(link.href);
  expect(url.pathname).toBe('/api/v1/whatsapp');
  expect(url.searchParams.get('text')).toContain('FM-20261111-ABC12345');
  expect(posts()).toHaveLength(1);
});

test('Q6: rejected creation keeps cart data and does not open a confirmation link', async () => {
  respond('POST', '/api/v1/orders', () => json({ error: { code: 'INSUFFICIENT_STOCK', message: 'Estoque insuficiente' } }, 409));
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Estoque insuficiente');
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
  expect(screen.queryByRole('link', { name: 'Abrir WhatsApp', exact: true })).not.toBeInTheDocument();
  expect(posts()).toHaveLength(1);
});

test('Q3: changing CEP invalidates the previous shipping quote and re-quotes with the new one', async () => {
  respond('POST', '/api/v1/shipping/quote', quoteOptions(21.9));
  openCheckout();
  await quoteFreight('39999999');
  const submit = screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true });
  expect(screen.getByText(/^R\$\s*21,90$/)).toBeVisible();
  expect(submit).toBeEnabled();
  expect(JSON.parse(shippingPosts().at(-1).body)).toEqual({ postalCode: '39999-999', pieces: 15 });
  await userEvent.clear(screen.getByRole('textbox', { name: 'Seu CEP', exact: true }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Seu CEP', exact: true }), '40000000');
  expect(submit).toBeDisabled();
  expect(screen.queryByText(/^R\$\s*21,90$/)).not.toBeInTheDocument();
  respond('POST', '/api/v1/shipping/quote', quoteOptions(26.72));
  await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa', exact: true }));
  expect(screen.getByText(/^R\$\s*26,72$/)).toBeVisible();
});

test('Q3: changing cart quantity invalidates a previously calculated quote', async () => {
  respond('POST', '/api/v1/shipping/quote', quoteOptions(21.9));
  openCheckout([cartLine()], <Cart onProceed={() => {}} />);
  await quoteFreight('39999999');
  expect(screen.getByText(/^R\$\s*21,90$/)).toBeVisible();
  await userEvent.click(within(screen.getByRole('complementary', { name: 'Seu pedido', exact: true })).getByRole('button', { name: 'Aumentar', exact: true }));
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeDisabled();
  expect(screen.queryByText(/^R\$\s*21,90$/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa', exact: true }));
  expect(JSON.parse(shippingPosts().at(-1).body).pieces).toBe(16);
});

test.each(['CEP', 'quantity', 'delivery method'])('Q3: changing %s while quoting discards the pending response', async change => {
  const pending = deferred();
  respond('POST', '/api/v1/shipping/quote', () => pending.promise);
  openCheckout([cartLine()], <Cart onProceed={() => {}} />);
  await quoteFreight('39999999');
  if (change === 'CEP') {
    fireEvent.change(screen.getByRole('textbox', { name: 'Seu CEP', exact: true }), { target: { value: '01310-100' } });
  } else if (change === 'quantity') {
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Seu pedido', exact: true })).getByRole('button', { name: 'Aumentar', exact: true }));
  } else {
    await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Transportadora Frete estimado pelo CEP', exact: true }));
  }
  await act(async () => pending.resolve(json(quoteOptions())));
  expect(screen.queryByRole('button', { name: /^Correios PAC / })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Calcular estimativa', exact: true })).toBeEnabled();
});

test.each([200, 503])('Q3: an obsolete %s response cannot replace a newer quote or end its loading state', async status => {
  const old = deferred();
  const current = deferred();
  respond('POST', '/api/v1/shipping/quote', () => old.promise);
  openCheckout();
  await quoteFreight('39999999');
  fireEvent.change(screen.getByRole('textbox', { name: 'Seu CEP', exact: true }), { target: { value: '01310-100' } });
  respond('POST', '/api/v1/shipping/quote', () => current.promise);
  const calculate = screen.getByRole('button', { name: 'Calcular estimativa', exact: true });
  expect(calculate).toBeEnabled();
  await userEvent.click(calculate);
  await act(async () => old.resolve(status === 200 ? json(quoteOptions(21.9)) : json({ error: { message: 'Old quote failed' } }, status)));
  expect(screen.getByRole('button', { name: 'Calculando...', exact: true })).toBeDisabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeDisabled();
  await act(async () => current.resolve(json(quoteOptions(35.5))));
  expect(screen.getByRole('button', { name: /^Correios PAC / })).toHaveTextContent('35,50');
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeEnabled();
});

test('Q3: re-quoting clears the previous selection and blocks submission until it completes', async () => {
  respond('POST', '/api/v1/shipping/quote', quoteOptions());
  openCheckout();
  await quoteFreight('39999999');
  const pending = deferred();
  respond('POST', '/api/v1/shipping/quote', () => pending.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Calcular estimativa', exact: true }));
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /^Correios PAC / })).not.toBeInTheDocument();
  await act(async () => pending.resolve(json(quoteOptions(35.5))));
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeEnabled();
});

test('O5: the two quoted options are shown, the cheapest is pre-selected and each is selectable', async () => {
  respond('POST', '/api/v1/shipping/quote', {
    originPostalCode: '03031000', pieces: 15, options: [
      { key: 'Correios|PAC|1', company: 'Correios', service: 'PAC', price: 21.9, days: 5, volumes: 1 },
      { key: 'Jadlog|Jadlog .Package|2', company: 'Jadlog', service: 'Jadlog .Package', price: 25.4, days: 3, volumes: 2 },
    ],
  });
  openCheckout();
  await quoteFreight('39999999');
  expect(screen.getByText('Correios PAC')).toBeVisible();
  expect(screen.getByText('Jadlog Jadlog .Package')).toBeVisible();
  expect(screen.getByText('2 volumes (envios separados)')).toBeVisible();
  expect(screen.getByText('5 dias úteis')).toBeVisible(); // pluralização correta
  expect(screen.getByText('3 dias úteis')).toBeVisible();
  const submit = screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true });
  expect(submit).toBeEnabled();
  expect(screen.getByText(/^R\$\s*396,90$/)).toBeVisible(); // 375,00 + 21,90
  await userEvent.click(screen.getByRole('button', { name: /^Jadlog Jadlog [.]Package / }));
  expect(screen.getByText(/^R\$\s*400,40$/)).toBeVisible(); // 375,00 + 25,40
});

test('O5: an unavailable freight quote surfaces the error and keeps the order blocked', async () => {
  respond('POST', '/api/v1/shipping/quote', () => json({ error: { code: 'SHIPPING_UNAVAILABLE', message: 'Não foi possível consultar o frete agora.' } }, 503));
  openCheckout();
  await quoteFreight('39999999');
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível consultar o frete agora.');
  expect(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true })).toBeDisabled();
  expect(posts().filter(request => request.url.pathname === '/api/v1/orders')).toHaveLength(0);
});

test('Q7: returning to edit does not remove or submit the cart', async () => {
  openCheckout();
  await userEvent.click(screen.getByRole('button', { name: 'Voltar e editar', exact: true }));
  expect(screen.getByRole('heading', { name: 'Loja', exact: true })).toBeVisible();
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
  expect(posts()).toHaveLength(0);
});

test('Q5/Q6: confirmation uses the server freight and submitted items, preserving later cart additions', async () => {
  const pending = deferred();
  respond('POST', '/api/v1/shipping/quote', quoteOptions(21.9));
  respond('POST', '/api/v1/orders', () => pending.promise);
  openCheckout([cartLine({ weight: 0.02 })], <Cart onProceed={() => {}} />);
  await fillCustomer();
  await quoteFreight('39999999');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  expect(JSON.parse(posts().find(request => request.url.pathname === '/api/v1/orders').body).delivery).toEqual({
    method: 'CORREIOS', postalCode: '39999-999', shippingQuote: { company: 'Correios', service: 'PAC', volumes: 1 },
  });
  await userEvent.click(within(screen.getByRole('complementary', { name: 'Seu pedido', exact: true })).getByRole('button', { name: 'Aumentar', exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  await act(async () => pending.resolve(json({ order: order({ shippingAmountCents: 3550, totalCents: 41050 }) })));
  expect(screen.getByRole('heading', { name: 'Pedido recebido', exact: true })).toBeVisible();
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(1);
  const message = new URL(screen.getByRole('link', { name: 'Abrir WhatsApp', exact: true }).href).searchParams.get('text');
  expect(message).toContain('Total de peças: 15');
  expect(message).toContain('Correios'); expect(message).not.toContain('Excursão');
  expect(message).toMatch(/Frete estimado: R\$\s*35,50/);
  expect(message).not.toContain('21,90');
  expect(posts()).toHaveLength(2);
});

test.each([0, null])('Q5: confirmation preserves the server freight amount %s without falling back to the old estimate', async amount => {
  respond('POST', '/api/v1/shipping/quote', quoteOptions());
  respond('POST', '/api/v1/orders', { order: order({ shippingAmountCents: amount }) });
  openCheckout();
  await fillCustomer();
  if (amount === null) await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  else await quoteFreight('39999999');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  const message = new URL((await screen.findByRole('link', { name: 'Abrir WhatsApp', exact: true })).href).searchParams.get('text');
  if (amount === null) {
    expect(message).toContain('Excursão');
    expect(message).not.toContain('Frete estimado');
  } else {
    expect(message).toMatch(/Frete estimado: R\$\s*0,00/);
    expect(message).not.toContain('21,90');
  }
});

test('Q6: timed-out POST preserves the cart and never opens WhatsApp or automatically retries', async () => {
  const started = deferred();
  respond('POST', '/api/v1/orders', () => { started.resolve(); return new Promise(() => {}); });
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  await act(async () => started.promise);
  await act(async () => vi.advanceTimersByTime(95001));
  expect(screen.getByRole('alert')).toHaveTextContent(/demorou/);
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('ferchu-cart'))[0].quantity).toBe(15);
  expect(screen.queryByRole('link', { name: 'Abrir WhatsApp', exact: true })).not.toBeInTheDocument();
});

test('checkout manual retry reuses the submission key after an uncertain response', async () => {
  let calls = 0;
  respond('POST', '/api/v1/orders', () => ++calls === 1
    ? json({ error: { code: 'UNAVAILABLE', message: 'Resposta perdida' } }, 503)
    : json({ order: order() }));
  openCheckout();
  await fillCustomer();
  await userEvent.click(screen.getByRole('button', { name: 'Excursão Sem necessidade de CEP', exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resposta perdida');
  const firstKey = posts()[0].headers.get('Idempotency-Key');
  expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sessionStorage.getItem('ferchu.checkout.submission')).not.toContain('Ana Silva');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido pelo WhatsApp', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Pedido recebido', exact: true })).toBeVisible();
  expect(posts()).toHaveLength(2);
  expect(posts()[1].headers.get('Idempotency-Key')).toBe(firstKey);
  expect(sessionStorage.getItem('ferchu.checkout.submission')).toBeNull();
});
