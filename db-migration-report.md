# Database migration report — Roadmapper → PLN Postgres (2026-08-15)

## What was detected
- Source: **Supabase** (Postgres + PostgREST), accessed via `@supabase/supabase-js`
  with the service-role key. Authorization enforced in the app's API layer,
  not in the database.
- 8 real migration files (`app/supabase/migrations/001–008`), plus prod's
  migration ledger — schema copied from a source of truth, not reconstructed.
- 10 tables; all primary keys are UUIDs (no sequences to reset).

## What was carried over
- All 8 migrations ported to `app/db/migrations/` (plus `0000_extensions.sql`
  for `pgcrypto`). DDL was already plain Postgres SQL — near-verbatim copies.
- **Data: full copy, verified.** Rehearsed end-to-end against an ephemeral
  Postgres with production Supabase as the read-only source:
  `roadmaps 7/7 · initiatives 17/17 · roadmap_items 77/77 · sprint_items 72/72 ·
  roadmap_shares 10/10 · roadmap_team_members 5/5 · user_state 12/12 ·
  agent_links 0/0 · suggestions 0/0 · agent_activity 0/0` — all
  `status=complete`. The same runner executes for real on the first deployed
  boot; per-table `[db-migration]` lines will be confirmed via runtime logs.

## Stripped (intentionally, with reason)
- `003_enable_rls.sql` and the `ENABLE ROW LEVEL SECURITY` statements in 006:
  RLS had no policies — it existed solely to close Supabase's public Data
  API, which plain Postgres doesn't have. Authorization was always in the
  app layer; nothing is lost.

## Not portable / notes
- No Supabase Auth/Storage/Realtime usage existed — nothing to lose there.
- **TLS:** the pool connects with `ssl: { rejectUnauthorized: false }` per the
  kit's documented contract for PLN's managed RDS (no CA bundle is
  distributed to apps). Tradeoff acknowledged: encrypted but not
  certificate-verified, within PLN's private network.
- The old Supabase project is **untouched and stays as the frozen backup**
  of record at cutover; the copy runner never writes to it. Anything written
  to Supabase after the copy runs is not carried over (snapshot, not sync).

## Mechanics
- `PostgresStore` implements the existing `Store` interface (parameterized
  SQL, `pg`). DATE columns pinned to `'YYYY-MM-DD'` strings
  (`setTypeParser(1082)`) and TIMESTAMPTZ normalized to ISO strings so
  responses are byte-identical to the PostgREST shapes.
- Selection ladder: `DATABASE_URL` → Postgres; else `SUPABASE_*` → Supabase
  (fallback); else memory (dev). `/health` 503s if none configured.
- Runner wired as `CMD ["sh","-c","node db/migrate.js && npm start"]` —
  idempotent (`_pln_migrations` / `_pln_data_copy` tracking, resumable,
  `ON CONFLICT DO NOTHING`, 500-row batches within the 384Mi budget).

## Cutover checklist
1. Deploy with `database: {"enabled":true,"type":"postgres"}` and
   `requiredEnvVars` still including `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   (the copy needs them once) + `ANTHROPIC_API_KEY`.
2. After first boot: pull runtime logs, confirm every `[db-migration]` table
   line says `status=complete`, and fold real counts into this report.
3. On a later deploy, drop the `SUPABASE_*` names from `requiredEnvVars`.
   Supabase then serves purely as the frozen backup.
