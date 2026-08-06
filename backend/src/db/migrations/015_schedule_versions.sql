-- Versioning immuable des tableurs de garde.
CREATE TABLE IF NOT EXISTS schedule_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  parent_version_id UUID REFERENCES schedule_versions(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  author_role VARCHAR(40) NOT NULL,
  review_stage VARCHAR(30) NOT NULL CHECK (review_stage IN ('service_supervisor','general_supervisor')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_chef'
    CHECK (status IN ('final','pending_chef','accepted','rejected','available_to_general')),
  snapshot JSONB NOT NULL,
  comment TEXT,
  decision_comment TEXT,
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(schedule_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_versions_one_final
  ON schedule_versions(schedule_id) WHERE is_final = TRUE;
CREATE INDEX IF NOT EXISTS idx_schedule_versions_workflow
  ON schedule_versions(schedule_id, review_stage, status, created_at DESC);

DROP TRIGGER IF EXISTS tr_schedule_versions_updated ON schedule_versions;
CREATE TRIGGER tr_schedule_versions_updated
  BEFORE UPDATE ON schedule_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS final_version_id UUID REFERENCES schedule_versions(id) ON DELETE SET NULL;