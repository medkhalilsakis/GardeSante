-- Migration 017: Type de planning (normal vs special_weekend_holiday)
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(50) NOT NULL DEFAULT 'normal';
-- Valeurs possibles: 'normal' | 'special_weekend_holiday'
