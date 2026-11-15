import { AppError } from '../lib/errors.js';

/*
 * ============================================================
 * ESTIMATIVA DE EMBALAGENS
 * ============================================================
 *
 * Referências operacionais informadas pela loja. As dimensões são
 * aproximadas e serão aprimoradas conforme novas medidas forem
 * coletadas em embalagens reais.
 *
 *  - 10 peças  -> 30 x 30 x 30 cm, 2 kg
 *  - 20 peças  -> 35 x 35 x 35 cm, 3 kg
 *  - 120 peças -> 50 x 45 x 45 cm, 35 kg
 */

export const PACKAGE_REFERENCES = Object.freeze([
  { pieces: 10, width: 30, height: 30, length: 30, weightKg: 2 },
  { pieces: 20, width: 35, height: 35, length: 35, weightKg: 3 },
  { pieces: 120, width: 50, height: 45, length: 45, weightKg: 35 },
]);

export const CORREIOS_MAX_WEIGHT_KG = 30;
export const JADLOG_MAX_WEIGHT_KG = 50;
export const LATAM_COMPANY = /latam/i;
export const JADLOG_COMPANY = /jadlog/i;

// Arredonda sempre para cima para nunca subestimar peso ou dimensões.
const ceilKg = (kg) => Math.ceil(kg * 10) / 10;

function scaleAt(reference, pieces) {
  const t = pieces / reference.pieces;
  return {
    width: Math.max(1, Math.ceil(reference.width * t)),
    height: Math.max(1, Math.ceil(reference.height * t)),
    length: Math.max(1, Math.ceil(reference.length * t)),
    weightKg: Math.max(0.1, ceilKg(reference.weightKg * t)),
  };
}

function between(lower, upper, pieces) {
  const t = (pieces - lower.pieces) / (upper.pieces - lower.pieces);
  return {
    width: Math.ceil(lower.width + (upper.width - lower.width) * t),
    height: Math.ceil(lower.height + (upper.height - lower.height) * t),
    length: Math.ceil(lower.length + (upper.length - lower.length) * t),
    weightKg: ceilKg(lower.weightKg + (upper.weightKg - lower.weightKg) * t),
  };
}

/**
 * Estima as dimensões e o peso de uma embalagem para a quantidade de peças.
 * Abaixo da primeira referência a escala é proporcional; entre as referências
 * a interpolação é linear; acima da última referência a tendência do último
 * trecho é prolongada.
 */
export function estimateVolume(pieces) {
  if (!Number.isInteger(pieces) || pieces < 1)
    throw new AppError(422, 'INVALID_QUANTITY', 'Quantidade de peças inválida para cálculo de frete.');
  const first = PACKAGE_REFERENCES[0];
  if (pieces <= first.pieces) return scaleAt(first, pieces);
  for (let index = 0; index < PACKAGE_REFERENCES.length - 1; index++) {
    const lower = PACKAGE_REFERENCES[index];
    const upper = PACKAGE_REFERENCES[index + 1];
    if (pieces <= upper.pieces) return between(lower, upper, pieces);
  }
  const previous = PACKAGE_REFERENCES[PACKAGE_REFERENCES.length - 2];
  const last = PACKAGE_REFERENCES[PACKAGE_REFERENCES.length - 1];
  return between(previous, last, pieces);
}

