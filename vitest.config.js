import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/ui/**/*.test.jsx'],
    environment: 'jsdom',
    setupFiles: ['./test/support/ui-setup.js'],
    env: { VITE_API_URL: '/api/v1' },
    maxWorkers: 1,
    restoreMocks: true,
  },
});
