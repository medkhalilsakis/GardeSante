-- Migration 016: Gestion des jours et périodes fériés par le Super Admin
CREATE TABLE IF NOT EXISTS public_holidays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  year INT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'national',
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.50,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_holidays_year ON public_holidays(year);
CREATE INDEX IF NOT EXISTS idx_public_holidays_dates ON public_holidays(start_date, end_date);

DROP TRIGGER IF EXISTS tr_public_holidays_updated ON public_holidays;
CREATE TRIGGER tr_public_holidays_updated
  BEFORE UPDATE ON public_holidays
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
