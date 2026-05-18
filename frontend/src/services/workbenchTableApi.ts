import client from '../api/client';

export const workbenchTableApi = {
  getConfig: async (workspaceId: string) => {
    const response = await client.get(`/workbench-table/${workspaceId}`);
    return response.data;
  },

  createProperty: async (
    workspaceId: string,
    data: { name: string; type: string; options?: string[]; widthPx?: number }
  ) => {
    const response = await client.post(`/workbench-table/${workspaceId}/properties`, data);
    return response.data.property;
  },

  updateProperty: async (
    workspaceId: string,
    propertyId: string,
    data: { name?: string; type?: string; visible?: boolean; orderIndex?: number; widthPx?: number; options?: string[] }
  ) => {
    const response = await client.patch(`/workbench-table/${workspaceId}/properties/${propertyId}`, data);
    return response.data.property;
  },

  deleteProperty: async (
    workspaceId: string,
    propertyId: string
  ) => {
    await client.delete(`/workbench-table/${workspaceId}/properties/${propertyId}`);
  },

  setValue: async (
    workspaceId: string,
    workbenchId: string,
    propertyId: string,
    value: unknown
  ) => {
    const response = await client.put(
      `/workbench-table/${workspaceId}/workbenches/${workbenchId}/values/${propertyId}`,
      { value }
    );
    return response.data.value;
  },

  generateSummary: async (
    workspaceId: string,
    workbenchId: string,
    propertyId: string
  ) => {
    const response = await client.post(
      `/workbench-table/${workspaceId}/workbenches/${workbenchId}/values/${propertyId}/ai-summary`
    );
    return response.data;
  }
};
