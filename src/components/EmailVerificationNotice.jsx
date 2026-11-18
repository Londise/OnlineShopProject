import React, { useEffect } from 'react';
import { Mail } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContext';
import ResendVerification from './ResendVerification';

export default function EmailVerificationNotice() {
  const { user, loading, refreshSession } = useAuthContext();
  const unverified = user?.role === 'CUSTOMER' && !user.emailVerifiedAt;
  useEffect(() => {
    if (!unverified) return;
    const refresh = () => { void refreshSession(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [unverified, refreshSession]);
  if (loading || !unverified) return null;
  return <aside className="email-verification-notice" aria-label="Verificação de e-mail">
    <Mail size={16} aria-hidden="true" />
    <span>Seu e-mail ainda não foi verificado.</span>
    <ResendVerification />
  </aside>;
}
