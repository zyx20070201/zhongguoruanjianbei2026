import client from '../api/client';

const STUDIO_READ_TIMEOUT_MS = 45000;
const STUDIO_GENERATE_TIMEOUT_MS = 420000;
const STUDIO_JUDGE_TIMEOUT_MS = 90000;
const STUDIO_CODE_RUN_TIMEOUT_MS = 60000;
const FLASHCARD_WRITE_TIMEOUT_MS = 45000;

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  attachments?: AiChatAttachment[];
}

export type AiChatAttachmentKind = 'text' | 'image' | 'pdf' | 'document' | 'file';

export interface AiChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AiChatAttachmentKind;
  createdAt: string;
  displayType?: 'file' | 'doc' | 'note' | 'chat' | 'collection' | 'folder' | 'selection' | 'webpage';
  sourceLabel?: string;
  locator?: Record<string, any>;
  textContent?: string;
  summary?: string;
  parsedTextHash?: string;
  parsedAt?: string;
  extractionStatus?: 'ready' | 'metadata_only' | 'error';
  chunks?: Array<{
    chunkId: string;
    text: string;
    locator?: Record<string, any>;
    headingPath?: string[];
    score?: number;
  }>;
  dataUrl?: string;
  base64Data?: string;
  fileObjectId?: string;
  savedToWorkbench?: boolean;
  status?: 'ready' | 'metadata_only' | 'error';
  error?: string;
}

export type AiWelcomeActionIcon =
  | 'summary'
  | 'translate'
  | 'analysis'
  | 'task'
  | 'outline'
  | 'question'
  | 'compare'
  | 'search'
  | 'practice'
  | 'plan';

export interface AiWelcomeSuggestion {
  label: string;
  icon: AiWelcomeActionIcon;
}

export interface AiWelcomeContent {
  greeting: string;
  actions: AiWelcomeSuggestion[];
  generatedAt?: string;
}

export type AiContextMode =
  | 'auto'
  | 'selection_only'
  | 'viewport'
  | 'active_file'
  | 'workbench'
  | 'model_knowledge';

export type AiStudioResourceType =
  | 'report'
  | 'slide_deck'
  | 'visual_explainer'
  | 'mind_map'
  | 'flashcards'
  | 'quiz'
  | 'data_table'
  | 'code_lab';

export type AiStudioGoalCategory =
  | 'understand'
  | 'map'
  | 'practice'
  | 'review'
  | 'lab'
  | 'visualize'
  | 'plan';

export type AiStudioGeneratorKind =
  | 'text'
  | 'structure'
  | 'assessment'
  | 'memory'
  | 'code_lab'
  | 'multimodal'
  | 'planning'
  | 'review';

export interface AiStudioGoalInfo {
  id: AiStudioGoalCategory;
  zh: string;
  en: string;
  description: string;
}

export interface AiStudioTemplate {
  id: string;
  version?: string;
  goal: AiStudioGoalCategory;
  title: string;
  shortTitle?: string;
  description: string;
  generator: AiStudioGeneratorKind;
  renderer: string;
  format: 'md' | 'json' | 'csv';
  filename: string;
  outputLabel: string;
  recommendedUse?: string;
  tags?: string[];
  legacyResourceType?: AiStudioResourceType;
}

export interface AiStudioRecommendation {
  id: string;
  goal: AiStudioGoalCategory;
  templateId: string;
  title: string;
  reason: string;
  priority: number;
  evidence: string[];
  actions: Array<{ id: string; label: string; templateId: string; goal: AiStudioGoalCategory }>;
}

export interface AiStudioPracticeNext {
  templateId: string;
  goal: 'practice';
  title: string;
  reason: string;
  priority: number;
  evidence: string[];
  focusConcepts: string[];
  preferredDifficulty: 'easy' | 'medium' | 'hard' | 'adaptive';
  mastery?: {
    averageScore: number;
    attemptedCount: number;
    correctCount: number;
    weakConcepts: string[];
    masteredConcepts: string[];
    needsRemediation: boolean;
  };
}

