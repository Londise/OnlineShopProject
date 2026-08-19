import React, { useEffect, useState } from "react";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuthContext } from "../contexts/AuthContext";
import { api } from "../services/api";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function Account() {
  const navigate = useNavigate();

  const { user, logout } = useAuthContext();

  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      try {
        setError("");

        const { orders } = await api.orders.mine();

        if (!cancelled) {
          setOrders(orders ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.message || "Não foi possível carregar seus pedidos."
          );
        }
      }
    }

    loadOrders();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  function handleBack() {
    navigate("/");
  }

  function handleManagement() {
    navigate("/management");
  }

  const firstName = user?.name
    ? user.name.trim().split(/\s+/)[0]
    : "cliente";

  return (
    <div className="account-page">
      <header>
        <button
          type="button"
          className="logo"
          onClick={handleBack}
        >
          <span>Ferchu</span>
          <small>MODAS</small>
        </button>

        <button
          type="button"
          className="back-link"
          onClick={handleBack}
        >
          <ArrowLeft size={18} />
          Voltar à loja
        </button>
      </header>

      <main className="account-main">
        <span className="eyebrow">MINHA CONTA</span>

        <h1>Olá, {firstName}.</h1>

        <button
          type="button"
          className="text-button"
          onClick={handleLogout}
        >
          Sair da conta
        </button>

        <button
          type="button"
          onClick={handleManagement}
        >
          <PackageCheck size={18} />
          Ir para o Gestor de Estoque
        </button>

        <section className="account-orders">
          <h2>Meus pedidos</h2>

          {error && (
            <p className="account-error">
              {error}
            </p>
          )}

          {!error && orders.length === 0 && (
            <p>Nenhum pedido encontrado.</p>
          )}

          {orders.length > 0 && (
            <div className="orders-list">
              {orders.map((order) => (
                <article
                  key={order.id}
                  className="order-card"
                >
                  <div>
                    <strong>
                      Pedido #{order.id}
                    </strong>

                    {order.createdAt && (
                      <small>
                        {new Date(
                          order.createdAt
                        ).toLocaleDateString("pt-BR")}
                      </small>
                    )}
                  </div>

                  <div>
                    {order.total != null && (
                      <strong>
                        {money.format(Number(order.total))}
                      </strong>
                    )}

                    {order.status && (
                      <span>
                        {order.status}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}