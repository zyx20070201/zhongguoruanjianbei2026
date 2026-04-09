import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
});

export const workspaceApi = {
  getWorkspaces: (userId: string) => api.get(`/workspaces?userId=${userId}`).then(res => res.data.workspaces),
  getWorkspace: (id: string) => api.get(`/workspaces/${id}`).then(res => res.data.workspace),
  createWorkspace: (data: { name: string; description?: string; major?: string; userId: string }) => 
    api.post('/workspaces', data).then(res => res.data.workspace),
  updateWorkspace: (id: string, data: { name?: string; description?: string; major?: string }) => 
    api.put(`/workspaces/${id}`, data).then(res => res.data.workspace),
  deleteWorkspace: (id: string) => api.delete(`/workspaces/${id}`).then(res => res.data),
  duplicateWorkspace: (id: string) => api.post(`/workspaces/${id}/duplicate`).then(res => res.data.workspace),
};

export default api;
