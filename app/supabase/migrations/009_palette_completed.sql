-- Color palettes + item/sprint completion (feature update, 2026).
-- palette: which curated palette colors this roadmap's bars (lib/colors.ts).
-- completed_at: completion date; non-null renders the bar in the palette's green.

ALTER TABLE roadmaps ADD COLUMN palette TEXT NOT NULL DEFAULT 'pl';
ALTER TABLE roadmap_items ADD COLUMN completed_at DATE;
ALTER TABLE sprint_items ADD COLUMN completed_at DATE;
