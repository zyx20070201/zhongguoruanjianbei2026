import crypto from 'crypto';
import fs from 'fs/promises';
import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  interrupt,
  isInterrupted,
  MemorySaver,
  Overwrite,
  Send,
  START,
  StateGraph
} from '@langchain/langgraph';
import prisma from '../../config/db';
import { FileSystemService } from '../fileSystemService';
import { aiModelProviderService, type AiModelProviderId } from '../aiModelProviderService';
import { conversationHistoryService } from '../conversationHistoryService';
import { courseKnowledgeGraphService } from '../courseKnowledgeGraphService';
import { courseKnowledgeReasoningService } from '../courseKnowledgeReasoningService';
import { documentTextExtractionService } from '../documentTextExtractionService';
import { knowledgeSearchService } from '../knowledgeSearchService';
import { ChatSessionAttachmentContext } from '../../types/contextSystem';
import { LocalStorageService } from '../storage/localStorageService';
import { learnerStateContextAdapter } from '../learnerStateContextAdapter';
import { learningRunService } from '../learningRunService';
import { learningStateBuilder } from '../learningStateBuilder';
import { mclPlannerService } from '../mclPlannerService';
import { resourceDiscoveryService } from '../resourceDiscoveryService';
import { savedMemoryService } from '../savedMemoryService';
import { workspaceFileIndexService, type WorkspaceFileRetrievalMode } from '../workspaceFileIndexService';
import { workbenchService } from '../workbenchService';
import {
  workspaceAgentActionRegistry,
  type WorkspaceAgentArtifact,
  type WorkspaceAgentChangeSet,
  type WorkspaceAgentExecutedAction as RegistryExecutedAction,
  type WorkspaceAgentProposal as RegistryProposal
} from './workspaceAgentActions';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  files?: TerminalChatFileRef[];
};

type TerminalChatFileRef = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

const TERMINAL_PROVIDER_IDS: AiModelProviderId[] = ['deepseek', 'openai', 'gemini', 'claude'];

const terminalProvider = (): AiModelProviderId => {
  const configured = process.env.AI_TERMINAL_PROVIDER?.trim().toLowerCase() as AiModelProviderId | undefined;
  return configured && TERMINAL_PROVIDER_IDS.includes(configured) ? configured : 'deepseek';
};

const terminalModelOptions = () => {
  const provider = terminalProvider();
  const configuredModel = process.env.AI_TERMINAL_MODEL?.trim();
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat';
  return {
    useCase: 'learning' as const,
    provider,
    model: configuredModel || (provider === 'deepseek' ? deepseekModel : undefined)
  };
};

type IntentKind =
  | 'general_explanation'
  | 'course_qa'
  | 'planning'
  | 'personalized_path'
  | 'resource_generation'
  | 'material_search'
  | 'knowledge_graph'
  | 'learner_profile'
  | 'workspace_action';

type WorkspaceAgentExecutionMode =
  | 'direct_answer'
  | 'contextual_answer'
  | 'runtime_loop'
  | 'proposal_required'
  | 'clarification_required';

type WorkspaceAgentRouteHint =
  | 'likely_direct'
  | 'likely_contextual'
  | 'likely_runtime'
  | 'must_proposal'
  | 'likely_clarification';

type WorkspaceAgentExpectedOutput =
  | 'answer'
  | 'explanation'
  | 'summary'
  | 'plan'
  | 'resource_list'
  | 'graph_explanation'
  | 'workspace_proposal'
  | 'clarifying_question';

type WorkspaceAgentRiskLevel = 'low' | 'medium' | 'high';

type WorkspaceAgentContextTarget =
  | 'workspace_files'
  | 'course_knowledge'
  | 'course_graph'
  | 'learner_profile'
  | 'saved_memory'
  | 'conversation_history'
  | 'external_resources';

type WorkspaceAgentRouteSource =
  | 'direct_answer'
  | 'workspace_files'
  | 'course_knowledge'
  | 'course_graph'
  | 'learner_profile'
  | 'saved_memory'
  | 'conversation_history'
  | 'external_resources'
  | 'planning'
  | 'workspace_action'
  | 'clarification';

interface WorkspaceAgentContextNeeds {
  workspaceFiles: boolean;
  courseKnowledge: boolean;
  courseGraph: boolean;
  learnerProfile: boolean;
  savedMemory: boolean;
  conversationHistory: boolean;
  externalResources: boolean;
}

interface WorkspaceAgentActionIntent {
  required: boolean;
  kinds: string[];
  risk: WorkspaceAgentRiskLevel;
}

interface WorkspaceAgentRoute {
  id: string;
  source: WorkspaceAgentRouteSource;
  query: string;
  required: boolean;
  reason: string;
  confidence: number;
  retrievalMode?: WorkspaceFileRetrievalMode;
  fileIds?: string[];
}

interface WorkspaceAgentRouteResult {
  routeId: string;
  source: WorkspaceAgentRouteSource;
  success: boolean;
  useful: boolean;
  summary: string;
  evidenceCount: number;
  proposalCount: number;
  error?: string;
}

type ToolName =
  | 'inspect_workspace_files'
  | 'read_relevant_files'
  | 'search_internal_knowledge'
  | 'query_course_graph'
  | 'read_learner_context'
  | 'read_saved_memories'
  | 'read_conversation_history'
  | 'discover_external_resources'
  | 'generate_learning_plan_draft'
  | 'propose_workspace_action'
  | 'workspace_file_index'
  | 'respond';

interface WorkspaceAgentIntent {
  primaryIntent: IntentKind;
  secondaryIntents: IntentKind[];
  routes: WorkspaceAgentRoute[];
  routeHint: WorkspaceAgentRouteHint;
  requiredContexts: WorkspaceAgentContextTarget[];
  candidateContexts: WorkspaceAgentContextTarget[];
  // Legacy compatibility for the existing runtime. Prefer routeHint plus context targets for new routing logic.
  executionMode: WorkspaceAgentExecutionMode;
  expectedOutput: WorkspaceAgentExpectedOutput;
  contextNeeds: WorkspaceAgentContextNeeds;
  action: WorkspaceAgentActionIntent;
  groundingPolicy: {
    mustUseWorkspaceEvidence: boolean;
    allowGeneralKnowledge: boolean;
  };
  clarification: {
    needed: boolean;
    question?: string;
  };
  hardSignals: {
    explicitWorkspaceReference: boolean;
    explicitFileReference: boolean;
    explicitGraphReference: boolean;
    explicitPersonalizationReference: boolean;
    explicitMemoryReference: boolean;
    explicitExternalReference: boolean;
    explicitConversationReference: boolean;
    explicitMutation: boolean;
  };
  kind: IntentKind;
  confidence: number;
  summary: string;
  requiresKnowledge: boolean;
  requiresGraph: boolean;
  requiresPersonalization: boolean;
  requiresWorkspaceFiles: boolean;
  requiresExternal: boolean;
  requiresMutation: boolean;
  mutationKinds: string[];
}

interface WorkspaceAgentStrategy {
  tool: ToolName;
  reason: string;
  query?: string;
  fileIds?: string[];
  limit?: number;
  retrievalMode?: WorkspaceFileRetrievalMode;
}

interface WorkspaceAgentEvidence {
  id: string;
  kind: string;
  title: string;
  summary: string;
  content?: string;
  source?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface WorkspaceAgentProposal extends RegistryProposal {
  artifacts?: WorkspaceAgentArtifact[];
  changeSet?: WorkspaceAgentChangeSet;
}

interface WorkspaceAgentApprovalDecision {
  decision: 'approve' | 'reject';
  actionIds?: string[];
  note?: string;
}

interface WorkspaceAgentExecutedAction extends RegistryExecutedAction {}

interface WorkspaceAgentToolCall {
  id: string;
  tool: ToolName;
  input: Record<string, unknown>;
  success: boolean;
  useful: boolean;
  summary: string;
  error?: string;
  evidenceCount: number;
  proposalCount: number;
  startedAt: string;
  completedAt: string;
}

interface WorkspaceAgentTraceEntry {
  id: string;
  at: string;
  node: string;
  summary: string;
  details?: Record<string, unknown>;
}

interface WorkspaceSnapshot {
  workspace: {
    id: string;
    name: string;
    description?: string | null;
    major?: string | null;
    userId: string;
  };
  workbenches: Array<{ id: string; title: string; description?: string; updatedAt?: string; resourceCount?: number }>;
  files: Array<{
    id: string;
    name: string;
    path: string;
    nodeType: string;
    fileCategory?: string | null;
    resourceType?: string | null;
    extension?: string | null;
    mimeType?: string | null;
    storageKey?: string | null;
    content?: string | null;
    isBinary?: boolean | null;
    scope?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
  counts: {
    files: number;
    folders: number;
    workbenches: number;
    activePlans: number;
  };
  relevantFiles: Array<{ id: string; name: string; path: string; score: number; reason: string }>;
}

interface WorkspaceAgentEvaluation {
  useful: boolean;
  enough: boolean;
  missing: string[];
  reason: string;
}

interface LearningGoalDraft {
  title: string;
  goalText: string;
  skills: string[];
  weaknesses: string[];
  suggestedMode: 'quick-start' | 'project' | 'review';
}

export interface WorkspaceAgentRunInput {
  workspaceId: string;
  workbenchId?: string | null;
  sessionId?: string | null;
  checkpointThreadId?: string | null;
  messages: ChatMessage[];
  chatFiles?: TerminalChatFileRef[];
}

export interface WorkspaceAgentRunResult {
  reply: string;
  sessionId?: string;
  runId?: string;
  checkpointThreadId?: string;
  status?: 'completed' | 'approval_required';
  goalDraft?: LearningGoalDraft;
  suggestedActions?: Array<{ id: string; label: string; description?: string }>;
  proposedActions?: WorkspaceAgentProposal[];
  executedActions?: WorkspaceAgentExecutedAction[];
  agentTrace?: WorkspaceAgentTraceEntry[];
  evidence?: WorkspaceAgentEvidence[];
  approvalRequest?: {
    proposals: WorkspaceAgentProposal[];
    message: string;
  };
  memoryContext?: {
    askUserToSave?: null;
  };
  agentEvents?: WorkspaceAgentUiEvent[];
}

export type WorkspaceAgentUiEvent =
  | {
      id: string;
      kind: 'activity';
      at: string;
      title: string;
      detail?: string;
      node?: string;
      status: 'running' | 'done' | 'error';
    }
  | {
      id: string;
      kind: 'say';
      at: string;
      phase: 'interim' | 'final';
      content: string;
      node?: string;
    }
  | {
      id: string;
      kind: 'artifact';
      at: string;
      title: string;
      artifactType: 'file' | 'note' | 'diff' | 'list' | 'plan' | 'workbench';
      fileId?: string;
      workbenchId?: string;
      planId?: string;
      detail?: string;
    }
  | {
      id: string;
      kind: 'ask';
      at: string;
      prompt: string;
      node?: string;
      actions?: Array<{ id: string; label: string }>;
    };

export interface WorkspaceAgentStreamEvent {
  type: 'progress' | 'update' | 'token' | 'approval_required' | 'final' | 'error' | 'ui_event';
  node?: string;
  message?: string;
  delta?: string;
  data?: Record<string, unknown>;
  result?: WorkspaceAgentRunResult;
  uiEvent?: WorkspaceAgentUiEvent;
}

const appendArray = <T>(left: T[] = [], right: T[] | T = []) =>
  left.concat(Array.isArray(right) ? right : [right]).filter(Boolean);

const mergeOptional = <T>(left: T | null = null, right: T | null = null) => right ?? left;

const checkpointer = new MemorySaver();

const toThreadId = (input: WorkspaceAgentRunInput) => input.checkpointThreadId || input.sessionId || `workspace:${input.workspaceId}`;

const WorkspaceAgentStateAnnotation = Annotation.Root({
  workspaceId: Annotation<string>(),
  workbenchId: Annotation<string | null>(),
  sessionId: Annotation<string | null>(),
  runId: Annotation<string | null>(),
  userId: Annotation<string | null>(),
  messages: Annotation<ChatMessage[]>({ reducer: appendArray, default: () => [] }),
  chatFiles: Annotation<TerminalChatFileRef[]>({ reducer: appendArray, default: () => [] }),
  chatFileIds: Annotation<string[]>({ reducer: appendArray, default: () => [] }),
  chatAttachments: Annotation<ChatSessionAttachmentContext[]>({ reducer: appendArray, default: () => [] }),
  userInput: Annotation<string>(),
  intent: Annotation<WorkspaceAgentIntent | null>(),
  workspaceSnapshot: Annotation<WorkspaceSnapshot | null>(),
  routes: Annotation<WorkspaceAgentRoute[]>({ reducer: appendArray, default: () => [] }),
  activeRoute: Annotation<WorkspaceAgentRoute | null>(),
  routeResults: Annotation<WorkspaceAgentRouteResult[]>({ reducer: appendArray, default: () => [] }),
  currentStrategy: Annotation<WorkspaceAgentStrategy | null>(),
  queryVariants: Annotation<string[]>({ reducer: appendArray, default: () => [] }),
  retryDirectives: Annotation<string[]>({ reducer: appendArray, default: () => [] }),
  evidence: Annotation<WorkspaceAgentEvidence[]>({ reducer: appendArray, default: () => [] }),
  proposedActions: Annotation<WorkspaceAgentProposal[]>({ reducer: appendArray, default: () => [] }),
  approvalDecision: Annotation<WorkspaceAgentApprovalDecision | null>({ reducer: mergeOptional, default: () => null }),
  executedActions: Annotation<WorkspaceAgentExecutedAction[]>({ reducer: appendArray, default: () => [] }),
  toolCalls: Annotation<WorkspaceAgentToolCall[]>({ reducer: appendArray, default: () => [] }),
  evaluations: Annotation<WorkspaceAgentEvaluation[]>({ reducer: appendArray, default: () => [] }),
  trace: Annotation<WorkspaceAgentTraceEntry[]>({ reducer: appendArray, default: () => [] }),
  attempts: Annotation<number>({ reducer: (left = 0, right = 0) => left + right, default: () => 0 }),
  maxAttempts: Annotation<number>(),
  noGainRounds: Annotation<number>({ reducer: (left = 0, right = 0) => left + right, default: () => 0 }),
  enoughEvidence: Annotation<boolean>(),
  stopReason: Annotation<string | null>(),
  finalReply: Annotation<string | null>(),
  goalDraft: Annotation<LearningGoalDraft | null>()
});

type WorkspaceAgentState = typeof WorkspaceAgentStateAnnotation.State;
type WorkspaceAgentUpdate = typeof WorkspaceAgentStateAnnotation.Update;

const clip = (value: unknown, maxLength = 1200) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const compactJson = (value: unknown, maxLength = 6000) => clip(JSON.stringify(value, null, 2), maxLength);

const unique = (items: string[], limit = 12) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);

const latestUserMessage = (messages: ChatMessage[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

const recentConversationContext = (messages: ChatMessage[], latest: string) =>
  messages
    .filter((message) => message.content.trim() !== latest)
    .slice(-6)
    .map((message) => `${message.role}: ${clip(message.content, 260)}`)
    .join('\n');

const nowIso = () => new Date().toISOString();

const traceEntry = (node: string, summary: string, details?: Record<string, unknown>): WorkspaceAgentTraceEntry => ({
  id: crypto.randomUUID(),
  at: nowIso(),
  node,
  summary,
  details
});

const normalizeMessages = (messages: unknown): ChatMessage[] =>
  Array.isArray(messages)
    ? messages
        .map((message: any) => ({
          role: message?.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: String(message?.content || '').slice(0, 12000),
          files: normalizeChatFiles(message?.files)
        }))
        .filter((message) => message.content.trim())
        .slice(-24)
    : [];

function normalizeChatFiles(value: unknown): TerminalChatFileRef[] {
  return Array.isArray(value)
    ? value
        .map((item: any) => ({
          id: typeof item?.id === 'string' ? item.id : '',
          name: typeof item?.name === 'string' ? item.name : undefined,
          mimeType: typeof item?.mimeType === 'string' ? item.mimeType : undefined,
          size: typeof item?.size === 'number' ? item.size : undefined
        }))
        .filter((item) => item.id)
        .slice(0, 24)
    : [];
}

const chatFileIdsFromInput = (input: WorkspaceAgentRunInput) =>
  unique([
    ...normalizeChatFiles(input.chatFiles).map((file) => file.id),
    ...normalizeMessages(input.messages).flatMap((message) => normalizeChatFiles(message.files).map((file) => file.id))
  ], 24);

const parseMetadataJson = (value?: string | null): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const chatIdFromSessionId = (workspaceId: string, sessionId?: string | null) => {
  const prefix = `workspace-shell-${workspaceId}-`;
  return sessionId?.startsWith(prefix) ? sessionId.slice(prefix.length) : '';
};

const attachmentKind = (file: { name: string; mimeType?: string | null; extension?: string | null }): ChatSessionAttachmentContext['kind'] => {
  const mimeType = (file.mimeType || '').toLowerCase();
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image';
  if (mimeType.includes('pdf') || extension === 'pdf') return 'pdf';
  if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension)) return 'document';
  if (mimeType.startsWith('text/') || ['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql'].includes(extension)) return 'text';
  return 'file';
};

const imageDataUrlFromStoredFile = async (file: { storageKey?: string | null; mimeType?: string | null }) => {
  if (!file.storageKey || !file.mimeType?.startsWith('image/')) return undefined;
  try {
    return `data:${file.mimeType};base64,${(await fs.readFile(LocalStorageService.getFilePath(file.storageKey))).toString('base64')}`;
  } catch {
    return undefined;
  }
};

const tokenize = (value: string) =>
  unique(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
    24
  );

const extractFileHints = (query: string) => {
  const lower = query.toLowerCase();
  const quoted = Array.from(query.matchAll(/[“"']([^“"']{2,80})[”"']/g)).map((match) => match[1]);
  const explicitNames = Array.from(query.matchAll(/([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5\s._-]{1,80}\.(?:pptx?|pdf|docx?|md|markdown|txt|sql|csv|xlsx?))/gi))
    .map((match) => match[1]);
  const numbers = Array.from(lower.matchAll(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/g)).map((match) => match[1]);
  const wantsPresentation = /\bpptx?\b|幻灯片|课件|slide|slides|presentation/i.test(query);
  const wantsPdf = /\bpdf\b|讲义/i.test(query);
  const wantsSqlFile = /\bsql\b/i.test(query) && /\b\w+\.sql\b/i.test(query);
  const extensions = unique([
    wantsPresentation ? 'ppt' : '',
    wantsPresentation ? 'pptx' : '',
    wantsPdf ? 'pdf' : '',
    wantsSqlFile ? 'sql' : ''
  ]);
  const isExplicit = Boolean(quoted.length || explicitNames.length || (numbers.length && extensions.length));
  return {
    isExplicit,
    quoted,
    explicitNames,
    numbers,
    extensions
  };
};

const fileScore = (file: WorkspaceSnapshot['files'][number], query: string) => {
  const hints = extractFileHints(query);
  const terms = tokenize(query);
  const haystack = `${file.name} ${file.path} ${file.fileCategory || ''} ${file.resourceType || ''} ${file.extension || ''}`.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term));
  const extension = String(file.extension || file.name.split('.').pop() || '').toLowerCase();
  const hintNameHits = [...hints.quoted, ...hints.explicitNames].filter((hint) => haystack.includes(hint.toLowerCase()));
  const numberHits = hints.numbers.filter((number) => new RegExp(`(^|[^0-9])0*${number}([^0-9]|$)`).test(haystack));
  const extensionHit = hints.extensions.includes(extension);

  if (hints.isExplicit) {
    const score = hintNameHits.length * 28 + numberHits.length * 14 + (extensionHit ? 10 : 0) + hits.length * 2;
    const explicitHits = [...hintNameHits, ...numberHits, extensionHit ? extension : ''].filter(Boolean);
    return { score, hits: unique(explicitHits) };
  }

  let score = hits.length * 3;
  if (/文件|资料|文档|代码|仓库|workspace|repo|project/i.test(query)) score += 1;
  if (file.nodeType === 'file') score += 0.5;
  if (String(file.fileCategory || '').includes('note')) score += 0.5;
  return { score, hits };
};

