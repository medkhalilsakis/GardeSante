-- ============================================================
-- 035 — Domaines de messagerie en .tn (plateforme tunisienne)
-- ============================================================
-- La plateforme est tunisienne : le bornage géographique des établissements
-- l'impose déjà (latitude 30–38, longitude 7–12,5 — `parseTunisiaCoordinates`
-- dans `establishments.controller.js`). Les comptes amorcés portaient pourtant
-- un domaine en `.dz`, hérité d'un jeu de démonstration algérien.
--
-- Cette migration réécrit la terminaison `.dz` en `.tn` sur les adresses
-- existantes, pour que la connexion rapide du nouvel écran de login
-- (`admin@gardesante.tn`) tombe sur le compte réellement présent en base.
--
-- Idempotente : au second passage, plus aucune ligne ne correspond au filtre.
-- Sans risque de collision : la réécriture est ignorée si l'adresse cible est
-- déjà prise (contrainte UNIQUE sur `users.email`).
-- ============================================================

-- ── Comptes utilisateurs ──────────────────────────────────────
UPDATE users u
   SET email = regexp_replace(u.email, '\.dz$', '.tn')
 WHERE u.email LIKE '%.dz'
   AND NOT EXISTS (
     SELECT 1 FROM users x
      WHERE x.email = regexp_replace(u.email, '\.dz$', '.tn')
        AND x.id <> u.id
   );

-- ── Adresses de contact des établissements ────────────────────
-- Pas de contrainte d'unicité ici : réécriture directe.
UPDATE establishments
   SET email = regexp_replace(email, '\.dz$', '.tn')
 WHERE email LIKE '%.dz';
