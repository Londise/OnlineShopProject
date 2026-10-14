import { AsyncLocalStorage } from 'node:async_hooks';

// Contexto por request: qualquer log() emitido dentro do ciclo dela herda
// traceId/requestId/actorId sem repasse manual de argumentos.
const als = new AsyncLocalStorage();

export const runWithTrace = (store, fn) => als.run(store, fn);

export const getTrace = () => als.getStore() ?? {};

export function patchTrace(patch) {
  const store = als.getStore();
  if (store) Object.assign(store, patch);
}
