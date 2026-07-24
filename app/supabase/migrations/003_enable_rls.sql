-- All access goes through the server-side service-role client, which bypasses
-- RLS. Enabling RLS with no policies closes the public Data API: anon and
-- authenticated roles can reach tables in the exposed `public` schema, and
-- without this every roadmap would be readable/writable with the anon key.

ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprint_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_state ENABLE ROW LEVEL SECURITY;
