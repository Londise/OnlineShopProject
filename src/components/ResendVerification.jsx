import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

export default function ResendVerification() {
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    if (state !== 'sent') return;
    const timeout = setTimeout(() => setState('idle'), 60_000);
    return () => clearTimeout(timeout);
  }, [state]);
  const resend = async () => {
    if (pending.current || state === 'sent') return;
    pending.current = true;
    setState('sending'); setMessage('');
    try {
      const result = await api.auth.resendVerification();
      setState('sent'); setMessage(result.message);
    } catch (error) {
      setState('error'); setMessage(error.message || 'Não foi possível reenviar. Tente novamente.');
    } finally { pending.current = false; }
  };
  return <span className="verification-resend">
    <button type="button" className="text-button" onClick={resend} disabled={state === 'sending' || state === 'sent'}>
      {state === 'sending' ? 'Enviando…' : state === 'sent' ? 'E-mail enviado' : 'Reenviar e-mail'}
    </button>
    {message && <span role={state === 'error' ? 'alert' : 'status'}>{message}</span>}
  </span>;
}
