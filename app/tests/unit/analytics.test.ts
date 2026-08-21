// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAppAnalytics, trackEvent } from '@/lib/client/analytics';

const ENDPOINT = 'https://api-directory.plnetwork.io/v1/ai-apps/track';

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe('baseline analytics (kit v1.9 app-analytics)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // One combined init test: jsdom's window persists across tests in this
  // file, so initializing more than once would stack duplicate listeners.
  it('init fires opened once, caps error events at 5, and re-arms closed per backgrounding', () => {
    initAppAnalytics();
    initAppAnalytics(); // once-guard

    const opened = sentBodies(fetchMock).filter((b) => b.event === 'opened');
    expect(opened).toHaveLength(1);
    expect(opened[0].anonId).toMatch(/^anon:/);
    expect(opened[0].anonId).toBe(localStorage.getItem('pln_anon_id'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect((init as RequestInit).keepalive).toBe(true);
    expect((init as Record<string, Record<string, string>>).headers.Authorization).toBeUndefined();

    // Error cap + truncation.
    for (let i = 0; i < 8; i++) {
      window.dispatchEvent(new ErrorEvent('error', { message: 'x'.repeat(500) }));
    }
    const errors = sentBodies(fetchMock).filter((b) => b.event === 'error');
    expect(errors).toHaveLength(5);
    expect(errors[0].properties.message).toHaveLength(300);
    expect(errors[0].properties.errorSource).toBe('window.onerror');

    // Closed on hide, once per backgrounding, re-armed on return.
    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    setVisibility('hidden');
    setVisibility('hidden'); // no duplicate while still hidden
    let closed = sentBodies(fetchMock).filter((b) => b.event === 'closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].properties.durationMs).toBeGreaterThanOrEqual(0);
    setVisibility('visible');
    setVisibility('hidden');
    closed = sentBodies(fetchMock).filter((b) => b.event === 'closed');
    expect(closed).toHaveLength(2);
  });

  it('sends the authToken cookie as a Bearer header and omits anonId', () => {
    document.cookie = 'authToken="tok-123"';
    trackEvent('opened');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as Record<string, Record<string, string>>).headers.Authorization).toBe(
      'Bearer tok-123',
    );
    expect(sentBodies(fetchMock)[0].anonId).toBeUndefined();
  });

  it('never throws when fetch is unavailable', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => trackEvent('opened')).not.toThrow();
  });
});
