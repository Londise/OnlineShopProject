import React from "react"

import {
  Heart,
  ArrowRight,
} from "lucide-react";
import ResponsiveImage from "./ResponsiveImage";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const CATALOG_IMAGE_SIZES = "(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 280px";

export default function ProductCard({ product, onBuild, className = "", sizes = CATALOG_IMAGE_SIZES }) {
  return (
    <article className={`product-card ${className}`}>
      <div className="photo">
        <ResponsiveImage
          src={product.image}
          sourceWidth={product.imageWidth}
          sourceHeight={product.imageHeight}
          sizes={sizes}
          alt={`${product.name} feminina`}
          loading="lazy"
          decoding="async"
        />
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
