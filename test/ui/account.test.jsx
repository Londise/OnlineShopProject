import React from 'react';
import { expect, test } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Account from '../../src/pages/Account';
import { renderPage } from '../support/render';
import { respond, deferred, json } from '../support/network';
import { customer, order } from '../support/fixtures';

test('S8: account displays the API total in reais, not an absent total field', async () => {
  respond('GET', '/api/v1/auth/me', { user: customer });
  respond('GET', '/api/v1/orders/me', { orders: [order()] });
  renderPage(<Account />, { waitForSession: true });
  const card = await screen.findByRole('article');
  expect(within(card).getByText(/400,50/)).toBeVisible();
});

test('S8: account identifies orders by their public number', async () => {
  respond('GET', '/api/v1/auth/me', { user: customer });
  respond('GET', '/api/v1/orders/me', { orders: [order({ totalCents: 0 })] });
  renderPage(<Account />, { waitForSession: true });
  const card = await screen.findByRole('article');
  expect(within(card).getByText(/FM-20261111-ABC12345/)).toBeVisible();
  expect(within(card).getByText(/0,00/)).toBeVisible();
});

test('S8: logout waits for revocation before navigating away', async () => {
  const pending = deferred();
  respond('GET', '/api/v1/auth/me', { user: customer });
  respond('GET', '/api/v1/orders/me', { orders: [] });
  respond('POST', '/api/v1/auth/logout', () => pending.promise);
  renderPage(<Account />, { waitForSession: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Sair da conta' }));
  expect(screen.getByRole('heading', { name: /Olá, Ana/ })).toBeVisible();
  pending.resolve(json({ ok: true }));
  expect(await screen.findByRole('heading', { name: 'Loja' })).toBeVisible();
});
