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
    messages: LearningTerminalMessage[],
    options?: { sessionId?: string; workbenchId?: string }
  ): Promise<LearningTerminalResponse> => {
    const response = await client.post('/learning/terminal/chat', {
      workspaceId,
      sessionId: options?.sessionId,
      workbenchId: options?.workbenchId,
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

  getMemoryHealth: async () => {
    const response = await client.get('/learning/memory/health');
    return response.data;
  },

  getLearnerState: async (workspaceId: string, params?: { workbenchId?: string; goalId?: string }) => {
    const response = await client.get('/learning/learner-state', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  refreshLearnerState: async (data: { workspaceId: string; workbenchId?: string; goalId?: string }) => {
    const response = await client.post('/learning/learner-state/refresh', data);
    return response.data;
  },

  getLearnerStateContext: async (
    workspaceId: string,
    params?: { workbenchId?: string; goalId?: string; audience?: string }
  ) => {
    const response = await client.get('/learning/learner-state/context', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  listLearnerMemories: async (workspaceId: string, params?: { workbenchId?: string; limit?: number }) => {
    const response = await client.get('/learning/learner-state/memories', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  explainLearnerMemory: async (workspaceId: string, memoryKey: string) => {
    const response = await client.get('/learning/learner-state/memories/explain', {
      params: { workspaceId, memoryKey }
    });
    return response.data;
  },

  controlLearnerMemory: async (data: {
    workspaceId: string;
    workbenchId?: string;
    memoryKey: string;
    dimension: string;
    action: 'correct' | 'delete' | 'freeze' | 'downrank' | 'restore';
    correctedText?: string;
    originalText?: string;
    reason?: string;
    weightMultiplier?: number;
  }) => {
    const response = await client.post('/learning/learner-state/memories/control', data);
    return response.data;
  },

  getLearnerMemoryLifecycle: async (workspaceId: string) => {
    const response = await client.get('/learning/learner-state/lifecycle', {
      params: { workspaceId }
    });
    return response.data;
  },

  evaluateLearnerMemory: async (workspaceId: string) => {
    const response = await client.get('/learning/learner-state/evaluate', {
      params: { workspaceId }
    });
    return response.data;
  },

  governLearnerState: async (data: { workspaceId: string; workbenchId?: string }) => {
    const response = await client.post('/learning/learner-state/govern', data);
    return response.data;
  },

  listMemoryCandidates: async (workspaceId: string, params?: { limit?: number }) => {
    const response = await client.get('/learning/memory/candidates', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  decideMemoryCandidate: async (
    workspaceId: string,
    candidateId: string,
    data: { decision: 'save' | 'dismiss'; workbenchId?: string; text?: string; category?: string }
  ) => {
    const response = await client.post(`/learning/memory/candidates/${encodeURIComponent(candidateId)}/decision`, {
      workspaceId,
      ...data
    });
    return response.data;
  },

  getMemoryDebug: async (
    workspaceId: string,
    params?: { workbenchId?: string; query?: string; sessionId?: string }
  ) => {
    const response = await client.get('/learning/memory/debug', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  listSavedMemories: async (workspaceId: string, params?: { limit?: number; includeDeleted?: boolean }) => {
    const response = await client.get('/learning/saved-memories', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  createSavedMemory: async (data: {
    workspaceId: string;
    workbenchId?: string;
    text: string;
    category?: string;
  }) => {
    const response = await client.post('/learning/saved-memories', data);
    return response.data;
  },

  updateSavedMemory: async (workspaceId: string, memoryKey: string, data: { text?: string; category?: string; action?: 'restore' }) => {
    const response = await client.patch(`/learning/saved-memories/${encodeURIComponent(memoryKey)}`, {
      workspaceId,
      ...data
    });
    return response.data;
  },

  deleteSavedMemory: async (workspaceId: string, memoryKey: string) => {
    const response = await client.delete(`/learning/saved-memories/${encodeURIComponent(memoryKey)}`, {
      params: { workspaceId }
    });
    return response.data;
  },

  searchConversationHistory: async (
    workspaceId: string,
    query: string,
    params?: { currentSessionId?: string; workbenchId?: string; userId?: string; source?: string; limit?: number }
  ) => {
    const response = await client.get('/learning/conversation-history/search', {
      params: { workspaceId, query, ...(params || {}) }
    });
    return response.data;
  },

  listConversationSessions: async (
    workspaceId: string,
    params?: { workbenchId?: string; source?: string; limit?: number; includeMessages?: boolean }
  ) => {
    const response = await client.get('/learning/conversation-history/sessions', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  backfillConversationEmbeddings: async (data: { workspaceId?: string; limit?: number; enqueue?: boolean }) => {
    const response = await client.post('/learning/conversation-history/backfill-embeddings', data);
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
