/**
 * Annuaire national du personnel — Super Admin (Lot X6, D2).
 *
 * `GET /establishments/:id/personnel` répond déjà « qui travaille dans cet
 * hôpital ». La question quotidienne d'un administrateur national est l'inverse :
 * *« où est cette personne ? »* — et elle n'avait aucune réponse. Chercher un
 * agent obligeait à ouvrir les établissements un par un.
 *
 * Ce module sert la recherche transverse. Il ne duplique aucun écran : la fiche
 * d'un établissement reste la source pour « qui travaille ici », l'annuaire
 * répond pour « où est cette personne ».
 *
 * ── Choix de recherche ────────────────────────────────────────
 * `pg_trgm` est actif (`001_schema.sql`) et un index trigramme existe déjà sur
 * `job_titles.name`, mais **pas** sur `users.first_name` / `last_name`. Plutôt
 * que d'ajouter des index dans une migration — donc d'imposer un travail au
 * démarrage sur une table qui grossira — la recherche combine :
 *   • `ILIKE` sur le nom complet, le matricule, le téléphone et l'e-mail, ce qui
 *     couvre la frappe exacte et partielle et reste indexable plus tard ;
 *   • `similarity()` en **tri** seulement, pour que « Bin Ali » remonte
 *     « Ben Ali » sans élargir le filtre à toute la table.
 * Le résultat est donc tolérant aux fautes dans l'ordre d'affichage, sans jamais
 * renvoyer un ensemble non borné.
 *
 * ── Étanchéité ────────────────────────────────────────────────
 * Fichier neuf, requêtes propres, aucune migration. Les actions (activer,
 * suspendre, archiver) ne sont pas réimplémentées ici : l'interface appelle les
 * endpoints déjà en service.
 */

const { query } = require('../../config/database');

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** Longueur minimale d'un terme de recherche : en dessous, on ne filtre pas. */
const MIN_QUERY_LENGTH = 2;

const requireSuperAdmin = (req, res) => {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
    return false;
  }
  return true;
};

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const toInt = (value) => Number(value) || 0;

/**
 * États de compte proposés au filtre. `archived` s'appuie sur `archived_at`
 * (migration 025) : un compte archivé n'est pas un compte suspendu, et les
 * confondre ferait disparaître des gens de l'annuaire sans le dire.
 */
