import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ClipboardList,
  Layers3,
  PackageSearch,
  PanelsTopLeft,
  RefreshCw,
} from "lucide-react";
import { api } from "../services/api";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const tabs = [
  { id: "orders", label: "Pedidos", icon: ClipboardList },
  { id: "inventory", label: "Estoque", icon: PackageSearch },
  { id: "products", label: "Catálogo", icon: Layers3, adminOnly: true },
  { id: "banners", label: "Banners", icon: PanelsTopLeft, adminOnly: true },
];

export default function Management({ user, onBack, onLogout }) {
  const [tab, setTab] = useState("orders");
  const [data, setData] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adjustments, setAdjustments] = useState({});
  const [editingOrder, setEditingOrder] = useState(null);
  const availableTabs = tabs.filter(
    (item) => !item.adminOnly || user.role === "ADMIN",
  );
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await {
        orders: api.admin.orders,
        inventory: api.admin.inventory,
        products: api.admin.products,
        banners: api.admin.banners,
      }[tab]();
      setData(result[tab] ?? result.variants ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [tab]);
  const changeStatus = async (order, status) => {
    try {
      await api.admin.updateOrder(order.id, { status });
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const beginOrderEdit = (order) => {
    setEditingOrder({
      id: order.id,
      paidAmount: (order.paidAmountCents / 100).toFixed(2),
      quantities: Object.fromEntries(order.items.map((item) => [item.productVariantId, item.quantity])),
    });
  };
  const saveOrderEdit = async (order) => {
    if (!editingOrder || editingOrder.id !== order.id) return;
    const paidAmount = Number(editingOrder.paidAmount.replace(',', '.'));
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      setError('Informe um valor pago vÃ¡lido.');
      return;
    }
    const items = order.items
      .map((item) => ({ variantId: item.productVariantId, quantity: Number(editingOrder.quantities[item.productVariantId]) || 0 }))
      .filter((item) => item.quantity > 0);
    try {
      await api.admin.updateOrder(order.id, { paidAmountCents: Math.round(paidAmount * 100), items });
      setEditingOrder(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const archiveOrder = async (order) => {
    if (!window.confirm(`Arquivar o pedido ${order.publicNumber}? O histÃ³rico serÃ¡ preservado.`)) return;
    try {
      await api.admin.archiveOrder(order.id);
      if (editingOrder?.id === order.id) setEditingOrder(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const adjust = async (variant) => {
    const delta = Number(adjustments[variant.id]);
    if (!Number.isInteger(delta) || !delta) return;
    try {
      await api.admin.adjustInventory(variant.id, {
        delta,
        reason: "Ajuste realizado no painel",
      });
      setAdjustments({ ...adjustments, [variant.id]: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const toggleActive = async (item) => {
    try {
      await (tab === "products"
        ? api.admin.updateProduct(item.id, { active: !item.active })
        : api.admin.updateBanner(item.id, { active: !item.active }));
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="management-page">
      <header>
        <button className="logo" onClick={onBack}>
          <span>Ferchu</span>
          <small>MODAS</small>
        </button>
        <div className="management-user">
          <span>{user.role}</span>
          <button className="text-button" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>
      <main className="management-main">
        <div className="management-heading">
          <div>
            <span className="eyebrow">GESTÃO</span>
            <h1>Olá, {user.name.split(" ")[0]}.</h1>
          </div>
          <button className="button outline" onClick={load}>
            <RefreshCw size={16} /> Atualizar
          </button>
        </div>
        <div className="management-tabs">
          {availableTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <Icon size={17} /> {item.label}
              </button>
            );
          })}
        </div>
        {error && <p className="form-error">{error}</p>}
        {loading ? (
          <p className="management-loading">Carregando…</p>
        ) : (
          <section className="management-panel">
            {tab === "orders" && (
              <div className="management-list">
                {data.map((order) => (
                  <article className="management-order" key={order.id}>
                    <div>
                      <b>{order.publicNumber}</b>
                      <small>
                        {order.customerName} · {order.customerWhatsApp}
                      </small>
                      <small>
                        {order.items.reduce(
                          (sum, item) => sum + item.quantity,
                          0,
                        )}{" "}
                        peças · {money.format(order.totalCents / 100)}
                      </small>
                    </div>
                    <select
                      value={order.status}
                      onChange={(event) =>
                        changeStatus(order, event.target.value)
                      }
                    >
                      <option value="NOVO">NOVO</option>
                      <option value="CONFIRMADO">CONFIRMADO</option>
                      <option value="CANCELADO">CANCELADO</option>
                      <option value="CONCLUIDO">CONCLUÍDO</option>
                    </select>
                    <div className="order-actions">
                      <button className="text-button" onClick={() => editingOrder?.id === order.id ? setEditingOrder(null) : beginOrderEdit(order)}>
                        {editingOrder?.id === order.id ? "Fechar edição" : "Editar pedido"}
                      </button>
                      <button className="text-button danger" onClick={() => archiveOrder(order)}>Arquivar</button>
                    </div>
                    {editingOrder?.id === order.id && (
                      <div className="order-editor">
                        <label>Valor pago (R$)<input inputMode="decimal" value={editingOrder.paidAmount} onChange={(event) => setEditingOrder({ ...editingOrder, paidAmount: event.target.value })} /></label>
                        {order.items.map((item) => (
                          <label key={item.id}>{item.productNameSnapshot} – {item.optionNameSnapshot} / {item.sizeSnapshot}<input type="number" min="0" max="999" value={editingOrder.quantities[item.productVariantId] ?? 0} onChange={(event) => setEditingOrder({ ...editingOrder, quantities: { ...editingOrder.quantities, [item.productVariantId]: event.target.value } })} /></label>
                        ))}
                        <button className="button dark" onClick={() => saveOrderEdit(order)}>Salvar alterações</button>
                      </div>
                    )}
                  </article>
                ))}
                {!data.length && <p>Nenhum pedido ativo.</p>}
              </div>
            )}
            {tab === "inventory" && (
              <div className="management-list">
                {data.map((variant) => (
                  <article className="inventory-row" key={variant.id}>
                    <div>
                      <b>{variant.product}</b>
                      <small>
                        {variant.option} · {variant.size} · {variant.sku}
                      </small>
                    </div>
                    <div className="stock-numbers">
                      <span>
                        Físico <b>{variant.onHand}</b>
                      </span>
                      <span>
                        Reservado <b>{variant.reserved}</b>
                      </span>
                      <span>
                        Disponível <b>{variant.available}</b>
                      </span>
                    </div>
                    <div className="stock-adjust">
                      <input
                        aria-label={`Ajuste de ${variant.sku}`}
                        placeholder="± qtd."
                        inputMode="numeric"
                        value={adjustments[variant.id] ?? ""}
                        onChange={(event) =>
                          setAdjustments({
                            ...adjustments,
                            [variant.id]: event.target.value,
                          })
                        }
                      />
                      <button
                        className="button dark"
                        onClick={() => adjust(variant)}
                      >
                        Ajustar
                      </button>
                    </div>
                  </article>
                ))}
                {!data.length && <p>Nenhuma variação cadastrada.</p>}
              </div>
            )}
            {(tab === "products" || tab === "banners") && (
              <div className="management-list">
                {data.map((item) => (
                  <article className="management-order" key={item.id}>
                    <div>
                      <b>
                        {tab === "products"
                          ? item.name
                          : (item.title ?? "Banner sem título")}
                      </b>
                      <small>
                        {tab === "products"
                          ? item.category?.name
                          : item.asset?.url}
                      </small>
                    </div>
                    <button
                      className="button outline"
                      onClick={() => toggleActive(item)}
                    >
                      {item.active ? "Desativar" : "Ativar"}
                    </button>
                  </article>
                ))}
                {!data.length && <p>Nenhum registro encontrado.</p>}
              </div>
            )}
          </section>
        )}
        <button className="back-link management-back" onClick={onBack}>
          <ArrowLeft size={17} /> Voltar à loja
        </button>
      </main>
    </div>
  );
}
