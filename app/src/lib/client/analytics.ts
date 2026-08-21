/**
 * Baseline usage analytics (kit v1.9 app-analytics skill). Events go to the
 * PLN backend which resolves app + member attribution server-side; no SDK,
 * no key. Fire-and-forget: a failure here must never affect the app.
 * Endpoint is inlined per the skill — pln-app.config.json isn't shipped in app/.
 */
const ANALYTICS_URL = 'https://api-directory.plnetwork.io/v1/ai-apps/track';

function readAuthToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)authToken=([^;]*)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]).replace(/^"|"$/g, '');
  return raw || null;
}

function getAnonId(): string {
  let id = localStorage.getItem('pln_anon_id');
  if (!id) {
    id = `anon:${crypto.randomUUID()}`;
    localStorage.setItem('pln_anon_id', id);
  }
  return id;
}

export function trackEvent(name: string, properties: Record<string, unknown> = {}) {
  try {
    const token = readAuthToken();
    const body = JSON.stringify({
      event: name,
      properties,
      anonId: token ? undefined : getAnonId(),
    });
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    // keepalive lets the request survive a page navigation right after the call.
    fetch(ANALYTICS_URL, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
  } catch {
    // Analytics must never throw into the app.
  }
}

let initialized = false;

/** Baseline events (opened/error/closed). Call once at startup, every app. */
export function initAppAnalytics() {
  if (initialized) return; // React strict-mode / re-render guard
  initialized = true;

  const openedAt = Date.now();
  trackEvent('opened');

  // Cap error events so a crash-looping bug can't spam the shared project.
  let errorCount = 0;
  const MAX_ERROR_EVENTS = 5;
  // Property is errorSource, not "source" — "source" is server-stamped and
  // would be overwritten.
  function trackErrorOnce(message: unknown, errorSource: string) {
    if (errorCount >= MAX_ERROR_EVENTS) return;
    errorCount += 1;
    trackEvent('error', { message: String(message).slice(0, 300), errorSource });
  }
  window.addEventListener('error', (e) => trackErrorOnce(e.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) =>
    trackErrorOnce(
      e.reason && (e.reason as Error).message ? (e.reason as Error).message : String(e.reason),
      'unhandledrejection',
    ),
  );

  // Approximate session length: fires once per backgrounding, not a perfect
  // single "closed" signal (the user can come back).
  let closedSent = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !closedSent) {
      closedSent = true;
      trackEvent('closed', { durationMs: Date.now() - openedAt });
    } else if (document.visibilityState === 'visible') {
      closedSent = false;
    }
  });
}
