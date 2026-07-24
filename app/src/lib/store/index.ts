import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

/**
 * Store selection: Supabase when credentials are present (production —
 * provided via the LabOS secrets flow), otherwise an in-memory store
 * (local dev and tests). The memory store lives on globalThis so Next.js
 * dev-mode module reloads don't wipe state between requests.
 */
const g = globalThis as typeof globalThis & { __roadmapperStore?: Store };

export function getStore(): Store {
  if (!g.__roadmapperStore) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    g.__roadmapperStore =
      url && key ? new SupabaseStore(url, key) : new MemoryStore();
  }
  return g.__roadmapperStore;
}

/** Test hook: swap the active store (used by API integration tests). */
export function setStore(store: Store) {
  g.__roadmapperStore = store;
}

export type { Store };
export { MemoryStore, SupabaseStore };
