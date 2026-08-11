import React, { useEffect, useState } from "react";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { api } from "../services/api";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export default function Account({ user, onBack, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.orders
      .mine()
      .then(({ orders }) => setOrders(orders))
      .catch((err) => setError(err.message));
  }, []);
  return (
    <div className="account-page">
      <header>
        <button className="logo" onClick={onBack}>
          <span>Ferchu</span>
          <small>MODAS</small>
        </button>
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={18} /> Voltar à loja
        </button>
      </header>
      <main className="account-main">
        <span className="eyebrow">MINHA CONTA</span>
        <h1>Olá, {user.name.split(" ")[0]}.</h1>
        <button className="text-button" onClick={onLogout}>
          Sair da conta
        </button>
        <h2>Meus pedidos</h2>
        {error && <p className="form-error">{error}</p>}
        {!orders.length ? (
          <p className="account-empty">
            <PackageCheck /> Ainda não há pedidos vinculados à sua conta.
          </p>
        ) : (
          <div className="account-orders">
            {orders.map((order) => (
              <article key={order.id}>
                <div>
                  <b>{order.publicNumber}</b>
                  <small>
                    {new Date(order.createdAt).toLocaleDateString("pt-BR")} ·{" "}
                    {order.items.length} itens
                  </small>
                </div>
                <span
                  className={`order-status status-${order.status.toLowerCase()}`}
                >
                  {order.status}
                </span>
                <strong>{money.format(order.totalCents / 100)}</strong>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