const normalizeFileLookupText = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.(pdf|docx?|pptx?|md|markdown|txt|sql|csv|xlsx?)$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const fileEntityMatches = (query: string, files: WorkspaceSnapshot['files']) => {
  const queryKey = normalizeFileLookupText(query);
  if (!queryKey) return [];
  return files
    .filter((file) => file.nodeType === 'file')
    .map((file) => {
      const nameKey = normalizeFileLookupText(file.name);
      const pathKey = normalizeFileLookupText(file.path);
      let score = 0;
      if (nameKey && queryKey.includes(nameKey)) score += 100;
      if (nameKey && nameKey.includes(queryKey)) score += 70;
      if (pathKey && queryKey.includes(pathKey)) score += 40;
      const terms = tokenize(query);
      const hits = terms.filter((term) => {
        const termKey = normalizeFileLookupText(term);
        return termKey.length >= 2 && (nameKey.includes(termKey) || pathKey.includes(termKey));
      });
      score += hits.length * 12;
      return { file, score, hits };
    })
    .filter((item) => item.score >= 24)
    .sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path))
    .slice(0, 6);
};

const emptyContextNeeds = (): WorkspaceAgentContextNeeds => ({
  workspaceFiles: false,
  courseKnowledge: false,
  courseGraph: false,
  learnerProfile: false,
  savedMemory: false,
  conversationHistory: false,
  externalResources: false
});

const emptyHardSignals = (): WorkspaceAgentIntent['hardSignals'] => ({
  explicitWorkspaceReference: false,
  explicitFileReference: false,
  explicitGraphReference: false,
  explicitPersonalizationReference: false,
  explicitMemoryReference: false,
  explicitExternalReference: false,
  explicitConversationReference: false,
  explicitMutation: false
});

const contextNeedsFromTargets = (targets: WorkspaceAgentContextTarget[]): WorkspaceAgentContextNeeds => {
  const targetSet = new Set(targets);
  return {
    workspaceFiles: targetSet.has('workspace_files'),
    courseKnowledge: targetSet.has('course_knowledge'),
    courseGraph: targetSet.has('course_graph'),
    learnerProfile: targetSet.has('learner_profile'),
    savedMemory: targetSet.has('saved_memory'),
    conversationHistory: targetSet.has('conversation_history'),
    externalResources: targetSet.has('external_resources')
  };
};

const executionModeFromRouteHint = (routeHint: WorkspaceAgentRouteHint): WorkspaceAgentExecutionMode => {
  if (routeHint === 'must_proposal') return 'proposal_required';
  if (routeHint === 'likely_clarification') return 'clarification_required';
  if (routeHint === 'likely_runtime') return 'runtime_loop';
  if (routeHint === 'likely_contextual') return 'contextual_answer';
  return 'direct_answer';
};

const routeSourceForContextTarget = (target: WorkspaceAgentContextTarget): WorkspaceAgentRouteSource => {
  if (target === 'workspace_files') return 'workspace_files';
  if (target === 'course_knowledge') return 'course_knowledge';
  if (target === 'course_graph') return 'course_graph';
  if (target === 'learner_profile') return 'learner_profile';
  if (target === 'saved_memory') return 'saved_memory';
  if (target === 'conversation_history') return 'conversation_history';
  return 'external_resources';
};

const buildRoute = (
  source: WorkspaceAgentRouteSource,
  query: string,
  required: boolean,
  reason: string,
  confidence = required ? 0.82 : 0.62,
  retrievalMode?: WorkspaceFileRetrievalMode,
  fileIds?: string[]
): WorkspaceAgentRoute => ({
  id: `route-${crypto.randomUUID()}`,
  source,
  query: clip(query, 500),
  required,
  reason: clip(reason, 360),
  confidence,
  ...(retrievalMode && source === 'workspace_files' ? { retrievalMode } : {}),
  ...(fileIds?.length && source === 'workspace_files' ? { fileIds } : {})
});

