import { useEffect, useMemo, useState } from "react";

// Funções utilitárias para o tratamento do estoque
import { getVariant, getAvailableToAdd } from "../utils/domainFunctions";

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
        
        // Coleta o nome do objeto
        const colorName = color.name;

        // Procura e coleta a variante selecionada do banco de dados
        const selectedVariant = getVariant(color, size);

        // Se a variante não existir, não adiciona no carrinho e sai da função
        if (!selectedVariant) {
          return
        }

        // a chave do produto a ser adicionado será a ID da variante
        const keyOfProductToBeAdded = selectedVariant.id;

        // A disponibilidade da variante será a da variante selecionada
        const available = selectedVariant.available;

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

          variantId: selectedVariant.id,

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
