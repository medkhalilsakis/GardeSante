-- ============================================================
-- 026 — Le planning est mis en marche dès la soumission
-- ============================================================
-- Le circuit d'approbation/refus est retiré : un planning envoyé par le chef de
-- service est immédiatement en vigueur, et il passe « en cours » quand sa date
-- de début est atteinte. Les surveillants et surveillants généraux ne valident
-- plus, ils proposent des modifications.
--
-- Conséquence : les statuts 'under_review' et 'approved' n'ont plus de circuit
-- qui les produise ni d'écran qui les présente. Les lignes qui les portent
-- encore seraient invisibles dans l'interface ET exclues de la porte des
-- propositions. On les normalise une seule fois vers les deux statuts qui
-- signifient désormais « en vigueur » :
--   - 'active'    si la période a déjà commencé  → en cours
--   - 'submitted' sinon                          → en vigueur, démarrage à venir
--
-- Idempotent : au second passage aucune ligne ne correspond au WHERE.
-- Aucune contrainte n'est modifiée : chk_schedule_status (001_schema.sql)
-- autorise déjà 'active'.
-- ============================================================

UPDATE schedules
   SET status = CASE WHEN start_date <= CURRENT_DATE THEN 'active' ELSE 'submitted' END,
       updated_at = NOW()
 WHERE status IN ('under_review', 'approved');

-- Le job de promotion (backend/src/jobs/schedule-activation.js) balaie
-- périodiquement les plannings envoyés dont la date de début est atteinte.
-- Index partiel : il ne porte que sur les lignes réellement scannées.
CREATE INDEX IF NOT EXISTS idx_schedules_pending_activation
    ON schedules (start_date) WHERE status = 'submitted';
