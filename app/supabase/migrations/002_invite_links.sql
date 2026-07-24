-- Invite-link sharing: the v1.4 LabOS member context exposes no email, so the
-- primary share mechanism is a claim link that binds the visitor's verified
-- member uid. The email column stays for the dormant whitelist path.

ALTER TABLE roadmaps ADD COLUMN invite_token TEXT UNIQUE;

ALTER TABLE roadmap_shares ALTER COLUMN email DROP NOT NULL;
ALTER TABLE roadmap_shares ADD COLUMN member_uid TEXT;
ALTER TABLE roadmap_shares ADD COLUMN member_name TEXT;

-- exactly one identity per share row
ALTER TABLE roadmap_shares ADD CONSTRAINT share_identity_present CHECK (
  (email IS NOT NULL AND member_uid IS NULL)
  OR (email IS NULL AND member_uid IS NOT NULL)
);

-- replace the email uniqueness with partial uniques per identity kind
ALTER TABLE roadmap_shares DROP CONSTRAINT roadmap_shares_roadmap_id_email_key;
CREATE UNIQUE INDEX uq_shares_roadmap_email ON roadmap_shares(roadmap_id, email)
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_shares_roadmap_member ON roadmap_shares(roadmap_id, member_uid)
  WHERE member_uid IS NOT NULL;

CREATE INDEX idx_shares_member_uid ON roadmap_shares(member_uid)
  WHERE member_uid IS NOT NULL;
