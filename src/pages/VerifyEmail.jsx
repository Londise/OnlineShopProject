import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';

export default function VerifyEmail() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [form, setForm] = useState({ name: '', password: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const { verifyEmail } = useAuthContext();
  const navigate = useNavigate();
  useEffect(() => {
    // Keep the bearer token out of subsequent links, URL copies and history.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);
  const submit = async event => {
    event.preventDefault();
    if (sending) return;
    setSending(true); setError('');
    try {
      await verifyEmail({ token, ...form });
      navigate('/account', { replace: true });
    } catch (failure) {
      setError(failure.message || 'Não foi possível verificar seu e-mail.');
    } finally { setSending(false); }
  };
  return <main className="checkout-main">
    <section className="review" aria-labelledby="verification-title">
      <h1 id="verification-title">Verifique seu e-mail</h1>
      <p>Escolha você mesmo seu nome e senha. Abrir o link não ativa uma conta nem confirma uma senha escolhida por outra pessoa.</p>
      {!/^[A-Za-z0-9_-]{43}$/.test(token) ? <p role="alert">Link inválido. Solicite uma nova verificação na loja.</p>
        : <form className="order-editor" onSubmit={submit}>
          <label>Nome<input required minLength={2} maxLength={120} autoComplete="name" value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          <label>Nova senha<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={form.password}
            onChange={event => setForm({ ...form, password: event.target.value })} /></label>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={sending}>{sending ? 'Aguarde…' : 'Verificar e entrar'}</button>
        </form>}
      <Link to="/">Voltar à loja</Link>
    </section>
  </main>;
}
