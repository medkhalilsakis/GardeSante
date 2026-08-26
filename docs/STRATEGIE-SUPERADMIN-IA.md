# Stratégie Super Admin — intelligence interne, souveraine et explicable

> Document de cadrage. Aucune ligne de code n'a été modifiée pour le produire.
> Toutes les affirmations sur l'existant ont été vérifiées dans le dépôt ; les
> références de fichier et de ligne sont données pour être recontrôlées.

---

## 0. Le cadre imposé par vos quatre décisions

| Décision | Conséquence directe sur la stratégie |
|---|---|
| **100 % interne, aucun appel sortant** | « IA » signifie ici : moteurs déterministes, statistiques robustes, détection d'anomalies, prévision calendaire et **génération de texte par gabarits**. Aucun LLM, aucune clé API, aucune donnée de santé qui quitte l'hôpital. Ce n'est pas un pis-aller : c'est **le** argument de souveraineté et d'auditabilité devant une tutelle. Chaque chiffre affiché sera re-calculable à la main. |
| **Démo / pré-lancement** | Interdiction de concevoir une fonction qui n'a de sens qu'avec deux ans d'historique. Chaque proposition ci-dessous a un **mode « à froid »** : seuils absolus + référentiel national livré avec le produit ; puis bascule automatique vers des seuils auto-calibrés dès que l'historique existe. |
| **Préparer + exécuter en 1 clic** | Il faut une **surface d'écriture nouvelle et séparée**. `admin-oversight.routes.js` est en lecture seule *par conception* (son en-tête : « aucun verbe autre que GET n'est monté »). On ne la contredit pas : on ajoute un module frère `admin-copilot` qui porte les actions, et l'auteur inscrit dans `audit_logs` reste **l'humain qui a cliqué**, jamais « le système ». |
| **Argument pour le ministère / appel d'offres** | On privilégie : conformité réglementaire prouvée, équité territoriale d'accès aux soins, documents institutionnels imprimables, indicateurs de tutelle, et des écrans qui se démontrent en 90 secondes. |

---

## 1. Le diagnostic qui commande tout le reste

Quatre faits établis dans le code. Le premier est le plus important du document.

### Fait A — le moteur d'intelligence existe déjà, mais il tourne à vide

`rules-engine.js` contient un moteur de règles complet (`evaluateRules`, `evaluateRule`, `DEFAULT_RULES`) et un générateur de snapshot national (`generateNationalSnapshot`). Il est appelé pour de vrai, à quatre endroits de `schedule-builder.controller.js` : lignes 304, 344, **1249** et 693.

Or ces deux fonctions lisent leurs données **dans la table `shifts`** :

```
FROM shifts s WHERE s.schedule_id = $1 AND s.status != 'cancelled'
```
— `rules-engine.js:241-252` et `:558-566`

Et les plannings construits **au tableur** — le chemin principal de la plateforme — n'écrivent pas dans `shifts` : leur source de vérité est `schedules.metadata.spreadsheet`, lue exclusivement par `spreadsheet-reader.js`. Les seuls chemins qui alimentent `shifts` sont le wizard, l'éditeur visuel, les modèles et l'import.

**Trois conséquences, toutes actuellement invisibles :**

1. Pour un planning fait au tableur, `evaluateRules` parcourt **zéro garde** et ne trouve donc **zéro violation**.
2. `schedule-builder.controller.js:1249` bloque la soumission si `!evaluation.isValid`. Comme il n'y a jamais d'erreur, **le contrôle de conformité avant soumission laisse tout passer, en silence.** La règle `NO_GUARD_DURING_ABSENCE` — c'est-à-dire précisément votre exigence *« le chef de service ne peut pas affecter un personnel en congés »* — n'est en réalité tenue que par `leave-check.js` au moment de la génération assistée, pas par le moteur de règles.
3. `generateNationalSnapshot` produit un snapshot **structurellement vide** : `total_shifts: 0`, `staff_count: 0`, `coverage_rate: 0`, `staff_summary: []`. C'est aussi l'explication du `total_shifts` toujours à zéro déjà repéré dans le portfolio.

> **Rien n'est cassé, mais une promesse est vide.** Devant un jury d'appel d'offres, « nos plannings sont validés par un moteur de règles métier » est aujourd'hui une affirmation qu'une démonstration contradictoire ferait tomber en trois clics. C'est le premier chantier, et il n'exige aucune fonctionnalité nouvelle : seulement rebrancher un moteur existant sur la vraie source.

### Fait B — trois tables d'intelligence sont déjà en place, aucune n'est lue

Migration `010_intelligence_normalisation.sql` :

| Table | État | Ce qu'elle attendait |
|---|---|---|
| `rule_evaluations` (rule_code, severity, `violations JSONB`) | **écrite** par `rules-engine.js:268`, jamais relue | l'historique de conformité |
| `schedule_snapshots` (`snapshot JSONB`, version, `UNIQUE(schedule_id, version)`) | **écrite** par `rules-engine.js:617`, jamais relue | commentaire de la migration : *« Snapshots normalisés pour le tableau de bord national du Super Admin »* |
| `learned_columns` (raw_label → normalized_label, `confidence`, `times_used`, `was_confirmed`, `was_rejected`) | **écrite** et relue, mais **par établissement seulement** | une boucle d'apprentissage propose → l'humain confirme → la confiance monte |

Le tableau de bord national que la migration 010 annonçait n'a jamais été construit. **La table qui devait l'alimenter existe, est déjà remplie à chaque approbation, et personne ne la lit.** C'est l'opportunité la moins chère du dépôt.

### Fait C — l'infrastructure d'automatisation est déjà là

- Un exécuteur de tâches de fond existe et fonctionne : `src/jobs/schedule-activation.js` (`setInterval` + `promoteDueSchedules`), démarré par `backend/index.js:6` et `:61`. Ajouter un calcul nocturne, c'est **copier un motif éprouvé du dépôt**, pas introduire une brique nouvelle.
- `pg_trgm` est activé (`001_schema.sql:9`) : la similarité de chaînes et l'appariement approximatif sont disponibles **nativement en SQL**, sans aucune bibliothèque.
- Le temps réel (`socket.io`, `realtime/emit.js`) et les notifications sont en place : tout résultat de calcul peut être poussé sans rechargement.

### Fait D — le dashboard est descriptif, jamais prescriptif

`SuperAdminDashboard.jsx` (1869 lignes) montre remarquablement bien **l'état** : établissements, directeurs, personnel, historique, jours fériés, statistiques, carte, supervision des gardes. Mais il ne dit jamais **quoi faire**, ne classe jamais par urgence, et n'exécute rien. Le Super Admin doit ouvrir chaque établissement pour découvrir un problème qu'aucun écran ne lui a signalé.

Et surtout : **le Super Admin est le seul acteur qui voit l'inter-établissement.** Un agent de garde le même jour dans deux hôpitaux, un prêt qui laisse un service à découvert, une délégation entière sans garde de nuit : personne d'autre dans la plateforme ne peut le voir. C'est là que se trouve la valeur qu'aucun autre rôle ne peut produire.

