import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuthContext } from '../../src/contexts/AuthContext';
import { CartProvider } from '../../src/contexts/CartContext';

function SessionReady({ children }) {
  const { loading } = useAuthContext();
  return loading ? <p role="status">Verificando sessão</p> : children;
}
export function renderPage(page, { path = '/test', waitForSession = false } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><CartProvider>
        <Routes>
          <Route path={path} element={waitForSession ? <SessionReady>{page}</SessionReady> : page} />
          <Route path="/" element={<h1>Loja</h1>} />
        </Routes>
      </CartProvider></AuthProvider>
    </MemoryRouter>,
  );
}
