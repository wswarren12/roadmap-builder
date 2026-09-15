-- Board view (feature update): a fourth delivery status and a per-roadmap
-- backlog of unscheduled items shown in the Kanban "Backlog" column.
-- ADD VALUE cannot be used in the same transaction it is added in; nothing
-- below references the new value, so a transactional runner is fine.
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'deprioritized';

-- backlog: JSONB array of { id, title, description, status, dris, createdAt }.
-- Roadmap-scoped (cascades with the row); the private per-member backlog in
-- backlog_items is unrelated.
ALTER TABLE roadmaps ADD COLUMN backlog JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE roadmaps ADD CONSTRAINT roadmaps_backlog_array CHECK (jsonb_typeof(backlog) = 'array');
