import React, { useState } from "react";
import { X } from "lucide-react";

export default function StorefrontNotice({ messages, onRetry, retrying = false }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <aside className="storefront-notice error" role="alert" aria-atomic="true">
      <strong>Aviso da loja</strong>
      <button
        className="notice-close"
        type="button"
        aria-label="Fechar aviso"
        onClick={() => setDismissed(true)}
      >
        <X size={18} aria-hidden="true" />
      </button>
      <p>{messages.map(message => <span key={message}>{message}</span>)}</p>
      <button
        className="button outline notice-retry"
        type="button"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Tentando novamente…" : "Tentar novamente"}
      </button>
    </aside>
  );
}
