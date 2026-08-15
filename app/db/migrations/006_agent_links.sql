-- Agent links (agent-links design 2026-08-05): named, revocable bearer
-- capabilities granting AI agents per-roadmap access. `suggestions` holds
-- agent-proposed changes pending human review (payloads reuse the human
-- PATCH/POST body shapes); `agent_activity` is an append-only audit log.
-- Service-role access only; authorization lives in the API layer.

CREATE TABLE agent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agent_viewer', 'agent_suggester', 'agent_editor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,          -- bumped on every authorized agent call
  revoked_at TIMESTAMPTZ             -- NULL = active (soft revoke keeps history)
);
CREATE INDEX agent_links_roadmap_idx ON agent_links(roadmap_id);

CREATE TABLE suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  agent_link_id UUID NOT NULL REFERENCES agent_links(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN
    ('create_item', 'update_item', 'delete_item', 'create_sprint', 'update_sprint', 'comment')),
  target_id UUID,                    -- item/sprint being modified; NULL for creates/comments
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_by TEXT,                  -- member uid, or 'system' for auto-reject
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX suggestions_roadmap_idx ON suggestions(roadmap_id);
CREATE INDEX suggestions_link_idx ON suggestions(agent_link_id);

CREATE TABLE agent_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_link_id UUID NOT NULL REFERENCES agent_links(id) ON DELETE CASCADE,
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  action TEXT NOT NULL,              -- 'read' | 'suggest' | 'edit' | ...
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,  -- never contains the token
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX agent_activity_link_idx ON agent_activity(agent_link_id);
