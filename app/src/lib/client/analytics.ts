/**
 * Baseline usage analytics (kit v1.11 app-analytics skill). Events go to the
 * PLN backend which resolves app + member attribution server-side; no SDK,
 * no key. Fire-and-forget: a failure here must never affect the app.
 * Endpoint is inlined per the skill — pln-app.config.json isn't shipped in app/.
 */
const ANALYTICS_URL = 'https://api-directory.os.pl.xyz/v1/ai-apps/track';

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

/**
 * Route sync — the AI Apps dashboard mirrors the open page in its URL and tab
 * title (shareable deep links). Mandatory per kit v1.11.
 *
 * The route/title (which can include sensitive path segments, e.g. the invite
 * token in /join/[token]) is delivered ONLY to the LabOS portal that frames the
 * app — scoping the target origin stops any other page that iframes this app
 * from harvesting it.
 */
const PORTAL_ORIGIN = 'https://os.pl.xyz';

export function initRouteSync() {
  if (window.parent === window) return;
  let lastSent = '';
  const send = () => {
    const path = location.pathname + location.search + location.hash;
    const title = document.title;
    if (path + '\n' + title === lastSent) return;
    lastSent = path + '\n' + title;
    window.parent.postMessage({ type: 'pln-ai-app:route', path, title }, PORTAL_ORIGIN);
  };
  (['pushState', 'replaceState'] as const).forEach((method) => {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      send();
    };
  });
  window.addEventListener('popstate', send); // also fires for hash changes
  // Frameworks set the title after navigation, so watch <head> for title changes too.
  new MutationObserver(send).observe(document.head, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  send();
}

let initialized = false;

/** Baseline events (opened/error/closed) + route sync. Call once at startup, every app. */
export function initAppAnalytics() {
  if (initialized) return; // React strict-mode / re-render guard
  initialized = true;

  const openedAt = Date.now();
  trackEvent('opened');
  initRouteSync();

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
