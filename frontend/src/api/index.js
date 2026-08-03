import axios from 'axios';
import { useAuthStore } from '../store';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
  rolesAvailable: () => api.get('/users/roles-available'),
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
  setHead: (id, userId) => api.put(`/departments/${id}/head`, { userId }),
  setSupervisor: (id, userId) => api.put(`/departments/${id}/supervisor`, { userId }),
  addMember: (id, data) => api.post(`/departments/${id}/members`, data),
  removeMember: (id, userId) => api.delete(`/departments/${id}/members/${userId}`),
};

export const schedulesAPI = {
  getAll: (params) => api.get('/schedules', { params }),
  getOne: (id) => api.get(`/schedules/${id}`),
  create: (data) => api.post('/schedules', data),
  update: (id, data) => api.put(`/schedules/${id}`, data),
  submit: (id, data) => api.post(`/schedules/${id}/submit`, data),
  approve: (id, data) => api.post(`/schedules/${id}/approve`, data),
  reject: (id, data) => api.post(`/schedules/${id}/reject`, data),
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
  approve: (id, data) => api.put(`/absences/${id}/approve`, data),
  reject: (id, data) => api.put(`/absences/${id}/reject`, data),
  cancel: (id) => api.put(`/absences/${id}/cancel`),
};

export const replacementsAPI = {
  getAll: (params) => api.get('/replacements', { params }),
  create: (data) => api.post('/replacements', data),
  accept: (id, data) => api.post(`/replacements/${id}/accept`, data),
  reject: (id) => api.post(`/replacements/${id}/reject`),
  getCandidates: (id) => api.get(`/replacements/${id}/candidates`),
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
  getCategories:   ()         => api.get('/history/categories'),
  getUserHistory:  (id, p)    => api.get(`/history/users/${id}`, { params: p }),
  getUsersList:    ()         => api.get('/history/users'),
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

  // Gestion établissements (cascade)
  deactivateEst:   (id)          => api.put(`/admin/establishments/${id}/deactivate`),
  activateEst:     (id, data)    => api.put(`/admin/establishments/${id}/activate`, data),

  // Gestion directeur
  resetDirectorPwd:    (id, data) => api.put(`/admin/establishments/${id}/director/password`, data),
  toggleDirectorStatus:(id)       => api.put(`/admin/establishments/${id}/director/toggle-status`),
};

// ── Schedule Builder API (Chef de Service) ───────────────────
export const scheduleBuilderAPI = {
  // Wizard
  getWizardContext: (params)        => api.get('/schedule-builder/wizard/context', { params }),
  // Génération
  generate:         (data)          => api.post('/schedule-builder/generate', data),
  // Par planning
  getDetail:        (id)            => api.get(`/schedule-builder/${id}/detail`),
  validate:         (id)            => api.post(`/schedule-builder/${id}/validate`),
  validateShift:    (id, data)      => api.post(`/schedule-builder/${id}/validate-shift`, data),
  saveDraft:        (id, data)      => api.put(`/schedule-builder/${id}/draft`, data),
  submit:           (id, data)      => api.post(`/schedule-builder/${id}/submit`, data),
  createSnapshot:   (id)            => api.post(`/schedule-builder/${id}/snapshot`),
  // Import
  importPreview:    (formData)      => api.post('/schedule-builder/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  importConfirm:    (data)          => api.post('/schedule-builder/import/confirm', data),
  // Export
  exportExcelUrl:   (id)            => `${api.defaults.baseURL}/schedule-builder/${id}/export/excel`,
  exportPdfUrl:     (id)            => `${api.defaults.baseURL}/schedule-builder/${id}/export/pdf`,
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

export default api;
