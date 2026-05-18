import { create } from 'zustand';
import { authApi } from '../services/authApi';
import { User } from '../types';

const AUTH_STORAGE_KEY = 'pp1-auth-user';

const readStoredUser = (): User | null => {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return rawValue ? (JSON.parse(rawValue) as User) : null;
  } catch {
    return null;
  }
};

const persistUser = (user: User | null) => {
  if (typeof window === 'undefined') return;

  if (!user) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
};

interface AuthState {
  user: User | null;
  loading: boolean;
  hydrated: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  register: (payload: { username: string; email: string; password: string }) => Promise<User>;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: readStoredUser(),
  loading: false,
  hydrated: false,
  login: async (identifier, password) => {
    set({ loading: true });
    try {
      const user = await authApi.login(identifier, password);
      persistUser(user);
      set({ user, loading: false, hydrated: true });
      return user;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  register: async (payload) => {
    set({ loading: true });
    try {
      const user = await authApi.register(payload);
      persistUser(user);
      set({ user, loading: false, hydrated: true });
      return user;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  hydrate: async () => {
    const storedUser = readStoredUser();
    if (!storedUser) {
      set({ user: null, hydrated: true });
      return;
    }

    try {
      const user = await authApi.getCurrentUser();
      persistUser(user);
      set({ user, hydrated: true });
    } catch {
      persistUser(null);
      set({ user: null, hydrated: true });
    }
  },
  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore logout failures and clear local state anyway
    }
    persistUser(null);
    set({ user: null, hydrated: true });
  }
}));
