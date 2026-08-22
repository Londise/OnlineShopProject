// CATÁLOGO

// Procura e coleta o objeto da variante desejada do banco de dados, com dados como o estoque dela.
export const getVariant = (option, size) => {
  return option?.variants?.find((variant) => variant.size === size);
};

/*
 Fornece a quantidade disponível na situação onde a variante do produto já está no carrinho. 
 retorna a quantidade disponível inicial - quantidade já adicionada = quantidade disponível final
*/
export const getAvailableToAdd = (available, currentQuantity) => {
  if (!Number.isFinite(available)) {
    return Infinity;
  }
  return Math.max(0, available - currentQuantity); // quantidade disponível final
};
