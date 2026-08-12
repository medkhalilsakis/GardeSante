-- ============================================================
-- 028 — Types de garde par défaut (J / S / N / G)
-- ============================================================
-- CORRECTION D'UN BLOCAGE PRÉEXISTANT.
--
-- `saveDraft` (schedule-builder.controller.js) convertit chaque code saisi dans
-- le tableur en garde réelle, en le résolvant contre `shift_types` :
--     if (!shiftType) return res.status(400)
--        .json({ message: `Type de garde introuvable pour le code "${code}".` });
-- Or la table est VIDE pour tous les établissements. Conséquence : aucun code
-- de garde ne peut être enregistré, chaque ligne du tableur reste `shifts: {}`,
-- et l'aperçu en lecture seule n'a rien à afficher. Le même lookup existe à
-- l'acceptation d'une proposition de modification et à la validation finale :
-- les trois chemins sont débloqués d'un coup.
--
-- Amorçage volontairement minimal et neutre : 3×8 h plus la garde de 24 h.
-- Chaque établissement reste libre de modifier horaires, couleurs et libellés,
-- et d'en ajouter d'autres — rien ici n'est figé.
--
-- 'R' (Repos) n'est PAS amorcé : ce code est un marqueur de tableur, jamais une
-- garde. `saveDraft` le saute explicitement avant la résolution du type.
--
-- Idempotent : UNIQUE(establishment_id, code) + ON CONFLICT DO NOTHING. Aucune
-- ligne existante n'est modifiée, y compris si un établissement a déjà défini
-- ses propres types avec ces codes.
-- ============================================================

INSERT INTO shift_types
  (establishment_id, code, name, name_ar, start_time, end_time, duration_hours, is_overnight, color)
SELECT e.id, t.code, t.name, t.name_ar,
       t.start_time::time, t.end_time::time, t.duration_hours, t.is_overnight, t.color
  FROM establishments e
 CROSS JOIN (VALUES
   ('J', 'Jour',  'نهار',  '08:00', '16:00',  8.0, FALSE, '#3B82F6'),
   ('S', 'Soir',  'مساء',  '16:00', '00:00',  8.0, TRUE,  '#10B981'),
   ('N', 'Nuit',  'ليل',   '00:00', '08:00',  8.0, FALSE, '#6D28D9'),
   ('G', 'Garde', 'حراسة', '08:00', '08:00', 24.0, TRUE,  '#F59E0B')
 ) AS t(code, name, name_ar, start_time, end_time, duration_hours, is_overnight, color)
    ON CONFLICT (establishment_id, code) DO NOTHING;
