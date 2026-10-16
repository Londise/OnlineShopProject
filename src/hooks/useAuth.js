import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const version = useRef(0);

  const refreshSession = useCallback(async (signal) => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const data = await api.auth.me({ signal });
      if (!signal?.aborted && version.current === current) setUser(data.user);
    } catch (error) {
      // An unavailable backend is not proof that the user has no session.
      if (!signal?.aborted && version.current === current) setError(error.message || "Não foi possível verificar sua sessão.");
    } finally {
      if (!signal?.aborted && version.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshSession(controller.signal);
    return () => controller.abort();
  }, [refreshSession]);

  const acceptUser = (user) => {
    version.current++;
    setUser(user);
    setError("");
    setLoading(false);
  };

  const login = async (data) => {
    const result = await api.auth.login(data);
    acceptUser(result.user);
    return result.user;
  };

  const register = async (data) => {
    const result = await api.auth.register(data);
    acceptUser(result.user);
    return result.user;
  };

  const logout = async () => {
    await api.auth.logout();
    acceptUser(null);
  };
  
  return { user, loading, error, refreshSession, login, register, logout };
}
