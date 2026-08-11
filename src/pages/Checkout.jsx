import React, { useState } from "react";

import Footer from "../components/Footer";
import Logo from "../components/Logo";

import { ArrowLeft, ArrowRight, MapPin, PackageCheck, Send, Truck } from "lucide-react";
import { z } from "zod";

import {
  buildOrderMessage,
  sendToWhatsApp,
} from "../utils/whatsapp";
import { api } from "../services/api";

// Formata valores monetários no padrão brasileiro
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Função para formatar o CEP no padrão brasileiro (XXXXX-XXX)
function formatCep(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.replace(/(\d{5})(\d)/, "$1-$2");
}

// Função para estimar o frete com base no CEP e peso do pedido
function estimateShipping(cep, weight) {
  const firstDigit = cep.replace(/\D/g, "")[0];
  const first = Number(firstDigit);
  if (firstDigit === undefined || weight <= 0) return null;
  const zone = first <= 3 ? 1 : first <= 6 ? 1.22 : 1.5;
  const rounded = Math.max(0.5, Math.ceil(weight * 2) / 2);
  return {
    correios: {
      label: "Correios",
      detail: `PAC estimado · ${rounded.toFixed(1).replace(".", ",")} kg`,
      price: Math.round((17.5 + rounded * 8.8) * zone * 100) / 100,
      days: zone === 1 ? "4–7 dias úteis" : "7–12 dias úteis",
    },
    excursion: {
      label: "Excursão",
      detail: "Disponibilidade confirmada após o pedido",
      price: Math.round((12 + rounded * 5.2) * zone * 100) / 100,
      days: "2–6 dias úteis",
    },
  };
}

