import { defineConfig } from '@playwright/test';

const PORT = 3101;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // shared in-memory store — keep runs deterministic
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1360, height: 900 },
  },
  webServer: {
    // Blank the Supabase vars: .env.local would otherwise point `next start`
    // at the real database — e2e must run on the in-memory store.
    // ANTHROPIC_MOCK drives the planning agent deterministically (no network).
    command: `PORT=${PORT} DEV_AUTH=1 ANTHROPIC_MOCK=1 SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= npm run start`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
