-- Editor invite links: each roadmap gets a second, independent invite token
-- that grants edit (not owner) access. Share rows record which role their
-- link granted; every pre-existing share was a viewer.

ALTER TABLE roadmaps ADD COLUMN editor_invite_token TEXT UNIQUE;

ALTER TABLE roadmap_shares ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'
  CHECK (role IN ('editor', 'viewer'));
