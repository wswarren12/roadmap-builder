-- Cross-roadmap synced items (F-15b, 2026-08-14): items imported from
-- another roadmap share a sync_group_id; content edits propagate to every
-- row in the group (API layer). Sprints of linked items sync the same way
-- with their own group ids. NULL = not linked to anything.

ALTER TABLE roadmap_items ADD COLUMN sync_group_id UUID;
CREATE INDEX roadmap_items_sync_group_idx
  ON roadmap_items(sync_group_id) WHERE sync_group_id IS NOT NULL;

ALTER TABLE sprint_items ADD COLUMN sync_group_id UUID;
CREATE INDEX sprint_items_sync_group_idx
  ON sprint_items(sync_group_id) WHERE sync_group_id IS NOT NULL;
