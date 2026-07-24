-- Roadmapper schema (PRD §9). All access via server-side service role;
-- authorization enforced in the API layer (LabOS identities, not Supabase Auth).

CREATE TABLE roadmaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL,            -- LabOS member uid
  owner_email TEXT NOT NULL,          -- normalized lowercase
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_month DATE NOT NULL,          -- first day of first month
  end_month DATE NOT NULL,            -- first day of last month
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT range_3_to_12_months CHECK (
    end_month >= start_month + INTERVAL '2 months'
    AND end_month <= start_month + INTERVAL '11 months')
);

CREATE TABLE initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position SMALLINT NOT NULL,         -- app enforces max 5 per roadmap
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (roadmap_id, position)
);

CREATE TYPE item_status AS ENUM ('green','yellow','red');

CREATE TABLE roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  milestone_text TEXT DEFAULT '',
  milestone_date DATE,                -- optional; within start..end (app-validated)
  okrs TEXT DEFAULT '',
  dris TEXT DEFAULT '',
  status item_status NOT NULL DEFAULT 'green',
  kpi TEXT DEFAULT '',
  color_index SMALLINT NOT NULL,      -- deterministic palette index
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE sprint_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_item_id UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  milestone_text TEXT DEFAULT '',
  milestone_date DATE,
  kpi TEXT DEFAULT '',
  dri TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE roadmap_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                -- normalized lowercase
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (roadmap_id, email)
);

CREATE TABLE user_state (
  user_uid TEXT PRIMARY KEY,          -- LabOS member uid
  last_roadmap_id UUID REFERENCES roadmaps(id) ON DELETE SET NULL,
  last_visited_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_initiatives_roadmap ON initiatives(roadmap_id);
CREATE INDEX idx_items_roadmap ON roadmap_items(roadmap_id);
CREATE INDEX idx_items_initiative ON roadmap_items(initiative_id);
CREATE INDEX idx_sprints_item ON sprint_items(roadmap_item_id);
CREATE INDEX idx_shares_roadmap ON roadmap_shares(roadmap_id);
CREATE INDEX idx_shares_email ON roadmap_shares(email);
CREATE INDEX idx_roadmaps_owner ON roadmaps(owner_uid);
