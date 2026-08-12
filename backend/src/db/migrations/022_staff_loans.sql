-- Migration 022: Prêt de personnel inter-service (règle II)
-- Demande automatique au chef propriétaire quand un agent d'un autre service est ajouté

CREATE TABLE IF NOT EXISTS staff_loan_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  requesting_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  requesting_chief_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  owner_chief_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  response_reason TEXT,
  CONSTRAINT chk_loan_status CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved'))
);

CREATE INDEX IF NOT EXISTS idx_staff_loans_owner_status ON staff_loan_requests(owner_chief_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_staff_loans_schedule ON staff_loan_requests(schedule_id);
CREATE INDEX IF NOT EXISTS idx_staff_loans_staff_date ON staff_loan_requests(staff_user_id, shift_date);
