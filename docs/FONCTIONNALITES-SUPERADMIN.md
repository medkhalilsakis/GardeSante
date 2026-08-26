# Fonctionnalités Super Admin — catalogue de propositions

> Objet : des **actions concrètes** que le Super Admin peut exécuter, sur le modèle de « ajouter un
> établissement ». Aucune IA, aucun modèle prédictif — uniquement des fonctionnalités de gestion,
> dans le thème et le vocabulaire actuels de la plateforme.
>
> Ce document remplace `docs/STRATEGIE-SUPERADMIN-IA.md`, qui répondait à une autre question.

---

## 1. Ce que le Super Admin peut déjà faire — à ne pas proposer deux fois

Inventaire vérifié dans le code, pas de mémoire.

| Il peut déjà | Où |
|---|---|
| **Créer un établissement** (avec code, type, adresse détaillée, gouvernorat, coordonnées GPS) | `POST /establishments` — `establishments.controller.js:create` |
| **Modifier / désactiver / réactiver** un établissement, en cascade | `PUT/DELETE /establishments/:id`, `PUT /admin/establishments/:id/deactivate` |
| **Créer, remplacer, retirer le directeur** d'un établissement | `PUT/DELETE /establishments/:id/director` |
| **Réinitialiser le mot de passe du directeur**, activer/suspendre son compte | `PUT /admin/establishments/:id/director/password` et `/toggle-status` |
| **Consulter le personnel** d'un établissement, modifier ou retirer un membre | `GET /establishments/:id/personnel`, `PUT/DELETE /establishments/personnel/:userId` |
| **Voir l'historique** d'un établissement et **l'historique global de tous les utilisateurs** | `GET /establishments/:id/history`, `GET /history/all` → page `/history`, onglet « Tout » |
| **Voir les utilisateurs connectés** en direct | `GET /admin/online-users` |
| **Gérer les jours fériés nationaux** (CRUD + amorçage Tunisie) | `POST/PUT/DELETE /admin/holidays`, `/holidays/seed-tunisia` |
| **Statistiques globales** et **carte des hôpitaux** | `GET /admin/stats`, page `/admin/carte` |
| **Surveiller un établissement** (panneau de supervision) | `/api/admin-oversight` → `EstablishmentOversightPanel` |
| **Traiter les demandes de modification de profil** | page `/admin/profile-requests` |
| **Archiver / restaurer un compte** | module `user-archive` |

**Le menu Super Admin ne compte aujourd'hui que 3 entrées** (`Sidebar.jsx:71-82`) : *Tableau de bord*,
*Carte des hôpitaux*, *Demandes profil*. Et le dossier `pages/superadmin/` ne contient que 4 fichiers.

### Le constat en une phrase

> Le Super Admin **crée** des établissements et **regarde** ce qui s'y passe. Il ne **gouverne** rien au
> niveau national : ni les référentiels communs, ni les comptes, ni les échéances, ni la communication.

Les 21 propositions ci-dessous comblent exactement cet écart.

---

## 2. Famille A — Communiquer avec le réseau

### A1 · Circulaires nationales aux directeurs 🥇 *le backend est déjà écrit*

**Ce que fait le Super Admin** — rédige une circulaire (titre, corps, priorité, pièces jointes),
choisit « Tous les directeurs de la plateforme », publie. Chaque directeur la reçoit immédiatement
avec notification, et le Super Admin voit **qui l'a lue** et qui ne l'a pas ouverte.

**Ce qui existe déjà** — **tout le backend**. `notes.controller.js:42` :
`resolveScope()` renvoie `'platform_directors'` dès que `isSuperAdmin`, `resolveRecipients()`
sélectionne *tous* les directeurs et administrateurs hospitaliers actifs de la plateforme, les pièces
jointes sont acceptées (`upload.array('attachments', 5)`), les accusés de lecture existent
(`markNoteRead`, `listNoteReaders`), et `listNotes:271` autorise explicitement le Super Admin sur
`scope = 'platform_directors'`. La contrainte SQL `chk_note_scope` prévoit déjà cette valeur.

**À créer** — **une seule chose** : rendre l'écran accessible. La route `/notes` existe déjà
(`App.jsx:280`, ouverte à tous les rôles) mais **elle est absente de `superAdminNav`**. Il suffit
d'ajouter l'entrée de menu, puis d'adapter le sélecteur de portée du composeur pour afficher
« Tous les directeurs » quand l'utilisateur est Super Admin.

