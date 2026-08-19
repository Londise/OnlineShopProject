import React, { createContext, useContext } from "react";
import useCart from "../hooks/useCart";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const cart = useCart();

  return (
    <CartContext.Provider value={cart}>
      {children}
    </CartContext.Provider>
  );
}

export function useCartContext() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error(
      "useCartContext deve ser usado dentro de CartProvider."
    );
  }

  return context;
}