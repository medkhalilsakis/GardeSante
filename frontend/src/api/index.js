import axios from 'axios';
import { useAuthStore } from '../store';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Exposée pour les rares cas qui ne passent pas par l'instance Axios — un
// téléchargement ouvert dans un onglet, par exemple — afin qu'ils visent la
// même adresse que le reste de l'application au lieu de la deviner.
export const API_BASE_URL = BASE_URL;

// Instance Axios principale
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Intercepteur requête: injecter le token
api.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Intercepteur réponse: refresh token automatique
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Compte archivé par le Super Admin : la session en cours n'a plus aucun
    // droit, on la ferme immédiatement plutôt que de laisser l'écran se vider.
    if (error.response?.status === 403 && error.response?.data?.code === 'ACCOUNT_ARCHIVED') {
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (error.response?.data?.code === 'TOKEN_EXPIRED') {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then((token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              return api(originalRequest);
            })
            .catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        const { refreshToken, setAuth, logout, user } = useAuthStore.getState();

        try {
          const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
          const { accessToken: newToken, refreshToken: newRefresh } = res.data.data;
          setAuth(user, newToken, newRefresh);
          processQueue(null, newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } catch (err) {
          processQueue(err, null);
          logout();
          window.location.href = '/login';
          return Promise.reject(err);
        } finally {
          isRefreshing = false;
        }
      } else {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// ============================================================
// API MODULES
// ============================================================

export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.put('/auth/change-password', data),
};

export const usersAPI = {
  getAll: (params) => api.get('/users', { params }),
  getOne: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  activate: (id) => api.put(`/users/${id}/activate`),
  deactivate: (id) => api.put(`/users/${id}/deactivate`),
  getShifts: (id, params) => api.get(`/users/${id}/shifts`, { params }),
  getStats: (id, params) => api.get(`/users/${id}/stats`, { params }),
  // `params` est optionnel. Le Super Admin passe `{ establishmentId }` pour
  // obtenir les rôles de l'établissement **ciblé** (Lot X6, D1) : les rôles sont
  // créés par établissement, et sans cible la liste est légitimement vide. Les
  // appelants existants n'en passent aucun — axios ignore `{ params: undefined }`.
  rolesAvailable: (params) => api.get('/users/roles-available', { params }),
};

// Archivage de comptes — Super Admin uniquement.
// Archiver ≠ clôturer (`deactivate`) ≠ supprimer : le compte est bloqué
// intégralement mais conservé, et réactivable à tout moment.
export const userArchiveAPI = {
  getAll:    (params)      => api.get('/user-archive', { params }),
  archive:   (id, data)    => api.put(`/user-archive/${id}/archive`, data || {}),
  unarchive: (id)          => api.put(`/user-archive/${id}/unarchive`),
};

export const jobTitlesAPI = {
  getAll:  (params) => api.get('/users/job-titles', { params }),
  create:  (data)   => api.post('/users/job-titles', data),
  update:  (id, data) => api.put(`/users/job-titles/${id}`, data),
  delete:  (id)     => api.delete(`/users/job-titles/${id}`),
};

export const departmentsAPI = {
  getAll: (params) => api.get('/departments', { params }),
  getOne: (id) => api.get(`/departments/${id}`),
  create: (data) => api.post('/departments', data),
  update: (id, data) => api.put(`/departments/${id}`, data),
  delete: (id) => api.delete(`/departments/${id}`),
  migrateAndDeactivate: (id, targetDepartmentId) => api.post(`/departments/${id}/migrate-and-deactivate`, { targetDepartmentId }),
  setHead: (id, userId) => api.put(`/departments/${id}/head`, { userId }),
  setSupervisor: (id, userId) => api.put(`/departments/${id}/supervisor`, { userId }),
  removeSupervisor: (id, userId) => api.delete(`/departments/${id}/supervisor/${userId}`),
  addMember: (id, data) => api.post(`/departments/${id}/members`, data),
  removeMember: (id, userId) => api.delete(`/departments/${id}/members/${userId}`),
};

export const schedulesAPI = {
  getAll: (params) => api.get('/schedules', { params }),
  getOne: (id) => api.get(`/schedules/${id}`),
  create: (data) => api.post('/schedules', data),
  update: (id, data) => api.put(`/schedules/${id}`, data),
  submit: (id, data) => api.post(`/schedules/${id}/submit`, data),
  // Plus d'approbation ni de refus : l'envoi met le planning en marche.
  // Les surveillants proposent des modifications (scheduleBuilderAPI.createProposal).
  generate: (data) => api.post('/schedules/generate', data),
  getConflicts: (id) => api.get(`/schedules/${id}/conflicts`),
  // Nouvelles actions CRUD
  action: (id, action, extra = {}) => api.patch(`/schedules/${id}/action`, { action, ...extra }),
  // Personnel hôpital (cross-service)
  getHospitalStaff: (params) => api.get('/schedules/hospital-staff', { params }),
  // Rôles dynamiques
  getRoles: () => api.get('/schedules/roles'),
};


export const shiftsAPI = {
  getAll: (params) => api.get('/shifts', { params }),
  getToday: (params) => api.get('/shifts/today', { params }),
  create: (data) => api.post('/shifts', data),
  update: (id, data) => api.put(`/shifts/${id}`, data),
  delete: (id) => api.delete(`/shifts/${id}`),
  confirm: (id, data) => api.post(`/shifts/${id}/confirm`, data),
  markAbsent: (id) => api.post(`/shifts/${id}/absent`),
};

export const absencesAPI = {
  getAll: (params) => api.get('/absences', { params }),
  getTypes: () => api.get('/absences/types'),
  create: (data) => api.post('/absences', data),
  cancel: (id) => api.put(`/absences/${id}/cancel`),
};

export const absencesShiftAPI = {
  report: (data) => api.post('/absences-shift', data),
  getAll: (params) => api.get('/absences-shift', { params }),
};

export const leavesAPI = {
  getAll: (params) => api.get('/leaves', { params }),
  getTypes: () => api.get('/leaves/types'),
  create: (data) => api.post('/leaves', data, data instanceof FormData
    ? { headers: { 'Content-Type': 'multipart/form-data' } }
    : undefined),
  // Annulation (Lot 6) : le congé passe en `cancelled`, la ligne n'est jamais
  // supprimée — la trace reste lisible dans l'historique.
  cancel: (id) => api.put(`/leaves/${id}/cancel`),
};

export const staffLoansAPI = {
  request: (data) => api.post('/staff-loans', data),
  getAll: (params) => api.get('/staff-loans', { params }),
  decide: (id, data) => api.put(`/staff-loans/${id}/decide`, data),
  // Portée décidée par le serveur (établissement pour un directeur, services
  // dont on est chef pour un chef de service).
  stats: (params) => api.get('/staff-loans/stats', { params }),
};

export const notesAPI = {
  getAll: (params) => api.get('/notes', { params }),
  getOne: (id) => api.get(`/notes/${id}`),
  markRead: (id) => api.put(`/notes/${id}/read`),
  getReaders: (id) => api.get(`/notes/${id}/readers`),
  // Suivi de diffusion (Lot X5) — non-lecteurs nommés et relance tracée
  getDiffusion: (id) => api.get(`/notes/${id}/diffusion`),
  remind: (id, userIds) => api.post(`/notes/${id}/remind`, userIds ? { userIds } : {}),
  delete: (id) => api.delete(`/notes/${id}`),
  publish: ({ title, body, category, priority, isPinned, attachments = [] }) => {
    const form = new FormData();
    form.append('title', title);
    if (body) form.append('body', body);
    if (category) form.append('category', category);
    if (priority) form.append('priority', priority);
    if (isPinned) form.append('isPinned', 'true');
    attachments.forEach((f) => form.append('attachments', f));
    return api.post('/notes', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Calendrier hôpital et statistiques par portée (Lot 3) — lecture seule.
export const hospitalCalendarAPI = {
  get: (params) => api.get('/hospital-calendar', { params }),
};

export const scopedStatsAPI = {
  get: (params) => api.get('/statistics/scoped', { params }),
};

// Vue d'ensemble de pilotage du directeur (Lot Y1).
// Complémentaire de `supervisionAPI.getOverview` : celui-ci répond « où en est
// la garde aujourd'hui ? », celui-là « où en est l'établissement ? »
// (encadrement des services, composition de l'effectif, accès, demandes en
// attente). La portée est décidée par le serveur.
export const directorOverviewAPI = {
  get: (params) => api.get('/director/overview', { params }),
};

// Vue d'ensemble de pilotage d'un service (Lot Z3).
// Un seul appel rend tout ce qu'un chef doit savoir sur SON service : garde du
// jour et statut d'appel, effectif et accès, ses plannings par état, ses files
// d'attente, les congés qui heurtent une garde, l'équité de la charge.
// `departmentId` est facultatif — sans lui, le serveur retient le service
// primaire de l'appelant ; avec lui, il vérifie le droit de lecture (403 sinon).
export const chefOverviewAPI = {
  get: (params) => api.get('/chef/overview', { params }),
};

// Journal de service et alertes (Lot 4).
// Les absences et retards ne passent PAS par ici : voir absencesShiftAPI.
export const journalAPI = {
  getOverview: (params)     => api.get('/journal/overview', { params }),
  getCalls:    (params)     => api.get('/journal/calls',    { params }),
  getEvents:   (params)     => api.get('/journal',          { params }),
  addEvent:    (data)       => api.post('/journal', data),
  getAlerts:   (params)     => api.get('/journal/alerts',   { params }),
  updateAlert: (id, action) => api.patch(`/journal/alerts/${id}`, { action }),
};

// Supervision hôpital (Lot 5) — surveillant général, directeur, super admin.
// Lecture seule, sauf la transmission d'un rapport à la direction. La
// confirmation d'un remplacement reste hors de cette surface, volontairement.
export const supervisionAPI = {
  getOverview:  (params) => api.get('/supervision/overview',  { params }),
  getSchedules: (params) => api.get('/supervision/schedules', { params }),
  getConflicts: (params) => api.get('/supervision/conflicts', { params }),
  getLoans:     (params) => api.get('/supervision/loans',     { params }),
  sendReport:   (data)   => api.post('/supervision/report',   data),
};

// Espace « Planning à consulter » (point 3) — portée : les services de
// l'appelant pour le surveillant de service et le chef, l'établissement entier
// pour le surveillant général, le directeur et l'admin hôpital.
export const scheduleInboxAPI = {
  getAll: (params) => api.get('/schedule-inbox', { params }),
};

export const replacementsAPI = {
  getAll: (params) => api.get('/replacements', { params }),
  create: (data) => api.post('/replacements', data),
  accept: (id, data) => api.post(`/replacements/${id}/accept`, data),
  reject: (id) => api.post(`/replacements/${id}/reject`),
  getCandidates: (id) => api.get(`/replacements/${id}/candidates`),

  // Remplacements « overlay » sur garde courante
  getEligibleSchedules: () => api.get('/replacements/eligible-schedules'),
  getOverlay: (params) => api.get('/replacements/overlay', { params }),
  createOverlay: (data) => api.post('/replacements/overlay', data),
  confirmOverlay: (id) => api.post(`/replacements/overlay/${id}/confirm`),
  rejectOverlay: (id, data) => api.post(`/replacements/overlay/${id}/reject`, data),
  deleteOverlay: (id) => api.delete(`/replacements/overlay/${id}`),
  getScheduleStaff: (scheduleId) => api.get(`/replacements/schedule/${scheduleId}/staff`),
};

export const statisticsAPI = {
  getDashboard: (params) => api.get('/statistics/dashboard', { params }),
  getShiftStats: (params) => api.get('/statistics/shifts', { params }),
  getAbsenceStats: (params) => api.get('/statistics/absences', { params }),
  getCoverage: (params) => api.get('/statistics/coverage', { params }),
};

export const notificationsAPI = {
  getAll:      (params) => api.get('/notifications', { params }),
  markRead:    (id)     => api.put(`/notifications/${id}/read`),
  markAllRead: ()       => api.put('/notifications/read-all'),
  // Écran dédié (point 6) — suppression unitaire et purge des lues.
  remove:      (id)     => api.delete(`/notifications/${id}`),
  clearRead:   ()       => api.delete('/notifications/read'),
};

export const profileAPI = {
  getProfile:        ()         => api.get('/profile'),
  updateCredentials: (data)     => api.put('/profile/credentials', data),
  updatePreferences: (data)     => api.put('/profile/preferences', data),
  requestChange:     (data)     => api.post('/profile/request-change', data),
  getMyRequests:     ()         => api.get('/profile/my-requests'),
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.post('/profile/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteAvatar: () => api.delete('/profile/avatar'),
  adminGetRequests:  (params)    => api.get('/profile/admin/requests', { params }),
  adminPendingCount: ()          => api.get('/profile/admin/pending-count'),
  adminApprove:      (id)        => api.put(`/profile/admin/requests/${id}/approve`),
  adminReject:       (id, reason)=> api.put(`/profile/admin/requests/${id}/reject`, { reason }),
};

export const historyAPI = {
  getMine:         (params)   => api.get('/history/mine',        { params }),
  getAll:          (params)   => api.get('/history/all',         { params }),
  // `{ scope: 'establishment' }` (Lot 6) élargit la liste à l'établissement pour
  // la direction ; sans paramètre, comportement inchangé.
  getCategories:   (params)   => api.get('/history/categories', { params }),
  getUserHistory:  (id, p)    => api.get(`/history/users/${id}`, { params: p }),
  getUsersList:    ()         => api.get('/history/users'),
};

export const portfolioAPI = {
  getAll:         (params)   => api.get('/portfolio',                    { params }),
  getUserDetails: (userId)   => api.get(`/portfolio/${userId}/details`),
};

// Supervision plateforme (Lot 6) — Super Admin, CONSULTATION UNIQUEMENT.
// Aucune méthode d'écriture n'est exposée, à dessein : le Super Admin voit
// les gardes de chaque hôpital sans jamais pouvoir les modifier.
export const adminOversightAPI = {
  getEstablishments: (params) => api.get('/admin-oversight/establishments', { params }),
  getSchedules:      (params) => api.get('/admin-oversight/schedules',      { params }),
  getAbsences:       (params) => api.get('/admin-oversight/absences',       { params }),
  getReplacements:   (params) => api.get('/admin-oversight/replacements',   { params }),
};

export const establishmentsAPI = {
  // CRUD établissements
  getAll:        (params)      => api.get('/establishments',               { params }),
  getOne:        (id)          => api.get(`/establishments/${id}`),
  create:        (data)        => api.post('/establishments',              data),
  update:        (id, data)    => api.put(`/establishments/${id}`,         data),
  activate:      (id)          => api.put(`/establishments/${id}/activate`),
  deactivate:    (id)          => api.delete(`/establishments/${id}`),
  getRoles:      (id)          => api.get(`/establishments/${id}/roles`),
  updateConfig:  (id, configs) => api.put(`/establishments/${id}/config`,  { configs }),

  // Personnel
  getPersonnel:    (id, params) => api.get(`/establishments/${id}/personnel`, { params }),
  updatePersonnel: (userId, data) => api.put(`/establishments/personnel/${userId}`, data),
  removePersonnel: (userId)     => api.delete(`/establishments/personnel/${userId}`),
  getSalaryReport: (userId, params) => api.get(`/establishments/personnel/${userId}/salary`, { params }),

  // Historique établissement
  getHistory: (id, params) => api.get(`/establishments/${id}/history`, { params }),

  // Directeur
  getDirector:    (id)         => api.get(`/establishments/${id}/director`),
  updateDirector: (id, data)   => api.put(`/establishments/${id}/director`, data),
  removeDirector: (id)         => api.delete(`/establishments/${id}/director`),
};

// ── Admin API (Super Admin uniquement) ────────────────────────
export const adminAPI = {
  // Gouvernorats
  getGovernorates: ()            => api.get('/admin/governorates'),

  // Statistiques globales
  getStats:        ()            => api.get('/admin/stats'),
  getOnlineUsers:  ()            => api.get('/admin/online-users'),

  // Activité réelle de la plateforme (services, plannings, gardes du tableur,
  // absences, remplacements, prêts, alertes, couverture, traçabilité)
  getPlatformActivity: ()        => api.get('/admin/platform-activity'),

  // Gestion établissements (cascade)
  deactivateEst:   (id)          => api.put(`/admin/establishments/${id}/deactivate`),
  activateEst:     (id, data)    => api.put(`/admin/establishments/${id}/activate`, data),

  // Gestion directeur
  resetDirectorPwd:    (id, data) => api.put(`/admin/establishments/${id}/director/password`, data),
  toggleDirectorStatus:(id)       => api.put(`/admin/establishments/${id}/director/toggle-status`),

  // Jours & Périodes Fériés
  getHolidays:         (params)   => api.get('/admin/holidays', { params }),
  createHoliday:       (data)     => api.post('/admin/holidays', data),
  updateHoliday:       (id, data) => api.put(`/admin/holidays/${id}`, data),
  deleteHoliday:       (id)       => api.delete(`/admin/holidays/${id}`),
  seedTunisiaHolidays: (data)     => api.post('/admin/holidays/seed-tunisia', data),

  // Référentiels nationaux (Lot X4) — types de garde, types d'absence, droits
  getReferentiels:      ()          => api.get('/admin/referentiels/overview'),
  getPermissionMatrix:  ()          => api.get('/admin/referentiels/permissions'),
  seedReferentiels:     (data)      => api.post('/admin/referentiels/seed', data),

  getShiftTypes:        (params)    => api.get('/admin/referentiels/shift-types', { params }),
  createShiftType:      (data)      => api.post('/admin/referentiels/shift-types', data),
  updateShiftType:      (id, data)  => api.put(`/admin/referentiels/shift-types/${id}`, data),
  deleteShiftType:      (id)        => api.delete(`/admin/referentiels/shift-types/${id}`),

  getAbsenceTypes:      (params)    => api.get('/admin/referentiels/absence-types', { params }),
  createAbsenceType:    (data)      => api.post('/admin/referentiels/absence-types', data),
  updateAbsenceType:    (id, data)  => api.put(`/admin/referentiels/absence-types/${id}`, data),
  deleteAbsenceType:    (id)        => api.delete(`/admin/referentiels/absence-types/${id}`),

  // Fiche de conformité des établissements (Lot X6, C1)
  getConformite:        ()          => api.get('/admin/conformite'),
  getConformiteDetail:  (id)        => api.get(`/admin/conformite/${id}`),
  repairConformite:     (id, data)  => api.post(`/admin/conformite/${id}/repair`, data),

  // Annuaire national du personnel (Lot X6, D2)
  searchStaff:          (params)    => api.get('/admin/annuaire', { params }),
  getAnnuaireFacets:    ()          => api.get('/admin/annuaire/facets'),
  getAnnuairePerson:    (id)        => api.get(`/admin/annuaire/${id}`),
};

// ── Schedule Builder API (Chef de Service) ───────────────────
export const scheduleBuilderAPI = {
  // Wizard
  getWizardContext: (params)        => api.get('/schedule-builder/wizard/context', { params }),
  // Génération
  generate:          (data)          => api.post('/schedule-builder/generate', data),
  generateProposals: (data)          => api.post('/schedule-builder/generate-proposals', data),
  confirmProposal:   (data)          => api.post('/schedule-builder/confirm-proposal', data),
  // Par planning
  getDetail:        (id)            => api.get(`/schedule-builder/${id}/detail`),
  getHistory:       (id)            => api.get(`/schedule-builder/${id}/history`),
  validate:         (id)            => api.post(`/schedule-builder/${id}/validate`),
  validateShift:    (id, data)      => api.post(`/schedule-builder/${id}/validate-shift`, data),
  saveDraft:        (id, data)      => api.put(`/schedule-builder/${id}/draft`, data),
  getChangeProposals: (id)          => api.get(`/schedule-builder/${id}/change-proposals`),
  proposeChanges:   (id, data)      => api.post(`/schedule-builder/${id}/change-proposals`, data),
  decideProposal:   (scheduleId, proposalId, data) => api.post(`/schedule-builder/${scheduleId}/change-proposals/${proposalId}/decision`, data),
  decideAllProposals: (scheduleId, data) => api.post(`/schedule-builder/${scheduleId}/change-proposals/decide-all`, data),
  submit:           (id, data)      => api.post(`/schedule-builder/${id}/submit`, data),
  notifySG:         (id, data)      => api.post(`/schedule-builder/${id}/notify-sg`, data),
  cancelSubmission: (id, reason)    => api.post(`/schedule-builder/${id}/cancel-submission`, { reason }),
  createSnapshot:   (id)            => api.post(`/schedule-builder/${id}/snapshot`),
  // Import
  importPreview:    (formData)      => api.post('/schedule-builder/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  importConfirm:    (data)          => api.post('/schedule-builder/import/confirm', data),
  // Export authentifie
  exportExcel:      (id)            => api.get(`/schedule-builder/${id}/export/excel`, { responseType: 'blob' }),
  exportCSV:        (id)            => api.get(`/schedule-builder/${id}/export/csv`, { responseType: 'blob' }),
  exportPDF:        (id)            => api.get(`/schedule-builder/${id}/export/pdf`, { responseType: 'blob' }),
  exportCalendarPDF:(id)            => api.get(`/schedule-builder/${id}/export/detailed-calendar-pdf`, { responseType: 'blob' }),
};

// ── Schedule Config API (Colonnes, Règles, Templates) ────────
export const scheduleConfigAPI = {
  // Colonnes
  getColumns:           ()           => api.get('/schedule-config/columns'),
  createColumn:         (data)       => api.post('/schedule-config/columns', data),
  deleteColumn:         (id)         => api.delete(`/schedule-config/columns/${id}`),
  detectColumn:         (rawLabel)   => api.post('/schedule-config/columns/detect', { rawLabel }),
  confirmDetection:     (data)       => api.post('/schedule-config/columns/confirm-detection', data),
  // Règles
  getRules:             ()           => api.get('/schedule-config/rules'),
  createRule:           (data)       => api.post('/schedule-config/rules', data),
  toggleRule:           (id)         => api.put(`/schedule-config/rules/${id}/toggle`),
  deleteRule:           (id)         => api.delete(`/schedule-config/rules/${id}`),
  // Templates
  getTemplates:         (params)     => api.get('/schedule-config/templates', { params }),
  createTemplate:       (data)       => api.post('/schedule-config/templates', data),
  updateTemplate:       (id, data)   => api.put(`/schedule-config/templates/${id}`, data),
  deleteTemplate:       (id)         => api.delete(`/schedule-config/templates/${id}`),
  // Init
  init:                 ()           => api.post('/schedule-config/init'),
};

// ── Assistant Intelligent V2 (Lot 7) ─────────────────────────
// Surface distincte de `scheduleBuilderAPI.generateProposals`, qui reste en place :
// l'assistant V1 continue de fonctionner à l'identique.
export const assistantAPI = {
  getContext:  (params)     => api.get('/assistant/context', { params }),
  generate:    (data)       => api.post('/assistant/generate', data),
  validate:    (data)       => api.post('/assistant/validate', data),
  applyFixes:  (data)       => api.post('/assistant/apply-fixes', data),
  confirm:     (data)       => api.post('/assistant/confirm', data),
  // Briefs réutilisables
  listBriefs:  (params)     => api.get('/assistant/briefs', { params }),
  saveBrief:   (data)       => api.post('/assistant/briefs', data),
  useBrief:    (id, data)   => api.post(`/assistant/briefs/${id}/use`, data),
  deleteBrief: (id)         => api.delete(`/assistant/briefs/${id}`),
};

export default api;
