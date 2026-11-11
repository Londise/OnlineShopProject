import React from "react";

export default function StorefrontLoading() {
  return (
    <div className="storefront-loading" role="status" aria-live="polite">
      <div className="storefront-loading-brand" aria-hidden="true">
        <span className="storefront-loading-flower">✳</span>
        <span className="storefront-loading-name">Ferchu</span>
        <span className="storefront-loading-label">MODAS</span>
        <span className="storefront-loading-rule" />
        <span className="storefront-loading-caption">Feito para vestir bem.</span>
        <span className="storefront-loading-dots"><i /><i /><i /></span>
      </div>
      <span className="visually-hidden">Preparando a loja.</span>
    </div>
  );
}
