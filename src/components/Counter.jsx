import React from "react";
import { Minus, Plus } from "lucide-react";

export default function Counter({ value, onChange, label }) {
  const change = (next) =>
    onChange(Math.max(0, Math.min(999, Number.isFinite(next) ? next : 0)));
  return (
    <div className="counter" aria-label={label}>
      <button
        type="button"
        onClick={() => change(value - 1)}
        aria-label="Diminuir"
      >
        <Minus size={15} />
      </button>
      <input
        aria-label={`Quantidade ${label}`}
        inputMode="numeric"
        value={value || ""}
        onChange={(e) => change(Number(e.target.value.replace(/\D/g, "")))}
        placeholder="0"
      />
      <button
        type="button"
        onClick={() => change(value + 1)}
        aria-label="Aumentar"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}