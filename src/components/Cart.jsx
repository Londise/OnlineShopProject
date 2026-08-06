import React from "react";
import { useEffect, useState } from "react";

import {
  Trash2,
  X,
  ShoppingBag,
  PackageCheck,
  ArrowRight,
  CircleHelp,
} from "lucide-react";

import Counter from "./Counter";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function Cart({ 
    lines,
    open,
    setOpen,
    onProceed,
    qtyTotal,
    orderTotal,
    changeLine,
    removeLine
 }) {

  const [showFloatingButton, setShowFloatingButton] = useState(false);

  const total = orderTotal;
  const pieces = qtyTotal;

  useEffect(() => {
    const handleScroll = () => {
      setShowFloatingButton(window.scrollY > 100);
    };

    handleScroll(); // Verifica a posição inicial do scroll ao montar o componente

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <>
      {/* Verifica se o botão flutuante deve ser exibido */}
      {console.log("showFloatingButton:", showFloatingButton)}
        {console.log("pieces:", pieces)}
        {console.log("open:", open)}

      {showFloatingButton && pieces > 0 && !open && (
        <button className="mobile-cart" onClick={() => setOpen(true)}>
          <ShoppingBag size={19} />
          <span>{pieces}</span> Ver pedido <b>{money.format(total)}</b>
        </button>
      )}

      <aside className={`cart ${open ? "open" : ""}`} aria-label="Seu pedido">
        <div className="cart-head">
          <div>
            <span className="eyebrow">SEU PEDIDO</span>
            <h2>
              <ShoppingBag size={20} /> {pieces || 0}{" "}
              {pieces === 1 ? "peça" : "peças"}
            </h2>
          </div>
          <button
            className="cart-close"
            onClick={() => setOpen(false)}
            aria-label="Fechar carrinho"
          >
            <X />
          </button>
        </div>
        <div className="cart-lines">
          {/* Se o pedido estiver vazio, mostra a seção de carrinho vazio*/}
          {!lines.length ? (
            <div className="empty-cart">
              <PackageCheck />
              <h3>Seu pedido começa aqui</h3>
              <p>Escolha um modelo e distribua as peças por tamanho.</p>
            </div>
            /* Se o pedido estiver com itens, os exibe*/
          ) : (
            lines.map((line) => (
              <div className="cart-line" key={line.key}>
                <img src={line.image} alt="" />
                <div>
                  <strong>{line.name}</strong>
                  <small>
                    {line.color} · {line.size}
                  </small>
                  <b>{money.format(line.price)}</b>
                </div>
                <Counter
                  value={line.quantity}
                  label={`${line.name} ${line.size}`}
                  onChange={(amount) => changeLine(line.key, amount)}
                />
                <button
                  className="remove"
                  onClick={() =>
                    removeLine(line.key)
                  }
                  aria-label="Remover item"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="cart-footer">
          <div className="subtotal">
            <span>
              Subtotal <small>frete calculado depois</small>
            </span>
            <strong>{money.format(total)}</strong>
          </div>
          <button
            className="button primary full"
            disabled={pieces < 20}
            onClick={onProceed}
          >
            {pieces >= 20 ? "Continuar pedido" : `Faltam ${20 - pieces} peças`}{" "}
            <ArrowRight size={18} />
          </button>
          <p className="cart-note">
            <CircleHelp size={14} /> Mínimo de 20 peças para atacado.
          </p>
        </div>
      </aside>
      {open && <div className="cart-backdrop" onClick={() => setOpen(false)} />}
    </>
  );
}
