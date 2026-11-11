import React, { useEffect, useState } from "react";

import Logo from "../components/Logo";
import { api } from "../services/api";
import ProductCard from "../components/ProductCard";
import ResponsiveImage from "../components/ResponsiveImage";
import HeroImage from "../components/HeroImage";
import StorefrontLoading from "../components/StorefrontLoading";
import StorefrontNotice from "../components/StorefrontNotice";
import Cart from "../components/Cart";
import Footer from "../components/Footer";
import AuthDialog from "../components/AuthDialog";
import BuilderModal from "../components/BuilderModalButton";

import useCatalog from "../hooks/useCatalog";
import useStorefrontLoading from "../hooks/useStorefrontLoading";
import { buildWhatsAppUrl } from "../utils/whatsapp";

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

const HERO_IMAGE_WIDTHS = [640, 960, 1280, 1600, 1920];
const HIGHLIGHT_IMAGE_SIZES =
  "(max-width: 768px) 74vw, (max-width: 1200px) 33vw, 370px";
const CATEGORY_IMAGE_SIZES =
  "(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 280px";

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

  const { cartOpen, setCartOpen, qtyTotal } = useCartContext();

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
  const [currentProduct, setCurrentProduct] = useState(null);

  // Controla a abertura do modal de autenticação.
  const [authOpen, setAuthOpen] = useState(false);

  // Mensagem temporária exibida no toast.
  const [toast, setToast] = useState(null);

  // Banner atual.
  const [slide, setSlide] = useState(0);
  const [banners, setBanners] = useState([]);
  const [bannersLoading, setBannersLoading] = useState(true);
  const [settledBanner, setSettledBanner] = useState(null);
  const heroSlides = banners.length
    ? banners
    : [{ id: "pending-banner", imageUrl: null }];
  const activeSlide = Math.min(slide, heroSlides.length - 1);
  const initialLoading = useStorefrontLoading({
    catalogLoading,
    catalogError,
    bannerReady: !bannersLoading && (!banners.length || settledBanner === banners[0].imageUrl),
  });
  useEffect(() => {
    let active = true;
    api.catalog
      .banners()
      .then(({ banners }) => {
        if (active) {
          setBanners(Array.isArray(banners) ? banners : []);
          setSlide(0);
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setBannersLoading(false); });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (catalogLoading) return;
    let active = true;
    api.catalog
      .siteMedia()
      .then(({ faviconUrl }) => {
        if (active && faviconUrl)
          document
            .querySelector('link[rel="icon"]')
            ?.setAttribute("href", faviconUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [catalogLoading]);

  // Categoria selecionada.
  const [filter, setFilter] = useState("Todos");

  // Texto da busca.
  const [search, setSearch] = useState("");

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
    document.querySelector("#produtos")?.scrollIntoView({
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
      (filter === "Todos" || product.category === filter) &&
      product.name
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );

  const allFilters = ["Todos", ...categories.map(({ name }) => name)];

  /*
   * ============================================================
   * AVISOS DA LOJA
   * ============================================================
   *
   * Catálogo e sessão consultam o mesmo servidor: quando ele
   * está indisponível, os dois falham com a mesma mensagem.
   * Unificamos tudo num único aviso, sem repetir o texto.
   */

  const storefrontErrors = [
    ...new Set(
      [catalogError, auth.error]
        .filter(Boolean)
        .map((message) => message.trim()),
    ),
  ];

  const retryStorefront = () => {
    reloadCatalog();
    auth.refreshSession();
  };

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <>
      {initialLoading && <StorefrontLoading />}
      <div inert={initialLoading || undefined} aria-hidden={initialLoading || undefined}>
      {storefrontErrors.length > 0 && (
        <StorefrontNotice
          key={JSON.stringify(storefrontErrors)}
          messages={storefrontErrors}
          onRetry={retryStorefront}
          retrying={catalogLoading || auth.loading}
        />
      )}
      {/* ========================================================
          HEADER
      ========================================================= */}

      <header className="storefront-header">
        <div className="storefront-header-main">
          
          <Logo />
          
          <div className="header-actions">
            {/* Pedido */}
            <button
              type="button"
              className="header-order"
              onClick={() => setCartOpen(true)}
            >
              <ShoppingBag size={18} />

              <span>Pedido</span>

              <b>{qtyTotal}</b>
            </button>

            {/* Conta / Login */}
            {user ? (
              <button
                type="button"
                className="header-account"
                onClick={() => navigate("/account")}
              >
                Olá, {user.name.split(" ")[0]}
              </button>
            ) : (
              <button
                type="button"
                className="header-account"
                onClick={() => setAuthOpen(true)}
              >
                Entrar
                <User size={20} />
              </button>
            )}
          </div>
        </div>

        <nav className="storefront-nav">
          <a href="#inicio">Início</a>

          <button onClick={scrollProducts}>Produtos</button>
        </nav>
      </header>

      {/* ========================================================
          CONTEÚDO PRINCIPAL
      ========================================================= */}

      <main id="inicio" aria-busy={catalogLoading}>
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
            {heroSlides.map((item, index) => (
              <div
                className="hero-slide"
                key={item.id}
                style={{
                  width: `${100 / heroSlides.length}%`,
                  flexShrink: 0,
                }}
              >
                {index === activeSlide && item.imageUrl && (
                  <HeroImage
                    key={item.imageUrl}
                    src={item.imageUrl}
                    sourceWidth={item.width}
                    sourceHeight={item.height}
                    variantWidth={1600}
                    widths={HERO_IMAGE_WIDTHS}
                    sizes="100vw"
                    alt={item.altText ?? ""}
                    loading="eager"
                    fetchPriority={index === 0 ? "high" : "auto"}
                    decoding="async"
                    onSettled={() => setSettledBanner(item.imageUrl)}
                  />
                )}
                <div>
                  <span className="eyebrow light">FABRICAÇÃO PRÓPRIA</span>

                  <h1>
                    Ferchu
                    <br />
                    <em>Modas</em>
                  </h1>

                  <p>
                    {item.subtitle ??
                      "Peças confortáveis e modelos variados para revender."}
                  </p>

                  <button className="button cream" onClick={scrollProducts}>
                    Ver produtos
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            ))}
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
            onClick={() => setSlide((activeSlide + 1) % heroSlides.length)}
            aria-label="Próximo banner"
          >
            <ChevronRight />
          </button>

          <div className="slider-dots">
            {heroSlides.map((item, index) => (
              <button
                key={item.id}
                aria-label={`Ir para banner ${index + 1}`}
                className={activeSlide === index ? "active" : ""}
                onClick={() => setSlide(index)}
              />
            ))}
          </div>
        </section>

        {/* ======================================================
            BENEFÍCIOS
        ======================================================= */}

        <section className="benefits">
          <a href="https://instagram.com" target="_blank" rel="noreferrer">
            <span>
              <Instagram />
            </span>

            <b>Instagram</b>

            <small>Siga nossos looks</small>
          </a>

          <a href={buildWhatsAppUrl()} target="_blank" rel="noreferrer">
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

            <small>Pedido mínimo 15 peças</small>
          </div>

          <div>
            <span>
              <Truck />
            </span>

            <b>Entrega rápida</b>

            <small>Via Correios ou excursão</small>
          </div>
        </section>

        {/* ======================================================
            CATEGORIAS
        ======================================================= */}

        <section className="section categories">
          <div className="section-head">
            <div>
              <span className="eyebrow">ENCONTRE SEU ESTILO</span>

              <h2>Feito para vestir bem.</h2>
            </div>

            <button className="text-button" onClick={scrollProducts}>
              Ver todos
              <ArrowRight size={16} />
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
                <ResponsiveImage
                  src={category.image}
                  sourceWidth={category.imageWidth}
                  sourceHeight={category.imageHeight}
                  sizes={CATEGORY_IMAGE_SIZES}
                  alt={`Categoria ${category.name}`}
                  loading="lazy"
                  decoding="async"
                />

                <strong>{category.name}</strong>

                <span>Ver modelos</span>
              </button>
            ))}
          </div>
        </section>

        {/* ======================================================
            DESTAQUES
        ======================================================= */}

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
                sizes={HIGHLIGHT_IMAGE_SIZES}
                onBuild={openBuilder}
                key={product.id}
              />
            ))}
          </div>
        </section>

        {/* ======================================================
            CATÁLOGO
        ======================================================= */}

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
            {catalogLoading && !products.length && Array.from({ length: 4 }, (_, index) => (
              <div className="product-skeleton" key={index} aria-hidden="true">
                <div /><span /><span />
              </div>
            ))}
            {displayed.map((product) => (
              <ProductCard
                className="product-card-catalog"
                product={product}
                onBuild={openBuilder}
                key={product.id}
              />
            ))}
          </div>

          {!catalogLoading && !catalogError && !displayed.length && (
            <p className="nothing">
              Não encontramos esse modelo. Tente outra busca.
            </p>
          )}
        </section>

        {/* ======================================================
            BANNER DE AJUDA
        ======================================================= */}

        <section className="help-banner">
          <div>
            <Zap />

            <span className="eyebrow light">PRECISA DE AJUDA?</span>

            <h2>Montou seu pedido na mão? A gente cuida do resto, fale conosco no WhatsApp.</h2>
          </div>

          <a
            href={buildWhatsAppUrl()}
            target="_blank"
            rel="noreferrer"
            className="button cream"
          >
            Falar no WhatsApp
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
              <path d="M20.52 3.48A11.88 11.88 0 0 0 12.05 0C5.47 0 .12 5.35.12 11.93c0 2.1.55 4.15 1.6 5.96L.02 24l6.25-1.64a11.9 11.9 0 0 0 5.78 1.47h.01c6.58 0 11.93-5.35 11.93-11.93 0-3.19-1.24-6.18-3.47-8.42ZM12.06 21.82a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.71.97.99-3.62-.24-.37a9.88 9.88 0 0 1-1.52-5.28c0-5.47 4.45-9.92 9.92-9.92a9.85 9.85 0 0 1 7.02 2.91 9.85 9.85 0 0 1 2.9 7.02c0 5.47-4.45 9.92-9.96 9.88Zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z" />
            </svg>
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

      {toast && <div className="toast-success">{toast}</div>}

      {/* ========================================================
          AUTH DIALOG
      ========================================================= */}

      {authOpen && (
        <AuthDialog
          auth={auth}
          onClose={() => setAuthOpen(false)}
          onAuthenticated={handleAuthenticated}
        />
      )}
      </div>
    </>
  );
}
