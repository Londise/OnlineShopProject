import React from "react";
import Logo from "./Logo";
import { Instagram, Facebook, Send } from "lucide-react";

export default function Footer({ onHome }) {
  return (
    <footer>
      <Logo onHome={onHome} />
      <p>Moda feminina no atacado, pensada para a sua revenda.</p>
      <div>
        <a
          href="https://instagram.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Instagram"
        >
          <Instagram />
        </a>
        <a
          href="https://facebook.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Facebook"
        >
          <Facebook />
        </a>
        <a
          href="https://wa.me/"
          target="_blank"
          rel="noreferrer"
          aria-label="WhatsApp"
        >
          <Send />
        </a>
      </div>
      <small className="copyright">
        © {new Date().getFullYear()} Ferchu Modas. Todos os direitos reservados.
      </small>
    </footer>
  );
}