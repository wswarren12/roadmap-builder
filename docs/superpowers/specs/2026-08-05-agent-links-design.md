# Agent Links — Permissioned AI-Agent Access to Roadmaps

**Date:** 2026-08-05
**Status:** Implemented (2026-08-11) — see `docs/superpowers/plans/2026-08-11-agent-links.md`

## Problem

Roadmap sharing today requires a signed-in LabOS member: invite tokens
(`/join/<token>`) are one-time *claim* tokens that convert into a
`roadmap_shares` row bound to a human `member_uid`. Third-party AI agents
(e.g. Hermes agents) have no LabOS identity, so there is no way to let an
agent review a roadmap, propose changes, or edit it.

## Goal

A roadmap owner can create a named, revocable **agent link** — a single
magic URL that:

- renders the roadmap read-only in a browser, and
- serves a self-documenting JSON API to any agent that fetches it —
  no docs, headers, or keys needed beyond the URL itself.

Per-link power is chosen at creation: **viewer** (read only),
**suggester** (read + file suggestions a human approves), or **editor**
(read + direct writes). v1 target workflows: agent review/reporting and
agent-proposed changes; direct edit ships because it is nearly free
(reuses existing write paths) but suggest is the default role.

Owner controls: per-link name, individual revocation, activity log,
rate limiting. No auto-expiry.

## Architecture

The token in the URL path is a **bearer capability** (like a Google Docs
share link), consistent with the existing `/join/<token>` pattern.
Everything lives under one namespace: `/agent/<token>`.

- Browser (`Accept: text/html`): read-only roadmap view with a banner
  ("Shared with *Hermes PM bot* — suggest access"). No login.
- Agent (`Accept: application/json` or `GET /agent/<token>/api`):
  capability manifest (below).
- All agent API calls: `/agent/<token>/api/...` — implemented as a
  contained catch-all route so every request is auth-checked against
  revocation and logged to `agent_activity`.

Authorization stays in the API layer (no RLS policies; service-role
Supabase as today). A new `authorizeAgent(token, required)` helper in
`app/src/lib/api-helpers.ts` sits alongside `authorizeRoadmap()`:
token → active `agent_links` row → roadmap; tier check
(read = any role, suggest = suggester|editor, write = editor);
bumps `last_used_at`; returns an agent principal. Human routes untouched.

## Data model (migration 006)

**`agent_links`** — one row per shared URL:

| column | notes |
|---|---|
| `id` UUID PK | |
| `roadmap_id` UUID FK → roadmaps, cascade delete | |
| `token` TEXT UNIQUE | `randomBytes(18).toString('base64url')`, same generator as invite links |
| `name` TEXT | e.g. "Hermes PM bot" — attribution everywhere |
| `role` TEXT CHECK | `'agent_viewer' \| 'agent_suggester' \| 'agent_editor'` |
| `created_at`, `last_used_at`, `revoked_at` | `revoked_at` null = active (soft revoke) |

**`suggestions`** — agent-proposed changes:

| column | notes |
|---|---|
| `id`, `roadmap_id`, `agent_link_id` FK | attribution |
| `kind` TEXT CHECK | `'create_item' \| 'update_item' \| 'delete_item' \| 'create_sprint' \| 'update_sprint' \| 'comment'` |
| `target_id` UUID nullable | item/sprint being modified (null for creates/comments) |
| `payload` JSONB | proposed values — **same shapes as existing PATCH/POST request bodies** |
| `rationale` TEXT | agent explains why; required for reviewability |
| `status` TEXT CHECK | `'pending' \| 'accepted' \| 'rejected'` |
| `resolved_by`, `resolved_at`, `created_at` | |

**`agent_activity`** — append-only log:
`id`, `agent_link_id`, `roadmap_id`, `action` (`'read' \| 'suggest' \| 'edit' \| ...`),
`detail` JSONB, `created_at`.

