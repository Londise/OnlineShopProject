export class ApiError extends Error {
  constructor(message, code, status, { retryable = false, traceId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.traceId = traceId;
  }
}

export function resolveApiUrl(value, { production = false } = {}) {
  const url = value?.trim() || (production ? '/api/v1' : 'http://localhost:3001/api/v1');
  if (url.startsWith('/') && !url.startsWith('//')) return url.replace(/\/$/, '');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('VITE_API_URL deve ser uma URL sem credenciais ou parâmetros.');
  if (production && (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('VITE_API_URL de produção deve usar /api/v1 ou um backend HTTPS público.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('VITE_API_URL inválida.');
  return url.replace(/\/$/, '');
}

const newTraceId = () => globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Reads may retry once; mutations never replay. Do not turn HTML (including a
// Render startup page) into an empty successful catalog or a missing session.
export function createRequestClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 95_000,
  readRetries = 1, retryDelayMs = 1000, sleep = pause } = {}) {
  return async (path, options = {}) => {
    const method = (options.method ?? 'GET').toUpperCase();
    const maxRetries = ['GET', 'HEAD'].includes(method) ? readRetries : 0;
    const traceId = newTraceId();
    const headers = new Headers(options.headers);
    if (!headers.has('x-trace-id')) headers.set('x-trace-id', traceId);
    if (options.body != null && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Cancelado', 'AbortError');
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal.reason);
      options.signal?.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      let failure;
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          ...options, method, headers, credentials: 'include', signal: controller.signal,
        });
        const responseTrace = response.headers.get('x-trace-id') ?? traceId;
        if (response.status === 204 || (method === 'HEAD' && response.ok)) return null;
        const unavailable = [502, 503, 504].includes(response.status);
        const contentType = response.headers.get('content-type') ?? '';
        if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
          throw new ApiError('O servidor pode estar iniciando ou indisponível. Aguarde um instante e tente novamente.',
            'INVALID_RESPONSE', response.status, { retryable: response.ok || unavailable, traceId: responseTrace });
        }
        let data;
        try { data = await response.json(); } catch {
          if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
          throw new ApiError('O servidor enviou uma resposta inválida. Tente novamente.', 'INVALID_RESPONSE', response.status,
            { retryable: response.ok || unavailable, traceId: responseTrace });
        }
        if (data === null || typeof data !== 'object') {
          throw new ApiError('O servidor enviou uma resposta inválida. Tente novamente.', 'INVALID_RESPONSE', response.status,
            { retryable: response.ok || unavailable, traceId: responseTrace });
        }
        if (!response.ok) throw new ApiError(data.error?.message ?? 'Não foi possível concluir a operação.',
          data.error?.code, response.status, { retryable: unavailable, traceId: responseTrace });
        return data;
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Cancelado', 'AbortError');
        failure = error instanceof ApiError ? error : new ApiError(
          timedOut ? 'O servidor demorou para responder. Tente novamente em instantes.' : 'Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.',
          timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', 0, { retryable: true, traceId });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      }
      if (!failure.retryable || attempt >= maxRetries) throw failure;
      await sleep(retryDelayMs);
    }
  };
}
