import client from '../api/client';
import { FileSystemObject } from '../types';

export interface FilePreviewInfo {
  status: 'ready' | 'unavailable' | 'unsupported';
  previewKind: 'pdf' | 'document' | 'binary' | 'unknown';
  previewUrl?: string;
  sourceUrl?: string;
  message?: string;
}

export interface RenderableDocumentPage {
  fileId?: string;
  page: number;
  text: string;
  charStart?: number;
  charEnd?: number;
}

export interface RenderableDocumentChunk {
  fileId?: string;
  chunkIndex: number;
  text: string;
  html?: string;
  headingPath?: string[];
  paragraphIndex?: number;
  blockId?: string;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
}

export interface RenderableDocument {
  kind: 'pdf' | 'docx' | 'markdown' | 'code' | 'text';
  fileId?: string;
  fileName?: string;
  pageCount?: number;
  pages?: RenderableDocumentPage[];
  chunks?: RenderableDocumentChunk[];
  extractor: string;
  fallbackReason?: string;
}

export interface DiscoveredResource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  summary?: string;
  score?: number;
  source?: string;
  provider: 'exa' | 'tavily';
  publishedAt?: string;
  author?: string;
  contentPreview?: string;
}

export interface SourceDiscoveryResult {
  provider: 'exa' | 'tavily';
  query: string;
  results: DiscoveredResource[];
}

export interface ResourceCreateOptions {
  workbenchId?: string;
  resourceRole?: 'source' | 'note' | 'generated' | 'artifact' | 'resource' | 'file' | string;
  resourceType?: string;
  scope?: 'workspace' | 'workbench' | string;
  origin?: string;
  metadata?: Record<string, unknown>;
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

  getResources: async (
    workspaceId: string,
    params?: { workbenchId?: string; scope?: 'all' | 'workspace' | 'workbench' | string; role?: string }
  ): Promise<FileSystemObject[]> => {
    const response = await client.get(`/files/workspace/${workspaceId}/resources`, { params });
    return response.data;
  },

  createFolder: async (workspaceId: string, data: { name: string; parentId?: string | null; parentPath?: string } & ResourceCreateOptions): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/folder`, data);
    return response.data;
  },

  createFile: async (workspaceId: string, data: { name: string; content?: string; parentId?: string | null; parentPath?: string; fileCategory?: string; mimeType?: string; tags?: string[] } & ResourceCreateOptions): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/file`, data);
    return response.data;
  },

  importUrl: async (
    workspaceId: string,
    data: { url: string; title?: string; parentId?: string | null; parentPath?: string } & ResourceCreateOptions
  ): Promise<{ file: FileSystemObject; source: { url: string; title: string } }> => {
    const response = await client.post(`/files/workspace/${workspaceId}/import-url`, data);
    return response.data;
  },

  extractUrlPreview: async (
    workspaceId: string,
    data: { url: string; title?: string }
  ): Promise<{
    url: string;
    title: string;
    contentMarkdown: string;
    contentHtml?: string;
    excerpt?: string;
    siteName?: string;
    byline?: string;
    links?: Array<{ href: string; text: string; internal: boolean }>;
    images?: Array<{ src: string; alt?: string }>;
  }> => {
    const response = await client.post(`/files/workspace/${workspaceId}/extract-url-preview`, data);
    return response.data;
  },

  discoverSources: async (
    workspaceId: string,
    data: { query: string; maxResults?: number; provider?: 'auto' | 'exa' | 'tavily' }
  ): Promise<SourceDiscoveryResult> => {
    const response = await client.post(`/files/workspace/${workspaceId}/discover-sources`, data);
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

  upload: async (
    workspaceId: string,
    files: File[],
    parentId?: string | null,
    parentPath?: string,
    options?: ResourceCreateOptions
  ): Promise<any> => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (parentId) formData.append('parentId', parentId);
    if (parentPath) formData.append('parentPath', parentPath);
    if (options?.workbenchId) formData.append('workbenchId', options.workbenchId);
    if (options?.resourceRole) formData.append('resourceRole', options.resourceRole);
    if (options?.resourceType) formData.append('resourceType', options.resourceType);
    if (options?.scope) formData.append('scope', options.scope);
    if (options?.origin) formData.append('origin', options.origin);
    if (options?.metadata) formData.append('metadata', JSON.stringify(options.metadata));

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

  saveGenerated: async (workspaceId: string, data: { targetDir: string; filename: string; content: string; category?: string } & ResourceCreateOptions): Promise<FileSystemObject> => {
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

  getDocumentStructure: async (workspaceId: string, id: string): Promise<RenderableDocument> => {
    const response = await client.get(`/files/workspace/${workspaceId}/document-structure`, {
      params: { id }
    });
    return response.data;
  },

  downloadUrl: (workspaceId: string, id: string): string => {
    return `${client.defaults.baseURL}/files/workspace/${workspaceId}/download?id=${id}`;
  },

  previewUrl: (workspaceId: string, id: string): string => {
    return `${client.defaults.baseURL}/files/workspace/${workspaceId}/preview?id=${id}`;
  }
};
