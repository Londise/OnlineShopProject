import React, { StrictMode } from 'react';
import { test, expect } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import VerifyEmail from '../../src/pages/VerifyEmail';
import AppLayout from '../../src/layouts/AppLayout';
import Account from '../../src/pages/Account';
import { respond, requests, json, deferred } from '../support/network';
import { customer, admin } from '../support/fixtures';

function openVerification(token = 'A'.repeat(43)) {
  window.history.replaceState({}, '', `/verify-email#token=${token}`);
  render(<StrictMode><MemoryRouter initialEntries={['/verify-email']}><AuthProvider>
    <VerifyEmail />
  </AuthProvider></MemoryRouter></StrictMode>);
}
const verificationPosts = () => requests.filter(r => r.url.pathname === '/api/v1/auth/verify-email');

test('opening a valid link confirms only its token, once in StrictMode, shows success and never asks for new credentials', async () => {
  respond('GET', '/api/v1/auth/me', { user: customer });
  respond('POST', '/api/v1/auth/verify-email', { verified: true });
  openVerification();
  expect(window.location.hash).toBe('');
  expect(await screen.findByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Nome', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ir para minha conta', exact: true })).toHaveAttribute('href', '/account');
  expect(verificationPosts()).toHaveLength(1);
  expect(verificationPosts()[0].url.search).toBe('');
  expect(JSON.parse(verificationPosts()[0].body)).toEqual({ token: 'A'.repeat(43) });
});

test('expired links show a recoverable resend action for signed-in unverified customers without granting verification', async () => {
  respond('GET', '/api/v1/auth/me', { user: { ...customer, emailVerifiedAt: null } });
  respond('POST', '/api/v1/auth/verify-email', () => json({ error: { message: 'Link vencido' } }, 422));
  respond('POST', '/api/v1/auth/resend-verification', { message: 'Confira o novo e-mail' });
  openVerification();
  expect(await screen.findByRole('alert')).toHaveTextContent('Link vencido');
  await userEvent.click(screen.getByRole('button', { name: 'Reenviar e-mail', exact: true }));
  expect(await screen.findByRole('status')).toHaveTextContent('Confira o novo e-mail');
  expect(screen.queryByRole('heading', { name: 'E-mail verificado!', exact: true })).not.toBeInTheDocument();
});

test('a resent link opened in the same tab replaces the expired token without remounting or persisting it', async () => {
  respond('GET', '/api/v1/auth/me', { user: { ...customer, emailVerifiedAt: null } });
  respond('POST', '/api/v1/auth/verify-email', () => json({ error: { message: 'Link vencido' } }, 422));
  openVerification();
  expect(await screen.findByRole('alert')).toHaveTextContent('Link vencido');
  respond('POST', '/api/v1/auth/verify-email', { verified: true });
  respond('GET', '/api/v1/auth/me', { user: customer });
  await act(async () => {
    window.history.replaceState({}, '', `/verify-email#token=${'B'.repeat(43)}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(await screen.findByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
  expect(verificationPosts().map(request => JSON.parse(request.body).token)).toEqual(['A'.repeat(43), 'B'.repeat(43)]);
  expect(window.location.hash).toBe('');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test('a different browser signs in with the original password and then confirms, without a password reset', async () => {
  let currentUser = null, attempts = 0;
  respond('GET', '/api/v1/auth/me', () => json({ user: currentUser }));
  respond('POST', '/api/v1/auth/verify-email', () => {
    if (attempts++ === 0) return json({ error: { code: 'VERIFICATION_SIGN_IN_REQUIRED', message: 'Entre na sua conta' } }, 403);
    currentUser = customer;
    return json({ verified: true });
  });
  respond('POST', '/api/v1/auth/login', () => {
    currentUser = { ...customer, emailVerifiedAt: null };
    return json({ user: currentUser });
  });
  openVerification();
  await userEvent.click(await screen.findByRole('button', { name: 'Entrar na minha conta', exact: true }));
  const dialog = screen.getByRole('dialog', { name: 'Entrar', exact: true });
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'E-mail', exact: true }), customer.email);
  await userEvent.type(within(dialog).getByLabelText('Senha', { exact: true }), 'original-password-42');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Entrar', exact: true }));
  expect(await screen.findByRole('heading', { name: 'E-mail verificado!', exact: true })).toBeVisible();
  expect(verificationPosts()).toHaveLength(2);
  expect(verificationPosts().every(r => !r.body.includes('password'))).toBe(true);
});

test('a malformed verification fragment never submits or renders a credential-creation form', async () => {
  respond('GET', '/api/v1/auth/me', { user: null });
  openVerification('bad');
  expect(screen.getByRole('alert')).toHaveTextContent('Link inválido');
  expect(verificationPosts()).toHaveLength(0);
  expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
});

function openLayout(user, children = <h1>Loja</h1>) {
  respond('GET', '/api/v1/auth/me', { user });
  return render(<MemoryRouter><AuthProvider><Routes><Route element={<AppLayout />}>
    <Route path="/" element={children} />
  </Route></Routes></AuthProvider></MemoryRouter>);
}
test.each([null, customer, admin, { ...admin, role: 'STAFF' }])('the verification header stays hidden for guests, verified customers and managed roles: %j', async user => {
  openLayout(user);
  await waitFor(() => expect(requests.some(r => r.url.pathname === '/api/v1/auth/me')).toBe(true));
  expect(screen.queryByRole('complementary', { name: 'Verificação de e-mail', exact: true })).not.toBeInTheDocument();
});

test('only a signed-in unverified customer sees the small header; resend prevents duplicates and focus refresh removes it after verification', async () => {
  const pending = deferred();
  respond('POST', '/api/v1/auth/resend-verification', () => pending.promise);
  openLayout({ ...customer, emailVerifiedAt: null });
  const banner = await screen.findByRole('complementary', { name: 'Verificação de e-mail', exact: true });
  await userEvent.dblClick(within(banner).getByRole('button', { name: 'Reenviar e-mail', exact: true }));
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
  pending.resolve(json({ message: 'Confira seu e-mail' }));
  expect(await within(banner).findByRole('status')).toHaveTextContent('Confira seu e-mail');
  respond('GET', '/api/v1/auth/me', { user: customer });
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Verificação de e-mail', exact: true })).not.toBeInTheDocument());
});

test('unverified account UI does not request or display order history', async () => {
  openLayout({ ...customer, emailVerifiedAt: null }, <Account />);
  expect(await screen.findByText('Confirme seu e-mail para liberar o histórico e enviar pedidos pela sua conta.', { exact: true })).toBeVisible();
  expect(requests.some(r => r.url.pathname === '/api/v1/orders/me')).toBe(false);
  expect(screen.queryByText('Ir para o Gestor de Estoque', { exact: true })).not.toBeInTheDocument();
});
