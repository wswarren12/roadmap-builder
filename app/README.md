# Roadmapper

Two-level swimlane roadmap app for PLN members: 1–5 initiative rows over months,
click a bar to drill into its weekly sprint subcalendar, click a sprint bar for a
full-detail card. Owner-editable, shareable read-only via email whitelist, PDF
export at both levels. Built per `../PRD-Roadmapper-v1.md` on the PLN AI App
Starter Kit v1.4 (Next.js 14 + pl-design-system).

## Run locally

```bash
npm install
DEV_AUTH=1 npm run dev        # http://localhost:3000 as "Dev Owner"
```

- `DEV_AUTH=1` enables the local identity shim: a `dev_user` cookie carries
  `{uid, name, email}` (URL-encoded JSON); no cookie → a default dev owner;
  the literal value `anonymous` → signed-out. Without `DEV_AUTH`, identity
  comes from the LabOS `authToken` cookie via the member-context endpoint.
- Without Supabase credentials the app uses an in-memory store (data resets on
  restart) — fine for local work and tests.

## Production configuration (via LabOS draft-secrets flow)

| Env var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only; never shipped to the client) |

Apply `supabase/migrations/001_init.sql` to the Supabase project once before
the first deploy. Authorization is enforced in the API layer (owner /
whitelisted-viewer / none per roadmap), not RLS — LabOS identities are not
Supabase Auth users.

**Sharing model:** viewers join via an **invite link** — the owner generates a
`/join/<token>` URL in the share panel; opening it while signed in to LabOS
binds the visitor's verified member uid as a read-only viewer (individually
revocable; rotating or disabling the link never removes already-joined
viewers). This is uid-based because the v1.4 member-context API returns no
email; the email-whitelist path remains in the schema and API, dormant until
LabOS exposes member email (`src/lib/auth.ts` picks it up automatically).
Migrations: apply `001_init.sql` then `002_invite_links.sql`.

## Tests

```bash
npm test              # Vitest: unit + API integration (incl. authorization matrix) + components
npm run test:coverage # with V8 coverage (threshold 80% lines)
npm run test:e2e      # Playwright (builds nothing — run `npm run build` first)
```

## Deploy contract

`npm start` → `next start -p ${PORT:-3000} -H 0.0.0.0`; `GET /health` → 200;
CSP `frame-ancestors 'self' https://plnetwork.io https://*.plnetwork.io`; no
`X-Frame-Options`. Docker: multi-stage `Dockerfile` at this directory root.
