# Roadmapper

Visual roadmap planning for PLN members. Two-level swimlane calendar: initiative
rows over months, drill into any bar for its weekly sprint subcalendar.

## Features

### Roadmap planning
- **Initiatives**: 1–8 horizontal swimlanes grouping related work
- **Items**: Bars spanning date ranges within initiatives, with status (green/yellow/red), DRIs, KPIs, milestones, and completion tracking
- **Sprints**: Weekly breakdown inside each item — click a bar to drill down
- **Color palettes**: Choose a palette at roadmap creation; completed items render in the palette's green
- **PDF export**: Export the roadmap or any sprint subcalendar

### Collaboration
- **Role-based invite links**: Share panel offers separate editor and viewer links — create, rotate, or disable each independently
- **Editors**: Can modify items, sprints, initiatives, and roadmap header
- **Viewers**: Read-only access
- **Team roster**: Add LabOS members or manual names; appears in DRI dropdowns with autocomplete

### AI assistance
- **Planning agent (F-14)**: Floating chat bubble for editors. Claude prioritizes with ICE/RICE, sequences dependencies in Now/Next/Later horizons, researches competitor gaps, and applies changes through validated tools (no deletes). System prompt: `src/lib/agent/agent.md`
- **Agent links**: Grant external AI agents scoped API access (viewer/suggester/editor tiers). Self-documenting manifest at `/agent/<token>`, rate-limited, with suggestion review workflow for non-editor agents

### Cross-roadmap sync (F-15b)
- **Import items**: Pull an item (with its sprints) from another roadmap as a linked copy
- **Synchronized edits**: Content changes propagate to all linked copies automatically
- **Requires write access on both roadmaps** (linking creates a permanent edit channel)

## Run locally

```bash
npm install
DEV_AUTH=1 npm run dev        # http://localhost:3000 as "Dev Owner"
```

- `DEV_AUTH=1`: Local identity shim — `dev_user` cookie carries `{uid, name, email}` (URL-encoded JSON); no cookie → default dev owner; `anonymous` → signed-out
- Without database credentials: in-memory store (data resets on restart)

## Database configuration

The app selects a store automatically:

| Priority | Env vars | Store |
|----------|----------|-------|
| 1 | `DATABASE_URL` | PLN-provisioned Postgres |
| 2 | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| 3 | Neither | In-memory (dev/test only) |

### Migrations

Apply in order:
- `db/migrations/` for raw Postgres (`DATABASE_URL`)
- `supabase/migrations/` for Supabase

Files: `0000_extensions.sql` through `010_legacy_palette_backfill.sql`

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | No | Postgres connection string (preferred) |
| `SUPABASE_URL` | No | Supabase project URL (fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase service-role key |
| `ANTHROPIC_API_KEY` | No | Powers planning agent; without it agent returns 503, rest of app works |
| `ANTHROPIC_MOCK` | No | Set to `1` for deterministic offline agent (dev/e2e) |
| `DEV_AUTH` | No | Set to `1` for local identity shim |
| `PGSSLROOTCERT` | No | Path to CA bundle for strict TLS verification |

## Tests

```bash
npm test              # Vitest: unit + API + components
npm run test:coverage # With V8 coverage (80% threshold)
npm run test:e2e      # Playwright (run npm run build first)
```

## Deploy contract

- `npm start` → `next start -p ${PORT:-3000} -H 0.0.0.0`
- `GET /health` → 200 (503 if no database configured outside dev)
- CSP: `frame-ancestors 'self' https://plnetwork.io https://*.plnetwork.io`
- No `X-Frame-Options` (allows LabOS iframe embedding)
- Docker: multi-stage `Dockerfile` at repo root

## API overview

### Human endpoints (cookie auth)
- `POST /api/roadmaps` — Create roadmap
- `GET/PATCH/DELETE /api/roadmaps/:id` — Roadmap CRUD
- `POST /api/roadmaps/:id/items` — Create item
- `POST /api/roadmaps/:id/items/import` — Import linked item from another roadmap
- `GET/PATCH/DELETE /api/items/:id` — Item CRUD
- `POST /api/items/:id/sprints` — Create sprint
- `GET/PATCH/DELETE /api/sprints/:id` — Sprint CRUD
- `POST /api/sprints/:id/promote` — Promote sprint to standalone item
- `POST /api/roadmaps/:id/initiatives` — Create initiative
- `POST /api/initiatives/:id/convert` — Convert initiative to item
- `POST /api/roadmaps/:id/agent` — Planning agent chat turn
- `POST /api/roadmaps/:id/invite` — Manage invite links
- `POST /api/join/:token` — Claim invite link
- `GET/POST /api/roadmaps/:id/shares` — List/revoke access grants
- `GET/POST /api/roadmaps/:id/team` — Team roster
- `GET/POST /api/roadmaps/:id/agent-links` — Manage agent links
- `GET/POST /api/roadmaps/:id/suggestions` — View/resolve agent suggestions

### Agent endpoints (token auth via `/agent/:token/api/...`)
- `GET /` — Capability manifest (self-documenting)
- `GET /roadmap` — Full roadmap state
- `GET/POST /suggestions` — List/create suggestions (suggester+)
- `POST /initiatives` — Create initiative (editor)
- `POST /items`, `PATCH/DELETE /items/:id` — Item CRUD (editor)
- `POST /items/:id/sprints`, `PATCH/DELETE /sprints/:id` — Sprint CRUD (editor)

Rate limit: 60 req/min per token; max 20 pending suggestions.

## Architecture notes

- **Authorization**: Enforced server-side in API layer (owner/editor/viewer/none per roadmap), not RLS
- **Identity**: LabOS `authToken` cookie → member-context endpoint; uid-based grants (email path dormant until LabOS exposes it)
- **Sync groups**: Items/sprints sharing a `sync_group_id` propagate content edits; placement (initiative, color) stays local
