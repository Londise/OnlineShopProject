import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Layers3,
  PackageSearch,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Minus,
  Save,
  X,
} from "lucide-react";
import { api } from "../services/api";

import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/*
 * ============================================================
 * CONFIGURAÇÕES
 * ============================================================
 */

const tabs = [
  {
    id: "orders",
    label: "Pedidos",
    icon: ClipboardList,
  },
  {
    id: "inventory",
    label: "Estoque",
    icon: PackageSearch,
  },
  {
    id: "products",
    label: "Catálogo",
    icon: Layers3,
    adminOnly: true,
  },
  {
    id: "banners",
    label: "Banners",
    icon: PanelsTopLeft,
    adminOnly: true,
  },
];

const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EXG"];

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

const applyInventoryDelta = (variant, delta) => {
  const onHand = Number(variant.onHand ?? 0);
  const reserved = Number(variant.reserved ?? 0);

  const newOnHand = onHand + delta;

  return {
    ...variant,
    onHand: newOnHand,
    available: newOnHand - reserved,
  };
};

const mergeInventoryResult = (variant, result, delta) => {
  if (!result || typeof result !== "object") {
    return applyInventoryDelta(variant, delta);
  }

  const returnedVariant = result.variant ?? result;

  const hasInventoryFields =
    returnedVariant &&
    typeof returnedVariant === "object" &&
    ("onHand" in returnedVariant ||
      "available" in returnedVariant ||
      "reserved" in returnedVariant);

  if (!hasInventoryFields) {
    return applyInventoryDelta(variant, delta);
  }

  return {
    ...variant,
    ...returnedVariant,
  };
};

const getOrderItems = (order) => {
  if (Array.isArray(order?.items)) {
    return order.items;
  }

  return [];
};

/*
 * ============================================================
 * COMPONENTE
 * ============================================================
 */

