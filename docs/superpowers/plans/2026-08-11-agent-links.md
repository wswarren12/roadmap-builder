# Agent Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named, revocable bearer-capability URLs (`/agent/<token>`) that let third-party AI agents view a roadmap, file suggestions a human approves, or edit it directly — per the approved spec `docs/superpowers/specs/2026-08-05-agent-links-design.md`.

**Architecture:** One new namespace `/agent/[token]` — a browser page plus an optional catch-all API route (`api/[[...path]]/route.ts`) that is the single chokepoint for token auth, rate limiting, and activity logging. Auth stays in the API layer via a new `authorizeAgent()` beside `authorizeRoadmap()`. Suggestion payloads reuse the existing PATCH/POST body shapes so "accept" replays them through the same store functions; editor direct writes reuse `executeAgentTool` from the F-14 chat agent.

**Tech Stack:** Next.js 14 App Router, Supabase (service-role, RLS closed), vitest + Playwright, PL Design System components.

## Global Constraints

- Roles: `'agent_viewer' | 'agent_suggester' | 'agent_editor'`; default role for new links is **suggester**.
- Token: `randomBytes(18).toString('base64url')` — same generator as invite links.
- Tier mapping: read = any role; suggest = suggester|editor; write = editor.
- Revoked/unknown token → **404** (never 403 — must not confirm the roadmap exists).
- Rate limit: 60 req/min per token → 429 with `retry_after` (seconds); max 20 **pending** suggestions per link.
- Tokens must never appear in `agent_activity.detail` or logs.
- Agent principals can never touch link management, shares, or roadmap deletion (those routes are human-authed only; the agent catch-all simply never exposes them).
- Soft revoke: `revoked_at` set, row kept (activity history preserved).
- All timestamps ISO strings; DB is snake_case, app is camelCase (mappers in `supabase.ts`).
- UI copy: browser banner reads `Shared with "<name>" — <viewer|suggest|edit> access`.
- No auto-expiry, no MCP surface, no suggestion threads (out of scope v1).

## BDD Scenarios

```gherkin
Feature: Agent links

Scenario: Owner creates a suggester link
  Given Olive owns roadmap R
  When she POSTs {name: "Hermes PM bot"} to /api/roadmaps/R/agent-links
  Then a link with role agent_suggester and a base64url token is returned
  And GET /api/roadmaps/R/agent-links lists it with lastUsedAt null

Scenario: Agent reads the capability manifest
  Given an active suggester link with token T
  When an agent GETs /agent/T/api
  Then the manifest names the agent, role, and roadmap
  And capabilities include read_roadmap, create_suggestion, list_suggestions
  And a viewer link's manifest omits create_suggestion
  And an editor link's manifest additionally lists direct-write endpoints

Scenario: Suggest → accept changes the roadmap
  Given item I "API beta" ends 2026-09-15 on Olive's roadmap
  And a suggester link with token T
  When the agent POSTs a suggestion {kind: update_item, target_id: I, payload: {endDate: "2026-10-01"}, rationale: "..."}
  Then the suggestion is pending and the item is unchanged
  When Olive accepts it via POST /api/suggestions/<id>/resolve {action: "accept"}
  Then item I ends 2026-10-01 and the suggestion is accepted with resolvedBy Olive

Scenario: Malformed suggestion rejected at filing time
  When the agent files {kind: update_item, target_id: I, payload: {endDate: "2027-06-01"}} (outside roadmap range)
  Then the response is 400 with a descriptive validation error and nothing is stored

Scenario: Accept after target deleted fails gracefully
  Given a pending suggestion targeting item I
  When Olive deletes item I and then accepts the suggestion
  Then the suggestion becomes rejected with resolvedBy "system" and the API reports applied: false

Scenario: Revoked token 404s
  Given Olive revokes the link
  When the agent GETs /agent/T/api
  Then the response is 404

Scenario: Rate limit
  Given 60 agent requests with token T in the last minute
  When the agent makes one more
  Then the response is 429 with retry_after

Scenario: Editor link writes directly
  Given an editor link with token T
  When the agent PATCHes /agent/T/api/items/I {endDate: "2026-10-01"}
  Then the item is updated (same validation as the human route)
  And a suggester link making the same call gets 403

Scenario: Browser view
  Given an active link with token T
  When a browser opens /agent/T
  Then the roadmap renders read-only with a banner naming the link and its access

Scenario: Ghost bars
  Given a pending create_item suggestion
  When an editor views the roadmap
  Then a dotted-border, unfilled ghost bar renders in the target initiative row
  And the header shows a "1 suggestion" badge that opens the review panel
```

## File Structure

- `app/supabase/migrations/006_agent_links.sql` — 3 tables + RLS (+ missed 005 RLS fix)
- `app/src/lib/types.ts` — AgentRole, AgentLink, Suggestion, AgentActivityEntry types
- `app/src/lib/store/{types,memory,supabase}.ts` — store methods for the 3 tables
- `app/src/lib/agent-links/rate-limit.ts` — in-memory sliding-window limiter
- `app/src/lib/agent-links/suggestions.ts` — validate / apply / describe suggestions
- `app/src/lib/api-helpers.ts` — `authorizeAgent()`
- `app/src/app/agent/[token]/api/[[...path]]/route.ts` — the whole agent API
- `app/src/app/agent/[token]/page.tsx` + `app/src/components/AgentLinkView.tsx` — browser view
- `app/src/middleware.ts` — `Accept: application/json` on `/agent/<token>` → rewrite to `/agent/<token>/api`
- `app/src/app/api/roadmaps/[id]/agent-links/route.ts` — GET/POST (owner)
- `app/src/app/api/agent-links/[id]/route.ts` — DELETE (owner)
- `app/src/app/api/roadmaps/[id]/suggestions/route.ts` — GET (write tier)
- `app/src/app/api/suggestions/[id]/resolve/route.ts` — POST (write tier)
- `app/src/components/SharePanel.tsx` — "AI agents" section (owner only)
- `app/src/components/SuggestionsPanel.tsx` — review drawer
- `app/src/components/RoadmapView.tsx` — badge, panel wiring, ghost bars
- `app/src/app/globals.css` (or the project stylesheet holding `.share-row` etc. — locate with grep) — `.ghost-bar` styles
- Tests: `app/tests/unit/agent-rate-limit.test.ts`, `app/tests/unit/agent-suggestions.test.ts`, `app/tests/api/agent-links.test.ts`, `app/tests/e2e/agent-links.spec.ts`

---

### Task 1: Migration + types + store layer

**Files:**
- Create: `app/supabase/migrations/006_agent_links.sql`
- Modify: `app/src/lib/types.ts` (append), `app/src/lib/store/types.ts`, `app/src/lib/store/memory.ts`, `app/src/lib/store/supabase.ts`
- Test: `app/tests/api/agent-links.test.ts` (store-level describe block)

**Interfaces (produced — later tasks rely on these exact names):**

```ts
// types.ts
export type AgentRole = 'agent_viewer' | 'agent_suggester' | 'agent_editor';
export interface AgentLink {
  id: string; roadmapId: string; token: string; name: string; role: AgentRole;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
}
export type SuggestionKind =
  'create_item' | 'update_item' | 'delete_item' | 'create_sprint' | 'update_sprint' | 'comment';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';
export interface Suggestion {
  id: string; roadmapId: string; agentLinkId: string; kind: SuggestionKind;
  targetId: string | null; payload: Record<string, unknown>; rationale: string;
  status: SuggestionStatus; resolvedBy: string | null; resolvedAt: string | null;
  createdAt: string;
}
export interface AgentActivityEntry {
  id: string; agentLinkId: string; roadmapId: string; action: string;
  detail: Record<string, unknown>; createdAt: string;
}

// store/types.ts additions
createAgentLink(roadmapId: string, name: string, role: AgentRole, token: string): Promise<AgentLink>;
listAgentLinks(roadmapId: string): Promise<AgentLink[]>;
getAgentLink(id: string): Promise<AgentLink | null>;
findAgentLinkByToken(token: string): Promise<AgentLink | null>; // returns revoked rows too — caller checks revokedAt
revokeAgentLink(id: string): Promise<void>;                     // sets revoked_at = now
touchAgentLink(id: string): Promise<void>;                      // sets last_used_at = now
createSuggestion(input: {
  roadmapId: string; agentLinkId: string; kind: SuggestionKind;
  targetId: string | null; payload: Record<string, unknown>; rationale: string;
}): Promise<Suggestion>;
listSuggestions(roadmapId: string): Promise<Suggestion[]>;          // newest first
listSuggestionsByLink(agentLinkId: string): Promise<Suggestion[]>;  // newest first
getSuggestion(id: string): Promise<Suggestion | null>;
resolveSuggestion(id: string, status: 'accepted' | 'rejected', resolvedBy: string): Promise<Suggestion>;
countPendingSuggestions(agentLinkId: string): Promise<number>;
logAgentActivity(entry: { agentLinkId: string; roadmapId: string; action: string; detail: Record<string, unknown> }): Promise<void>;
listAgentActivity(agentLinkId: string, limit: number): Promise<AgentActivityEntry[]>; // newest first
```

