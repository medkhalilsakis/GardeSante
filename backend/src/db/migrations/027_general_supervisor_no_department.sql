-- ============================================================
-- 027 — Le surveillant général n'appartient à aucun service
-- ============================================================
-- Règle métier : comme le directeur, le surveillant général couvre l'hôpital
-- entier. Il ne doit donc figurer dans aucune ligne de `user_departments`.
--
-- Ce rattachement n'a jamais eu d'effet fonctionnel : partout où la portée du
-- surveillant général est calculée, elle est déjà « établissement » et non
-- « service » —
--   • schedule-inbox.controller.js  → ESTABLISHMENT_SCOPE
--   • journal.controller.js         → resolveJournalScope
--   • hospital-calendar.controller.js → scopedRoles ne liste que le chef de
--     service et le surveillant de service
-- Le nettoyage ne retire donc aucun accès ; il fait seulement disparaître la
-- puce « service » de son badge de contexte et aligne la base sur la règle.
--
-- Idempotent : au second passage, plus aucune ligne ne correspond au WHERE.
-- La table `departments` n'est pas touchée, les services restent intacts.
-- ============================================================

DELETE FROM user_departments ud
 USING users u, roles r
 WHERE ud.user_id = u.id
   AND u.role_id = r.id
   AND r.code = 'general_supervisor';