export default function Management() {
  /*
   * ==========================================================
   * CONTEXTOS
   * ==========================================================
   *
   * NÃO remover.
   *
   * O Management depende do AuthContext para saber:
   *
   * - quem está logado;
   * - qual é a role;
   * - como fazer logout.
   *
   * Os hooks precisam apenas estar dentro do componente.
   */

  const navigate = useNavigate();

  const { user, logout } = useAuthContext();

  const [tab, setTab] = useState("orders");

  const [data, setData] = useState([]);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(true);

  /*
   * Ajustes individuais.
   *
   * O valor digitado representa o NOVO estoque.
   */
  const [adjustments, setAdjustments] = useState({});

  /*
   * Ajustes em lote por cor.
   */
  const [batchAdjustments, setBatchAdjustments] = useState({});

  /*
   * Produtos abertos.
   */
  const [expandedProducts, setExpandedProducts] = useState({});

  /*
   * Cores abertas.
   */
  const [expandedColors, setExpandedColors] = useState({});

  /*
   * Variantes sendo salvas.
   */
  const [savingVariants, setSavingVariants] = useState({});

  /*
   * Lotes sendo salvos.
   */
  const [savingBatches, setSavingBatches] = useState({});

  /*
   * Pedido atualmente em edição.
   */
  const [editingOrder, setEditingOrder] = useState(null);

  const availableTabs = tabs.filter(
    (item) => !item.adminOnly || user?.role === "ADMIN",
  );

  // Verifica se há usuário, se não, volta para o home (dupla camada de segurança)
  useEffect(() => {
    if (!user) {
      navigate("/", { replace: true });
      return;
    }

    if (user.role !== "ADMIN") {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

    // Lida com o logout
    const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/", { replace: true });
    }
  };

  /*
   * ============================================================
   * CARREGAMENTO
   * ============================================================
   */

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const loaders = {
        orders: api.admin.orders,
        inventory: api.admin.inventory,
        products: api.admin.products,
        banners: api.admin.banners,
      };

      const result = await loaders[tab]();

      setData(result[tab] ?? result.variants ?? []);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab]);

  /*
   * ============================================================
   * PEDIDOS
   * ============================================================
   */

  const changeStatus = async (order, status) => {
    try {
      await api.admin.updateOrder(order.id, { status });

      await load();
    } catch (err) {
      setError(err?.message || "Não foi possível alterar o status.");
    }
  };

  const beginOrderEdit = (order) => {
    const items = getOrderItems(order);

    setEditingOrder({
      id: order.id,

      paidAmount: (Number(order.paidAmountCents ?? 0) / 100).toFixed(2),

      quantities: Object.fromEntries(
        items.map((item) => [item.productVariantId, item.quantity]),
      ),
    });
  };

  const saveOrderEdit = async (order) => {
    if (!editingOrder || editingOrder.id !== order.id) {
      return;
    }

    const paidAmount = Number(
      String(editingOrder.paidAmount).replace(",", "."),
    );

    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      setError("Informe um valor pago válido.");
      return;
    }

    const items = getOrderItems(order)
      .map((item) => ({
        variantId: item.productVariantId,
        quantity: Number(editingOrder.quantities[item.productVariantId]) || 0,
      }))
      .filter((item) => item.quantity > 0);

    try {
      await api.admin.updateOrder(order.id, {
        paidAmountCents: Math.round(paidAmount * 100),
        items,
      });

      setEditingOrder(null);

      await load();
    } catch (err) {
      setError(err?.message || "Não foi possível salvar o pedido.");
    }
  };

  const archiveOrder = async (order) => {
    const confirmed = window.confirm(
      `Arquivar o pedido ${order.publicNumber}? O histórico será preservado.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await api.admin.archiveOrder(order.id);

      if (editingOrder?.id === order.id) {
        setEditingOrder(null);
      }

      await load();
    } catch (err) {
      setError(err?.message || "Não foi possível arquivar o pedido.");
    }
  };

  /*
   * ============================================================
   * ESTOQUE — AGRUPAMENTO
   * ============================================================
   */

  const inventoryGroups = useMemo(() => {
    if (tab !== "inventory") {
      return [];
    }

    const products = new Map();

    data.forEach((variant) => {
      const productKey = variant.product;

      if (!products.has(productKey)) {
        products.set(productKey, {
          name: variant.product,
          category: variant.category,
          colors: new Map(),
        });
      }

      const product = products.get(productKey);

      const colorKey = variant.option;

      if (!product.colors.has(colorKey)) {
        product.colors.set(colorKey, {
          name: variant.option,
          variants: [],
        });
      }

      product.colors.get(colorKey).variants.push(variant);
    });

    return Array.from(products.values()).map((product) => ({
      ...product,

      colors: Array.from(product.colors.values()).map((color) => ({
        ...color,

        variants: [...color.variants].sort((a, b) => {
          const aIndex = SIZE_ORDER.indexOf(a.size);

          const bIndex = SIZE_ORDER.indexOf(b.size);

          if (aIndex === -1 && bIndex === -1) {
            return a.size.localeCompare(b.size);
          }

          if (aIndex === -1) {
            return 1;
          }

          if (bIndex === -1) {
            return -1;
          }

          return aIndex - bIndex;
        }),
      })),
    }));
  }, [data, tab]);

  /*
   * ============================================================
   * ESTOQUE — EXPANSÃO
   * ============================================================
   */

  const toggleProduct = (productName) => {
    setExpandedProducts((current) => ({
      ...current,
      [productName]: !current[productName],
    }));
  };

  const toggleColor = (productName, colorName) => {
    const key = `${productName}::${colorName}`;

    setExpandedColors((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  /*
   * ============================================================
   * ESTOQUE — AJUSTE INDIVIDUAL
   * ============================================================
   */

  const setIndividualAdjustment = (variantId, value) => {
    setAdjustments((current) => ({
      ...current,
      [variantId]: value,
    }));
  };

  const adjust = async (variant) => {
    const key = variant.id;

    if (savingVariants[key]) {
      return;
    }

    const newValue = Number(adjustments[variant.id]);

    if (!Number.isInteger(newValue) || newValue < 0) {
      setError("Informe uma quantidade inteira maior ou igual a zero.");
      return;
    }

    const currentOnHand = Number(variant.onHand) || 0;

    const delta = newValue - currentOnHand;

    if (delta === 0) {
      setAdjustments((current) => ({
        ...current,
        [variant.id]: "",
      }));

      return;
    }

    const reserved = Number(variant.reserved) || 0;

    if (newValue < reserved) {
      setError(
        `O estoque físico de ${variant.sku} não pode ficar abaixo do reservado (${reserved}).`,
      );
      return;
    }

    setError("");

    setSavingVariants((current) => ({
      ...current,
      [key]: true,
    }));

    try {
      const result = await api.admin.adjustInventory(variant.id, {
        delta,
        reason: "Alteração de estoque realizada no painel",
      });

      setData((current) =>
        current.map((item) => {
          if (item.id !== variant.id) {
            return item;
          }

          return mergeInventoryResult(item, result, delta);
        }),
      );

      setAdjustments((current) => ({
        ...current,
        [variant.id]: "",
      }));
    } catch (err) {
      setError(err?.message || "Não foi possível alterar o estoque.");
    } finally {
      setSavingVariants((current) => ({
        ...current,
        [key]: false,
      }));
    }
  };

  /*
   * ============================================================
   * ESTOQUE — AJUSTE EM LOTE POR COR
   * ============================================================
   */

  const setBatchAdjustment = (productName, colorName, value) => {
    const key = `${productName}::${colorName}`;

    setBatchAdjustments((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const adjustColorBatch = async (product, color) => {
    const key = `${product.name}::${color.name}`;

    if (savingBatches[key]) {
      return;
    }

    const newValue = Number(batchAdjustments[key]);

    if (!Number.isInteger(newValue) || newValue < 0) {
      setError("Informe uma quantidade inteira maior ou igual a zero.");
      return;
    }

    const invalidVariant = color.variants.find((variant) => {
      const reserved = Number(variant.reserved) || 0;

      return newValue < reserved;
    });

    if (invalidVariant) {
      setError(
        `Não é possível definir ${newValue} unidades para a cor ${color.name}, pois o tamanho ${invalidVariant.size} possui ${invalidVariant.reserved} unidades reservadas.`,
      );
      return;
    }

    const operations = color.variants
      .map((variant) => {
        const currentOnHand = Number(variant.onHand) || 0;

        const delta = newValue - currentOnHand;

        return {
          variant,
          delta,
        };
      })
      .filter(({ delta }) => delta !== 0);

    if (!operations.length) {
      setBatchAdjustments((current) => ({
        ...current,
        [key]: "",
      }));

      return;
    }

    setError("");

    setSavingBatches((current) => ({
      ...current,
      [key]: true,
    }));

    try {
      const results = await Promise.allSettled(
        operations.map(({ variant, delta }) =>
          api.admin.adjustInventory(variant.id, {
            delta,
            reason: `Alteração em lote da cor ${color.name}`,
          }),
        ),
      );

      const successfulResults = new Map();

      const failedOperations = [];

      results.forEach((result, index) => {
        const operation = operations[index];

        if (result.status === "fulfilled") {
          successfulResults.set(operation.variant.id, {
            result: result.value,
            delta: operation.delta,
          });
        } else {
          failedOperations.push({
            variant: operation.variant,
            error: result.reason,
          });
        }
      });

      if (successfulResults.size > 0) {
        setData((current) =>
          current.map((item) => {
            const successful = successfulResults.get(item.id);

            if (!successful) {
              return item;
            }

            return mergeInventoryResult(
              item,
              successful.result,
              successful.delta,
            );
          }),
        );
      }

      if (failedOperations.length === 0) {
        setBatchAdjustments((current) => ({
          ...current,
          [key]: "",
        }));
      } else {
        const names = failedOperations
          .map(({ variant }) => variant.size)
          .join(", ");

        setError(
          `O lote foi aplicado parcialmente. Não foi possível alterar: ${names}. Verifique o estoque e tente novamente.`,
        );
      }
    } catch (err) {
      setError(err?.message || "Não foi possível concluir o ajuste em lote.");
    } finally {
      setSavingBatches((current) => ({
        ...current,
        [key]: false,
      }));
    }
  };

  /*
   * ============================================================
   * PRODUTOS / BANNERS
   * ============================================================
   */

  const toggleActive = async (item) => {
    try {
      if (tab === "products") {
        await api.admin.updateProduct(item.id, {
          active: !item.active,
        });
      } else {
        await api.admin.updateBanner(item.id, {
          active: !item.active,
        });
      }

      await load();
    } catch (err) {
      setError(err?.message || "Não foi possível atualizar o registro.");
    }
  };

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <div className="management-page">
      <header>
        <button className="logo" onClick={() => navigate("/")}>
          <span>Ferchu</span>
          <small>MODAS</small>
        </button>

        <div className="management-user">
          <span>{user?.role}</span>

          <button className="text-button" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <main className="management-main">
        <div className="management-heading">
          <div>
            <span className="eyebrow">GESTÃO</span>

            <h1>Olá, {user?.name?.split(" ")[0] ?? "usuário"}.</h1>
          </div>

          <button className="button outline" onClick={load} disabled={loading}>
            <RefreshCw size={16} />
            Atualizar
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
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="management-error">
            <span>{error}</span>

            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Fechar erro"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {loading ? (
          <p className="management-loading">Carregando…</p>
        ) : (
          <section className="management-panel">
            {/*
             * ==================================================
             * PEDIDOS
             * ==================================================
             */}

            {tab === "orders" && (
              <div className="management-list">
                {data.map((order) => {
                  const orderItems = getOrderItems(order);

                  return (
                    <article className="management-order" key={order.id}>
                      <div>
                        <b>{order.publicNumber}</b>

                        <small>
                          {order.customerName} · {order.customerWhatsApp}
                        </small>

                        <small>
                          {orderItems.reduce(
                            (sum, item) => sum + Number(item.quantity ?? 0),
                            0,
                          )}{" "}
                          peças ·{" "}
                          {money.format(Number(order.totalCents ?? 0) / 100)}
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
                        <button
                          className="text-button"
                          onClick={() =>
                            editingOrder?.id === order.id
                              ? setEditingOrder(null)
                              : beginOrderEdit(order)
                          }
                        >
                          {editingOrder?.id === order.id
                            ? "Fechar edição"
                            : "Editar pedido"}
                        </button>

                        <button
                          className="text-button danger"
                          onClick={() => archiveOrder(order)}
                        >
                          Arquivar
                        </button>
                      </div>

                      {editingOrder?.id === order.id && (
                        <div className="order-editor">
                          <label>
                            Valor pago (R$)
                            <input
                              inputMode="decimal"
                              value={editingOrder.paidAmount}
                              onChange={(event) =>
                                setEditingOrder({
                                  ...editingOrder,
                                  paidAmount: event.target.value,
                                })
                              }
                            />
                          </label>

                          {orderItems.map((item) => (
                            <label key={item.id}>
                              {item.productNameSnapshot} –{" "}
                              {item.optionNameSnapshot} / {item.sizeSnapshot}
                              <input
                                type="number"
                                min="0"
                                max="999"
                                value={
                                  editingOrder.quantities[
                                    item.productVariantId
                                  ] ?? 0
                                }
                                onChange={(event) =>
                                  setEditingOrder({
                                    ...editingOrder,
                                    quantities: {
                                      ...editingOrder.quantities,
                                      [item.productVariantId]:
                                        event.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}

                          <button
                            className="button dark"
                            onClick={() => saveOrderEdit(order)}
                          >
                            Salvar alterações
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}

                {!data.length && <p>Nenhum pedido ativo.</p>}
              </div>
            )}

            {/*
             * ==================================================
             * ESTOQUE
             * ==================================================
             */}

            {tab === "inventory" && (
              <div className="inventory-manager">
                <div className="inventory-intro">
                  <div>
                    <span className="eyebrow">CONTROLE DE ESTOQUE</span>

                    <h2>Produtos e cores</h2>

                    <p>
                      Gerencie o estoque por cor e tamanho. Você pode alterar um
                      tamanho individualmente ou definir a mesma quantidade para
                      todos os tamanhos de uma cor.
                    </p>
                  </div>

                  <div className="inventory-summary">
                    <strong>{data.length}</strong>

                    <span>variações</span>
                  </div>
                </div>

                <div className="inventory-products">
                  {inventoryGroups.map((product) => {
                    const productOpen = expandedProducts[product.name];

                    const totalAvailable = product.colors.reduce(
                      (productSum, color) =>
                        productSum +
                        color.variants.reduce(
                          (sum, variant) =>
                            sum + Number(variant.available ?? 0),
                          0,
                        ),
                      0,
                    );

                    return (
                      <article
                        className={`inventory-product ${
                          productOpen ? "open" : ""
                        }`}
                        key={product.name}
                      >
                        <button
                          type="button"
                          className="inventory-product-header"
                          onClick={() => toggleProduct(product.name)}
                        >
                          <div className="inventory-product-title">
                            <span className="inventory-chevron">
                              {productOpen ? (
                                <ChevronDown size={19} />
                              ) : (
                                <ChevronRight size={19} />
                              )}
                            </span>

                            <div>
                              <strong>{product.name}</strong>

                              <small>
                                {product.category} · {product.colors.length}{" "}
                                cores
                              </small>
                            </div>
                          </div>

                          <div className="inventory-product-total">
                            <span>Disponível</span>

                            <strong>{totalAvailable}</strong>
                          </div>
                        </button>

                        {productOpen && (
                          <div className="inventory-colors">
                            {product.colors.map((color) => {
                              const colorKey = `${product.name}::${color.name}`;

                              const colorOpen = expandedColors[colorKey];

                              const colorAvailable = color.variants.reduce(
                                (sum, variant) =>
                                  sum + Number(variant.available ?? 0),
                                0,
                              );

                              const isSavingBatch = Boolean(
                                savingBatches[colorKey],
                              );

                              return (
                                <div
                                  className={`inventory-color ${
                                    colorOpen ? "open" : ""
                                  }`}
                                  key={color.name}
                                >
                                  <button
                                    type="button"
                                    className="inventory-color-header"
                                    onClick={() =>
                                      toggleColor(product.name, color.name)
                                    }
                                  >
                                    <div className="inventory-color-name">
                                      <span className="color-indicator" />

                                      <div>
                                        <strong>{color.name}</strong>

                                        <small>
                                          {color.variants.length} tamanhos
                                        </small>
                                      </div>
                                    </div>

                                    <div className="inventory-color-total">
                                      <span>Disponível</span>

                                      <strong>{colorAvailable}</strong>
                                    </div>

                                    {colorOpen ? (
                                      <ChevronDown size={17} />
                                    ) : (
                                      <ChevronRight size={17} />
                                    )}
                                  </button>

                                  {colorOpen && (
                                    <div className="inventory-color-content">
                                      <div className="inventory-size-grid">
                                        {color.variants.map((variant) => {
                                          const isSaving = Boolean(
                                            savingVariants[variant.id],
                                          );

                                          const inputValue =
                                            adjustments[variant.id] ?? "";

                                          return (
                                            <div
                                              className="inventory-size-card"
                                              key={variant.id}
                                            >
                                              <div className="inventory-size-top">
                                                <strong>{variant.size}</strong>

                                                <small>{variant.sku}</small>
                                              </div>

                                              <div className="inventory-size-stock">
                                                <div>
                                                  <span>Físico</span>

                                                  <strong>
                                                    {variant.onHand}
                                                  </strong>
                                                </div>

                                                <div>
                                                  <span>Reservado</span>

                                                  <strong>
                                                    {variant.reserved}
                                                  </strong>
                                                </div>

                                                <div className="available">
                                                  <span>Disponível</span>

                                                  <strong>
                                                    {variant.available}
                                                  </strong>
                                                </div>
                                              </div>

                                              <div className="inventory-individual-adjust">
                                                <input
                                                  aria-label={`Novo estoque de ${variant.sku}`}
                                                  placeholder={variant.onHand}
                                                  type="number"
                                                  min="0"
                                                  step="1"
                                                  inputMode="numeric"
                                                  value={inputValue}
                                                  disabled={isSaving}
                                                  onChange={(event) =>
                                                    setIndividualAdjustment(
                                                      variant.id,
                                                      event.target.value,
                                                    )
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                      adjust(variant);
                                                    }
                                                  }}
                                                />

                                                <button
                                                  type="button"
                                                  className="button dark"
                                                  disabled={
                                                    isSaving ||
                                                    inputValue === "" ||
                                                    !Number.isInteger(
                                                      Number(inputValue),
                                                    ) ||
                                                    Number(inputValue) < 0
                                                  }
                                                  onClick={() =>
                                                    adjust(variant)
                                                  }
                                                >
                                                  {isSaving
                                                    ? "Salvando..."
                                                    : "Definir"}
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>

                                      <div className="inventory-batch">
                                        <div className="inventory-batch-info">
                                          <div className="inventory-batch-icon">
                                            <Layers3 size={18} />
                                          </div>

                                          <div>
                                            <strong>
                                              Definir estoque da cor
                                            </strong>

                                            <small>
                                              Digite a quantidade final. Esse
                                              valor será aplicado a todos os
                                              tamanhos de <b>{color.name}</b>.
                                            </small>
                                          </div>
                                        </div>

                                        <div className="inventory-batch-form">
                                          <div className="batch-input">
                                            <button
                                              type="button"
                                              disabled={isSavingBatch}
                                              onClick={() => {
                                                const current =
                                                  Number(
                                                    batchAdjustments[colorKey],
                                                  ) || 0;

                                                setBatchAdjustment(
                                                  product.name,
                                                  color.name,
                                                  Math.max(0, current - 1),
                                                );
                                              }}
                                            >
                                              <Minus size={14} />
                                            </button>

                                            <input
                                              type="number"
                                              min="0"
                                              step="1"
                                              inputMode="numeric"
                                              value={
                                                batchAdjustments[colorKey] ?? ""
                                              }
                                              placeholder="Novo estoque"
                                              disabled={isSavingBatch}
                                              onChange={(event) =>
                                                setBatchAdjustment(
                                                  product.name,
                                                  color.name,
                                                  event.target.value,
                                                )
                                              }
                                              onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                  adjustColorBatch(
                                                    product,
                                                    color,
                                                  );
                                                }
                                              }}
                                            />

                                            <button
                                              type="button"
                                              disabled={isSavingBatch}
                                              onClick={() => {
                                                const current =
                                                  Number(
                                                    batchAdjustments[colorKey],
                                                  ) || 0;

                                                setBatchAdjustment(
                                                  product.name,
                                                  color.name,
                                                  current + 1,
                                                );
                                              }}
                                            >
                                              <Plus size={14} />
                                            </button>
                                          </div>

                                          <button
                                            type="button"
                                            className="button dark"
                                            disabled={
                                              isSavingBatch ||
                                              batchAdjustments[colorKey] ===
                                                "" ||
                                              !Number.isInteger(
                                                Number(
                                                  batchAdjustments[colorKey],
                                                ),
                                              ) ||
                                              Number(
                                                batchAdjustments[colorKey],
                                              ) < 0
                                            }
                                            onClick={() =>
                                              adjustColorBatch(product, color)
                                            }
                                          >
                                            <Save size={15} />

                                            {isSavingBatch
                                              ? "Salvando..."
                                              : "Definir lote"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}

                  {!inventoryGroups.length && (
                    <div className="inventory-empty">
                      <PackageSearch size={38} />

                      <h3>Nenhuma variação cadastrada</h3>

                      <p>Não existem variações de produtos no estoque.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/*
             * ==================================================
             * PRODUTOS / BANNERS
             * ==================================================
             */}

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

        <button
          className="back-link management-back"
          onClick={() => navigate("/")}
        >
          <ArrowLeft size={17} />
          Voltar à loja
        </button>
      </main>
    </div>
  );
}
