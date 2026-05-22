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

  logout: async (): Promise<void> => {
    await client.post('/auth/logout');
  }
};
