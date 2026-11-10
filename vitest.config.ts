import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
  },
});
