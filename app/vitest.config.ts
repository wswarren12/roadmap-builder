import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@pl': path.resolve(__dirname, 'pl-design-system'),
      '@components': path.resolve(__dirname, 'pl-design-system/components'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts', 'tests/components/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['tests/components/**', 'jsdom'],
      ['tests/**', 'node'],
    ],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts', 'src/app/health/**/*.ts'],
      exclude: [
        // Talks to a live Supabase; store contract is covered via MemoryStore.
        'src/lib/store/supabase.ts',
        // Browser-only modules: exercised by the Playwright E2E suite
        // (PDF download assertions), which V8 unit coverage cannot see.
        'src/lib/client/**',
        // Type-only modules — no executable statements.
        'src/lib/types.ts',
        'src/lib/store/types.ts',
      ],
      thresholds: { lines: 80 },
    },
  },
});
