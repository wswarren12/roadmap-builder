import { DEV_USERS } from './dev-users';
import type { Identity } from './types';

/**
 * Identity resolution (PRD F-5, starter-kit v1.4 contract).
 *
 * Production: the LabOS session cookie `authToken` reaches the app's origin;
 * the server URL-decodes it, strips surrounding quotes, and presents it to the
 * member-context endpoint as a Bearer token. The token is never logged or
 * persisted; validated identities are cached in memory for 5 minutes.
 *
 * Local dev / E2E (DEV_AUTH=1): identity comes from a `dev_user` cookie
 * (URL-encoded JSON {uid,name,email}; the literal value "anonymous" simulates
 * signed-out). With no cookie set, a default dev owner is used so
 * `DEV_AUTH=1 npm run dev` is instantly usable.
 *
 * NOTE (v1.4 reconciliation): the member-context response deliberately carries
 * no email. If LabOS adds one it is picked up automatically; until then
 * `email` is null in production and email-whitelist matching cannot grant
 * access — the UI explains this in the share panel.
 */

const MEMBER_CONTEXT_URL = 'https://api-directory.plnetwork.io/v1/ai-apps/me';
const CACHE_TTL_MS = 5 * 60 * 1000;

// No cookie set → the first roster entry (Dev One). Keeps `dev-owner` as the
// default uid so pre-existing local data stays owned by the default user.
const DEFAULT_DEV_USER: Identity = DEV_USERS[0];

interface CacheEntry {
  identity: Identity;
  expires: number;
}

const g = globalThis as typeof globalThis & {
  __roadmapperAuthCache?: Map<string, CacheEntry>;
};

function authCache(): Map<string, CacheEntry> {
  if (!g.__roadmapperAuthCache) g.__roadmapperAuthCache = new Map();
  return g.__roadmapperAuthCache;
}

export function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function decodeAuthToken(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).replace(/^"|"$/g, '');
    return decoded || null;
  } catch {
    return null;
  }
}

function devIdentity(cookies: Record<string, string>): Identity | null {
  const raw = cookies['dev_user'];
  if (!raw) return DEFAULT_DEV_USER;
  if (raw === 'anonymous') return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed.uid !== 'string' || !parsed.uid) return null;
    return {
      uid: parsed.uid,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.uid,
      email:
        typeof parsed.email === 'string' && parsed.email
          ? parsed.email.toLowerCase()
          : null,
      image: typeof parsed.image === 'string' && parsed.image ? parsed.image : null,
    };
  } catch {
    return null;
  }
}

async function labosIdentity(cookies: Record<string, string>): Promise<Identity | null> {
  const raw = cookies['authToken'];
  if (!raw) return null;
  const token = decodeAuthToken(raw);
  if (!token) return null;

  const cached = authCache().get(token);
  if (cached && cached.expires > Date.now()) return cached.identity;

  try {
    const res = await fetch(MEMBER_CONTEXT_URL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    const member = body?.member;
    if (!member?.uid) return null;
    const identity: Identity = {
      uid: member.uid,
      name: typeof member.name === 'string' ? member.name : member.uid,
      email:
        typeof member.email === 'string' && member.email
          ? member.email.toLowerCase()
          : null,
      image: typeof member.image === 'string' && member.image ? member.image : null,
    };
    authCache().set(token, { identity, expires: Date.now() + CACHE_TTL_MS });
    return identity;
  } catch {
    return null;
  }
}

/** Resolve the caller's identity from a Request (route handlers). */
export async function resolveIdentity(req: Request): Promise<Identity | null> {
  const cookies = parseCookieHeader(req.headers.get('cookie'));
  if (process.env.DEV_AUTH === '1') return devIdentity(cookies);
  return labosIdentity(cookies);
}

/** Resolve identity from a cookie getter (server components via next/headers). */
export async function resolveIdentityFromCookies(
  get: (name: string) => string | undefined,
): Promise<Identity | null> {
  const cookies: Record<string, string> = {};
  for (const name of ['dev_user', 'authToken']) {
    const v = get(name);
    if (v !== undefined) cookies[name] = v;
  }
  if (process.env.DEV_AUTH === '1') return devIdentity(cookies);
  return labosIdentity(cookies);
}