const STATUS_FILTERS = {
  active: 'u.is_active = TRUE AND u.archived_at IS NULL',
  suspended: 'u.is_active = FALSE AND u.archived_at IS NULL',
  archived: 'u.archived_at IS NOT NULL',
  no_login: 'u.can_login = FALSE AND u.archived_at IS NULL',
  never_connected: 'u.last_login IS NULL AND u.archived_at IS NULL',
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/annuaire
// Recherche transverse : nom, matricule, téléphone, e-mail.
// ══════════════════════════════════════════════════════════════
const searchStaff = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const {
      q = '', establishmentId, roleCode, departmentId, status,
      page = 1, pageSize = DEFAULT_PAGE_SIZE,
    } = req.query;

    const term = String(q).trim();
    const useTerm = term.length >= MIN_QUERY_LENGTH;
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(pageSize) || DEFAULT_PAGE_SIZE));
    const pageNum = Math.max(1, toInt(page) || 1);
    const offset = (pageNum - 1) * size;

    const where = ["e.type <> 'system'"];
    const params = [];
    let idx = 1;

    if (useTerm) {
      // Un seul paramètre pour les quatre colonnes : le motif est construit une
      // fois, ce qui évite quatre copies du terme dans la requête.
      params.push(`%${term}%`);
      where.push(`(
        (u.first_name || ' ' || u.last_name) ILIKE $${idx}
        OR (u.last_name || ' ' || u.first_name) ILIKE $${idx}
        OR COALESCE(u.matricule, '') ILIKE $${idx}
        OR COALESCE(u.phone, '') ILIKE $${idx}
        OR u.email ILIKE $${idx}
      )`);
      idx++;
    }
    if (establishmentId) { params.push(establishmentId); where.push(`u.establishment_id = $${idx}::uuid`); idx++; }
    if (roleCode)        { params.push(roleCode);        where.push(`r.code = $${idx}`); idx++; }
    if (departmentId) {
      params.push(departmentId);
      where.push(`EXISTS (SELECT 1 FROM user_departments ud
                           WHERE ud.user_id = u.id AND ud.department_id = $${idx}::uuid)`);
      idx++;
    }
    if (status && STATUS_FILTERS[status]) where.push(STATUS_FILTERS[status]);

    // Le tri par pertinence n'a de sens qu'avec un terme. `similarity` sur le
    // nom complet suffit : le matricule et l'e-mail sont des correspondances
    // exactes ou rien.
    let orderBy = 'u.last_name, u.first_name';
    if (useTerm) {
      params.push(term);
      orderBy = `similarity(u.first_name || ' ' || u.last_name, $${idx}) DESC, u.last_name, u.first_name`;
      idx++;
    }

    const clause = where.join(' AND ');

    const listParams = [...params, size, offset];
    const [rows, count] = await Promise.all([
      query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.matricule,
                u.is_active, u.can_login, u.archived_at IS NOT NULL AS is_archived,
                u.speciality, u.grade, u.avatar_url,
                TO_CHAR(u.last_login, 'YYYY-MM-DD HH24:MI') AS last_login,
                TO_CHAR(u.created_at, 'YYYY-MM-DD') AS created_at,
                r.code AS role_code, r.name AS role_name, r.level AS role_level,
                e.id AS establishment_id, e.name AS establishment_name,
                e.code AS establishment_code, e.governorate,
                jt.name AS job_title,
                COALESCE((
                  SELECT STRING_AGG(d.name, ', ' ORDER BY ud.is_head DESC, d.name)
                    FROM user_departments ud JOIN departments d ON d.id = ud.department_id
                   WHERE ud.user_id = u.id
                ), '') AS departments,
                EXISTS (SELECT 1 FROM user_departments ud
                         WHERE ud.user_id = u.id AND ud.is_head = TRUE) AS is_head
           FROM users u
           JOIN roles r ON r.id = u.role_id
           JOIN establishments e ON e.id = u.establishment_id
           LEFT JOIN job_titles jt ON jt.id = u.job_title_id
          WHERE ${clause}
          ORDER BY ${orderBy}
          LIMIT $${idx} OFFSET $${idx + 1}`,
        listParams
      ),
      query(
        `SELECT COUNT(*)::int AS total
           FROM users u
           JOIN roles r ON r.id = u.role_id
           JOIN establishments e ON e.id = u.establishment_id
          WHERE ${clause}`,
        // Le paramètre de tri ne figure pas dans le WHERE : on le retire du
        // décompte, sinon PostgreSQL refuse un paramètre non référencé.
        useTerm ? params.slice(0, -1) : params
      ),
    ]);

    const total = toInt(count.rows[0]?.total);

    return res.json({
      success: true,
      data: {
        people: rows.rows.map((u) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`,
          firstName: u.first_name,
          lastName: u.last_name,
          email: u.email,
          phone: u.phone,
          matricule: u.matricule,
          isActive: u.is_active,
          canLogin: u.can_login,
          isArchived: u.is_archived,
          isHead: u.is_head,
          speciality: u.speciality,
          grade: u.grade,
          avatarUrl: u.avatar_url,
          lastLogin: u.last_login,
          createdAt: u.created_at,
          roleCode: u.role_code,
          roleName: u.role_name,
          roleLevel: u.role_level,
          establishmentId: u.establishment_id,
          establishmentName: u.establishment_name,
          establishmentCode: u.establishment_code,
          governorate: u.governorate,
          jobTitle: u.job_title,
          departments: u.departments || '',
        })),
        total,
        page: pageNum,
        pageSize: size,
        pages: Math.max(1, Math.ceil(total / size)),
        query: useTerm ? term : '',
        // Dit explicitement qu'un terme trop court a été ignoré, plutôt que de
        // laisser croire que la liste complète est un résultat de recherche.
        queryIgnored: term.length > 0 && !useTerm,
        minQueryLength: MIN_QUERY_LENGTH,
      },
    });
  } catch (err) {
    console.error('adminAnnuaire.searchStaff error:', err);
    return fail(res, 500, 'Erreur lors de la recherche');
  }
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/annuaire/facets
// Les listes des filtres et les totaux nationaux, en un appel.
// ══════════════════════════════════════════════════════════════
const getFacets = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const [estRes, roleRes, totalRes] = await Promise.all([
      query(
        `SELECT e.id, e.code, e.name, e.governorate, e.is_active,
                COUNT(u.id) FILTER (WHERE u.archived_at IS NULL)::int AS staff,
                COUNT(u.id) FILTER (WHERE u.is_active = TRUE AND u.archived_at IS NULL)::int AS active_staff
           FROM establishments e
           LEFT JOIN users u ON u.establishment_id = e.id
          WHERE e.type <> 'system'
          GROUP BY e.id, e.code, e.name, e.governorate, e.is_active
          ORDER BY e.name`,
        []
      ),
      query(
        // Regroupé par code : les rôles étant créés par établissement, la même
        // fonction existe autant de fois qu'il y a d'hôpitaux.
        //
        // Le décompte exclut le personnel de l'établissement système, comme le
        // fait `searchStaff` : sans cela la facette « Super Admin » afficherait
        // 1 alors qu'un clic dessus ne renvoie jamais personne.
        `SELECT r.code, MIN(r.name) AS name, MIN(r.level) AS level,
                COUNT(u.id) FILTER (
                  WHERE u.archived_at IS NULL AND ue.type <> 'system'
                )::int AS staff
           FROM roles r
           LEFT JOIN users u ON u.role_id = r.id
           LEFT JOIN establishments ue ON ue.id = u.establishment_id
           LEFT JOIN establishments e ON e.id = r.establishment_id
          WHERE r.establishment_id IS NULL OR e.type <> 'system'
          GROUP BY r.code
          ORDER BY MIN(r.level), MIN(r.name)`,
        []
      ),
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.is_active = TRUE AND u.archived_at IS NULL)::int AS active,
                COUNT(*) FILTER (WHERE u.is_active = FALSE AND u.archived_at IS NULL)::int AS suspended,
                COUNT(*) FILTER (WHERE u.archived_at IS NOT NULL)::int AS archived,
                COUNT(*) FILTER (WHERE u.last_login IS NULL AND u.archived_at IS NULL)::int AS never_connected,
                COUNT(*) FILTER (WHERE u.can_login = FALSE AND u.archived_at IS NULL)::int AS no_login
           FROM users u
           JOIN establishments e ON e.id = u.establishment_id
          WHERE e.type <> 'system'`,
        []
      ),
    ]);

    return res.json({
      success: true,
      data: {
        establishments: estRes.rows.map((e) => ({
          id: e.id, code: e.code, name: e.name,
          governorate: e.governorate, isActive: e.is_active,
          staff: e.staff, activeStaff: e.active_staff,
        })),
        roles: roleRes.rows.map((r) => ({
          code: r.code, name: r.name, level: toInt(r.level), staff: r.staff,
        })),
        totals: totalRes.rows[0],
        statuses: Object.keys(STATUS_FILTERS),
      },
    });
  } catch (err) {
    console.error('adminAnnuaire.getFacets error:', err);
    return fail(res, 500, 'Erreur lors du chargement des filtres');
  }
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/annuaire/:id
// Fiche d'une personne : son parcours de comptes et son rattachement.
// ══════════════════════════════════════════════════════════════
const getPerson = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;

    const person = await query(
      `SELECT u.id, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
              u.email, u.phone, u.matricule, u.speciality, u.grade, u.avatar_url,
              u.is_active, u.can_login, u.is_on_leave,
              u.archived_at IS NOT NULL AS is_archived, u.archive_reason,
              TO_CHAR(u.archived_at, 'YYYY-MM-DD HH24:MI') AS archived_at,
              TO_CHAR(u.last_login, 'YYYY-MM-DD HH24:MI') AS last_login,
              TO_CHAR(u.hire_date, 'YYYY-MM-DD') AS hire_date,
              TO_CHAR(u.created_at, 'YYYY-MM-DD') AS created_at,
              r.code AS role_code, r.name AS role_name,
              sr.code AS secondary_role_code, sr.name AS secondary_role_name,
              jt.name AS job_title, jt.category_label AS job_category,
              e.id AS establishment_id, e.name AS establishment_name,
              e.code AS establishment_code, e.governorate, e.city
         FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN establishments e ON e.id = u.establishment_id
         LEFT JOIN roles sr ON sr.id = u.secondary_role_id
         LEFT JOIN job_titles jt ON jt.id = u.job_title_id
        WHERE u.id = $1`,
      [id]
    );
    if (!person.rows.length) return fail(res, 404, 'Personne introuvable');
    const p = person.rows[0];

    const depts = await query(
      `SELECT d.id, d.name, d.code, ud.is_head, ud.is_primary,
              TO_CHAR(ud.joined_at, 'YYYY-MM-DD') AS joined_at
         FROM user_departments ud JOIN departments d ON d.id = ud.department_id
        WHERE ud.user_id = $1
        ORDER BY ud.is_head DESC, d.name`,
      [id]
    );

    return res.json({
      success: true,
      data: {
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        // Prénom et nom séparés en plus du libellé complet : le composant
        // `Avatar` construit ses initiales à partir des deux champs, et découper
        // `name` côté client casserait sur un nom composé.
        firstName: p.first_name,
        lastName: p.last_name,
        nameAr: p.first_name_ar && p.last_name_ar ? `${p.first_name_ar} ${p.last_name_ar}` : null,
        email: p.email,
        phone: p.phone,
        matricule: p.matricule,
        speciality: p.speciality,
        grade: p.grade,
        avatarUrl: p.avatar_url,
        isActive: p.is_active,
        canLogin: p.can_login,
        isOnLeave: p.is_on_leave,
        isArchived: p.is_archived,
        archivedAt: p.archived_at,
        archiveReason: p.archive_reason,
        lastLogin: p.last_login,
        hireDate: p.hire_date,
        createdAt: p.created_at,
        roleCode: p.role_code,
        roleName: p.role_name,
        secondaryRoleCode: p.secondary_role_code,
        secondaryRoleName: p.secondary_role_name,
        jobTitle: p.job_title,
        jobCategory: p.job_category,
        establishment: {
          id: p.establishment_id, name: p.establishment_name,
          code: p.establishment_code, governorate: p.governorate, city: p.city,
        },
        departments: depts.rows.map((d) => ({
          id: d.id, name: d.name, code: d.code,
          isHead: d.is_head, isPrimary: d.is_primary, joinedAt: d.joined_at,
        })),
      },
    });
  } catch (err) {
    console.error('adminAnnuaire.getPerson error:', err);
    return fail(res, 500, 'Erreur lors du chargement de la fiche');
  }
};

module.exports = { searchStaff, getFacets, getPerson, STATUS_FILTERS };
