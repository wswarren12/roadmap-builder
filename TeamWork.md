# TeamWork — Roadmapper

> Build log & single source of truth. Built in one Claude Code session (2026-07-22).

## Project Status

| Field | Value |
|-------|-------|
| PRD | PRD-Roadmapper-v1.md |
| Current Phase | 4 — Validation |
| Starter-kit reconciliation | **done** (see below) |
| Started / Last Updated | 2026-07-22 16:15 / 2026-07-22 17:05 |

## Starter-kit v1.4 reconciliation (PRD §11 Q1)

This repo **is** the ai-app-starter-kit v1.4 (identical structure to
`~/Desktop/ai-app-starter-kit-v1.4`). Findings:

- **Deploy contract:** `$PORT` / bind `0.0.0.0` / `GET /health` 200 / iframe-embeddable
  from `*.plnetwork.io` (no `X-Frame-Options`; CSP `frame-ancestors` set in
  `next.config.mjs`). Deploy via `deploy-to-labs` skill; secrets via the LabOS draft flow.
- **Framework preference (Q6):** the kit's `pl-design-system/USAGE.md` prescribes a
  **Next.js 14** app in `app/` consuming the copied `pl-design-system/` — used instead of
  the React+Vite recommendation.
- **LabOS token validation:** the only identity API is the member-context endpoint
  (`GET https://api-directory.plnetwork.io/v1/ai-apps/me` with `Authorization: Bearer
  <authToken cookie>`). The server resolves identity per-request (5-min in-memory cache),
  never logs/stores the token (`src/lib/auth.ts`).
- **⚠ Email gap (affects F-6/Q2):** the v1.4 member-context response **deliberately
  contains no email**. The PRD's whitelist matches against the LabOS-verified email, so in
  production the app uses `member.email` *if LabOS ever provides it* and otherwise treats
  the user as email-less (viewer matching can't grant access; the share panel copy and
  Profile explain this). Identity seam is one function — nothing else changes when LabOS
  adds email. Local dev/E2E use `DEV_AUTH=1` + a `dev_user` cookie with explicit emails.
