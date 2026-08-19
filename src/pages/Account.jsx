import React, { useEffect, useState } from "react";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../contexts/AuthContext";
import { api } from "../services/api";
import useAuth from "../hooks/useAuth";




const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export default function Account() {
  const navigate = useNavigate();
  const { user, logout } = useAuthContext();  

  async function handleLogout() {
    await logout();
    navigate("/")
  }

  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.orders
      .mine()
      .then(({ orders }) => setOrders(orders))
      .catch((err) => setError(err.message));
  }, []);
  return (
    <div className="account-page">
      <header>
        <button className="logo" onClick={onBack}>
          <span>Ferchu</span>
          <small>MODAS</small>
        </button>
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={18} /> Voltar à loja
        </button>
      </header>
      <main className="account-main">
        <span className="eyebrow">MINHA CONTA</span>
        <h1>Olá, {user.name.split(" ")[0]}.</h1>
        <button className="text-button" onClick={handleLogout}>
          Sair da conta
        </button>
        <button onClick={setPage}>Ir para o Gestor de Estoque</button>
        
        
      </main>
    </div>
  );
}
