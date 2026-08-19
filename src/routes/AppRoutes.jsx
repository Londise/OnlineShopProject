import React from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import Home from "../pages/Home";
import Checkout from "../pages/Checkout";
import Management from "../pages/Management";
import Account from "../pages/Account";
import AppLayout from "../layouts/AppLayout";

import { AuthProvider, useAuthContext } from "../contexts/AuthContext";
import { CartProvider } from "../contexts/CartContext";

function AdminRoute({ children }) {
  const { user } = useAuthContext();

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return children;
}

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

              <Route
                path="/management"
                element={
                  <AdminRoute>
                    <Management />
                  </AdminRoute>
                }
              />
            </Route>
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}