**Difficulté : très faible** (une entrée de menu + un libellé). Fonctionnalité la plus rentable du
catalogue : une capacité entièrement construite qui n'est aujourd'hui **atteignable par personne**.

### A2 · Suivi de diffusion d'une circulaire

**Ce que fait le Super Admin** — ouvre une circulaire publiée et voit un tableau
« Établissement · Directeur · Lue le … / non lue », un taux de lecture, et un bouton **Relancer les
non-lecteurs** qui renvoie une notification aux seuls retardataires.

**Ce qui existe déjà** — `listNoteReaders` renvoie déjà la liste des lecteurs ; le module
`notifications` sait envoyer en masse.

**À créer** — le tableau, le calcul du complémentaire (destinataires − lecteurs) et l'action de
relance. **Difficulté : faible.**

### A3 · Annonce de plateforme et mode maintenance

**Ce que fait le Super Admin** — publie un bandeau visible par **tous les utilisateurs** de tous les
établissements (« Intervention technique samedi de 22 h à 00 h »), avec date de début/fin ; et, si
besoin, bascule la plateforme en **lecture seule** le temps de l'intervention.

**Ce qui existe déjà** — rien : aucun mécanisme de bandeau ni de lecture seule dans le code. Le socket
temps réel, lui, est déjà en place pour diffuser l'annonce sans rechargement.

**À créer** — une petite table `platform_announcements`, un endpoint public de lecture, un bandeau dans
le layout, et — pour la lecture seule — un garde-fou en middleware. **Difficulté : moyenne** (le mode
lecture seule doit être irréprochable : il touche toutes les écritures).

---

## 3. Famille B — Tenir les référentiels nationaux

C'est le trou le plus net du produit : **aucun référentiel n'est modifiable après la migration**, alors
qu'ils déterminent le comportement de toute la plateforme.

### B1 · Types de garde 🥇 *fonctionnalité + correction d'un blocage réel*

**Ce que fait le Super Admin** — gère le catalogue des types de garde : code (`J`, `S`, `N`, `G`…),
libellé FR/AR, heure de début et de fin, durée, chevauchement de nuit, couleur. Il définit un
**catalogue national par défaut** appliqué à tout nouvel établissement, et peut ajuster le catalogue
d'un établissement particulier.

**Ce qui existe déjà** — la table `shift_types` (`001_schema.sql:145`) avec exactement ces colonnes, et
un amorçage `J/S/N/G` par la migration `028_seed_shift_types.sql`. **Dix modules la lisent**
(tableur, export, import, statistiques, remplacements, moteur de règles…).

**Ce qui manque, et qui est grave** — **il n'existe aucune écriture sur `shift_types` dans tout le
code applicatif.** La migration 028 les a créés une fois, pour les établissements qui existaient
**à ce moment-là**. Or `establishments.controller.create` ne les amorce pas : il crée les rôles, les
configs, les types d'absence, les colonnes et les fonctions — **jamais les types de garde**
(`initEstablishmentDefaults` ne traite que colonnes + règles, `rules-engine.js:112`). Conséquence :
**tout établissement créé aujourd'hui naît avec un catalogue de gardes vide**, et le tableur refuse
chaque code saisi avec *« Type de garde introuvable pour le code "J" »* — exactement le blocage que la
migration 028 décrit et prétendait avoir corrigé.

**À créer** — un CRUD `shift_types` réservé au Super Admin + l'amorçage à la création d'établissement.
**Difficulté : faible.** **Priorité maximale** : sans cela, une démonstration sur un hôpital
fraîchement créé se bloque au premier code de garde.

### B2 · Types d'absence et de congé

**Ce que fait le Super Admin** — gère la nomenclature nationale des absences et congés : libellé,
couleur, compte-t-il dans le quota, exige-t-il un justificatif, plafond annuel.

