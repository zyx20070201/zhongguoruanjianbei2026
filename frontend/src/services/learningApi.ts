import client from '../api/client';
import {
  FileSystemObject,
  LearningGoalDraft,
  PersonalizedWorkspaceIntegration,
  LearningTerminalMessage,
  LearningTerminalResponse,
  TerminalChatFile,
  Workbench
} from '../types';

const getApiBaseUrl = () => {
  const baseURL = client.defaults.baseURL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
  return String(baseURL).replace(/\/$/, '');
};

const parseSseBlock = (block: string) => {
  let event = 'message';
  const dataLines: string[] = [];

  block.split('\n').forEach((line) => {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  });

  return { event, data: dataLines.join('\n') };
};

export type TerminalChatMode = 'chat' | 'agentic' | 'new_agentic';

export interface TerminalChatListItem {
  id: string;
  title: string;
  mode: TerminalChatMode;
  selectedSources?: Array<{ fileId: string; mode: 'focused' | 'full_context' }>;
  chatFiles?: TerminalChatFile[];
  checkpointThreadId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
}

export interface TerminalChatMessagesPage {
  messages: LearningTerminalMessage[];
  hasMore: boolean;
  nextBefore: string | null;
}

export const learningApi = {
  chatTerminal: async (
    workspaceId: string,
    messages: LearningTerminalMessage[],
    options?: {
      sessionId?: string;
      workbenchId?: string;
      checkpointThreadId?: string;
      stream?: boolean;
      mode?: TerminalChatMode;
      selectedSourceIds?: string[];
      selectedSources?: Array<{ fileId: string; mode?: 'focused' | 'full_context' }>;
      chatFiles?: TerminalChatFile[];
    }
  ): Promise<LearningTerminalResponse> => {
    if (options?.stream) {
      const response = await fetch(`${getApiBaseUrl()}/learning/terminal/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId,
          sessionId: options?.sessionId,
          workbenchId: options?.workbenchId,
          checkpointThreadId: options?.checkpointThreadId,
          mode: options?.mode,
          selectedSourceIds: options?.selectedSourceIds,
          selectedSources: options?.selectedSources,
          chatFiles: options?.chatFiles,
          messages: messages.map(({ role, content, files }) => ({ role, content, files }))
        })
      });
      if (!response.ok || !response.body) {
        throw new Error(`Stream request failed: ${response.status}`);
      }
      return {
        reply: '',
        sessionId: options?.sessionId,
        checkpointThreadId: options?.checkpointThreadId,
        status: 'completed'
      };
    }
    const response = await client.post('/learning/terminal/chat', {
      workspaceId,
      sessionId: options?.sessionId,
      workbenchId: options?.workbenchId,
      checkpointThreadId: options?.checkpointThreadId,
      mode: options?.mode,
      selectedSourceIds: options?.selectedSourceIds,
      selectedSources: options?.selectedSources,
      chatFiles: options?.chatFiles,
      messages: messages.map(({ role, content, files }) => ({ role, content, files }))
    }, { timeout: 0 });
    return response.data;
  },

  approveTerminalAction: async (data: {
    workspaceId: string;
    messages: LearningTerminalMessage[];
    sessionId?: string;
    workbenchId?: string;
    checkpointThreadId?: string;
    mode?: TerminalChatMode;
    decision: {
      decision: 'approve' | 'reject';
      actionIds?: string[];
      note?: string;
    };
  }): Promise<LearningTerminalResponse> => {
    const response = await client.post('/learning/terminal/approval', {
      workspaceId: data.workspaceId,
      sessionId: data.sessionId,
      workbenchId: data.workbenchId,
      checkpointThreadId: data.checkpointThreadId,
      mode: data.mode,
      messages: data.messages.map(({ role, content }) => ({ role, content })),
      decision: data.decision
    }, { timeout: 0 });
    return response.data;
  },

  listTerminalChats: async (
    workspaceId: string,
    params?: { workbenchId?: string; limit?: number }
  ): Promise<{ sessions: TerminalChatListItem[] }> => {
    const response = await client.get('/learning/terminal/chats', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  getTerminalChatMessages: async (
    workspaceId: string,
    sessionId: string,
    params?: { before?: string | null; limit?: number }
  ): Promise<TerminalChatMessagesPage> => {
    const response = await client.get(`/learning/terminal/chats/${encodeURIComponent(sessionId)}/messages`, {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  chatTerminalStream: async (
    workspaceId: string,
    messages: LearningTerminalMessage[],
    options: {
      sessionId?: string;
      workbenchId?: string;
      checkpointThreadId?: string;
      mode?: TerminalChatMode;
      selectedSourceIds?: string[];
      selectedSources?: Array<{ fileId: string; mode?: 'focused' | 'full_context' }>;
      chatFiles?: TerminalChatFile[];
      onEvent: (event: string, data: any) => void;
    }
  ): Promise<LearningTerminalResponse | null> => {
    const response = await fetch(`${getApiBaseUrl()}/learning/terminal/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId,
        sessionId: options.sessionId,
        workbenchId: options.workbenchId,
        checkpointThreadId: options.checkpointThreadId,
        mode: options.mode,
        selectedSourceIds: options.selectedSourceIds,
        selectedSources: options.selectedSources,
        chatFiles: options.chatFiles,
        messages: messages.map(({ role, content, files }) => ({ role, content, files }))
      })
    });
    if (!response.ok || !response.body) {
      throw new Error(`Stream request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: LearningTerminalResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (!block.trim()) continue;
        const parsed = parseSseBlock(block);
        if (!parsed.data) continue;
        const data = JSON.parse(parsed.data);
        options.onEvent(parsed.event, data);
        if (parsed.event === 'error') {
          throw new Error(data?.error || 'AI Terminal stream failed');
        }
        if ((parsed.event === 'final' || parsed.event === 'approval_required') && data?.result) {
          finalResult = data.result;
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed.data) {
        const data = JSON.parse(parsed.data);
        options.onEvent(parsed.event, data);
        if (parsed.event === 'error') {
          throw new Error(data?.error || 'AI Terminal stream failed');
        }
        if ((parsed.event === 'final' || parsed.event === 'approval_required') && data?.result) {
          finalResult = data.result;
        }
      }
    }

    return finalResult;
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
    const response = await client.post('/learning/workbenches/guided', data, { timeout: 90000 });
    return response.data;
  },

  indexKnowledgeFile: async (workspaceId: string, fileObjectId: string, options?: { force?: boolean }) => {
    const response = await client.post('/learning/knowledge/index', {
      workspaceId,
      fileObjectId,
      force: Boolean(options?.force)
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

  buildCourseKnowledgeGraph: async (data: {
    workspaceId: string;
    workbenchId?: string;
    resourceRole?: string;
    reindex?: boolean;
    validate?: boolean;
    includeWorkspaceResources?: boolean;
    maxFilesPerWorkbench?: number;
    maxWorkspaceFiles?: number;
    graphLimit?: number;
  }) => {
    const response = await client.post('/learning/knowledge/graph/build', data);
    return response.data;
  },

  startCourseGraphBuildJob: async (data: {
    workspaceId: string;
    workbenchId?: string;
    resourceRole?: string;
    reindex?: boolean;
    validate?: boolean;
    includeWorkspaceResources?: boolean;
    maxFilesPerWorkbench?: number;
    maxWorkspaceFiles?: number;
    graphLimit?: number;
  }) => {
    const response = await client.post('/learning/knowledge/graph/build-job', data, { timeout: 10000 });
    return response.data;
  },

  getCourseGraphBuildJob: async (jobId: string) => {
    const response = await client.get(`/learning/knowledge/graph/build-jobs/${jobId}`, { timeout: 10000 });
    return response.data;
  },

  listCourseGraphBuildJobs: async (workspaceId: string, limit = 10) => {
    const response = await client.get('/learning/knowledge/graph/build-jobs', {
      params: { workspaceId, limit },
      timeout: 10000
    });
    return response.data;
  },

  buildTargetKnowledgeStructure: async (data: {
    workspaceId: string;
    workbenchId?: string;
    goalId?: string;
    objective?: string;
    targetConcepts?: string[];
    persist?: boolean;
  }) => {
    const response = await client.post('/learning/knowledge/target-structure', data, { timeout: 60000 });
    return response.data;
  },

  runKnowledgeGapAnalysis: async (data: {
    workspaceId: string;
    workbenchId?: string;
    goalId?: string;
    objective?: string;
    targetStructure?: Record<string, unknown>;
    persist?: boolean;
  }) => {
    const response = await client.post('/learning/knowledge/gap-analysis', data, { timeout: 90000 });
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

  listWorkspaceFileCards: async (workspaceId: string, params?: { query?: string; limit?: number }) => {
    const response = await client.get('/learning/workspace/files/cards', {
      params: {
        workspaceId,
        ...(params?.query ? { query: params.query } : {}),
        ...(typeof params?.limit === 'number' ? { limit: params.limit } : {})
      }
    });
    return response.data;
  },

  indexWorkspaceFiles: async (data: {
    workspaceId: string;
    force?: boolean;
    maxFiles?: number;
    fileIds?: string[];
  }) => {
    const response = await client.post('/learning/workspace/files/index', data, { timeout: 0 });
    return response.data;
  },

  searchWorkspaceFiles: async (data: {
    workspaceId: string;
    query: string;
    fileLimit?: number;
    chunkLimit?: number;
    ensureIndexed?: boolean;
  }) => {
    const response = await client.post('/learning/workspace/files/search', data, { timeout: 0 });
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

  getCourseHome: async (workspaceId: string, params?: { workbenchId?: string }) => {
    const response = await client.get('/learning/course-home', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  getWorkspaceIntegration: async (
    workspaceId: string,
    params?: { workbenchId?: string; goalId?: string; query?: string }
  ): Promise<{ integration: PersonalizedWorkspaceIntegration }> => {
    const response = await client.get('/learning/workspace-integration', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  getKnowledgeGraph: async (workspaceId: string, params?: { limit?: number; sourceIds?: string[]; tagQuery?: string }) => {
    const response = await client.get('/learning/knowledge/graph', {
      params: {
        workspaceId,
        limit: params?.limit,
        tagQuery: params?.tagQuery,
        ...(params?.sourceIds?.length ? { sourceIds: params.sourceIds.join(',') } : {})
      }
    });
    return response.data;
  },

  getConceptTags: async (workspaceId: string, conceptId: string) => {
    const response = await client.get(`/learning/knowledge/graph/concepts/${conceptId}/tags`, {
      params: { workspaceId }
    });
    return response.data;
  },

  addConceptTag: async (data: {
    workspaceId: string;
    conceptId: string;
    label: string;
    source?: 'system_candidate' | 'ai_suggested' | 'user';
    state?: 'candidate' | 'applied';
    rationale?: string;
  }) => {
    const response = await client.post(`/learning/knowledge/graph/concepts/${data.conceptId}/tags`, data);
    return response.data;
  },

  deleteConceptTag: async (workspaceId: string, conceptId: string, tagId: string) => {
    const response = await client.delete(`/learning/knowledge/graph/concepts/${conceptId}/tags/${tagId}`, {
      params: { workspaceId }
    });
    return response.data;
  },

  suggestConceptTags: async (data: {
    workspaceId: string;
    conceptId: string;
    question?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => {
    const response = await client.post(`/learning/knowledge/graph/concepts/${data.conceptId}/tag-suggestions`, data);
    return response.data;
  },

  streamConceptExplanation: async (
    data: {
      workspaceId: string;
      conceptId: string;
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
    handlers: {
      onDelta?: (delta: string) => void;
    } = {}
  ) => {
    const response = await fetch(`${getApiBaseUrl()}/learning/knowledge/graph/concepts/${data.conceptId}/explain-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `AI request failed with status ${response.status}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let finalResult: { reply?: string } | null = null;

    const handleBlock = (block: string) => {
      const { event, data: rawData } = parseSseBlock(block);
      if (!rawData) return;
      const parsed = JSON.parse(rawData);
      if (event === 'delta') {
        handlers.onDelta?.(String(parsed));
      } else if (event === 'done') {
        finalResult = parsed as { reply?: string };
      } else if (event === 'error') {
        throw new Error(parsed?.error || 'AI request failed');
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      blocks.forEach(handleBlock);
    }

    if (buffer.trim()) handleBlock(buffer);
    if (!finalResult) throw new Error('AI stream ended before a final response was received');
    return finalResult;
  },

  getConceptExercises: async (workspaceId: string, conceptId: string, params?: { limit?: number }) => {
    const response = await client.get(`/learning/knowledge/graph/concepts/${conceptId}/exercises`, {
      params: { workspaceId, limit: params?.limit }
    });
    return response.data;
  },

  getPrerequisiteGaps: async (workspaceId: string, params?: { conceptIds?: string[] }) => {
    const response = await client.get('/learning/knowledge/graph/prerequisite-gaps', {
      params: {
        workspaceId,
        ...(params?.conceptIds?.length ? { conceptIds: params.conceptIds.join(',') } : {})
      }
    });
    return response.data;
  },

  getRemediationPath: async (workspaceId: string, targetConceptId: string) => {
    const response = await client.get('/learning/knowledge/graph/remediation-path', {
      params: { workspaceId, targetConceptId }
    });
    return response.data;
  },

  getDiagnosis: async (workspaceId: string, params?: { conceptIds?: string[]; limit?: number }) => {
    const response = await client.get('/learning/diagnosis', {
      params: {
        workspaceId,
        limit: params?.limit,
        ...(params?.conceptIds?.length ? { conceptIds: params.conceptIds.join(',') } : {})
      }
    });
    return response.data;
  },

  getGraphPlanCandidates: async (workspaceId: string, params?: { objective?: string; conceptIds?: string[]; maxConcepts?: number }) => {
    const response = await client.get('/learning/planning/graph-candidates', {
      params: {
        workspaceId,
        objective: params?.objective,
        maxConcepts: params?.maxConcepts,
        ...(params?.conceptIds?.length ? { conceptIds: params.conceptIds.join(',') } : {})
      }
    });
    return response.data;
  },

  createKnowledgeGraphPlan: async (data: {
    workspaceId: string;
    workbenchId?: string;
    goalId?: string;
    objective?: string;
    targetConcepts?: string[];
    maxConcepts?: number;
    persist?: boolean;
  }) => {
    const response = await client.post('/learning/planning/kg-plan', data);
    return response.data;
  },

  listLearningPlans: async (
    workspaceId: string,
    params?: { workbenchId?: string; goalId?: string; limit?: number }
  ) => {
    const response = await client.get('/learning/planning/plans', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  applyLearningPlanToWorkbench: async (
    planId: string,
    data: { workspaceId: string; workbenchId?: string; createWorkbench?: boolean; workbenchTitle?: string }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/apply`, data);
    return response.data;
  },

  deleteLearningPlan: async (planId: string, data: { workspaceId: string }) => {
    const response = await client.delete(`/learning/planning/plans/${planId}`, { data });
    return response.data;
  },

  updateLearningPlanStepStatus: async (
    planId: string,
    stepId: string,
    data: { workspaceId: string; status: 'pending' | 'active' | 'done' | 'skipped' | 'blocked' }
  ) => {
    const response = await client.patch(`/learning/planning/plans/${planId}/steps/${stepId}`, data);
    return response.data;
  },

  performLearningPlanAction: async (
    planId: string,
    data: {
      workspaceId: string;
      action: 'start' | 'pause' | 'resume' | 'complete' | 'archive' | 'restore' | 'supersede' | 'set_primary' | 'reopen' | 'duplicate' | 'replan';
      targetPlanId?: string;
      title?: string;
      note?: string;
    }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/actions`, data);
    return response.data;
  },

  updateLearningPlanStepDetails: async (
    planId: string,
    stepId: string,
    data: {
      workspaceId: string;
      title?: string;
      description?: string;
      note?: string;
      estimateMinutes?: number | null;
      dueDate?: string | null;
      tags?: string[];
      artifactBindings?: Array<Record<string, unknown>>;
    }
  ) => {
    const response = await client.patch(`/learning/planning/plans/${planId}/steps/${stepId}/details`, data);
    return response.data;
  },

  updateLearningPlanStage: async (
    planId: string,
    stageId: string,
    data: {
      workspaceId: string;
      title: string;
      content: string;
      changeSource?: 'manual' | 'llm_patch';
      note?: string;
      proposalId?: string | null;
    }
  ) => {
    const response = await client.patch(`/learning/planning/plans/${planId}/stages/${encodeURIComponent(stageId)}`, data);
    return response.data;
  },

  proposeLearningPlanStagePatch: async (
    planId: string,
    stageId: string,
    data: { workspaceId: string; instruction?: string }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/stages/${encodeURIComponent(stageId)}/patch-proposal`, data, { timeout: 120000 });
    return response.data;
  },

  explainLearningPlanStage: async (
    planId: string,
    stageId: string,
    data: {
      workspaceId: string;
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/stages/${encodeURIComponent(stageId)}/explain`, data, { timeout: 60000 });
    return response.data;
  },

  explainLearningPlan: async (
    planId: string,
    data: {
      workspaceId: string;
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/explain`, data, { timeout: 60000 });
    return response.data;
  },

  reviewLearningPlan: async (
    planId: string,
    data: { workspaceId: string; instruction?: string }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/review`, data, { timeout: 120000 });
    return response.data;
  },

  recordLearningPlanFeedback: async (
    planId: string,
    data: {
      workspaceId: string;
      stepId?: string | null;
      category: 'too_hard' | 'too_easy' | 'blocked' | 'resource_mismatch' | 'replan' | 'other';
      note?: string;
      rating?: number | null;
    }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/feedback`, data);
    return response.data;
  },

  rollbackLearningPlan: async (
    planId: string,
    data: { workspaceId: string; targetPlanId: string }
  ) => {
    const response = await client.post(`/learning/planning/plans/${planId}/rollback`, data);
    return response.data;
  },

  getLearningEventDiagnostics: async (
    workspaceId: string,
    params?: { workbenchId?: string; goalId?: string; days?: number }
  ) => {
    const response = await client.get('/learning/events/diagnostics', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  getLearningEventSequences: async (
    workspaceId: string,
    params?: { workbenchId?: string; patternType?: string; limit?: number }
  ) => {
    const response = await client.get('/learning/events/sequences', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  getMemoryHealth: async () => {
    const response = await client.get('/learning/memory/health');
    return response.data;
  },

  recordLearningEvent: async (data: {
    workspaceId: string;
    workbenchId?: string;
    goalId?: string;
    eventType: string;
    actor?: 'user' | 'assistant' | 'system' | 'agent';
    payload?: Record<string, unknown>;
    object?: { type?: string; id?: string; title?: string };
    interaction?: Record<string, unknown>;
    source?: Record<string, unknown>;
    confidence?: number;
  }) => {
    const response = await client.post('/learning/events', data);
    return response.data;
  },

  listLearningEvents: async (
    workspaceId: string,
    params?: { workbenchId?: string; eventType?: string; actor?: string; objectType?: string; objectId?: string; limit?: number }
  ) => {
    const response = await client.get('/learning/events', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  updateLearningEvent: async (
    workspaceId: string,
    eventId: string,
    data: { eventType?: string; summary?: string; confidence?: number }
  ) => {
    const response = await client.patch(`/learning/events/${encodeURIComponent(eventId)}`, {
      workspaceId,
      ...data
    });
    return response.data;
  },

  deleteLearningEvent: async (workspaceId: string, eventId: string) => {
    const response = await client.delete(`/learning/events/${encodeURIComponent(eventId)}`, {
      params: { workspaceId }
    });
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

  getLearnerProfileView: async (workspaceId: string, params?: { workbenchId?: string; limit?: number; force?: boolean; forcePortrait?: boolean }) => {
    const response = await client.get('/learning/learner-state/profile-view', {
      params: { workspaceId, ...(params || {}) },
      timeout: 0
    });
    return response.data;
  },

  listLearnerMemories: async (workspaceId: string, params?: { workbenchId?: string; limit?: number }) => {
    const response = await client.get('/learning/learner-state/memories', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  listSavedMemories: async (workspaceId: string, params?: { workbenchId?: string; limit?: number; includeDeleted?: boolean }) => {
    const response = await client.get('/learning/saved-memories', {
      params: { workspaceId, ...(params || {}) }
    });
    return response.data;
  },

  createSavedMemory: async (data: { workspaceId: string; workbenchId?: string; text: string; category?: string }) => {
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

  restoreSavedMemory: async (memoryKey: string, data: { workspaceId: string }) => {
    const response = await client.patch(`/learning/saved-memories/${encodeURIComponent(memoryKey)}`, {
      ...data,
      action: 'restore'
    });
    return response.data;
  },

  deleteSavedMemory: async (workspaceId: string, memoryKey: string) => {
    const response = await client.delete(`/learning/saved-memories/${encodeURIComponent(memoryKey)}`, {
      params: { workspaceId }
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
