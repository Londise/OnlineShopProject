import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.auth.me().then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const login = async (data) => { const result = await api.auth.login(data); setUser(result.user); return result.user; };
  const register = async (data) => { const result = await api.auth.register(data); setUser(result.user); return result.user; };
  const logout = async () => { await api.auth.logout(); setUser(null); };
  return { user, loading, login, register, logout };
}
