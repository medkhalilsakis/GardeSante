import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================
// AUTH STORE
// ============================================================
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),

      updateUser: (updates) =>
        set((state) => ({ user: { ...state.user, ...updates } })),

      // Mise à jour rapide de l'avatar sans re-login
      updateAvatar: (avatarUrl) =>
        set((state) => ({ user: state.user ? { ...state.user, avatarUrl } : state.user })),

      hasPermission: (permissionCode) => {
        const { user } = get();
        if (!user) return false;
        if (user.roleCode === 'super_admin') return true;
        return user.permissions?.includes(permissionCode) || false;
      },

      isSuperAdmin: () => get().user?.roleCode === 'super_admin',
    }),
    {
      name: 'gardesante-auth',
      partialize: (state) => ({
        user:            state.user,
        accessToken:     state.accessToken,
        refreshToken:    state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);


// ============================================================
// UI STORE
// ============================================================
export const useUIStore = create(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      language: 'fr',         // 'fr' | 'ar'
      direction: 'ltr',       // 'ltr' | 'rtl'
      theme: 'light',         // 'light' | 'dark'

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setLanguage: (lang) => {
        const dir = lang === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.dir = dir;
        document.documentElement.lang = lang;
        set({ language: lang, direction: dir });
      },

      setTheme: (newTheme) => {
        document.documentElement.setAttribute('data-theme', newTheme);
        set({ theme: newTheme });
      },

      toggleTheme: () =>
        set((state) => {
          const next = state.theme === 'light' ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', next);
          return { theme: next };
        }),
    }),
    {
      name: 'gardesante-ui',
      partialize: (state) => ({
        language:         state.language,
        direction:        state.direction,
        sidebarCollapsed: state.sidebarCollapsed,
        theme:            state.theme,
      }),
    }
  )
);


// ============================================================
// NOTIFICATIONS STORE
// ============================================================
export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,

  setNotifications: (notifications, unreadCount) =>
    set({ notifications, unreadCount }),

  addNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + (notification.is_read ? 0 : 1),
    })),

  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    })),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    })),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));
