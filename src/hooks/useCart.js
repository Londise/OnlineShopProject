import { useMemo, useState } from "react";

// Para evitar pedidos excessivamente grandes,
// limitamos o valor máximo do pedido a R$ 5.000,00

export default function useCart() {
  const [lines, setLines] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  // Calcula a quantidade total de produtos no carrinho
  const qtyTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  // Calcula o valor total do carrinho
  const orderTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.price, 0),
    [lines],
  );

  // Calcula o peso total do carrinho
  const totalWeight = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.weight, 0),
    [lines],
  );

  // Adiciona produtos ao carrinho,
  // agrupando por produto, cor e tamanho
  const addToCart = (product, color, quantities) => {
    setLines((old) => {
      // Clona as linhas existentes
      const next = old.map((line) => ({ ...line }));

      Object.entries(quantities).forEach(([size, quantity]) => {
        if (!quantity || quantity <= 0) return;

        const colorName =
          typeof color === "string" ? color : color.name;

        // Encontra a variante correspondente à cor + tamanho
        const selectedVariant =
          typeof color === "string"
            ? null
            : color.stockVariants?.find(
                (variant) => variant.size === size,
              );

        // ID da variante é a melhor chave quando existe
        const keyOfProductToBeAdded =
          selectedVariant?.id ??
          `${product.id}-${colorName}-${size}`;

        // Estoque disponível dessa variante
        const available = selectedVariant?.available ?? Infinity;

        // Procura uma linha já existente
        const existing = next.find(
          (line) => line.key === keyOfProductToBeAdded,
        );

        if (existing) {
          // Quanto já existe no carrinho
          const currentQuantity = existing.quantity;

          // Quanto ainda pode ser adicionado
          const remainingStock = Math.max(
            0,
            available - currentQuantity,
          );

          // Não deixa ultrapassar o estoque
          const quantityToAdd = Math.min(
            quantity,
            remainingStock,
          );

          if (quantityToAdd > 0) {
            existing.quantity += quantityToAdd;
          }
        } else {
          // Se não existe estoque disponível, não cria a linha
          if (available <= 0) return;

          // Também limita a quantidade inicial ao estoque
          const quantityToAdd = Math.min(
            quantity,
            available,
          );

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

            // Guarda o estoque disponível dessa variante
            // no momento em que ela foi adicionada.
            available,
          });
        }
      });

      return next;
    });
  };

  // Altera a quantidade de uma linha do carrinho
  const changeLine = (key, rawQuantity) =>
    setLines((old) => {
      let quantity = Number(rawQuantity);

      // Impede valores inválidos
      if (!Number.isFinite(quantity)) {
        quantity = 0;
      }

      // Impede números negativos
      quantity = Math.max(0, quantity);

      return old
        .map((line) => {
          if (line.key !== key) {
            return line;
          }

          // Se a linha possui informação de estoque,
          // limita a quantidade ao estoque disponível.
          if (Number.isFinite(line.available)) {
            quantity = Math.min(
              quantity,
              line.available,
            );
          }

          return {
            ...line,
            quantity,
          };
        })
        .filter((line) => line.quantity > 0);
    });

  // Remove produtos do carrinho
  const removeLine = (key) => changeLine(key, 0);

  return {
    lines,
    setLines,
    cartOpen,
    setCartOpen,
    addToCart,
    changeLine,
    removeLine,
    qtyTotal,
    orderTotal,
    totalWeight,
  };
}