import React, { useState } from 'react';
import { test, expect } from 'vitest';
import { act, renderHook, waitFor, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import useAuth from '../../src/hooks/useAuth';
import AuthDialog from '../../src/components/AuthDialog';
import { respond, deferred, json, requests } from '../support/network';
import { customer } from '../support/fixtures';

test.each(['login', 'register'])('S7: an older session refresh cannot overwrite a successful %s', async method => {
  const pending = deferred();
  respond('GET', '/api/v1/auth/me', () => pending.promise);
  respond('POST', `/api/v1/auth/${method}`, { user: customer });
  const { result } = renderHook(() => useAuth());
  await act(async () => { await result.current[method]({ name: customer.name, email: customer.email, password: 'test-password-42' }); });
  expect(result.current.user).toEqual(customer);
  await act(async () => pending.resolve(json({ user: null })));
  expect(result.current.user).toEqual(customer);
  expect(result.current.loading).toBe(false);
});

test('S7: a refresh started before logout cannot restore the logged-out user', async () => {
  const pending = deferred();
  respond('GET', '/api/v1/auth/me', { user: customer });
  respond('POST', '/api/v1/auth/logout', () => new Response(null, { status: 204 }));
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.user).toEqual(customer));
  respond('GET', '/api/v1/auth/me', () => pending.promise);
  let refresh;
  act(() => { refresh = result.current.refreshSession(); });
  await act(async () => { await result.current.logout(); });
  await act(async () => { pending.resolve(json({ user: customer })); await refresh; });
  expect(result.current.user).toBe(null);
});

test('S7: unavailable session refresh preserves a known user and offers a recoverable error', async () => {
  respond('GET', '/api/v1/auth/me', { user: customer });
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.user).toEqual(customer));
  respond('GET', '/api/v1/auth/me', () => json({ error: { message: 'Temporariamente indisponível' } }, 500));
  await act(async () => { await result.current.refreshSession(); });
  expect(result.current.user).toEqual(customer);
  expect(result.current.error).toBe('Temporariamente indisponível');
  respond('GET', '/api/v1/auth/me', { user: customer });
  await act(async () => { await result.current.refreshSession(); });
  expect(result.current.error).toBe('');
});

function SignIn() {
  const auth = useAuth();
  const [authenticated, setAuthenticated] = useState(null);
  return authenticated ? <h1>{authenticated.name}</h1>
    : <AuthDialog auth={auth} onClose={() => {}} onAuthenticated={setAuthenticated} />;
}
test('S8: login errors remain editable, and pending resubmission creates only one request', async () => {
  respond('GET', '/api/v1/auth/me', { user: null });
  respond('POST', '/api/v1/auth/login', () => json({ error: { message: 'Credenciais inválidas' } }, 401));
  render(<SignIn />);
  await userEvent.type(screen.getByRole('textbox', { name: 'E-mail' }), customer.email);
  await userEvent.type(screen.getByLabelText('Senha'), 'test-password-42');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Credenciais inválidas');
  const pending = deferred();
  respond('POST', '/api/v1/auth/login', () => pending.promise);
  await userEvent.dblClick(screen.getByRole('button', { name: 'Entrar', exact: true }));
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(2); // rejected + pending
  expect(screen.getByRole('button', { name: 'Aguarde…' })).toBeDisabled();
  await act(async () => pending.resolve(json({ user: customer })));
  expect(screen.getByRole('heading', { name: customer.name })).toBeVisible();
});
