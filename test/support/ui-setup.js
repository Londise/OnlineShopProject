import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { fetchBoundary, resetNetwork } from './network.js';

// api.js captures fetch at module initialization; keep this dispatcher stable.
globalThis.fetch = fetchBoundary;
beforeEach(() => {
  resetNetwork();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
