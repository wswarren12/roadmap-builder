-- Cleanup batch (2026-08-11): initiative theme descriptions and a
-- responsible-team field on items. Both additive with defaults.

ALTER TABLE initiatives ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE roadmap_items ADD COLUMN responsible_team TEXT NOT NULL DEFAULT '';
