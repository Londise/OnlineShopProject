/* O carrinho fica salvo em localStorage, o estado responsável por gerenciar o carrinho
tenta recuperar o carrinho armazenado no localStorage antes de carregar o Checkout, se
tiver um carrinho em localStorage, ele é armazenado no estado controlador do carrinho
que é "lines", a cada mudança do carrinho */

import React, { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import Footer from "../components/Footer";
import Logo from "../components/Logo";

import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  PackageCheck,
  Send,
  Truck,
} from "lucide-react";

import { z } from "zod";

import { useCartContext } from "../contexts/CartContext";
import { useAuthContext } from "../contexts/AuthContext";

import {
  buildOrderMessage,
  sendToWhatsApp,
} from "../utils/whatsapp";

import { api } from "../services/api";

/*
 * ============================================================
 * CONFIGURAÇÕES
 * ============================================================
 */

const MIN_ORDER_QUANTITY = 15;

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function formatCep(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);

  return digits.replace(/(\d{5})(\d)/, "$1-$2");
}

function estimateShipping(cep, weight) {
  const digits = cep.replace(/\D/g, "");
  const firstDigit = digits[0];

  if (firstDigit === undefined || weight <= 0) {
    return null;
  }

  const first = Number(firstDigit);

  const zone =
    first <= 3
      ? 1
      : first <= 6
        ? 1.22
        : 1.5;

  const rounded = Math.max(
    0.5,
    Math.ceil(weight * 2) / 2,
  );

  return {
    correios: {
      label: "Correios",

      detail: `PAC estimado · ${rounded
        .toFixed(1)
        .replace(".", ",")} kg`,

      price:
        Math.round(
          (17.5 + rounded * 8.8) * zone * 100,
        ) / 100,

      days:
        zone === 1
          ? "4–7 dias úteis"
          : "7–12 dias úteis",
    },

    excursion: {
      label: "Excursão",

      detail:
        "Disponibilidade confirmada após o pedido",

      price:
        Math.round(
          (12 + rounded * 5.2) * zone * 100,
        ) / 100,

      days: "2–6 dias úteis",
    },
  };
}

/*
 * ============================================================
 * COMPONENTE
 * ============================================================
 */

