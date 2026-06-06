import client from '../api/client';
import { User } from '../types';

export const authApi = {
  login: async (identifier: string, password: string): Promise<User> => {
    const response = await client.post('/auth/login', { identifier, password });
    return response.data.user;
  },

  register: async (data: {
    username: string;
    email: string;
    password: string;
  }): Promise<User> => {
    const response = await client.post('/auth/register', data);
    return response.data.user;
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await client.get('/auth/me');
    return response.data.user;
  },

  updateProfile: async (data: {
    name: string;
    profileImageUrl?: string | null;
    bio?: string | null;
    gender?: string | null;
    dateOfBirth?: string | null;
    notificationWebhookUrl?: string | null;
  }): Promise<User> => {
    const response = await client.put('/auth/profile', data);
    return response.data.user;
  },

  updatePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await client.put('/auth/password', { currentPassword, newPassword });
  },

  logout: async (): Promise<void> => {
    await client.post('/auth/logout');
  }
};
