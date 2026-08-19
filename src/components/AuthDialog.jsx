import React, { useState } from "react";
import { X } from "lucide-react";

export default function AuthDialog({ auth, onClose, onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSending(true);
    try {
      const user =
        mode === "login" ? await auth.login(form) : await auth.register(form);
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="overlay auth-overlay" onMouseDown={onClose}>
      <section
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "Entrar" : "Criar conta"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-close" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
        <span className="eyebrow">FERCHU MODAS</span>
        <h2>{mode === "login" ? "Entrar na sua conta" : "Criar sua conta"}</h2>
        <p>
          {mode === "login"
            ? "Acompanhe seus pedidos quando quiser."
            : "Seu cadastro é rápido e gratuito."}
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              Nome
              <input
                required
                value={form.name}
                maxLength="120"
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
          )}
          <label>
            E-mail
            <input
              required
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />
          </label>
          <label>
            Senha
            <input
              required
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength="10"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={sending}>
            {sending ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
        <button
          className="text-button auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}
        </button>
      </section>
    </div>
  );
}
