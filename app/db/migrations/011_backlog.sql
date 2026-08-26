-- Private, roadmap-agnostic backlog. Absolute dates never enter payload.
CREATE TABLE backlog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT backlog_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX idx_backlog_owner_updated ON backlog_items(owner_uid, updated_at DESC);
ALTER TABLE backlog_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON backlog_items TO service_role';
  END IF;
END $$;

-- A single RPC keeps the Supabase REST adapter's snapshot + delete atomic.
CREATE OR REPLACE FUNCTION backlog_move_item_atomic(p_item_id UUID, p_owner_uid TEXT)
RETURNS backlog_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  source roadmap_items%ROWTYPE;
  result backlog_items%ROWTYPE;
  span_days NUMERIC;
  sprint_payload JSONB;
  item_payload JSONB;
BEGIN
  SELECT * INTO source FROM roadmap_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM sprint_items WHERE roadmap_item_id = p_item_id FOR UPDATE;
  span_days := GREATEST(source.end_date - source.start_date, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', s.name,
    'description', COALESCE(s.description, ''),
    'startPosition', CASE WHEN span_days = 0 THEN 0 ELSE GREATEST(0, LEAST(1, (s.start_date - source.start_date) / span_days)) END,
    'endPosition', CASE WHEN span_days = 0 THEN 0 ELSE GREATEST(0, LEAST(1, (s.end_date - source.start_date) / span_days)) END,
    'milestoneText', COALESCE(s.milestone_text, ''),
    'milestonePosition', CASE WHEN s.milestone_date IS NULL THEN NULL WHEN span_days = 0 THEN 0 ELSE GREATEST(0, LEAST(1, (s.milestone_date - source.start_date) / span_days)) END,
    'kpi', COALESCE(s.kpi, ''),
    'dri', COALESCE(s.dri, '')
  ) ORDER BY s.created_at), '[]'::jsonb)
  INTO sprint_payload FROM sprint_items s WHERE s.roadmap_item_id = p_item_id;

  item_payload := jsonb_build_object(
    'title', source.title,
    'description', COALESCE(source.description, ''),
    'milestoneText', COALESCE(source.milestone_text, ''),
    'milestonePosition', CASE WHEN source.milestone_date IS NULL THEN NULL WHEN span_days = 0 THEN 0 ELSE GREATEST(0, LEAST(1, (source.milestone_date - source.start_date) / span_days)) END,
    'okrs', COALESCE(source.okrs, ''),
    'dris', COALESCE(source.dris, ''),
    'responsibleTeam', COALESCE(source.responsible_team, ''),
    'status', source.status::TEXT,
    'kpi', COALESCE(source.kpi, ''),
    'colorIndex', source.color_index,
    'sprints', sprint_payload
  );

  INSERT INTO backlog_items(owner_uid, payload) VALUES (p_owner_uid, item_payload) RETURNING * INTO result;
  DELETE FROM roadmap_items WHERE id = p_item_id;
  RETURN result;
END;
$$;

-- A single RPC reconstructs all children and consumes the backlog row atomically.
CREATE OR REPLACE FUNCTION backlog_import_item_atomic(
  p_id UUID,
  p_owner_uid TEXT,
  p_roadmap_id UUID,
  p_initiative_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_color_index SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  backlog backlog_items%ROWTYPE;
  created_item roadmap_items%ROWTYPE;
  created_sprint sprint_items%ROWTYPE;
  sprint_payload JSONB;
  created_sprints JSONB := '[]'::jsonb;
  span_days INTEGER := GREATEST(p_end_date - p_start_date, 0);
BEGIN
  SELECT * INTO backlog FROM backlog_items
   WHERE id = p_id AND owner_uid = p_owner_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'backlog item not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO roadmap_items(
    roadmap_id, initiative_id, title, description, start_date, end_date,
    milestone_text, milestone_date, okrs, dris, responsible_team, status,
    kpi, completed_at, color_index, sync_group_id
  ) VALUES (
    p_roadmap_id, p_initiative_id, backlog.payload->>'title', COALESCE(backlog.payload->>'description',''),
    p_start_date, p_end_date, COALESCE(backlog.payload->>'milestoneText',''),
    CASE WHEN backlog.payload->'milestonePosition' IS NULL OR backlog.payload->'milestonePosition' = 'null'::jsonb THEN NULL
      ELSE p_start_date + ROUND((backlog.payload->>'milestonePosition')::NUMERIC * span_days)::INTEGER END,
    COALESCE(backlog.payload->>'okrs',''), COALESCE(backlog.payload->>'dris',''),
    COALESCE(backlog.payload->>'responsibleTeam',''), COALESCE(backlog.payload->>'status','green')::item_status,
    COALESCE(backlog.payload->>'kpi',''), NULL, p_color_index, NULL
  ) RETURNING * INTO created_item;

  FOR sprint_payload IN SELECT value FROM jsonb_array_elements(COALESCE(backlog.payload->'sprints','[]'::jsonb))
  LOOP
    INSERT INTO sprint_items(
      roadmap_item_id, name, description, start_date, end_date, milestone_text,
      milestone_date, kpi, dri, completed_at, sync_group_id
    ) VALUES (
      created_item.id, sprint_payload->>'name', COALESCE(sprint_payload->>'description',''),
      p_start_date + ROUND((sprint_payload->>'startPosition')::NUMERIC * span_days)::INTEGER,
      p_start_date + ROUND((sprint_payload->>'endPosition')::NUMERIC * span_days)::INTEGER,
      COALESCE(sprint_payload->>'milestoneText',''),
      CASE WHEN sprint_payload->'milestonePosition' IS NULL OR sprint_payload->'milestonePosition' = 'null'::jsonb THEN NULL
        ELSE p_start_date + ROUND((sprint_payload->>'milestonePosition')::NUMERIC * span_days)::INTEGER END,
      COALESCE(sprint_payload->>'kpi',''), COALESCE(sprint_payload->>'dri',''), NULL, NULL
    ) RETURNING * INTO created_sprint;
    created_sprints := created_sprints || jsonb_build_array(to_jsonb(created_sprint));
  END LOOP;

  DELETE FROM backlog_items WHERE id = p_id AND owner_uid = p_owner_uid;
  RETURN jsonb_build_object('item', to_jsonb(created_item), 'sprints', created_sprints);
END;
$$;

REVOKE ALL ON FUNCTION backlog_move_item_atomic(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION backlog_import_item_atomic(UUID, TEXT, UUID, UUID, DATE, DATE, SMALLINT) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION backlog_move_item_atomic(UUID, TEXT) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION backlog_import_item_atomic(UUID, TEXT, UUID, UUID, DATE, DATE, SMALLINT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION backlog_move_item_atomic(UUID, TEXT) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION backlog_import_item_atomic(UUID, TEXT, UUID, UUID, DATE, DATE, SMALLINT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION backlog_move_item_atomic(UUID, TEXT) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION backlog_import_item_atomic(UUID, TEXT, UUID, UUID, DATE, DATE, SMALLINT) TO service_role';
  END IF;
END $$;
