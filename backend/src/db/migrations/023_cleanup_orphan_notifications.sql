-- Migration 023: Purge des notifications orphelines de test
-- Supprime les notifications qui pointent vers des remplacements supprimés

DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Suppression strictement bornée : entity_type='replacements' ET l'ID n'existe plus
  DELETE FROM notifications
  WHERE entity_type = 'replacements'
    AND NOT EXISTS (
      SELECT 1 FROM replacements r WHERE r.id = notifications.entity_id
    );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Purge terminée : % notifications orphelines supprimées.', deleted_count;
END $$;
