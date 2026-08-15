-- Team roster (F-13): people who can be assigned as DRIs on a roadmap.
-- LabOS members carry member_uid (and image once captured from their own
-- member context); manually added people have neither and render initials.
-- All access via the server-side service role; authz lives in the API layer.

CREATE TABLE roadmap_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  member_uid TEXT,                    -- LabOS member uid; NULL for manual entries
  name TEXT NOT NULL,
  image TEXT,                         -- LabOS profile image URL, when known
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX roadmap_team_members_roadmap_idx ON roadmap_team_members(roadmap_id);
