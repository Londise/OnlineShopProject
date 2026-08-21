import { useEffect, useMemo, useState } from "react";

const CART_STORAGE_KEY = "ferchu-cart";

export default function useCart() {
  const [lines, setLines] = useState(() => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY);

      if (!stored) {
        return [];
      }

      const parsed = JSON.parse(stored);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error("Não foi possível carregar o carrinho:", error);

      return [];
    }
  });

  const [cartOpen, setCartOpen] = useState(false);

  /*
   * ============================================================
   * PERSISTÊNCIA DO CARRINHO
   * ============================================================
   *
   * Sempre que lines mudar, salvamos o carrinho.
   *
   * Isso permite:
   * - navegar para /checkout
   * - acessar /checkout diretamente
   * - atualizar a página
   * - fechar e abrir novamente a aplicação
   *
   * sem perder o carrinho.
   */

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
    } catch (error) {
      console.error("Não foi possível salvar o carrinho:", error);
    }
  }, [lines]);

  /*
   * ============================================================
   * TOTAIS
   * ============================================================
   */

  const qtyTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  const orderTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.price, 0),
    [lines],
  );

  const totalWeight = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.weight, 0),
    [lines],
  );

  /*
   * ============================================================
   * ESTOQUE
   * ============================================================
   */

  const getAvailableToAdd = (available, currentQuantity) => {
    if (!Number.isFinite(available)) {
      return Infinity;
    }

    return Math.max(0, available - currentQuantity);
  };

  /*
   * ============================================================
   * ADICIONAR AO CARRINHO
   * ============================================================
   */

  const addToCart = (product, color, quantities) => {
    setLines((old) => {
      const next = old.map((line) => ({
        ...line,
      }));

      Object.entries(quantities).forEach(([size, quantity]) => {
        if (!quantity || quantity <= 0) {
          return;
        }
        
        /* Aceita cores que são strings ou objetos cuja cor está inserida
           como propiedade dentro deles */
        const colorName = typeof color === "string" ? color : color.name;
        console.log(color);


        /* Se a cor da variante for uma string, a variante é nula, se for um objeto, procura
           por essa variante dentro das propiedades desse objeto, ou seja, no estoque */
        const selectedVariant =
          typeof color === "string"
            ? null
            : color.stockVariants?.find((variant) => variant.size === size);

        /* Se a variante não possuir ID, uma chave artificial é criada, se a variante selecionada
           (selectedVariant) for nula, a chave do produto a ser adicionado também será
            uma chave artificial */
        const keyOfProductToBeAdded =
          selectedVariant?.id ?? `${product.id}-${colorName}-${size}`;

        const available = selectedVariant?.available ?? Infinity;

        const existing = next.find(
          (line) => line.key === keyOfProductToBeAdded,
        );

        if (existing) {
          const remainingStock = getAvailableToAdd(
            available,
            existing.quantity,
          );

          const quantityToAdd = Math.min(quantity, remainingStock);

          if (quantityToAdd > 0) {
            existing.quantity += quantityToAdd;
          }

          return;
        }

        if (available <= 0) {
          return;
        }

        const quantityToAdd = Math.min(quantity, available);

        next.push({
          key: keyOfProductToBeAdded,

          productId: product.id,

          variantId: selectedVariant?.id ?? null,

          name: product.name,

          color: colorName,

          size,

          quantity: quantityToAdd,

          price: product.price,

          weight: product.weight,

          image: product.image,

          available,
        });
      });

      return next;
    });
  };

  /*
   * ============================================================
   * ALTERAR QUANTIDADE
   * ============================================================
   */

  const changeLine = (key, rawQuantity) =>
    setLines((old) => {
      let quantity = Number(rawQuantity);

      if (!Number.isFinite(quantity)) {
        quantity = 0;
      }

      quantity = Math.max(0, quantity);

      return old
        .map((line) => {
          if (line.key !== key) {
            return line;
          }

          if (Number.isFinite(line.available)) {
            quantity = Math.min(quantity, line.available);
          }

          return {
            ...line,
            quantity,
          };
        })
        .filter((line) => line.quantity > 0);
    });

  /*
   * ============================================================
   * REMOVER
   * ============================================================
   */

  const removeLine = (key) => {
    changeLine(key, 0);
  };

  /*
   * ============================================================
   * LIMPAR CARRINHO
   * ============================================================
   */

  const clearCart = () => {
    setLines([]);
  };

  return {
    lines,
    setLines,

    cartOpen,
    setCartOpen,

    addToCart,
    changeLine,
    removeLine,
    clearCart,

    qtyTotal,
    orderTotal,
    totalWeight,
  };
}
