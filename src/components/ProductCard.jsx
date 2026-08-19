import React from "react"

import {
  Heart,
  ArrowRight,
} from "lucide-react";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function ProductCard({ product, onBuild, className = "" }) {
  return (
    <article className={`product-card ${className}`}>
      <div className="photo">
        <img src={product.image} alt={`${product.name} feminina`} />
        <span>Atacado</span>
        <button aria-label={`Favoritar ${product.name}`}>
          <Heart size={18} />
        </button>
      </div>
      <div className="product-copy">
        <p>{product.material}</p>
        <h3>{product.name}</h3>
        <strong>
          {money.format(product.price)} <small>por peça</small>
        </strong>
        <button className="button outline" onClick={() => onBuild(product)}>
          Montar pedido <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );
}