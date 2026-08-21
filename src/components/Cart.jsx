import React, { useEffect, useState } from "react";

import {
  Trash2,
  X,
  ShoppingBag,
  PackageCheck,
  ArrowRight,
  CircleHelp,
} from "lucide-react";

import Counter from "./Counter";

import { useCartContext } from "../contexts/CartContext";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const MIN_ORDER_QUANTITY = 15;

export default function Cart({ onProceed }) {
  const {
    lines,
    cartOpen,
    setCartOpen,
    qtyTotal,
    orderTotal,
    changeLine,
    removeLine,
  } = useCartContext();

  const [showFloatingButton, setShowFloatingButton] =
    useState(false);

  const total = orderTotal;
  const pieces = qtyTotal;

  useEffect(() => {
    const handleScroll = () => {
      setShowFloatingButton(window.scrollY > 100);
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <>
      {showFloatingButton && pieces > 0 && !cartOpen && (
        <button
          className="mobile-cart"
          onClick={() => setCartOpen(true)}
        >
          <ShoppingBag size={19} />
          <span>{pieces}</span>
          {" "}Ver pedido <b>{money.format(total)}</b>
        </button>
      )}

      <aside
        className={`cart ${cartOpen ? "open" : ""}`}
        aria-label="Seu pedido"
      >
        <div className="cart-head">
          <div>
            <span className="eyebrow">SEU PEDIDO</span>

            <h2>
              <ShoppingBag size={20} /> {pieces}{" "}
              {pieces === 1 ? "peça" : "peças"}
            </h2>
          </div>

          <button
            className="cart-close"
            onClick={() => setCartOpen(false)}
            aria-label="Fechar carrinho"
          >
            <X />
          </button>
        </div>

        <div className="cart-lines">
          {!lines.length ? (
            <div className="empty-cart">
              <PackageCheck />

              <h3>Seu pedido começa aqui</h3>

              <p>
                Escolha um modelo e distribua as peças
                por tamanho.
              </p>
            </div>
          ) : (
            lines.map((line) => (
              <div
                className="cart-line"
                key={line.key}
              >
                <img src={line.image} alt="" />

                <div>
                  <strong>{line.name}</strong>

                  <small>
                    {line.color} · {line.size}
                  </small>

                  <b>
                    {money.format(line.price)}
                  </b>
                </div>

                <Counter
                  value={line.quantity}
                  label={`${line.name} ${line.size}`}
                  onChange={(amount) =>
                    changeLine(line.key, amount)
                  }
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
              Subtotal{" "}
              <small>frete calculado depois</small>
            </span>

            <strong>
              {money.format(total)}
            </strong>
          </div>

          <button
            className="button primary full"
            disabled={pieces < MIN_ORDER_QUANTITY}
            onClick={onProceed}
          >
            {pieces >= MIN_ORDER_QUANTITY
              ? "Continuar pedido"
              : `Faltam ${
                  MIN_ORDER_QUANTITY - pieces
                } peças`}

            <ArrowRight size={18} />
          </button>

          <p className="cart-note">
            <CircleHelp size={14} /> Mínimo de{" "}
            {MIN_ORDER_QUANTITY} peças para atacado.
          </p>
        </div>
      </aside>

      {cartOpen && (
        <div
          className="cart-backdrop"
          onClick={() => setCartOpen(false)}
        />
      )}
    </>
  );
}