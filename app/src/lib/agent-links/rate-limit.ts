/**
 * Per-token sliding-window rate limit for agent links (spec: ~60 req/min).
 * In-memory is correct here: the app runs as a single container (PRD deploy
 * model), and the limit is abuse protection, not billing. `nowMs` is
 * injectable for tests.
 */
const WINDOW_MS = 60_000;
export const AGENT_RATE_LIMIT = 60;
export const MAX_PENDING_SUGGESTIONS = 20;

const hits = new Map<string, number[]>();

/** null = allowed; number = seconds until the next slot frees up. */
export function checkRateLimit(token: string, nowMs = Date.now()): number | null {
  const cutoff = nowMs - WINDOW_MS;
  const recent = (hits.get(token) ?? []).filter((t) => t > cutoff);
  if (recent.length >= AGENT_RATE_LIMIT) {
    hits.set(token, recent);
    return Math.max(1, Math.ceil((recent[0] + WINDOW_MS - nowMs) / 1000));
  }
  recent.push(nowMs);
  hits.set(token, recent);
  return null;
}

export function resetRateLimits(): void {
  hits.clear();
}
