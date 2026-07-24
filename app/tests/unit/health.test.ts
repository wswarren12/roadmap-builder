import { describe, expect, it } from 'vitest';
import { GET } from '@/app/health/route';

describe('GET /health (starter-kit contract)', () => {
  it('returns 200 with a body', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
