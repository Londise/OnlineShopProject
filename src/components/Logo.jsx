import React from "react";

export default function Logo({ onHome }) {
  return onHome ? (
    <button
      className="logo"
      type="button"
      onClick={onHome}
      aria-label="Ferchu Modas, voltar ao início"
    >
      <span>Ferchu</span>
      <small>MODAS</small>
    </button>
  ) : (
    <a className="logo" href="#inicio" aria-label="Ferchu Modas, início">
      <span>Ferchu</span>
      <small>MODAS</small>
    </a>
  );
}