function distributePieces(total, count) {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Divide o pedido no menor número de embalagens em que cada uma respeita
 * o peso máximo informado. Cada embalagem é REESTIMADA pela quantidade de
 * peças que carrega: o cálculo nunca divide as dimensões de uma caixa maior.
 */
export function splitVolumes(pieces, maxWeightKg) {
  const single = estimateVolume(pieces);
  if (single.weightKg <= maxWeightKg) return [single];
  for (let count = 2; count <= 20; count++) {
    const volumes = distributePieces(pieces, count).map(estimateVolume);
    if (volumes.every((volume) => volume.weightKg <= maxWeightKg)) return volumes;
  }
  throw new AppError(422, 'UNSPLITTABLE_ORDER', 'Não foi possível dividir o pedido em embalagens compatíveis com as transportadoras.');
}

/**
 * Cenários de cotação:
 *  - SINGLE: até 30 kg, um volume atende todas as transportadoras.
 *  - JADLOG: acima de 30 kg, um ou mais volumes de até 50 kg CADA.
 *  - OTHER:  acima de 30 kg, demais transportadoras cotadas em embalagens
 *    separadas, cada uma dentro do limite próprio (30 kg para os Correios).
 */
export function planVolumes(pieces) {
  const single = estimateVolume(pieces);
  if (single.weightKg <= CORREIOS_MAX_WEIGHT_KG) return [{ kind: 'SINGLE', volumes: [single] }];
  return [
    { kind: 'JADLOG', volumes: splitVolumes(pieces, JADLOG_MAX_WEIGHT_KG) },
    { kind: 'OTHER', volumes: splitVolumes(pieces, CORREIOS_MAX_WEIGHT_KG) },
  ];
}

export function volumeLabel(count) {
  return count === 1 ? '1 volume' : `${count} volumes (envios separados)`;
}

function quoteName(value) {
  if (typeof value !== 'string' || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  return value.trim();
}

export function normalizeQuote(raw) {
  const invalid = { company: '', service: '', price: NaN, days: NaN };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.error != null) return invalid;
  const price = raw.custom_price ?? raw.price;
  const isDecimal = typeof price === 'number' || (typeof price === 'string' && /^\d+(?:\.\d{1,2})?$/.test(price));
  return {
    company: quoteName(raw.company?.name),
    service: quoteName(raw.name),
    price: isDecimal ? Number(price) : NaN,
    days: Number(raw.custom_delivery_time ?? raw.delivery_time),
  };
}

/**
 * Uma cotação sem preço (a transportadora responde com um erro, como
 * "Transportadora não atende este trecho") nunca é uma opção válida.
 */
export function hasUsablePrice(quote) {
  return Number.isFinite(quote.price) && quote.price >= 0 && quote.price <= 2147483647 / 100;
}

/**
 * Combina as cotações de cada embalagem de um cenário: permanece somente o
 * serviço presente em TODAS as embalagens, somando os preços e mantendo o
 * maior prazo. A LATAM Cargo é sempre descartada.
 */
export function combineVolumeQuotes(perVolumeQuotes, { jadlogOnly = false, otherCarriersOnly = false } = {}) {
  if (!perVolumeQuotes.length) return [];
  const keyOf = (quote) => `${quote.company}\u0000${quote.service}`;
  const eligible = (quote) => {
    if (!quote.company || !quote.service || LATAM_COMPANY.test(quote.company)) return false;
    if (!hasUsablePrice(quote)) return false;
    if (jadlogOnly && !JADLOG_COMPANY.test(quote.company)) return false;
    if (otherCarriersOnly && JADLOG_COMPANY.test(quote.company)) return false;
    return true;
  };
  const combined = new Map();
  for (const quote of perVolumeQuotes[0]) {
    if (!eligible(quote)) continue;
    combined.set(keyOf(quote), { company: quote.company, service: quote.service, price: quote.price, days: quote.days });
  }
  for (const volumeQuotes of perVolumeQuotes.slice(1)) {
    for (const key of [...combined.keys()]) {
      const match = volumeQuotes.find((quote) => eligible(quote) && keyOf(quote) === key);
      if (!match) {
        combined.delete(key);
        continue;
      }
      const entry = combined.get(key);
      entry.price = Math.round((entry.price + match.price) * 100) / 100;
      entry.days = Math.max(entry.days, match.days);
    }
  }
  return [...combined.entries()].map(([key, entry]) => ({
    ...entry,
    volumes: perVolumeQuotes.length,
    key: `${entry.company}|${entry.service}|${perVolumeQuotes.length}`,
  }));
}

/**
 * Remove duplicatas da mesma transportadora/serviço (mantendo a mais barata)
 * e ordena por preço crescente.
 */
export function selectShippingOptions(candidates) {
  const best = new Map();
  for (const option of candidates) {
    if (!hasUsablePrice(option)) continue;
    const key = `${option.company}\u0000${option.service}`;
    const current = best.get(key);
    if (!current || option.price < current.price) best.set(key, option);
  }
  return [...best.values()].sort((a, b) => a.price - b.price);
}
