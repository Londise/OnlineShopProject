import React from "react";
import { useEffect, useState } from "react";
import { X, ShoppingBag } from "lucide-react";
import Counter from "./Counter";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Detecta se está em tela mobile
function isMobile() {
  return window.matchMedia("(max-width: 700px)").matches;
}

const colorStyles = {
  Preto: "#171419",
  Vinho: "#6a1831",
  "Azul-marinho": "#1d3152",
  Estampada: "linear-gradient(135deg,#ef9d86,#7d385e,#d9bc53)",
  Areia: "#d9c4a4",
  Terracota: "#b75c45",
  Chumbo: "#4c5054",
  Caramelo: "#b47b4b",
  Oliva: "#788047",
  Pink: "#e45d91",
};

// Modal para montar o pedido, escolhendo cor e distribuindo quantidades por tamanho
export default function BuilderModal({ product, showToast, onClose, onAdd, cartOpen }) {
  const [color, setColor] = useState(product.variants[0]);

  // Seta as quantidades em 0 no começo
  const [quantities, setQuantities] = useState({
    P: 0,
    M: 0,
    G: 0,
    GG: 0 
  });

  // Reseta as quantidades caso o botão de "Adicionar ao pedido" for acionado.
  const resetQuantities = () => {
    setQuantities({
      P: 0,
      M: 0,
      G: 0,
      GG: 0 
    });
  };

  const selected = Object.values(quantities).reduce((a, b) => a + b, 0);

  // Controla a ação de apertar o botão "Adicionar ao Pedido"
  const handleAdd = () => {
    onAdd(product, color.name, quantities);

    resetQuantities();

    showToast("Produto adicionado ao pedido!");

    if (isMobile()) {
      onClose();
    }
  };

  useEffect(() => {
    const listener = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  return (
    <div
      // Adiciona a classe "with-cart" se o carrinho estiver aberto, para ajustar o estilo do modal
      className={`overlay builder-overlay ${cartOpen ? "with-cart" : ""}`}
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="builder"
        role="dialog"
        aria-modal="true"
        aria-labelledby="builder-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-close" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
        <img src={product.image} alt="" />
        <div className="builder-content">
          <span className="eyebrow">{product.material} · atacado</span>
          <h2 id="builder-title">{product.name}</h2>
          <p className="product-price">
            {money.format(product.price)} <small>por peça</small>
          </p>
          <div className="color-row">
            <span>Escolha a cor</span>
            <div>
              {product.variants.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className={`color-dot ${color.name === item.name ? "selected" : ""}`}
                  style={{ background: colorStyles[item.name] }}
                  onClick={() => setColor(item)}
                  aria-label={item.name}
                  title={item.name}
                />
              ))}
            </div>
            <b>{color.name}</b>
          </div>
          <div className="sizes">
            <div>
              <span>Distribua por tamanho</span>
              <small>Digite a quantidade diretamente, se preferir.</small>
            </div>
            {Object.entries(quantities).map(([size, amount]) => (
              <div className="size-row" key={size}>
                <strong>{size}</strong>

                <Counter
                  value={amount}
                  label={`tamanho ${size}`}
                  onChange={(value) =>
                    setQuantities((old) => ({ ...old, [size]: value }))
                  }
                />
              </div>
            ))}
          </div>
          <button
            className="button primary full"
            disabled={!selected}
            onClick={handleAdd}
          >
            <ShoppingBag size={18} /> Adicionar{" "}
            {selected
              ? `${selected} ${selected === 1 ? "peça" : "peças"}`
              : "ao pedido"}
          </button>
        </div>
      </section>
    </div>
  );
}