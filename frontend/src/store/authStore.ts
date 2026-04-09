import { create } from 'zustand';

interface User {
  id: string;
  username: string;
}

interface AuthState {
  user: User | null;
  login: (username: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  login: async (username) => {
    // Phase 1 mock
    try {
      const res = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'password123' })
      });
      const data = await res.json();
      set({ user: data.user });
    } catch (e) {
      console.error(e);
    }
  },
  logout: () => set({ user: null })
}));
