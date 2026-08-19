import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import Home from "../pages/Home";
import Checkout from "../pages/Checkout";
import Management from "../pages/Management";
import Account from "../pages/Account";
import AppLayout from "../layouts/AppLayout";

import { AuthProvider } from "../contexts/AuthContext";
import { CartProvider } from "../contexts/CartContext";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/account" element={<Account />} />
              <Route path="/management" element={<Management />} />
            </Route>
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}