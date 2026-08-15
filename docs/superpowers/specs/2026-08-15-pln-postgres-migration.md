# Migrate to PLN-provisioned Postgres — 2026-08-15

Member decision: PLN Postgres becomes the primary database; the existing
Supabase project stays untouched as the frozen backup of record at cutover
(read-only fallback, never written again by the app).

Architecture: a `PostgresStore` implements the existing `Store` interface
with the `pg` driver (parameterized SQL). Store selection:
`DATABASE_URL` → Postgres; else `SUPABASE_*` pair → Supabase; else memory
(dev/tests). A startup runner (`app/db/migrate.js`, first command of the
container CMD) applies `app/db/migrations/*.sql` idempotently and then
copies all data from Supabase → Postgres once (per-table tracking,
resumable, `ON CONFLICT DO NOTHING`, source never written).

Known traps engineered around (wiki: patterns/pln-ai-apps):
- `pg` parses SQL `DATE` (OID 1082) into local-midnight `Date` objects —
  pinned back to plain strings with `types.setTypeParser(1082, v => v)`;
  `TIMESTAMPTZ` mapped via `.toISOString()` so store outputs are
  byte-identical to the PostgREST shapes.
- `pg` ignores `?sslmode=require` — the pool sets
  `ssl: { rejectUnauthorized: false }` explicitly.
- RLS statements are stripped from the ported migrations: authorization
  lives in the API layer; on Supabase RLS only closed the public Data API,
  which plain Postgres doesn't have.

```gherkin
Scenario: Fresh boot applies schema then copies data once
  Given a container boots with DATABASE_URL and the Supabase env vars
  When db/migrate.js runs before npm start
  Then all migrations apply in order and are recorded in _pln_migrations
  And every table's rows are copied Supabase → Postgres, parents before
  children, with per-table counts logged as [db-migration] lines
  And a second boot applies nothing and copies nothing (idempotent)

Scenario: Store parity
  Given the same operations run against PostgresStore and MemoryStore
  Then results match the Store contract (dates stay YYYY-MM-DD strings,
  timestamps ISO strings, nulls preserved)

Scenario: Store selection ladder
  DATABASE_URL set → PostgresStore (even if SUPABASE vars also present)
  only SUPABASE vars → SupabaseStore
  neither, DEV_AUTH=1 → MemoryStore; neither in production → /health 503

Scenario: Old database is read-only source material
  When the copy runs
  Then no INSERT/UPDATE/DELETE is ever issued against Supabase

Scenario: Interrupted copy resumes
  Given the container dies mid-copy
  When it boots again
  Then completed tables are skipped and the unfinished table re-runs safely
```

Cutover contract: SUPABASE_* secrets stay registered for this deploy (the
copy needs them once); they are removed from requiredEnvVars only after the
runtime logs confirm every table reached status=complete.
