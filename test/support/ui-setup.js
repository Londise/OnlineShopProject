import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { fetchBoundary, resetNetwork } from './network.js';
import { webcrypto } from 'node:crypto';

// jsdom supplies randomUUID but not the browser's SubtleCrypto implementation.
Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });

// api.js captures fetch at module initialization; keep this dispatcher stable.
globalThis.fetch = fetchBoundary;
beforeEach(() => {
  resetNetwork();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