export default function Checkout() {
  const navigate = useNavigate();

  /*
   * ==========================================================
   * CONTEXTOS
   * ==========================================================
   */

  const {
    lines,
    qtyTotal,
    orderTotal,
    totalWeight,
  } = useCartContext();

  console.log("Checkout qtyTotal:", qtyTotal);

  const { user } = useAuthContext();

  /*
   * ==========================================================
   * PROTEÇÃO DO CHECKOUT
   * ==========================================================
   *
   * O Checkout nunca deve permanecer acessível com menos
   * de 15 peças.
   *
   * Essa proteção é do FRONTEND.
   *
   * A API também terá sua própria validação.
   */

  useEffect(() => {
    if (qtyTotal < MIN_ORDER_QUANTITY) {
      navigate("/", { replace: true });
    }
  }, [qtyTotal, navigate]);

  /*
   * Enquanto o redirecionamento acontece, não renderiza
   * o Checkout.
   */

  if (qtyTotal < MIN_ORDER_QUANTITY) {
    return null;
  }

  /*
   * ==========================================================
   * ESTADO
   * ==========================================================
   */

  const [cep, setCep] = useState("");

  const [shipping, setShipping] = useState(null);

  const [shippingError, setShippingError] = useState("");

  const [chosen, setChosen] = useState(null);

  const [sending, setSending] = useState(false);

  const [orderError, setOrderError] = useState("");

  const [customer, setCustomer] = useState({
    name: user?.name ?? "",
    whatsapp: "",
    email: user?.email ?? "",
  });

  /*
   * ==========================================================
   * ENTREGA SELECIONADA
   * ==========================================================
   */

  const total = orderTotal;

  const selectedDelivery =
    chosen === "excursion"
      ? {
          label: "Excursão",
          price: 0,
          pending: true,
        }
      : chosen === "correios"
        ? shipping?.correios
        : null;

  /*
   * ==========================================================
   * WHATSAPP / PEDIDO
   * ==========================================================
   */

  const handleWhatsApp = async () => {
    if (sending) {
      return;
    }

    setOrderError("");

    try {
      /*
       * Defesa adicional no frontend.
       *
       * Mesmo que alguém consiga chegar aqui de alguma forma,
       * não permitimos criar o pedido.
       */

      if (qtyTotal < MIN_ORDER_QUANTITY) {
        throw new Error(
          `O pedido mínimo é de ${MIN_ORDER_QUANTITY} peças.`,
        );
      }

      /*
       * Nome
       */

      if (customer.name.trim().length < 2) {
        throw new Error(
          "Informe seu nome para enviar o pedido.",
        );
      }

      /*
       * WhatsApp
       */

      if (
        customer.whatsapp.replace(/\D/g, "").length < 10
      ) {
        throw new Error(
          "Informe um WhatsApp válido com DDD.",
        );
      }

      /*
       * E-mail
       */

      if (
        customer.email &&
        !z
          .string()
          .email()
          .safeParse(customer.email).success
      ) {
        throw new Error(
          "Informe um e-mail válido ou deixe o campo em branco.",
        );
      }

      setSending(true);

      /*
       * Garante que todas as linhas possuem variantId.
       */

      if (lines.some((line) => !line.variantId)) {
        throw new Error(
          "O catálogo ainda está sendo atualizado. Reabra o pedido e tente novamente.",
        );
      }

      /*
       * Criação do pedido.
       *
       * O BACKEND também precisa validar o mínimo.
       */

      const { order } = await api.orders.create({
        customer: {
          ...customer,
          email: customer.email || undefined,
        },

        delivery: {
          method:
            chosen === "correios"
              ? "CORREIOS"
              : "EXCURSAO",

          postalCode:
            chosen === "correios"
              ? cep
              : undefined,
        },

        items: lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
        })),
      });

      /*
       * Só abre o WhatsApp depois que a API confirmou
       * a criação do pedido.
       */

      sendToWhatsApp(
        buildOrderMessage({
          lines,
          qtyTotal,
          selectedDelivery,
          orderNumber: order.publicNumber,
        }),
      );
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o pedido.",
      );
    } finally {
      setSending(false);
    }
  };

  /*
   * ==========================================================
   * FRETE
   * ==========================================================
   */

  const calculate = () => {
    const parsed = z
      .string()
      .regex(/^\d{5}-?\d{3}$/)
      .safeParse(cep);

    if (!parsed.success) {
      setShippingError(
        "Digite um CEP válido com 8 números.",
      );

      setShipping(null);

      return;
    }

    setShippingError("");

    const estimated = estimateShipping(
      cep,
      totalWeight,
    );

    setShipping(estimated);
  };

  /*
   * ==========================================================
   * RENDER
   * ==========================================================
   */

  return (
    <div className="checkout">
      <header>
        <Logo onHome={() => navigate("/")} />

        <button
          className="back-link"
          type="button"
          onClick={() => navigate("/")}
        >
          <ArrowLeft size={18} />
          Voltar e editar
        </button>
      </header>

      <main className="checkout-main">
        <div className="checkout-intro">
          <span className="eyebrow">
            FINALIZAR PEDIDO
          </span>

          <h1>Quase lá.</h1>

          <p>
            Revise suas peças e escolha como prefere
            receber.
          </p>
        </div>

        <div className="checkout-layout">
          {/* ==================================================
              RESUMO DO PEDIDO
          ================================================== */}

          <section className="review">
            <div className="checkout-section-title">
              <h2>Seu pedido</h2>

              <span>
                {qtyTotal} peças ·{" "}
                {totalWeight
                  .toFixed(2)
                  .replace(".", ",")}{" "}
                kg
              </span>
            </div>

            {lines.map((line) => (
              <div
                className="review-line"
                key={line.key}
              >
                <img
                  src={line.image}
                  alt=""
                />

                <div>
                  <strong>{line.name}</strong>

                  <small>
                    {line.color} · Tamanho{" "}
                    {line.size}
                  </small>

                  <b>
                    {line.quantity} ×{" "}
                    {money.format(line.price)}
                  </b>
                </div>

                <strong>
                  {money.format(
                    line.price * line.quantity,
                  )}
                </strong>
              </div>
            ))}

            <button
              type="button"
              className="text-button"
              onClick={() => navigate("/")}
            >
              <ArrowLeft size={16} />
              Ajustar pedido
            </button>
          </section>

          {/* ==================================================
              ENTREGA
          ================================================== */}

          <section className="shipping">
            <span className="eyebrow">
              ENTREGA
            </span>

            <h2>
              Como prefere receber?
            </h2>

            <p className="shipping-copy">
              Escolha a modalidade. O CEP é
              necessário somente para a estimativa
              dos Correios.
            </p>

            <div className="delivery-methods">
              {/* CORREIOS */}

              <button
                type="button"
                className={`delivery-method ${
                  chosen === "correios"
                    ? "chosen"
                    : ""
                }`}
                onClick={() => {
                  setChosen("correios");
                  setShippingError("");
                }}
              >
                <Truck size={19} />

                <span>
                  <b>Correios</b>

                  <small>
                    Calcular valor pelo CEP
                  </small>
                </span>

                <span className="shipping-radio" />
              </button>

              {/* EXCURSÃO */}

              <button
                type="button"
                className={`delivery-method ${
                  chosen === "excursion"
                    ? "chosen"
                    : ""
                }`}
                onClick={() => {
                  setChosen("excursion");
                  setShippingError("");
                  setShipping(null);
                }}
              >
                <PackageCheck size={19} />

                <span>
                  <b>Excursão</b>

                  <small>
                    Sem necessidade de CEP
                  </small>
                </span>

                <span className="shipping-radio" />
              </button>
            </div>

            {/* ==================================================
                CALCULADORA DOS CORREIOS
            ================================================== */}

            {chosen === "correios" && (
              <div className="correios-calculator">
                <label className="cep-label">
                  Seu CEP

                  <div>
                    <MapPin size={18} />

                    <input
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={cep}
                      onChange={(event) =>
                        setCep(
                          formatCep(
                            event.target.value,
                          ),
                        )
                      }
                      placeholder="00000-000"
                      maxLength={9}
                    />
                  </div>
                </label>

                <button
                  type="button"
                  className="button dark full"
                  onClick={calculate}
                >
                  Calcular estimativa
                  <ArrowRight size={18} />
                </button>

                {shippingError && (
                  <p
                    className="form-error"
                    role="alert"
                  >
                    {shippingError}
                  </p>
                )}

                {shipping && (
                  <div className="shipping-options">
                    <div className="shipping-option chosen">
                      <span className="shipping-radio" />

                      <div>
                        <b>
                          {shipping.correios.label}
                        </b>

                        <small>
                          {shipping.correios.detail}
                        </small>

                        <em>
                          {shipping.correios.days}
                        </em>
                      </div>

                      <strong>
                        {money.format(
                          shipping.correios.price,
                        )}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================================================
                EXCURSÃO
            ================================================== */}

            {chosen === "excursion" && (
              <div className="excursion-note">
                <PackageCheck size={18} />

                <p>
                  <b>
                    Entrega por excursão
                    selecionada.
                  </b>{" "}
                  O valor e a rota serão
                  confirmados com você via
                  WhatsApp.
                </p>
              </div>
            )}

            <p className="secure-note">
              <PackageCheck size={16} />
              Simulação informativa.
            </p>
          </section>
        </div>

        {/* ==================================================
            CONFIRMAÇÃO
        ================================================== */}

        <section className="confirm-box">
          <div className="customer-fields">
            <label>
              Seu nome

              <input
                required
                value={customer.name}
                maxLength={120}
                onChange={(event) =>
                  setCustomer({
                    ...customer,
                    name: event.target.value,
                  })
                }
              />
            </label>

            <label>
              WhatsApp

              <input
                required
                inputMode="tel"
                value={customer.whatsapp}
                maxLength={30}
                onChange={(event) =>
                  setCustomer({
                    ...customer,
                    whatsapp:
                      event.target.value,
                  })
                }
              />
            </label>

            <label>
              E-mail{" "}
              <small>(opcional)</small>

              <input
                type="email"
                value={customer.email}
                maxLength={191}
                onChange={(event) =>
                  setCustomer({
                    ...customer,
                    email: event.target.value,
                  })
                }
              />
            </label>
          </div>

          <div>
            <span>
              {selectedDelivery?.pending
                ? "Total dos produtos"
                : "Total estimado"}
            </span>

            <strong>
              {money.format(
                total +
                  (selectedDelivery?.price || 0),
              )}
            </strong>

            <small>
              {selectedDelivery?.pending
                ? "Frete da excursão será confirmado após o pedido"
                : selectedDelivery
                  ? `Produtos + ${selectedDelivery.label}`
                  : "Escolha uma forma de entrega para continuar"}
            </small>
          </div>

          <button
            type="button"
            className="button primary"
            disabled={
              !selectedDelivery ||
              qtyTotal < MIN_ORDER_QUANTITY ||
              sending
            }
            onClick={handleWhatsApp}
          >
            {sending
              ? "Enviando pedido..."
              : "Enviar pedido pelo WhatsApp"}

            <Send size={18} />
          </button>

          {orderError && (
            <p
              className="form-error checkout-error"
              role="alert"
            >
              {orderError}
            </p>
          )}
        </section>
      </main>

      <Footer onHome={() => navigate("/")} />
    </div>
  );
}