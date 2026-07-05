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
  getShifts: (id, params) => api.get(`/users/${id}/shifts`, { params }),
  getStats: (id, params) => api.get(`/users/${id}/stats`, { params }),
};

export const departmentsAPI = {
  getAll: (params) => api.get('/departments', { params }),
  getOne: (id) => api.get(`/departments/${id}`),
  create: (data) => api.post('/departments', data),
  update: (id, data) => api.put(`/departments/${id}`, data),
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
  getAll: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};

export default api;