const uniqueRoutes = (routes: WorkspaceAgentRoute[]) => {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = route.source;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const inferIntentByRules = (text: string, recentContext = ''): WorkspaceAgentIntent => {
  const normalized = text.toLowerCase();
  const combinedContext = `${text}\n${recentContext}`.toLowerCase();
  const requiresMutation = /创建|保存|写入|修改|删除|绑定|应用|落地|生成|制作|导入|索引|分析资源|分析文档|构建|重建|记住|推荐.*studio|列出.*studio|渲染|运行代码|批改|判题|提示.*题|解释.*题|save|create|write|update|delete|bind|apply|generate|import|index|analy[sz]e|build|recommend.*studio|run code|code lab|retry.*render|judge.*quiz|quiz assistant/.test(text);
  const mutationKinds = [
    /记住|长期记忆|memory|preference/.test(normalized) ? 'save_memory' : '',
    /创建|新建|workbench|学习现场/.test(text) ? 'create_workbench' : '',
    /保存.*计划|save.*plan/.test(normalized) ? 'save_plan' : '',
    /应用.*计划|apply.*plan/.test(normalized) ? 'apply_learning_plan' : '',
    /推荐.*(studio|产物|资源)|studio.*推荐|recommend.*studio/i.test(text) ? 'recommend_studio_artifacts' : '',
    /列出|查看|已有/.test(text) && /studio.*(产物|artifact|资源)|artifacts?/i.test(text) ? 'list_studio_artifacts' : '',
    /重试.*渲染|重新.*渲染|retry.*render/i.test(text) ? 'retry_studio_render_job' : '',
    /运行.*代码|执行.*代码|run code|code lab.*run|运行.*code lab/i.test(text) ? 'run_code_lab' : '',
    /批改|判题|judge.*quiz|quiz.*judge/i.test(text) ? 'judge_studio_quiz_answer' : '',
    /(提示|讲解|解释|帮助).*(这道题|题目|quiz)|quiz.*assistant/i.test(text) ? 'assist_studio_quiz_question' : '',
    /studio|测验|练习|quiz|flashcards?|抽认卡|卡片|思维导图|mind.?map|slide|课件|可视化|visual|debug task|速记|复习清单|生成.*(笔记|资料|资源|测验|练习|卡片|图|课件)/i.test(text) ? 'generate_studio_artifact' : '',
    /保存.*(回答|内容|资料|文件)|落库|save.*(content|file)|生成到/.test(normalized) ? 'save_generated_content' : '',
    /(保存|创建|生成).*(笔记|note)/i.test(text) ? 'create_note' : '',
    /绑定|添加资源|bind|attach/.test(normalized) ? 'bind_resource' : '',
    /索引|index/.test(normalized) ? 'index_file' : '',
    /分析.*(资源|资料|文档|pdf|视频)|resource intelligence|analy[sz]e.*(resource|document)/i.test(text) ? 'analyze_resource' : '',
    /(构建|重建|生成).*(知识图谱|图谱)|build.*graph|rebuild.*graph/i.test(text) ? 'build_course_graph' : '',
    /写入|修改文件|保存文件|write|edit file/.test(normalized) ? 'write_file' : ''
  ].filter(Boolean);

  const hardSignals = {
    ...emptyHardSignals(),
    explicitWorkspaceReference: /workspace|workbench|学习现场|当前项目|工作区|仓库/.test(normalized),
    explicitFileReference: /根据.*(文件|资料|文档|课件|讲义|选区)|文件|资料|文档|课件|讲义|选区|pptx?|pdf|docx?|xlsx?|csv|\w+\.sql/.test(normalized),
    explicitGraphReference: /知识图谱|图谱|前置|先修|依赖|关系|concept graph|prerequisite/.test(text),
    explicitPersonalizationReference: /个性化|适合我|我的情况|画像|薄弱|掌握|我(的)?水平|profile|personal/.test(text),
    explicitMemoryReference: /长期记忆|记住|偏好|我之前|memory|preference/.test(normalized),
    explicitExternalReference: /外部|网上|最新|推荐资源|search web|internet|online/.test(normalized),
    explicitConversationReference: isConversationFollowUp(text, recentContext),
    explicitMutation: requiresMutation
  };

  const matchedIntents: IntentKind[] = [];
  if (hardSignals.explicitGraphReference) matchedIntents.push('knowledge_graph');
  if (/计划|规划|学习路径|路线|下一步|milestone|path|planner|planning|复习计划/.test(text)) matchedIntents.push('planning');
  if (hardSignals.explicitPersonalizationReference) matchedIntents.push('personalized_path');
  if (/资源|推荐资料|外部资料|找资料|搜索资料|resource|search web|studio/.test(text)) matchedIntents.push('resource_generation');
  if (hardSignals.explicitFileReference || hardSignals.explicitWorkspaceReference) matchedIntents.push('material_search');
  if (/根据.*资料|课程资料|知识库|这门课|课件|讲义|course|material/.test(text)) matchedIntents.push('course_qa');
  if (/学习画像|长期记忆|历史对话|我之前|profile|memory|history/.test(text)) matchedIntents.push('learner_profile');

  if (!matchedIntents.length && requiresMutation && /学|课程|复习|计划|sql|join|算法|概念|知识|目标|study|learn|course/.test(combinedContext)) {
    matchedIntents.push('planning');
  }

  const primaryIntent = matchedIntents[0] || 'general_explanation';
  const secondaryIntents = unique(matchedIntents.slice(1), 8) as IntentKind[];
  const contextNeeds = emptyContextNeeds();
  contextNeeds.workspaceFiles = hardSignals.explicitFileReference || ['material_search', 'course_qa'].includes(primaryIntent) || secondaryIntents.some((item) => ['material_search', 'course_qa'].includes(item));
  contextNeeds.courseKnowledge = ['course_qa', 'planning', 'personalized_path', 'material_search', 'knowledge_graph', 'resource_generation'].includes(primaryIntent) || secondaryIntents.some((item) => ['course_qa', 'planning', 'personalized_path', 'material_search', 'knowledge_graph', 'resource_generation'].includes(item));
  contextNeeds.courseGraph = hardSignals.explicitGraphReference || ['knowledge_graph', 'planning', 'personalized_path'].includes(primaryIntent) || secondaryIntents.some((item) => ['knowledge_graph', 'planning', 'personalized_path'].includes(item));
  contextNeeds.learnerProfile = hardSignals.explicitPersonalizationReference || ['personalized_path', 'planning', 'learner_profile'].includes(primaryIntent) || /我|我的|适合我|个性化/.test(text);
  contextNeeds.savedMemory = hardSignals.explicitMemoryReference || primaryIntent === 'learner_profile';
  contextNeeds.conversationHistory = hardSignals.explicitConversationReference;
  contextNeeds.externalResources = hardSignals.explicitExternalReference || primaryIntent === 'resource_generation' || secondaryIntents.includes('resource_generation');

  const requiredContexts = unique([
    hardSignals.explicitFileReference || hardSignals.explicitWorkspaceReference ? 'workspace_files' : '',
    hardSignals.explicitGraphReference ? 'course_graph' : '',
    hardSignals.explicitPersonalizationReference ? 'learner_profile' : '',
    hardSignals.explicitMemoryReference ? 'saved_memory' : '',
    hardSignals.explicitExternalReference ? 'external_resources' : '',
    hardSignals.explicitConversationReference ? 'conversation_history' : '',
    /根据.*资料|课程资料|知识库|这门课|课件|讲义|course material/.test(text) ? 'course_knowledge' : ''
  ], 8) as WorkspaceAgentContextTarget[];
  const candidateContexts = unique([
    contextNeeds.workspaceFiles ? 'workspace_files' : '',
    contextNeeds.courseKnowledge ? 'course_knowledge' : '',
    contextNeeds.courseGraph ? 'course_graph' : '',
    contextNeeds.learnerProfile ? 'learner_profile' : '',
    contextNeeds.savedMemory ? 'saved_memory' : '',
    contextNeeds.conversationHistory ? 'conversation_history' : '',
    contextNeeds.externalResources ? 'external_resources' : ''
  ], 8) as WorkspaceAgentContextTarget[];
  const allContextTargets = unique([...requiredContexts, ...candidateContexts], 8) as WorkspaceAgentContextTarget[];
  const mergedContextNeeds = contextNeedsFromTargets(allContextTargets);
  const contextNeedCount = allContextTargets.length;
  const actionRisk: WorkspaceAgentRiskLevel = /删除|delete|移除|覆盖|overwrite|修改文件|write|edit file/.test(normalized)
    ? 'high'
    : requiresMutation ? 'medium' : 'low';
  const action: WorkspaceAgentActionIntent = {
    required: requiresMutation,
    kinds: mutationKinds,
    risk: actionRisk
  };
  const expectedOutput: WorkspaceAgentExpectedOutput =
    action.required ? 'workspace_proposal'
      : primaryIntent === 'planning' || primaryIntent === 'personalized_path' ? 'plan'
        : primaryIntent === 'resource_generation' ? 'resource_list'
          : primaryIntent === 'knowledge_graph' ? 'graph_explanation'
            : /总结|summary|概括/.test(text) ? 'summary'
              : /解释|什么是|区别|why|how|explain|difference/i.test(text) ? 'explanation'
                : 'answer';
  const routeHint: WorkspaceAgentRouteHint =
    action.required ? 'must_proposal'
      : contextNeedCount === 0 && primaryIntent === 'general_explanation' ? 'likely_direct'
        : contextNeedCount >= 2 || ['planning', 'personalized_path', 'knowledge_graph', 'resource_generation'].includes(primaryIntent) ? 'likely_runtime'
          : 'likely_contextual';
  const executionMode = executionModeFromRouteHint(routeHint);
  const routes = uniqueRoutes([
    ...requiredContexts.map((target) => buildRoute(
      routeSourceForContextTarget(target),
      text,
      true,
      `用户明确触发 ${target} 上下文约束。`,
      0.88
    )),
    ...candidateContexts
      .filter((target) => !requiredContexts.includes(target))
      .map((target) => buildRoute(
        routeSourceForContextTarget(target),
        text,
        false,
        `该上下文可能有助于完成 ${primaryIntent}。`,
        0.64
      )),
    primaryIntent === 'planning' || primaryIntent === 'personalized_path'
      ? buildRoute('planning', text, true, '用户请求学习计划、路径或个性化学习安排，必须等待 planner 产出。', 0.88)
      : null as any,
    action.required
      ? buildRoute('workspace_action', text, true, '用户请求创建、保存、绑定、修改或其他 workspace 写入动作。', 0.9)
      : null as any,
    routeHint === 'likely_direct'
      ? buildRoute('direct_answer', text, false, '未发现必须使用 workspace 上下文的硬约束，可先作为普通问答处理。', 0.72)
      : null as any
  ].filter(Boolean));

  return {
    primaryIntent,
    secondaryIntents,
    routes,
    routeHint,
    requiredContexts,
    candidateContexts,
    executionMode,
    expectedOutput,
    contextNeeds: mergedContextNeeds,
    action,
    groundingPolicy: {
      mustUseWorkspaceEvidence: requiredContexts.some((target) => ['workspace_files', 'course_graph', 'course_knowledge'].includes(target)),
      allowGeneralKnowledge: !hardSignals.explicitWorkspaceReference && !hardSignals.explicitFileReference
    },
    clarification: { needed: false },
    hardSignals,
    kind: primaryIntent,
    confidence: 0.72,
    summary: clip(text, 220) || 'Workspace agent request',
    requiresKnowledge: mergedContextNeeds.courseKnowledge,
    requiresGraph: mergedContextNeeds.courseGraph,
    requiresPersonalization: mergedContextNeeds.learnerProfile || mergedContextNeeds.savedMemory,
    requiresWorkspaceFiles: mergedContextNeeds.workspaceFiles,
    requiresExternal: mergedContextNeeds.externalResources,
    requiresMutation,
    mutationKinds
  };
};

const rewriteQuery = (query: string) => {
  const cleaned = query
    .replace(/^(请|帮我|麻烦|能不能|可以)?(你)?/g, '')
    .replace(/(一下|吗|呢|吧|谢谢|please)$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = tokenize(cleaned).slice(0, 10).join(' ');
  return terms || cleaned || query;
};

const isGreetingOnly = (value?: string | null) =>
  /^(你好|您好|hi|hello|hey|嗨|在吗|在不在|哈喽|hello there)[。！？!?\s]*$/i.test(String(value || '').trim());

const isConversationFollowUp = (text: string, recentContext = '') => {
  const normalized = text.trim().toLowerCase();
  const hasRecentContext = recentContext.trim().length > 0;
  if (/之前|刚才|上次|历史|继续|接着|前面|上一轮|history|previous|earlier/.test(normalized)) return true;
  if (!hasRecentContext) return false;
  return /^(那|这个|那个|它|他|她|继续|接着|再来|帮我创建一个|帮我保存|就这样|按这个)(吧|呢|一下|一个)?[。！？!?\s]*$/i.test(normalized);
};

export class WorkspaceAgentRuntime {
  private readonly graph;

  constructor() {
    this.graph = new StateGraph(WorkspaceAgentStateAnnotation)
      .addNode('QueryRouter', async (state) => this.queryRouter(state))
      .addNode('WorkspaceInspector', async (state) => this.workspaceInspector(state))
      .addNode('ContextPlanner', async (state) => this.contextPlanner(state))
      .addNode('RouteDispatcher', async (state) => this.routeDispatcher(state))
      .addNode('RouteExecutor', async (state) => this.routeExecutor(state))
      .addNode('ResultCollector', async (state) => this.resultCollector(state))
      .addNode('EvidenceEvaluator', async (state) => this.evidenceEvaluator(state))
      .addNode('RetryPolicy', async (state) => this.retryPolicy(state))
      .addNode('ApprovalGate', async (state) => this.approvalGate(state))
      .addNode('ApprovedActionExecutor', async (state) => this.approvedActionExecutor(state))
      .addNode('ResponseComposer', async (state) => this.responseComposer(state))
      .addEdge(START, 'QueryRouter')
      .addEdge('QueryRouter', 'WorkspaceInspector')
      .addEdge('WorkspaceInspector', 'ContextPlanner')
      .addEdge('ContextPlanner', 'RouteDispatcher')
      .addConditionalEdges(
        'RouteDispatcher',
        (state) => this.routeFanOut(state),
        ['RouteExecutor', 'ResponseComposer']
      )
      .addEdge('RouteExecutor', 'ResultCollector')
      .addEdge('ResultCollector', 'EvidenceEvaluator')
      .addConditionalEdges(
        'EvidenceEvaluator',
        (state) => {
          if (!state.stopReason) return 'RetryPolicy';
          if (this.needsApproval(state)) return 'ApprovalGate';
          return 'ResponseComposer';
        },
        ['ApprovalGate', 'ResponseComposer', 'RetryPolicy']
      )
      .addConditionalEdges(
        'ApprovalGate',
        (state) => state.approvalDecision?.decision === 'approve' ? 'ApprovedActionExecutor' : 'ResponseComposer',
        ['ApprovedActionExecutor', 'ResponseComposer']
      )
      .addEdge('ApprovedActionExecutor', 'ResponseComposer')
      .addEdge('RetryPolicy', 'RouteDispatcher')
      .addEdge('ResponseComposer', END)
      .compile({ checkpointer, name: 'workspace-agent-terminal' });
  }

  async run(input: WorkspaceAgentRunInput): Promise<WorkspaceAgentRunResult> {
    const messages = normalizeMessages(input.messages);
    const userInput = latestUserMessage(messages);
    if (!userInput) throw new Error('A user message is required');
    const threadId = toThreadId(input);
    const chatFiles = normalizeChatFiles(input.chatFiles);
    const chatFileIds = chatFileIdsFromInput(input);

    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      intent: 'workspace_agent_terminal',
      input: {
        sessionId: input.sessionId || null,
        userInput,
        checkpointThreadId: threadId
      }
    });

    try {
      const initialUserId = await this.lookupWorkspaceUserId(input.workspaceId).catch(() => null);
      const rawState = await this.graph.invoke(
        {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          sessionId: input.sessionId || null,
          runId: run.id,
          userId: initialUserId,
          messages: new Overwrite(messages),
          chatFiles: new Overwrite(chatFiles),
          chatFileIds: new Overwrite(chatFileIds),
          chatAttachments: new Overwrite([]),
          userInput,
          intent: null,
          workspaceSnapshot: null,
          routes: new Overwrite([]),
          activeRoute: null,
          routeResults: new Overwrite([]),
          currentStrategy: null,
          queryVariants: new Overwrite([userInput]),
          retryDirectives: new Overwrite([]),
          evidence: new Overwrite([]),
          proposedActions: new Overwrite([]),
          approvalDecision: null,
          executedActions: new Overwrite([]),
          toolCalls: new Overwrite([]),
          evaluations: new Overwrite([]),
          trace: new Overwrite([]),
          attempts: 0,
          maxAttempts: 8,
          noGainRounds: 0,
          enoughEvidence: false,
          stopReason: null,
          finalReply: null,
          goalDraft: null
        },
        {
          recursionLimit: 80,
          configurable: {
            thread_id: threadId
          }
        } as any
      ) as WorkspaceAgentState | { [INTERRUPT]: Array<{ value?: unknown }> };
      const interrupted = isInterrupted(rawState);
      const state = interrupted
        ? ((await this.graph.getState({ configurable: { thread_id: threadId } } as any)).values as WorkspaceAgentState)
        : rawState as WorkspaceAgentState;

      const userId = state.userId || state.workspaceSnapshot?.workspace.userId || await this.lookupWorkspaceUserId(input.workspaceId);
      const savedTurn = userId && !interrupted
        ? await conversationHistoryService.saveTurn({
            workspaceId: input.workspaceId,
            workbenchId: input.workbenchId || null,
            userId,
            sessionId: input.sessionId || null,
            title: clip(userInput, 80),
            source: 'terminal',
            messages,
            assistantReply: state.finalReply || this.fallbackReply(state)
          }).catch(() => null)
        : null;

      const proposedActions = this.dedupeProposals(state.proposedActions || []);
      const result: WorkspaceAgentRunResult = {
        reply: interrupted
          ? '我已经准备好可执行的操作，但需要你确认后才能继续。'
          : state.finalReply || this.fallbackReply(state),
        sessionId: savedTurn?.sessionId || input.sessionId || undefined,
        runId: run.id,
        checkpointThreadId: threadId,
        goalDraft: state.goalDraft || undefined,
        proposedActions,
        executedActions: state.executedActions || [],
        agentTrace: state.trace || [],
        evidence: this.dedupeEvidence(state.evidence || []).slice(0, 12),
        suggestedActions: proposedActions.map((proposal) => ({
          id: proposal.id,
          label: proposal.title,
          description: proposal.description
        })),
        approvalRequest: state.approvalDecision?.decision === 'approve'
          ? undefined
          : proposedActions.length
            ? {
                proposals: proposedActions,
                message: '这一步需要你确认后才能继续执行。'
              }
            : undefined,
        status: interrupted ? 'approval_required' : 'completed',
        memoryContext: { askUserToSave: null }
      };

      if (interrupted) {
        await learningRunService.completeRun(run.id, {
          stopReason: 'approval_required',
          intent: state.intent,
          attempts: state.attempts,
          evidenceCount: result.evidence?.length || 0,
          proposalCount: proposedActions.length,
          checkpointThreadId: threadId
        }).catch(() => undefined);
        return result;
      }

      await learningRunService.completeRun(run.id, {
        stopReason: state.stopReason,
        intent: state.intent,
        attempts: state.attempts,
        evidenceCount: result.evidence?.length || 0,
        proposalCount: proposedActions.length
      }).catch(() => undefined);

      return result;
    } catch (error) {
      await learningRunService.failRun(run.id, error).catch(() => undefined);
      throw error;
    }
  }

  async resumeApproval(input: WorkspaceAgentRunInput, decision: WorkspaceAgentApprovalDecision): Promise<WorkspaceAgentRunResult> {
    const threadId = toThreadId(input);
    const command = new Command({
      resume: decision,
      update: {
        approvalDecision: decision
      }
    });
    const rawState = await this.graph.invoke(command as any, {
      recursionLimit: 80,
      configurable: {
        thread_id: threadId
      }
    } as any) as WorkspaceAgentState;
    const messages = normalizeMessages(input.messages);
    const userInput = latestUserMessage(messages) || rawState.userInput;
    const userId = rawState.userId || rawState.workspaceSnapshot?.workspace.userId || await this.lookupWorkspaceUserId(input.workspaceId);
    const savedTurn = userId
      ? await conversationHistoryService.saveTurn({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          userId,
          sessionId: input.sessionId || rawState.sessionId || null,
          title: clip(userInput, 80),
          source: 'terminal',
          messages: messages.length ? messages : rawState.messages,
          assistantReply: rawState.finalReply || this.fallbackReply(rawState)
        }).catch(() => null)
      : null;
    const proposedActions = this.dedupeProposals(rawState.proposedActions || []);
    const result: WorkspaceAgentRunResult = {
      reply: rawState.finalReply || this.fallbackReply(rawState),
      sessionId: savedTurn?.sessionId || input.sessionId || rawState.sessionId || undefined,
      runId: rawState.runId || undefined,
      checkpointThreadId: threadId,
      status: 'completed',
      goalDraft: rawState.goalDraft || undefined,
      proposedActions,
      executedActions: rawState.executedActions || [],
      agentTrace: rawState.trace || [],
      evidence: this.dedupeEvidence(rawState.evidence || []).slice(0, 12),
      suggestedActions: proposedActions.map((proposal) => ({
        id: proposal.id,
        label: proposal.title,
        description: proposal.description
      })),
      memoryContext: { askUserToSave: null }
    };
    return {
      ...result,
      status: 'completed'
    };
  }

  async *streamRun(input: WorkspaceAgentRunInput): AsyncGenerator<WorkspaceAgentStreamEvent> {
    const messages = normalizeMessages(input.messages);
    const userInput = latestUserMessage(messages);
    if (!userInput) throw new Error('A user message is required');
    const threadId = toThreadId(input);
    const chatFiles = normalizeChatFiles(input.chatFiles);
    const chatFileIds = chatFileIdsFromInput(input);
    const collectedUiEvents: WorkspaceAgentUiEvent[] = [];
    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      intent: 'workspace_agent_terminal',
      input: {
        sessionId: input.sessionId || null,
        userInput,
        checkpointThreadId: threadId,
        streaming: true
      }
    });

    try {
      const initialUserId = await this.lookupWorkspaceUserId(input.workspaceId).catch(() => null);
      const initialEvent: WorkspaceAgentStreamEvent = { type: 'progress', node: 'Graph', message: '启动 Workspace Agent graph。', data: { runId: run.id, checkpointThreadId: threadId } };
      yield initialEvent;
      const initialUiEvent = this.uiEventFromStreamEvent(initialEvent);
      if (initialUiEvent) {
        collectedUiEvents.push(initialUiEvent);
        yield { type: 'ui_event', node: initialEvent.node, uiEvent: initialUiEvent };
      }
      const stream = await this.graph.stream({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        sessionId: input.sessionId || null,
        runId: run.id,
        userId: initialUserId,
        messages: new Overwrite(messages),
        chatFiles: new Overwrite(chatFiles),
        chatFileIds: new Overwrite(chatFileIds),
        chatAttachments: new Overwrite([]),
        userInput,
        intent: null,
        workspaceSnapshot: null,
        routes: new Overwrite([]),
        activeRoute: null,
        routeResults: new Overwrite([]),
        currentStrategy: null,
        queryVariants: new Overwrite([userInput]),
        retryDirectives: new Overwrite([]),
        evidence: new Overwrite([]),
        proposedActions: new Overwrite([]),
        approvalDecision: null,
        executedActions: new Overwrite([]),
        toolCalls: new Overwrite([]),
        evaluations: new Overwrite([]),
        trace: new Overwrite([]),
        attempts: 0,
        maxAttempts: 8,
        noGainRounds: 0,
        enoughEvidence: false,
        stopReason: null,
        finalReply: null,
        goalDraft: null
      } as any, {
        recursionLimit: 80,
        configurable: { thread_id: threadId },
        streamMode: ['updates', 'messages', 'tasks']
      } as any);

      for await (const chunk of stream as any) {
        for (const event of this.normalizeStreamChunk(chunk)) {
          yield event;
          if (event.type === 'ui_event' && event.uiEvent) {
            collectedUiEvents.push(event.uiEvent);
            continue;
          }
          const uiEvent = this.uiEventFromStreamEvent(event);
          if (uiEvent) {
            collectedUiEvents.push(uiEvent);
            yield { type: 'ui_event', node: event.node, uiEvent };
          }
        }
      }

      const snapshot = await this.graph.getState({ configurable: { thread_id: threadId } } as any);
      const state = snapshot.values as WorkspaceAgentState;
      const interrupted = Boolean(snapshot.tasks?.some((task: any) => Array.isArray(task.interrupts) && task.interrupts.length));
      const proposedActions = this.dedupeProposals(state.proposedActions || []);
      const result = await this.resultFromState({
        input,
        state,
        threadId,
        runId: run.id,
        messages,
        interrupted
      });
      const artifactEvents = this.artifactUiEventsFromResult(result);
      for (const uiEvent of artifactEvents) {
        collectedUiEvents.push(uiEvent);
        yield { type: 'ui_event', node: 'ArtifactCollector', uiEvent };
      }
      const resultWithEvents: WorkspaceAgentRunResult = {
        ...result,
        agentEvents: collectedUiEvents.slice(-80)
      };

      if (interrupted) {
        await learningRunService.completeRun(run.id, {
          stopReason: 'approval_required',
          intent: state.intent,
          attempts: state.attempts,
          evidenceCount: result.evidence?.length || 0,
          proposalCount: proposedActions.length,
          checkpointThreadId: threadId
        }).catch(() => undefined);
        yield {
          type: 'approval_required',
          node: 'ApprovalGate',
          message: '需要用户确认后继续执行。',
          result: resultWithEvents
        };
        const approvalUiEvent = this.uiEventFromStreamEvent({
          type: 'approval_required',
          node: 'ApprovalGate',
          message: '需要用户确认后继续执行。',
          result: resultWithEvents
        });
        if (approvalUiEvent) {
          collectedUiEvents.push(approvalUiEvent);
          yield { type: 'ui_event', node: 'ApprovalGate', uiEvent: approvalUiEvent };
        }
        return;
      }

      await learningRunService.completeRun(run.id, {
        stopReason: state.stopReason,
        intent: state.intent,
        attempts: state.attempts,
        evidenceCount: result.evidence?.length || 0,
        proposalCount: proposedActions.length
      }).catch(() => undefined);
      yield { type: 'final', node: 'ResponseComposer', result: resultWithEvents };
    } catch (error) {
      await learningRunService.failRun(run.id, error).catch(() => undefined);
      const errorEvent: WorkspaceAgentStreamEvent = {
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      };
      const uiEvent = this.uiEventFromStreamEvent(errorEvent);
      if (uiEvent) yield { type: 'ui_event', uiEvent };
      yield errorEvent;
    }
  }

  private normalizeStreamChunk(chunk: any): WorkspaceAgentStreamEvent[] {
    const mode = Array.isArray(chunk) ? chunk[0] : 'updates';
    const payload = Array.isArray(chunk) ? chunk[1] : chunk;
    if (mode === 'messages') {
      const message = Array.isArray(payload) ? payload[0] : payload;
      const metadata = Array.isArray(payload) ? payload[1] : null;
      const content = typeof message?.content === 'string' ? message.content : '';
      if (!content) return [];
      const node = typeof metadata?.langgraph_node === 'string'
        ? metadata.langgraph_node
        : typeof metadata?.node === 'string'
          ? metadata.node
          : undefined;
      if (node && node !== 'ResponseComposer') {
        return [{
          type: 'ui_event',
          node,
          uiEvent: {
            id: crypto.randomUUID(),
            kind: 'say',
            at: new Date().toISOString(),
            phase: 'interim',
            node,
            content
          }
        }];
      }
      return [{ type: 'token', node, delta: content }];
    }
    if (mode === 'tasks') {
      const task = payload || {};
      if (Array.isArray(task.interrupts) && task.interrupts.length) {
        return [{
          type: 'progress',
          node: task.name || 'ApprovalGate',
          message: 'Graph 已暂停等待人工确认。',
          data: { interrupts: task.interrupts }
        }];
      }
      if (task.name) {
        return [{
          type: 'progress',
          node: task.name,
          message: task.result ? `${task.name} 完成。` : `${task.name} 开始。`
        }];
      }
      return [];
    }
    if (mode === 'updates' && payload && typeof payload === 'object') {
      return Object.entries(payload).map(([node, update]) => ({
        type: 'update',
        node,
        message: this.summarizeUpdate(node, update),
        data: { update: this.publicUpdatePreview(update) }
      }));
    }
    return [];
  }

  private uiEventFromStreamEvent(event: WorkspaceAgentStreamEvent): WorkspaceAgentUiEvent | null {
    const at = new Date().toISOString();
    if (event.type === 'progress') {
      return {
        id: crypto.randomUUID(),
        kind: 'activity',
        at,
        node: event.node,
        title: this.humanizeAgentNode(event.node || 'Agent'),
        detail: event.message,
        status: this.inferActivityStatus(event.message)
      };
    }
    if (event.type === 'update') {
      const detail = event.message || `${event.node || 'Agent'} updated.`;
      return {
        id: crypto.randomUUID(),
        kind: 'activity',
        at,
        node: event.node,
        title: this.humanizeAgentNode(event.node || 'Agent'),
        detail,
        status: detail.includes('failed') || detail.includes('失败') ? 'error' : 'done'
      };
    }
    if (event.type === 'approval_required') {
      return {
        id: crypto.randomUUID(),
        kind: 'ask',
        at,
        node: event.node || 'ApprovalGate',
        prompt: event.message || event.result?.approvalRequest?.message || '需要用户确认后继续执行。',
        actions: (event.result?.proposedActions || []).slice(0, 4).map((action) => ({
          id: action.id,
          label: action.title
        }))
      };
    }
    if (event.type === 'error') {
      return {
        id: crypto.randomUUID(),
        kind: 'activity',
        at,
        node: event.node,
        title: 'Agent error',
        detail: event.message || 'Workspace Agent failed.',
        status: 'error'
      };
    }
    return null;
  }

  private artifactUiEventsFromResult(result: WorkspaceAgentRunResult): WorkspaceAgentUiEvent[] {
    const at = new Date().toISOString();
    const artifacts: WorkspaceAgentUiEvent[] = [];
    (result.executedActions || []).forEach((action) => {
      const data = action.result || {};
      const fileId = typeof data.fileId === 'string' ? data.fileId : typeof data.resourceId === 'string' ? data.resourceId : undefined;
      const workbenchId = typeof data.workbenchId === 'string' ? data.workbenchId : undefined;
      const planId = typeof data.planId === 'string' ? data.planId : undefined;
      if (!fileId && !workbenchId && !planId) return;
      artifacts.push({
        id: crypto.randomUUID(),
        kind: 'artifact',
        at,
        title: action.title || action.summary || 'Agent result',
        detail: action.summary,
        artifactType: fileId ? 'file' : workbenchId ? 'workbench' : 'plan',
        fileId,
        workbenchId,
        planId
      });
    });
    if (result.goalDraft) {
      artifacts.push({
        id: crypto.randomUUID(),
        kind: 'artifact',
        at,
        title: result.goalDraft.title || 'Learning goal draft',
        detail: result.goalDraft.goalText,
        artifactType: 'plan'
      });
    }
    return artifacts.slice(0, 12);
  }

  private inferActivityStatus(message?: string): 'running' | 'done' | 'error' {
    const value = message || '';
    if (/failed|error|失败|错误/.test(value)) return 'error';
    if (/完成|done|generated|已生成|updated|已更新/.test(value)) return 'done';
    return 'running';
  }

  private humanizeAgentNode(node: string) {
    const labels: Record<string, string> = {
      Graph: 'Workspace Agent',
      QueryRouter: 'Planning route',
      WorkspaceInspector: 'Inspecting workspace',
      ContextPlanner: 'Planning context',
      RouteDispatcher: 'Dispatching steps',
      RouteExecutor: 'Running tool step',
      ApprovalGate: 'Approval needed',
      ApprovedActionExecutor: 'Applying approved action',
      ResponseComposer: 'Composing response',
      RetryPolicy: 'Checking coverage',
      ArtifactCollector: 'Collecting results'
    };
    return labels[node] || node || 'Workspace Agent';
  }

  private summarizeUpdate(node: string, update: unknown) {
    const data = update as any;
    if (data?.trace?.length) return data.trace[data.trace.length - 1]?.summary || `${node} updated.`;
    if (data?.routeResults?.length) return data.routeResults[data.routeResults.length - 1]?.summary || `${node} produced route results.`;
    if (data?.evidence?.length) return `${node} 产出 ${data.evidence.length} 条证据。`;
    if (data?.proposedActions?.length) return `${node} 产出 ${data.proposedActions.length} 个待确认操作。`;
    if (data?.finalReply) return '最终回答已生成。';
    return `${node} updated.`;
  }

  private publicUpdatePreview(update: unknown) {
    const data = update as any;
    if (!data || typeof data !== 'object') return update as Record<string, unknown>;
    return {
      trace: Array.isArray(data.trace) ? data.trace.slice(-2) : undefined,
      routeResults: Array.isArray(data.routeResults) ? data.routeResults.slice(-4) : undefined,
      evidenceCount: Array.isArray(data.evidence) ? data.evidence.length : undefined,
      proposalCount: Array.isArray(data.proposedActions) ? data.proposedActions.length : undefined,
      executedActionCount: Array.isArray(data.executedActions) ? data.executedActions.length : undefined,
      finalReply: typeof data.finalReply === 'string' ? clip(data.finalReply, 240) : undefined
    };
  }

  private async resultFromState(input: {
    input: WorkspaceAgentRunInput;
    state: WorkspaceAgentState;
    threadId: string;
    runId?: string;
    messages: ChatMessage[];
    interrupted?: boolean;
  }): Promise<WorkspaceAgentRunResult> {
    const { state, threadId, messages, interrupted } = input;
    const userInput = latestUserMessage(messages) || state.userInput;
    const userId = state.userId || state.workspaceSnapshot?.workspace.userId || await this.lookupWorkspaceUserId(input.input.workspaceId);
    const savedTurn = userId && !interrupted
      ? await conversationHistoryService.saveTurn({
          workspaceId: input.input.workspaceId,
          workbenchId: input.input.workbenchId || null,
          userId,
          sessionId: input.input.sessionId || state.sessionId || null,
          title: clip(userInput, 80),
          source: 'terminal',
          messages,
          assistantReply: state.finalReply || this.fallbackReply(state)
        }).catch(() => null)
      : null;
    const proposedActions = this.dedupeProposals(state.proposedActions || []);
    return {
      reply: interrupted
        ? '我已经准备好可执行的操作，但需要你确认后才能继续。'
        : state.finalReply || this.fallbackReply(state),
      sessionId: savedTurn?.sessionId || input.input.sessionId || state.sessionId || undefined,
      runId: input.runId || state.runId || undefined,
      checkpointThreadId: threadId,
      status: interrupted ? 'approval_required' : 'completed',
      goalDraft: state.goalDraft || undefined,
      proposedActions,
      executedActions: state.executedActions || [],
      agentTrace: state.trace || [],
      evidence: this.dedupeEvidence(state.evidence || []).slice(0, 12),
      suggestedActions: proposedActions.map((proposal) => ({
        id: proposal.id,
        label: proposal.title,
        description: proposal.description
      })),
      approvalRequest: interrupted && proposedActions.length
        ? {
            proposals: proposedActions,
            message: '这一步需要你确认后才能继续执行。'
          }
        : undefined,
      memoryContext: { askUserToSave: null }
    };
  }

  private async queryRouter(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const recentContext = recentConversationContext(state.messages || [], state.userInput);
    const base = inferIntentByRules(state.userInput, recentContext);
    let intent = base;
    const terminalModel = terminalModelOptions();
    if (aiModelProviderService.isConfigured(terminalModel)) {
      try {
        const parsed = await aiModelProviderService.json<Partial<WorkspaceAgentIntent>>({
          ...terminalModel,
          timeoutMs: 0,
          instruction: [
            'You are the routing contract generator for an AI Terminal in a learning workspace.',
            'Analyze the request like a router/classifier/query-analysis layer. Do not make the final answer-vs-retrieve decision.',
            'Return task semantics, hard constraints, candidate sources/contexts, and action risk for later planner/evaluator nodes.',
            'Preserve hard signals from ruleIntent: explicit file/workspace/graph/external/memory/mutation needs must not be downgraded.',
            'Do not let mutation overwrite the primary learning intent. For example, creating a SQL review plan is planning plus an action proposal.',
            'Include only relevant candidate contexts; omit unrelated sources/tools.',
            'For workspace_files routes, explicitly choose retrievalMode: overview for corpus/whole-workspace material review, targeted_search for focused QA/search, deep_read for named-file close reading.',
            'This retrievalMode is a graph planning decision. Do not rely on the retrieval service to infer it from query words.',
            'Use recentMessages to resolve short follow-ups such as "那帮我创建一个吧".',
            'Return only JSON. Keep mutation/action fields conservative.'
          ].join('\n'),
          schema: {
            primaryIntent: 'one of general_explanation, course_qa, planning, personalized_path, resource_generation, material_search, knowledge_graph, learner_profile, workspace_action',
            secondaryIntents: 'array of the same intent labels',
            routes: 'array of { source, query, required, reason, confidence, retrievalMode? }; source is one of direct_answer, workspace_files, course_knowledge, course_graph, learner_profile, saved_memory, conversation_history, external_resources, planning, workspace_action, clarification. retrievalMode is only for workspace_files and must be one of overview, targeted_search, deep_read.',
            routeHint: 'one of likely_direct, likely_contextual, likely_runtime, must_proposal, likely_clarification. This is a routing hint, not a final execution decision.',
            requiredContexts: 'array of hard context targets from workspace_files, course_knowledge, course_graph, learner_profile, saved_memory, conversation_history, external_resources',
            candidateContexts: 'array of potentially relevant context targets from the same list',
            executionMode: 'legacy alias derived from routeHint; do not use as the authoritative decision',
            expectedOutput: 'one of answer, explanation, summary, plan, resource_list, graph_explanation, workspace_proposal, clarifying_question',
            contextNeeds: {
              workspaceFiles: 'boolean',
              courseKnowledge: 'boolean',
              courseGraph: 'boolean',
              learnerProfile: 'boolean',
              savedMemory: 'boolean',
              conversationHistory: 'boolean',
              externalResources: 'boolean'
            },
            action: {
              required: 'boolean',
              kinds: 'string[]',
              risk: 'one of low, medium, high'
            },
            groundingPolicy: {
              mustUseWorkspaceEvidence: 'boolean',
              allowGeneralKnowledge: 'boolean'
            },
            clarification: {
              needed: 'boolean',
              question: 'optional string'
            },
            kind: 'legacy alias for primaryIntent',
            confidence: 'number 0..1',
            summary: 'short Chinese summary of the user goal',
            requiresKnowledge: 'boolean',
            requiresGraph: 'boolean',
            requiresPersonalization: 'boolean',
            requiresWorkspaceFiles: 'boolean',
            requiresExternal: 'boolean',
            requiresMutation: 'boolean',
            mutationKinds: 'string[]'
          },
          input: {
            userInput: state.userInput,
            recentMessages: recentContext,
            ruleIntent: base
          }
        });
        intent = this.mergeIntentContract(base, parsed.data);
      } catch {
        intent = base;
      }
    }

    await this.recordStep(state, 'QueryRouter', { userInput: state.userInput }, { intent, routes: intent.routes });
    return {
      intent,
      routes: intent.routes,
      trace: [traceEntry('QueryRouter', `${intent.routes.length} route(s): ${intent.routes.map((route) => route.source).join(', ') || intent.routeHint}`, { intent, routes: intent.routes })]
    };
  }

  private async workspaceInspector(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const routes = state.routes.length
      ? state.routes
      : [buildRoute('direct_answer', state.userInput, false, '没有显式 route，回退为普通回答。', 0.5)];
    const needsWorkspace = routes.some((route) => route.source !== 'direct_answer' && route.source !== 'clarification');
    if (!needsWorkspace || state.workspaceSnapshot) {
      return {
        trace: [traceEntry('WorkspaceInspector', needsWorkspace ? '复用已有 workspace snapshot。' : '普通直答无需读取 workspace snapshot。')]
      };
    }

    const workspaceSnapshot = await this.inspectWorkspace(state).catch(() => null);
    if (!workspaceSnapshot) {
      return {
        trace: [traceEntry('WorkspaceInspector', 'Workspace snapshot 读取失败或不可用。')]
      };
    }
    const chatAttachments = await this.loadChatAttachmentContexts(state).catch(() => []);

    const evidence: WorkspaceAgentEvidence = {
      id: crypto.randomUUID(),
      kind: 'workspace_snapshot',
      title: `Workspace: ${workspaceSnapshot.workspace.name}`,
      summary: `发现 ${workspaceSnapshot.counts.files} 个文件、${workspaceSnapshot.counts.workbenches} 个 workbench、${workspaceSnapshot.counts.activePlans} 个 active learning plan。`,
      source: 'workspace',
      metadata: {
        relevantFiles: workspaceSnapshot.relevantFiles.slice(0, 8),
        workbenches: workspaceSnapshot.workbenches.slice(0, 6)
      }
    };
    await this.recordStep(state, 'WorkspaceInspector', { routeCount: routes.length }, {
      fileCount: workspaceSnapshot.counts.files,
      workbenchCount: workspaceSnapshot.counts.workbenches
    });
    return {
      workspaceSnapshot,
      chatAttachments: new Overwrite(chatAttachments),
      evidence: [
        evidence,
        ...this.chatAttachmentEvidenceFromAttachments(chatAttachments)
      ],
      trace: [traceEntry('WorkspaceInspector', evidence.summary, { relevantFiles: workspaceSnapshot.relevantFiles.slice(0, 6) })]
    };
  }

  private async contextPlanner(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const snapshot = state.workspaceSnapshot;
    if (!snapshot) {
      return {
        trace: [traceEntry('ContextPlanner', '缺少 workspace snapshot，跳过文件实体解析。')]
      };
    }

    const priorRoutes = state.routes.length ? state.routes : [buildRoute('direct_answer', state.userInput, false, '没有显式 route，回退为普通回答。', 0.5)];
    const hasWorkspaceRoute = priorRoutes.some((route) => route.source === 'workspace_files');
    const fileMatches = fileEntityMatches(state.userInput, snapshot.files);
    const matchedFileIds = fileMatches.map((item) => item.file.id);
    const matchedFileNames = fileMatches.map((item) => item.file.name);
    const explicitFileSignal = snapshot.relevantFiles.some((item) => {
      const key = normalizeFileLookupText(item.name);
      return key && normalizeFileLookupText(state.userInput).includes(key);
    });
    const shouldPromoteWorkspace = matchedFileIds.length > 0 || explicitFileSignal;
    if (!hasWorkspaceRoute && !shouldPromoteWorkspace) {
      return {
        trace: [traceEntry('ContextPlanner', '未识别到需要 workspace 文件上下文的实体。')]
      };
    }

    const retrievalMode: WorkspaceFileRetrievalMode = matchedFileIds.length > 0
      ? 'deep_read'
      : this.inferWorkspaceRetrievalMode(state.userInput, state.intent || inferIntentByRules(state.userInput));
    const workspaceRoute = buildRoute(
      'workspace_files',
      matchedFileNames.length ? matchedFileNames.join(' ') : state.userInput,
      shouldPromoteWorkspace,
      matchedFileIds.length
        ? `解析到明确文件实体：${matchedFileNames.join('、')}`
        : 'workspace 文件上下文可能有帮助。',
      shouldPromoteWorkspace ? 0.93 : 0.68,
      retrievalMode,
      matchedFileIds.length ? matchedFileIds : undefined
    );
    const routes = uniqueRoutes([
      ...priorRoutes.filter((route) => route.source !== 'workspace_files'),
      workspaceRoute
    ]);
    const intent = state.intent
      ? {
          ...state.intent,
          contextNeeds: {
            ...state.intent.contextNeeds,
            workspaceFiles: true
          },
          requiredContexts: unique([
            ...state.intent.requiredContexts,
            'workspace_files'
          ], 8) as WorkspaceAgentContextTarget[],
          candidateContexts: unique([
            ...state.intent.candidateContexts,
            'workspace_files'
          ], 8) as WorkspaceAgentContextTarget[],
          routes
        }
      : null;

    await this.recordStep(state, 'ContextPlanner', {
      matchedFileIds,
      retrievalMode,
      shouldPromoteWorkspace
    }, {
      routes,
      intent
    });

    return {
      routes: new Overwrite(routes),
      intent,
      trace: [traceEntry(
        'ContextPlanner',
        matchedFileIds.length
          ? `解析到文件实体并提升为 workspace_files/deep_read：${matchedFileNames.join('、')}`
          : `workspace_files 路由已规划为 ${retrievalMode}。`,
        { matchedFileIds, retrievalMode }
      )]
    };
  }

  private async routeDispatcher(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const routes = state.routes.length
      ? state.routes
      : [buildRoute('direct_answer', state.userInput, false, '没有显式 route，回退为普通回答。', 0.5)];
    const completed = new Set((state.routeResults || []).map((result) => result.routeId));
    const requiredFirst = [...routes].sort((left, right) => Number(right.required) - Number(left.required) || right.confidence - left.confidence);
    const pendingRoutes = requiredFirst.filter((route) => !completed.has(route.id));

    await this.recordStep(state, 'RouteDispatcher', {
      routeCount: routes.length,
      completed: completed.size
    }, {
      pendingRoutes
    });

    return {
      trace: [traceEntry(
        'RouteDispatcher',
        pendingRoutes.length
          ? `并行分发 ${pendingRoutes.length} 条 route：${pendingRoutes.map((route) => route.source).join(', ')}`
          : '所有 route 已处理，进入回答合成。',
        { pendingRoutes }
      )]
    };
  }

  private routeFanOut(state: WorkspaceAgentState) {
    const routes = state.routes.length
      ? state.routes
      : [buildRoute('direct_answer', state.userInput, false, '没有显式 route，回退为普通回答。', 0.5)];
    const completed = new Set((state.routeResults || []).map((result) => result.routeId));
    const pendingRoutes = [...routes]
      .sort((left, right) => Number(right.required) - Number(left.required) || right.confidence - left.confidence)
      .filter((route) => !completed.has(route.id));
    if (!pendingRoutes.length) return 'ResponseComposer';
    return pendingRoutes.map((route) => new Send('RouteExecutor', { ...state, activeRoute: route }));
  }

  private async routeExecutor(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const route = state.activeRoute;
    if (!route) return {};

    const startedAt = nowIso();
    if (route.source === 'direct_answer' || route.source === 'clarification') {
      const toolCall = this.makeToolCall({ tool: 'respond', reason: route.reason, query: route.query }, true, true, `${route.source} route 准备直接合成回答。`, startedAt, 0, 0);
      const routeResult: WorkspaceAgentRouteResult = {
        routeId: route.id,
        source: route.source,
        success: true,
        useful: true,
        summary: toolCall.summary,
        evidenceCount: 0,
        proposalCount: 0
      };
      return {
        toolCalls: [toolCall],
        routeResults: [routeResult],
        trace: [traceEntry('RouteExecutor', routeResult.summary, { route })]
      };
    }

    const strategy = this.strategyForRoute(route, state);

    try {
      const result = await this.executeTool(state, strategy);
      const toolCall = this.makeToolCall(strategy, true, result.useful, result.summary, startedAt, result.evidence.length, result.proposals.length);
      const routeResult: WorkspaceAgentRouteResult = {
        routeId: route.id,
        source: route.source,
        success: true,
        useful: result.useful,
        summary: result.summary,
        evidenceCount: result.evidence.length,
        proposalCount: result.proposals.length
      };
      await this.recordStep(state, `RouteExecutor:${route.source}`, { route, strategy }, {
        summary: result.summary,
        evidenceCount: result.evidence.length,
        proposalCount: result.proposals.length,
        useful: result.useful
      });
      return {
        evidence: result.evidence,
        proposedActions: result.proposals,
        toolCalls: [toolCall],
        routeResults: [routeResult],
        attempts: 1,
        trace: [traceEntry('RouteExecutor', result.summary, { route, tool: strategy.tool })]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const toolCall = this.makeToolCall(strategy, false, false, `${strategy.tool} failed: ${message}`, startedAt, 0, 0, message);
      const routeResult: WorkspaceAgentRouteResult = {
        routeId: route.id,
        source: route.source,
        success: false,
        useful: false,
        summary: toolCall.summary,
        evidenceCount: 0,
        proposalCount: 0,
        error: message
      };
      return {
        toolCalls: [toolCall],
        routeResults: [routeResult],
        attempts: 1,
        noGainRounds: 1,
        trace: [traceEntry('RouteExecutor', toolCall.summary, { route, error: message })]
      };
    }
  }

  private async resultCollector(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const lastResult = state.routeResults[state.routeResults.length - 1];
    await this.recordStep(state, 'ResultCollector', {
      activeRoute: state.activeRoute,
      routeResults: state.routeResults.length
    }, {
      lastResult,
      evidenceCount: state.evidence.length,
      proposalCount: state.proposedActions.length
    });
    return {
      trace: [traceEntry('ResultCollector', lastResult ? `${lastResult.source}: ${lastResult.summary}` : '没有 route result。', { lastResult })]
    };
  }

  private async evidenceEvaluator(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const intent = state.intent || inferIntentByRules(state.userInput);
    const completed = new Set((state.routeResults || []).map((result) => result.routeId));
    const requiredRoutes = (state.routes || []).filter((route) => route.required);
    const missingRequiredRoutes = requiredRoutes.filter((route) => !completed.has(route.id));
    const failedRequiredRoutes = requiredRoutes.filter((route) => state.routeResults.some((result) => result.routeId === route.id && !result.useful));
    const hasUsefulRoute = state.routeResults.some((result) => result.useful);
    const allRoutesDone = (state.routes || []).every((route) => completed.has(route.id));
    const hasProposal = state.proposedActions.length > 0;
    const directAnswerRoute = state.routeResults.some((result) => result.source === 'direct_answer' && result.useful);
    const clarificationRoute = state.routeResults.some((result) => result.source === 'clarification' && result.useful);
    const overviewRoutes = (state.routes || []).filter((route) => route.source === 'workspace_files' && route.retrievalMode === 'overview');
    const workspaceOverviewEvidence = state.evidence.filter((item) => item.kind === 'workspace_file_card');
    const workspaceTotalFiles = state.workspaceSnapshot?.counts.files || 0;
    const overviewEnough = !overviewRoutes.length || (
      workspaceOverviewEvidence.length >= Math.min(Math.max(workspaceTotalFiles, 1), Number(process.env.WORKSPACE_OVERVIEW_MIN_FILE_CARDS || 8))
    );

    const enough =
      directAnswerRoute ||
      clarificationRoute ||
      Boolean(hasProposal && intent.action.required) ||
      (overviewEnough && requiredRoutes.length > 0 && missingRequiredRoutes.length === 0 && failedRequiredRoutes.length === 0 && (hasUsefulRoute || hasProposal)) ||
      (overviewEnough && requiredRoutes.length === 0 && (hasUsefulRoute || allRoutesDone));

    const missing = [
      ...missingRequiredRoutes.map((route) => route.source),
      ...failedRequiredRoutes.map((route) => `${route.source}_useful_result`),
      ...(!overviewEnough ? ['workspace_files_overview_coverage'] : [])
    ];
    const evaluation: WorkspaceAgentEvaluation = {
      useful: hasUsefulRoute || hasProposal,
      enough,
      missing: unique(missing, 8),
      reason: enough ? 'Route coverage 已足够回答。' : `仍缺少 route 结果：${unique(missing, 4).join('、') || '更多有效证据'}`
    };

    await this.recordStep(state, 'EvidenceEvaluator', {
      routeCount: state.routes.length,
      resultCount: state.routeResults.length,
      requiredRoutes: requiredRoutes.map((route) => route.source),
      overviewCoverage: overviewRoutes.length ? {
        fileCards: workspaceOverviewEvidence.length,
        totalFiles: workspaceTotalFiles,
        enough: overviewEnough
      } : undefined
    }, evaluation as unknown as Record<string, unknown>);

    return {
      evaluations: [evaluation],
      enoughEvidence: enough,
      stopReason: enough ? 'route_coverage_satisfied' : allRoutesDone ? 'all_routes_exhausted' : null,
      noGainRounds: evaluation.useful ? new Overwrite(0) : 1,
      trace: [traceEntry('EvidenceEvaluator', evaluation.reason, { missing: evaluation.missing, enough })]
    };
  }

  private strategyForRoute(route: WorkspaceAgentRoute, state: WorkspaceAgentState): WorkspaceAgentStrategy {
    const query = route.query || state.userInput;
    switch (route.source) {
      case 'workspace_files':
        return {
          tool: 'workspace_file_index',
          reason: route.reason,
          query,
          limit: 12,
          fileIds: route.fileIds,
          retrievalMode: route.retrievalMode || this.inferWorkspaceRetrievalMode(query, state.intent || inferIntentByRules(query))
        };
      case 'course_knowledge':
        return {
          tool: 'search_internal_knowledge',
          reason: route.reason,
          query,
          limit: 6,
          fileIds: extractFileHints(query).isExplicit ? state.workspaceSnapshot?.relevantFiles.slice(0, 4).map((file) => file.id) : undefined
        };
      case 'course_graph':
        return { tool: 'query_course_graph', reason: route.reason, query, limit: 80 };
      case 'learner_profile':
        return { tool: 'read_learner_context', reason: route.reason, query };
      case 'saved_memory':
        return { tool: 'read_saved_memories', reason: route.reason, query };
      case 'conversation_history':
        return { tool: 'read_conversation_history', reason: route.reason, query };
      case 'external_resources':
        return { tool: 'discover_external_resources', reason: route.reason, query, limit: 5 };
      case 'planning':
        return { tool: 'generate_learning_plan_draft', reason: route.reason, query };
      case 'workspace_action':
        return { tool: 'propose_workspace_action', reason: route.reason, query };
      default:
        return { tool: 'respond', reason: route.reason, query };
    }
  }

  private async retryPolicy(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const lastEvaluation = state.evaluations[state.evaluations.length - 1];
    const lastTool = state.toolCalls[state.toolCalls.length - 1];
    const directives: string[] = [];
    const queryUpdates: string[] = [];

    if (lastTool?.tool === 'search_internal_knowledge' && !lastTool.useful && state.queryVariants.length < 2) {
      directives.push('query_rewrite');
      queryUpdates.push(rewriteQuery(state.userInput));
    }
    if (lastEvaluation?.missing.includes('course_graph')) directives.push('expand_to_graph');
    if (lastEvaluation?.missing.includes('learner_context')) directives.push('expand_to_memory');
    if (lastEvaluation?.missing.includes('external_resources')) directives.push('expand_to_external_search');
    if (state.attempts + 1 >= state.maxAttempts) directives.push('fallback_answer');

    await this.recordStep(state, 'RetryPolicy', {
      lastTool: lastTool?.tool,
      missing: lastEvaluation?.missing
    }, { directives, queryUpdates });

    return {
      retryDirectives: directives,
      queryVariants: queryUpdates,
      trace: [traceEntry('RetryPolicy', directives.length ? `扩展策略：${directives.join(', ')}` : '无新增扩展策略。')]
    };
  }

  private async responseComposer(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const finalReply = await this.composeAnswer(state);
    const goalDraft = this.maybeBuildGoalDraft(state);
    await this.recordStep(state, 'ResponseComposer', {
      evidenceCount: state.evidence.length,
      proposals: state.proposedActions.length,
      stopReason: state.stopReason
    }, { replyPreview: clip(finalReply, 400), goalDraft });
    return {
      finalReply,
      goalDraft,
      trace: [traceEntry('ResponseComposer', '已生成最终回答与 proposal 摘要。')]
    };
  }

  private needsApproval(state: WorkspaceAgentState) {
    if (state.approvalDecision) return false;
    if (!state.proposedActions.length) return false;
    return Boolean(state.intent?.action.required || state.proposedActions.some((proposal) => proposal.requiresConfirmation));
  }

  private async approvalGate(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const proposals = this.dedupeProposals(state.proposedActions || []);
    const decision = interrupt<{
      type: 'approval_required';
      message: string;
      proposals: WorkspaceAgentProposal[];
    }, WorkspaceAgentApprovalDecision>({
      type: 'approval_required',
      message: '这些操作会改变 workspace 状态，请确认后继续执行。',
      proposals
    });
    await this.recordStep(state, 'ApprovalGate', { proposalCount: proposals.length }, { decision });
    return {
      approvalDecision: decision,
      trace: [traceEntry('ApprovalGate', decision.decision === 'approve' ? '用户已确认执行 proposal。' : '用户拒绝执行 proposal。', { decision })]
    };
  }

  private async approvedActionExecutor(state: WorkspaceAgentState): Promise<WorkspaceAgentUpdate> {
    const decision = state.approvalDecision;
    if (!decision || decision.decision !== 'approve') {
      return {
        trace: [traceEntry('ApprovedActionExecutor', '未获得执行确认，跳过 action executor。')]
      };
    }

    const allowIds = new Set((decision.actionIds || []).filter(Boolean));
    const proposals = this.dedupeProposals(state.proposedActions || [])
      .filter((proposal) => !allowIds.size || allowIds.has(proposal.id));
    const executedActions: WorkspaceAgentExecutedAction[] = [];
    for (const proposal of proposals) {
      executedActions.push(await this.executeApprovedProposal(state, proposal));
    }
    await this.recordStep(state, 'ApprovedActionExecutor', {
      proposalIds: proposals.map((proposal) => proposal.id)
    }, {
      executedActions
    });
    return {
      executedActions,
      trace: [traceEntry(
        'ApprovedActionExecutor',
        `已处理 ${executedActions.length} 个确认操作：${executedActions.map((item) => `${item.type}:${item.success ? 'ok' : 'failed'}`).join(', ')}`,
        { executedActions }
      )]
    };
  }

  private async executeApprovedProposal(state: WorkspaceAgentState, proposal: WorkspaceAgentProposal): Promise<WorkspaceAgentExecutedAction> {
    try {
      return await workspaceAgentActionRegistry.execute({
        workspaceId: state.workspaceId,
        workbenchId: state.workbenchId || null,
        userId: state.userId || state.workspaceSnapshot?.workspace.userId || null,
        userInput: state.userInput,
        evidence: this.dedupeEvidence(state.evidence || []),
        goalDraft: state.goalDraft || this.maybeBuildGoalDraft(state)
      }, proposal);
    } catch (error) {
      return {
        id: `executed-${crypto.randomUUID()}`,
        proposalId: proposal.id,
        type: proposal.type,
        title: proposal.title,
        success: false,
        summary: `${proposal.title} 执行失败：${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeTool(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy): Promise<{
    summary: string;
    useful: boolean;
    evidence: WorkspaceAgentEvidence[];
    proposals: WorkspaceAgentProposal[];
  }> {
    switch (strategy.tool) {
      case 'read_relevant_files':
        return this.readRelevantFiles(state, strategy);
      case 'search_internal_knowledge':
        return this.searchInternalKnowledge(state, strategy);
      case 'query_course_graph':
        return this.queryCourseGraph(state, strategy);
      case 'read_learner_context':
        return this.readLearnerContext(state);
      case 'read_saved_memories':
        return this.readSavedMemories(state);
      case 'read_conversation_history':
        return this.readConversationHistory(state, strategy);
      case 'discover_external_resources':
        return this.discoverExternalResources(strategy);
      case 'generate_learning_plan_draft':
        return this.generateLearningPlanDraft(state, strategy);
      case 'propose_workspace_action':
        return this.proposeWorkspaceAction(state, strategy);
      case 'workspace_file_index':
        return this.readWorkspaceFileCards(state, strategy);
      case 'inspect_workspace_files':
        return {
          summary: 'Workspace snapshot 已在 InitialContextCollector 中完成。',
          useful: Boolean(state.workspaceSnapshot),
          evidence: [],
          proposals: []
        };
      default:
        return { summary: 'No tool execution needed.', useful: false, evidence: [], proposals: [] };
    }
  }

  private async inspectWorkspace(state: WorkspaceAgentState): Promise<WorkspaceSnapshot> {
    const [workspace, workbenches, files, activePlans, chatFiles] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: state.workspaceId },
        select: { id: true, name: true, description: true, major: true, userId: true }
      }),
      workbenchService.listByWorkspace(state.workspaceId).catch(() => []),
      FileSystemService.getFileTree(state.workspaceId).catch(() => []),
      prisma.learningPlan.count({ where: { workspaceId: state.workspaceId, status: 'active' } }).catch(() => 0),
      this.loadChatAttachmentFiles(state).catch(() => [])
    ]);
    if (!workspace) throw new Error('Workspace not found');
    const fileRows = [
      ...files.filter((node: any) => node.scope !== 'chat'),
      ...chatFiles
    ].map((node: any) => ({
      id: String(node.id),
      name: String(node.name || ''),
      path: String(node.path || ''),
      nodeType: String(node.nodeType || ''),
      fileCategory: node.fileCategory || null,
      resourceType: node.resourceType || null,
      extension: node.extension || null,
      mimeType: node.mimeType || null,
      storageKey: node.storageKey || null,
      content: node.content || null,
      isBinary: Boolean(node.isBinary),
      scope: node.scope || null,
      createdAt: node.createdAt instanceof Date ? node.createdAt.toISOString() : node.createdAt ? String(node.createdAt) : undefined,
      updatedAt: node.updatedAt instanceof Date ? node.updatedAt.toISOString() : node.updatedAt ? String(node.updatedAt) : undefined
    }));
    const scoredFiles = fileRows
      .filter((file) => file.nodeType === 'file')
      .map((file) => {
        const scored = fileScore(file, state.userInput);
        return {
          id: file.id,
          name: file.name,
          path: file.path,
          score: scored.score,
          reason: scored.hits.length ? `matched ${scored.hits.slice(0, 5).join(', ')}` : 'recent or workspace-scope file'
        };
      })
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 12);
    return {
      workspace,
      workbenches: workbenches.slice(0, 12).map((item: any) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        updatedAt: item.updatedAt,
        resourceCount: item.resourceCount
      })),
      files: fileRows,
      counts: {
        files: fileRows.filter((file) => file.nodeType === 'file').length,
        folders: fileRows.filter((file) => file.nodeType === 'folder').length,
        workbenches: workbenches.length,
        activePlans
      },
      relevantFiles: scoredFiles
    };
  }

  private async loadChatAttachmentFiles(state: WorkspaceAgentState) {
    const ids = unique([
      ...(state.chatFileIds || []),
      ...(state.chatFiles || []).map((file) => file.id),
      ...(state.messages || []).flatMap((message) => normalizeChatFiles(message.files).map((file) => file.id))
    ], 24);
    if (!ids.length) return [];

    const expectedSessionId = state.sessionId || '';
    const expectedChatId = chatIdFromSessionId(state.workspaceId, expectedSessionId);
    const rows = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId: state.workspaceId,
        nodeType: 'file',
        scope: 'chat',
        id: { in: ids }
      },
      select: {
        id: true,
        name: true,
        path: true,
        nodeType: true,
        fileCategory: true,
        resourceType: true,
        scope: true,
        extension: true,
        mimeType: true,
        storageKey: true,
        content: true,
        isBinary: true,
        size: true,
        metadataJson: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const allowedRows = rows.filter((file) => {
      if (!expectedSessionId && !expectedChatId) return true;
      const metadata = parseMetadataJson(file.metadataJson);
      return metadata.sessionId === expectedSessionId || (expectedChatId && metadata.chatId === expectedChatId);
    });
    return ids
      .map((id) => allowedRows.find((file) => file.id === id))
      .filter((file): file is NonNullable<typeof file> => Boolean(file));
  }

  private async loadChatAttachmentContexts(state: WorkspaceAgentState): Promise<ChatSessionAttachmentContext[]> {
    const files = await this.loadChatAttachmentFiles(state);
    const attachments: ChatSessionAttachmentContext[] = [];
    for (const file of files) {
      const kind = attachmentKind(file);
      const text = kind === 'image' ? '' : await this.readFileText(state.workspaceId, file).catch(() => '');
      const dataUrl = kind === 'image' ? await imageDataUrlFromStoredFile(file) : undefined;
      const textContent = clip(text, 12000);
      attachments.push({
        id: file.id,
        fileObjectId: file.id,
        name: file.name,
        mimeType: file.mimeType || 'application/octet-stream',
        size: file.size || 0,
        kind,
        createdAt: file.createdAt.toISOString(),
        textContent: textContent || undefined,
        dataUrl,
        status: textContent || dataUrl ? 'ready' : 'metadata_only',
        extractionStatus: textContent ? 'ready' : 'metadata_only',
        savedToWorkbench: false
      });
    }
    return attachments;
  }

  private chatAttachmentEvidenceFromAttachments(attachments: ChatSessionAttachmentContext[]): WorkspaceAgentEvidence[] {
    return attachments.map((attachment) => ({
      id: crypto.randomUUID(),
      kind: 'chat_attachment',
      title: attachment.name,
      summary: attachment.textContent
        ? `当前聊天附件：${clip(attachment.textContent, 280)}`
        : `当前聊天附件：${attachment.kind}，${attachment.mimeType}`,
      content: attachment.textContent ? clip(attachment.textContent, 2200) : undefined,
      source: 'chat_attachment',
      metadata: {
        fileObjectId: attachment.fileObjectId || attachment.id,
        sourceScope: 'chat',
        mimeType: attachment.mimeType,
        attachmentKind: attachment.kind
      }
    }));
  }

  private async ensureChatAttachments(state: WorkspaceAgentState) {
    if (state.chatAttachments?.length) return state.chatAttachments;
    return this.loadChatAttachmentContexts(state).catch(() => []);
  }

  private async readFileText(workspaceId: string, file: { id: string; name: string; path: string; content?: string | null; storageKey?: string | null; isBinary?: boolean | null; extension?: string | null; mimeType?: string | null }) {
    if (file.content && String(file.content).trim()) return String(file.content);
    try {
      return await FileSystemService.getFileContent(workspaceId, file.id);
    } catch {
      const extracted = await documentTextExtractionService.extract({
        id: file.id,
        name: file.name,
        path: file.path,
        storageKey: file.storageKey || undefined,
        content: file.content || undefined,
        isBinary: Boolean(file.isBinary),
        extension: file.extension || undefined,
        mimeType: file.mimeType || undefined
      } as any);
      return extracted.text || '';
    }
  }

  private mergeWorkspaceFileSearchResults(primary: any, secondary: any) {
    if (!secondary) return primary;
    const files = [...(primary.files || []), ...(secondary.files || [])]
      .filter((file, index, items) => items.findIndex((item) => item.fileObjectId === file.fileObjectId) === index);
    const chunks = [...(primary.chunks || []), ...(secondary.chunks || [])]
      .filter((chunk, index, items) => {
        const key = chunk.chunkId || `${chunk.fileObjectId}:${clip(chunk.chunkText, 240)}`;
        return items.findIndex((item) => (item.chunkId || `${item.fileObjectId}:${clip(item.chunkText, 240)}`) === key) === index;
      })
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    return {
      ...primary,
      files,
      chunks
    };
  }

  private mergeKnowledgeSearchResults<T extends { chunkId?: string; fileObjectId: string; chunkText?: string; score?: number }>(items: T[]) {
    return items
      .filter((item, index, all) => {
        const key = item.chunkId || `${item.fileObjectId}:${clip(item.chunkText, 240)}`;
        return all.findIndex((candidate) => (candidate.chunkId || `${candidate.fileObjectId}:${clip(candidate.chunkText, 240)}`) === key) === index;
      })
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  }

  private async readWorkspaceFileCards(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    const query = strategy.query || state.userInput;
    const retrievalMode = strategy.retrievalMode || 'targeted_search';
    const overviewMode = retrievalMode === 'overview';
    const chatFileIds = state.chatFileIds || [];
    const selectedFileIds = strategy.fileIds || [];
    const lockedFileIds = unique([...selectedFileIds, ...chatFileIds], 24);
    const workspaceResult = await workspaceFileIndexService.search({
      workspaceId: state.workspaceId,
      query,
      mode: retrievalMode,
      fileIds: selectedFileIds.length ? lockedFileIds : undefined,
      fileLimit: overviewMode ? Math.max(strategy.limit || 12, 30) : strategy.limit || 12,
      chunkLimit: overviewMode ? Math.max(strategy.limit || 12, 24) : Math.max(6, strategy.limit || 8),
      ensureIndexed: false
    });
    const chatResult = !selectedFileIds.length && chatFileIds.length
      ? await workspaceFileIndexService.search({
          workspaceId: state.workspaceId,
          query,
          mode: retrievalMode,
          fileIds: chatFileIds,
          fileLimit: Math.max(4, Math.ceil((strategy.limit || 12) / 2)),
          chunkLimit: Math.max(4, Math.ceil((strategy.limit || 8) / 2)),
          ensureIndexed: false
        }).catch(() => null)
      : null;
    const result = this.mergeWorkspaceFileSearchResults(workspaceResult, chatResult);
    const fileEvidenceLimit = overviewMode ? 20 : 8;
    const chunkEvidenceLimit = overviewMode ? 12 : 6;

    const evidence: WorkspaceAgentEvidence[] = [
      ...result.files.slice(0, fileEvidenceLimit).map((file: any) => ({
        id: crypto.randomUUID(),
        kind: 'workspace_file_card',
        title: file.fileName,
        summary: `${file.path} | ${file.indexStatus} | chunks=${file.chunkCount}`,
        content: [
          `文件名：${file.fileName}`,
          `路径：${file.path}`,
          `摘要：${file.summary}`,
          file.sampleHeadings.length ? `章节：${file.sampleHeadings.join(' / ')}` : '',
          file.topics.length ? `主题：${file.topics.slice(0, 8).join('、')}` : '',
          `索引状态：${file.indexStatus}`,
          `chunk 数：${file.chunkCount}`,
          file.latestJob?.reason ? `最近索引原因：${file.latestJob.reason}` : '',
          file.latestJob?.error ? `最近错误：${file.latestJob.error}` : ''
        ].filter(Boolean).join('\n'),
        source: file.scope === 'chat' ? 'chat_attachment' : 'workspace',
        metadata: {
          fileObjectId: file.fileObjectId,
          sourceScope: chatFileIds.includes(file.fileObjectId) ? 'chat' : 'workspace',
          indexStatus: file.indexStatus,
          chunkCount: file.chunkCount,
          topics: file.topics,
          latestJob: file.latestJob,
          retrievalMode
        }
      })),
      ...result.chunks.slice(0, chunkEvidenceLimit).map((item: any) => ({
        id: crypto.randomUUID(),
        kind: 'workspace_file_chunk',
        title: item.fileName,
        summary: item.retrievalReason || item.summary || `${item.path} 命中 workspace file index。`,
        content: item.chunkText,
        source: (chatFileIds.includes(item.fileObjectId) ? 'chat_attachment' : item.path),
        score: item.score,
        metadata: {
          chunkId: item.chunkId,
          fileObjectId: item.fileObjectId,
          sourceScope: chatFileIds.includes(item.fileObjectId) ? 'chat' : 'workspace',
          matchedTerms: item.matchedTerms,
          scoreBreakdown: item.scoreBreakdown,
          retrievalMode
        }
      }))
    ];

    return {
      summary: result.chunks.length || result.files.length
        ? `workspace file index(${retrievalMode}) 返回 ${result.files.length} 个文件卡片、${result.chunks.length} 条 chunk。`
        : 'workspace file index 暂未返回结果。',
      useful: result.chunks.length > 0 || result.files.length > 0,
      evidence,
      proposals: []
    };
  }

  private async readRelevantFiles(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    const allFiles = state.workspaceSnapshot?.files || [];
    const fileMap = new Map(allFiles.map((file) => [file.id, file]));
    const query = strategy.query || state.userInput;
    const hints = extractFileHints(query);
    const explicitCandidates = allFiles
      .filter((file) => file.nodeType === 'file')
      .filter((file) => {
        const haystack = `${file.name} ${file.path}`.toLowerCase();
        const extension = String(file.extension || file.name.split('.').pop() || '').toLowerCase();
        const nameMatch = [...hints.quoted, ...hints.explicitNames].some((hint) => haystack.includes(hint.toLowerCase()));
        const numberMatch = hints.numbers.some((number) => new RegExp(`(^|[^0-9])0*${number}([^0-9]|$)`).test(haystack));
        const extensionMatch = hints.extensions.includes(extension);
        return nameMatch || numberMatch || extensionMatch;
      })
      .sort((left, right) => fileScore(right, query).score - fileScore(left, query).score);
    const fileIds = unique(
      (hints.isExplicit && explicitCandidates.length
        ? explicitCandidates.map((file) => file.id)
        : [
            ...(strategy.fileIds || []),
            ...(state.chatFileIds || []),
            ...(state.workspaceSnapshot?.relevantFiles.slice(0, 3).map((file) => file.id) || [])
          ]),
      8
    );
    const evidence: WorkspaceAgentEvidence[] = [];
    for (const fileId of fileIds) {
      const file = fileMap.get(fileId);
      if (!file || file.nodeType !== 'file') continue;
      let content = await this.readFileText(state.workspaceId, file).catch(() => '');
      if (!content.trim() && ['pptx', 'pdf', 'docx'].includes(String(file.extension || '').toLowerCase())) {
        const extracted = await documentTextExtractionService.extract(file).catch(() => null);
        content = extracted?.text || '';
      }
      if (!content.trim()) continue;
      evidence.push({
        id: crypto.randomUUID(),
        kind: 'file_content',
        title: file.name,
        summary: `${file.path} 的可读内容片段。`,
        content: clip(content, 2200),
        source: file.path,
        metadata: { fileObjectId: fileId, path: file.path, extension: file.extension, sourceScope: file.scope === 'chat' ? 'chat' : 'workspace' }
      });
    }

    if (hints.isExplicit && !evidence.length) {
      return {
        summary: `用户明确点名了文件，但 workspace 里没能定位到对应文件：${query}`,
        useful: false,
        evidence: [],
        proposals: []
      };
    }

    return {
      summary: evidence.length ? `读取了 ${evidence.length} 个相关 workspace 文件。` : '没有找到可直接读取的相关文本文件。',
      useful: evidence.length > 0,
      evidence,
      proposals: []
    };
  }

  private async searchInternalKnowledge(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    const query = strategy.query || state.userInput;
    const chatFileIds = state.chatFileIds || [];
    const selectedFileIds = strategy.fileIds || [];
    const lockedFileIds = unique([...selectedFileIds, ...chatFileIds], 24);
    const workspaceResults = await knowledgeSearchService.search({
      workspaceId: state.workspaceId,
      query,
      fileIds: selectedFileIds.length ? lockedFileIds : undefined,
      limit: strategy.limit || 6,
      requireDiversity: true
    });
    const chatResults = !selectedFileIds.length && chatFileIds.length
      ? await knowledgeSearchService.search({
          workspaceId: state.workspaceId,
          query,
          fileIds: chatFileIds,
          limit: Math.max(3, Math.ceil((strategy.limit || 6) / 2)),
          requireDiversity: true
        }).catch(() => [])
      : [];
    const results = this.mergeKnowledgeSearchResults([...workspaceResults, ...chatResults]);
    const evidence = results.slice(0, 6).map((item) => ({
      id: crypto.randomUUID(),
      kind: 'internal_knowledge',
      title: item.fileName,
      summary: item.summary || item.retrievalReason || `${item.path} 命中课程资料。`,
      content: clip(item.chunkText, 1800),
      source: item.path || item.fileName,
      score: item.score,
      metadata: {
        chunkId: item.chunkId,
        fileObjectId: item.fileObjectId,
        sourceScope: (state.chatFileIds || []).includes(item.fileObjectId) ? 'chat' : 'workspace',
        matchedTerms: item.matchedTerms,
        retrievalReason: item.retrievalReason,
        supportSnippets: item.supportSnippets
      }
    }));
    return {
      summary: evidence.length ? `内部知识库返回 ${evidence.length} 条证据。` : `内部知识库没有找到「${query}」的有效结果。`,
      useful: evidence.length > 0,
      evidence,
      proposals: []
    };
  }

  private async queryCourseGraph(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    const query = strategy.query || state.userInput;
    const graph = await courseKnowledgeGraphService.getGraph({ workspaceId: state.workspaceId, limit: strategy.limit || 100 });
    const queryTerms = tokenize(query);
    const nodes = Array.isArray((graph as any).nodes) ? (graph as any).nodes : [];
    const edges = Array.isArray((graph as any).edges) ? (graph as any).edges : [];
    const rankedNodes = nodes
      .map((node: any) => {
        const text = `${node.title || ''} ${node.description || ''} ${(node.aliases || []).join(' ')}`.toLowerCase();
        const score = queryTerms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0) + Number(node.activationScore || 0);
        return { node, score };
      })
      .sort((left: { node: any; score: number }, right: { node: any; score: number }) => right.score - left.score)
      .slice(0, 10)
      .map((item: { node: any; score: number }) => item.node);
    const rankedIds = new Set(rankedNodes.map((node: any) => node.id));
    const relevantEdges = edges
      .filter((edge: any) => rankedIds.has(edge.from) || rankedIds.has(edge.to))
      .slice(0, 16)
      .map((edge: any) => ({
        relationType: edge.relationType,
        from: nodes.find((node: any) => node.id === edge.from)?.title || edge.from,
        to: nodes.find((node: any) => node.id === edge.to)?.title || edge.to,
        weight: edge.weight,
        confidence: edge.confidence
      }));
    const [gaps, weakNeighborhood] = await Promise.all([
      courseKnowledgeReasoningService.getPrerequisiteGaps({ workspaceId: state.workspaceId }).catch(() => []),
      courseKnowledgeReasoningService.expandWeakNeighborhood({ workspaceId: state.workspaceId, limit: 24 }).catch(() => ({ seeds: [], neighbors: [] }))
    ]);
    const evidence: WorkspaceAgentEvidence[] = rankedNodes.length || relevantEdges.length || gaps.length
      ? [{
          id: crypto.randomUUID(),
          kind: 'course_graph',
          title: '课程知识图谱',
          summary: `图谱包含 ${nodes.length} 个概念、${edges.length} 条关系；本轮选出 ${rankedNodes.length} 个相关概念。`,
          content: compactJson({
            relatedConcepts: rankedNodes.map((node: any) => ({
              id: node.id,
              title: node.title,
              description: clip(node.description, 220),
              learnerState: node.learnerState || null,
              misconceptions: node.misconceptions || []
            })),
            relatedRelations: relevantEdges,
            prerequisiteGaps: gaps.slice(0, 8),
            weakNeighborhood
          }, 4500),
          source: 'course_knowledge_graph',
          metadata: { nodeCount: nodes.length, edgeCount: edges.length }
        }]
      : [];
    return {
      summary: evidence.length ? '已查询课程知识图谱与前置知识推理。' : '课程知识图谱暂无可用节点或关系。',
      useful: evidence.length > 0,
      evidence,
      proposals: []
    };
  }

  private async readLearnerContext(state: WorkspaceAgentState) {
    const context = await learnerStateContextAdapter.build({
      workspaceId: state.workspaceId,
      workbenchId: state.workbenchId || null,
      audience: state.intent?.kind === 'planning' ? 'planner' : 'tutor',
      tokenBudget: 1600
    });
    return {
      summary: `读取学习画像：${context.summary}`,
      useful: Boolean(context.summary || context.promptContext),
      evidence: [{
        id: crypto.randomUUID(),
        kind: 'learner_context',
        title: '学习画像',
        summary: context.summary,
        content: context.promptContext,
        source: 'learner_state',
        metadata: {
          personalizationHints: context.personalizationHints,
          provenance: context.provenance
        }
      }],
      proposals: []
    };
  }

  private async readSavedMemories(state: WorkspaceAgentState) {
    const memories = await savedMemoryService.list({
      workspaceId: state.workspaceId,
      workbenchId: state.workbenchId || null,
      limit: 12
    });
    const evidence = memories.length
      ? [{
          id: crypto.randomUUID(),
          kind: 'saved_memory',
          title: '长期记忆',
          summary: `读取到 ${memories.length} 条长期记忆。`,
          content: memories.map((memory) => `- ${memory.text}`).join('\n'),
          source: 'saved_memory',
          metadata: { memories }
        }]
      : [];
    return {
      summary: memories.length ? `读取 ${memories.length} 条长期记忆。` : '没有可用长期记忆。',
      useful: memories.length > 0,
      evidence,
      proposals: []
    };
  }

  private async readConversationHistory(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    if (!state.userId) return { summary: '缺少 userId，无法读取历史对话。', useful: false, evidence: [], proposals: [] };
    const items = await conversationHistoryService.retrieve({
      workspaceId: state.workspaceId,
      workbenchId: state.workbenchId || null,
      userId: state.userId,
      currentSessionId: state.sessionId || null,
      source: 'terminal',
      query: strategy.query || state.userInput,
      limit: 6
    });
    const evidence = items.length
      ? [{
          id: crypto.randomUUID(),
          kind: 'conversation_history',
          title: '相关历史对话',
          summary: `检索到 ${items.length} 条相关历史对话。`,
          content: conversationHistoryService.formatRetrieved(items),
          source: 'conversation_history',
          metadata: { items }
        }]
      : [];
    return {
      summary: items.length ? `检索到 ${items.length} 条历史对话。` : '未检索到相关历史对话。',
      useful: items.length > 0,
      evidence,
      proposals: []
    };
  }

  private async discoverExternalResources(strategy: WorkspaceAgentStrategy) {
    const query = strategy.query || '';
    try {
      const result = await resourceDiscoveryService.discover({ query, maxResults: strategy.limit || 5, provider: 'auto' });
      const evidence = result.results.map((item) => ({
        id: crypto.randomUUID(),
        kind: 'external_resource',
        title: item.title,
        summary: item.summary || item.snippet,
        content: clip(item.contentPreview || item.snippet || item.summary, 1200),
        source: item.url,
        score: item.score,
        metadata: { provider: item.provider, publishedAt: item.publishedAt, author: item.author }
      }));
      return {
        summary: evidence.length ? `外部资源检索返回 ${evidence.length} 条结果。` : '外部资源检索没有结果。',
        useful: evidence.length > 0,
        evidence,
        proposals: []
      };
    } catch (error) {
      return {
        summary: `外部资源检索不可用：${error instanceof Error ? error.message : String(error)}`,
        useful: false,
        evidence: [],
        proposals: []
      };
    }
  }

  private async generateLearningPlanDraft(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    const userInput = strategy.query || state.userInput;
    const stateBundle = await learningStateBuilder.build({
      workspaceId: state.workspaceId,
      workbenchId: state.workbenchId || null,
      goalId: null,
      intent: 'planning',
      userInput
    });
    const plan = await mclPlannerService.planOrRevise({
      stateBundle,
      userInput
    });
    const planningQueryCompiler = (plan.knowledgeGraphSnapshot as any)?.planningQueryCompiler;
    const planningEnhancements = (plan.knowledgeGraphSnapshot as any)?.planningEnhancements;
    const proposal = workspaceAgentActionRegistry.preview({
      id: `proposal-${crypto.randomUUID()}`,
      type: 'save_learning_plan',
      title: '保存增强学习计划',
      description: '将 MCL Planner 生成并经 KG/资源增强的学习计划保存到 workspace。当前只生成 proposal，等待用户确认后写入。',
      risk: 'medium',
      requiresConfirmation: true,
      payload: {
        plan,
        plannerMode: planningEnhancements ? 'mcl_enhanced' : 'mcl',
        planningQueryCompiler,
        planningEnhancements
      }
    });
    return {
      summary: '已生成增强学习计划，但没有写入数据库。',
      useful: true,
      evidence: [{
        id: crypto.randomUUID(),
        kind: 'learning_plan_draft',
        title: '增强学习计划草稿',
        summary: plan.objective,
        content: clip(plan.naturalPlanMarkdown || plan.rationale || plan.objective, 5000),
        source: 'mcl_planner',
        metadata: {
          plannerMode: planningEnhancements ? 'mcl_enhanced' : 'mcl',
          planningQueryCompiler,
          planningEnhancements
        }
      }],
      proposals: [proposal]
    };
  }

  private async proposeWorkspaceAction(state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy) {
    const intent = state.intent || inferIntentByRules(state.userInput);
    const mutationKinds = intent.mutationKinds.length ? intent.mutationKinds : this.inferActionKindsFromRequest(state);
    const proposals = mutationKinds.map((kind) => this.buildProposal(kind, state, strategy));
    return {
      summary: `生成 ${proposals.length} 个待确认 workspace proposal；没有执行写入。`,
      useful: proposals.length > 0,
      evidence: [],
      proposals
    };
  }

  private buildProposal(kind: string, state: WorkspaceAgentState, strategy: WorkspaceAgentStrategy): WorkspaceAgentProposal {
    const base = {
      id: `proposal-${crypto.randomUUID()}`,
      requiresConfirmation: true as const,
      payload: {
        workspaceId: state.workspaceId,
        workbenchId: state.workbenchId || null,
        userInput: state.userInput,
        query: strategy.query || state.userInput,
        evidenceIds: this.dedupeEvidence(state.evidence).slice(0, 8).map((item) => item.id)
      }
    };
    const fileObjectIds = this.inferActionFileIds(state);
    const normalizedKind = this.normalizeActionKind(kind, state);
    if (normalizedKind === 'save_memory') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'save_memory',
        title: '保存长期记忆',
        description: '建议将用户明确表达的偏好/背景保存为长期记忆，需用户确认。',
        risk: 'medium',
        payload: { ...base.payload, candidateText: state.userInput }
      });
    }
    if (normalizedKind === 'create_workbench') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'create_workbench',
        title: '创建学习现场',
        description: '建议基于当前目标创建 workbench；第一版不会自动创建。',
        risk: 'medium',
        payload: { ...base.payload, goalDraft: this.buildGoalDraft(state) }
      });
    }
    if (normalizedKind === 'write_file') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'write_file',
        title: '写入或修改文件',
        description: '用户请求可能涉及文件写入，必须先展示变更建议并等待确认。',
        risk: 'high'
      });
    }
    if (normalizedKind === 'bind_resource_to_workbench') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'bind_resource_to_workbench',
        title: '绑定学习资源',
        description: '建议将相关资源绑定到 workbench 或计划，需确认后执行。',
        risk: 'medium',
        payload: { ...base.payload, fileObjectIds, targetWorkbenchId: state.workbenchId || undefined }
      });
    }
    if (normalizedKind === 'generate_studio_artifact') {
      const templateId = this.inferStudioTemplateId(state.userInput);
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'generate_studio_artifact',
        title: '生成 AI Studio 学习产物',
        description: `调用 AI Studio 模板 ${templateId} 生成并保存学习资源。`,
        risk: 'medium',
        payload: {
          ...base.payload,
          templateId,
          prompt: strategy.query || state.userInput,
          fileObjectIds
        }
      });
    }
    if (normalizedKind === 'recommend_studio_artifacts') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'recommend_studio_artifacts',
        title: '推荐 AI Studio 产物',
        description: '基于当前 Workbench 上下文推荐下一步适合生成的 Studio 产物。',
        risk: 'low',
        payload: {
          ...base.payload,
          goal: this.inferStudioGoal(state.userInput),
          fileObjectIds
        }
      });
    }
    if (normalizedKind === 'list_studio_artifacts') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'list_studio_artifacts',
        title: '查看 AI Studio 产物',
        description: '读取当前 workspace/workbench 已生成的 Studio 产物列表。',
        risk: 'low',
        payload: {
          ...base.payload,
          limit: 20
        }
      });
    }
    if (normalizedKind === 'retry_studio_render_job') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'retry_studio_render_job',
        title: '重试 Studio 渲染任务',
        description: '重试指定 Studio render job，适用于 AI Studio 里可见的失败/跳过渲染任务。',
        risk: 'medium',
        payload: {
          ...base.payload,
          renderJobId: this.inferRenderJobId(state.userInput)
        }
      });
    }
    if (normalizedKind === 'run_code_lab') {
      const code = this.extractFencedCode(state.userInput);
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'run_code_lab',
        title: '运行 Code Lab',
        description: code
          ? '运行用户提供的代码块，并返回 stdout/stderr/编译信息。'
          : '运行 Code Lab 需要 sourceCode；当前 proposal 会等待结构化代码输入。',
        risk: 'high',
        payload: {
          ...base.payload,
          language: code.language || this.inferCodeLanguage(state.userInput),
          sourceCode: code.sourceCode,
          stdin: this.extractCodeStdin(state.userInput)
        }
      });
    }
    if (normalizedKind === 'judge_studio_quiz_answer' || normalizedKind === 'assist_studio_quiz_question') {
      const quizPayload = this.extractQuizActionPayload(state.userInput);
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: normalizedKind,
        title: normalizedKind === 'judge_studio_quiz_answer' ? '批改 Studio Quiz 答案' : '解释 Studio Quiz 题目',
        description: normalizedKind === 'judge_studio_quiz_answer'
          ? '调用 Studio Quiz Judge 批改单题答案，并同步学习事件。'
          : '调用 Studio 单题助手解释题目、提示思路或检查题目质量。',
        risk: normalizedKind === 'judge_studio_quiz_answer' ? 'medium' : 'low',
        payload: {
          ...base.payload,
          ...quizPayload,
          userMessage: normalizedKind === 'assist_studio_quiz_question'
            ? quizPayload.userMessage || state.userInput
            : quizPayload.userMessage
        }
      });
    }
    if (normalizedKind === 'create_note' || normalizedKind === 'save_generated_content') {
      const sourceText = this.bestGeneratedContentSource(state);
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: normalizedKind,
        title: normalizedKind === 'create_note' ? '创建学习笔记' : '保存生成内容',
        description: '将本轮回答、资料摘要或生成草稿保存为文件，确认后落库。',
        risk: 'medium',
        payload: {
          ...base.payload,
          filename: normalizedKind === 'create_note' ? 'agent-note.md' : 'agent-generated.md',
          content: sourceText || state.finalReply || state.userInput,
          targetDir: 'Generated'
        }
      });
    }
    if (normalizedKind === 'index_file' || normalizedKind === 'analyze_resource') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: normalizedKind,
        title: normalizedKind === 'index_file' ? '索引文件' : '分析资源结构',
        description: normalizedKind === 'index_file'
          ? '为相关文件建立知识索引，供后续检索和问答使用。'
          : '运行 Resource Intelligence，提取资源大纲、章节和阅读建议。',
        risk: 'low',
        payload: {
          ...base.payload,
          fileObjectId: fileObjectIds[0],
          fileObjectIds
        }
      });
    }
    if (normalizedKind === 'build_course_graph') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'build_course_graph',
        title: '构建课程知识图谱',
        description: '基于 workspace 资料构建或增强课程知识图谱，确认后运行。',
        risk: 'medium',
        payload: { ...base.payload, reindex: /重建|reindex|重新/.test(state.userInput), validate: true }
      });
    }
    if (normalizedKind === 'apply_learning_plan') {
      return workspaceAgentActionRegistry.preview({
        ...base,
        type: 'apply_learning_plan',
        title: '应用学习计划',
        description: '将指定学习计划应用到 Workbench，确认后绑定到学习现场。',
        risk: 'medium'
      });
    }
    return workspaceAgentActionRegistry.preview({
      ...base,
      type: normalizedKind === 'save_learning_plan' ? 'save_learning_plan' : 'workspace_action',
      title: normalizedKind === 'save_learning_plan' ? '保存学习计划' : '执行 workspace 操作',
      description: '该操作会改变学习空间状态，会先返回变更包并等待确认。',
      risk: 'medium'
    });
  }

  private normalizeActionKind(kind: string, state: WorkspaceAgentState): string {
    const normalized = String(kind || '').trim();
    if (normalized === 'save_plan') return 'save_learning_plan';
    if (normalized === 'bind_resource') return 'bind_resource_to_workbench';
    if (normalized === 'generate_resource' || normalized === 'resource_generation') return 'generate_studio_artifact';
    if (normalized === 'recommend_studio_resources' || normalized === 'studio_recommendation') return 'recommend_studio_artifacts';
    if (normalized === 'list_studio_resources' || normalized === 'list_studio_results') return 'list_studio_artifacts';
    if (normalized === 'retry_render_job' || normalized === 'retry_render') return 'retry_studio_render_job';
    if (normalized === 'code_lab_run' || normalized === 'execute_code') return 'run_code_lab';
    if (normalized === 'judge_quiz_answer' || normalized === 'quiz_judge') return 'judge_studio_quiz_answer';
    if (normalized === 'quiz_question_assistant' || normalized === 'quiz_assistant') return 'assist_studio_quiz_question';
    if (normalized === 'index_resource') return 'index_file';
    if (normalized === 'resource_intelligence') return 'analyze_resource';
    if (normalized === 'build_graph' || normalized === 'rebuild_graph') return 'build_course_graph';
    if (normalized === 'workspace_action') {
      return this.inferActionKindsFromRequest(state)[0] || 'workspace_action';
    }
    return normalized || 'workspace_action';
  }

  private inferActionKindsFromRequest(state: WorkspaceAgentState) {
    const text = state.userInput;
    const lower = text.toLowerCase();
    const kinds = [
      /记住|长期记忆|memory|preference/.test(lower) ? 'save_memory' : '',
      /创建|新建|workbench|学习现场/.test(text) ? 'create_workbench' : '',
      /保存.*计划|save.*plan/.test(lower) ? 'save_learning_plan' : '',
      /应用.*计划|apply.*plan/.test(lower) ? 'apply_learning_plan' : '',
      /推荐.*(studio|产物|资源)|studio.*推荐|recommend.*studio/i.test(text) ? 'recommend_studio_artifacts' : '',
      /列出|查看|已有/.test(text) && /studio.*(产物|artifact|资源)|artifacts?/i.test(text) ? 'list_studio_artifacts' : '',
      /重试.*渲染|重新.*渲染|retry.*render/i.test(text) ? 'retry_studio_render_job' : '',
      /运行.*代码|执行.*代码|run code|code lab.*run|运行.*code lab/i.test(text) ? 'run_code_lab' : '',
      /批改|判题|judge.*quiz|quiz.*judge/i.test(text) ? 'judge_studio_quiz_answer' : '',
      /(提示|讲解|解释|帮助).*(这道题|题目|quiz)|quiz.*assistant/i.test(text) ? 'assist_studio_quiz_question' : '',
      /studio|测验|练习|quiz|flashcards?|抽认卡|卡片|思维导图|mind.?map|slide|课件|可视化|visual|code lab|debug task|速记|复习清单|生成.*(笔记|资料|资源|测验|练习|卡片|图|课件)/i.test(text) ? 'generate_studio_artifact' : '',
      /(保存|创建|生成).*(笔记|note)/i.test(text) ? 'create_note' : '',
      /保存.*(回答|内容|资料|文件)|落库|save.*(content|file)|生成到/.test(lower) ? 'save_generated_content' : '',
      /绑定|添加资源|bind|attach/.test(lower) ? 'bind_resource_to_workbench' : '',
      /索引|index/.test(lower) ? 'index_file' : '',
      /分析.*(资源|资料|文档|pdf|视频)|resource intelligence|analy[sz]e.*(resource|document)/i.test(text) ? 'analyze_resource' : '',
      /(构建|重建|生成).*(知识图谱|图谱)|build.*graph|rebuild.*graph/i.test(text) ? 'build_course_graph' : '',
      /写入|修改文件|edit file|overwrite/.test(lower) ? 'write_file' : ''
    ];
    const inferred = unique(kinds.filter(Boolean), 8);
    if (inferred.length) return inferred;
    if (state.intent?.primaryIntent === 'resource_generation') return ['generate_studio_artifact'];
    if (state.intent?.primaryIntent === 'knowledge_graph') return ['build_course_graph'];
    return ['workspace_action'];
  }

  private inferStudioTemplateId(text: string) {
    if (/cornell|pagelm/i.test(text)) return 'pagelm_cornell_notes';
    if (/笔记|notes?|整理资料|resource.*note/i.test(text)) return 'resource_to_notes';
    if (/对比|compare|差异/.test(text)) return 'resource_compare';
    if (/思维导图|mind.?map/i.test(text)) return 'mind_map';
    if (/知识图谱|concept.?graph|knowledge.?graph/i.test(text)) return 'knowledge_graph';
    if (/测验|练习|quiz|practice/i.test(text)) return 'custom_practice';
    if (/flashcards?|抽认卡|卡片/.test(text)) return 'flashcards';
    if (/速记|复习清单|review sheet/i.test(text)) return 'quick_review_sheet';
    if (/复习计划|review plan/i.test(text)) return 'review_plan';
    if (/code lab|代码实验|实验步骤/i.test(text)) return 'code_lab';
    if (/debug|调试/.test(text)) return 'debug_task';
    if (/visual explainer|视觉讲解|可视化讲解/.test(text)) return 'visual_explainer';
    if (/slide|幻灯片|课件/.test(text)) return 'slide_deck';
    if (/视频脚本|video script/i.test(text)) return 'video_script';
    if (/interactive|交互/.test(text)) return 'interactive_demo';
    if (/manim|动画/.test(text)) return 'algorithm_animation';
    if (/remotion|ui video/i.test(text)) return 'ui_video';
    if (/学习计划|study plan/i.test(text)) return 'study_plan';
    return 'resource_to_notes';
  }

  private inferStudioGoal(text: string) {
    if (/测验|练习|quiz|practice|批改|判题/i.test(text)) return 'practice';
    if (/思维导图|知识图谱|关系|map|graph/i.test(text)) return 'map';
    if (/复习|review|卡片|flashcards?|抽认卡/i.test(text)) return 'review';
    if (/代码|实验|code|lab|debug/i.test(text)) return 'lab';
    if (/可视化|动画|视频|slide|幻灯片|课件|visual|manim|remotion/i.test(text)) return 'visualize';
    if (/计划|规划|plan|路线/i.test(text)) return 'plan';
    return undefined;
  }

  private inferRenderJobId(text: string) {
    const labeled = text.match(/(?:render\s*job|renderJobId|jobId|渲染任务|渲染\s*job)[:：#\s-]*([a-zA-Z0-9_-]{8,})/i);
    if (labeled?.[1]) return labeled[1];
    const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuid?.[0] || '';
  }

  private extractFencedCode(text: string) {
    const match = text.match(/```([a-zA-Z0-9_+#.-]*)\s*\n([\s\S]*?)```/);
    if (!match) return { language: this.inferCodeLanguage(text), sourceCode: '' };
    return {
      language: match[1]?.trim() || this.inferCodeLanguage(text),
      sourceCode: match[2]?.trim() || ''
    };
  }

  private inferCodeLanguage(text: string) {
    if (/typescript|ts\b/i.test(text)) return 'typescript';
    if (/javascript|node|js\b/i.test(text)) return 'javascript';
    if (/python|py\b/i.test(text)) return 'python';
    if (/java\b/i.test(text)) return 'java';
    if (/c\+\+|cpp/i.test(text)) return 'cpp';
    if (/\bc\b/.test(text)) return 'c';
    if (/go|golang/i.test(text)) return 'go';
    if (/rust/i.test(text)) return 'rust';
    if (/sqlite|sql/i.test(text)) return 'sql';
    return 'python';
  }

  private extractCodeStdin(text: string) {
    const match = text.match(/(?:stdin|输入)[:：]\s*([\s\S]+)$/i);
    return match?.[1]?.trim() || '';
  }

  private extractQuizActionPayload(text: string): Record<string, unknown> {
    const jsonBlock = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || '';
    if (jsonBlock) {
      try {
        const parsed = JSON.parse(jsonBlock);
        if (parsed && typeof parsed === 'object') {
          return {
            question: parsed.question || parsed,
            userAnswer: typeof parsed.userAnswer === 'string' ? parsed.userAnswer : '',
            userMessage: typeof parsed.userMessage === 'string' ? parsed.userMessage : ''
          };
        }
      } catch {
        // Keep this extractor best-effort; the executor will validate required fields.
      }
    }
    const answer = text.match(/(?:我的答案|userAnswer|答案)[:：]\s*([^\n]+)/i)?.[1]?.trim() || '';
    return {
      question: null,
      userAnswer: answer,
      userMessage: text
    };
  }

  private inferActionFileIds(state: WorkspaceAgentState) {
    return unique([
      ...(state.chatFileIds || []),
      ...(state.workspaceSnapshot?.relevantFiles || []).slice(0, 6).map((file) => file.id),
      ...(state.evidence || []).map((item) => String(item.metadata?.fileObjectId || '')).filter(Boolean)
    ], 12);
  }

  private bestGeneratedContentSource(state: WorkspaceAgentState) {
    const evidence = this.dedupeEvidence(state.evidence || [])
      .filter((item) => item.content?.trim())
      .slice(0, 4);
    if (state.finalReply?.trim()) return state.finalReply;
    if (!evidence.length) return '';
    return [
      `# ${clip(state.userInput, 80) || 'Agent Note'}`,
      '',
      ...evidence.map((item, index) => [
        `## ${index + 1}. ${item.title}`,
        item.summary,
        item.content
      ].filter(Boolean).join('\n\n'))
    ].join('\n\n');
  }

  private async composeAnswer(state: WorkspaceAgentState) {
    const evidence = this.dedupeEvidence(state.evidence).slice(0, 10);
    const proposals = this.dedupeProposals(state.proposedActions).slice(0, 8);
    const executedActions = state.executedActions || [];
    if (executedActions.length) {
      return [
        '已根据你的确认继续执行。',
        ...executedActions.map((action) => `- ${action.success ? '完成' : '失败'}：${action.summary}`),
        proposals.length ? `原始 proposal：${proposals.map((proposal) => proposal.title).join('；')}` : ''
      ].filter(Boolean).join('\n');
    }
    if (state.approvalDecision?.decision === 'reject') {
      return [
        '好的，我没有执行这些会改变 workspace 状态的操作。',
        proposals.length ? `已取消：${proposals.map((proposal) => proposal.title).join('；')}` : ''
      ].filter(Boolean).join('\n\n');
    }
    const attempts = state.toolCalls.filter((call) => call.tool !== 'respond').map((call) => ({
      tool: call.tool,
      useful: call.useful,
      summary: call.summary
    }));
    if (state.intent?.routeHint === 'likely_clarification') {
      return state.intent.clarification.question || '我还需要你补充一下目标或范围：你希望我直接解释，还是基于当前 workspace 的资料来处理？';
    }
    if (state.intent?.routeHint === 'likely_direct' && !state.intent.requiredContexts.length && !state.intent.action.required) {
      if (aiModelProviderService.isConfigured(terminalModelOptions())) {
        try {
          const systemPrompt = [
            '你是 AI Terminal 里的通用学习现场助手。',
            '当前请求被路由为 direct_answer：不需要调用 workspace 工具，也不需要声称读取了文件、课程资料、图谱或记忆。',
            '可以使用通用知识直接回答；如果问题实际需要课程文件或当前 workspace 依据，要说明需要用户指定资料或要求你基于 workspace 检索。'
          ].join('\n');
          const response = await this.callLearningModel(
            [
              {
                role: 'user',
                content: [
                  `用户问题：${state.userInput}`,
                  `最近对话：${recentConversationContext(state.messages || [], state.userInput) || '无'}`,
                  `路由契约：${compactJson(state.intent, 1600)}`
                ].join('\n\n')
              }
            ],
            systemPrompt,
            await this.ensureChatAttachments(state)
          );
          if (response.reply.trim()) {
            state.trace.push(traceEntry('ResponseComposer', `direct_answer 使用 ${response.provider}:${response.model} 生成。`));
            return response.reply.trim();
          }
        } catch (error) {
          state.trace.push(traceEntry('ResponseComposer', 'Direct answer 生成失败，降级到本地 fallback。', {
            error: error instanceof Error ? error.message : String(error)
          }));
        }
      }
      return this.fallbackReply(state);
    }
    if (aiModelProviderService.isConfigured(terminalModelOptions())) {
      try {
        const systemPrompt = [
          '你是集成在课程 workspace 里的受控 Workspace Agent。',
          '只能基于 evidence 和 proposal 回答；不要声称已经执行数据库写入或修改文件。',
          '如果资料不足，要说明不足和已经尝试过的方向。',
          '默认用简体中文，回答清楚、可执行。'
        ].join('\n');
        const response = await this.callLearningModel(
          [
            {
              role: 'user',
              content: [
                `用户问题：${state.userInput}`,
                `意图：${compactJson(state.intent, 1200)}`,
                `停止原因：${state.stopReason || 'unknown'}`,
                `工具尝试：${compactJson(attempts, 2400)}`,
                `证据：${compactJson(evidence.map((item) => ({
                  kind: item.kind,
                  title: item.title,
                  source: item.source,
                  summary: item.summary,
                  content: clip(item.content, 900)
                })), 7000)}`,
                `待确认 proposals：${compactJson(proposals, 3000)}`,
                `已确认执行结果：${compactJson(executedActions, 2400)}`,
                state.approvalDecision ? `用户审批结果：${compactJson(state.approvalDecision, 600)}` : ''
              ].join('\n\n')
            }
          ],
          systemPrompt,
          await this.ensureChatAttachments(state)
        );
        if (response.reply.trim()) {
          state.trace.push(traceEntry('ResponseComposer', `使用 ${response.provider}:${response.model} 生成最终回答。`));
          return response.reply.trim();
        }
      } catch (error) {
        state.trace.push(traceEntry('ResponseComposer', 'LLM 回答生成失败，降级到本地 fallback。', {
          error: error instanceof Error ? error.message : String(error)
        }));
        // Fall through to deterministic response.
      }
    }
    return this.fallbackReply(state);
  }

  private async callLearningModel(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt: string,
    attachments: ChatSessionAttachmentContext[] = []
  ) {
    const terminalModel = terminalModelOptions();
    const preferredProvider = terminalModel.provider;
    const preferredModel = terminalModel.model || aiModelProviderService.model(preferredProvider, undefined, 'learning');
    const candidates = [
      { provider: preferredProvider, model: preferredModel },
      ...aiModelProviderService.configuredChatModels()
    ].filter((item) => item.provider && item.model);
    const seen = new Set<string>();
    const uniqueCandidates = candidates.filter((item) => {
      const key = `${item.provider}:${item.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    let lastError: unknown = null;

    for (const candidate of uniqueCandidates) {
      try {
        return await aiModelProviderService.chat(messages, {
          ...terminalModel,
          provider: candidate.provider,
          model: candidate.model,
          timeoutMs: 45000,
          systemPrompt,
          attachments
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Learning model request failed'));
  }

  private fallbackReply(state: WorkspaceAgentState) {
    const userInput = state.userInput || latestUserMessage(state.messages || []) || '';
    if (isGreetingOnly(userInput)) {
      return [
        '你好，我在。',
        '你可以直接问普通学习问题，也可以让我基于这个 workspace 的课程资料、文件、知识图谱或学习画像来处理；如果需要修改或保存东西，我只会先给 proposal。'
      ].join('\n\n');
    }

    const evidence = this.dedupeEvidence(state.evidence).slice(0, 5);
    const proposals = this.dedupeProposals(state.proposedActions);
    const executedActions = state.executedActions || [];
    if (executedActions.length) {
      return [
        '已根据你的确认继续执行。',
        ...executedActions.map((action) => `- ${action.success ? '完成' : '失败'}：${action.summary}`),
        proposals.length ? `原始 proposal：${proposals.map((proposal) => proposal.title).join('；')}` : ''
      ].filter(Boolean).join('\n');
    }
    if (state.approvalDecision?.decision === 'reject') {
      return [
        '好的，我没有执行这些会改变 workspace 状态的操作。',
        proposals.length ? `已取消：${proposals.map((proposal) => proposal.title).join('；')}` : ''
      ].filter(Boolean).join('\n\n');
    }
    if (state.intent?.routeHint === 'likely_direct' && !state.intent.requiredContexts.length && !state.intent.action.required) {
      return [
        `这是一个普通问答请求：${userInput}`,
        '当前没有调用 workspace 工具。如果你希望我基于课程资料、文件或知识图谱回答，可以明确说“根据当前资料/某个文件/知识图谱”。'
      ].join('\n\n');
    }
    const hasOnlyWorkspaceSnapshot = evidence.length > 0 && evidence.every((item) => item.kind === 'workspace_snapshot');
    if (hasOnlyWorkspaceSnapshot && state.stopReason === 'planner_ready_to_answer') {
      return [
        '我已经看到了这个 workspace 的基本情况，但还没有足够的具体资料依据来回答这个问题。',
        `当前 workspace 有 ${state.workspaceSnapshot?.counts.files ?? 0} 个文件、${state.workspaceSnapshot?.counts.workbenches ?? 0} 个 workbench。`,
        '你可以问得更具体一点，比如“有哪些 SQL 相关文件”“总结某个文件”“根据课程资料解释某个概念”。'
      ].join('\n\n');
    }

    const groundedFallback = this.groundedFallbackReply(state, evidence, proposals);
    if (groundedFallback) return groundedFallback;

    const lines = [
      `我处理了这个请求：${userInput}`,
      evidence.length
        ? `可用依据：${evidence.map((item) => `${item.title}（${item.kind}）`).join('；')}`
        : '目前没有拿到足够的课程资料依据。',
      `尝试过：${state.toolCalls.filter((call) => call.tool !== 'respond').map((call) => call.tool).join(' -> ') || '基础上下文收集'}`,
      proposals.length
        ? `需要确认的操作建议：${proposals.map((proposal) => proposal.title).join('；')}。我没有直接写入或修改 workspace。`
        : '',
      state.stopReason && state.stopReason !== 'sufficient_evidence' ? `停止原因：${state.stopReason}` : ''
    ].filter(Boolean);
    return lines.join('\n\n');
  }

  private groundedFallbackReply(
    state: WorkspaceAgentState,
    evidence: WorkspaceAgentEvidence[],
    proposals: WorkspaceAgentProposal[]
  ) {
    const fileEvidence = evidence.filter((item) => item.kind === 'file_content' && item.content?.trim()).slice(0, 4);
    if (!fileEvidence.length) return null;

    const summaries = fileEvidence.map((item) => {
      const topicLine = this.localEvidenceDigest(item.content || '');
      return `- **${item.title}**：${topicLine || item.summary || '读到了可用内容片段。'}`;
    });
    const topicHints = unique(fileEvidence.flatMap((item) => this.extractFallbackKeywords(item.content || '')), 8);
    const attempts = state.toolCalls.filter((call) => call.tool !== 'respond').map((call) => call.tool);
    const lines = [
      '我已经读到了相关资料，但最终模型合成请求临时失败；先给你一版基于已读取片段的本地解读：',
      '',
      '## 读到的资料',
      ...summaries,
      '',
      topicHints.length
        ? `## 主要主题\n这组资料目前能看出的关键词是：${topicHints.join('、')}。`
        : '',
      '',
      '## 简要解读',
      this.localConceptualSummary(fileEvidence),
      '',
      attempts.length ? `已尝试：${attempts.join(' -> ')}` : '',
      proposals.length ? `需要确认的操作建议：${proposals.map((proposal) => proposal.title).join('；')}。` : ''
    ].filter((line) => line !== '');
    return lines.join('\n');
  }

  private localEvidenceDigest(content: string) {
    const normalized = content.replace(/\s+/g, ' ').trim();
    const sentences = normalized
      .split(/(?<=[。！？.!?])\s+|[；;]\s+|\n+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 12)
      .slice(0, 3);
    return clip(sentences.join(' '), 260);
  }

  private extractFallbackKeywords(content: string) {
    const candidates = [
      '数据库完整性',
      '实体完整性',
      '参照完整性',
      '用户定义完整性',
      '完整性约束',
      '主键',
      '外键',
      'CREATE TABLE',
      '临时表',
      '永久表',
      '数据类型',
      '默认值',
      'IDENTITY',
      'INSERT',
      'UPDATE',
      'DELETE',
      '表',
      'SQL Server'
    ];
    return candidates.filter((keyword) => content.toLowerCase().includes(keyword.toLowerCase()));
  }

  private localConceptualSummary(fileEvidence: WorkspaceAgentEvidence[]) {
    const joined = fileEvidence.map((item) => item.content || '').join('\n');
    const pieces: string[] = [];
    if (/完整性|约束|主键|外键|PRIMARY KEY|foreign key/i.test(joined)) {
      pieces.push('其中一部分在讲数据库完整性与约束：为什么需要主键、外键、检查条件等规则来保证数据正确、一致，以及插入/更新/删除时如何做违约处理。');
    }
    if (/表|CREATE TABLE|临时表|永久表|数据类型|IDENTITY|DEFAULT/i.test(joined)) {
      pieces.push('另一部分在讲表的创建和列属性：表如何由行列组织，临时表/永久表的区别，常见数据类型，以及默认值、标识列等建表细节。');
    }
    if (/关系模型|实体完整性|参照完整性|用户定义/i.test(joined)) {
      pieces.push('从关系模型角度看，它把完整性分成实体完整性、参照完整性和用户定义完整性，重点是让关系表中的元组、主码和引用关系符合业务语义。');
    }
    if (!pieces.length) {
      pieces.push('这些片段更像是课程讲义的局部内容，当前本地 fallback 只能做粗粒度摘要；完整讲解仍建议让模型合成层恢复后再生成。');
    }
    return pieces.join('\n\n');
  }

  private maybeBuildGoalDraft(state: WorkspaceAgentState): LearningGoalDraft | null {
    if (!['planning', 'personalized_path', 'workspace_action'].includes(state.intent?.kind || '')) return null;
    if (!/计划|规划|学习现场|workbench|路径|路线|目标|创建/.test(state.userInput)) return null;
    return this.buildGoalDraft(state);
  }

  private buildGoalDraft(state: WorkspaceAgentState): LearningGoalDraft {
    const topic = clip(state.userInput, 28).replace(/^(请|帮我|我想|我要|创建|生成|制定)/, '') || state.workspaceSnapshot?.workspace.name || '课程学习';
    const graphEvidence = state.evidence.find((item) => item.kind === 'course_graph');
    const learnerEvidence = state.evidence.find((item) => item.kind === 'learner_context');
    return {
      title: `${topic}计划`.slice(0, 24),
      goalText: state.userInput,
      skills: unique([
        ...tokenize(state.userInput).slice(0, 4),
        graphEvidence ? '关联概念梳理' : '',
        learnerEvidence ? '个性化复习' : ''
      ], 5),
      weaknesses: unique([
        graphEvidence ? '前置知识关系需要确认' : '课程资料依据需要补充',
        learnerEvidence ? '需结合学习画像动态调整' : '个性化依据不足'
      ], 4),
      suggestedMode: /项目|实战|project|workbench/.test(state.userInput) ? 'project' : /复习|review/.test(state.userInput) ? 'review' : 'quick-start'
    };
  }

  private makeToolCall(
    strategy: WorkspaceAgentStrategy,
    success: boolean,
    useful: boolean,
    summary: string,
    startedAt: string,
    evidenceCount: number,
    proposalCount: number,
    error?: string
  ): WorkspaceAgentToolCall {
    return {
      id: crypto.randomUUID(),
      tool: strategy.tool,
      input: {
        query: strategy.query,
        fileIds: strategy.fileIds,
        reason: strategy.reason
      },
      success,
      useful,
      summary,
      error,
      evidenceCount,
      proposalCount,
      startedAt,
      completedAt: nowIso()
    };
  }

  private dedupeEvidence(items: WorkspaceAgentEvidence[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.kind}:${item.title}:${item.source || ''}:${clip(item.summary, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private dedupeProposals(items: WorkspaceAgentProposal[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.type}:${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private mergeIntentContract(base: WorkspaceAgentIntent, parsed: Partial<WorkspaceAgentIntent>): WorkspaceAgentIntent {
    const parsedContext = (parsed.contextNeeds || {}) as Partial<WorkspaceAgentContextNeeds>;
    const parsedRequiredContexts = Array.isArray(parsed.requiredContexts)
      ? parsed.requiredContexts.map((item) => this.validContextTarget(item)).filter(Boolean) as WorkspaceAgentContextTarget[]
      : [];
    const requiredContexts = unique([
      ...base.requiredContexts,
      ...parsedRequiredContexts.filter((target) => this.canPromoteRequiredContext(base, target))
    ], 8) as WorkspaceAgentContextTarget[];
    const parsedCandidateContexts = Array.isArray(parsed.candidateContexts)
      ? parsed.candidateContexts.map((item) => this.validContextTarget(item)).filter(Boolean) as WorkspaceAgentContextTarget[]
      : [];
    const legacyContextTargets = unique([
      parsedContext.workspaceFiles || parsed.requiresWorkspaceFiles ? 'workspace_files' : '',
      parsedContext.courseKnowledge || parsed.requiresKnowledge ? 'course_knowledge' : '',
      parsedContext.courseGraph || parsed.requiresGraph ? 'course_graph' : '',
      parsedContext.learnerProfile || parsed.requiresPersonalization ? 'learner_profile' : '',
      parsedContext.savedMemory ? 'saved_memory' : '',
      parsedContext.conversationHistory ? 'conversation_history' : '',
      parsedContext.externalResources || parsed.requiresExternal ? 'external_resources' : ''
    ], 8) as WorkspaceAgentContextTarget[];
    const candidateContexts = unique([
      ...base.candidateContexts,
      ...parsedRequiredContexts,
      ...parsedCandidateContexts,
      ...legacyContextTargets
    ], 8) as WorkspaceAgentContextTarget[];
    const contextNeeds = contextNeedsFromTargets(unique([...requiredContexts, ...candidateContexts], 8) as WorkspaceAgentContextTarget[]);
    const parsedRoutes = Array.isArray(parsed.routes)
      ? parsed.routes
          .map((route: any) => {
            const source = this.validRouteSource(route?.source);
            if (!source) return null;
            const contextTarget = this.contextTargetForRouteSource(source);
            const required = Boolean(route?.required) && (!contextTarget || this.canPromoteRequiredContext(base, contextTarget));
            const retrievalMode = source === 'workspace_files'
              ? this.validWorkspaceFileRetrievalMode(route?.retrievalMode) || undefined
              : undefined;
            return buildRoute(
              source,
              typeof route?.query === 'string' && route.query.trim() ? route.query : base.summary,
              required,
              typeof route?.reason === 'string' && route.reason.trim() ? route.reason : `LLM routed to ${source}.`,
              Math.max(0.1, Math.min(1, Number(route?.confidence || 0.62))),
              retrievalMode
            );
          })
          .filter(Boolean) as WorkspaceAgentRoute[]
      : [];
    const parsedAction = (parsed.action || {}) as Partial<WorkspaceAgentActionIntent>;
    const actionKinds = unique([
      ...base.action.kinds,
      ...(Array.isArray(parsedAction.kinds) ? parsedAction.kinds.map(String) : []),
      ...(Array.isArray(parsed.mutationKinds) ? parsed.mutationKinds.map(String) : [])
    ], 10);
    const actionRequired = Boolean(base.action.required || parsedAction.required || parsed.requiresMutation);
    const risk = this.maxRisk(base.action.risk, this.validRiskLevel(parsedAction.risk) || (parsed.requiresMutation ? 'medium' : 'low'));
    const parsedPrimary = this.validIntentKind(parsed.primaryIntent) || this.validIntentKind(parsed.kind);
    const primaryIntent = base.hardSignals.explicitMutation && parsedPrimary === 'workspace_action'
      ? base.primaryIntent
      : parsedPrimary || base.primaryIntent;
    const secondaryIntents = unique([
      ...base.secondaryIntents,
      ...(Array.isArray(parsed.secondaryIntents) ? parsed.secondaryIntents.map((item) => this.validIntentKind(item)).filter(Boolean) as IntentKind[] : [])
    ], 8) as IntentKind[];
    const parsedHint = this.validRouteHint(parsed.routeHint);
    let routeHint: WorkspaceAgentRouteHint = actionRequired
      ? 'must_proposal'
      : parsedHint || base.routeHint;
    if (requiredContexts.length && routeHint === 'likely_direct') routeHint = 'likely_contextual';
    const executionMode = executionModeFromRouteHint(routeHint);
    const expectedOutput = this.validExpectedOutput(parsed.expectedOutput) || base.expectedOutput;
    const hardSignals = {
      ...base.hardSignals,
      ...(parsed.hardSignals || {}),
      explicitMutation: base.hardSignals.explicitMutation || Boolean(parsed.hardSignals?.explicitMutation)
    };
    const contextRoutes = uniqueRoutes([
      ...requiredContexts.map((target) => buildRoute(
        routeSourceForContextTarget(target),
        base.summary,
        true,
        `硬约束需要 ${target}。`,
        0.86,
        target === 'workspace_files' ? this.inferWorkspaceRetrievalMode(base.summary, base) : undefined
      )),
      ...candidateContexts
        .filter((target) => !requiredContexts.includes(target))
        .map((target) => buildRoute(
          routeSourceForContextTarget(target),
          base.summary,
          false,
          `候选上下文 ${target} 可能有帮助。`,
          0.6,
          target === 'workspace_files' ? this.inferWorkspaceRetrievalMode(base.summary, base) : undefined
        ))
    ]);
    const actionRoutes = actionRequired
      ? [buildRoute('workspace_action', base.summary, true, '用户请求 workspace 写入或状态变更。', 0.9)]
      : [];
    const planningRoutes = primaryIntent === 'planning' || primaryIntent === 'personalized_path' || secondaryIntents.some((item) => item === 'planning' || item === 'personalized_path')
      ? [buildRoute('planning', base.summary, true, '用户请求学习计划、路径或个性化学习安排，必须等待 planner 产出。', 0.88)]
      : [];
    const directRoutes = routeHint === 'likely_direct' && !requiredContexts.length && !actionRequired
      ? [buildRoute('direct_answer', base.summary, false, '可作为普通问答处理。', 0.7)]
      : [];
    const clarificationRoutes = routeHint === 'likely_clarification'
      ? [buildRoute('clarification', base.summary, true, parsed.clarification?.question || '需要澄清用户意图。', 0.72)]
      : [];
    const routes = uniqueRoutes([
      ...base.routes,
      ...planningRoutes,
      ...parsedRoutes,
      ...contextRoutes,
      ...actionRoutes,
      ...directRoutes,
      ...clarificationRoutes
    ]);
    return {
      ...base,
      ...parsed,
      primaryIntent,
      secondaryIntents,
      routes,
      routeHint,
      requiredContexts,
      candidateContexts,
      executionMode,
      expectedOutput: actionRequired ? 'workspace_proposal' : expectedOutput,
      contextNeeds,
      action: {
        required: actionRequired,
        kinds: actionKinds,
        risk
      },
      groundingPolicy: {
        mustUseWorkspaceEvidence: Boolean(base.groundingPolicy.mustUseWorkspaceEvidence || parsed.groundingPolicy?.mustUseWorkspaceEvidence),
        allowGeneralKnowledge: base.groundingPolicy.mustUseWorkspaceEvidence ? false : parsed.groundingPolicy?.allowGeneralKnowledge ?? base.groundingPolicy.allowGeneralKnowledge
      },
      clarification: {
        needed: Boolean(parsed.clarification?.needed || base.clarification.needed),
        question: parsed.clarification?.question || base.clarification.question
      },
      hardSignals,
      kind: primaryIntent,
      confidence: Math.max(0.45, Math.min(1, Number(parsed.confidence || base.confidence))),
      summary: clip(parsed.summary || base.summary, 220),
      requiresKnowledge: contextNeeds.courseKnowledge,
      requiresGraph: contextNeeds.courseGraph,
      requiresPersonalization: contextNeeds.learnerProfile || contextNeeds.savedMemory,
      requiresWorkspaceFiles: contextNeeds.workspaceFiles,
      requiresExternal: contextNeeds.externalResources,
      requiresMutation: actionRequired,
      mutationKinds: actionKinds
    };
  }

  private validRouteHint(value: unknown): WorkspaceAgentRouteHint | null {
    const allowed: WorkspaceAgentRouteHint[] = ['likely_direct', 'likely_contextual', 'likely_runtime', 'must_proposal', 'likely_clarification'];
    return allowed.includes(value as WorkspaceAgentRouteHint) ? value as WorkspaceAgentRouteHint : null;
  }

  private validContextTarget(value: unknown): WorkspaceAgentContextTarget | null {
    const allowed: WorkspaceAgentContextTarget[] = [
      'workspace_files',
      'course_knowledge',
      'course_graph',
      'learner_profile',
      'saved_memory',
      'conversation_history',
      'external_resources'
    ];
    return allowed.includes(value as WorkspaceAgentContextTarget) ? value as WorkspaceAgentContextTarget : null;
  }

  private validRouteSource(value: unknown): WorkspaceAgentRouteSource | null {
    const allowed: WorkspaceAgentRouteSource[] = [
      'direct_answer',
      'workspace_files',
      'course_knowledge',
      'course_graph',
      'learner_profile',
      'saved_memory',
      'conversation_history',
      'external_resources',
      'planning',
      'workspace_action',
      'clarification'
    ];
    return allowed.includes(value as WorkspaceAgentRouteSource) ? value as WorkspaceAgentRouteSource : null;
  }

  private validWorkspaceFileRetrievalMode(value: unknown): WorkspaceFileRetrievalMode | null {
    const allowed: WorkspaceFileRetrievalMode[] = ['overview', 'targeted_search', 'deep_read'];
    return allowed.includes(value as WorkspaceFileRetrievalMode) ? value as WorkspaceFileRetrievalMode : null;
  }

  private inferWorkspaceRetrievalMode(_query: string, intent: WorkspaceAgentIntent): WorkspaceFileRetrievalMode {
    const requiresWorkspace = intent.requiredContexts.includes('workspace_files') || intent.contextNeeds.workspaceFiles;
    if (requiresWorkspace && intent.expectedOutput === 'summary' && !intent.hardSignals.explicitFileReference) {
      return 'overview';
    }
    if (intent.hardSignals.explicitFileReference && !intent.hardSignals.explicitWorkspaceReference) {
      return 'deep_read';
    }
    return 'targeted_search';
  }

  private contextTargetForRouteSource(source: WorkspaceAgentRouteSource): WorkspaceAgentContextTarget | null {
    if (source === 'workspace_files') return 'workspace_files';
    if (source === 'course_knowledge') return 'course_knowledge';
    if (source === 'course_graph') return 'course_graph';
    if (source === 'learner_profile') return 'learner_profile';
    if (source === 'saved_memory') return 'saved_memory';
    if (source === 'conversation_history') return 'conversation_history';
    if (source === 'external_resources') return 'external_resources';
    return null;
  }

  private canPromoteRequiredContext(base: WorkspaceAgentIntent, target: WorkspaceAgentContextTarget) {
    if (base.requiredContexts.includes(target)) return true;
    if (target === 'workspace_files') return base.hardSignals.explicitFileReference || base.hardSignals.explicitWorkspaceReference;
    if (target === 'course_graph') return base.hardSignals.explicitGraphReference;
    if (target === 'learner_profile') return base.hardSignals.explicitPersonalizationReference;
    if (target === 'saved_memory') return base.hardSignals.explicitMemoryReference;
    if (target === 'external_resources') return base.hardSignals.explicitExternalReference;
    if (target === 'conversation_history') return base.hardSignals.explicitConversationReference;
    return false;
  }

  private validExpectedOutput(value: unknown): WorkspaceAgentExpectedOutput | null {
    const allowed: WorkspaceAgentExpectedOutput[] = ['answer', 'explanation', 'summary', 'plan', 'resource_list', 'graph_explanation', 'workspace_proposal', 'clarifying_question'];
    return allowed.includes(value as WorkspaceAgentExpectedOutput) ? value as WorkspaceAgentExpectedOutput : null;
  }

  private validRiskLevel(value: unknown): WorkspaceAgentRiskLevel | null {
    const allowed: WorkspaceAgentRiskLevel[] = ['low', 'medium', 'high'];
    return allowed.includes(value as WorkspaceAgentRiskLevel) ? value as WorkspaceAgentRiskLevel : null;
  }

  private maxRisk(left: WorkspaceAgentRiskLevel, right: WorkspaceAgentRiskLevel): WorkspaceAgentRiskLevel {
    const rank: Record<WorkspaceAgentRiskLevel, number> = { low: 0, medium: 1, high: 2 };
    return rank[left] >= rank[right] ? left : right;
  }

  private validIntentKind(value: unknown): IntentKind | null {
    const allowed: IntentKind[] = [
      'general_explanation',
      'course_qa',
      'planning',
      'personalized_path',
      'resource_generation',
      'material_search',
      'knowledge_graph',
      'learner_profile',
      'workspace_action'
    ];
    return allowed.includes(value as IntentKind) ? value as IntentKind : null;
  }

  private async lookupWorkspaceUserId(workspaceId: string) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { userId: true } });
    return workspace?.userId || null;
  }

  private async recordStep(state: WorkspaceAgentState, capability: string, input: Record<string, unknown>, output: Record<string, unknown>) {
    if (!state.runId) return;
    const step = await learningRunService.startStep(state.runId, capability, input).catch(() => null);
    if (!step) return;
    await learningRunService.completeStep(step.id, output).catch(() => undefined);
  }
}

export const workspaceAgentRuntime = new WorkspaceAgentRuntime();