- **Database:** Supabase (PostgreSQL) per explicit product decision. Repository interface
  with `SupabaseStore` (service-role key, server-only, selected when `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set — provided via the LabOS draft-secrets flow) and
  `MemoryStore` (local dev/tests). Migration: `app/supabase/migrations/001_init.sql`.
  Authorization is enforced in the API layer, not RLS (LabOS identities are not Supabase
  Auth users; PRD §9).

## Feature Progress

| Feature ID | Name | DB | API | UI | Tests | Integration | Status |
|-----------|------|----|-----|----|-------|-------------|--------|
| F-1 | Roadmap canvas & header | ✅ | ✅ | ✅ | ✅ | ✅ | Done |
| F-2 | Roadmap items | ✅ | ✅ | ✅ | ✅ | ✅ | Done |
| F-3 | Drill-down subcalendar | — | ✅ | ✅ | ✅ | ✅ | Done |
| F-4 | Sprint items & card | ✅ | ✅ | ✅ | ✅ | ✅ | Done |
| F-5 | LabOS auth & redirect | ✅ | ✅ | ✅ | ✅ | ✅ | Done |
| F-6 | Email-whitelist sharing | ✅ | ✅ | ✅ | ✅ | ✅ | Done |
| F-7 | Profile page | — | ✅ | ✅ | ✅ | ✅ | Done |
| F-8 | PDF export | — | — | ✅ | ✅ | ✅ | Done (vector jsPDF render) |
| F-9 | Today line / auto-scroll / confirms | — | — | ✅ | ✅ | ✅ | Done |

## Phase Gates

| Phase | Gate Check | Result | Timestamp |
|-------|-----------|--------|-----------|
| 1 Foundation | schema + failing tests | ✅ (migration + 114 Vitest tests) | 16:29 |
| 2 Core | `npm run test` (unit+api+components, auth matrix green) | ✅ 118/118 | 16:40 |
| 3 Integration | `npm run test:e2e` | ✅ 34/34 with `--retries=0` (fixed nav hydration bug + 3 test locators after first run: 30/34) | 17:15 |
| 4 Validation | coverage ≥80% + /health + $PORT + 0.0.0.0 + frame headers | ✅ Vitest 131/131, **93.2% line coverage**; `GET /health` 200; binds `*:$PORT`; CSP `frame-ancestors` correct, no `X-Frame-Options`; deploy not run (member decides when) | 17:20 |

## Activity Log

- 16:15 Read PRD, starter-kit docs, pl-design-system skill + component APIs.
- 16:20 Reconciliation recorded (v1.4 = this repo; Next.js 14; **member context has no email** → identity seam with null-email fallback).
- 16:25 Libs: dates (UTC math, Monday weeks, partial columns), stacking (greedy lanes), colors (10-palette + uniform sprint slate), validation. Store: Memory + Supabase + SQL migration.
- 16:28 API: all §9 endpoints as Next route handlers behind `authorizeRoadmap(read|write)`. Vitest: 114 tests incl. 62-case owner/viewer/stranger/anonymous matrix — green.
- 16:40 Frontend: canvas, bars (drag move/resize, 4px click threshold, optimistic + revert), subcalendar, sprint card (Drawer), share panel, profile, jsPDF vector export, today line + auto-scroll + confirm modals, `prefers-reduced-motion`. Build clean.
- 16:55 E2E first run: 30/34. Fixes: (1) nested `<a>` in NavBar logo caused hydration failures — pass content + `logoHref` instead of a `Link`; (2) strict-mode locator in auth spec; (3) share-input testid locator (testid lands on the `<input>` itself).
- 17:05 Caught a stale probe server on the E2E port (`reuseExistingServer` adopted it → suite ran against the old build). Killed it; clean rerun.
- 17:15 E2E 34/34 with no retries. Coverage pass: excluded browser-only modules (E2E-covered) from V8 scope, added auth.ts (LabOS path, mocked fetch) + health unit tests → 131 tests, 93.2% lines.
- 17:20 Deploy contract verified live: /health 200, `*:$PORT` binding, frame-ancestors CSP, no X-Frame-Options. Lessons captured to wiki (hydration nesting, stale-server reuse).

## Post-v1 change: invite-link sharing (2026-07-23, approved by Bill)

The email whitelist couldn't grant access in production (no email in the v1.4
member context), so sharing switched to **invite links**: owner generates a
`/join/<token>` URL (one active token per roadmap, `roadmaps.invite_token`);
any LabOS-authenticated member opening it is bound as a read-only viewer by
verified uid+name (`roadmap_shares.member_uid/member_name`). Rotate/disable
never evicts already-joined viewers; each viewer is individually revocable.
Email path kept dormant in schema + API. Migration `002_invite_links.sql`.
Coverage after change: Vitest 141/141 (93.7% lines), E2E 34/34 no-retries —
incl. viewer-403 matrix extended with the invite endpoints.

## Blockers & Issues

| Issue | Reported By | Status | Resolution |
|-------|-----------|--------|------------|
| v1.4 member context exposes no email | reconciliation | Resolved (2026-07-23) | Sharing moved to uid-based invite links; email whitelist dormant until LabOS exposes email (PRD Q2) |

## Acceptance Criteria → Test Mapping

| AC | Test |
|----|------|
| AC-1.1–1.4 | tests/api/crud.test.ts, tests/e2e/roadmap.spec.ts |
| AC-2.1–2.6 | tests/unit/{stacking,colors,validate}.test.ts, tests/api/crud.test.ts, tests/e2e/items.spec.ts |
| AC-3.1–3.3 | tests/unit/dates.test.ts (weekColumns), tests/e2e/drilldown.spec.ts, items.spec.ts (drag ≠ click) |
| AC-4.1–4.5 | tests/api/crud.test.ts, tests/components/sprint-card.test.tsx, tests/e2e/sprints.spec.ts, sharing.spec.ts |
| AC-5.1–5.4 | tests/api/crud.test.ts (me/last-visited), tests/e2e/auth.spec.ts |
| AC-6.1–6.5 | tests/api/authz.test.ts (full matrix), tests/e2e/sharing.spec.ts |
| AC-7.1–7.3 | tests/api/crud.test.ts, tests/e2e/auth.spec.ts (profile section) |
| AC-8.1–8.3 | tests/unit/validate.test.ts (slugify), tests/e2e/pdf-polish.spec.ts (download assertions) |
| AC-9.1–9.3 | tests/unit/dates.test.ts (today math), tests/components/confirm-modal.test.tsx, tests/e2e/pdf-polish.spec.ts, items.spec.ts |
