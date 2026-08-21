# Kit migration: v1.8 → v1.9 (2026-08-21)

Adopted from `~/Desktop/ai-app-starter-kit-v1.9`:

- **Baseline analytics (the one functional change):** v1.9 makes
  `opened`/`error`/`closed` usage events mandatory in every app, like
  `/health`. Wired as `app/src/lib/client/analytics.ts` (kit snippet,
  endpoint inlined) + `app/src/components/Analytics.tsx` mounted once in
  the root layout. Fire-and-forget; no PII; a failure never affects the
  app. Custom events stay opt-in — none added. Unit-tested in
  `tests/unit/analytics.test.ts`.
- **Instructions:** root `AGENTS.md`, `CLAUDE.md`, `README.md` replaced
  with v1.9 (new analytics section; "PLN (or PL)" wording).
- **Skills:** new `app-analytics`; `deploy-to-labs` gains 409-Conflict
  guidance (appIds are global across members — informational for us, ours
  is claimed); wording updates in `app-logs`, `db-migration`,
  `pl-design-system`, `pln-member-context`. Our `supabase*` skills kept.
- **`pln-app.config.json`:** added `analyticsEndpoint`,
  `kitVersion: "1.9"`, notes updated; `appId`/`appUid`/`appName`/
  `appDescription`/`database` preserved.
- **`styles/` and root `pl-design-system/`:** identical to v1.8 — no change.
  The app continues to vendor the v1.4 design system per
  `kit-v1.8-migration.md`'s documented divergence.
