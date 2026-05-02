import client from '../api/client';
import {
  FileSystemObject,
  LearningGoalDraft,
  LearningTerminalMessage,
  LearningTerminalResponse,
  Workbench
} from '../types';

export const learningApi = {
  chatTerminal: async (
    workspaceId: string,
    messages: LearningTerminalMessage[]
  ): Promise<LearningTerminalResponse> => {
    const response = await client.post('/learning/terminal/chat', {
      workspaceId,
      messages: messages.map(({ role, content }) => ({ role, content }))
    });
    return response.data;
  },

  createGuidedWorkbench: async (data: {
    workspaceId: string;
    goalText: string;
    title?: string;
    mode?: LearningGoalDraft['suggestedMode'];
    goalDraft?: LearningGoalDraft;
  }): Promise<{
    workbench: Workbench;
    generatedResources: FileSystemObject[];
    goalDraft: LearningGoalDraft;
  }> => {
    const response = await client.post('/learning/workbenches/guided', data);
    return response.data;
  },

  indexKnowledgeFile: async (workspaceId: string, fileObjectId: string) => {
    const response = await client.post('/learning/knowledge/index', {
      workspaceId,
      fileObjectId
    });
    return response.data;
  },

  getKnowledgeIndexStatus: async (workspaceId: string, fileObjectId: string) => {
    const response = await client.get('/learning/knowledge/status', {
      params: { workspaceId, fileObjectId }
    });
    return response.data;
  },

  reindexWorkspaceKnowledge: async (workspaceId: string) => {
    const response = await client.post('/learning/knowledge/reindex-workspace', {
      workspaceId
    });
    return response.data;
  },

  listKnowledgeIndexJobs: async (workspaceId: string, limit = 50) => {
    const response = await client.get('/learning/knowledge/jobs', {
      params: { workspaceId, limit }
    });
    return response.data;
  },

  searchKnowledge: async (data: {
    workspaceId: string;
    query: string;
    fileIds?: string[];
    limit?: number;
  }) => {
    const response = await client.post('/learning/knowledge/search', data);
    return response.data;
  },

  buildContext: async (data: {
    workspaceId: string;
    workbenchId?: string;
    goalId?: string;
    activeFileId?: string;
    query?: string;
  }) => {
    const response = await client.post('/learning/context', data);
    return response.data;
  },

  listCapabilities: async () => {
    const response = await client.get('/learning/capabilities');
    return response.data;
  },

  getReadiness: async (workspaceId: string) => {
    const response = await client.get('/learning/readiness', {
      params: { workspaceId }
    });
    return response.data;
  },

  executeCapability: async (
    name: string,
    data: {
      workspaceId: string;
      workbenchId?: string;
      goalId?: string;
      input?: Record<string, unknown>;
    }
  ) => {
    const response = await client.post(`/learning/capabilities/${name}/execute`, data);
    return response.data;
  },

  listRuns: async (workspaceId: string, limit = 20) => {
    const response = await client.get('/learning/runs', {
      params: { workspaceId, limit }
    });
    return response.data;
  },

  getRun: async (id: string) => {
    const response = await client.get(`/learning/runs/${id}`);
    return response.data;
  }
};
