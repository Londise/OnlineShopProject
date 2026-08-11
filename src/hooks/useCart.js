import { useMemo, useState } from "react";

// Para evitar infinitos loops de pedidos, limitamos o valor máximo do pedido a R$ 5.000,00

export default function useCart() {

  const [lines, setLines] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  // calcula a quantidade total de produtos no carrinho
  const qtyTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  // calcula o valor total do carrinho
  const orderTotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.price, 0),
    [lines],
  );

  // calcula o peso total do carrinho
  const totalWeight = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.weight, 0),
    [lines],
  );

  // Função para adicionar produtos ao carrinho, agrupando por produto, cor e tamanho
  const addToCart = (product, color, quantities) => {
    setLines((old) => {
      // Clona a lista E clona todos os objetos (produtos) dentro dela
      const next = old.map((line) => ({ ...line }));
      
      // Percorre as quantidades por tamanho do produto a ser adicionado (EX: 1P 2G 3GG)
      Object.entries(quantities).forEach(([size, quantity]) => {
        if (!quantity) return;

        // cria uma chave única para cada combinação de (produto, cor e tamanho)
        const colorName = typeof color === "string" ? color : color.name;
        const selectedVariant = typeof color === "string" ? null : color.stockVariants?.find((variant) => variant.size === size);
        const keyOfProductToBeAdded = selectedVariant?.id ?? `${product.id}-${colorName}-${size}`;

        // verifica se já existe uma linha com o mesmo produto, cor e tamanho
        const existing = next.find((line) => line.key === keyOfProductToBeAdded);
        
        // Se o produto existir, a quantidade é aumentada no carrinho
        if (existing) {
          existing.quantity += quantity;
        }

        // Se o produto não existir, adiciona uma nova linha ao carrinho
        else {
          next.push({
            key: keyOfProductToBeAdded,
            productId: product.id,
            variantId: selectedVariant?.id ?? null,
            name: product.name,
            color: colorName,
            size,
            quantity,
            price: product.price,
            weight: product.weight,
            image: product.image,
          });

        }
      });

      return next;
    });
  };

  // altera a quantidade de produtos no carrinho, removendo se a quantidade for 0
  const changeLine = (key, rawQuantity) =>
  setLines((old) => {
    const quantity = Number(rawQuantity) || 0;

    return old.map((line) => (line.key === key ? { ...line, quantity } : line))
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