export default function Checkout({ lines, onBack, qtyTotal, orderTotal, totalWeight, user }) {
  const [cep, setCep] = useState("");
  const [shipping, setShipping] = useState(null);
  const [shippingError, setShippingError] = useState("");
  const [chosen, setChosen] = useState(null);
  const [sending, setSending] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [customer, setCustomer] = useState({ name: user?.name ?? "", whatsapp: "", email: user?.email ?? "" });

  const total = orderTotal;

  const selectedDelivery =
    chosen === "excursion"
      ? { label: "Excursão", price: 0, pending: true }
      : chosen === "correios"
        ? shipping?.correios
        : null;

        
  
  // Função para lidar com o envio do pedido via WhatsApp
  const handleWhatsApp = async () => {
    if (sending) return;
    setOrderError("");
    try {
      if (customer.name.trim().length < 2) throw new Error("Informe seu nome para enviar o pedido.");
      if (customer.whatsapp.replace(/\D/g, "").length < 10) throw new Error("Informe um WhatsApp vÃ¡lido com DDD.");
      if (customer.email && !z.string().email().safeParse(customer.email).success) throw new Error("Informe um e-mail vÃ¡lido ou deixe o campo em branco.");
      setSending(true);
      if (lines.some((line) => !line.variantId)) throw new Error("O catálogo ainda está sendo atualizado. Reabra o pedido e tente novamente.");
      const { order } = await api.orders.create({
        customer: { ...customer, email: customer.email || undefined },
        delivery: { method: chosen === "correios" ? "CORREIOS" : "EXCURSAO", postalCode: chosen === "correios" ? cep : undefined },
        items: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      });
      sendToWhatsApp(buildOrderMessage({ lines, qtyTotal, selectedDelivery, orderNumber: order.publicNumber }));
    } catch (error) {
      setOrderError(error.message);
    } finally {
      setSending(false);
    }
  };

  const calculate = () => {
    const parsed = z
      .string()
      .regex(/^\d{5}-?\d{3}$/)
      .safeParse(cep);
    if (!parsed.success) {
      setShippingError("Digite um CEP válido com 8 números.");
      return;
    }
    setShippingError("");
    setShipping(estimateShipping(cep, totalWeight));
  };
  return (
    <div className="checkout">
      <header>
        <Logo onHome={onBack} />
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={18} /> Voltar e editar
        </button>
      </header>
      <main className="checkout-main">
        <div className="checkout-intro">
          <span className="eyebrow">FINALIZAR PEDIDO</span>
          <h1>Quase lá.</h1>
          <p>Revise suas peças e escolha como prefere receber.</p>
        </div>
        <div className="checkout-layout">
          <section className="review">
            <div className="checkout-section-title">
              <h2>Seu pedido</h2>
              <span>
                {qtyTotal} peças ·{" "}
                {totalWeight.toFixed(2).replace(".", ",")} kg
              </span>
            </div>
            {lines.map((line) => (
              <div className="review-line" key={line.key}>
                <img src={line.image} alt="" />
                <div>
                  <strong>{line.name}</strong>
                  <small>
                    {line.color} · Tamanho {line.size}
                  </small>
                  <b>
                    {line.quantity} × {money.format(line.price)}
                  </b>
                </div>
                <strong>{money.format(line.price * line.quantity)}</strong>
              </div>
            ))}
            <button className="text-button" onClick={onBack}>
              <ArrowLeft size={16} /> Ajustar pedido
            </button>
          </section>
          <section className="shipping">
            <span className="eyebrow">ENTREGA</span>
            <h2>Como prefere receber?</h2>
            <p className="shipping-copy">
              Escolha a modalidade. O CEP é necessário somente para a estimativa
              dos Correios.
            </p>
            <div className="delivery-methods">
              <button
                className={`delivery-method ${chosen === "correios" ? "chosen" : ""}`}
                onClick={() => setChosen("correios")}
              >
                <Truck size={19} />
                <span>
                  <b>Correios</b>
                  <small>Calcular valor pelo CEP</small>
                </span>
                <span className="shipping-radio" />
              </button>
              <button
                className={`delivery-method ${chosen === "excursion" ? "chosen" : ""}`}
                onClick={() => setChosen("excursion")}
              >
                <PackageCheck size={19} />
                <span>
                  <b>Excursão</b>
                  <small>Sem necessidade de CEP</small>
                </span>
                <span className="shipping-radio" />
              </button>
            </div>
            {chosen === "correios" && (
              <div className="correios-calculator">
                <label className="cep-label">
                  Seu CEP{" "}
                  <div>
                    <MapPin size={18} />
                    <input
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={cep}
                      onChange={(event) =>
                        setCep(formatCep(event.target.value))
                      }
                      placeholder="00000-000"
                      maxLength="9"
                    />
                  </div>
                </label>
                <button className="button dark full" onClick={calculate}>
                  Calcular estimativa <ArrowRight size={18} />
                </button>
                {shippingError && (
                  <p className="form-error" role="alert">
                    {shippingError}
                  </p>
                )}
                {shipping && (
                  <div className="shipping-options">
                    <div className="shipping-option chosen">
                      <span className="shipping-radio" />{" "}
                      <div>
                        <b>{shipping.correios.label}</b>
                        <small>{shipping.correios.detail}</small>
                        <em>{shipping.correios.days}</em>
                      </div>
                      <strong>{money.format(shipping.correios.price)}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}
            {chosen === "excursion" && (
              <div className="excursion-note">
                <PackageCheck size={18} />
                <p>
                  <b>Entrega por excursão selecionada.</b> O valor e a rota
                  serão confirmados com você via WhatsApp.
                </p>
              </div>
            )}
            <p className="secure-note">
              <PackageCheck size={16} /> Simulação informativa.
            </p>
          </section>
        </div>
        <section className="confirm-box">
          <div className="customer-fields">
            <label>Seu nome<input required value={customer.name} maxLength="120" onChange={(event) => setCustomer({ ...customer, name: event.target.value })} /></label>
            <label>WhatsApp<input required inputMode="tel" value={customer.whatsapp} maxLength="30" onChange={(event) => setCustomer({ ...customer, whatsapp: event.target.value })} /></label>
            <label>E-mail <small>(opcional)</small><input type="email" value={customer.email} maxLength="191" onChange={(event) => setCustomer({ ...customer, email: event.target.value })} /></label>
          </div>
          <div>
            <span>
              {selectedDelivery?.pending
                ? "Total dos produtos"
                : "Total estimado"}
            </span>
            <strong>
              {money.format(total + (selectedDelivery?.price || 0))}
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
            className="button primary"
            disabled={!selectedDelivery || qtyTotal < 20 || sending}
            onClick={handleWhatsApp}
          >
            Enviar pedido pelo WhatsApp<Send size={18} />
          </button>
          {orderError && <p className="form-error checkout-error" role="alert">{orderError}</p>}
        </section>
      </main>
      <Footer onHome={onBack} />
    </div>
  );
}