- [ ] **Step 1: Write the migration**

```sql
-- Agent links (agent-links design 2026-08-05): named, revocable bearer
-- capabilities granting AI agents per-roadmap access. `suggestions` holds
-- agent-proposed changes pending human review (payloads reuse the human
-- PATCH/POST body shapes); `agent_activity` is an append-only audit log.
-- Service-role access only; authorization lives in the API layer.

CREATE TABLE agent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agent_viewer', 'agent_suggester', 'agent_editor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,          -- bumped on every authorized agent call
  revoked_at TIMESTAMPTZ             -- NULL = active (soft revoke keeps history)
);
CREATE INDEX agent_links_roadmap_idx ON agent_links(roadmap_id);

CREATE TABLE suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  agent_link_id UUID NOT NULL REFERENCES agent_links(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN
    ('create_item', 'update_item', 'delete_item', 'create_sprint', 'update_sprint', 'comment')),
  target_id UUID,                    -- item/sprint being modified; NULL for creates/comments
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_by TEXT,                  -- member uid, or 'system' for auto-reject
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX suggestions_roadmap_idx ON suggestions(roadmap_id);
CREATE INDEX suggestions_link_idx ON suggestions(agent_link_id);

CREATE TABLE agent_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_link_id UUID NOT NULL REFERENCES agent_links(id) ON DELETE CASCADE,
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  action TEXT NOT NULL,              -- 'read' | 'suggest' | 'edit' | ...
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,  -- never contains the token
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX agent_activity_link_idx ON agent_activity(agent_link_id);

ALTER TABLE agent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_activity ENABLE ROW LEVEL SECURITY;
-- 005 omitted this; every table must close the anon Data API (see 003).
ALTER TABLE roadmap_team_members ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Add the types** to `app/src/lib/types.ts` (exact interfaces above, with a doc comment noting payload shapes mirror the human PATCH/POST bodies).

- [ ] **Step 3: Extend `Store` interface** in `app/src/lib/store/types.ts` with the signatures above (new section comment `// agent links (agent-links design)`), importing `AgentActivityEntry, AgentLink, AgentRole, Suggestion, SuggestionKind` from `../types`.

- [ ] **Step 4: Write failing store tests** — new file `app/tests/api/agent-links.test.ts`, first describe block only:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { freshStore, seedRoadmap } from './harness';
import type { MemoryStore } from '@/lib/store';

