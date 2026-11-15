import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import {
  combineVolumeQuotes,
  normalizeQuote,
  planVolumes,
  selectShippingOptions,
} from './shipping.service.js';

const QUOTE_PATH = '/api/v2/me/shipment/calculate';

/**
 * Cotação de um conjunto de volumes no Melhor Envio.
 *
 * Apenas cotação: nunca compra frete nem gera etiquetas. O token fica
 * somente no servidor e nunca é exposto ao navegador.
 */
export async function requestQuote(config, { postalCode, volumes }, fetchImpl = fetch) {
  if (!config.MELHOR_ENVIO_TOKEN) {
    throw new AppError(503, 'SHIPPING_UNAVAILABLE', 'O cálculo de frete está indisponível no momento. Tente novamente mais tarde.');
  }
  const payload = {
    from: { postal_code: config.SHIPPING_ORIGIN_POSTAL_CODE },
    to: { postal_code: postalCode.replace(/\D/g, '') },
    volumes: volumes.map((volume) => ({
      width: volume.width,
      height: volume.height,
      length: volume.length,
      weight: Number(volume.weightKg.toFixed(2)),
      insurance: 0,
    })),
    options: { receipt: false, own_hand: false },
  };
  let response;
  try {
    response = await fetchImpl(`${config.MELHOR_ENVIO_BASE_URL.replace(/\/$/, '')}${QUOTE_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.MELHOR_ENVIO_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Ferchu Modas (loja@ferchumodas.com.br)',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'SHIPPING_UNAVAILABLE', 'Não foi possível consultar o frete agora. Tente novamente em instantes.');
  }
  if (!response.ok) {
    throw new AppError(502, 'SHIPPING_QUOTE_FAILED', 'A consulta de frete falhou. Tente novamente em instantes.');
  }
  let quotes;
  try {
    quotes = await response.json();
  } catch {
    throw new AppError(502, 'SHIPPING_QUOTE_FAILED', 'A consulta de frete falhou. Tente novamente em instantes.');
  }
  if (!Array.isArray(quotes)) {
    throw new AppError(502, 'SHIPPING_QUOTE_FAILED', 'A consulta de frete falhou. Tente novamente em instantes.');
  }
  return quotes;
}

/**
 * Planeja as embalagens e consulta o Melhor Envio uma vez por embalagem,
 * conforme a regra da loja: acima de 30 kg a Jadlog é cotada em um volume
 * (até 50 kg) e as demais transportadoras em embalagens separadas, somadas
 * apenas quando o mesmo serviço atende todas as embalagens.
 *
 * Retorna todas as opções válidas (sem a LATAM Cargo) ordenadas por preço;
 * o ponto de exibição seleciona as duas mais baratas.
 */
export async function quoteShippingOptions(
  config,
  { postalCode, pieces },
  { request = requestQuote, fetchImpl = fetch } = {},
) {
  const plans = planVolumes(pieces);
  const candidates = [];
  for (const plan of plans) {
    const perVolume = [];
    for (const volume of plan.volumes) {
      const raw = await request(config, { postalCode, volumes: [volume] }, fetchImpl);
      perVolume.push(raw.map(normalizeQuote));
    }
    candidates.push(...combineVolumeQuotes(perVolume, {
      jadlogOnly: plan.kind === 'JADLOG',
      otherCarriersOnly: plan.kind === 'OTHER',
    }));
  }
  return {
    originPostalCode: config.SHIPPING_ORIGIN_POSTAL_CODE,
    pieces,
    options: selectShippingOptions(candidates),
  };
}

export const defaultShippingQuoter = ({ postalCode, pieces }) =>
  quoteShippingOptions(env, { postalCode, pieces });
