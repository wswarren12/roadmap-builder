-- F-13b: assignments point at stable LabOS identities instead of names.
--
-- dri_member_id names the roadmap_team_members row (which carries the LabOS
-- member uid), so two people with the same display name stay distinguishable
-- and renaming a person does not re-point existing assignments. Removing a
-- person from the roster clears the pointer but keeps the saved `dris` text,
-- so no existing assignment text is lost.
--
-- responsible_team_uid backs the free-text responsible_team with the LabOS
-- team uid when the editor picked one. Both columns are nullable: every row
-- saved before this migration keeps working as free text.

ALTER TABLE roadmap_items
  ADD COLUMN IF NOT EXISTS dri_member_id UUID
    REFERENCES roadmap_team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_team_uid TEXT;

ALTER TABLE sprint_items
  ADD COLUMN IF NOT EXISTS dri_member_id UUID
    REFERENCES roadmap_team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_items_dri_member ON roadmap_items(dri_member_id);
CREATE INDEX IF NOT EXISTS idx_sprint_items_dri_member ON sprint_items(dri_member_id);
