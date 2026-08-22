import React from "react";
import { useEffect, useState } from "react";
import { X, ShoppingBag } from "lucide-react";
import Counter from "./Counter";
import { getVariant } from "../utils/domainFunctions";
import { optional } from "zod/v4";

import { useCartContext } from "../contexts/CartContext";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Detecta se está em tela mobile
const colorStyles = {
  Preto: "#1A1A1A",
  Vinho: "#9C1A39",
  Grafite: "#4A4A4A",
  "Cinza claro": "#D9D9D9",
  "Verde militar": "#21482C",
  Marrom: "#5A3C3B",
  "Marrom claro": "#BD6D5A",
  "Azul marinho": "#1d3152",
  Areia: "#d9c4a4",
  Creme: "#EAD7C5",
  "Verde escuro": "#58593A",
  "Verde claro": "#98D3B3",
  "Azul escuro": "#252949",
  "Azul claro": "#538DE4",
  Rose: "#D97E7B",
  "Mais escuras": "#000000",
  "Mais claras": "#e9e9e9",
  "Misturadas": "grey",
};

// Modal para montar o pedido, escolhendo cor e distribuindo quantidades por tamanho
export default function BuilderModal({ product, showToast, onClose }) {

  const {
      addToCart,
      cartOpen,
    } = useCartContext();


  // Estado que inicializa com a primeira cor disponível, para que ela seja selecionada ao abrir o modal
  const [color, setColor] = useState(product.options[0]);

  const [selectedImage, setSelectedImage] = useState(product.image);

  useEffect(() => {
    setSelectedImage(product.image);
  }, [product]);

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
    addToCart(product, color, quantities);

    resetQuantities();

    showToast("Produto adicionado ao pedido!");

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

        {/* Galeria de fotos do produto */}
        <div className="builder-gallery">
          <div className="builder-thumbnails">
            {product.images?.map((image, index) => {
              return (
                <button
                  key={image || index}
                  type="button"
                  className={`builder-thumbnail ${
                    selectedImage === image ? "selected" : ""}`}
                    
                  onClick={() => {
                      setSelectedImage(image);
                  }}

                  onMouseEnter={() => {
                      setSelectedImage(image);
                  }}

                  onMouseLeave={() => {
                      setSelectedImage(product.image);
                  }}

                  aria-label={`Visualizar foto ${index + 1}`}
                >
                  <img
                    src={image}
                    alt={`${product.name} - foto ${index + 1}`}
                  />
                </button>
              );
            })}
          </div>

          <div className="builder-main-image">
            <img
              src={selectedImage}
              alt={`${product.name} feminina`}
            />
          </div>
        </div>
        <div className="builder-content">
          <span className="eyebrow">{product.material} · atacado</span>
          <h2 id="builder-title">{product.name}</h2>
          <p className="product-price">
            {money.format(product.price)} <small>por peça</small>
          </p>
          <div className="color-row">
            <span>Escolha a cor</span>
            <div>
              {/* Percorre a lista de cores */}
              {product.options.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  // Na primeira iteração, a primeira cor é selecionada pois ela é product.options[0]
                  className={`color-dot ${color.name === item.name ? "selected" : ""}`}
                  style={{ background: colorStyles[item.name] }}
                  onClick={() => {
                    setColor(item);
                    setSelectedImage(item.image || product.image);
                    // resetQuantities(); para zerar as quantidades ao trocar de cor
                  }}
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
            {Object.entries(quantities).map(([size, amount]) => {
              
              // Procura dentro das cores (option) o tamanho (variant) requerido pelo cliente e armazena seu estoque
              const selectedVariant = getVariant(color, size);
              
              // Verifica se esse tamanho está disponível
              const available = selectedVariant?.available ?? 0;

              return (
              <div className="size-row" key={size}>
                <strong>{size}</strong>

                <Counter
                  value={amount}
                  max={available}
                  disabled={available === 0}
                  label={`tamanho ${size}`}
                  onChange={(value) =>
                    setQuantities((old) => ({
                      ...old,
                      [size]: value,
                    }))
                  }
                />
              </div>
            );
            })}
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