Reusing PATCH-body shapes for `payload` means "accept" replays a
validated body through existing store functions — no second write path.

## Agent API surface

`GET /agent/<token>/api` returns the capability manifest:

```json
{
  "app": "Roadmapper",
  "agent": { "name": "Hermes PM bot", "role": "agent_suggester" },
  "roadmap": { "id": "...", "title": "...", "months": ["..."] },
  "capabilities": {
    "read_roadmap":      { "method": "GET",  "url": ".../api/roadmap" },
    "create_suggestion": { "method": "POST", "url": ".../api/suggestions",
                           "description": "...", "body_schema": { } },
    "list_suggestions":  { "method": "GET",  "url": ".../api/suggestions" }
  },
  "instructions": "You are reviewing a product roadmap. Fetch read_roadmap first..."
}
```

Capabilities are filtered by role: viewer manifests omit suggestions;
editor manifests additionally list direct-write endpoints. The
`instructions` field is a short prompt so any LLM agent can operate from
the URL alone.

| Endpoint (under `/agent/<token>/`) | Role | Purpose |
|---|---|---|
| `GET api` | any | Capability manifest |
| `GET api/roadmap` | any | Full roadmap: initiatives, items, sprints, team — one agent-friendly payload |
| `GET api/suggestions` | suggester+ | Own suggestions + statuses (agent sees accept/reject outcomes) |
| `POST api/suggestions` | suggester+ | File suggestion: `kind`, `target_id`, `payload`, `rationale` |
| item/initiative/sprint write routes | editor | Direct writes, same validation as human routes |

## Suggestions review (human side)

- Roadmap header badge when pending suggestions exist ("3 suggestions").
- Suggestions on the roadmap show up on a roadmap or sprint view as items with no fill and dotted borders
- Panel: per card — agent name, kind, human-readable diff
  ("Move *API beta* end Jul 15 → Aug 1"), rationale, **Accept / Reject**.
- Accept applies payload via existing store functions; owner/editor only;
  records `resolved_by`/`resolved_at`. Reject just marks it.

## Owner controls (share dialog)

New "AI agents" section beside invite links, owner-only:
create link (name + role, suggest default), copy URL, per-link
`last_used_at` + recent activity, revoke.

Management endpoints (human-authed, owner tier):
`GET/POST /api/roadmaps/[id]/agent-links`,
`DELETE /api/agent-links/[id]` (sets `revoked_at`),
`GET /api/roadmaps/[id]/suggestions` + `POST /api/suggestions/[id]/resolve`
(write tier) for the review panel.

## Safety & error handling

- **Rate limiting:** in-memory per-token (single-container app):
  ~60 req/min; max ~20 pending suggestions per link. 429 with
  `retry_after`, documented in the manifest.
- **Revoked/unknown token → 404** (not 403) — does not confirm the
  roadmap exists.
- **Validate at filing time:** suggestion payloads run the same
  validation as the corresponding real endpoint; malformed suggestions
  are rejected immediately with a descriptive error so the agent can
  iterate while still in its loop. Accept re-validates; if the target was
  deleted in the meantime, accept fails gracefully and the suggestion is
  marked `rejected` with `resolved_by = 'system'`.
- Tokens never logged in `agent_activity.detail`; agent principals can
  never touch link management, shares, or roadmap deletion.

## Testing

Existing vitest + playwright setup:

- Unit: `authorizeAgent` role tiers, revocation, unknown token.
- API: manifest role-filtering; suggest → accept → roadmap changed;
  suggest → reject; validation failure at filing; rate limit 429;
  revoked-token 404; editor direct-write parity with human routes.
- E2E (playwright): owner creates link → agent (fetch) files
  suggestion → owner accepts in panel → bar updates.

## Out of scope (v1)

- Auto-expiry of links.
- MCP server surface (manifest could later advertise one).
- Suggestion threads/comments beyond the single `rationale`.
- Cross-roadmap agent access (links are per-roadmap, like invites).
