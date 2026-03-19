-- =============================================================
-- ALLIANCE SYSTEM: ROLES FIX + APPLICATIONS TABLE
-- Run this in Supabase SQL Editor
-- =============================================================

-- 1. Fix role constraint to use 'founder' instead of 'leader'
ALTER TABLE alliance_members DROP CONSTRAINT IF EXISTS alliance_members_role_check;
ALTER TABLE alliance_members ADD CONSTRAINT alliance_members_role_check
  CHECK(role IN ('founder', 'officer', 'diplomat', 'member'));

-- 2. Migrate existing 'leader' roles to 'founder'
UPDATE alliance_members SET role = 'founder' WHERE role = 'leader';

-- 3. Create alliance_applications table
CREATE TABLE IF NOT EXISTS alliance_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_id uuid REFERENCES alliances(id) ON DELETE CASCADE,
  applicant_id uuid REFERENCES players(user_id) ON DELETE CASCADE,
  applicant_username text NOT NULL,
  status text CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
  message text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid REFERENCES players(user_id)
);

CREATE INDEX IF NOT EXISTS idx_alliance_applications_alliance_id ON alliance_applications(alliance_id);
CREATE INDEX IF NOT EXISTS idx_alliance_applications_applicant_id ON alliance_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_alliance_applications_status ON alliance_applications(status);

-- 4. RLS policies for alliance_applications
ALTER TABLE alliance_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own applications"
  ON alliance_applications FOR SELECT
  USING (applicant_id = auth.uid());

CREATE POLICY "Alliance managers can view applications"
  ON alliance_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM alliance_members
      WHERE alliance_members.alliance_id = alliance_applications.alliance_id
      AND alliance_members.user_id = auth.uid()
      AND alliance_members.role IN ('founder', 'officer', 'diplomat')
    )
  );

CREATE POLICY "Users can create applications"
  ON alliance_applications FOR INSERT
  WITH CHECK (applicant_id = auth.uid());

CREATE POLICY "Alliance managers can update applications"
  ON alliance_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM alliance_members
      WHERE alliance_members.alliance_id = alliance_applications.alliance_id
      AND alliance_members.user_id = auth.uid()
      AND alliance_members.role IN ('founder', 'officer', 'diplomat')
    )
  );
