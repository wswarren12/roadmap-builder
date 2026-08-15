import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/health/route';

const ORIG = {
  DEV_AUTH: process.env.DEV_AUTH,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  process.env.DEV_AUTH = ORIG.DEV_AUTH;
  if (ORIG.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIG.SUPABASE_URL;
  if (ORIG.SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG.SUPABASE_SERVICE_ROLE_KEY;
});

describe('GET /health (starter-kit contract)', () => {
  it('returns 200 with a body in dev mode', async () => {
    process.env.DEV_AUTH = '1';
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 200 when Supabase is configured outside dev', async () => {
    delete process.env.DEV_AUTH;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
    expect(GET().status).toBe(200);
  });

  it('returns 503 when the app would silently run on the memory store in production', async () => {
    delete process.env.DEV_AUTH;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = GET();
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('error');
  });
});
