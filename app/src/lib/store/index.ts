import { MemoryStore } from './memory';
import { PostgresStore } from './postgres';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

/**
 * Store selection ladder (db-migration, 2026-08-15):
 *   1. DATABASE_URL         → PLN-provisioned Postgres (production primary)
 *   2. SUPABASE_URL + key   → Supabase (legacy primary, now the fallback)
 *   3. neither              → in-memory (local dev and tests ONLY — /health
 *                             reports 503 in this state outside dev, so a
 *                             misconfigured production container fails its
 *                             deploy instead of silently serving RAM)
 * The memory store lives on globalThis so Next.js dev-mode module reloads
 * don't wipe state between requests.
 */
const g = globalThis as typeof globalThis & { __roadmapperStore?: Store };

export function getStore(): Store {
  if (!g.__roadmapperStore) {
    const pgUrl = process.env.DATABASE_URL;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    g.__roadmapperStore = pgUrl
      ? new PostgresStore(pgUrl)
      : url && key
        ? new SupabaseStore(url, key)
        : new MemoryStore();
  }
  return g.__roadmapperStore;
}

/** Test hook: swap the active store (used by API integration tests). */
export function setStore(store: Store) {
  g.__roadmapperStore = store;
}

export type { Store };
export { MemoryStore, PostgresStore, SupabaseStore };