export interface AiStudioWorkflowTraceItem {
  id: string;
  agent: string;
  title: string;
  status: 'completed' | 'failed';
  summary: string;
  details?: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface AiStudioReviewReport {
  score: number;
  warnings: string[];
  checks?: Array<{ id: string; label: string; passed: boolean; severity: string; message: string }>;
  metrics?: Record<string, number>;
  passed: boolean;
  summary: string;
}

export interface AiStudioArtifactSummary {
  id: string;
  artifactKey: string;
  title: string;
  summary?: string;
  goal?: string;
  templateId: string;
  templateVersion: string;
  status?: string;
  renderer?: string;
  schemaVersion: string;
  updatedAt?: string;
}

export interface AiStudioDeliveryArtifact {
  kind: 'markdown' | 'pptx' | 'html' | 'python' | 'tsx';
  filename: string;
  mimeType: string;
  fileObjectId: string;
  path: string;
  framework?: string;
  previewContent?: string;
}

export interface AiStudioRenderJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | string;
  stage: string;
  progress: number;
  templateId?: string;
  renderer?: string;
  framework?: string | null;
  kind: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  logs?: string[];
  error?: string | null;
  workspaceId?: string;
  workbenchId?: string | null;
  artifactId?: string | null;
  sourceFileObjectId?: string | null;
  outputFileObjectId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface AiCodeLabRunResult {
  provider: 'judge0';
  language: string;
  status: {
    id: number | null;
    description: string;
    success: boolean;
  };
  stdout: string;
  stderr: string;
  compileOutput: string;
  message: string;
  time: string | null;
  memory: number | null;
}

export interface AiContextChipPayload {
  id: string;
  kind: 'selection' | 'viewport' | 'active_file' | 'resource_scope';
  enabled?: boolean;
}

export interface AiContextSelectionRange {
  page?: number;
  pageStart?: number;
  pageEnd?: number;
  timestampStart?: number;
  timestampEnd?: number;
  segmentIds?: string[];
  sourceType?: string;
  url?: string;
  lineStart?: number;
  lineEnd?: number;
  scrollRatio?: number;
  charStart?: number;
  charEnd?: number;
  textLength?: number;
  rects?: Array<{
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
}

export interface AiLockedSelectionContext {
  id?: string;
  panelId?: string;
  panelType?: string;
  fileId?: string | null;
  fileName?: string;
  filePath?: string;
  content: string;
  locator?: AiContextSelectionRange & {
    lineStart?: number;
    lineEnd?: number;
    blockIds?: string[];
    scrollRatio?: number;
    chunkIndex?: number;
  };
  createdAt?: string;
}

export interface AiChatContext {
  userId?: string;
  sessionId?: string;
  preferredProvider?: string;
  preferredModel?: string;
  workbenchTitle?: string;
  workbenchDescription?: string;
  workspaceId?: string;
  workbenchId?: string;
  liveContextVersion?: number;
  liveContextUpdatedAt?: string;
  contextMode?: AiContextMode;
  sourcePriority?: 'selected_resources' | 'active_context' | 'mixed';
  activeContextChips?: AiContextChipPayload[];
  activePanelId?: string | null;
  activeFileId?: string | null;
  activeFile?: {
    id?: string;
    name?: string;
    path?: string;
    content?: string;
    fileCategory?: string;
    resourceType?: string;
    scope?: string;
    origin?: string;
    ownerWorkbenchId?: string;
  } | null;
  activeExternal?: {
    title?: string;
    url?: string;
    description?: string;
  } | null;
  openPanels?: Array<{
    panelId: string;
    panelType: string;
    title?: string;
    fileId?: string | null;
    fileName?: string;
    filePath?: string;
    fileCategory?: string;
    resourceType?: string;
    scope?: string;
    origin?: string;
    ownerWorkbenchId?: string;
    visiblePages?: number[];
    primaryPage?: number;
    visibleLineRange?: { start: number; end: number } | null;
    visibleBlockIds?: string[];
    approxChunkIndex?: number | null;
    scrollRatio?: number | null;
    selectedText?: string;
    selectedRange?: AiContextSelectionRange | null;
    visibleContent?: string;
    language?: string;
  }>;
  visiblePanels?: Array<{
    panelId: string;
    panelType: string;
    title?: string;
    fileId?: string | null;
    fileName?: string;
    filePath?: string;
    fileCategory?: string;
    resourceType?: string;
    scope?: string;
    origin?: string;
    ownerWorkbenchId?: string;
    visiblePages?: number[];
    primaryPage?: number;
    visibleLineRange?: { start: number; end: number } | null;
    visibleBlockIds?: string[];
    approxChunkIndex?: number | null;
    scrollRatio?: number | null;
    selectedText?: string;
    selectedRange?: AiContextSelectionRange | null;
    visibleContent?: string;
    language?: string;
  }>;
  lockedSelection?: AiLockedSelectionContext | null;
  persistentCitations?: Array<{
    sourceId?: string;
    fileId: string;
    fileName: string;
    label: string;
    confidence?: 'high' | 'medium' | 'low';
    locator?: Record<string, any>;
    preview?: string;
    supportSnippets?: Array<{ text: string; locator?: Record<string, any>; score?: number }>;
    citationQuality?: {
      supportCount?: number;
      sourceCount?: number;
      grounded?: boolean;
    };
  }>;
  chatSessionAttachments?: AiChatAttachment[];
  selectedResourceIds?: string[];
  selectedText?: string;
  recentMessages?: AiChatMessage[];
}

export interface AgentTimelineItem {
  taskId: string;
  agentName: string;
  inputSummary: string;
  outputSummary: string;
  status: 'completed' | 'failed';
  durationMs: number;
}

export interface AiUsedContextSummary {
  intent?: string;
  mode?: AiContextMode;
  selection?: boolean;
  viewport?: boolean;
  activeFile?: string | null;
  resources?: number;
  retrievedChunks?: number;
  estimatedTokens?: number;
  estimatedTokensByLayer?: Record<string, number>;
  layerScores?: Record<string, number>;
  requiredLayers?: string[];
  activeFileStrategy?: string | null;
  viewportLocator?: Record<string, any> | null;
  fallbackReasons?: string[];
  clippedItems?: Array<{ layer: string; reason: string }>;
  citations?: string[];
  sources?: number;
  sourceConfidence?: { high: number; medium: number; low: number };
  contextTrace?: Array<{
    step: string;
    status: 'completed' | 'failed' | 'background';
    durationMs: number;
    summary?: string;
  }>;
}

export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';

export interface FlashcardSourceRef {
  sourceId?: string;
  title?: string;
  fileId?: string;
  fileName?: string;
  locator?: Record<string, any>;
  snippet?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface FlashcardCard {
  id: string;
  deckId: string;
  workspaceId: string;
  workbenchId?: string | null;
  front: string;
  back: string;
  cardType: string;
  difficulty: 'easy' | 'medium' | 'hard' | string;
  concept: string;
  explanation: string;
  tags: string[];
  sourceRefs: FlashcardSourceRef[];
  metadata: Record<string, any>;
  orderIndex: number;
  reviewCount: number;
  lapseCount: number;
  dueAt: string;
  lastReviewedAt?: string | null;
  stability: number;
  retrievability: number;
  fsrsDifficulty: number;
  state: string;
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlashcardDeck {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  title: string;
  description: string;
  source: string;
  sourceFileIds: string[];
  sourceRefs: FlashcardSourceRef[];
  settings: Record<string, any>;
  generationRunId?: string | null;
  fileObjectId?: string | null;
  createdAt: string;
  updatedAt: string;
  cards?: FlashcardCard[];
  cardCount: number;
}

export interface CreateFlashcardDeckCardPayload {
  front: string;
  back: string;
  cardType?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | string;
  concept?: string;
  explanation?: string;
  tags?: string[];
  sourceRefs?: FlashcardSourceRef[];
  metadata?: Record<string, any>;
}

export interface AiSourceInspectorItem {
  sourceId: string;
  sourceType: 'selection' | 'viewport' | 'active_file' | 'retrieval' | 'pinned';
  confidence: 'high' | 'medium' | 'low';
  fileId: string;
  fileName: string;
  label: string;
  locator?: Record<string, any>;
  score?: number;
  retrievalReason?: string;
  matchedTerms?: string[];
  scoreBreakdown?: Record<string, number>;
  preview?: string;
  supportSnippets?: Array<{ text: string; locator?: Record<string, any>; score?: number }>;
  citationQuality?: {
    supportCount?: number;
    sourceCount?: number;
    grounded?: boolean;
  };
  includedInPrompt: boolean;
}

export type AiNoteEditAction =
  | 'proofread'
  | 'improve'
  | 'explain'
  | 'reformat'
  | 'shorten'
  | 'expand'
  | 'summarize'
  | 'outline';

export interface AiStreamResult {
  reply: string;
  model?: string;
  usage?: Record<string, unknown> | null;
  taskType?: string;
  runId?: string;
  timeline?: AgentTimelineItem[];
  retrievedChunks?: unknown[];
  contextCapsule?: unknown;
  contextPolicy?: unknown;
  usedContextSummary?: AiUsedContextSummary;
  quality?: unknown;
  profile?: unknown;
}

export interface AiAvailableModel {
  provider: string;
  model: string;
  configured: boolean;
}

interface AiStreamHandlers {
  onDelta?: (delta: string) => void;
  onReplace?: (content: string) => void;
  onTimeline?: (timeline: AgentTimelineItem[]) => void;
  onMeta?: (meta: Partial<AiStreamResult>) => void;
}

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

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  });

