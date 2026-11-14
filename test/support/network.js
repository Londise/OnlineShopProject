// Only the HTTP boundary is replaced. Pages, hooks, providers and API adapter
// remain real. Unexpected traffic fails instead of reaching a deployed service.
const routes = new Map();
export const requests = [];
export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
export function respond(method, path, handler) {
  routes.set(`${method} ${path}`, typeof handler === 'function' ? handler : () => json(handler));
}
export function resetNetwork() {
  routes.clear();
  requests.length = 0;
}
export async function fetchBoundary(input, options = {}) {
  if (options.signal?.aborted) throw options.signal.reason;
  const url = new URL(input, 'http://localhost');
  const request = { ...options, method: options.method ?? 'GET', url };
  requests.push(request);
  const handler = routes.get(`${request.method} ${url.pathname}`);
  if (!handler) throw new Error(`Unexpected test request: ${request.method} ${url.pathname}`);
  if (!options.signal) return handler(request);
  return new Promise((resolve, reject) => {
    const abort = () => reject(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => handler(request)).then(
      value => { options.signal.removeEventListener('abort', abort); resolve(value); },
      error => { options.signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
