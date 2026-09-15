-- pln:no-transaction
-- Board view (feature update): a fourth delivery status and a per-roadmap
-- backlog of unscheduled items shown in the Kanban "Backlog" column.
--
-- Runs OUTSIDE a transaction: `ALTER TYPE … ADD VALUE` cannot run inside a
-- transaction block on Postgres < 12, and even on 12+ the new value is not
-- usable until commit. Every statement below is therefore individually
-- idempotent, so a partial run is simply re-applied on the next boot.
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'deprioritized';

-- backlog: JSONB array of date-free unscheduled items (same payload shape as
-- a personal backlog_items row). Existing roadmaps get an empty array.
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS backlog JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE roadmaps ADD CONSTRAINT roadmaps_backlog_array CHECK (jsonb_typeof(backlog) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
