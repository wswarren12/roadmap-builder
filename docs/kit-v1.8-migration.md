# Kit migration: v1.4 → v1.8 (2026-08-15)

Adopted from `ai-app-starter-kit-v1.8.zip`:

- **Instructions:** root `CLAUDE.md`, `AGENTS.md`, `README.md`, `styles/`
  replaced with v1.8. Notable new sections: PLN-provisioned Postgres +
  db-migration flow, resource limits (runtime **384Mi / 300m CPU**, build
  2Gi / 1 CPU), build & runtime log debugging.
- **Skills:** `deploy-to-labs` and `pl-design-system` updated; new
  `app-logs` (fetch build/runtime logs with a deploy token) and
  `db-migration`. The `supabase*` skills are ours, not the kit's — kept.
- **`pln-app.config.json`:** v1.8 shape — adds `buildLogsEndpoint`,
  `runtimeLogsEndpoint`, `appSettingsUrl`, `database` — with our
  `appId`/`appUid`/`appName`/`appDescription` preserved and
  `kitVersion: "1.8"`. `database` stays `null`: our Supabase is a
  bring-your-own database delivered via runtime secrets, which per the kit
  notes never goes in that field.
- **Root `pl-design-system/`:** replaced with the v1.8 system (flat
  single-file components, Tailwind v4 semantic tokens).

## Deliberate divergence: the app vendors the v1.4 design system

`app/pl-design-system/` (what actually ships and what `@pl/*` resolves to)
remains the **v1.4** copy. The v1.8 design system is a structural rewrite
(`components/Button.tsx` vs v1.4's `components/Button/` folders, Tailwind
utilities vs SCSS modules) — swapping it would mean rewriting every UI
component import and style in a working, fully-tested app for zero
functional gain. The deploy contract does not care which version ships.

**Rule for future UI work:** inside `app/`, keep following the vendored
v1.4 patterns (`@pl/components/X`, `var(--token)` CSS custom properties).
The root v1.8 copy is the kit's reference only. If a full design-system
upgrade is ever wanted, treat it as its own project with visual regression
testing.
