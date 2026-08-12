module.exports = {
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'gardesante_jwt_secret_change_in_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'gardesante_refresh_secret_change_in_production',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  // Upload
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB

  // Roles système (codes)
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    HOSPITAL_ADMIN: 'hospital_admin',
    DIRECTOR: 'director',
    GENERAL_SUPERVISOR: 'general_supervisor',
    DEPARTMENT_HEAD: 'department_head',
    SERVICE_SUPERVISOR: 'service_supervisor',
    SENIOR_DOCTOR: 'senior_doctor',
    RESIDENT: 'resident',
    OBSERVER: 'observer',
  },

  // Statuts planning
  SCHEDULE_STATUS: {
    DRAFT: 'draft',
    SUBMITTED: 'submitted',
    UNDER_REVIEW: 'under_review',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    ACTIVE: 'active',
    ARCHIVED: 'archived',
  },

  // Un planning « en vigueur » : envoyé par le chef de service, donc effectif.
  // 'submitted' = envoyé, démarrage à venir ; 'active' = date de début atteinte.
  // Les deux ouvrent les mêmes droits (propositions de modification,
  // remplacements). 'under_review' et 'approved' n'existent plus (migration 026).
  SCHEDULE_IN_FORCE: ['submitted', 'active'],

  // Statuts gardes
  SHIFT_STATUS: {
    PLANNED: 'planned',
    CONFIRMED: 'confirmed',
    ABSENT: 'absent',
    REPLACED: 'replaced',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
  },

  // Statuts absences
  ABSENCE_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
  },

  // Statuts remplacements
  REPLACEMENT_STATUS: {
    PENDING: 'pending',
    PROPOSED: 'proposed',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
  },

  // Portée d'un remplacement « overlay » sur une garde courante
  REPLACEMENT_SCOPE: {
    FULL_PERIOD: 'full_period',
    DATE_RANGE: 'date_range',
    SINGLE_DAY: 'single_day',
    TIME_SLOT: 'time_slot',
  },

  // Confirmation d'un remplacement par le chef de service
  REPLACEMENT_CONFIRMATION: {
    CONFIRMED: 'confirmed',
    PENDING_CHEF: 'pending_chef',
  },

  // Types de notifications
  NOTIFICATION_TYPES: {
    SCHEDULE_SUBMITTED: 'schedule_submitted',
    SCHEDULE_APPROVED: 'schedule_approved',
    SCHEDULE_REJECTED: 'schedule_rejected',
    ABSENCE_DECLARED: 'absence_declared',
    ABSENCE_APPROVED: 'absence_approved',
    REPLACEMENT_NEEDED: 'replacement_needed',
    REPLACEMENT_ACCEPTED: 'replacement_accepted',
    REPLACEMENT_CREATED: 'replacement_created',
    REPLACEMENT_PENDING_CONFIRMATION: 'replacement_pending_confirmation',
    REPLACEMENT_CONFIRMED: 'replacement_confirmed',
    REPLACEMENT_REJECTED: 'replacement_rejected',
    CONFLICT_DETECTED: 'conflict_detected',
    SHIFT_MODIFIED: 'shift_modified',
  },
};
