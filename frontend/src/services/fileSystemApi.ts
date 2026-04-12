import client from '../api/client';
import { FileSystemObject } from '../types';

export interface FilePreviewInfo {
  status: 'ready' | 'unavailable' | 'unsupported';
  previewKind: 'pdf' | 'document' | 'binary' | 'unknown';
  previewUrl?: string;
  sourceUrl?: string;
  message?: string;
}

export const fileSystemApi = {
  getTree: async (workspaceId: string): Promise<FileSystemObject[]> => {
    const response = await client.get(`/files/workspace/${workspaceId}/tree`);
    return response.data;
  },

  init: async (workspaceId: string): Promise<FileSystemObject[]> => {
    const response = await client.post(`/files/workspace/${workspaceId}/init`);
    return response.data;
  },

  createFolder: async (workspaceId: string, data: { name: string; parentId?: string | null; parentPath?: string }): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/folder`, data);
    return response.data;
  },

  createFile: async (workspaceId: string, data: { name: string; content?: string; parentId?: string | null; parentPath?: string; fileCategory?: string }): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/file`, data);
    return response.data;
  },

  rename: async (workspaceId: string, data: { id: string; newName: string }): Promise<FileSystemObject> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/rename`, data);
    return response.data;
  },

  move: async (workspaceId: string, data: { id: string; targetParentId?: string | null }): Promise<FileSystemObject> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/move`, data);
    return response.data;
  },

  updateTags: async (workspaceId: string, data: { id: string; tags: string[] }): Promise<FileSystemObject> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/tags`, data);
    return response.data;
  },

  remove: async (workspaceId: string, id: string): Promise<{ success: boolean }> => {
    const response = await client.delete(`/files/workspace/${workspaceId}`, { data: { id } });
    return response.data;
  },

  copy: async (workspaceId: string, data: { id: string; targetParentId?: string | null }): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/copy`, data);
    return response.data;
  },

  upload: async (workspaceId: string, files: File[], parentId?: string | null, parentPath?: string): Promise<any> => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (parentId) formData.append('parentId', parentId);
    if (parentPath) formData.append('parentPath', parentPath);

    const response = await client.post(`/files/workspace/${workspaceId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  getContent: async (workspaceId: string, id: string): Promise<{ content: string }> => {
    const response = await client.get(`/files/workspace/${workspaceId}/content`, { params: { id } });
    return response.data;
  },

  saveContent: async (workspaceId: string, data: { id: string; content: string }): Promise<FileSystemObject> => {
    const response = await client.put(`/files/workspace/${workspaceId}/content`, data);
    return response.data;
  },

  saveGenerated: async (workspaceId: string, data: { targetDir: string; filename: string; content: string; category?: string }): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/generated`, data);
    return response.data;
  },

  getPreviewInfo: async (workspaceId: string, id: string): Promise<FilePreviewInfo> => {
    const response = await client.get(`/files/workspace/${workspaceId}/preview-info`, {
      params: { id }
    });
    const data = response.data as FilePreviewInfo;

    const resolveUrl = (value?: string) =>
      value
        ? new URL(value, client.defaults.baseURL?.replace(/\/$/, '') || window.location.origin).toString()
        : undefined;

    return {
      ...data,
      previewUrl: resolveUrl(data.previewUrl),
      sourceUrl: resolveUrl(data.sourceUrl)
    };
  },

  downloadUrl: (workspaceId: string, id: string): string => {
    return `${client.defaults.baseURL}/files/workspace/${workspaceId}/download?id=${id}`;
  },

  previewUrl: (workspaceId: string, id: string): string => {
    return `${client.defaults.baseURL}/files/workspace/${workspaceId}/preview?id=${id}`;
  }
};