  return {
    event,
    data: dataLines.join('\n')
  };
};

export const aiApi = {
  chatWelcome: async (payload: {
    context?: AiChatContext;
  }): Promise<AiWelcomeContent> => {
    const response = await client.post('/ai/chat/welcome', payload, { timeout: 10000 });
    return response.data;
  },

  listModels: async (): Promise<{ models: AiAvailableModel[] }> => {
    const response = await client.get('/ai/models', { timeout: 10000 });
    return response.data;
  },

  chat: async (payload: {
    messages: AiChatMessage[];
    context?: AiChatContext;
  }): Promise<{
    reply: string;
    model?: string;
    usage?: Record<string, unknown> | null;
    taskType?: string;
    runId?: string;
    timeline?: AgentTimelineItem[];
    retrievedChunks?: unknown[];
    contextCapsule?: unknown;
    contextPolicy?: unknown;
    usedContextSummary?: AiUsedContextSummary;
    quality?: unknown;
    profile?: unknown;
  }> => {
    const response = await client.post('/ai/chat', payload);
    return response.data;
  },

  chatStream: async (
    payload: {
      messages: AiChatMessage[];
      context?: AiChatContext;
    },
    handlers: AiStreamHandlers = {},
    options: { signal?: AbortSignal } = {}
  ): Promise<AiStreamResult> => {
    const response = await fetch(`${getApiBaseUrl()}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      signal: options.signal,
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `AI request failed with status ${response.status}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: AiStreamResult | null = null;
    let streamedReply = '';
    let latestMeta: Partial<AiStreamResult> = {};

    const handleBlock = (block: string) => {
      const { event, data } = parseSseBlock(block);
      if (!data) return;

      const parsed = JSON.parse(data);
      if (event === 'delta') {
        const delta = String(parsed);
        streamedReply += delta;
        handlers.onDelta?.(delta);
      } else if (event === 'replace') {
        streamedReply = String(parsed);
        handlers.onReplace?.(streamedReply);
      } else if (event === 'timeline') {
        handlers.onTimeline?.(parsed as AgentTimelineItem[]);
      } else if (event === 'meta') {
        latestMeta = { ...latestMeta, ...(parsed as Partial<AiStreamResult>) };
        handlers.onMeta?.(latestMeta);
      } else if (event === 'done') {
        finalResult = parsed as AiStreamResult;
        if (finalResult?.reply) streamedReply = finalResult.reply;
      } else if (event === 'error') {
        throw new Error(parsed?.error || 'AI request failed');
      }
    };

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      blocks.forEach(handleBlock);
    }

    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalResult) {
      if (streamedReply.trim()) {
        return {
          ...latestMeta,
          reply: streamedReply,
          timeline: latestMeta.timeline || [],
          usage: latestMeta.usage || null
        } as AiStreamResult;
      }
      throw new Error('AI stream ended before a final response was received');
    }

    return finalResult;
  },

