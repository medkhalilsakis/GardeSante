-- Catégories métier de personnel et affectations par période dans un planning.
-- Les intitulés de poste (job_titles) sont les sous-catégories.

ALTER TABLE job_titles
  ADD COLUMN IF NOT EXISTS category_label VARCHAR(100);

UPDATE job_titles
SET category = CASE category
  WHEN 'nursing' THEN 'paramedical'
  WHEN 'surgical' THEN 'medical'
  WHEN 'technical' THEN 'technical_logistics'
  WHEN 'admin' THEN 'administrative'
  ELSE category
END;

UPDATE job_titles
SET category_label = CASE category
  WHEN 'medical' THEN 'Personnel médical'
  WHEN 'paramedical' THEN 'Personnel paramédical'
  WHEN 'administrative' THEN 'Personnel administratif'
  WHEN 'technical_logistics' THEN 'Personnel technique et logistique'
  ELSE 'Autre personnel'
END
WHERE category_label IS NULL;

CREATE TABLE IF NOT EXISTS schedule_staff_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_roster_assignment_dates CHECK (period_end >= period_start),
  UNIQUE(schedule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_roster_schedule ON schedule_staff_assignments(schedule_id, position);
