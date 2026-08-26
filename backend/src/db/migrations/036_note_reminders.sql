-- Migration 036: traçabilité des relances de circulaire (Lot X5)
--
-- `note_reads` dit qui a lu. Rien ne disait qui avait été relancé, ni par qui,
-- ni quand : une circulaire nationale restée non lue ne laissait aucune trace
-- de l'insistance de la direction. Cette table est purement additive — aucune
-- colonne des tables 020 n'est modifiée.
--
-- Pas de clé primaire (note_id, user_id) : plusieurs relances successives sur
-- le même destinataire doivent coexister pour être comptées et datées.

CREATE TABLE IF NOT EXISTS note_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  -- Destinataire relancé.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Auteur de la relance (Super Admin, auteur de la note ou directeur habilité).
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_note_reminders_note ON note_reminders(note_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_reminders_user ON note_reminders(note_id, user_id);
