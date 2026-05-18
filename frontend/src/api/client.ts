import axios from 'axios';

const normalizeApiBaseUrl = (value?: string) => value?.replace(/\/$/, '');

const api = axios.create({
  baseURL: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL) || '/api',
  timeout: 15000,
  withCredentials: true
});

export const workspaceApi = {
  getWorkspaces: () => api.get('/workspaces').then(res => res.data.workspaces),
  getWorkspace: (id: string) => api.get(`/workspaces/${id}`).then(res => res.data.workspace),
  createWorkspace: (data: { name: string; description?: string; major?: string }) => 
    api.post('/workspaces', data).then(res => res.data.workspace),
  updateWorkspace: (id: string, data: { name?: string; description?: string; major?: string; aiTerminalConfig?: string }) => 
    api.put(`/workspaces/${id}`, data).then(res => res.data.workspace),
  deleteWorkspace: (id: string) => api.delete(`/workspaces/${id}`).then(res => res.data),
  duplicateWorkspace: (id: string) => api.post(`/workspaces/${id}/duplicate`).then(res => res.data.workspace),
};

export default api;