**Ce qui existe déjà** — la table `absence_types` et un amorçage par défaut
(`absence-types.service.js:28`, appelé à la création d'un établissement). Le catalogue est
**lu partout** (appel du jour, congés, journal, remplacements).

**À créer** — le CRUD et l'écran. Aucune API de gestion n'existe. **Difficulté : faible.**

### B3 · Matrice des rôles et permissions

**Ce que fait le Super Admin** — consulte la matrice **rôle × permission** (8 rôles, N permissions) et
active/désactive une case, par établissement ou pour le modèle national.

**Ce qui existe déjà** — les tables `roles`, `permissions`, `role_permissions`, la fonction SQL
`create_roles_for_establishment()` appelée à chaque création d'établissement, et le middleware
`requirePermission` qui les consomme à chaque requête.

**Ce qui manque** — **aucune écriture nulle part** : la matrice est figée depuis la migration et n'a
aucun écran. Personne, pas même le Super Admin, ne peut voir de quoi un rôle est capable.

**À créer** — d'abord un **visualiseur en lecture seule** (valeur immédiate, risque nul, argument fort
en soutenance : « voici la gouvernance des droits »), puis dans un second temps les bascules
d'écriture. **Difficulté : faible en lecture, élevée en écriture** — modifier une permission modifie
le comportement de tous les utilisateurs en direct ; il faudra journaliser chaque bascule et interdire
de se retirer ses propres droits.

### B4 · Référentiel géographique (gouvernorats et délégations)

**Ce que fait le Super Admin** — gère la liste des gouvernorats et de leurs délégations, utilisée par
le formulaire d'établissement et par la carte.

**Ce qui existe déjà** — `GOVERNORATES` est une **constante codée en dur** dans
`admin.controller.js:10`, servie par `GET /admin/governorates`. Les délégations sont saisies en texte
libre.

**À créer** — une table `governorates` / `delegations`, une migration qui reprend la constante, et le
CRUD. **Difficulté : faible.** Effet direct : plus de fautes de frappe dans les adresses, et des
statistiques par gouvernorat enfin fiables.

### B5 · Catalogue national des fonctions hospitalières

**Ce que fait le Super Admin** — tient le catalogue de référence des fonctions et grades
(médecin, résident, infirmier, technicien…) avec leur catégorie, et le **pousse** vers les
établissements.

**Ce qui existe déjà** — `job_titles` a un CRUD complet **mais par établissement**
(`job-titles.controller.js`, permissions `users.*`) et un amorçage
`seed_job_titles_for_establishment()`. Chaque hôpital dérive donc sa propre nomenclature.

**À créer** — un catalogue national + une action « Aligner cet établissement sur le catalogue
national » qui ajoute les manquants sans toucher aux fonctions locales déjà utilisées.
**Difficulté : moyenne** (la fusion doit être non destructive).

### B6 · Modèle de configuration d'établissement

**Ce que fait le Super Admin** — définit les valeurs par défaut appliquées à tout nouvel établissement
(période de planification, gardes max/mois, repos minimum, auto-remplacement autorisé, type de
workflow) et peut réappliquer un modèle à un établissement existant.

**Ce qui existe déjà** — la table `establishment_configs`, six clés écrites en dur dans
`establishments.controller.create`, et `PUT /establishments/:id/config`.

**À créer** — l'écran des valeurs par défaut nationales + l'action de réapplication.
**Difficulté : faible.**

---

## 4. Famille C — Piloter le cycle de vie des établissements

### C1 · Fiche de conformité et « dossier complet » 🥇

**Ce que fait le Super Admin** — ouvre un établissement et voit une **liste de contrôle** verte/rouge :
directeur nommé et actif · coordonnées GPS renseignées · au moins un service · un chef par service ·
types de garde présents · fonctions amorcées · un planning soumis pour le mois en cours. Chaque ligne
rouge est **cliquable** et mène à l'action qui la corrige.

**Ce qui existe déjà** — chaque donnée est déjà servie (`GET /establishments/:id`, `/personnel`,
`/departments`, `admin-oversight`, `portfolio`). Rien à calculer côté métier.

**À créer** — l'agrégation et l'écran. **Difficulté : faible.** C'est la fonctionnalité qui
*ressemble* le plus à du pilotage national sans en avoir le coût — et elle rend visibles les trous
réels (comme le catalogue de gardes vide de **B1**).

### C2 · Assistant de mise en service d'un établissement

**Ce que fait le Super Admin** — un parcours en 5 étapes : *Identité* → *Directeur* → *Services* →
*Types de garde et fonctions* → *Récapitulatif*. À la fin, l'hôpital est **immédiatement utilisable**
et le directeur reçoit ses identifiants.

**Ce qui existe déjà** — chaque étape a son endpoint (`POST /establishments`,
`PUT /establishments/:id/director`, `POST /departments`, `POST /schedule-config/init/:establishmentId`
— ce dernier accepte **déjà** un `establishmentId` en paramètre et autorise explicitement le Super
Admin, `schedule-config.controller.js:246`).

