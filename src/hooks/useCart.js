import { useMemo, useState } from "react";

// Para evitar infinitos loops de pedidos, limitamos o valor máximo do pedido a R$ 5.000,00
const MAX_ORDER_VALUE = 5000;

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
        const keyOfProductToBeAdded = `${product.id}-${color}-${size}`;

        // verifica se já existe uma linha com o mesmo produto, cor e tamanho
        const existing = next.find((line) => line.key === keyOfProductToBeAdded);
        
        // Se o produto existir, a quantidade é aumentada no carrinho
        if (existing) {
          existing.quantity += quantity;
          console.log(`Adicionando ${quantity} unidades de ${product.name} (${color}, ${size}) ao carrinho. Quantidade a ser adicionada: ${existing.quantity}`);
        }

        // Se o produto não existir, adiciona uma nova linha ao carrinho
        else {
          next.push({
            key: keyOfProductToBeAdded,
            productId: product.id,
            name: product.name,
            color,
            size,
            quantity,
            price: product.price,
            weight: product.weight,
            image: product.image,
          });

          console.log(`Adicionando ${quantity} unidades de ${product.name} (${color}, ${size}) ao carrinho.`);
        }
      });

      // VERIFICAÇÃO PARA EVITAR ULTRAPASSAR O LIMITE DE ESTOQUE

      // Calcula o total geral da nova lista após a adição do produto.
      const newTotal = next.reduce(
        (sum, line) => sum + line.quantity * line.price,
        0
      );

      // Se o total da nova lista estourar R$ 5.000, aborta tudo e devolve o 'old'
      if (newTotal > MAX_ORDER_VALUE) {
        alert("Você ultrapassou o limite de Estoque.");
        return old;
      }
      
      console.log(`Novo total do carrinho: R$ ${newTotal.toFixed(2)}`);
      // Se tudo estiver ok, devolve a nova lista com o produto já adicionado
      return next;
    });
  };

  // altera a quantidade de produtos no carrinho, removendo se a quantidade for 0
  const changeLine = (key, rawQuantity) =>
  setLines((old) => {
    const quantity = Number(rawQuantity) || 0;

    // Descobre quanto esse item tinha antes de mudar
    const currentLine = old.find((line) => line.key === key);
    const currentQty = currentLine ? currentLine.quantity : 0;

    // Prepara o próximo estado
    const next = old
      .map((line) => (line.key === key ? { ...line, quantity } : line))
      .filter((line) => line.quantity > 0);

    // Se a pessoa está DIMINUINDO ou mantendo a quantidade,
    // aprova a alteração imediatamente sem checar limite
    if (quantity <= currentQty) {
      return next;
    }

    // Se a pessoa está AUMENTANDO, aí sim valida o limite total
    const newTotal = next.reduce(
      (sum, line) => sum + line.quantity * line.price,
      0
    );

    if (newTotal > MAX_ORDER_VALUE) {
      alert("Você ultrapassou o limite de Estoque.");
      return old;
    }

    console.log(`Alterando quantidade do item ${key} de ${currentQty} para ${quantity}. Novo total: R$ ${newTotal.toFixed(2)}`);

    return next;
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