### Point annexe à corriger

`007_salary_fields.sql` commente les montants en **DZD**, alors que le bornage GPS des établissements est tunisien (`establishments.controller.js:32` : latitude 30–38, longitude 7–12,5), que le fuseau est `Africa/Tunis` et qu'il existe un `seedTunisiaHolidays`. La devise à afficher est le **TND**. Incohérence documentaire, sans effet sur les calculs, mais visible dans un rapport institutionnel.

---

## 2. Architecture cible — strictement additive

Rien de l'existant n'est réécrit. Le Super Admin gagne des onglets ; les modules actuels ne bougent pas.

```
backend/src/
  analytics/                        ← NOUVEAU — calcul pur, aucune écriture, testable seul
    tension.js                      indice de tension par établissement
    equity.js                       Gini, variance, part nuit/week-end/férié
    integrity.js                    incohérences inter-établissements + intégrité des déclarations
    coverage.js                     prévision de couverture à 60 jours
    territory.js                    couverture territoriale, haversine
    narrative.js                    phrases françaises par gabarits (+ arabe)
    thresholds.js                   seuils : absolus « à froid », auto-calibrés ensuite
  jobs/
    nightly-intelligence.js         ← NOUVEAU — même motif que schedule-activation.js
  modules/admin/
    admin-insights.routes.js        ← NOUVEAU — GET seulement, lecture des résultats
    admin-insights.controller.js
    admin-copilot.routes.js         ← NOUVEAU — POST, actions préparées (1 clic)
    admin-copilot.controller.js
  db/migrations/
    035_intelligence_v2.sql         ← NOUVEAU — additif : CREATE TABLE IF NOT EXISTS uniquement

frontend/src/pages/superadmin/
  components/NationalCommandCenter.jsx   ← NOUVEAU
  components/ConformityPanel.jsx         ← NOUVEAU
  components/EquityPanel.jsx             ← NOUVEAU
  components/IntegrityPanel.jsx          ← NOUVEAU
  components/CoverageForecast.jsx        ← NOUVEAU
  components/InstitutionalBulletin.jsx   ← NOUVEAU
  components/HygienePanel.jsx            ← NOUVEAU
  components/ActionQueue.jsx             ← NOUVEAU — la file des actions préparées
```

`spreadsheet-reader.js` reste **le seul lecteur** de `metadata.spreadsheet` : tout `analytics/` passe par lui, jamais par une relecture parallèle du JSON. C'est la garantie qu'un chiffre du Super Admin et un chiffre d'un chef de service ne divergeront jamais.

Migration `035` — quatre tables, toutes neuves :

- `daily_metrics(establishment_id, department_id, day, metrics JSONB)` — agrégats précalculés la nuit, un enregistrement par service et par jour. C'est ce qui rend le national instantané à l'échelle.
- `insight_findings(id, kind, severity, scope, subject_id, payload JSONB, detected_at, resolved_at, dismissed_by)` — les constats détectés, avec leur cycle de vie.
- `prepared_actions(id, finding_id, action_type, params JSONB, preview JSONB, status, executed_by, executed_at)` — l'action prête à partir, son aperçu exact, et qui l'a déclenchée.
- `label_dictionary(raw_label, normalized_label, scope, confidence, times_confirmed)` — le dictionnaire national des libellés.

---

## 3. Les quatorze propositions

---

### P1 — Rebrancher le moteur de conformité sur la vraie source *(le socle)*

**Problème résolu.** Le contrôle de conformité avant soumission ne contrôle rien pour les plannings faits au tableur (Fait A). La plateforme *promet* un moteur de règles métier et ne l'applique pas au chemin qu'utilisent réellement les chefs de service. Aucun indicateur de conformité national n'est donc crédible aujourd'hui.

**Comment l'« IA » fonctionne, précisément.** On n'écrit pas un nouveau moteur : on lui donne à manger. Un adaptateur `analytics/shifts-view.js` expose, pour un planning donné, la **même forme de données** que celle attendue par `evaluateRule` (`user_id`, `shift_date`, `start_time`, `end_time`, `is_overnight`, `duration_hours`, `role_code`), mais construite depuis `spreadsheet-reader.guardEntries()` et jointe à `shift_types` par le code de garde. `evaluateRules` reçoit alors cet ensemble au lieu d'un `SELECT FROM shifts` vide, via un paramètre optionnel — donc **sans changer son comportement pour les plannings déjà alimentés par `shifts`** (wizard, visuel, import). Les cinq règles système s'activent enfin réellement :

- `REST_MIN_11H` — repos minimum entre deux gardes, calculé sur les horaires réels du type de garde ;
- `NO_DOUBLE_SAME_DAY` — double affectation le même jour ;
- `NO_GUARD_DURING_ABSENCE` — croisement avec les congés validés : votre exigence, enfin tenue par le moteur ;
- `BALANCE_MAX_VARIANCE_20PCT` — écart de charge entre agents ;
- plus les règles propres à l'établissement dans `establishment_rules`.

Chaque violation part dans `rule_evaluations` (déjà prévu) et le job nocturne réévalue les plannings en cours pour capter les dérives apparues **après** la soumission (un congé posé après coup, un remplacement).

**Ce que l'utilisateur voit et fait.** Un onglet **Conformité** au national : taux de conformité global, classement des établissements, top des règles violées, et le détail cliquable jusqu'à l'agent et à la date. Côté chef de service, rien de nouveau à apprendre : le message d'erreur de soumission existe déjà, il devient simplement exact. Le Super Admin peut, en un clic, demander une correction au directeur concerné (P4).

**Données et fonctionnalités nécessaires.** `spreadsheet-reader.js`, `shift_types`, `absences` (congés validés), `establishment_rules`, `rule_evaluations`, `rules-engine.evaluateRule`.

**Difficulté : moyenne.** Le moteur, les règles et la table existent. Le travail réel est l'adaptateur et la traduction code de garde → horaires, plus une vigilance forte sur la non-régression : un planning aujourd'hui soumissible ne doit pas se retrouver bloqué du jour au lendemain. **Mise en service en deux temps obligatoire** : d'abord en mode « signalement seul » (on mesure, on n'empêche rien), puis bascule en mode bloquant établissement par établissement, sur décision du Super Admin.

**Valeur utilisateur : élevée mais indirecte.** Personne ne réclamera cette fonction ; sans elle, six des propositions suivantes affichent des chiffres faux.

**Exemple concret.** Le service de réanimation de l'hôpital régional de Gafsa soumet le planning de septembre. Le moteur relève : *« Dr Sassi — garde de nuit le 12 puis garde de jour le 13 : 9 h de repos, minimum légal 11 h »* et *« Mme Ben Ali est en congé validé du 8 au 15 et affectée en garde le 11 »*. Aujourd'hui, ces deux plannings passent sans un mot.

---

### P2 — Centre de pilotage national : l'indice de tension

**Problème résolu.** Pour savoir où ça brûle, le Super Admin doit ouvrir les établissements un par un et lire sept onglets. Rien ne hiérarchise, rien n'alerte. À dix hôpitaux c'est pénible ; à cent c'est impossible.

