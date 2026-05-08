import client from '../api/client';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export type AiContextMode =
  | 'auto'
  | 'selection_only'
  | 'viewport'
  | 'active_file'
  | 'workbench'
  | 'workspace';

export type AiStudioResourceType =
  | 'report'
  | 'slide_deck'
  | 'mind_map'
  | 'flashcards'
  | 'quiz'
  | 'data_table';

export interface AiContextChipPayload {
  id: string;
  kind: 'selection' | 'viewport' | 'active_file' | 'resource_scope';
  enabled?: boolean;
}

export interface AiContextSelectionRange {
  page?: number;
  pageStart?: number;
  pageEnd?: number;
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
  workbenchTitle?: string;
  workbenchDescription?: string;
  workspaceId?: string;
  workbenchId?: string;
  liveContextVersion?: number;
  liveContextUpdatedAt?: string;
  contextMode?: AiContextMode;
  activeContextChips?: AiContextChipPayload[];
  activePanelId?: string | null;
  activeFileId?: string | null;
  activeFile?: {
    id?: string;
    name?: string;
    path?: string;
    content?: string;
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
    handlers: AiStreamHandlers = {}
  ): Promise<AiStreamResult> => {
    const response = await fetch(`${getApiBaseUrl()}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `AI request failed with status ${response.status}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: AiStreamResult | null = null;

    const handleBlock = (block: string) => {
      const { event, data } = parseSseBlock(block);
      if (!data) return;

      const parsed = JSON.parse(data);
      if (event === 'delta') {
        handlers.onDelta?.(String(parsed));
      } else if (event === 'replace') {
        handlers.onReplace?.(String(parsed));
      } else if (event === 'timeline') {
        handlers.onTimeline?.(parsed as AgentTimelineItem[]);
      } else if (event === 'meta') {
        handlers.onMeta?.(parsed as Partial<AiStreamResult>);
      } else if (event === 'done') {
        finalResult = parsed as AiStreamResult;
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
      throw new Error('AI stream ended before a final response was received');
    }

    return finalResult;
  },

  generateStudioResource: async (payload: {
    workspaceId: string;
    workbenchId?: string;
    resourceType: AiStudioResourceType;
    prompt?: string;
    options?: Record<string, unknown>;
    context: AiChatContext;
  }): Promise<{
    file: any;
    content: string;
    resourceType: AiStudioResourceType;
    runId: string;
    source: string;
    contextCapsule?: unknown;
    contextPolicy?: unknown;
    qualityReport?: unknown;
    flashcardDeck?: FlashcardDeck | null;
    usedContextSummary?: AiUsedContextSummary;
  }> => {
    const response = await client.post('/studio/generate', payload);
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
    const response = await client.post('/studio/judge-quiz', payload);
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
    const response = await client.post('/studio/quiz-question-assistant', payload);
    return response.data;
  },

  listFlashcardDecks: async (payload: {
    workspaceId: string;
    workbenchId?: string;
  }): Promise<{ decks: FlashcardDeck[] }> => {
    const response = await client.get('/flashcards/decks', { params: payload });
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
