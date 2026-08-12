-- Migration 020: Notes / Circulaires (posts avec pièces jointes)
-- Super Admin -> tous les directeurs | Directeur -> tout le personnel de son hôpital

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- NULL pour une note plateforme publiée par le Super Admin
  establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(30) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  category VARCHAR(40) DEFAULT 'note',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal',
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_note_scope CHECK (scope IN ('platform_directors', 'establishment_staff', 'department')),
  CONSTRAINT chk_note_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE TABLE IF NOT EXISTS note_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_attachment_kind CHECK (kind IN ('image', 'pdf'))
);

CREATE TABLE IF NOT EXISTS note_reads (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_scope_published ON notes(scope, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_establishment ON notes(establishment_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);
CREATE INDEX IF NOT EXISTS idx_note_reads_user ON note_reads(user_id);
