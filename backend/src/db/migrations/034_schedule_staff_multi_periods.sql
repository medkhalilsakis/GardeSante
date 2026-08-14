CREATE TABLE IF NOT EXISTS schedule_staff_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_schedule_staff_period_dates CHECK (period_end >= period_start),
  UNIQUE(schedule_id, user_id, position)
);

CREATE INDEX IF NOT EXISTS idx_schedule_staff_periods_schedule
  ON schedule_staff_periods(schedule_id, user_id, position);

INSERT INTO schedule_staff_periods (schedule_id, user_id, period_start, period_end, position)
SELECT schedule_id, user_id, period_start, period_end, 0
FROM schedule_staff_assignments
ON CONFLICT (schedule_id, user_id, position) DO NOTHING;
