import { AppError } from '../lib/errors.js';

export function calculateShipping({ method, postalCode, totalWeightGrams }) {
  if (method === 'EXCURSAO') return { amountCents: null, detail: 'Valor da excursão confirmado após o pedido.' };
  const digits = postalCode?.replace(/\D/g, '');
  if (!digits || digits.length !== 8) throw new AppError(422, 'INVALID_POSTAL_CODE', 'CEP inválido para cálculo dos Correios.');
  const first = Number(digits[0]);
  const zone = first <= 3 ? 1 : first <= 6 ? 1.22 : 1.5;
  const weightKg = Math.max(0.5, Math.ceil((totalWeightGrams / 1000) * 2) / 2);
  return { amountCents: Math.round((17.5 + weightKg * 8.8) * zone * 100), detail: `PAC estimado · ${weightKg.toFixed(1).replace('.', ',')} kg` };
}
