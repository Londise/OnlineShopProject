import React from 'react';
import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import VerifyEmail from '../../src/pages/VerifyEmail';
import { respond, requests, json } from '../support/network';
import { customer } from '../support/fixtures';

function openVerification(token = 'A'.repeat(43)) {
  window.history.replaceState({}, '', `/verify-email#token=${token}`);
  respond('GET', '/api/v1/auth/me', { user: null });
  render(<MemoryRouter initialEntries={['/verify-email']}><AuthProvider><Routes>
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/account" element={<h1>Conta verificada</h1>} />
  </Routes></AuthProvider></MemoryRouter>);
}

test('verification link opening consumes nothing, removes the URL token and lets the owner choose credentials', async () => {
  respond('POST', '/api/v1/auth/verify-email', { user: customer });
  openVerification();
  expect(window.location.hash).toBe('');
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
  await userEvent.type(screen.getByRole('textbox', { name: 'Nome', exact: true }), 'Ana Silva');
  await userEvent.type(screen.getByLabelText('Nova senha', { exact: true }), 'owner-password-42');
  await userEvent.click(screen.getByRole('button', { name: 'Verificar e entrar', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Conta verificada', exact: true })).toBeVisible();
  const request = requests.find(r => r.method === 'POST');
  expect(request.url.pathname).toBe('/api/v1/auth/verify-email');
  expect(request.url.search).toBe('');
  expect(JSON.parse(request.body)).toEqual({ token: 'A'.repeat(43), name: 'Ana Silva', password: 'owner-password-42' });
});

test('invalid links cannot submit, and expired links expose a recoverable error without granting access', async () => {
  respond('POST', '/api/v1/auth/verify-email', () => json({ error: { message: 'Link vencido' } }, 422));
  openVerification();
  await userEvent.type(screen.getByRole('textbox', { name: 'Nome', exact: true }), 'Ana Silva');
  await userEvent.type(screen.getByLabelText('Nova senha', { exact: true }), 'owner-password-42');
  await userEvent.click(screen.getByRole('button', { name: 'Verificar e entrar', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Link vencido');
  expect(screen.queryByRole('heading', { name: 'Conta verificada', exact: true })).not.toBeInTheDocument();
});

test('a malformed verification fragment renders no credential submission form', () => {
  openVerification('bad');
  expect(screen.getByRole('alert')).toHaveTextContent('Link inválido');
  expect(screen.queryByRole('button', { name: 'Verificar e entrar', exact: true })).not.toBeInTheDocument();
});
