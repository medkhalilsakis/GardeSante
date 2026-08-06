-- Propositions de modification des plannings : elles ne modifient jamais
-- le planning officiel avant la décision explicite du chef de service.
CREATE TABLE IF NOT EXISTS schedule_change_proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES users(id),
  proposal JSONB NOT NULL,
  comment TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  decided_by UUID REFERENCES users(id),
  decision_comment TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_change_proposals_schedule_status
  ON schedule_change_proposals(schedule_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_change_proposals_proposer
  ON schedule_change_proposals(proposed_by, created_at DESC);

DROP TRIGGER IF EXISTS tr_schedule_change_proposals_updated ON schedule_change_proposals;
CREATE TRIGGER tr_schedule_change_proposals_updated
  BEFORE UPDATE ON schedule_change_proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();