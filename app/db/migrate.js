/*
 * PLN Postgres startup runner (db-migration skill, 2026-08-15).
 * Runs as the first command of the container CMD, before `npm start`:
 *
 *   1. Applies db/migrations/*.sql in filename order, recording each in
 *      _pln_migrations so redeploys are idempotent.
 *   2. Copies all data from the old Supabase database (read-only source)
 *      into Postgres, once, with per-table tracking in _pln_data_copy so an
 *      interrupted copy resumes instead of restarting. Runs only while the
 *      SUPABASE_* env vars are still registered alongside DATABASE_URL.
 *
 * No DATABASE_URL → exits 0 without doing anything (local dev / e2e run on
 * the in-memory store). A migration failure exits non-zero so the deploy
 * fails loudly instead of serving a half-migrated schema.
 */

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// PostgREST serialized DATE as 'YYYY-MM-DD' strings; keep that shape.
types.setTypeParser(1082, (v) => v);

const log = (msg) => console.log(`[db-migration] ${msg}`);

/** Parents before children (FK order); columns mirror the migrations. */
const COPY_TABLES = [
  { name: 'roadmaps', pk: 'id' },
  { name: 'initiatives', pk: 'id' },
  { name: 'roadmap_items', pk: 'id' },
  { name: 'sprint_items', pk: 'id' },
  { name: 'roadmap_shares', pk: 'id' },
  { name: 'roadmap_team_members', pk: 'id' },
  { name: 'user_state', pk: 'user_uid' },
  { name: 'agent_links', pk: 'id' },
  { name: 'suggestions', pk: 'id' },
  { name: 'agent_activity', pk: 'id' },
];

const BATCH = 500;

/** Postgres error codes for "this object already exists". A migration that
 *  fails ONLY because its objects are already present (e.g. a prior boot's
 *  partially-ledgered run, or a replica that raced before the advisory lock
 *  existed) is reconciled into the ledger instead of crash-looping. */
const DUPLICATE_CODES = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (types, constraints)
  '42701', // duplicate_column
  '42P06', // duplicate_schema
  '42723', // duplicate_function
]);

async function applyMigrations(pool) {
  const ctx = await pool.query(
    'SELECT current_database() AS db, current_schema() AS schema, current_user AS usr',
  );
  log(
    `context db=${ctx.rows[0].db} schema=${ctx.rows[0].schema} user=${ctx.rows[0].usr}`,
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS _pln_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT filename FROM _pln_migrations ORDER BY filename');
  const done = new Set(rows.map((r) => r.filename));
  log(`ledger=[${[...done].join(',') || 'empty'}]`);
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _pln_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`migration=${file} status=applied`);
    } catch (e) {
      await client.query('ROLLBACK');
      if (DUPLICATE_CODES.has(e.code)) {
        // Objects already exist but the ledger missed them — reconcile.
        await client.query(
          'INSERT INTO _pln_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [file],
        );
        log(`migration=${file} status=reconciled (objects already existed: ${e.message})`);
      } else {
        throw new Error(`migration ${file} failed: ${e.message}`);
      }
    } finally {
      client.release();
    }
  }
  log(`migrations=complete files=${files.length}`);
}

async function copyTable(pool, supabase, { name, pk }) {
  const existing = await pool.query(
    'SELECT completed_at FROM _pln_data_copy WHERE table_name = $1',
    [name],
  );
  if (existing.rows[0]?.completed_at) {
    log(`table=${name} status=already-complete`);
    return;
  }
  await pool.query(
    `INSERT INTO _pln_data_copy (table_name) VALUES ($1) ON CONFLICT DO NOTHING`,
    [name],
  );

  let copied = 0;
  let from = 0;
  for (;;) {
    // Keyset-free but stable: PostgREST range pagination over pk order.
    const { data, error } = await supabase
      .from(name)
      .select('*')
      .order(pk, { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(`supabase read ${name}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const cols = Object.keys(row);
      const params = cols.map((_, i) => `$${i + 1}`).join(', ');
      const values = cols.map((c) =>
        row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c],
      );
      await pool.query(
        `INSERT INTO ${name} (${cols.map((c) => `"${c}"`).join(', ')})
         VALUES (${params}) ON CONFLICT ("${pk}") DO NOTHING`,
        values,
      );
      copied += 1;
    }
    from += data.length;
    if (data.length < BATCH) break;
  }

  const { count, error: countErr } = await supabase
    .from(name)
    .select('*', { count: 'exact', head: true });
  if (countErr) throw new Error(`supabase count ${name}: ${countErr.message}`);
  const dest = await pool.query(`SELECT count(*)::int AS n FROM ${name}`);
  const destCount = dest.rows[0].n;
  if (destCount >= (count ?? 0)) {
    await pool.query(
      'UPDATE _pln_data_copy SET rows_copied = $2, completed_at = now() WHERE table_name = $1',
      [name, destCount],
    );
    log(`table=${name} copied=${destCount}/${count ?? 0} status=complete`);
  } else {
    log(`table=${name} copied=${destCount}/${count ?? 0} status=INCOMPLETE (will retry next boot)`);
  }
}

async function copyData(pool) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    log('data-copy=skipped reason=no-supabase-credentials');
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS _pln_data_copy (
    table_name TEXT PRIMARY KEY,
    rows_copied BIGINT NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ
  )`);
  const doneRows = await pool.query(
    'SELECT count(*)::int AS n FROM _pln_data_copy WHERE completed_at IS NOT NULL',
  );
  if (doneRows.rows[0].n === COPY_TABLES.length) {
    log('data-copy=already-complete');
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  // Read-only source: this client only ever selects/counts.
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  for (const table of COPY_TABLES) {
    await copyTable(pool, supabase, table);
  }
  log('data-copy=finished');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log('skipped reason=no-DATABASE_URL (memory/supabase mode)');
    return;
  }
  // TLS: strict verification when PGSSLROOTCERT provides a CA bundle;
  // otherwise encrypted-but-unverified per the PLN platform contract (no CA
  // is distributed to apps). sslmode=disable opts out for local/test only.
  let ssl;
  if (!url.includes('sslmode=disable')) {
    const caPath = process.env.PGSSLROOTCERT;
    ssl =
      caPath && fs.existsSync(caPath)
        ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: false };
  }
  // NOT max:1 — the lock holds one connection for the whole run while the
  // migration/copy queries need their own.
  const pool = new Pool({ connectionString: url, ssl, max: 4 });
  const client = await pool.connect();
  try {
    // Only one container may migrate/copy at a time: rolling deploys boot
    // replicas concurrently, and two runners racing on DDL is exactly how a
    // schema ends up ahead of its ledger. Session-scoped lock, held for the
    // whole run, released with the connection.
    log('acquiring migration lock…');
    await client.query('SELECT pg_advisory_lock(727270001)');
    log('migration lock acquired');
    await applyMigrations(pool);
    await copyData(pool);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`[db-migration] FAILED: ${e.message}`);
  process.exit(1);
});