**À créer** — l'enchaînement, la reprise d'un dossier incomplet, et l'écran final. Aucun nouvel
endpoint. **Difficulté : moyenne** (surtout de l'assemblage). Très fort effet de démonstration :
un hôpital opérationnel en trois minutes, sans SQL.

### C3 · Suspension motivée et programmée

**Ce que fait le Super Admin** — suspend un établissement **avec un motif** et une date d'effet
(immédiate ou programmée), prévient le directeur, et voit la liste des suspensions en cours avec leur
motif.

**Ce qui existe déjà** — `deactivateWithCascade` et `activateEstablishment` (`admin.routes.js`), plus
le job périodique `jobs/schedule-activation.js` qui offre le modèle exact d'une échéance différée
(`setInterval` démarré depuis `backend/index.js:6`).

**À créer** — colonnes motif/date d'effet, un job qui applique les suspensions dues, l'historisation.
**Difficulté : moyenne.**

### C4 · Rattachement d'un établissement à un autre (annexe / CHU)

**Ce que fait le Super Admin** — déclare qu'un établissement est l'**annexe** d'un autre, ce qui permet
de consolider les statistiques du groupe et d'autoriser le partage de personnel (voir **D4**).

**Ce qui existe déjà** — `establishments.type` distingue déjà `hospital` et d'autres types.

**À créer** — une colonne `parent_establishment_id`, l'écran de rattachement, et la consolidation dans
les statistiques. **Difficulté : moyenne** — à ne lancer qu'après avoir tranché la question métier
(un CHU et ses annexes partagent-ils leur personnel ?).

---

## 5. Famille D — Administrer les comptes et le personnel

### D1 · Créer n'importe quel compte dans n'importe quel établissement 🥇

**Ce que fait le Super Admin** — sélectionne un établissement, crée directement un directeur, un
administrateur hospitalier, un surveillant général, un chef de service, un surveillant de service, un
médecin, un résident ou un observateur — sans passer par le directeur, utile au démarrage ou quand le
directeur est absent.

**Ce qui existe déjà** — **l'autorisation est déjà en place** : `injectEstablishment`
(`rbac.js:84-97`) laisse explicitement le Super Admin cibler « n'importe quel établissement via query
ou body », et `getCreatableRoles` (`users.controller.js:642`) liste déjà **8 rôles créables** pour lui.
Depuis l'interface, il ne peut aujourd'hui créer que le directeur.

**Point de blocage repéré** — `getCreatableRoles` interroge la table `roles`
`WHERE establishment_id = $1` avec `req.user.establishmentId`. Or les rôles sont créés **par
établissement** (`create_roles_for_establishment`) et le Super Admin n'appartient à aucun : la requête
renvoie donc une liste vide. Il faudra lire l'établissement **cible** (`req.establishmentId`) et non
celui de l'utilisateur.

**À créer** — un écran « Comptes » avec sélecteur d'établissement, et la correction ci-dessus.
**Difficulté : faible.**

### D2 · Annuaire national du personnel

**Ce que fait le Super Admin** — recherche une personne **sur toute la plateforme** par nom, matricule,
téléphone ou e-mail, et voit son établissement, son service, son rôle, son état de compte — puis agit
(réinitialiser le mot de passe, suspendre, archiver).

**Ce qui existe déjà** — la recherche floue est disponible côté base (`pg_trgm` activé,
`001_schema.sql:8`), et `GET /establishments/:id/personnel` fait déjà le travail **pour un seul
établissement**. `historyAPI.getUsersList()` renvoie déjà une liste d'utilisateurs tous établissements
confondus pour le filtre d'historique.

**À créer** — un endpoint de recherche transverse et l'écran. **Difficulté : faible.** Répond au
besoin le plus banal d'un administrateur national : *« où est cette personne ? »*.

### D3 · Import massif du personnel

**Ce que fait le Super Admin** — dépose un fichier Excel pour un établissement, voit un **aperçu ligne
à ligne** avec les erreurs détectées avant tout enregistrement, corrige, puis importe. Les comptes sont
créés avec un mot de passe provisoire.

**Ce qui existe déjà** — toute la mécanique d'import Excel est en place pour les plannings
(`schedules/import.controller.js`, `xlsx` déjà en dépendance, `ImportModal.jsx` côté interface) :
lecture, correspondance de colonnes, rapport d'erreurs. Le modèle est directement réutilisable.

**À créer** — le mappage vers `users` + l'écran d'aperçu. **Difficulté : moyenne.**
*À noter* : la collision d'en-têtes `nom`/`prenom` déjà relevée dans `import.controller.js:139-142`
doit être traitée avant de réutiliser ce code pour du personnel.

### D4 · Prêt et mutation de personnel entre établissements

**Ce que fait le Super Admin** — organise le renfort d'un hôpital par un autre : il désigne un agent,
l'établissement d'accueil et la période ; ou il **mute** définitivement un agent d'un établissement
vers un autre en conservant son historique.

**Ce qui existe déjà** — le prêt de personnel est entièrement construit… **mais uniquement à
l'intérieur d'un établissement** : `staff-loans.controller.js` filtre systématiquement
`l.establishment_id = $1` (`:189`, `:265`). Le vocabulaire, les statuts, l'acceptation/refus, le temps
réel et l'affichage par garde existent déjà.

**À créer** — l'extension inter-établissements (établissement prêteur / emprunteur) ou une table de
mutation. **Difficulté : élevée** — c'est la proposition la plus structurante du catalogue : elle
touche la portée des permissions, celle des salles temps réel (`establishment:<id>`) et les
statistiques. À ne lancer que si la mutualisation régionale est un objectif affiché.

### D5 · Sessions actives et déconnexion forcée

**Ce que fait le Super Admin** — voit qui est connecté (déjà le cas), et peut **fermer une session**
d'un clic (compte partagé, départ d'un agent, incident de sécurité).

