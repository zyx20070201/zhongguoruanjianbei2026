import client from '../api/client';
import { Workbench, WorkbenchState } from '../types';

export const workbenchApi = {
  listByWorkspace: async (workspaceId: string): Promise<Workbench[]> => {
    const response = await client.get('/workbenches', { params: { workspaceId } });
    return response.data.workbenches;
  },

  create: async (data: { workspaceId: string; title?: string; description?: string }): Promise<Workbench> => {
    const response = await client.post('/workbenches', data);
    return response.data.workbench;
  },

  getById: async (id: string): Promise<Workbench> => {
    const response = await client.get(`/workbenches/${id}`);
    return response.data.workbench;
  },

  update: async (id: string, data: { title?: string; description?: string }): Promise<Workbench> => {
    const response = await client.patch(`/workbenches/${id}`, data);
    return response.data.workbench;
  },

  saveState: async (id: string, state: WorkbenchState): Promise<Workbench> => {
    const response = await client.put(`/workbenches/${id}/state`, state);
    return response.data.workbench;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/workbenches/${id}`);
  }
};
