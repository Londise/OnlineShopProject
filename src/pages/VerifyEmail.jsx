import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CircleAlert, LoaderCircle, MailCheck } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';
import AuthDialog from '../components/AuthDialog';
import ResendVerification from '../components/ResendVerification';

export default function VerifyEmail() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const activeToken = useRef(token);
  const [state, setState] = useState('checking');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [showLogin, setShowLogin] = useState(false);
  const request = useRef(null);
  const auth = useAuthContext();
  const { user, verifyEmail } = auth;
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  useEffect(() => {
    const captureLink = () => {
      const incoming = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (incoming && incoming !== activeToken.current) {
        activeToken.current = incoming;
        setToken(incoming);
        setState('checking');
        setError('');
      }
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    };
    captureLink();
    // Opening a resent link in this tab may be a hash-only navigation, not a
    // component remount. Capture the new token without persisting it in storage.
    window.addEventListener('hashchange', captureLink);
    window.addEventListener('popstate', captureLink);
    return () => {
      window.removeEventListener('hashchange', captureLink);
      window.removeEventListener('popstate', captureLink);
    };
  }, []);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    // StrictMode may replay effects, but must not consume a single-use link twice.
    if (request.current?.attempt !== attempt || request.current?.token !== token)
      request.current = { attempt, token, promise: verifyEmail({ token }) };
    request.current.promise.then(() => {
      if (active) setState('success');
    }, failure => {
      if (!active) return;
      setError(failure.message || 'Não foi possível verificar seu e-mail.');
      setState(failure.code === 'VERIFICATION_SIGN_IN_REQUIRED' ? 'signin' : 'error');
    });
    return () => { active = false; };
  }, [attempt, token, valid, verifyEmail]);
  const success = state === 'success' || (!valid && user?.role === 'CUSTOMER' && Boolean(user.emailVerifiedAt));
  const invalid = !valid && !success;
  const failed = invalid || state === 'error' || state === 'signin';
  const Icon = success ? BadgeCheck : failed ? CircleAlert : LoaderCircle;
  return <main className="verification-page">
    <Link className="verification-brand" to="/" aria-label="Ferchu Modas, início">Ferchu <small>MODAS</small></Link>
    <section className={`verification-card ${success ? 'verified' : ''}`} aria-labelledby="verification-title">
      <div className={`verification-icon ${!failed && !success ? 'checking' : ''}`}><Icon size={42} aria-hidden="true" /></div>
      <span className="eyebrow">SUA CONTA, MAIS SEGURA</span>
      <h1 id="verification-title">{success ? 'E-mail verificado!' : state === 'signin' ? 'Só falta entrar na sua conta' : failed ? 'Vamos tentar de novo?' : 'Confirmando seu e-mail…'}</h1>
      {success ? <>
        <p>Tudo certo! Seu e-mail foi confirmado e todos os recursos da sua conta estão liberados.</p>
        <div className="verification-detail"><MailCheck size={20} aria-hidden="true" />Seu nome e sua senha continuam os mesmos.</div>
        <Link className="button primary" to={user ? '/account' : '/'}>{user ? 'Ir para minha conta' : 'Voltar à loja'}</Link>
        {!user && <p className="verification-hint">Entre na loja com a senha que você escolheu no cadastro.</p>}
      </> : failed ? <>
        <p role="alert">{invalid ? 'Link inválido ou ausente. Solicite outro e-mail de verificação na sua conta.' : error}</p>
        {state === 'signin' && <p>Use a senha que você já escolheu. Não é preciso criar outra.</p>}
        {user?.role === 'CUSTOMER' && !user.emailVerifiedAt && state !== 'signin' ? <ResendVerification />
          : <button className="button primary" onClick={() => setShowLogin(true)}>Entrar na minha conta</button>}
        <Link className="verification-back" to="/">Voltar à loja</Link>
      </> : <p role="status">Só um instante. Estamos cuidando da confirmação com segurança.</p>}
    </section>
    <p className="verification-footer">Feito para vestir bem. Feito para você.</p>
    {showLogin && <AuthDialog auth={auth} onClose={() => setShowLogin(false)} onAuthenticated={() => {
      setShowLogin(false);
      if (valid && state === 'signin') { setState('checking'); setAttempt(value => value + 1); }
    }} />}
  </main>;
}
