import { useCallback, useEffect, useMemo, useState } from "react";

// Funções utilitárias para o tratamento do estoque
import { getAvailableToAdd } from "../utils/domainFunctions";
import { sanitizeCartLines, addCartLines, changeCartLine, removeSubmittedCartLines } from "../utils/cart.js";
import { api } from "../services/api";
import { IMAGE_PLACEHOLDER } from "../config/media";

const CART_STORAGE_KEY = "ferchu-cart";

export default function useCart() {
  const [lines, setLines] = useState(() => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY);

      if (!stored) {
        return [];
      }

      const parsed = JSON.parse(stored);

      return sanitizeCartLines(parsed);
    } catch (error) {
      console.error("Não foi possível carregar o carrinho:", error);

      return [];
    }
  });

  const [cartOpen, setCartOpen] = useState(false);

  // Reconcile only presentation URLs; never discard saved quantities or orders.
  useEffect(() => {
    let active = true;
    api.catalog.products().then(({ products }) => {
      if (!active) return;
      const images = new Map();
      for (const product of products) {
        const cover = product.images.find(image => image.type === "PRIMARY")?.url ?? product.images[0]?.url ?? IMAGE_PLACEHOLDER;
        for (const option of product.options) for (const variant of option.variants) images.set(variant.id, option.imageUrl ?? cover);
      }
      setLines(old => old.map(line => ({ ...line, image: images.get(line.variantId) ?? IMAGE_PLACEHOLDER })));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

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


  // Função que lista a quantidade de um item do carrinho
  const getQuantityInCart = useCallback((variantId) => {
    const quantityInCart = lines.find((line) => line.variantId === variantId)?.quantity ?? 0;

    return quantityInCart;
  }, [lines]);

  /* Função que retorna a quantidade disponível a ser adicionada de uma variante (cor + tamanho, ex: Preto GG)
     tendo em conta a quantidade disponível no estoque e a quantidade já existente no carrinho */
  const getAvailableToAddForVariant = useCallback((variant) => {
    if (!variant) {
      return 0;
    }

    const currentQuantityInCart = getQuantityInCart(variant.id);
    const currentQuantityInStock = variant.available;

    return getAvailableToAdd(currentQuantityInStock, currentQuantityInCart);
  }, 
  [getQuantityInCart],
  )
  // Com useCallback, o Builder pode reagir às mudanças do carrinho.


  /*
   * ============================================================
   * ADICIONAR AO CARRINHO
   * ============================================================
   */

  const addToCart = (product, color, quantities) => {
    setLines(old => addCartLines(old, product, color, quantities));
  };

  /*
   * ============================================================
   * ALTERAR QUANTIDADE
   * ============================================================
   */

  const changeLine = (key, rawQuantity) =>
    setLines(old => changeCartLine(old, key, rawQuantity));

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

  const clearCart = (submittedLines) => {
    setLines(old => submittedLines ? removeSubmittedCartLines(old, submittedLines) : []);
  };

  return {
    lines,

    cartOpen,
    setCartOpen,

    addToCart,
    changeLine,
    removeLine,
    clearCart,

    getQuantityInCart,
    getAvailableToAddForVariant,

    qtyTotal,
    orderTotal,
    totalWeight,
  };
}
