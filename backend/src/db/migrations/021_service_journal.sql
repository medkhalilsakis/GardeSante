-- Migration 021: Journal de service + Alertes
-- shift_events pour présences, absences, retards, incidents, remarques
-- service_alerts pour alertes système (personnel absent, garde non couverte, remplacement en attente, urgence)

CREATE TABLE IF NOT EXISTS shift_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  event_type VARCHAR(30) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity VARCHAR(10) NOT NULL DEFAULT 'info',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_event_type CHECK (event_type IN ('presence', 'absence', 'late', 'incident', 'remark', 'reinforcement')),
  CONSTRAINT chk_event_severity CHECK (severity IN ('info', 'warning', 'error', 'critical'))
);

CREATE TABLE IF NOT EXISTS service_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
  alert_type VARCHAR(40) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_alert_type CHECK (alert_type IN ('staff_absent', 'shift_uncovered', 'replacement_pending', 'urgent_notification', 'conflict_detected', 'insufficient_staff')),
  CONSTRAINT chk_alert_severity CHECK (severity IN ('info', 'warning', 'error', 'critical', 'urgent'))
);

CREATE INDEX IF NOT EXISTS idx_shift_events_dept_time ON shift_events(department_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_shift_events_schedule ON shift_events(schedule_id) WHERE schedule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shift_events_user ON shift_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_alerts_dept_status ON service_alerts(department_id, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_alerts_establishment ON service_alerts(establishment_id, created_at DESC);
