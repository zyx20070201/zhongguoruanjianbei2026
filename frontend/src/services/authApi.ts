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
  },

  requestPasswordReset: async (identifier: string): Promise<{ message: string }> => {
    const response = await client.post('/auth/password-reset/request', { identifier });
    return response.data;
  },

  resetPassword: async (token: string, password: string): Promise<{ success: boolean }> => {
    const response = await client.post('/auth/password-reset/confirm', { token, password });
    return response.data;
  },

  verifyEmail: async (token: string): Promise<{ user: User }> => {
    const response = await client.post('/auth/email/verify', { token });
    return response.data;
  },

  resendEmailVerification: async (): Promise<{ message: string }> => {
    const response = await client.post('/auth/email/resend');
    return response.data;
  }
};
