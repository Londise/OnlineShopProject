import React from "react";
import { Minus, Plus } from "lucide-react";

export default function Counter({
  value,
  disabled,
  onChange,
  label,
  max = 999,
}) {
  const change = (next) =>
    onChange(Math.max(0, Math.min(max, Number.isFinite(next) ? next : 0)));
  return (
    <div className="counter" aria-label={label}>
      <button
        type="button"
        disabled={disabled || value <= 0} // Double-check, pois a disponibilidade também é checada no modal
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
        disabled={disabled || value >= max}
        onClick={() => change(value + 1)}
        aria-label="Aumentar"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