**Ce qui existe déjà** — `GET /admin/online-users` et le suivi d'activité `trackActivity`
(`app.js:103`). Le socket permet de notifier la déconnexion instantanément.

**À créer** — l'action de révocation (invalidation du jeton) + le bouton. **Difficulté : moyenne**
(dépend de la stratégie de jetons : il faut une liste de révocation ou un compteur de version par
utilisateur).

---

## 6. Famille E — Encadrer le planning au niveau national

### E1 · Échéances nationales de soumission 🥇

**Ce que fait le Super Admin** — fixe la date limite de soumission des plannings pour un mois donné
(« octobre : au plus tard le 25 septembre »), pour toute la plateforme ou par gouvernorat. Chefs de
service et directeurs voient l'échéance et un compte à rebours ; le Super Admin voit le **tableau des
retardataires**.

**Ce qui existe déjà** — la notion d'état de planning est mûre (`planning_state()` →
`brouillon`/`soumis`/`en_cours`/`termine`), le job `schedule-activation.js` donne le modèle de
l'échéance, et les notifications sont en place.

**À créer** — une table d'échéances, l'écran de saisie, le rappel automatique, le tableau de suivi.
**Difficulté : moyenne.** C'est la fonctionnalité qui transforme le Super Admin d'observateur en
autorité de tutelle — et la plus parlante devant un ministère.

### E2 · Modèles de tableur nationaux

**Ce que fait le Super Admin** — publie des modèles de tableur de garde types (urgences, bloc,
réanimation, service standard) que n'importe quel chef de service peut appliquer, et pousse un jeu de
colonnes standard à un établissement.

**Ce qui existe déjà** — `schedule-config` gère **déjà** colonnes, règles et modèles avec un CRUD
complet (`schedule-config.routes.js`), mais **par établissement**, et `POST /schedule-config/init` est
déjà ouvert au Super Admin avec un `establishmentId` en paramètre.

**À créer** — la portée « nationale » sur les modèles + l'action de diffusion. **Difficulté : faible à
moyenne** (l'essentiel du code existe, il s'agit d'élargir la portée sans casser l'existant).

### E3 · Socle national de règles de garde

