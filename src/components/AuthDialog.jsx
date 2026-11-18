import React, { useState, useRef } from "react";
import useDialogFocus from '../hooks/useDialogFocus';
import { X } from "lucide-react";

export default function AuthDialog({ auth, onClose, onAuthenticated }) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSending(true);
    try {
      if (mode === "login") onAuthenticated(await auth.login(form));
      else {
        const result = await auth.register(form);
        setNotice(result.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="overlay auth-overlay" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
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
            : "Escolha seus dados agora. Depois, confirme seu e-mail para liberar todos os recursos."}
        </p>
        <form onSubmit={submit}>
          {mode === "register" && <label>
            Nome
            <input required minLength={2} maxLength={120} autoComplete="name" value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })} />
          </label>}
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
              minLength={mode === "register" ? 10 : undefined}
              maxLength={128}
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
          </label>
          {notice && <p role="status">{notice}</p>}
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
            setNotice("");
          }}
        >
          {mode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}
        </button>
      </section>
    </div>
  );
}
