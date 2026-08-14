const { query } = require('../../config/database');
const { PERSONNEL_CATEGORIES } = require('../../config/personnel-categories');

// ─── GET /api/job-titles ──────────────────────────────────────
// Retourne les titres de poste de l'etablissement (systeme + custom)
// Query params: search, category, includeInactive
const getJobTitles = async (req, res) => {
  const { search, category, includeInactive } = req.query;
  const eid = req.user.isSuperAdmin
    ? (req.query.establishmentId || req.user.establishmentId)
    : req.user.establishmentId;

  let conditions = ['jt.establishment_id = $1'];
  let params = [eid];
  let idx = 2;

  if (!includeInactive) {
    conditions.push('jt.is_active = TRUE');
  }
  if (search && search.trim()) {
    conditions.push(`(jt.name ILIKE $${idx} OR jt.name_ar ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }
  if (category) {
    conditions.push(`jt.category = $${idx}`);
    params.push(category);
    idx++;
  }

  const result = await query(
    `SELECT jt.id, jt.name, jt.name_ar, jt.category, jt.is_system, jt.is_active, jt.sort_order,
            COALESCE(jt.category_label,
              CASE jt.category WHEN 'medical' THEN 'Personnel médical'
                WHEN 'administrative' THEN 'Personnel administratif'
                ELSE 'Personnel auxiliaire' END) AS category_label,
            COUNT(u.id) AS user_count
     FROM job_titles jt
     LEFT JOIN users u ON u.job_title_id = jt.id AND u.is_active = TRUE
     WHERE ${conditions.join(' AND ')}
     GROUP BY jt.id
     ORDER BY jt.sort_order ASC, jt.category, jt.name`,
    params
  );

  return res.json({ success: true, data: result.rows, categories: PERSONNEL_CATEGORIES });
};

// ─── POST /api/job-titles ─────────────────────────────────────
// Directeur cree un titre personnalise (is_system = FALSE)
const createJobTitle = async (req, res) => {
  const { name, nameAr, category } = req.body;
  const eid = req.user.establishmentId;

  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Le nom du titre est requis' });
  }

  // Verifier unicite
  const existing = await query(
    'SELECT id FROM job_titles WHERE establishment_id = $1 AND LOWER(name) = LOWER($2)',
    [eid, name.trim()]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ success: false, message: 'Ce titre de poste existe deja' });
  }

  // Ordre apres les titres systeme
  const maxOrder = await query(
    'SELECT COALESCE(MAX(sort_order), 999) + 1 AS next FROM job_titles WHERE establishment_id = $1',
    [eid]
  );

  const normalizedCategory = ['medical', 'administrative', 'auxiliary'].includes(category) ? category : 'auxiliary';
  const categoryLabel = PERSONNEL_CATEGORIES.find((c) => c.code === normalizedCategory)?.label;
  const result = await query(
    `INSERT INTO job_titles (establishment_id, name, name_ar, category, category_label, is_system, sort_order)
     VALUES ($1, $2, $3, $4, $5, FALSE, $6)
     RETURNING *`,
    [eid, name.trim(), nameAr?.trim() || null, normalizedCategory, categoryLabel, maxOrder.rows[0].next]
  );

  return res.status(201).json({ success: true, data: result.rows[0], message: 'Titre de poste cree' });
};

// ─── PUT /api/job-titles/:id ──────────────────────────────────
// Modifier un titre personnalise (pas les systeme)
const updateJobTitle = async (req, res) => {
  const { name, nameAr, category, isActive } = req.body;
  const eid = req.user.establishmentId;

  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  // Verifier que le titre appartient a cet etablissement et n'est pas systeme
  const check = await query(
    'SELECT id, is_system FROM job_titles WHERE id = $1 AND establishment_id = $2',
    [req.params.id, eid]
  );
  if (!check.rows[0]) return res.status(404).json({ success: false, message: 'Titre introuvable' });
  if (check.rows[0].is_system && name) {
    return res.status(403).json({ success: false, message: 'Impossible de renommer un titre systeme' });
  }

  const normalizedCategory = category
    ? (['medical', 'administrative', 'auxiliary'].includes(category) ? category : 'auxiliary')
    : null;
  const categoryLabel = normalizedCategory
    ? PERSONNEL_CATEGORIES.find((c) => c.code === normalizedCategory)?.label
    : null;
  const result = await query(
    `UPDATE job_titles SET
       name      = COALESCE($1, name),
       name_ar   = COALESCE($2, name_ar),
       category  = COALESCE($3, category),
       category_label = COALESCE($4, category_label),
       is_active = COALESCE($5, is_active)
     WHERE id = $6 AND establishment_id = $7
     RETURNING *`,
    [name?.trim() || null, nameAr?.trim() || null, normalizedCategory, categoryLabel, isActive, req.params.id, eid]
  );

  return res.json({ success: true, data: result.rows[0], message: 'Titre mis a jour' });
};

// ─── DELETE /api/job-titles/:id ───────────────────────────────
// Supprimer (soft) un titre personnalise
const deleteJobTitle = async (req, res) => {
  const eid = req.user.establishmentId;

  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  const check = await query(
    'SELECT id, is_system FROM job_titles WHERE id = $1 AND establishment_id = $2',
    [req.params.id, eid]
  );
  if (!check.rows[0]) return res.status(404).json({ success: false, message: 'Titre introuvable' });
  if (check.rows[0].is_system) {
    return res.status(403).json({ success: false, message: 'Impossible de supprimer un titre systeme' });
  }

  // Verifier si des utilisateurs ont ce titre
  const inUse = await query(
    'SELECT COUNT(*) FROM users WHERE job_title_id = $1 AND is_active = TRUE',
    [req.params.id]
  );
  if (parseInt(inUse.rows[0].count) > 0) {
    // Soft disable plutot que suppression
    await query('UPDATE job_titles SET is_active = FALSE WHERE id = $1', [req.params.id]);
    return res.json({ success: true, message: 'Titre desactive (utilise par des personnels actifs)' });
  }

  await query('DELETE FROM job_titles WHERE id = $1', [req.params.id]);
  return res.json({ success: true, message: 'Titre supprime' });
};

module.exports = { getJobTitles, createJobTitle, updateJobTitle, deleteJobTitle };
