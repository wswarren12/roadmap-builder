import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCookieHeader, resolveIdentity, resolveIdentityFromCookies } from '@/lib/auth';
import { DEV_USERS } from '@/lib/dev-users';

function req(cookie?: string): Request {
  return new Request('http://test.local/', {
    headers: cookie ? { cookie } : undefined,
  });
}

const devCookie = (user: object) => `dev_user=${encodeURIComponent(JSON.stringify(user))}`;

describe('parseCookieHeader', () => {
  it('parses multiple cookies and ignores malformed parts', () => {
    expect(parseCookieHeader('a=1; b=two; malformed; c==x')).toEqual({
      a: '1',
      b: 'two',
      c: '=x',
    });
    expect(parseCookieHeader(null)).toEqual({});
  });
});

describe('DEV_AUTH identity (local/E2E shim)', () => {
  beforeEach(() => {
    process.env.DEV_AUTH = '1';
  });

  it('uses the dev_user cookie identity with lowercased email', async () => {
    const identity = await resolveIdentity(
      req(devCookie({ uid: 'u1', name: 'Ada', email: 'Ada@PL.Network' })),
    );
    expect(identity).toEqual({ uid: 'u1', name: 'Ada', email: 'ada@pl.network' });
  });

  it('falls back to the first roster user (Dev One) without a cookie', async () => {
    const identity = await resolveIdentity(req());
    expect(identity).toEqual(DEV_USERS[0]);
    expect(identity?.uid).toBe('dev-owner');
  });

  it('treats "anonymous" as signed out', async () => {
    expect(await resolveIdentity(req('dev_user=anonymous'))).toBeNull();
  });

  it('rejects malformed or uid-less payloads', async () => {
    expect(await resolveIdentity(req('dev_user=%7Bnot-json'))).toBeNull();
    expect(
      await resolveIdentity(req(devCookie({ name: 'No Uid', email: 'x@y.zz' }))),
    ).toBeNull();
  });

  it('resolves via cookie getter for server components', async () => {
    const jar: Record<string, string> = {
      dev_user: encodeURIComponent(JSON.stringify({ uid: 'u2', name: 'Grace', email: null })),
    };
    const identity = await resolveIdentityFromCookies((name) => jar[name]);
    expect(identity).toEqual({ uid: 'u2', name: 'Grace', email: null });
  });
});

describe('LabOS identity (production path)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.DEV_AUTH = '0';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    // reset the module-level token cache between tests
    (globalThis as any).__roadmapperAuthCache = new Map();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.DEV_AUTH = '1';
  });

  it('returns null with no authToken cookie', async () => {
    expect(await resolveIdentity(req())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL-decodes and unquotes the token, sends it as Bearer, maps the member', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ member: { uid: 'm-1', name: 'Ada Lovelace' } }),
    });

    const identity = await resolveIdentity(req('authToken=%22tok-abc%22'));
    expect(identity).toEqual({ uid: 'm-1', name: 'Ada Lovelace', email: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/ai-apps/me');
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
  });

  it('picks up member.email if LabOS ever provides it (v1.4 gap seam)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ member: { uid: 'm-2', name: 'Ada', email: 'Ada@PL.Network' } }),
    });
    const identity = await resolveIdentity(req('authToken=%22tok-2%22'));
    expect(identity?.email).toBe('ada@pl.network');
  });

  it('caches validated tokens (single upstream call)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ member: { uid: 'm-3', name: 'Ada' } }),
    });
    await resolveIdentity(req('authToken=%22tok-3%22'));
    await resolveIdentity(req('authToken=%22tok-3%22'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on 401 and on network failure (never throws)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    expect(await resolveIdentity(req('authToken=%22expired%22'))).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await resolveIdentity(req('authToken=%22tok-err%22'))).toBeNull();
  });

  it('rejects member payloads without a uid', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ member: { name: 'x' } }) });
    expect(await resolveIdentity(req('authToken=%22tok-4%22'))).toBeNull();
  });
});
