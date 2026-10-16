import React, { useEffect, useState } from "react";

import Logo from "../components/Logo";
import { IMAGE_PLACEHOLDER } from "../config/media";
import { api } from "../services/api";
import ProductCard from "../components/ProductCard";
import Cart from "../components/Cart";
import Footer from "../components/Footer";
import AuthDialog from "../components/AuthDialog";
import BuilderModal from "../components/BuilderModalButton";

import useCatalog from "../hooks/useCatalog";

import { useCartContext } from "../contexts/CartContext";
import { useAuthContext } from "../contexts/AuthContext";

import { useNavigate } from "react-router-dom";

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Instagram,
  PackageCheck,
  Search,
  Send,
  User,
  ShoppingBag,
  Truck,
  Zap,
} from "lucide-react";

export default function Home() {
  /*
   * ============================================================
   * DEPENDÊNCIAS GLOBAIS
   * ============================================================
   *
   * O Router cuida da navegação.
   * O AuthContext cuida do usuário autenticado.
   * O CartContext cuida do carrinho.
   */

  const navigate = useNavigate();

  const auth = useAuthContext();
  const { user } = auth;

  const {
    lines,
    cartOpen,
    setCartOpen,
    addToCart,
    changeLine,
    removeLine,
    qtyTotal,
    orderTotal,
    totalWeight,
  } = useCartContext();

  /*
   * O catálogo é responsabilidade da Home.
   */
  const {
    products,
    categories,
    error: catalogError,
    loading: catalogLoading,
    reload: reloadCatalog,
  } = useCatalog();

  /*
   * ============================================================
   * ESTADOS LOCAIS DA HOME
   * ============================================================
   */

  // Produto atualmente aberto no BuilderModal.
  const [currentProduct, setCurrentProduct] =
    useState(null);

  // Controla a abertura do modal de autenticação.
  const [authOpen, setAuthOpen] =
    useState(false);

  // Mensagem temporária exibida no toast.
  const [toast, setToast] =
    useState(null);

  // Banner atual.
  const [slide, setSlide] =
    useState(0);
  const [banners, setBanners] = useState([]);
  const heroSlides = banners.length ? banners : [{ id: "placeholder", imageUrl: IMAGE_PLACEHOLDER }];
  const activeSlide = Math.min(slide, heroSlides.length - 1);
  useEffect(() => {
    let active = true;
    api.catalog.banners().then(({ banners }) => { if (active) { setBanners(banners); setSlide(0); } }).catch(() => {});
    api.catalog.siteMedia().then(({ faviconUrl }) => {
      if (active && faviconUrl) document.querySelector('link[rel="icon"]')?.setAttribute("href", faviconUrl);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Categoria selecionada.
  const [filter, setFilter] =
    useState("Todos");

  // Texto da busca.
  const [search, setSearch] =
    useState("");

  /*
   * ============================================================
   * TOAST
   * ============================================================
   */

  const showToast = (message) => {
    setToast(message);

    setTimeout(() => {
      setToast(null);
    }, 2500);
  };

  /*
   * ============================================================
   * BUILDER MODAL
   * ============================================================
   *
   * currentProduct pertence à Home porque o modal só existe
   * dentro da experiência de escolha/montagem de produtos.
   */

  const openBuilder = (product) => {
    setCurrentProduct(product);

    /*
     * Mantemos o comportamento anterior:
     * ao abrir o produto, o carrinho também fica visível.
     */
    setCartOpen(true);
  };

  const closeBuilder = () => {
    setCurrentProduct(null);
    setCartOpen(false);
  };

  /*
   * ============================================================
   * AUTENTICAÇÃO
   * ============================================================
   */

  const handleAuthenticated = (authenticatedUser) => {
    setAuthOpen(false);

    /*
     * Depois do login:
     *
     * ADMIN / STAFF → Management
     * cliente comum → Account
     */
    if (
      authenticatedUser.role === "ADMIN" ||
      authenticatedUser.role === "STAFF"
    ) {
      navigate("/management");
      return;
    }

    navigate("/account");
  };

  /*
   * ============================================================
   * CHECKOUT
   * ============================================================
   *
   * A navegação pertence ao Router.
   */

  const handleCheckout = () => {
    setCurrentProduct(null);
    setCartOpen(false);

    navigate("/checkout");

    /*
     * Mantemos o comportamento visual anterior.
     */
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  /*
   * ============================================================
   * SCROLL DO CATÁLOGO
   * ============================================================
   */

  const scrollProducts = () => {
    document
      .querySelector("#produtos")
      ?.scrollIntoView({
        behavior: "smooth",
      });
  };

  /*
   * ============================================================
   * FILTROS / BUSCA
   * ============================================================
   */

  const displayed = products.filter(
    (product) =>
      (filter === "Todos" ||
        product.category === filter) &&
      product.name
        .toLocaleLowerCase("pt-BR")
        .includes(
          search.toLocaleLowerCase("pt-BR"),
        ),
  );

  const allFilters = [
    "Todos",
    ...categories.map(
      ({ name }) => name,
    ),
  ];

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <>
      {/* ========================================================
          HEADER
      ========================================================= */}

      <header>
        <Logo />

        <nav>
          <a href="#inicio">
            Início
          </a>

          <button onClick={scrollProducts}>
            Produtos
          </button>
        </nav>

        <div className="header-actions">
          {/* Pedido */}
          <button
            type="button"
            className="header-order"
            onClick={() => setCartOpen(true)}
          >
            <ShoppingBag size={18} />

            <span>
              Pedido
            </span>

            <b>
              {qtyTotal}
            </b>
          </button>

          {/* Conta / Login */}
          {user ? (
            <button
              type="button"
              className="header-account"
              onClick={() =>
                navigate("/account")
              }
            >
              Olá,{" "}
              {user.name.split(" ")[0]}
            </button>
          ) : (
            <button
              type="button"
              className="header-account"
              onClick={() =>
                setAuthOpen(true)
              }
            >
              Entrar

              <User size={20} />
            </button>
          )}
        </div>
      </header>

      {/* ========================================================
          CONTEÚDO PRINCIPAL
      ========================================================= */}

      <main id="inicio">
        {catalogLoading && <p role="status">Carregando catálogo… O servidor pode levar alguns instantes para iniciar.</p>}
        {catalogError && <div role="alert"><p>{catalogError}</p><button className="button outline" onClick={reloadCatalog}>Tentar carregar novamente</button></div>}
        {auth.error && <div role="alert"><p>{auth.error}</p><button className="button outline" onClick={() => auth.refreshSession()}>Verificar sessão novamente</button></div>}
        {/* ======================================================
            HERO
        ======================================================= */}

        <section className="hero">
          <div
            className="hero-image"
            style={{
              width: `${heroSlides.length * 100}%`,
              transform: `translateX(-${
                activeSlide * (100 / heroSlides.length)
              }%)`,
            }}
          >
            {heroSlides.map(
              (item) => (
                <div
                  className="hero-slide"
                  key={item.id}
                  style={{
                    width: `${100 / heroSlides.length}%`, flexShrink: 0,
                    backgroundImage: `linear-gradient(90deg, rgba(37,17,30,.72), rgba(37,17,30,.1)), url(${item.imageUrl})`,
                  }}
                >
                  <div>
                    <span className="eyebrow light">
                      FABRICAÇÃO PRÓPRIA
                    </span>

                    <h1>
                      Ferchu
                      <br />
                      <em>Modas</em>
                    </h1>

                    <p>
                      {item.subtitle ?? "Peças confortáveis e modelos variados para revender."}
                    </p>

                    <button
                      className="button cream"
                      onClick={
                        scrollProducts
                      }
                    >
                      Ver produtos
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>

          <button
            className="hero-arrow left"
            onClick={() =>
              setSlide(
                (activeSlide + heroSlides.length - 1) % heroSlides.length,
              )
            }
            aria-label="Banner anterior"
          >
            <ChevronLeft />
          </button>

          <button
            className="hero-arrow right"
            onClick={() =>
              setSlide(
                (activeSlide + 1) % heroSlides.length,
              )
            }
            aria-label="Próximo banner"
          >
            <ChevronRight />
          </button>

          <div className="slider-dots">
            {heroSlides.map(
              (item, index) => (
                <button
                  key={item.id}
                  aria-label={`Ir para banner ${
                    index + 1
                  }`}
                  className={
                    activeSlide === index
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setSlide(index)
                  }
                />
              ),
            )}
          </div>
        </section>

        {/* ======================================================
            BENEFÍCIOS
        ======================================================= */}

        <section className="benefits">
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <Instagram />
            </span>

            <b>
              Instagram
            </b>

            <small>
              Siga nossos looks
            </small>
          </a>

          <a
            href="https://wa.me/"
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <Send />
            </span>

            <b>
              WhatsApp
            </b>

            <small>
              Fale com a gente
            </small>
          </a>

          <div>
            <span>
              <PackageCheck />
            </span>

            <b>
              Somente atacado
            </b>

            <small>
              Pedido mínimo 15 peças
            </small>
          </div>

          <div>
            <span>
              <Truck />
            </span>

            <b>
              Entrega rápida
            </b>

            <small>
              Via Correios ou excursão
            </small>
          </div>
        </section>

        {/* ======================================================
            CATEGORIAS
        ======================================================= */}

        <section className="section categories">
          <div className="section-head">
            <div>
              <span className="eyebrow">
                ENCONTRE SEU ESTILO
              </span>

              <h2>
                Feito para vestir bem.
              </h2>
            </div>

            <button
              className="text-button"
              onClick={
                scrollProducts
              }
            >
              Ver todos
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="category-grid">
            {categories.map(
              (category) => (
                <button
                  key={category.name}
                  onClick={() => {
                    setFilter(
                      category.name,
                    );

                    scrollProducts();
                  }}
                >
                  <img
                    src={category.image}
                    alt={`Categoria ${category.name}`}
                  />

                  <strong>
                    {category.name}
                  </strong>

                  <span>
                    Ver modelos
                  </span>
                </button>
              ),
            )}
          </div>
        </section>

        {/* ======================================================
            DESTAQUES
        ======================================================= */}

        <section className="section highlights">
          <div className="section-head">
            <div>
              <span className="eyebrow">
                OS MAIS PEDIDOS
              </span>

              <h2>
                Destaques
              </h2>
            </div>
          </div>

          <div className="highlight-grid">
            {products
              .slice(0, 3)
              .map(
                (product) => (
                  <ProductCard
                    product={product}
                    onBuild={
                      openBuilder
                    }
                    key={product.id}
                  />
                ),
              )}
          </div>
        </section>

        {/* ======================================================
            CATÁLOGO
        ======================================================= */}

        <section
          className="section products"
          id="produtos"
        >
          <div className="section-head product-title">
            <div>
              <span className="eyebrow">
                CATÁLOGO
              </span>

              <h2>
                Monte seu pedido.
              </h2>

              <p>
                Selecione cores e distribua
                as quantidades por tamanho.
              </p>
            </div>
          </div>

          <div className="catalog-tools">
            <div className="filters">
              {allFilters.map(
                (item) => (
                  <button
                    key={item}
                    onClick={() =>
                      setFilter(
                        item,
                      )
                    }
                    className={
                      filter === item
                        ? "active"
                        : ""
                    }
                  >
                    {item}
                  </button>
                ),
              )}
            </div>

            <label className="search">
              <Search size={17} />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder="Buscar modelo"
                maxLength="60"
              />
            </label>
          </div>

          <div className="catalog-grid">
            {displayed.map(
              (product) => (
                <ProductCard
                  className="product-card-catalog"
                  product={product}
                  onBuild={
                    openBuilder
                  }
                  key={product.id}
                />
              ),
            )}
          </div>

          {!displayed.length && (
            <p className="nothing">
              Não encontramos esse modelo.
              Tente outra busca.
            </p>
          )}
        </section>

        {/* ======================================================
            BANNER DE AJUDA
        ======================================================= */}

        <section className="help-banner">
          <div>
            <Zap />

            <span className="eyebrow light">
              PRECISA DE AJUDA?
            </span>

            <h2>
              Montou seu pedido? A gente
              cuida do resto.
            </h2>
          </div>

          <a
            href="https://wa.me/"
            target="_blank"
            rel="noreferrer"
            className="button cream"
          >
            Falar no WhatsApp
            <Send size={18} />
          </a>
        </section>
      </main>

      {/* ========================================================
          FOOTER
      ========================================================= */}

      <Footer />

      {/* ========================================================
          CARRINHO
      ========================================================= */}

      <Cart onProceed={handleCheckout} />

      {/* ========================================================
          BUILDER MODAL
      ========================================================= */}

      {currentProduct && (
        <BuilderModal
          product={currentProduct}
          showToast={showToast}
          onClose={closeBuilder}
        />
      )}

      {/* ========================================================
          TOAST
      ========================================================= */}

      {toast && (
        <div className="toast-success">
          {toast}
        </div>
      )}

      {/* ========================================================
          AUTH DIALOG
      ========================================================= */}

      {authOpen && (
        <AuthDialog
          auth={auth}
          onClose={() =>
            setAuthOpen(false)
          }
          onAuthenticated={
            handleAuthenticated
          }
        />
      )}
    </>
  );
}