**Ce que fait le Super Admin** — définit les règles **minimales opposables** à tous les établissements
(repos de 11 h, pas deux gardes le même jour, pas de garde pendant une absence, écart d'équité maximal)
et décide, par règle, si elle **signale** ou **bloque**. Un établissement peut durcir, jamais assouplir.

**Ce qui existe déjà** — `DEFAULT_RULES` (`REST_MIN_11H`, `NO_DOUBLE_SAME_DAY`,
`NO_GUARD_DURING_ABSENCE`, `BALANCE_MAX_VARIANCE_20PCT`), la table `establishment_rules`, le CRUD par
établissement (`/schedule-config/rules`) et le moteur `evaluateRules`.

**⚠️ À savoir avant de promettre quoi que ce soit** — `evaluateRules` lit les gardes dans
`FROM shifts s WHERE s.schedule_id = $1` (`rules-engine.js:241`), or **les plannings construits au
tableur — le chemin principal — n'écrivent rien dans `shifts`** : leur source de vérité est
`schedules.metadata.spreadsheet`. Le moteur parcourt donc **zéro garde** et ne trouve **zéro
violation** ; le contrôle avant soumission (`schedule-builder.controller.js:1249`) laisse tout passer
en silence. Toute règle nationale est aujourd'hui décorative.

**À créer** — d'abord un **adaptateur** qui alimente `evaluateRule` depuis
`spreadsheet-reader.guardEntries()`, ensuite la portée nationale. **Difficulté : élevée**, et à mener
en deux temps (signalement seul, puis blocage établissement par établissement) pour ne pas refuser
d'un coup des plannings aujourd'hui acceptés.

### E4 · Clôture mensuelle

**Ce que fait le Super Admin** — clôture un mois : les plannings de ce mois deviennent **non
modifiables**, seuls les remplacements restent possibles. La clôture est datée, signée et
irréversible sans réouverture explicite.

**Ce qui existe déjà** — l'invariant est **déjà celui du produit** : un tableur soumis n'est jamais
réécrit, les remplacements vivent en surcouche (`replacements-overlay`). La clôture ne fait que rendre
cette règle officielle et vérifiable.

**À créer** — une table de périodes clôturées, un garde-fou dans les contrôleurs d'écriture concernés,
l'écran. **Difficulté : moyenne** (le garde-fou doit être exhaustif pour être crédible).

---

## 7. Famille F — Traçabilité et pièces officielles

### F1 · Registre des actions sensibles

**Ce que fait le Super Admin** — consulte un registre filtré des seules actions à risque :
désactivations d'établissement, réinitialisations de mot de passe, changements de rôle, archivages,
suppressions de service — avec auteur, cible, horodatage et adresse IP.

**Ce qui existe déjà** — l'historique global existe et est **déjà accessible** au Super Admin
(`GET /history/all` + `/history/users`, onglet « Tout » de la page `/history`, avec catégories et
filtres). Ce n'est donc **pas** un nouvel historique — c'est une **vue prioritaire** de celui-ci.

**À créer** — une catégorie « actions sensibles » et l'écran dédié. **Difficulté : faible.**

### F2 · Export officiel (Excel / PDF)

**Ce que fait le Super Admin** — exporte, en un clic, un état signé et daté : liste des établissements
et leur conformité, effectifs par établissement, gardes du mois, registre des actions. Format
présentable à une tutelle.

**Ce qui existe déjà** — l'export Excel et PDF est **déjà en service** pour les plannings
(`schedules/export.controller.js`, `schedule-export.controller.js`, `notes.controller.js`,
`leaves.controller.js`). Les bibliothèques et le style d'en-tête sont là.

**À créer** — les gabarits d'export nationaux. **Difficulté : faible.** Valeur immédiate en
soutenance : un document sort de la plateforme.

---

## 8. Priorités

Classement par **valeur ÷ effort**, en tenant compte du fait que la plateforme est en phase
démonstration / pré-lancement.

| Rang | Fonctionnalité | Valeur | Difficulté | Pourquoi maintenant |
|---|---|---|---|---|
| **1** | **B1 · Types de garde** | ⭐⭐⭐⭐⭐ | Faible | Corrige un **blocage réel** : tout établissement créé aujourd'hui a un catalogue vide et son tableur refuse chaque code |
| **2** | **A1 · Circulaires nationales** | ⭐⭐⭐⭐⭐ | Très faible | Backend **déjà écrit** ; il manque une entrée de menu |
| **3** | **C1 · Fiche de conformité** | ⭐⭐⭐⭐⭐ | Faible | Donne un vrai écran de pilotage sans nouvelle donnée |
| **4** | **D1 · Créer tout compte** | ⭐⭐⭐⭐ | Faible | L'autorisation existe déjà ; un correctif d'une ligne la débloque |
| **5** | **D2 · Annuaire national** | ⭐⭐⭐⭐ | Faible | Le besoin le plus quotidien d'un administrateur national |
| **6** | **F2 · Export officiel** | ⭐⭐⭐⭐ | Faible | Les briques d'export existent ; produit une pièce présentable |
| **7** | **B2 · Types d'absence** | ⭐⭐⭐ | Faible | Complète B1 sur la même page « Référentiels » |
| **8** | **B3 · Matrice des droits** *(lecture)* | ⭐⭐⭐⭐ | Faible | Argument de gouvernance fort, risque nul en lecture seule |
| **9** | **E1 · Échéances nationales** | ⭐⭐⭐⭐⭐ | Moyenne | Fait passer le Super Admin d'observateur à autorité |
| **10** | **C2 · Mise en service guidée** | ⭐⭐⭐⭐ | Moyenne | Démonstration : un hôpital opérationnel en trois minutes |
| **11** | **B4 · Gouvernorats / délégations** | ⭐⭐⭐ | Faible | Fiabilise adresses, carte et statistiques régionales |
| **12** | **F1 · Registre sensible** | ⭐⭐⭐ | Faible | Vue filtrée d'un historique déjà servi |
| **13** | **A2 · Suivi de diffusion** | ⭐⭐⭐ | Faible | Prolonge A1, même écran |
| **14** | **B6 · Modèle de configuration** | ⭐⭐⭐ | Faible | Cohérence des paramètres entre hôpitaux |
| **15** | **E2 · Modèles nationaux** | ⭐⭐⭐ | Faible-moyenne | Réutilise `schedule-config` presque tel quel |
| **16** | **E4 · Clôture mensuelle** | ⭐⭐⭐⭐ | Moyenne | Officialise l'invariant « surcouche remplacements » |
| **17** | **C3 · Suspension motivée** | ⭐⭐ | Moyenne | Complète une action déjà existante |
| **18** | **B5 · Fonctions nationales** | ⭐⭐ | Moyenne | La fusion non destructive est le vrai travail |
| **19** | **D5 · Déconnexion forcée** | ⭐⭐ | Moyenne | Dépend de la stratégie de jetons |
| **20** | **A3 · Annonce / maintenance** | ⭐⭐⭐ | Moyenne | Le mode lecture seule touche toutes les écritures |
| **21** | **D3 · Import massif** | ⭐⭐⭐ | Moyenne | À faire après le correctif d'en-têtes de l'import |
| **22** | **E3 · Socle national de règles** | ⭐⭐⭐⭐ | Élevée | Exige d'abord de rebrancher le moteur sur le tableur |
| **23** | **C4 / D4 · Groupes et mutations** | ⭐⭐⭐ | Élevée | Décision métier préalable : mutualise-t-on le personnel ? |

---

## 9. Un premier lot cohérent, livrable sans risque

Les six premières lignes forment un ensemble qui tient dans **un seul nouvel espace de menu**, sans
toucher à une fonctionnalité existante :

```
Plateforme
  Tableau de bord          (existant)
  Carte des hôpitaux       (existant)
  Établissements       ←  nouveau : C1 fiche de conformité + D1 comptes
  Référentiels         ←  nouveau : B1 types de garde · B2 types d'absence · B3 droits (lecture)
  Personnel            ←  nouveau : D2 annuaire national
  Circulaires          ←  A1 : la page /notes existe déjà, il manque le lien
  Exports              ←  nouveau : F2 pièces officielles
  Demandes profil          (existant)
```

**Étanchéité** : tout est en **fichiers neufs** sous `pages/superadmin/` et un module backend
`admin-referentiels` ; les seuls fichiers partagés touchés sont `Sidebar.jsx` (entrées de menu),
`App.jsx` (routes) et `api/index.js` (fonctions d'appel) — **en ajout uniquement**. Les deux
correctifs identifiés (amorçage `shift_types` à la création d'établissement, `getCreatableRoles` sur
l'établissement cible) sont chirurgicaux et sans effet sur les rôles existants.

---

## 10. Trois questions à trancher avant de coder

1. **Les référentiels sont-ils nationaux ou locaux ?** Le Super Admin **impose** les types de garde à
   tous, ou publie un modèle que chaque hôpital adapte ? (Le second est plus souple, le premier plus
   crédible devant une tutelle.)
2. **Le Super Admin peut-il créer des comptes autres que le directeur ?** Aujourd'hui le backend
   l'autorise et l'interface ne le propose pas. C'est un choix de gouvernance, pas une limite
   technique.
3. **Mutualise-t-on le personnel entre établissements ?** La réponse conditionne **D4**, **C4**, et la
   portée des salles temps réel — c'est la seule décision réellement structurante du catalogue.
