import { beforeEach, describe, expect, it } from 'vitest';
import { AGENT_RATE_LIMIT, checkRateLimit, resetRateLimits } from '@/lib/agent-links/rate-limit';

describe('agent rate limiter', () => {
  beforeEach(resetRateLimits);

  it('allows 60/min then returns retry_after seconds', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AGENT_RATE_LIMIT; i++) {
      expect(checkRateLimit('tok', t0 + i * 100)).toBeNull();
    }
    const retry = checkRateLimit('tok', t0 + 6_000);
    expect(retry).not.toBeNull();
    expect(retry!).toBeGreaterThan(0);
    expect(retry!).toBeLessThanOrEqual(60);
  });

  it('window slides — old requests expire', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < AGENT_RATE_LIMIT; i++) checkRateLimit('tok2', t0);
    expect(checkRateLimit('tok2', t0 + 61_000)).toBeNull();
  });

  it('tokens are independent', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < AGENT_RATE_LIMIT; i++) checkRateLimit('a', t0);
    expect(checkRateLimit('b', t0)).toBeNull();
  });
});