**Comment l'« IA » fonctionne, précisément.** Un **score de tension de 0 à 100** par établissement (et par service), recalculé chaque nuit et à la demande, composé de neuf signaux normalisés :

| Signal | Source | Poids |
|---|---|---|
| Couverture des gardes | jours de la période sans garde publiée / jours totaux (`spreadsheet-reader`) | 20 |
| Pointage effectif | `shift_events` de type présence / effectif attendu du jour | 15 |
| Absentéisme | `absences` (jours-agents absents / jours-agents prévus) | 15 |
| Retards | somme des `late_minutes` rapportée à l'effectif | 10 |
| Remplacements non confirmés | `replacement_items` en attente | 10 |
| Alertes ouvertes non traitées | `service_alerts` ouvertes, pondérées par ancienneté | 10 |
| Propositions de changement en attente | `schedule_change_proposals` | 5 |
| Circulaires non lues | `notes` ÷ `note_reads` | 5 |
| Retard de soumission | date de soumission vs début de période | 10 |

Normalisation en deux régimes, ce qui règle le problème du démarrage à froid :

- **à froid** (moins de 6 semaines d'historique ou moins de 5 établissements) : seuils absolus livrés avec le produit, issus de la réglementation et du bon sens métier ;
- **à chaud** : chaque signal est comparé à **sa propre médiane glissante sur 8 semaines** et à l'écart absolu médian (MAD) — statistique robuste qui fonctionne sur petit échantillon et ne s'affole pas sur une valeur extrême, contrairement à la moyenne et à l'écart-type.

Le score n'est jamais affiché seul : le moteur retourne **les trois signaux qui y contribuent le plus**, chacun traduit en une phrase française par gabarit (`analytics/narrative.js`). Pas de boîte noire.

**Ce que l'utilisateur voit et fait.** Un écran d'accueil « Pilotage national » : bandeau de KPI nationaux, puis une grille d'établissements triés par tension décroissante, colorés, avec la variation par rapport à la semaine précédente. Un clic ouvre un panneau : *« Tension 78/100, en hausse de 12 points. 1. Le pointage n'a été fait que 2 jours sur 7 dans 3 services. 2. Quatre remplacements attendent confirmation depuis plus de 48 h. 3. Le planning d'octobre du bloc opératoire n'est pas soumis à J-6. »* Sous chaque cause, l'action préparée correspondante (P4).

**Données et fonctionnalités nécessaires.** `daily_metrics` (nouvelle table), `shift_events`, `absences`, `replacement_items`, `service_alerts`, `schedule_change_proposals`, `notes`/`note_reads`, `schedules` + `planning_state()`, `spreadsheet-reader`.

**Difficulté : moyenne.** Aucun algorithme exotique : des agrégats SQL, une normalisation robuste et une pondération. Le vrai travail est le précalcul nocturne et le réglage des poids.

**Valeur utilisateur : très élevée.** C'est la fonction qui transforme le métier : on ne cherche plus les problèmes, ils se présentent classés.

**Exemple concret.** Lundi 8 h, le Super Admin ouvre la plateforme. Trois établissements sont en rouge. Le premier est rouge parce qu'un service n'a plus pointé depuis jeudi — un problème qu'il aurait sinon découvert trois semaines plus tard, dans un rapport mensuel.

---

### P3 — Détecteur d'incohérences inter-établissements *(l'œil que personne d'autre n'a)*

**Problème résolu.** Chaque chef de service ne voit que son service ; chaque directeur, que son hôpital. Un agent inscrit en garde le même jour dans deux établissements, ou en garde alors qu'il est prêté ailleurs, est **structurellement invisible** pour tous — sauf pour le Super Admin, qui n'a aujourd'hui aucun outil pour le voir. C'est un risque de sécurité des soins et une faille de paie.

**Comment l'« IA » fonctionne, précisément.** Un balayage nocturne construit un index unique `(user_id, jour)` sur **tous** les établissements, en fusionnant : les gardes des tableurs actifs (`spreadsheet-reader.rosterOnDate`), la couche de remplacements (`replacement_items`), les prêts (`staff_loan_requests`), les congés et absences (`absences`). Puis six familles de contradictions sont recherchées :

1. **Double garde le même jour dans deux services ou deux établissements** — hors garde à domicile explicitement compatible ;
2. **Garde pendant un congé validé** — le contrôle croisé, y compris quand le congé a été posé *après* la soumission du planning ;
3. **Repos de sécurité non respecté à cheval sur deux services** — nuit dans un service, jour dans un autre : aucun moteur mono-service ne peut le voir ;
4. **Prêt contradictoire** — un agent prêté à l'hôpital B et simultanément de garde dans son service d'origine ;
5. **Service à découvert par un prêt sortant** — le prêt vide le service prêteur en dessous de son effectif minimal ;
6. **Chaîne de remplacement circulaire** — A remplace B qui remplace A sur des périodes qui se chevauchent.

Chaque contradiction devient un `insight_findings` typé, avec les identifiants exacts, la date, et la phrase explicative. La sévérité est déduite du type, pas devinée.

**Ce que l'utilisateur voit et fait.** Un onglet **Intégrité** listant les contradictions par gravité, avec les deux faces du conflit côte à côte (les deux plannings, les deux services, les deux hôpitaux) et un lien direct vers chacune. Actions préparées : notifier les deux chefs de service concernés avec un message qui décrit précisément le conflit, ouvrir une alerte de service, ou marquer le constat comme justifié avec un motif tracé.

**Données et fonctionnalités nécessaires.** `spreadsheet-reader`, `schedules` + `planning_state()`, `absences`, `replacement_items`, `staff_loan_requests`, `shift_types`, `departments`, `establishments`.

**Difficulté : moyenne.** Beaucoup de croisements, mais tous déterministes. Le point délicat est la **garde à domicile** (`atHome`), qui est une compatibilité légitime et non un conflit : la règle doit la traiter explicitement, sinon la fonction crie au loup.

**Valeur utilisateur : très élevée.** C'est le seul type de constat que la plateforme ne peut produire *que* depuis le Super Admin. Argument d'appel d'offres difficile à contrer.

**Exemple concret.** *« Mohamed Trabelsi, matricule 40218 — de garde de nuit le 14 septembre en Chirurgie à l'hôpital régional de Béja, et de garde de jour le 15 septembre aux Urgences du CHU de Tunis, où il est prêté. 8 h de repos entre les deux. »* Deux plannings valides, deux hôpitaux, un agent, un risque : personne ne pouvait le voir.

---

### P4 — Le copilote d'actions préparées *(l'IA qui fait, pas seulement qui dit)*

**Problème résolu.** Même quand un problème est identifié, le traiter demande cinq à dix clics dans trois écrans : retrouver l'établissement, retrouver le directeur, rédiger un message, choisir les destinataires, envoyer, puis se souvenir de relancer. C'est cette friction, et non le diagnostic, qui fait que rien n'est traité.

**Comment l'« IA » fonctionne, précisément.** Chaque `insight_findings` est associé par une table de correspondance déterministe à un ou plusieurs `prepared_actions`. L'action n'est pas une intention : c'est un **objet complet et prévisualisable**, dont tous les paramètres sont déjà résolus (destinataires, corps du message rédigé par gabarit, entités visées, période). Neuf types d'action pour commencer :

| Type | Effet | Réversible |
|---|---|---|
| `notify_director` | notification ciblée, texte pré-rédigé | oui |
| `notify_chief` | notification au chef de service concerné | oui |
| `publish_circular` | crée une `note` de portée choisie | oui (dépublication) |
| `open_alert` | crée une `service_alerts` | oui (clôture) |
| `request_correction` | demande de correction de planning tracée | oui |
| `remind_unread` | relance ciblée sur les circulaires non lues | oui |
| `generate_report` | produit le bulletin institutionnel (P9) | oui |
| `reset_director_password` | réutilise l'endpoint existant | non — double confirmation |
| `archive_dormant_account` | archivage, jamais suppression | oui (désarchivage) |

Le flux est strict : **prévisualisation exacte → clic → exécution → trace**. `audit_logs` reçoit l'action avec `old_values`/`new_values`, l'IP réelle du Super Admin, et l'identifiant du `finding` d'origine. L'auteur est **toujours l'humain qui a cliqué** : aucune action n'est jamais attribuée au « système ». C'est la condition pour rester compatible avec votre exigence de traçabilité constante et non modifiable.

Garde-fous : une action périmée (le problème s'est résolu entre-temps) est automatiquement invalidée et le bouton disparaît ; les actions irréversibles demandent une seconde confirmation nommant explicitement la cible ; une file d'exécution évite qu'un même directeur reçoive douze notifications en dix secondes.

**Ce que l'utilisateur voit et fait.** Une **file d'actions** dans le pilotage national : *« 7 actions proposées »*. Chaque ligne montre le constat, le texte exact qui partira, les destinataires nommés, et deux boutons : **Exécuter** / **Écarter** (avec motif). Sélection multiple pour traiter dix constats du même type en un clic. Un onglet **Historique des actions** montre tout ce qui a été exécuté, par qui, quand, et l'effet obtenu.

**Données et fonctionnalités nécessaires.** `insight_findings` et `prepared_actions` (nouvelles), et surtout la **réutilisation des mécanismes existants** : `createNotification`, le module `notes`, `service_alerts`, `history.controller.log`, `audit_logs`, `realtime/emit`. Nouveau module `admin-copilot` en POST, séparé de `admin-oversight` qui reste en lecture seule.

**Difficulté : moyenne.** Le socle est simple ; la rigueur porte sur la prévisualisation fidèle, l'invalidation des actions périmées et l'irréprochabilité de la trace.

**Valeur utilisateur : très élevée.** C'est littéralement ce que vous demandiez : exécuter des tâches à la place de l'utilisateur, sans lui retirer la décision.

**Exemple concret.** *« Hôpital régional de Kasserine — le planning d'octobre du service de Pédiatrie n'est pas soumis, à 6 jours du début de période. »* Bouton **Relancer le directeur** : le message est déjà écrit — *« Le planning de garde du service de Pédiatrie pour la période du 1er au 31 octobre n'a pas encore été soumis. Le début de période est dans 6 jours. Merci de procéder à la soumission ou d'indiquer la difficulté rencontrée. »* Un clic. Envoyé, tracé, et le constat se referme tout seul quand le planning arrive.

---

### P5 — Contrôle d'intégrité des déclarations *(les gardes fictives)*

**Problème résolu.** Le pointage est déclaratif. Rien n'empêche aujourd'hui de pointer douze agents en quatre secondes, trois jours après coup, ou de déclarer présent un agent en congé. Sur un dispositif qui peut servir de base au paiement des gardes, c'est une faille de contrôle interne — exactement ce qu'un audit de tutelle cherche.

**Comment l'« IA » fonctionne, précisément.** Huit détecteurs statistiques et logiques sur `shift_events`, `absences`, `activity_logs` et `audit_logs` :

1. **Déclaration rétroactive** — écart entre `duty_date` et l'horodatage de saisie supérieur à 24 h ;
2. **Pointage en rafale** — N événements du même déclarant en moins de 60 secondes, incompatible avec un appel réel ;
3. **Pointage hors plage plausible** — appel du jour saisi à 3 h du matin pour une garde de jour ;
4. **Taux de justification aberrant** — part d'absences « justifiées » d'un service à plus de 2 MAD au-dessus de la distribution nationale ;
5. **Déclarant unique** — un seul compte réalise plus de 95 % des pointages d'un service sur 30 jours, y compris pendant ses propres congés ;
6. **Partage de session** — plusieurs comptes actifs depuis la même `ip_address` dans la même minute (`activity_logs`) ;
7. **Présent alors qu'en congé validé** — croisement `shift_events` × `absences` ;
8. **Modification après soumission** — écriture sur un planning en état soumis ou en cours, via `audit_logs` et `schedule_versions`.

Aucun détecteur ne conclut à une fraude : chacun produit un **constat factuel daté** et un niveau de vraisemblance. La qualification reste humaine. C'est un point de rédaction important, juridiquement et socialement.

**Ce que l'utilisateur voit et fait.** Dans **Intégrité**, une seconde section « Qualité des déclarations », avec le motif, les faits, et une frise horodatée reconstituant la séquence exacte des saisies. Actions préparées : demander une explication au service, ouvrir une alerte, ou classer sans suite avec motif.

**Données et fonctionnalités nécessaires.** `shift_events` (avec `duty_date` et `created_at`), `absences`, `activity_logs` (`ip_address`, `user_agent`), `audit_logs`, `schedule_versions`, `users`.

**Difficulté : moyenne.** Les données sont toutes là. La difficulté est de **calibrer pour ne pas accuser à tort** : chaque détecteur doit être livré avec sa marge et un mode d'apprentissage (un constat écarté par l'humain relève le seuil de ce service — réutilisation exacte du motif `was_confirmed`/`was_rejected` de `learned_columns`).

**Valeur utilisateur : élevée.** Et l'impact institutionnel est maximal : c'est le contrôle interne que réclame toute tutelle qui finance des gardes.

**Exemple concret.** *« Service des Urgences, hôpital de Médenine — les 12 pointages du 3 septembre ont été enregistrés entre 14 h 22 min 03 s et 14 h 22 min 09 s par le même compte, pour une garde débutant à 8 h. Les 3, 4 et 5 septembre ont été saisis le 6 septembre. »* Les faits, pas le verdict.

---

### P6 — Indice d'équité des gardes *(le meilleur rapport valeur / coût)*

**Problème résolu.** L'inégalité de répartition des gardes est la première cause de conflit social dans un service hospitalier — et personne ne la mesure. Un agent qui fait tous les dimanches finit par le dire fort ; aucun écran ne le montrait avant.

**Comment l'« IA » fonctionne, précisément.** Pour chaque service et chaque période, à partir de `spreadsheet-reader.countGuards()` :

- nombre de gardes par agent, puis **coefficient de Gini** et coefficient de variation ;
- **part des gardes pénibles** par agent : nuits, week-ends, jours fériés (croisement avec `public_holidays`) ;
- **détection de motif récurrent** : le même agent sur le même jour de semaine plus de 3 fois dans le mois — c'est ce cas, plus que la moyenne, qui déclenche les conflits ;
- **écart au reste du service** : agents à plus de 2 MAD de la médiane, dans les deux sens (surchargés *et* épargnés, l'iniquité inverse comptant autant) ;
- neutralisation honnête des congés : un agent absent la moitié du mois n'est pas « épargné », son compte est ramené au prorata de sa disponibilité réelle.

Une fois `daily_metrics` alimenté, la même mesure devient **comparable nationalement** : classement des services par équité, ce qui permet à la tutelle de désigner des pratiques exemplaires plutôt que seulement des fautifs.

**Ce que l'utilisateur voit et fait.** Un onglet **Équité** : classement national des services, avec pour chacun sa courbe de répartition et le détail par agent (gardes, nuits, week-ends, fériés, part relative). Action préparée : demander une redistribution au chef de service, avec le constat chiffré joint au message.

**Données et fonctionnalités nécessaires.** `spreadsheet-reader.countGuards` et `distinctStaff`, `public_holidays`, `absences`, `users` (grade, fonction), `daily_metrics` pour le national.

**Difficulté : faible.** Tout est déjà lisible : `countGuards` existe, les fériés existent, le calcul de Gini fait dix lignes. C'est la proposition la moins chère du document.

**Valeur utilisateur : élevée, et immédiatement perceptible.** Elle parle à tout le monde : agents, chefs, directeurs, tutelle.

**Exemple concret.** *« Service de Chirurgie, CHU de Sousse, septembre — Gini 0,34. Dr Amri : 11 gardes dont 4 dimanches ; Dr Khelifi : 3 gardes dont 0 week-end. Écart de charge de 3,7 fois pour deux agents de même grade et de disponibilité comparable. »*

---

### P7 — Prévision de couverture à 60 jours

**Problème résolu.** Tout est retrospectif. Un service qui va manquer d'effectif le troisième week-end d'octobre le découvre le troisième week-end d'octobre.

**Comment l'« IA » fonctionne, précisément.** Pour chaque service, jour par jour sur 60 jours, on calcule une **disponibilité prévisionnelle** :

```
disponible(j) = effectif actif
              − congés validés couvrant j        (absences, kind = congé)
              − prêts sortants confirmés sur j   (staff_loan_requests)
              + prêts entrants confirmés sur j
              − indisponibilités structurelles
```

puis on la compare au **besoin** estimé, dans cet ordre de préférence : la règle d'effectif minimal de `establishment_rules` si elle existe ; sinon le modèle de garde du service (`schedule_templates`, `schedule_cycles`) ; sinon la **médiane par jour de semaine de l'effectif réellement de garde sur les 8 dernières semaines** (`spreadsheet-reader`), corrigée d'un facteur férié tiré de `public_holidays`.

C'est un **modèle additif calendaire**, pas un réseau de neurones : médiane glissante par jour de semaine + effets férié et veille de férié + charge de congés. Robuste, calculable en SQL, et surtout **explicable ligne à ligne** — indispensable devant une tutelle. À froid, sans historique, le modèle se replie sur l'effectif du dernier planning publié et le signale explicitement : *« estimation fondée sur 1 seule période observée »*. Une prévision doit annoncer sa propre fragilité.

**Ce que l'utilisateur voit et fait.** Une bande de 60 jours par service, colorée du vert au rouge, les jours sous le seuil marqués. Au survol : *« 21 septembre — 4 agents disponibles pour 7 attendus. 2 congés validés, 1 prêt sortant vers l'hôpital de Zaghouan. »* Actions préparées : alerter le directeur, ou suggérer un prêt entrant depuis un service excédentaire identifié par le même calcul.

**Données et fonctionnalités nécessaires.** `users` (actifs, par service), `absences`, `staff_loan_requests`, `public_holidays`, `establishment_rules`, `schedule_templates`/`schedule_cycles`, `spreadsheet-reader`, `daily_metrics`.

**Difficulté : élevée.** Non pas pour le calcul, mais pour la **définition du besoin**, qui n'est aujourd'hui formalisée nulle part de façon fiable. C'est le vrai chantier : sans un besoin par service, une prévision de manque n'a pas de référence.

**Valeur utilisateur : élevée** — c'est le passage du constat à l'anticipation, mais la fonction ne devient juste qu'après le travail sur le besoin.

**Exemple concret.** Le 20 août, le Super Admin voit trois dimanches d'octobre en rouge en Réanimation à Kairouan : six agents en congé simultanément, validés par trois chefs différents qui ne se sont pas coordonnés. Sept semaines pour corriger, au lieu d'une garde non couverte.

---

### P8 — Équité territoriale et déserts de garde

**Problème résolu.** La plateforme sait où sont les hôpitaux (latitude et longitude sont stockées) mais ne sait pas dire si un territoire est couvert. Or « l'égalité d'accès aux soins sur le territoire » est le vocabulaire exact d'un ministère de la Santé.

**Comment l'« IA » fonctionne, précisément.** Trois calculs géographiques, tous déterministes :

1. **Nuit non couverte** — pour chaque nuit et chaque délégation, les établissements sans aucune garde publiée ni déclarée ;
2. **Distance au premier recours** — pour chaque établissement non couvert, la distance **haversine** vers l'établissement couvert le plus proche, à partir de `latitude`/`longitude` (`NUMERIC(9,6)`) ;
3. **Densité de garde** — agents de garde par établissement rapportés au type d'établissement, agrégés par gouvernorat, pour révéler l'écart entre le littoral et l'intérieur.

Aucune donnée externe, aucun service de cartographie appelé : haversine est une formule de dix lignes, et les coordonnées sont déjà en base.

**Ce que l'utilisateur voit et fait.** La carte existante (`SuperAdminMapPage.jsx`) gagne un mode **Couverture** : un curseur de date, les établissements colorés selon la couverture de la nuit, les zones sans couverture matérialisées, et un classement des gouvernorats. Export du constat pour un rapport. Action préparée : signaler la non-couverture aux directeurs concernés.

**Données et fonctionnalités nécessaires.** `establishments` (`latitude`, `longitude`, `governorate`, `delegation`, `type`), `spreadsheet-reader`, `shift_events`, `daily_metrics`, la carte existante.

**Difficulté : moyenne.** Le calcul est simple ; l'effort porte sur la lisibilité cartographique et sur la définition de « couvert » (une garde à domicile compte-t-elle comme une couverture ? Décision métier à arbitrer, pas technique).

**Valeur utilisateur : élevée pour un pilote national**, faible pour un directeur d'hôpital. C'est une fonction de tutelle.

**Exemple concret.** *« Nuit du 14 au 15 septembre — aucune garde déclarée dans la délégation de Haffouz. Établissement couvert le plus proche : hôpital de Kairouan, à 47 km. »* C'est la diapositive qui fait basculer une soutenance d'appel d'offres.

---

### P9 — Bulletin institutionnel automatique, français et arabe

**Problème résolu.** Produire le rapport mensuel pour la tutelle est un travail manuel de plusieurs heures, refait chaque mois, et la plateforme ne fournit aucun document imprimable présentable.

**Comment l'« IA » fonctionne, précisément.** Un générateur qui assemble les indicateurs du mois (couverture, absentéisme, retards, conformité P1, équité P6, intégrité P5, incidents, prêts, territoire P8), calcule les variations par rapport au mois précédent et au même mois de l'année passée, puis **rédige le commentaire en français par gabarits à conditions** :

```
« L'absentéisme national s'établit à {taux} %, {en hausse|en baisse|stable}
  de {delta} point{s} par rapport à {mois précédent}.
  {si concentration > 40 % : « {n} établissements concentrent {part} %
  des absences non justifiées. »} »
```

Les gabarits sont écrits par un humain, une fois. Le choix entre les variantes est fait par les données. Le résultat est fluide, **toujours exact, jamais inventé** — un LLM local ne ferait pas mieux et pourrait halluciner un chiffre. La version arabe utilise le motif `_ar` déjà présent dans le schéma et `users.preferred_language`.

**Ce que l'utilisateur voit et fait.** Un onglet **Bulletin** : sélection du mois et du périmètre (national, gouvernorat, établissement), aperçu paginé et imprimable, sections décochables, commentaires éditables avant diffusion. Puis un clic : **Diffuser aux directeurs** (notification + circulaire) ou **Imprimer / exporter**. Génération automatique le 1er de chaque mois par le job nocturne, en attente de validation.

**Données et fonctionnalités nécessaires.** `daily_metrics`, `schedule_snapshots`, `rule_evaluations`, `insight_findings`, `absences`, `shift_events`, `staff_loan_requests`, `establishments`, module `notes`, `createNotification`.

**Difficulté : moyenne.** Les calculs viennent des propositions précédentes ; l'effort est la mise en page imprimable et l'écriture des gabarits.

**Valeur utilisateur : élevée.** Et c'est **l'artefact que le ministère emporte avec lui**. Dans un appel d'offres, un document institutionnel généré en un clic pèse plus lourd qu'un bel écran.

**Exemple concret.** Le 1er octobre à 6 h, le bulletin de septembre est prêt : 6 pages, 14 indicateurs, 9 graphiques, un commentaire de 400 mots, et la liste des trois établissements à accompagner en priorité. Le Super Admin relit, ajuste une phrase, diffuse.

---

### P10 — Hygiène de la plateforme et comptes dormants

**Problème résolu.** Une plateforme multi-établissements se dégrade en silence : directeurs jamais connectés, services sans chef, agents sans service, établissements actifs sans aucun planning depuis trois mois, comptes archivés jamais nettoyés. Aucun écran ne le montre, et c'est exactement ce qu'un audit trouve en premier.

**Comment l'« IA » fonctionne, précisément.** Un audit nocturne, dix vérifications typées, chacune avec son remède préparé :

| Constat | Détection | Remède préparé |
|---|---|---|
| Compte jamais connecté depuis sa création (> 30 j) | `users.last_login IS NULL` | relancer / archiver |
| Compte dormant (> 90 j sans connexion) | `last_login`, `activity_logs` | relancer / archiver |
| Directeur inactif alors que l'établissement est actif | croisement rôle / connexions | relancer / réinitialiser le mot de passe |
| Service sans chef | `job_titles` × `user_departments` | notifier le directeur |
| Agent sans service | `user_departments` vide | notifier le directeur |
| Établissement actif sans planning depuis 90 j | `schedules` | ouvrir un signalement |
| Établissement sans coordonnées GPS | `latitude IS NULL` | demander la saisie |
| Jours fériés non chargés pour l'année à venir | `public_holidays` | **précharger** (endpoint existant) |
| Demandes de changement de profil en attente > 15 j | `profile_change_requests` | relancer le directeur |
| Circulaire importante non lue par > 50 % des destinataires | `notes` × `note_reads` | relancer les non-lecteurs |

**Ce que l'utilisateur voit et fait.** Un onglet **Hygiène** avec un score de santé de la plateforme et une liste de tâches, groupées par type, avec sélection multiple : *« 12 comptes jamais connectés depuis plus de 30 jours »* → tout sélectionner → **Relancer** ou **Archiver**. Le score remonte visiblement à mesure qu'on traite : c'est motivant, et c'est démonstratif.

**Données et fonctionnalités nécessaires.** `users`, `activity_logs`, `user_departments`, `job_titles`, `schedules`, `establishments`, `public_holidays`, `profile_change_requests`, `notes`/`note_reads`, plus les endpoints existants (relance de mot de passe, archivage, préchargement des fériés).

**Difficulté : faible.** Dix requêtes SQL et une liste. Aucun concept nouveau.

**Valeur utilisateur : élevée et immédiate.** Et c'est l'illustration la plus lisible du « l'IA travaille pour vous » : un écran qui donne dix choses à faire et les fait.

**Exemple concret.** *« 4 directeurs n'ont jamais ouvert leur compte, créé il y a plus de 45 jours : Béja, Le Kef, Siliana, Zaghouan. »* Tout sélectionner, **Relancer** : quatre notifications parties, tracées. Ces quatre hôpitaux n'auraient jamais démarré.

---

### P11 — Kit de démarrage d'un établissement *(normalisation par similarité)*

**Problème résolu.** Créer un établissement produit une page blanche : le directeur doit inventer ses services, ses types de garde, ses règles, ses modèles de colonnes. C'est lent, c'est décourageant, et cela produit exactement l'hétérogénéité qui rend impossible toute statistique nationale. Sur un déploiement de cent hôpitaux, c'est le premier poste de coût.

**Comment l'« IA » fonctionne, précisément.** À la création, le système propose une configuration complète, dérivée des établissements **les plus similaires** déjà configurés. Similarité par score pondéré simple : même `type` (poids fort), bande d'effectif comparable, même gouvernorat ou région, puis, entre candidats à égalité, celui dont la configuration est la plus **utilisée et la plus stable** (le moins modifié après création — signe qu'elle convient). Le kit propose : liste de services, types de garde et horaires, `establishment_rules`, modèles de colonnes de tableur, modèles de planning, jours fériés de l'année.

À froid, sans aucun établissement de référence, le système livre un **référentiel national par type** (CHU / hôpital régional / hôpital de circonscription), écrit une fois avec vous. `initEstablishmentDefaults` (`rules-engine.js:129`) fait déjà ce travail pour les règles : le kit en est l'extension aux services, types de garde et modèles.

**Ce que l'utilisateur voit et fait.** Après la création, un panneau **Configuration proposée** : quatre blocs cochables, chacun détaillable et modifiable, avec la mention de sa provenance (*« d'après 3 hôpitaux régionaux de taille comparable »*). Un clic : **Appliquer**. Le directeur reçoit un établissement prêt à l'emploi au lieu d'un formulaire vide.

**Données et fonctionnalités nécessaires.** `establishments` (type, gouvernorat, effectif), `departments`, `shift_types`, `establishment_rules`, `schedule_column_models`, `schedule_templates`, `public_holidays`, `initEstablishmentDefaults`.

**Difficulté : moyenne.** L'appariement est trivial ; le travail est la copie transactionnelle et sûre d'une configuration, et l'écriture du référentiel par type.

**Valeur utilisateur : moyenne pour le Super Admin, très élevée pour le directeur.** Impact business fort : le coût de déploiement par hôpital est un critère chiffré dans un appel d'offres.

**Exemple concret.** Création de l'hôpital régional de Tataouine. Le panneau propose 9 services, 5 types de garde, 6 règles, 2 modèles de tableur et les 13 jours fériés 2026, *« d'après 3 hôpitaux régionaux de taille comparable »*. Le directeur décoche deux services, applique. Trois jours de paramétrage économisés.

---

### P12 — Dictionnaire national des libellés

**Problème résolu.** Chaque hôpital nomme les mêmes choses différemment : « Garde J », « Jour », « M », « Matin », « 8h-20h ». Toute statistique nationale agrégée sur ces libellés est fausse. `learned_columns` a été créée pour ce problème, mais reste **cantonnée à chaque établissement** : le vingtième hôpital réapprend ce que les dix-neuf premiers ont déjà appris.

**Comment l'« IA » fonctionne, précisément.** Un job agrège tous les `learned_columns` du pays, regroupe les libellés bruts par similarité **trigramme** (`pg_trgm`, déjà activé — `001_schema.sql:9`) combinée à la cohérence de `detected_type`, et propose un `label_dictionary` national. La confiance d'une entrée monte avec `times_used` et `was_confirmed`, descend avec `was_rejected` — la boucle d'apprentissage existe déjà, on ne fait que la mettre à l'échelle nationale. Une entrée validée par le Super Admin est ensuite **proposée par défaut à tous les établissements**, y compris aux nouveaux : la plateforme devient plus intelligente à chaque hôpital raccordé.

**Ce que l'utilisateur voit et fait.** Un onglet **Normalisation** : les groupes de libellés candidats, leur fréquence, les établissements concernés, et un bouton **Valider comme libellé national**. Un indicateur de comparabilité indique quel pourcentage des données nationales est agrégeable de façon fiable.

**Données et fonctionnalités nécessaires.** `learned_columns`, `shift_types`, `schedule_column_models`, `pg_trgm`, `label_dictionary` (nouvelle).

**Difficulté : moyenne.**

**Valeur utilisateur : faible en apparence, structurante en réalité.** C'est la condition de validité de tout le reste. À défendre comme telle, pas comme une fonctionnalité.

**Exemple concret.** Le système regroupe « Garde de nuit », « Nuit », « N », « 20h-8h », « garde nuit » sur 7 établissements et propose le libellé national `NUIT`. Validé une fois, l'agrégat national des gardes de nuit devient juste.

---

### P13 — Recherche en langage quasi-naturel, sans aucun LLM

**Problème résolu.** Répondre à *« quel agent a fait le plus de gardes de nuit en juillet à Sfax ? »* demande six écrans et un tableur. La question est simple ; l'obtenir est long.

**Comment l'« IA » fonctionne, précisément.** Pas de modèle de langage : un **catalogue d'environ 40 questions paramétrées**, chacune adossée à une requête SQL écrite et vérifiée par un humain, avec des emplacements typés (établissement, service, période, grade, type de garde, agent). Par-dessus, un **appariement déterministe** en quatre étapes :

1. normalisation de la phrase saisie (minuscules, accents, mots vides) ;
2. reconnaissance des entités par similarité trigramme sur les noms réels en base — établissements, services, agents, gouvernorats, types de garde : `pg_trgm` fait le travail, et « Sfax » comme « CHU Habib Bourguiba » tombent sur le bon établissement ;
3. reconnaissance des expressions de date : « juillet », « le mois dernier », « cette semaine », « depuis janvier », « hier » ;
4. score de correspondance par mots-clés vers les patrons du catalogue.

Si le meilleur score est net, la réponse s'affiche. Sinon, **les trois questions candidates sont proposées** — l'utilisateur choisit, et ce choix renforce la correspondance pour la prochaine fois (même boucle `confidence`/`times_used` que `learned_columns`). Le système ne bluffe jamais : il ne répond que ce qu'il sait calculer.

**Ce que l'utilisateur voit et fait.** Une barre de recherche en tête du dashboard : *« Posez votre question… »*, avec suggestions au fil de la frappe. La réponse s'affiche en tableau ou graphique, avec **la requête en clair** (« Gardes de nuit, CHU de Sfax, juillet 2026, par agent, décroissant »), et trois boutons : **Exporter**, **Épingler au tableau de bord**, **Programmer** (recevoir cette réponse chaque lundi).

**Données et fonctionnalités nécessaires.** Toutes les tables déjà citées, `pg_trgm`, le catalogue de questions (à écrire), une table d'apprentissage des appariements.

**Difficulté : élevée** dans sa version complète — mais **découpable** : le catalogue seul, exposé comme une palette de questions cliquables avec des sélecteurs, est de difficulté moyenne et livre déjà 70 % de la valeur. L'appariement textuel peut venir ensuite.

**Valeur utilisateur : très élevée.** C'est la fonction qui *ressemble* le plus à de l'IA, alors qu'elle n'en contient pas une ligne — et elle est plus fiable qu'un LLM, parce qu'un chiffre inventé est impossible par construction.

**Exemple concret.** *« gardes de nuit juillet sfax »* → *« Gardes de nuit — CHU de Sfax — juillet 2026, par agent »* : un tableau de 23 lignes, Dr Bouzid en tête avec 9 gardes de nuit. Trois secondes au lieu de vingt minutes.

---

### P14 — Simulateur « Et si ? »

**Problème résolu.** Une décision de tutelle — ouvrir un service, muter cinq agents, durcir une règle de repos — est prise sans aucune idée chiffrée de sa conséquence sur la couverture et l'équité.

**Comment l'« IA » fonctionne, précisément.** Un simulateur **sans écriture** qui rejoue les calculs de couverture (P7), d'équité (P6) et de conformité (P1) sur une hypothèse : *n* agents ajoutés ou retirés d'un service, un service ouvert ou fermé, une règle modifiée, un prêt inter-hôpitaux. La brique clé existe déjà et est explicitement conçue pour cela : `assistant-generator.js` porte en en-tête *« Aucune écriture : ce module ne fait que calculer »*. On l'appelle sur un jeu de données modifié en mémoire, et on compare avant / après. `assistant-validator.js` fournit la vérification.

**Ce que l'utilisateur voit et fait.** Un onglet **Simulation** : choix du périmètre, curseurs et champs pour l'hypothèse, puis un tableau avant / après — jours non couverts, Gini, violations de règles, charge moyenne — et la liste des jours qui basculent. Bouton **Exporter la note d'aide à la décision**. Aucune donnée écrite : on peut tout essayer sans risque.

**Données et fonctionnalités nécessaires.** `assistant-generator.js`, `assistant-validator.js`, `analytics/coverage.js`, `analytics/equity.js`, `establishment_rules`, `users`, `absences`.

**Difficulté : élevée.** Il faut isoler proprement les calculs de leur source de données pour les faire tourner sur un jeu hypothétique — un travail d'architecture, pas d'algorithme.

**Valeur utilisateur : moyenne au quotidien, très forte en décision et en démonstration.** *« Que se passe-t-il si je retire 3 agents de la réanimation ? »* est une question à laquelle aucun concurrent ne répondra en séance.

**Exemple concret.** *« Muter 3 infirmiers de la Réanimation de Gabès vers les Urgences »* → *« Réanimation : 4 jours non couverts en octobre (0 aujourd'hui), Gini 0,21 → 0,38, 2 violations de repos minimum. Urgences : 0 jour non couvert, Gini 0,29 → 0,19. »* La décision reste humaine, mais elle est éclairée.

---

## 4. Classement par rapport valeur / impact business / complexité

Méthode : valeur utilisateur et impact business notés de 1 à 5 — l'impact business étant pondéré par **votre objectif d'appel d'offres** — et complexité en 1 (faible) / 2 (moyenne) / 3 (élevée). Score = (valeur × business) ÷ complexité. Le score est un outil de discussion, pas un oracle.

| Rang | Proposition | Valeur | Business | Complexité | Score |
|---|---|---|---|---|---|
| **1** | **P6 — Équité des gardes (Gini)** | 4 | 4 | faible | **16,0** |
| **2** | **P2 — Centre de pilotage national (tension)** | 5 | 5 | moyenne | **12,5** |
| **2** | **P3 — Incohérences inter-établissements** | 5 | 5 | moyenne | **12,5** |
| **4** | **P10 — Hygiène de la plateforme** | 4 | 3 | faible | **12,0** |
| **5** | **P1 — Rebrancher le moteur de conformité** | 4 | 5 | moyenne | **10,0** |
| **5** | **P4 — Copilote d'actions préparées** | 5 | 4 | moyenne | **10,0** |
| **5** | **P5 — Intégrité des déclarations** | 4 | 5 | moyenne | **10,0** |
| **5** | **P8 — Équité territoriale / déserts de garde** | 4 | 5 | moyenne | **10,0** |
| **5** | **P9 — Bulletin institutionnel FR/AR** | 4 | 5 | moyenne | **10,0** |
| **10** | **P7 — Prévision de couverture à 60 jours** | 4 | 5 | élevée | **6,7** |
| **10** | **P13 — Recherche quasi-naturelle** | 5 | 4 | élevée | **6,7** |
| **12** | **P11 — Kit de démarrage d'établissement** | 3 | 4 | moyenne | **6,0** |
| **13** | **P14 — Simulateur « Et si ? »** | 3 | 5 | élevée | **5,0** |
| **14** | **P12 — Dictionnaire national des libellés** | 2 | 4 | moyenne | **4,0** |

### Une correction au classement brut, à assumer

Le score isolé est trompeur sur deux points, et il faut le dire :

- **P1 doit être fait en premier**, malgré son rang 5. Non pour sa valeur propre, mais parce que **P2, P3, P6 et P9 afficheront des chiffres faux sans lui** au niveau national, et parce qu'il corrige une promesse aujourd'hui creuse. Le faire après, c'est publier des indicateurs qu'il faudra ensuite désavouer — le pire scénario possible devant une tutelle.
- **P12 est dernier au score et pourtant structurant.** Il ne se vend pas seul : il s'intègre à P1 comme condition de comparabilité. Ne pas le traiter comme une fonctionnalité candidate, mais comme une dépendance de qualité de la donnée.

---

## 5. Feuille de route en trois phases

### Phase 1 — le socle et les victoires rapides *(fondations + deux écrans démontrables)*

**P1** (mode signalement seul, sans blocage) → **P6** → **P10** → **P2**.

Pourquoi cet ordre : P1 crée la donnée juste ; P6 et P10 sont de difficulté faible et produisent immédiatement deux écrans qui se démontrent ; P2 les fédère dans le centre de pilotage. Livrables : `analytics/`, `daily_metrics`, le job nocturne, `admin-insights` en lecture, et trois nouveaux onglets. À la fin de la phase 1, le Super Admin ouvre un écran et sait où agir.

### Phase 2 — le contrôle et l'institution *(l'argument d'appel d'offres)*

**P4** (le copilote, qui donne un débouché à tous les constats) → **P3** → **P5** → **P9** → **P8**.

C'est ici qu'apparaissent le module d'écriture `admin-copilot`, la file d'actions, et le bulletin institutionnel. À la fin de la phase 2, vous avez de quoi soutenir un appel d'offres : conformité prouvée, contrôle interne, équité territoriale, document officiel généré en un clic.

### Phase 3 — l'anticipation *(différenciation)*

**P13** (d'abord le catalogue de questions, puis l'appariement textuel) → **P7** (après avoir formalisé le besoin par service) → **P11** → **P14** → **P12** (en continu).

---

## 6. Ce qu'il me faut de vous pour démarrer la phase 1

Cinq points, dont aucun n'est technique. Ce sont des arbitrages métier que je ne peux pas prendre à votre place.

1. **Le besoin en effectif par service** existe-t-il quelque part sous forme écrite — une note de service, une règle, un usage — ou faut-il l'inférer de l'historique ? C'est le verrou de P7, et cela influence P2.
2. **La garde à domicile compte-t-elle comme une couverture** pour le calcul de couverture territoriale (P8) et comme une compatibilité pour les doubles affectations (P3) ? Le champ `atHome` existe ; sa signification réglementaire vous appartient.
3. **P1 doit-il finir par bloquer la soumission** d'un planning non conforme, ou rester un signalement permanent ? Je recommande fortement : signalement d'abord partout, blocage ensuite, activé établissement par établissement — sinon des plannings aujourd'hui acceptés deviendront brusquement refusés.
4. **La pondération de l'indice de tension** (P2) : les neuf signaux et leurs poids sont un point de vue métier. Je propose les valeurs du tableau comme base de discussion, pas comme vérité.
5. **La devise et le libellé officiels** pour les montants dans les documents institutionnels : **TND** confirmé par le bornage GPS tunisien, contre le commentaire DZD de `007_salary_fields.sql` — je corrige ce commentaire au passage ?

Et une confirmation de principe : tout ce qui précède est **strictement additif**. Le tableur, l'appel du jour, les remplacements en surcouche, les prêts, les circulaires, la supervision et la « Garde en direct » ne sont pas touchés. Les seuls fichiers existants que je modifierais sont `SuperAdminDashboard.jsx` (ajout d'onglets), `backend/index.js` (une ligne pour démarrer le job) et `rules-engine.js` (un paramètre optionnel sur `evaluateRules`, sans changement de comportement par défaut).
