/**
 * Job — mise en marche automatique des plannings à la date de début
 *
 * Règle métier : « si la date de début d'une garde est atteinte alors elle est
 * mise en marche et en cours ». Un planning envoyé par le chef de service est
 * en vigueur ('submitted') ; le jour où sa période commence, il devient 'active'.
 *
 * Ce fichier est autonome : il ne modifie aucun contrôleur existant. Il est
 * appelé au démarrage puis toutes les 30 minutes depuis backend/index.js.
 *
 * Note : `end_date` est volontairement ignorée. Un planning dont la période est
 * terminée reste 'active' en base mais `planning_state()` le rend déjà
 * « terminé » à l'affichage — inutile d'écrire un statut supplémentaire.
 */

const { query } = require('../config/database');
const { emitToEstablishment, emitToDepartment } = require('../realtime/emit');
const { log } = require('../modules/history/history.controller');

/**
 * Promeut en 'active' tous les plannings envoyés dont la date de début est
 * atteinte, puis prévient les clients connectés.
 *
 * @param {Express.Application} [app] - nécessaire seulement pour le temps réel ;
 *        sans lui, la promotion se fait quand même (le polling 60 s prend le relais).
 * @returns {Promise<Array>} les plannings promus (vide si aucun)
 */
const promoteDueSchedules = async (app) => {
  let promoted = [];
  try {
    const result = await query(
      `UPDATE schedules
          SET status = 'active', updated_at = NOW()
        WHERE status = 'submitted' AND start_date <= CURRENT_DATE
        RETURNING id, name, status, establishment_id, department_id, created_by,
                  TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                  TO_CHAR(end_date,   'YYYY-MM-DD') AS end_date`
    );
    promoted = result.rows;
  } catch (err) {
    // Un échec ne doit jamais empêcher le serveur de tourner : la prochaine
    // exécution rattrapera (la requête est idempotente par nature).
    console.warn('⚠️  Promotion automatique des plannings impossible :', err.message);
    return [];
  }

  if (promoted.length === 0) return [];

  for (const schedule of promoted) {
    const payload = {
      scheduleId: schedule.id,
      name: schedule.name,
      status: schedule.status,
      state: 'en_cours',
      startDate: schedule.start_date,
      endDate: schedule.end_date,
    };

    if (app) {
      emitToEstablishment(app, schedule.establishment_id, 'schedule:activated', payload);
      if (schedule.department_id) {
        emitToDepartment(app, schedule.department_id, 'schedule:activated', payload);
      }
    }

    // Traçabilité : la bascule est automatique, mais `activity_logs.user_id`
    // est NOT NULL et toutes les vues d'historique font un JOIN users — une
    // ligne sans acteur serait rejetée puis invisible. On l'impute donc à
    // l'auteur du planning, en le disant explicitement dans le libellé.
    log({
      userId: schedule.created_by,
      action: 'schedule_activated',
      category: 'schedule',
      description: `Planning « ${schedule.name} » mis en marche automatiquement : sa date de début (${schedule.start_date}) est atteinte.`,
      descriptionAr: 'تم تفعيل جدول المناوبات تلقائيا عند بلوغ تاريخ البداية',
      entityType: 'schedules',
      entityId: schedule.id,
      metadata: { automatic: true, startDate: schedule.start_date, endDate: schedule.end_date },
      severity: 'info',
    });
  }

  console.log(`▶️  ${promoted.length} planning(s) mis en marche (date de début atteinte)`);
  return promoted;
};

/** Intervalle de balayage : 30 minutes, largement suffisant pour une bascule journalière. */
const ACTIVATION_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Démarre le balayage périodique. Retourne le timer pour permettre un
 * `clearInterval` en test.
 */
const startScheduleActivationJob = (app) => {
  promoteDueSchedules(app);
  const timer = setInterval(() => promoteDueSchedules(app), ACTIVATION_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref(); // ne retient pas le process
  return timer;
};

module.exports = { promoteDueSchedules, startScheduleActivationJob, ACTIVATION_INTERVAL_MS };
