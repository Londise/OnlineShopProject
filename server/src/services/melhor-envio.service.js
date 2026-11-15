import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import {
  combineVolumeQuotes,
  normalizeQuote,
  planVolumes,
  selectShippingOptions,
} from './shipping.service.js';

const QUOTE_PATH = '/api/v2/me/shipment/calculate';
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_SERVICES = 200;
const quoteFailed = () => new AppError(502, 'SHIPPING_QUOTE_FAILED', 'A consulta de frete falhou. Tente novamente em instantes.');

async function readQuoteResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw quoteFailed();
  try {
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw quoteFailed();
    // Limite sobre os bytes efetivamente lidos (inclusive conteúdo descomprimido),
    // sem confiar no Content-Length enviado pelo provedor.
    const buffer = Buffer.alloc(MAX_RESPONSE_BYTES);
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > MAX_RESPONSE_BYTES) throw quoteFailed();
      buffer.set(value, size);
      size += value.byteLength;
    }
    const quotes = JSON.parse(buffer.toString('utf8', 0, size));
    if (!Array.isArray(quotes) || quotes.length > MAX_SERVICES) throw quoteFailed();
    return quotes;
  } catch {
    await reader.cancel().catch(() => {});
    throw quoteFailed();
  } finally {
    reader.releaseLock();
  }
}

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
      redirect: 'error',
    });
  } catch {
    throw new AppError(503, 'SHIPPING_UNAVAILABLE', 'Não foi possível consultar o frete agora. Tente novamente em instantes.');
  }
  if (!response.ok || !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    throw quoteFailed();
  }
  return readQuoteResponse(response);
}

/**
 * Planeja as embalagens e consulta o Melhor Envio uma vez por embalagem,
 * conforme a regra da loja: acima de 30 kg a Jadlog é cotada em um ou mais
 * volumes (até 50 kg cada) e as demais em embalagens de até 30 kg, somadas
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

export function createShippingQuoter(config, dependencies = {}) {
  let active = 0;
  const limit = config.SHIPPING_QUOTE_CONCURRENCY ?? 4;
  return async (input) => {
    if (active >= limit) {
      throw new AppError(503, 'SHIPPING_BUSY', 'Muitas consultas de frete em andamento. Tente novamente em instantes.');
    }
    active++;
    try {
      return await quoteShippingOptions(config, input, dependencies);
    } finally {
      active--;
    }
  };
}

// Uma capacidade compartilhada para o endpoint público e a recotação de pedidos.
// Sem fila ilimitada e com liberação mesmo após erro/timeout do provedor.
export const defaultShippingQuoter = createShippingQuoter(env);