describe('agent-links store layer', () => {
  let store: MemoryStore;
  beforeEach(() => { store = freshStore(); });

  it('creates, lists, revokes, and touches links', async () => {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Hermes PM bot', 'agent_suggester', 'tok-1');
    expect(link.role).toBe('agent_suggester');
    expect(link.revokedAt).toBeNull();
    expect(await store.findAgentLinkByToken('tok-1')).toMatchObject({ id: link.id });
    expect(await store.findAgentLinkByToken('nope')).toBeNull();

    await store.touchAgentLink(link.id);
    expect((await store.getAgentLink(link.id))!.lastUsedAt).not.toBeNull();

    await store.revokeAgentLink(link.id);
    const revoked = await store.findAgentLinkByToken('tok-1');
    expect(revoked!.revokedAt).not.toBeNull();
    expect(await store.listAgentLinks(roadmap.id)).toHaveLength(1);
  });

  it('creates, resolves, and counts suggestions', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_suggester', 'tok-2');
    const s = await store.createSuggestion({
      roadmapId: roadmap.id, agentLinkId: link.id, kind: 'update_item',
      targetId: item.id, payload: { endDate: '2026-10-01' }, rationale: 'stretch',
    });
    expect(s.status).toBe('pending');
    expect(await store.countPendingSuggestions(link.id)).toBe(1);
    const resolved = await store.resolveSuggestion(s.id, 'accepted', 'u-owner');
    expect(resolved.status).toBe('accepted');
    expect(resolved.resolvedBy).toBe('u-owner');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await store.countPendingSuggestions(link.id)).toBe(0);
    expect(await store.listSuggestionsByLink(link.id)).toHaveLength(1);
    expect(await store.listSuggestions(roadmap.id)).toHaveLength(1);
  });

  it('logs and lists activity newest-first', async () => {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_viewer', 'tok-3');
    await store.logAgentActivity({ agentLinkId: link.id, roadmapId: roadmap.id, action: 'read', detail: { path: 'manifest' } });
    await store.logAgentActivity({ agentLinkId: link.id, roadmapId: roadmap.id, action: 'read', detail: { path: 'roadmap' } });
    const acts = await store.listAgentActivity(link.id, 5);
    expect(acts).toHaveLength(2);
    expect(acts[0].detail).toEqual({ path: 'roadmap' });
  });
});
```

- [ ] **Step 5: Run to verify failure** — `cd app && npx vitest run tests/api/agent-links.test.ts` → FAIL (methods missing; TS errors).

- [ ] **Step 6: Implement `MemoryStore`** — add `agentLinks: Map<string, AgentLink>`, `suggestions: Map<string, Suggestion>`, `agentActivity: AgentActivityEntry[]` to `Db`/`emptyDb`, cascade them in `deleteRoadmap`, then:

```ts
async createAgentLink(roadmapId: string, name: string, role: AgentRole, token: string) {
  const link: AgentLink = {
    id: randomUUID(), roadmapId, token, name, role,
    createdAt: now(), lastUsedAt: null, revokedAt: null,
  };
  this.db.agentLinks.set(link.id, link);
  return link;
}
async listAgentLinks(roadmapId: string) {
  return [...this.db.agentLinks.values()]
    .filter((l) => l.roadmapId === roadmapId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
async getAgentLink(id: string) { return this.db.agentLinks.get(id) ?? null; }
async findAgentLinkByToken(token: string) {
  return [...this.db.agentLinks.values()].find((l) => l.token === token) ?? null;
}
async revokeAgentLink(id: string) {
  const l = this.db.agentLinks.get(id);
  if (!l) throw new Error('agent link not found');
  this.db.agentLinks.set(id, { ...l, revokedAt: now() });
}
async touchAgentLink(id: string) {
  const l = this.db.agentLinks.get(id);
  if (!l) throw new Error('agent link not found');
  this.db.agentLinks.set(id, { ...l, lastUsedAt: now() });
}
async createSuggestion(input: { roadmapId: string; agentLinkId: string; kind: SuggestionKind; targetId: string | null; payload: Record<string, unknown>; rationale: string }) {
  const s: Suggestion = {
    id: randomUUID(), ...input, status: 'pending',
    resolvedBy: null, resolvedAt: null, createdAt: now(),
  };
  this.db.suggestions.set(s.id, s);
  return s;
}
async listSuggestions(roadmapId: string) {
  return [...this.db.suggestions.values()]
    .filter((s) => s.roadmapId === roadmapId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async listSuggestionsByLink(agentLinkId: string) {
  return [...this.db.suggestions.values()]
    .filter((s) => s.agentLinkId === agentLinkId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async getSuggestion(id: string) { return this.db.suggestions.get(id) ?? null; }
async resolveSuggestion(id: string, status: 'accepted' | 'rejected', resolvedBy: string) {
  const s = this.db.suggestions.get(id);
  if (!s) throw new Error('suggestion not found');
  const resolved: Suggestion = { ...s, status, resolvedBy, resolvedAt: now() };
  this.db.suggestions.set(id, resolved);
  return resolved;
}
async countPendingSuggestions(agentLinkId: string) {
  return [...this.db.suggestions.values()]
    .filter((s) => s.agentLinkId === agentLinkId && s.status === 'pending').length;
}
async logAgentActivity(entry: { agentLinkId: string; roadmapId: string; action: string; detail: Record<string, unknown> }) {
  this.db.agentActivity.push({ id: randomUUID(), ...entry, createdAt: now() });
}
async listAgentActivity(agentLinkId: string, limit: number) {
  return this.db.agentActivity
    .filter((a) => a.agentLinkId === agentLinkId)
    .slice(-limit)
    .reverse();
}
```

Note: two `logAgentActivity` calls can land in the same millisecond, so `agentActivity` is an array (insertion order), not a Map sorted by timestamp.

- [ ] **Step 7: Implement `SupabaseStore`** — mappers + methods mirroring house style:

```ts
function mapAgentLink(r: any): AgentLink {
  return {
    id: r.id, roadmapId: r.roadmap_id, token: r.token, name: r.name, role: r.role,
    createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at,
  };
}
function mapSuggestion(r: any): Suggestion {
  return {
    id: r.id, roadmapId: r.roadmap_id, agentLinkId: r.agent_link_id, kind: r.kind,
    targetId: r.target_id, payload: r.payload ?? {}, rationale: r.rationale ?? '',
    status: r.status, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}
function mapAgentActivity(r: any): AgentActivityEntry {
  return {
    id: r.id, agentLinkId: r.agent_link_id, roadmapId: r.roadmap_id,
    action: r.action, detail: r.detail ?? {}, createdAt: r.created_at,
  };
}
```

Methods (all follow the `unwrap`/`maybeSingle` house pattern):
- `createAgentLink`: insert `{ roadmap_id, token, name, role }`, select single, map.
- `listAgentLinks`: select by `roadmap_id`, `.order('created_at')`.
- `getAgentLink` / `findAgentLinkByToken`: select by `id` / `token`, `maybeSingle`.
- `revokeAgentLink` / `touchAgentLink`: update `{ revoked_at: new Date().toISOString() }` / `{ last_used_at: ... }` by id.
- `createSuggestion`: insert `{ roadmap_id, agent_link_id, kind, target_id, payload, rationale }`.
- `listSuggestions` / `listSuggestionsByLink`: `.order('created_at', { ascending: false })`.
- `resolveSuggestion`: update `{ status, resolved_by, resolved_at: new Date().toISOString() }`, select single.
- `countPendingSuggestions`: `select('*', { count: 'exact', head: true }).eq('agent_link_id', id).eq('status', 'pending')`.
- `logAgentActivity`: insert; `listAgentActivity`: `.order('created_at', { ascending: false }).limit(limit)`.

- [ ] **Step 8: Run** `npx vitest run tests/api/agent-links.test.ts` → PASS; then `npx tsc --noEmit` (or `npm run build` if no typecheck script) → clean.

- [ ] **Step 9: Commit** — `git add -A app/supabase app/src/lib app/tests && git commit -m "feat(agent-links): migration 006, types, store layer"`

---

### Task 2: Rate limiter

**Files:**
- Create: `app/src/lib/agent-links/rate-limit.ts`
- Test: `app/tests/unit/agent-rate-limit.test.ts`

**Interfaces (produced):**
```ts
export const AGENT_RATE_LIMIT = 60;            // requests per minute per token
export const MAX_PENDING_SUGGESTIONS = 20;     // per link
/** null = allowed; number = seconds until the next slot frees up. */
export function checkRateLimit(token: string, nowMs?: number): number | null;
export function resetRateLimits(): void;       // test isolation
```

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Run → FAIL** (module missing).

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-links): per-token sliding-window rate limiter"`

---

### Task 3: `authorizeAgent()`

**Files:**
- Modify: `app/src/lib/api-helpers.ts`
- Test: `app/tests/api/agent-links.test.ts` (new describe block)

**Interfaces:**
- Consumes: `findAgentLinkByToken`, `touchAgentLink` (Task 1), `checkRateLimit` (Task 2).
- Produces:
```ts
export type AgentTier = 'read' | 'suggest' | 'write';
export interface AuthedAgent { link: AgentLink; roadmap: Roadmap; }
export async function authorizeAgent(token: string, required: AgentTier): Promise<AuthedAgent | NextResponse>;
```

- [ ] **Step 1: Failing tests**

```ts
import { authorizeAgent } from '@/lib/api-helpers';
import { resetRateLimits, AGENT_RATE_LIMIT } from '@/lib/agent-links/rate-limit';
import { NextResponse } from 'next/server';

describe('authorizeAgent', () => {
  let store: MemoryStore;
  beforeEach(() => { store = freshStore(); resetRateLimits(); });

  async function seededLink(role: AgentRole) {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', role, `tok-${role}`);
    return { roadmap, link };
  }

  it('unknown token → 404', async () => {
    const r = await authorizeAgent('nope', 'read');
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(404);
  });

  it('revoked token → 404, not 403', async () => {
    const { link } = await seededLink('agent_editor');
    await store.revokeAgentLink(link.id);
    const r = await authorizeAgent(link.token, 'read');
    expect((r as NextResponse).status).toBe(404);
  });

  it('tier ladder: viewer reads only; suggester suggests; editor writes', async () => {
    const v = await seededLink('agent_viewer');
    expect(await authorizeAgent(v.link.token, 'read')).toHaveProperty('link');
    expect(((await authorizeAgent(v.link.token, 'suggest')) as NextResponse).status).toBe(403);
    const s = await seededLink('agent_suggester');
    expect(await authorizeAgent(s.link.token, 'suggest')).toHaveProperty('link');
    expect(((await authorizeAgent(s.link.token, 'write')) as NextResponse).status).toBe(403);
    const e = await seededLink('agent_editor');
    expect(await authorizeAgent(e.link.token, 'write')).toHaveProperty('link');
  });

  it('bumps last_used_at and rate-limits with retry_after', async () => {
    const { link } = await seededLink('agent_viewer');
    await authorizeAgent(link.token, 'read');
    expect((await store.getAgentLink(link.id))!.lastUsedAt).not.toBeNull();
    for (let i = 1; i < AGENT_RATE_LIMIT; i++) await authorizeAgent(link.token, 'read');
    const r = await authorizeAgent(link.token, 'read');
    expect((r as NextResponse).status).toBe(429);
    expect(await (r as NextResponse).clone().json()).toHaveProperty('retry_after');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `api-helpers.ts` (below `authorizeRoadmap`):

```ts
const AGENT_TIER: Record<AgentTier, AgentRole[]> = {
  read: ['agent_viewer', 'agent_suggester', 'agent_editor'],
  suggest: ['agent_suggester', 'agent_editor'],
  write: ['agent_editor'],
};

/**
 * Agent-link counterpart to authorizeRoadmap (agent-links design): the URL
 * token is the whole credential. Unknown and revoked tokens both 404 so a
 * revoked link can't be used to confirm the roadmap exists. Every authorized
 * call bumps last_used_at and counts against the per-token rate limit.
 */
export async function authorizeAgent(
  token: string,
  required: AgentTier,
): Promise<AuthedAgent | NextResponse> {
  const retryAfter = checkRateLimit(token);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retry_after: retryAfter },
      { status: 429, headers: { 'retry-after': String(retryAfter) } },
    );
  }
  const link = await getStore().findAgentLinkByToken(token);
  if (!link || link.revokedAt) return jsonError(404, 'Not found');
  if (!AGENT_TIER[required].includes(link.role)) {
    return jsonError(403, `This agent link has ${link.role.replace('agent_', '')} access only`);
  }
  const roadmap = await getStore().getRoadmap(link.roadmapId);
  if (!roadmap) return jsonError(404, 'Not found');
  await getStore().touchAgentLink(link.id);
  return { link, roadmap };
}
```

- [ ] **Step 4: Run → PASS. Commit** — `git commit -m "feat(agent-links): authorizeAgent token auth with tiers, revocation, rate limit"`

---

### Task 4: Suggestion engine (validate / apply / describe)

**Files:**
- Create: `app/src/lib/agent-links/suggestions.ts`
- Test: `app/tests/unit/agent-suggestions.test.ts`

**Interfaces:**
- Consumes: store (Task 1), `executeAgentTool` + `roadmapSpan`/validators (existing).
- Produces:
```ts
export const SUGGESTION_KINDS: SuggestionKind[];
/** Validate a suggestion at filing time with the same rules as the human routes. */
export async function validateSuggestion(
  roadmap: Roadmap, kind: SuggestionKind, targetId: string | null,
  payload: Record<string, unknown>,
): Promise<string | null>;                      // null = valid, string = error message
/** Replay an accepted suggestion through the store. */
export async function applySuggestion(
  roadmap: Roadmap, s: Suggestion,
): Promise<{ ok: true } | { ok: false; reason: string }>;
/** Human-readable one-liner for the review panel ("Move "API beta": end 2026-09-15 → 2026-10-01"). */
export async function describeSuggestion(s: Suggestion): Promise<string>;
```

**Approach:** delegate to `executeAgentTool` (already validates everything the human routes do) by mapping suggestion kinds to tool calls; `validateSuggestion` runs the same mapping against a **throwaway check**: for creates/updates it calls the pure validators (`validateDatesWithin`, `validateMilestoneDate`, `requireNonEmpty` equivalents) plus target-existence checks — it must NOT write. Do not call `executeAgentTool` in validate (it writes).

- [ ] **Step 1: Failing tests** covering: valid `update_item` passes; dates outside roadmap span fail with message; `create_item` with unknown `initiativeId` fails; `delete_item` with missing target fails; `create_sprint` dates outside parent item fail; `comment` with empty payload passes; `applySuggestion` for `update_item` changes the store; `applySuggestion` for `delete_item` deletes; apply after target deleted returns `{ ok: false }`; `describeSuggestion` for an update mentions the item title and the changed field values.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applySuggestion, describeSuggestion, validateSuggestion } from '@/lib/agent-links/suggestions';
import { freshStore, seedRoadmap } from '../api/harness';
import type { MemoryStore } from '@/lib/store';
import type { Suggestion } from '@/lib/types';

function asSuggestion(partial: Partial<Suggestion>): Suggestion {
  return {
    id: 's1', roadmapId: 'r', agentLinkId: 'l', kind: 'comment', targetId: null,
    payload: {}, rationale: 'why', status: 'pending', resolvedBy: null,
    resolvedAt: null, createdAt: new Date().toISOString(), ...partial,
  };
}

describe('suggestion engine', () => {
  let store: MemoryStore;
  beforeEach(() => { store = freshStore(); });

  it('validates update_item against the roadmap span', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    expect(await validateSuggestion(roadmap, 'update_item', item.id, { endDate: '2026-10-01' })).toBeNull();
    expect(await validateSuggestion(roadmap, 'update_item', item.id, { endDate: '2027-06-01' })).toMatch(/range/i);
    expect(await validateSuggestion(roadmap, 'update_item', 'missing-id', { endDate: '2026-10-01' })).toMatch(/item/i);
  });

  it('validates create_item initiative ownership', async () => {
    const { roadmap } = await seedRoadmap(store);
    const err = await validateSuggestion(roadmap, 'create_item', null, {
      initiativeId: 'not-real', title: 'X', startDate: '2026-08-01', endDate: '2026-08-20',
    });
    expect(err).toMatch(/initiative/i);
  });

  it('validates create_sprint inside the parent item', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    expect(await validateSuggestion(roadmap, 'create_sprint', null, {
      itemId: item.id, name: 'S2', startDate: '2026-08-17', endDate: '2026-08-28',
    })).toBeNull();
    expect(await validateSuggestion(roadmap, 'create_sprint', null, {
      itemId: item.id, name: 'S2', startDate: '2026-06-01', endDate: '2026-06-10',
    })).toMatch(/parent item/i);
  });

  it('comment needs no payload', async () => {
    const { roadmap } = await seedRoadmap(store);
    expect(await validateSuggestion(roadmap, 'comment', null, {})).toBeNull();
  });

  it('applies update_item and delete_item; missing target fails gracefully', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const upd = asSuggestion({ roadmapId: roadmap.id, kind: 'update_item', targetId: item.id, payload: { endDate: '2026-10-01' } });
    expect(await applySuggestion(roadmap, upd)).toEqual({ ok: true });
    expect((await store.getItem(item.id))!.endDate).toBe('2026-10-01');

    const del = asSuggestion({ roadmapId: roadmap.id, kind: 'delete_item', targetId: item.id });
    expect(await applySuggestion(roadmap, del)).toEqual({ ok: true });
    expect(await store.getItem(item.id)).toBeNull();

    const gone = await applySuggestion(roadmap, upd);
    expect(gone.ok).toBe(false);
  });

  it('describes an update with title and changed values', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const s = asSuggestion({ roadmapId: roadmap.id, kind: 'update_item', targetId: item.id, payload: { endDate: '2026-10-01' } });
    const text = await describeSuggestion(s);
    expect(text).toContain('Signup revamp');
    expect(text).toContain('2026-10-01');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Sketch (implementer fills the obvious symmetric cases — all six kinds must be handled in all three functions):

```ts
import { getStore } from '../store';
import type { Roadmap, RoadmapItem, SprintItem, Suggestion, SuggestionKind } from '../types';
import { roadmapSpan, validateDatesWithin, validateMilestoneDate } from '../validate';
import { executeAgentTool } from '../agent/tools';

export const SUGGESTION_KINDS: SuggestionKind[] =
  ['create_item', 'update_item', 'delete_item', 'create_sprint', 'update_sprint', 'comment'];

/** Payload contracts (same shapes as the human POST/PATCH bodies):
 *  create_item   → ItemInput fields incl. initiativeId (targetId null)
 *  update_item   → partial ItemInput patch (targetId = item id)
 *  delete_item   → {} (targetId = item id)
 *  create_sprint → SprintInput fields + itemId (targetId null; parent in payload
 *                  because the human route carries it in the URL path)
 *  update_sprint → partial SprintInput patch (targetId = sprint id)
 *  comment       → { text? } — rationale carries the substance
 */

async function targetItem(roadmap: Roadmap, id: string | null): Promise<RoadmapItem | null> {
  if (!id) return null;
  const item = await getStore().getItem(id);
  return item && item.roadmapId === roadmap.id ? item : null;
}
async function targetSprint(roadmap: Roadmap, id: string | null): Promise<{ sprint: SprintItem; item: RoadmapItem } | null> {
  if (!id) return null;
  const sprint = await getStore().getSprint(id);
  if (!sprint) return null;
  const item = await getStore().getItem(sprint.roadmapItemId);
  return item && item.roadmapId === roadmap.id ? { sprint, item } : null;
}

export async function validateSuggestion(roadmap, kind, targetId, payload) {
  const span = roadmapSpan(roadmap);
  switch (kind) {
    case 'comment': return null;
    case 'create_item': {
      const initiative = await getStore().getInitiative(String(payload.initiativeId ?? ''));
      if (!initiative || initiative.roadmapId !== roadmap.id) return 'initiativeId must be an initiative on this roadmap';
      if (!String(payload.title ?? '').trim()) return 'title is required';
      const dateErr = validateDatesWithin(payload.startDate, payload.endDate, span.start, span.end, 'the roadmap date range');
      if (dateErr) return dateErr.message;
      const msErr = validateMilestoneDate((payload.milestoneDate as string) ?? null, payload.startDate as string, payload.endDate as string);
      return msErr ? msErr.message : null;
    }
    case 'update_item': {
      const item = await targetItem(roadmap, targetId);
      if (!item) return 'target item not found on this roadmap';
      if (payload.title !== undefined && !String(payload.title).trim()) return 'title cannot be empty';
      const startDate = (payload.startDate as string) ?? item.startDate;
      const endDate = (payload.endDate as string) ?? item.endDate;
      const dateErr = validateDatesWithin(startDate, endDate, span.start, span.end, 'the roadmap date range');
      if (dateErr) return dateErr.message;
      const milestoneDate = payload.milestoneDate === undefined ? item.milestoneDate : (payload.milestoneDate as string | null);
      const msErr = validateMilestoneDate(milestoneDate, startDate, endDate);
      return msErr ? msErr.message : null;
    }
    case 'delete_item':
      return (await targetItem(roadmap, targetId)) ? null : 'target item not found on this roadmap';
    case 'create_sprint': {
      const item = await targetItem(roadmap, String(payload.itemId ?? ''));
      if (!item) return 'itemId must be an item on this roadmap';
      if (!String(payload.name ?? '').trim()) return 'name is required';
      const dateErr = validateDatesWithin(payload.startDate, payload.endDate, item.startDate, item.endDate,
        `the parent item "${item.title}" (${item.startDate} → ${item.endDate})`);
      return dateErr ? dateErr.message : null;
    }
    case 'update_sprint': {
      const t = await targetSprint(roadmap, targetId);
      if (!t) return 'target sprint not found on this roadmap';
      if (payload.name !== undefined && !String(payload.name).trim()) return 'name cannot be empty';
      const startDate = (payload.startDate as string) ?? t.sprint.startDate;
      const endDate = (payload.endDate as string) ?? t.sprint.endDate;
      const dateErr = validateDatesWithin(startDate, endDate, t.item.startDate, t.item.endDate,
        `the parent item "${t.item.title}" (${t.item.startDate} → ${t.item.endDate})`);
      return dateErr ? dateErr.message : null;
    }
  }
}

export async function applySuggestion(roadmap, s) {
  // Re-validate first: the roadmap may have changed since filing.
  const invalid = await validateSuggestion(roadmap, s.kind, s.targetId, s.payload);
  if (invalid) return { ok: false as const, reason: invalid };
  switch (s.kind) {
    case 'comment': return { ok: true as const };
    case 'create_item': {
      const out = await executeAgentTool(roadmap, 'create_item', s.payload);
      return out.isError ? { ok: false as const, reason: out.result } : { ok: true as const };
    }
    case 'update_item': {
      const out = await executeAgentTool(roadmap, 'update_item', { ...s.payload, itemId: s.targetId });
      return out.isError ? { ok: false as const, reason: out.result } : { ok: true as const };
    }
    case 'delete_item': {
      const item = await targetItem(roadmap, s.targetId);
      if (!item) return { ok: false as const, reason: 'target item not found' };
      await getStore().deleteItem(item.id);
      return { ok: true as const };
    }
    case 'create_sprint': {
      const out = await executeAgentTool(roadmap, 'create_sprint', s.payload);
      return out.isError ? { ok: false as const, reason: out.result } : { ok: true as const };
    }
    case 'update_sprint': {
      const out = await executeAgentTool(roadmap, 'update_sprint', { ...s.payload, sprintId: s.targetId });
      return out.isError ? { ok: false as const, reason: out.result } : { ok: true as const };
    }
  }
}

export async function describeSuggestion(s) {
  const store = getStore();
  const fields = (payload: Record<string, unknown>, current?: Record<string, unknown>) =>
    Object.entries(payload)
      .filter(([k]) => !['itemId', 'initiativeId'].includes(k))
      .map(([k, v]) => current && current[k] !== undefined ? `${k} ${current[k]} → ${v}` : `${k}: ${v}`)
      .join(', ');
  switch (s.kind) {
    case 'create_item': return `Add item "${s.payload.title}" (${s.payload.startDate} → ${s.payload.endDate})`;
    case 'update_item': {
      const item = s.targetId ? await store.getItem(s.targetId) : null;
      return item ? `Update "${item.title}": ${fields(s.payload, item as any)}` : `Update deleted item: ${fields(s.payload)}`;
    }
    case 'delete_item': {
      const item = s.targetId ? await store.getItem(s.targetId) : null;
      return `Delete item "${item?.title ?? '(already deleted)'}"`;
    }
    case 'create_sprint': {
      const item = await store.getItem(String(s.payload.itemId ?? ''));
      return `Add sprint "${s.payload.name}" under "${item?.title ?? '?'}" (${s.payload.startDate} → ${s.payload.endDate})`;
    }
    case 'update_sprint': {
      const sprint = s.targetId ? await store.getSprint(s.targetId) : null;
      return sprint ? `Update sprint "${sprint.name}": ${fields(s.payload, sprint as any)}` : 'Update deleted sprint';
    }
    case 'comment': return String(s.payload.text ?? s.rationale);
  }
}
```

- [ ] **Step 4: Run → PASS. `npx tsc --noEmit` clean. Commit** — `git commit -m "feat(agent-links): suggestion validate/apply/describe engine"`

---

### Task 5: Agent API catch-all — manifest, roadmap read, suggestions, editor writes

**Files:**
- Create: `app/src/app/agent/[token]/api/[[...path]]/route.ts`
- Test: `app/tests/api/agent-links.test.ts` (new describe blocks)

**Interfaces:**
- Consumes: `authorizeAgent` (Task 3), suggestion engine (Task 4), `executeAgentTool`, `roadmapSnapshot`-style store reads, `MAX_PENDING_SUGGESTIONS`.
- Produces route handlers `GET/POST/PATCH/DELETE(req, { params: { token: string; path?: string[] } })`. Endpoint map (path segments after `/agent/<token>/api`):

| Method + path | Tier | Behavior |
|---|---|---|
| GET `[]` | read | capability manifest |
| GET `['roadmap']` | read | `{ roadmap, initiatives, items (with sprints), team }` |
| GET `['suggestions']` | suggest | own suggestions (`listSuggestionsByLink`) |
| POST `['suggestions']` | suggest | file suggestion (validate first; enforce pending cap) |
| POST `['initiatives']` | write | `executeAgentTool('create_initiative')` |
| POST `['items']` | write | `executeAgentTool('create_item')` |
| PATCH `['items', id]` | write | `executeAgentTool('update_item', {...body, itemId: id})` |
| DELETE `['items', id]` | write | ownership check then `deleteItem` |
| POST `['items', id, 'sprints']` | write | `executeAgentTool('create_sprint', {...body, itemId: id})` |
| PATCH `['sprints', id]` | write | `executeAgentTool('update_sprint', {...body, sprintId: id})` |
| DELETE `['sprints', id]` | write | ownership check then `deleteSprint` |
| anything else | — | 404 |

Every successful call logs activity: reads → `action: 'read', detail: { path }`; suggestion filing → `'suggest', detail: { suggestionId, kind }`; writes → `'edit', detail: { tool, summary }`. Never the token.

- [ ] **Step 1: Failing tests** (drive the whole surface):

```ts
// Helper at top of file, near reqAs:
import * as agentApi from '@/app/agent/[token]/api/[[...path]]/route';

function agentReq(method: string, body?: unknown, accept = 'application/json') {
  return new Request('http://test.local/agent/x/api', {
    method,
    headers: {
      accept,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const call = (fn: any, token: string, path: string[] | undefined, req: Request) =>
  fn(req, { params: { token, path } });

describe('agent API', () => {
  let store: MemoryStore;
  beforeEach(() => { store = freshStore(); resetRateLimits(); });

  it('manifest is role-filtered', async () => {
    const { roadmap } = await seedRoadmap(store);
    const viewer = await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tv');
    const sugg = await store.createAgentLink(roadmap.id, 'S', 'agent_suggester', 'ts');
    const editor = await store.createAgentLink(roadmap.id, 'E', 'agent_editor', 'te');

    const vm = await json(await call(agentApi.GET, 'tv', undefined, agentReq('GET')));
    expect(vm.agent).toEqual({ name: 'V', role: 'agent_viewer' });
    expect(vm.capabilities.read_roadmap).toBeDefined();
    expect(vm.capabilities.create_suggestion).toBeUndefined();

    const sm = await json(await call(agentApi.GET, 'ts', undefined, agentReq('GET')));
    expect(sm.capabilities.create_suggestion).toBeDefined();
    expect(sm.capabilities.update_item).toBeUndefined();

    const em = await json(await call(agentApi.GET, 'te', undefined, agentReq('GET')));
    expect(em.capabilities.update_item).toBeDefined();
    expect(em.instructions).toContain('roadmap');
  });

  it('unknown/revoked token → 404; unknown path → 404', async () => {
    const { roadmap } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tok');
    expect((await call(agentApi.GET, 'nope', undefined, agentReq('GET'))).status).toBe(404);
    expect((await call(agentApi.GET, 'tok', ['bogus'], agentReq('GET'))).status).toBe(404);
    await store.revokeAgentLink(link.id);
    expect((await call(agentApi.GET, 'tok', undefined, agentReq('GET'))).status).toBe(404);
  });

  it('GET roadmap returns full payload and logs activity', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tok');
    const body = await json(await call(agentApi.GET, 'tok', ['roadmap'], agentReq('GET')));
    expect(body.roadmap.title).toBe(roadmap.title);
    expect(body.items[0].id).toBe(item.id);
    expect(body.items[0].sprints).toHaveLength(1);
    const acts = await store.listAgentActivity(link.id, 10);
    expect(acts[0].action).toBe('read');
    expect(JSON.stringify(acts)).not.toContain('tok');
  });

  it('files a valid suggestion; rejects malformed at filing; enforces pending cap', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'S', 'agent_suggester', 'ts');

    const ok = await call(agentApi.POST, 'ts', ['suggestions'],
      agentReq('POST', { kind: 'update_item', target_id: item.id, payload: { endDate: '2026-10-01' }, rationale: 'push out' }));
    expect(ok.status).toBe(201);
    expect((await store.getItem(item.id))!.endDate).toBe('2026-09-15'); // unchanged until accepted

    const bad = await call(agentApi.POST, 'ts', ['suggestions'],
      agentReq('POST', { kind: 'update_item', target_id: item.id, payload: { endDate: '2027-06-01' }, rationale: 'x' }));
    expect(bad.status).toBe(400);
    const noRationale = await call(agentApi.POST, 'ts', ['suggestions'],
      agentReq('POST', { kind: 'comment', payload: {} }));
    expect(noRationale.status).toBe(400);

    for (let i = 0; i < 19; i++) {
      await store.createSuggestion({ roadmapId: roadmap.id, agentLinkId: link.id, kind: 'comment', targetId: null, payload: {}, rationale: 'r' });
    }
    const capped = await call(agentApi.POST, 'ts', ['suggestions'],
      agentReq('POST', { kind: 'comment', payload: {}, rationale: 'r' }));
    expect(capped.status).toBe(429);
  });

  it('suggester cannot use editor write routes; viewer cannot suggest', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    await store.createAgentLink(roadmap.id, 'S', 'agent_suggester', 'ts');
    await store.createAgentLink(roadmap.id, 'V', 'agent_viewer', 'tv');
    expect((await call(agentApi.PATCH, 'ts', ['items', item.id], agentReq('PATCH', { endDate: '2026-10-01' }))).status).toBe(403);
    expect((await call(agentApi.GET, 'tv', ['suggestions'], agentReq('GET'))).status).toBe(403);
  });

  it('editor direct writes have human-route parity (validation + effect)', async () => {
    const { roadmap, initiative, item, sprint } = await seedRoadmap(store);
    await store.createAgentLink(roadmap.id, 'E', 'agent_editor', 'te');

    const upd = await call(agentApi.PATCH, 'te', ['items', item.id], agentReq('PATCH', { endDate: '2026-10-01' }));
    expect(upd.status).toBe(200);
    expect((await store.getItem(item.id))!.endDate).toBe('2026-10-01');

    const invalid = await call(agentApi.PATCH, 'te', ['items', item.id], agentReq('PATCH', { endDate: '2027-06-01' }));
    expect(invalid.status).toBe(400);

    const created = await call(agentApi.POST, 'te', ['items'],
      agentReq('POST', { initiativeId: initiative.id, title: 'Agent item', startDate: '2026-11-01', endDate: '2026-11-20' }));
    expect(created.status).toBe(201);

    const sprintUpd = await call(agentApi.PATCH, 'te', ['sprints', sprint.id], agentReq('PATCH', { name: 'Renamed' }));
    expect(sprintUpd.status).toBe(200);

    const del = await call(agentApi.DELETE, 'te', ['sprints', sprint.id], agentReq('DELETE'));
    expect(del.status).toBe(200);
    expect(await store.getSprint(sprint.id)).toBeNull();

    const delItem = await call(agentApi.DELETE, 'te', ['items', item.id], agentReq('DELETE'));
    expect(delItem.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement the route.** Skeleton:

```ts
import { NextResponse } from 'next/server';
import { authorizeAgent, jsonError, readJson, type AuthedAgent } from '@/lib/api-helpers';
import { MAX_PENDING_SUGGESTIONS } from '@/lib/agent-links/rate-limit';
import { SUGGESTION_KINDS, validateSuggestion } from '@/lib/agent-links/suggestions';
import { executeAgentTool } from '@/lib/agent/tools';
import { getStore } from '@/lib/store';
import type { AgentRole, SuggestionKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Params { params: { token: string; path?: string[] } }

const TIER_FOR: Record<string, 'read' | 'suggest' | 'write'> = { /* per endpoint below */ };

function manifest(origin: string, token: string, auth: AuthedAgent) { /* build per role — see spec §Agent API surface; base = `${origin}/agent/${token}/api`; include rate_limit: { requests_per_minute: 60, max_pending_suggestions: 20 }; instructions string tells the agent to fetch read_roadmap first, file suggestions with rationale (suggester) or use write endpoints (editor). */ }

async function fullRoadmap(auth: AuthedAgent) {
  const store = getStore();
  const [initiatives, items, team] = await Promise.all([
    store.listInitiatives(auth.roadmap.id),
    store.listItems(auth.roadmap.id),
    store.listTeamMembers(auth.roadmap.id),
  ]);
  const withSprints = await Promise.all(items.map(async (i) => ({ ...i, sprints: await store.listSprints(i.id) })));
  return { roadmap: auth.roadmap, initiatives, items: withSprints, team: team.map((m) => ({ name: m.name })) };
}

async function handle(req: Request, { params }: Params): Promise<Response> {
  const path = params.path ?? [];
  const method = req.method;
  const key = `${method} ${path[0] ?? ''}`;   // dispatch on method + first segment
  // 1) resolve required tier for the (method, path) shape; unknown → authorize 'read' then 404
  // 2) const auth = await authorizeAgent(params.token, tier); if (auth instanceof NextResponse) return auth;
  // 3) dispatch; log activity on success
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
```

Dispatch specifics:
- **Manifest** (`GET`, path empty): `NextResponse.json(manifest(new URL(req.url).origin, params.token, auth))`; log `read/{path:'manifest'}`. Capability sets: viewer `read_roadmap`; suggester + `create_suggestion` (with `body_schema: { kind: SUGGESTION_KINDS, target_id: 'uuid|null', payload: 'object — same shape as the human PATCH/POST bodies', rationale: 'string (required)' }`) and `list_suggestions`; editor + `create_initiative`, `create_item`, `update_item`, `delete_item`, `create_sprint`, `update_sprint`, `delete_sprint` entries with method+url each.
- **POST suggestions**: body must parse; `kind` ∈ SUGGESTION_KINDS else 400; `rationale` non-empty string else 400 (`'rationale is required — explain why'`); `payload` object default `{}`; `target_id` string or null. Cap: `if (await store.countPendingSuggestions(auth.link.id) >= MAX_PENDING_SUGGESTIONS) return jsonError(429, 'Too many pending suggestions — wait for the owner to review')`. Then `const invalid = await validateSuggestion(auth.roadmap, kind, targetId, payload); if (invalid) return jsonError(400, invalid);` then create, log `suggest`, return 201 `{ suggestion }`.
- **GET suggestions**: `{ suggestions: await store.listSuggestionsByLink(auth.link.id) }` — agent sees statuses/outcomes; log `read`.
- **Editor writes**: map to `executeAgentTool`; `out.isError` → 400 with `out.result`; else 200/201 with `JSON.parse(out.result)` wrapped (`{ item: ... }` etc. not required — return `{ ok: true, result: JSON.parse(out.result) }`); log `edit/{tool, summary: out.action?.summary}`. Deletes: fetch target, check `roadmapId === auth.roadmap.id` (sprints via parent item), 404 if not, delete, log.

- [ ] **Step 4: Run → PASS.** Also run the full suite `npx vitest run` to catch regressions.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-links): agent API catch-all — manifest, reads, suggestions, editor writes"`

---

### Task 6: Human management + review endpoints

**Files:**
- Create: `app/src/app/api/roadmaps/[id]/agent-links/route.ts`, `app/src/app/api/agent-links/[id]/route.ts`, `app/src/app/api/roadmaps/[id]/suggestions/route.ts`, `app/src/app/api/suggestions/[id]/resolve/route.ts`
- Test: `app/tests/api/agent-links.test.ts` (new describe block)

**Interfaces produced (client contracts the UI tasks consume):**
- `GET /api/roadmaps/[id]/agent-links` (owner) → `{ links: Array<AgentLink & { activity: AgentActivityEntry[] }> }` (last 5 activity entries each; token included — the owner needs the URL).
- `POST /api/roadmaps/[id]/agent-links` (owner) body `{ name: string; role?: AgentRole }` (default `agent_suggester`) → 201 `{ link: AgentLink }`. 400 on empty name or bad role.
- `DELETE /api/agent-links/[id]` (owner of the link's roadmap) → `{ ok: true }` (soft revoke).
- `GET /api/roadmaps/[id]/suggestions` (write tier) → `{ suggestions: Array<Suggestion & { agentName: string; summary: string }> }` (`describeSuggestion` + link name joined in).
- `POST /api/suggestions/[id]/resolve` (write tier on the suggestion's roadmap) body `{ action: 'accept' | 'reject' }` → `{ suggestion, applied: boolean, reason?: string }`. Accept path: `applySuggestion`; on `ok` → `resolveSuggestion(id,'accepted', identity.uid)`; on failure → `resolveSuggestion(id,'rejected','system')` and `applied: false` with `reason` (200, not 5xx — graceful per spec). Already-resolved → 409.

- [ ] **Step 1: Failing tests**

```ts
import * as linksRoute from '@/app/api/roadmaps/[id]/agent-links/route';
import * as linkRoute from '@/app/api/agent-links/[id]/route';
import * as suggListRoute from '@/app/api/roadmaps/[id]/suggestions/route';
import * as resolveRoute from '@/app/api/suggestions/[id]/resolve/route';

describe('agent-link management + suggestion review', () => {
  let store: MemoryStore;
  beforeEach(() => { store = freshStore(); resetRateLimits(); });

  it('owner creates (suggester default), lists, revokes; non-owner 403', async () => {
    const { roadmap } = await seedRoadmap(store);
    const created = await linksRoute.POST(reqAs(OWNER, 'POST', { name: 'Hermes PM bot' }), { params: { id: roadmap.id } });
    expect(created.status).toBe(201);
    const { link } = await json(created);
    expect(link.role).toBe('agent_suggester');
    expect(link.token).toBeTruthy();

    expect((await linksRoute.POST(reqAs(EDITOR, 'POST', { name: 'X' }), { params: { id: roadmap.id } })).status).toBe(403);
    expect((await linksRoute.POST(reqAs(OWNER, 'POST', { name: '' }), { params: { id: roadmap.id } })).status).toBe(400);
    expect((await linksRoute.POST(reqAs(OWNER, 'POST', { name: 'X', role: 'agent_god' }), { params: { id: roadmap.id } })).status).toBe(400);

    const listed = await json(await linksRoute.GET(reqAs(OWNER), { params: { id: roadmap.id } }));
    expect(listed.links).toHaveLength(1);
    expect(listed.links[0].activity).toEqual([]);

    expect((await linkRoute.DELETE(reqAs(VIEWER, 'DELETE'), { params: { id: link.id } })).status).toBe(403);
    expect((await linkRoute.DELETE(reqAs(OWNER, 'DELETE'), { params: { id: link.id } })).status).toBe(200);
    expect((await store.getAgentLink(link.id))!.revokedAt).not.toBeNull();
  });

  it('suggest → accept mutates; reject leaves untouched; write tier enforced', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_suggester', 'tk');
    const s1 = await store.createSuggestion({ roadmapId: roadmap.id, agentLinkId: link.id, kind: 'update_item', targetId: item.id, payload: { endDate: '2026-10-01' }, rationale: 'r' });
    const s2 = await store.createSuggestion({ roadmapId: roadmap.id, agentLinkId: link.id, kind: 'delete_item', targetId: item.id, payload: {}, rationale: 'r' });

    const list = await json(await suggListRoute.GET(reqAs(EDITOR), { params: { id: roadmap.id } }));
    expect(list.suggestions).toHaveLength(2);
    expect(list.suggestions.map((s: any) => s.agentName)).toEqual(['Bot', 'Bot']);
    expect((await suggListRoute.GET(reqAs(VIEWER), { params: { id: roadmap.id } })).status).toBe(403);

    const acc = await json(await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'accept' }), { params: { id: s1.id } }));
    expect(acc.applied).toBe(true);
    expect((await store.getItem(item.id))!.endDate).toBe('2026-10-01');

    const rej = await json(await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'reject' }), { params: { id: s2.id } }));
    expect(rej.suggestion.status).toBe('rejected');
    expect(await store.getItem(item.id)).not.toBeNull();

    expect((await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'accept' }), { params: { id: s1.id } })).status).toBe(409);
    expect((await resolveRoute.POST(reqAs(VIEWER, 'POST', { action: 'accept' }), { params: { id: s2.id } })).status).toBe(403);
  });

  it('accept after target deleted → rejected by system, applied false', async () => {
    const { roadmap, item } = await seedRoadmap(store);
    const link = await store.createAgentLink(roadmap.id, 'Bot', 'agent_suggester', 'tk2');
    const s = await store.createSuggestion({ roadmapId: roadmap.id, agentLinkId: link.id, kind: 'update_item', targetId: item.id, payload: { endDate: '2026-10-01' }, rationale: 'r' });
    await store.deleteItem(item.id);
    const res = await json(await resolveRoute.POST(reqAs(OWNER, 'POST', { action: 'accept' }), { params: { id: s.id } }));
    expect(res.applied).toBe(false);
    expect(res.suggestion.status).toBe('rejected');
    expect(res.suggestion.resolvedBy).toBe('system');
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement the four routes** following the invite-route house style (`authorizeRoadmap(req, id, 'owner')` for link management; `'write'` for suggestions list/resolve; resolve route looks up the suggestion first, 404 when missing, then authorizes against `suggestion.roadmapId`; token via `randomBytes(18).toString('base64url')`; role validation against `['agent_viewer','agent_suggester','agent_editor']`).
- [ ] **Step 4: Run → PASS. Full suite green. Commit** — `git commit -m "feat(agent-links): owner management + suggestion review endpoints"`

---

### Task 7: Middleware content negotiation + browser view

**Files:**
- Create: `app/src/middleware.ts`, `app/src/app/agent/[token]/page.tsx`, `app/src/components/AgentLinkView.tsx`
- Modify: the global stylesheet (locate: `grep -rl "share-row" app/src/app`) — add `.agent-banner`, `.ghost-bar` styles
- Test: e2e covers this (Task 9); build check here.

- [ ] **Step 1: Middleware** — JSON `Accept` on the bare token URL serves the manifest (spec: agents may fetch the plain URL):

```ts
import { NextResponse, type NextRequest } from 'next/server';

/** /agent/<token> is both a human page and an agent endpoint: JSON accepts
 *  are rewritten to the manifest route so `fetch(url)` works with no docs. */
export function middleware(req: NextRequest) {
  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return NextResponse.rewrite(new URL(`${req.nextUrl.pathname}/api`, req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: '/agent/:token' };
```

(The `!accept.includes('text/html')` guard keeps browsers — which send both — on the page.)

- [ ] **Step 2: Page + view.** `page.tsx` mirrors `roadmaps/[id]/page.tsx` (default export renders `<AgentLinkView token={params.token} />`, `dynamic = 'force-dynamic'`). `AgentLinkView` is a client component that:
  - fetches `/agent/${token}/api` (manifest → agent name/role for the banner) and `/agent/${token}/api/roadmap`;
  - 404 → "This link is no longer active" empty state (`EmptyState` from `@pl/components/EmptyState`);
  - renders banner `data-testid="agent-banner"`: `Shared with "<name>" — <viewer|suggest|edit> access` (map role: agent_viewer→viewer, agent_suggester→suggest, agent_editor→edit);
  - renders a **read-only grid**: month columns via `monthColumns(roadmap.startMonth, roadmap.endMonth)`, one row per initiative, bars positioned with `dayOffsetInSpan`/`rangeTotalDays` percentages, colored with `itemColor(item.colorIndex)`, `data-testid="agent-item-bar"`. No drag handlers, no buttons, no login. Keep it ~150 lines — this is a viewer, not RoadmapView.
- [ ] **Step 3: Styles** — add to the located stylesheet:

```css
.agent-banner {
  display: flex; align-items: center; gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--background-brand-subtle, var(--background-neutral-subtle));
  border-bottom: 1px solid var(--border-neutral-subtle);
}
.ghost-bar {
  background: transparent !important;
  border: 2px dashed var(--border-neutral-strong);
  opacity: 0.8;
}
```

(Token names must be checked against `pl-design-system/tokens/` — use the closest existing background/border tokens actually defined there; never hardcode hex.)

- [ ] **Step 4: `cd app && npm run build`** → compiles. Commit — `git commit -m "feat(agent-links): browser view + JSON content negotiation middleware"`

---

### Task 8: SharePanel "AI agents" section

**Files:**
- Modify: `app/src/components/SharePanel.tsx`
- Test: e2e (Task 9); build check here.

- [ ] **Step 1: Add an `AgentLinksSection`** rendered at the bottom of the drawer body (SharePanel is only reachable by owners — the share button is owner-gated — but the API enforces owner anyway). Behavior, following `InviteLinkSection` conventions:
  - On drawer open, also fetch `api<{ links: AgentLinkWithActivity[] }>(`/api/roadmaps/${roadmapId}/agent-links`)` in the existing `Promise.all`.
  - Section header `AI agents`, blurb: "Give an AI agent a link to review this roadmap or propose changes. Suggestions wait for your approval."
  - Create form: name text input (`data-testid="agent-link-name"`), role `<select data-testid="agent-link-role">` with options Viewer/Suggester/Editor (default Suggester, labels: "View only" / "Suggest changes (you approve)" / "Edit directly"), create button `data-testid="agent-link-create"` → POST, prepend to list, toast success.
  - Per-link row `data-testid="agent-link-row"`: name, role label, copy URL button (`data-testid="agent-link-copy"`, URL = `${window.location.origin}/agent/${link.token}`), last used (`lastUsedAt` formatted with `formatDate` from `@/lib/dates`, or "never used"), revoke button `data-testid="agent-link-revoke"` → DELETE `/api/agent-links/${link.id}`, row gets struck/removed, toast "Link revoked — the agent can no longer access this roadmap".
  - Recent activity: collapsed `<details>` per row listing `link.activity` entries (`action` + `createdAt` formatted).
- [ ] **Step 2: Build clean; commit** — `git commit -m "feat(agent-links): AI agents section in the share panel"`

---

### Task 9: Suggestions review panel, badge, ghost bars

**Files:**
- Create: `app/src/components/SuggestionsPanel.tsx`
- Modify: `app/src/components/RoadmapView.tsx`
- Test: e2e (Task 10); build check here.

- [ ] **Step 1: RoadmapView wiring.** In `load()`, when `res.role` is `owner` or `editor`, best-effort fetch `api<{ suggestions: SuggestionWithMeta[] }>(`/api/roadmaps/${roadmapId}/suggestions`)` into new state `suggestions` (same pattern as the team fetch). `SuggestionWithMeta = Suggestion & { agentName: string; summary: string }`. Pending = `suggestions.filter(s => s.status === 'pending')`.
- [ ] **Step 2: Header badge.** Next to the share button, when `pending.length > 0`: `<Button variant="secondary" styleType="light" data-testid="suggestions-badge" onClick={() => setSuggestionsOpen(true)}>{pending.length} suggestion{pending.length === 1 ? '' : 's'}</Button>`.
- [ ] **Step 3: `SuggestionsPanel`** — Drawer (same shell as SharePanel), `data-testid="suggestions-panel"`. Per pending suggestion a card `data-testid="suggestion-card"`: agent name, kind chip, `summary`, rationale, Accept (`data-testid="suggestion-accept"`, primary) / Reject (`data-testid="suggestion-reject"`, neutral). Buttons POST `/api/suggestions/${s.id}/resolve` `{action}`; on success remove the card, toast (`applied === false` → warning toast with `reason`, else success "Suggestion applied"), and call an `onChanged` prop so RoadmapView re-`load()`s (bars update).
- [ ] **Step 4: Ghost bars (spec addition).** Pending suggestions render as unfilled dotted bars:
  - `create_item` with a valid `initiativeId`/dates in `payload`: ghost bar in that initiative's row, positioned by payload dates, extra lane appended below the initiative's real lanes (do not feed ghosts into `assignLanes` — compute `ghostLane = laneCount` so they never collide with real bars), `className="bar ghost-bar" data-testid="ghost-bar"`, label = payload title, tooltip = rationale.
  - `update_item` with date changes: ghost bar at the **proposed** dates in the item's initiative row (same extra-lane rule), label = item title.
  - Sprint-kind suggestions do not render on the main grid (they belong to the drill-down; keeping v1 scope to the roadmap view — note this in the code comment).
  - Clicking a ghost bar opens the suggestions panel.
- [ ] **Step 5: Build clean; run full vitest suite. Commit** — `git commit -m "feat(agent-links): suggestions badge, review panel, ghost bars"`

---

### Task 10: End-to-end test

**Files:**
- Create: `app/tests/e2e/agent-links.spec.ts`

- [ ] **Step 1: Write the spec** (house style per `sharing.spec.ts`):

```ts
import { expect, test } from '@playwright/test';
import { loginAs, makeUser, seedItem, seedRoadmap } from './helpers';

test.describe('Agent links: create → agent suggests → owner accepts', () => {
  test('full loop updates the bar', async ({ page, context, request }) => {
    const owner = makeUser('owner');
    await loginAs(context, owner);
    const seeded = await seedRoadmap(request, owner);
    await seedItem(request, owner, seeded, { title: 'API beta', endDate: '2026-09-15' });

    // owner creates a suggester link in the share panel
    await page.goto(`/roadmaps/${seeded.roadmapId}`);
    await page.getByTestId('share-button').click();
    await page.getByTestId('agent-link-name').fill('Hermes PM bot');
    await page.getByTestId('agent-link-create').click();
    await expect(page.getByTestId('agent-link-row')).toContainText('Hermes PM bot');

    // extract the token from the row's copy URL (expose it via data attribute or row text)
    const agentUrl = await page.getByTestId('agent-link-url').textContent();
    const token = agentUrl!.trim().split('/agent/')[1];
    await page.keyboard.press('Escape');

    // agent: manifest advertises suggestion capability; JSON accept on bare URL works
    const manifest = await request.get(`/agent/${token}`, { headers: { accept: 'application/json' } });
    expect(manifest.status()).toBe(200);
    const caps = (await manifest.json()).capabilities;
    expect(caps.create_suggestion).toBeTruthy();

    // agent reads the roadmap and files a suggestion
    const roadmap = await (await request.get(`/agent/${token}/api/roadmap`)).json();
    const item = roadmap.items.find((i: any) => i.title === 'API beta');
    const filed = await request.post(`/agent/${token}/api/suggestions`, {
      data: { kind: 'update_item', target_id: item.id, payload: { endDate: '2026-10-01' }, rationale: 'Backend slips a sprint' },
    });
    expect(filed.status()).toBe(201);

    // owner sees the badge, reviews, accepts
    await page.reload();
    await expect(page.getByTestId('suggestions-badge')).toContainText('1 suggestion');
    await expect(page.getByTestId('ghost-bar')).toBeVisible();
    await page.getByTestId('suggestions-badge').click();
    await expect(page.getByTestId('suggestion-card')).toContainText('Hermes PM bot');
    await expect(page.getByTestId('suggestion-card')).toContainText('Backend slips a sprint');
    await page.getByTestId('suggestion-accept').click();
    await expect(page.getByTestId('suggestion-card')).toHaveCount(0);

    // the change landed; agent sees the outcome; ghost gone
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ghost-bar')).toHaveCount(0);
    const after = await (await request.get(`/agent/${token}/api/roadmap`)).json();
    expect(after.items.find((i: any) => i.id === item.id).endDate).toBe('2026-10-01');
    const mine = await (await request.get(`/agent/${token}/api/suggestions`)).json();
    expect(mine.suggestions[0].status).toBe('accepted');

    // browser view renders read-only with banner
    const anonContext = await page.context().browser()!.newContext();
    const ap = await anonContext.newPage();
    await ap.goto(`/agent/${token}`);
    await expect(ap.getByTestId('agent-banner')).toContainText('Hermes PM bot');
    await expect(ap.getByTestId('agent-item-bar')).toHaveCount(2);
    await anonContext.close();

    // revoke → agent 404s, browser shows inactive state
    await page.getByTestId('share-button').click();
    await page.getByTestId('agent-link-revoke').click();
    expect((await request.get(`/agent/${token}/api`)).status()).toBe(404);
  });
});
```

(Adds `data-testid="agent-link-url"` to the SharePanel row — fold into Task 8 if not already present.)

- [ ] **Step 2: Run** — `cd app && npx playwright test tests/e2e/agent-links.spec.ts` → PASS (fix whatever it flushes out; ghost-bar count/visibility assertions are the likely iteration point).
- [ ] **Step 3: Full suite** — `npx vitest run && npx playwright test` → all green.
- [ ] **Step 4: Commit** — `git commit -m "test(agent-links): end-to-end suggest→accept loop"`

---

### Task 11: Wrap-up

- [ ] Mark the spec **Status: Implemented (2026-08-11)**; commit the pending spec edit (dotted-border line) together with this.
- [ ] Update deploy notes/memory: next deploy must apply migrations **005 AND 006**.
- [ ] Run `npm run lint` (if configured) and `npm run build`; fix warnings introduced by this work.
- [ ] Final commit.

## Self-Review Notes

- Spec coverage: data model → T1; authorizeAgent/tiers/revocation → T3; rate limit → T2/T3; manifest + role filtering → T5; suggestions file/validate/cap → T4/T5; accept/reject/system-reject → T6; direct-write parity → T5; owner controls + activity → T6/T8; browser banner view → T7; badge/panel/diff → T9; ghost bars (spec addition) → T9; content negotiation → T7; testing section → T1–T10 map to the spec's unit/API/E2E lists.
- Deliberate scope call: sprint-kind ghosts on the drill-down view are **deferred** (noted in T9 step 4) — the spec line says "roadmap or sprint view"; roadmap-view ghosts satisfy v1. Flag in the final report.
- Types consistent: `AgentTier` (`read|suggest|write`) vs `AgentRole` (`agent_*`) kept distinct throughout; store method names identical in T1 interface and all consumers.
