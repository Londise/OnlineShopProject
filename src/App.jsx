import React, { useEffect, useState } from "react";
import { z } from "zod";
import Checkout from "./pages/Checkout";
import Footer from "./components/Footer";
import useCart from "./hooks/useCart";
import Counter from "./components/Counter";
import BuilderModal from "./components/BuilderModalButton";
import Cart from "./components/Cart";
import Logo from "./components/Logo";
import { products, categories } from "./data/products";
import HERO_IMAGE from "./assets/hero.jpeg";


import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Facebook,
  Heart,
  Instagram,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Trash2,
  Truck,
  X,
  Zap,
} from "lucide-react";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

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

function ProductCard({ product, onBuild }) {
  return (
    <article className="product-card">
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

function Home({ onBuild, cartProps }) {
  const [slide, setSlide] = useState(0);
  const [filter, setFilter] = useState("Todos");
  const [search, setSearch] = useState("");
  const displayed = products.filter(
    (product) =>
      (filter === "Todos" || product.category === filter) &&
      product.name
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  const allFilters = ["Todos", ...categories.map(({ name }) => name)];
  const scrollProducts = () =>
    document.querySelector("#produtos")?.scrollIntoView({ behavior: "smooth" });
  return (
    <>
      <header>
        <Logo />
        <nav>
          <a href="#inicio">Início</a>
          <button onClick={scrollProducts}>Produtos</button>
        </nav>
        <a
          className="header-order"
          href="#pedido"
          onClick={(e) => {
            e.preventDefault();
            cartProps.setOpen(true);
          }}
        >
          <ShoppingBag size={18} />
          <span>Pedido</span>
          <b>{cartProps.qtyTotal}</b>
        </a>
      </header>

      <main id="inicio">
        <section className="hero">
          <div
            className="hero-image"
            style={{ transform: `translateX(-${slide * 33.333333}%)` }}
          >
            {[0, 1, 2].map((item) => (
              <div
                className="hero-slide"
                key={item}
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(37,17,30,.72), rgba(37,17,30,.1)), url(${HERO_IMAGE})`,
                }}
              >
                <div>
                  <span className="eyebrow light">FABRICAÇÃO PRÓPRIA</span>
                  <h1>
                    Ferchu
                    <br />
                    <em>Modas</em>
                  </h1>
                  <p>
                    Peças confortáveis e modelos variados para revender.
                  </p>
                  <button className="button cream" onClick={scrollProducts}>
                    Ver produtos <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            className="hero-arrow left"
            onClick={() => setSlide((slide + 2) % 3)}
            aria-label="Banner anterior"
          >
            <ChevronLeft />
          </button>
          <button
            className="hero-arrow right"
            onClick={() => setSlide((slide + 1) % 3)}
            aria-label="Próximo banner"
          >
            <ChevronRight />
          </button>
          <div className="slider-dots">
            {[0, 1, 2].map((item) => (
              <button
                key={item}
                aria-label={`Ir para banner ${item + 1}`}
                className={slide === item ? "active" : ""}
                onClick={() => setSlide(item)}
              />
            ))}
          </div>
        </section>
        <section className="benefits">
          <a href="https://instagram.com" target="_blank" rel="noreferrer">
            <span>
              <Instagram />
            </span>
            <b>Instagram</b>
            <small>Siga nossos looks</small>
          </a>
          <a href="https://wa.me/" target="_blank" rel="noreferrer">
            <span>
              <Send />
            </span>
            <b>WhatsApp</b>
            <small>Fale com a gente</small>
          </a>
          <div>
            <span>
              <PackageCheck />
            </span>
            <b>Somente atacado</b>
            <small>Pedido mínimo 20 peças</small>
          </div>
          <div>
            <span>
              <Truck />
            </span>
            <b>Entrega rápida</b>
            <small>Via Correios ou excursão</small>
          </div>
        </section>
        <section className="section categories">
          <div className="section-head">
            <div>
              <span className="eyebrow">ENCONTRE SEU ESTILO</span>
              <h2>Feito para vestir bem.</h2>
            </div>
            <button className="text-button" onClick={scrollProducts}>
              Ver todos <ArrowRight size={16} />
            </button>
          </div>
          <div className="category-grid">
            {categories.map((category) => (
              <button
                key={category.name}
                onClick={() => {
                  setFilter(category.name);
                  scrollProducts();
                }}
              >
                <img src={category.image} alt={`Categoria ${category.name}`} />
                <strong>{category.name}</strong>
                <span>Ver modelos</span>
              </button>
            ))}
          </div>
        </section>
        <section className="section highlights">
          <div className="section-head">
            <div>
              <span className="eyebrow">OS MAIS PEDIDOS</span>
              <h2>Destaques</h2>
            </div>
          </div>
          <div className="highlight-grid">
            {products.slice(0, 3).map((product) => (
              <ProductCard
                product={product}
                onBuild={onBuild}
                key={product.id}
              />
            ))}
          </div>
        </section>
        <section className="section products" id="produtos">
          <div className="section-head product-title">
            <div>
              <span className="eyebrow">CATÁLOGO</span>
              <h2>Monte seu pedido.</h2>
              <p>Selecione cores e distribua as quantidades por tamanho.</p>
            </div>
          </div>
          <div className="catalog-tools">
            <div className="filters">
              {allFilters.map((item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={filter === item ? "active" : ""}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="search">
              <Search size={17} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar modelo"
                maxLength="60"
              />
            </label>
          </div>
          <div className="catalog-grid">
            {displayed.map((product) => (
              <ProductCard
                product={product}
                onBuild={onBuild}
                key={product.id}
              />
            ))}
          </div>
          {!displayed.length && (
            <p className="nothing">
              Não encontramos esse modelo. Tente outra busca.
            </p>
          )}
        </section>
        <section className="help-banner">
          <div>
            <Zap />
            <span className="eyebrow light">PRECISA DE AJUDA?</span>
            <h2>Montou seu pedido? A gente cuida do resto.</h2>
          </div>
          <a
            href="https://wa.me/"
            target="_blank"
            rel="noreferrer"
            className="button cream"
          >
            Falar no WhatsApp <Send size={18} />
          </a>
        </section>
      </main>
      <Footer />
      <Cart {...cartProps} />
    </>
  );
}

export default function App() {
  const [currentProduct, setCurrentProduct] = useState(null);
  const [page, setPage] = useState("home");

  const {
    lines,
    cartOpen,
    setCartOpen,
    addToCart,
    changeLine,
    removeLine,
    qtyTotal,
    orderTotal,
    totalWeight
  } = useCart();

  const openBuilder = (product) => {
    setCurrentProduct(product);
    setCartOpen(true);
  };

  // Função para ir para a página de checkout, fechando o carrinho e limpando o produto atual
  const handleCheckout = () => {
    setCurrentProduct(null);
    setCartOpen(false);
    setPage("checkout");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Função para voltar à página Home e fechar o carrinho e o modal de produto
  const onBack = () => {
    setCurrentProduct(null);
    setCartOpen(false);
    setPage("home");
  };

  const cartProps = {
    lines,
    open: cartOpen,
    setOpen: setCartOpen,
    changeLine,
    removeLine,
    onProceed: handleCheckout,
    qtyTotal,
    orderTotal,
    totalWeight,
  };

  if (page === "checkout")
    return (
      <Checkout
        lines={lines}
        onBack={onBack}
        qtyTotal={qtyTotal}
        orderTotal={orderTotal}
        totalWeight={totalWeight}
      />
    );
  return (
    <>
      <Home onBuild={openBuilder} cartProps={cartProps} />
      {currentProduct && (
        // Modal
          <BuilderModal
            product={currentProduct}

            onClose={() => {
              setCurrentProduct(null);
              setCartOpen(false);
            }}
            
            onAdd={addToCart}
            cartOpen={cartOpen}
          />
      )}
    </>
  );
}