  editNoteSelection: async (payload: {
    workspaceId: string;
    workbenchId?: string | null;
    action: AiNoteEditAction;
    file: { id?: string; name?: string; path?: string };
    selection: { text: string; surroundingText?: string; locator?: Record<string, unknown> };
    documentContext?: { title?: string; nearbyHeadings?: string[]; visibleContent?: string };
  }): Promise<{
    replacement: string;
    summary: string;
    warnings?: string[];
    model?: string;
    provider?: string;
    usage?: Record<string, unknown> | null;
  }> => {
    const response = await client.post('/ai/note-edit', payload, { timeout: 60000 });
    return response.data;
  },

  listStudioTemplates: async (payload?: {
    goal?: AiStudioGoalCategory;
  }): Promise<{ goals: AiStudioGoalInfo[]; templates: AiStudioTemplate[] }> => {
    const response = await client.get('/studio/templates', {
      params: payload || {},
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  getStudioVisualizationIrSchema: async (): Promise<{ schemaVersion: string; schema: Record<string, unknown> }> => {
    const response = await client.get('/studio/visualization-ir/schema', {
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  listCodeLabLanguages: async (): Promise<{ languages: string[] }> => {
    const response = await client.get('/studio/code-lab/languages', {
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  runCodeLab: async (payload: {
    language: string;
    sourceCode: string;
    stdin?: string;
  }): Promise<AiCodeLabRunResult> => {
    const response = await client.post('/studio/code-lab/run', payload, {
      timeout: STUDIO_CODE_RUN_TIMEOUT_MS
    });
    return response.data;
  },

  recommendStudioResources: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    goal?: AiStudioGoalCategory;
    context: AiChatContext;
  }): Promise<{
    recommendations: AiStudioRecommendation[];
    signals: Record<string, boolean>;
    features?: Record<string, number | boolean>;
    learnerContextPreview?: string;
  }> => {
    const response = await client.post('/studio/recommend', payload, {
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  listStudioArtifacts: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    limit?: number;
  }): Promise<{ artifacts: AiStudioArtifactSummary[] }> => {
    const response = await client.get('/studio/artifacts', {
      params: payload,
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  getStudioRenderCapabilities: async (): Promise<Record<string, unknown>> => {
    const response = await client.get('/studio/render-capabilities', {
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  listStudioRenderJobs: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    sourceFileObjectId?: string;
    limit?: number;
  }): Promise<{ jobs: AiStudioRenderJob[] }> => {
    const response = await client.get('/studio/render-jobs', {
      params: payload,
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  getStudioRenderJob: async (workspaceId: string, id: string): Promise<AiStudioRenderJob> => {
    const response = await client.get(`/studio/render-jobs/${id}`, {
      params: { workspaceId },
      timeout: STUDIO_READ_TIMEOUT_MS
    });
    return response.data;
  },

  retryStudioRenderJob: async (workspaceId: string, id: string): Promise<AiStudioRenderJob> => {
    const response = await client.post(`/studio/render-jobs/${id}/retry`, { workspaceId }, {
      timeout: STUDIO_GENERATE_TIMEOUT_MS
    });
    return response.data;
  },

  generateStudioResource: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    resourceType?: AiStudioResourceType;
    goal?: AiStudioGoalCategory;
    templateId?: string;
    prompt?: string;
    options?: Record<string, unknown>;
    context: AiChatContext;
  }): Promise<{
    file: any;
    content: string;
    resourceType?: AiStudioResourceType;
    template?: AiStudioTemplate;
    goal?: AiStudioGoalCategory;
    generator?: AiStudioGeneratorKind;
    renderer?: string;
    runId: string;
    source: string;
    metadata?: Record<string, unknown>;
    contextCapsule?: unknown;
    contextPolicy?: unknown;
    review?: AiStudioReviewReport;
    qualityReport?: {
      score?: number;
      keptCount?: number;
      removedCount?: number;
      warnings?: string[];
      issues?: Array<{ questionId: string; severity: string; code: string; message: string }>;
    } | null;
    practiceNext?: AiStudioPracticeNext | null;
    workflowTrace?: AiStudioWorkflowTraceItem[];
    recommendation?: AiStudioRecommendation | null;
    structured?: unknown;
    artifact?: AiStudioArtifactSummary | null;
    renderJob?: AiStudioRenderJob | null;
    delivery?: AiStudioDeliveryArtifact | null;
    flashcardDeck?: FlashcardDeck | null;
    usedContextSummary?: AiUsedContextSummary;
  }> => {
    const response = await client.post('/studio/generate', payload, {
      timeout: STUDIO_GENERATE_TIMEOUT_MS
    });
    return response.data;
  },

  judgeQuizAnswer: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    question: Record<string, unknown>;
    userAnswer: string;
  }): Promise<{
    correct: boolean;
    score: number;
    feedback: string;
    missingPoints?: string[];
    matchedPoints?: string[];
    judgedBy: string;
  }> => {
    const response = await client.post('/studio/judge-quiz', payload, {
      timeout: STUDIO_JUDGE_TIMEOUT_MS
    });
    return response.data;
  },

  assistQuizQuestion: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    question: Record<string, unknown>;
    userMessage: string;
    userAnswer?: string;
  }): Promise<{
    reply: string;
    issueDetected?: boolean;
    issueType?: 'question_quality' | 'answer_quality' | 'needs_clarification' | 'none';
    suggestedActions?: string[];
  }> => {
    const response = await client.post('/studio/quiz-question-assistant', payload, {
      timeout: STUDIO_JUDGE_TIMEOUT_MS
    });
    return response.data;
  },

  listFlashcardDecks: async (payload: {
    workspaceId: string;
    workbenchId?: string;
  }): Promise<{ decks: FlashcardDeck[] }> => {
    const response = await client.get('/flashcards/decks', { params: payload });
    return response.data;
  },

  createFlashcardDeck: async (payload: {
    workspaceId: string;
    workbenchId?: string | null;
    title: string;
    description?: string;
    source?: string;
    sourceFileIds?: string[];
    sourceRefs?: FlashcardSourceRef[];
    settings?: Record<string, any>;
    generationRunId?: string | null;
    fileObjectId?: string | null;
    cards: CreateFlashcardDeckCardPayload[];
  }): Promise<{ deck: FlashcardDeck; reused?: boolean }> => {
    const response = await client.post('/flashcards/decks', payload, {
      timeout: FLASHCARD_WRITE_TIMEOUT_MS
    });
    return response.data;
  },

  getFlashcardDeck: async (payload: {
    workspaceId: string;
    deckId: string;
  }): Promise<{ deck: FlashcardDeck }> => {
    const response = await client.get(`/flashcards/decks/${payload.deckId}`, {
      params: { workspaceId: payload.workspaceId }
    });
    return response.data;
  },

  reviewFlashcard: async (payload: {
    workspaceId: string;
    cardId: string;
    rating: FlashcardRating;
    elapsedMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ card: FlashcardCard }> => {
    const response = await client.post(`/flashcards/cards/${payload.cardId}/review`, payload);
    return response.data;
  },

  explainFlashcard: async (payload: {
    workspaceId: string;
    cardId: string;
    userMessage?: string;
  }): Promise<{
    reply: string;
    suggestedFollowUps?: string[];
    sourceRefs?: FlashcardSourceRef[];
    explainedBy: string;
  }> => {
    const response = await client.post(`/flashcards/cards/${payload.cardId}/explain`, payload);
    return response.data;
  }
};
