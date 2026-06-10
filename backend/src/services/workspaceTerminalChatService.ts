import fs from 'fs/promises';
import prisma from '../config/db';
import { aiModelProviderService } from './aiModelProviderService';
import { conversationHistoryService } from './conversationHistoryService';
import { FileSystemService } from './fileSystemService';
import { documentTextExtractionService } from './documentTextExtractionService';
import { knowledgeSearchService, KnowledgeSearchResult } from './knowledgeSearchService';
import { ChatSessionAttachmentContext } from '../types/contextSystem';
import { LocalStorageService } from './storage/localStorageService';

type TerminalMessage = {
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

interface WorkspaceTerminalChatInput {
  workspaceId: string;
  sessionId?: string | null;
  workbenchId?: string | null;
  messages: TerminalMessage[];
  selectedSources?: Array<{
    fileId: string;
    mode?: 'focused' | 'full_context';
  }>;
  selectedSourceIds?: string[];
  chatFiles?: TerminalChatFileRef[];
}

type EvidenceCard = {
  id: string;
  fileId: string;
  fileName: string;
  label: string;
  content: string;
  summary: string;
  score: number;
  metadata: Record<string, unknown>;
};

type TerminalConversationContext = {
  olderDigest: string;
  recentMessages: TerminalMessage[];
  relevantHistory: Awaited<ReturnType<typeof conversationHistoryService.retrieve>>;
  stats: {
    originalMessageCount: number;
    olderMessageCount: number;
    recentMessageCount: number;
    relevantHistoryCount: number;
    recentMessageTokens: number;
    olderDigestTokens: number;
  };
};

type SourceRetrievalMode = 'focused' | 'full_context';

type SelectedSource = {
  fileId: string;
  mode: SourceRetrievalMode;
};

type TerminalContextFile = {
  id: string;
  name: string;
  path: string;
  content?: string | null;
  storageKey?: string | null;
  isBinary?: boolean | null;
  extension?: string | null;
  mimeType?: string | null;
  scope?: string | null;
};

type TerminalContextItem = {
  id: string;
  type: 'file' | 'text' | 'collection';
  name: string;
  context?: 'full';
  fileObjectId?: string;
  collectionNames?: string[];
  sourceScope?: 'workspace' | 'chat';
  file?: TerminalContextFile & {
    data?: {
      content?: string;
      metadata?: Record<string, unknown>;
    };
  };
};

type ChatAttachmentContextBundle = {
  fileIds: string[];
  files: Array<{
    id: string;
    name: string;
    path: string;
    content: string | null;
    storageKey: string | null;
    isBinary: boolean | null;
    extension: string | null;
    mimeType: string | null;
    size: number | null;
    createdAt: Date;
  }>;
  evidence: EvidenceCard[];
  attachments: ChatSessionAttachmentContext[];
};

type WorkspaceTerminalChatResult = {
  reply: string;
  sessionId?: string;
  status: 'completed';
  evidence: ReturnType<typeof toTerminalEvidence>;
  suggestedActions: never[];
  followUps: string[];
  memoryContext: { askUserToSave: null };
  model?: string;
  provider?: string;
};

type TerminalStatus = {
  action: string;
  description?: string;
  done: boolean;
  hidden?: boolean;
  query?: string;
  queries?: string[];
  count?: number;
};

type TerminalChatStreamEvent =
  | { type: 'status'; status: TerminalStatus }
  | { type: 'delta'; delta: string }
  | { type: 'final'; result: WorkspaceTerminalChatResult };

type PreparedTerminalChat =
  | {
      kind: 'static';
      userId: string;
      messages: TerminalMessage[];
      reply: string;
      evidence: EvidenceCard[];
      attachments: ChatSessionAttachmentContext[];
    }
  | {
      kind: 'model';
      userId: string;
      messages: TerminalMessage[];
      prompt: string;
      evidence: EvidenceCard[];
      attachments: ChatSessionAttachmentContext[];
    };

const MAX_SELECTED_SOURCES = 12;
const MAX_EVIDENCE_CARDS = 7;
const FOCUSED_RETRIEVAL_PER_QUERY_LIMIT = 12;
const FOCUSED_RETRIEVAL_CHAR_BUDGET = 11000;
const FULL_CONTEXT_CHAR_LIMIT = 28000;
const TERMINAL_RECENT_HISTORY_TOKEN_BUDGET = Number(process.env.AI_TERMINAL_RECENT_HISTORY_TOKEN_BUDGET || 32000);
const TERMINAL_OLDER_DIGEST_TOKEN_BUDGET = Number(process.env.AI_TERMINAL_OLDER_DIGEST_TOKEN_BUDGET || 8000);
const TERMINAL_RELEVANT_HISTORY_LIMIT = Number(process.env.AI_TERMINAL_RELEVANT_HISTORY_LIMIT || 8);
const TERMINAL_ENABLE_SEMANTIC_HISTORY = process.env.AI_TERMINAL_ENABLE_SEMANTIC_HISTORY === 'true';

const clip = (value: string | null | undefined, maxLength = 1800) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n[truncated]` : text;
};

const estimateTokens = (value: string | null | undefined) => Math.ceil(String(value || '').length / 4);

const latestUserMessage = (messages: TerminalMessage[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

const normalizeMessages = (messages: unknown): TerminalMessage[] =>
  Array.isArray(messages)
    ? messages
        .map((message) => ({
          role: message?.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: String(message?.content || '').trim(),
          files: normalizeChatFiles(message?.files)
        }))
        .filter((message) => message.content)
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

const chatFileIdsFromInput = (input: WorkspaceTerminalChatInput) =>
  uniqueUnbounded([
    ...normalizeChatFiles(input.chatFiles).map((file) => file.id),
    ...normalizeMessages(input.messages).flatMap((message) => normalizeChatFiles(message.files).map((file) => file.id))
  ]).slice(0, 24);

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

const uniqueUnbounded = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const normalizeSelectedSources = (input: WorkspaceTerminalChatInput): SelectedSource[] => {
  const map = new Map<string, SourceRetrievalMode>();
  (input.selectedSourceIds || []).filter(Boolean).slice(0, MAX_SELECTED_SOURCES).forEach((fileId) => {
    map.set(fileId, 'focused');
  });
  (input.selectedSources || []).forEach((item) => {
    if (!item?.fileId) return;
    map.set(item.fileId, item.mode === 'full_context' ? 'full_context' : 'focused');
  });
  return Array.from(map.entries()).map(([fileId, mode]) => ({ fileId, mode }));
};

const isVagueWorkspaceQuestion = (query: string) =>
  /^(讲讲|说说|分析一下|总结一下|帮我看看|这个|这些|它|继续|展开|详细说说|再说说)[。！？!?\s]*$/i.test(query.trim());

const asksForWorkspaceEvidence = (query: string) =>
  /根据|结合|资料|材料|文件|source|sources|workspace|知识库|课程资料|当前课程|这门课|上传|文档|讲义|课件|视频|pdf|已有内容|我这里/i.test(query);

const normalizeContentKey = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 700);

const lexicalTerms = (value: string) =>
  uniqueUnbounded(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  ).slice(0, 24);

const sourceTitleTerms = (files: Array<{ name: string; path: string }>) =>
  uniqueUnbounded(files.flatMap((file) => lexicalTerms(`${file.name} ${file.path}`))).slice(0, 16);

const recentUserTurns = (messages: TerminalMessage[]) =>
  messages
    .slice(0, -1)
    .filter((message) => message.role === 'user')
    .slice(-2)
    .map((message) => clip(message.content, 500));

const packRecentMessages = (messages: TerminalMessage[], tokenBudget = TERMINAL_RECENT_HISTORY_TOKEN_BUDGET) => {
  const previousMessages = messages.slice(0, -1);
  const kept: TerminalMessage[] = [];
  let used = 0;

  for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
    const message = previousMessages[index];
    const content = clip(message.content, 5000);
    const estimated = estimateTokens(content) + 16;
    if (kept.length > 0 && used + estimated > tokenBudget) break;
    kept.unshift({ role: message.role, content });
    used += estimated;
  }

  return {
    recentMessages: kept,
    olderMessages: previousMessages.slice(0, Math.max(0, previousMessages.length - kept.length)),
    usedTokens: used
  };
};

const summarizeOlderMessages = (messages: TerminalMessage[], tokenBudget = TERMINAL_OLDER_DIGEST_TOKEN_BUDGET) => {
  if (!messages.length) return '';

  const firstUser = messages.find((message) => message.role === 'user')?.content || '';
  const lastUserTurns = messages
    .filter((message) => message.role === 'user')
    .slice(-6)
    .map((message) => clip(message.content, 700));
  const lastAssistantTurns = messages
    .filter((message) => message.role === 'assistant')
    .slice(-4)
    .map((message) => clip(message.content, 650));
  const exchangeDigest = messages
    .slice(-12)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${clip(message.content, 520)}`)
    .join('\n');

  return clip(
    [
      `Older conversation digest (${messages.length} messages compressed before the recent window).`,
      firstUser ? `Initial user intent:\n${clip(firstUser, 900)}` : '',
      lastUserTurns.length ? `Important older user turns:\n${lastUserTurns.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
      lastAssistantTurns.length ? `Recent older assistant commitments:\n${lastAssistantTurns.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
      exchangeDigest ? `Last older exchanges before the recent window:\n${exchangeDigest}` : ''
    ].filter(Boolean).join('\n\n'),
    tokenBudget * 4
  );
};

const buildHistoryRetrievalQuery = (query: string, messages: TerminalMessage[]) =>
  clip(
    [
      query,
      ...recentUserTurns(messages).map((turn) => `Recent user context: ${turn}`)
    ].join('\n'),
    1600
  );

const isFollowUpQuery = (query: string) =>
  /继续|展开|详细|再说|这个|这些|它|他们|上面|刚才|前面|具体|举例|思路|怎么理解|more|continue|why|how/i.test(query.trim()) ||
  query.trim().length <= 12;

const buildFocusedQueryVariants = (query: string, messages: TerminalMessage[], files: Array<{ name: string; path: string }>) => {
  const variants = [query.trim()];
  const recentUsers = recentUserTurns(messages);
  const followUp = isFollowUpQuery(query);
  if (followUp && recentUsers.length) {
    variants.push(`${recentUsers[recentUsers.length - 1]}\n${query}`);
  }
  if (followUp && recentUsers.length > 1) {
    variants.push(`${recentUsers.join('\n')}\n${query}`);
  }

  const titles = files
    .map((file) => file.name || file.path)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  if (titles && (followUp || query.length <= 36)) {
    variants.push(`${query}\nScope: ${titles}`);
  }

  return uniqueUnbounded(variants.map((variant) => clip(variant, 1200))).slice(0, 3);
};

const retrievalSignal = (item: KnowledgeSearchResult, queryTerms: string[], titleTerms: string[]) => {
  const matched = new Set((item.matchedTerms || []).map((term) => term.toLowerCase()));
  const queryHits = queryTerms.filter((term) => matched.has(term)).length;
  const titleHits = titleTerms.filter((term) => matched.has(term)).length;
  const breakdown = item.scoreBreakdown;
  const directScore =
    (breakdown.phrase || 0) +
    (breakdown.lexical || 0) +
    (breakdown.semantic || 0) +
    (breakdown.vector || 0) +
    (breakdown.rerank || 0);
  return {
    queryHits,
    titleHits,
    directScore,
    hasHardSignal: queryHits > 0 || titleHits > 0 || breakdown.phrase > 0 || breakdown.rerank > 0 || breakdown.vector > 8
  };
};

const shouldKeepFocusedResult = (
  item: KnowledgeSearchResult,
  bestScore: number,
  queryTerms: string[],
  titleTerms: string[],
  sourceLocked: boolean
) => {
  const signal = retrievalSignal(item, queryTerms, titleTerms);
  if (signal.hasHardSignal) return true;
  if (item.score >= Math.max(8, bestScore * (sourceLocked ? 0.32 : 0.42))) return true;
  if (!sourceLocked && signal.directScore >= 10) return true;
  return false;
};

const mergeFocusedResults = (
  searches: Array<{ variant: string; weight: number; results: KnowledgeSearchResult[] }>,
  query: string,
  files: Array<{ name: string; path: string }>,
  sourceLocked: boolean
) => {
  const queryTerms = lexicalTerms(query);
  const titleTerms = sourceTitleTerms(files);
  const bestScore = Math.max(0, ...searches.flatMap((search) => search.results.map((item) => item.score)));
  const merged = new Map<string, KnowledgeSearchResult & { aggregateScore: number; queryVariants: string[]; hitCount: number }>();

  searches.forEach((search, searchIndex) => {
    search.results.forEach((item, rankIndex) => {
      if (!shouldKeepFocusedResult(item, bestScore, queryTerms, titleTerms, sourceLocked)) return;
      const key = item.chunkId || `${item.fileObjectId}:${normalizeContentKey(item.chunkText)}`;
      const rankBoost = Math.max(0, 7 - rankIndex) * 0.7;
      const signal = retrievalSignal(item, queryTerms, titleTerms);
      const aggregateScore =
        item.score * search.weight +
        rankBoost +
        signal.queryHits * 2.4 +
        signal.titleHits * 1.2 +
        (searchIndex === 0 ? 2 : 0);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...item,
          score: aggregateScore,
          aggregateScore,
          queryVariants: [search.variant],
          hitCount: 1,
          retrievalReason: item.retrievalReason
        });
        return;
      }

      existing.aggregateScore += aggregateScore * 0.72;
      existing.score = Math.max(existing.score, item.score) + aggregateScore * 0.16;
      existing.hitCount += 1;
      existing.queryVariants = uniqueUnbounded([...existing.queryVariants, search.variant]).slice(0, 3);
      existing.matchedTerms = uniqueUnbounded([...(existing.matchedTerms || []), ...(item.matchedTerms || [])]).slice(0, 16);
      existing.retrievalReason = uniqueUnbounded([existing.retrievalReason, item.retrievalReason]).join('；');
      existing.scoreBreakdown = {
        ...existing.scoreBreakdown,
        lexical: Math.max(existing.scoreBreakdown.lexical, item.scoreBreakdown.lexical),
        phrase: Math.max(existing.scoreBreakdown.phrase, item.scoreBreakdown.phrase),
        semantic: Math.max(existing.scoreBreakdown.semantic, item.scoreBreakdown.semantic),
        vector: Math.max(existing.scoreBreakdown.vector, item.scoreBreakdown.vector),
        rerank: Math.max(existing.scoreBreakdown.rerank, item.scoreBreakdown.rerank),
        recency: Math.max(existing.scoreBreakdown.recency, item.scoreBreakdown.recency),
        fileBoost: Math.max(existing.scoreBreakdown.fileBoost, item.scoreBreakdown.fileBoost),
        diversityPenalty: Math.min(existing.scoreBreakdown.diversityPenalty, item.scoreBreakdown.diversityPenalty)
      };
    });
  });

  return Array.from(merged.values())
    .map((item) => ({
      ...item,
      score: Number((item.aggregateScore + item.hitCount * 3).toFixed(3))
    }))
    .sort((left, right) => right.score - left.score);
};

const packFocusedEvidence = (items: KnowledgeSearchResult[]): KnowledgeSearchResult[] => {
  const packed: KnowledgeSearchResult[] = [];
  const perFile = new Map<string, number>();
  const contentKeys = new Set<string>();
  let usedChars = 0;

  for (const item of items) {
    if (packed.length >= MAX_EVIDENCE_CARDS) break;
    const key = normalizeContentKey(item.chunkText);
    if (!key || contentKeys.has(key)) continue;
    const currentFileCount = perFile.get(item.fileObjectId) || 0;
    const allowSameFile = packed.length < 3 || currentFileCount < 3;
    if (!allowSameFile && items.some((candidate) => candidate.fileObjectId !== item.fileObjectId)) continue;
    const nextLength = Math.min(item.chunkText.length, 1900);
    if (packed.length >= 3 && usedChars + nextLength > FOCUSED_RETRIEVAL_CHAR_BUDGET) continue;
    packed.push(item);
    contentKeys.add(key);
    perFile.set(item.fileObjectId, currentFileCount + 1);
    usedChars += nextLength;
  }

  return packed;
};

const evidenceFromSearch = (items: KnowledgeSearchResult[]): EvidenceCard[] => {
  const grouped = new Map<string, {
    fileId: string;
    fileName: string;
    path?: string;
    score: number;
    rank: number;
    snippets: Array<{
      text: string;
      summary: string;
      score: number;
      matchedTerms?: string[];
      retrievalReason?: string;
      scoreBreakdown?: KnowledgeSearchResult['scoreBreakdown'];
      supportSnippets?: KnowledgeSearchResult['supportSnippets'];
      citationQuality?: KnowledgeSearchResult['citationQuality'];
      locator?: unknown;
      queryVariants?: string[];
      hitCount?: number;
    }>;
  }>();

  packFocusedEvidence(items).forEach((item) => {
    const existing = grouped.get(item.fileObjectId);
    const snippet = {
      text: clip(item.chunkText, 1900),
      summary: clip(item.summary || item.retrievalReason || item.chunkText, 360),
      score: item.score,
      matchedTerms: item.matchedTerms,
      retrievalReason: item.retrievalReason,
      scoreBreakdown: item.scoreBreakdown,
      supportSnippets: item.supportSnippets,
      citationQuality: item.citationQuality,
      locator: item.metadata?.locator || item.metadata,
      queryVariants: (item as KnowledgeSearchResult & { queryVariants?: string[] }).queryVariants,
      hitCount: (item as KnowledgeSearchResult & { hitCount?: number }).hitCount
    };

    if (!existing) {
      grouped.set(item.fileObjectId, {
        fileId: item.fileObjectId,
        fileName: item.fileName || 'Untitled',
        path: item.path,
        score: item.score,
        rank: item.rank,
        snippets: [snippet]
      });
      return;
    }

    existing.score = Math.max(existing.score, item.score);
    existing.rank = Math.min(existing.rank, item.rank);
    if (existing.snippets.length < 5) existing.snippets.push(snippet);
  });

  return Array.from(grouped.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_EVIDENCE_CARDS)
    .map((item, index) => ({
      id: `${index + 1}`,
      fileId: item.fileId,
      fileName: item.fileName,
      label: `[${index + 1}] ${item.fileName}`,
      content: item.snippets.map((snippet, snippetIndex) => `Content ${snippetIndex + 1}\n${snippet.text}`).join('\n\n'),
      summary: item.snippets.map((snippet) => snippet.summary).filter(Boolean).slice(0, 2).join('\n\n') || item.snippets[0]?.text || '',
      score: item.score,
      metadata: {
        path: item.path,
        rank: item.rank,
        retrievalMode: 'focused',
        retrievalPipeline: 'hybrid_multi_query_bm25_vector_rerank',
        chunkCount: item.snippets.length,
        supportSnippets: item.snippets.map((snippet, snippetIndex) => ({
          text: snippet.text,
          score: snippet.score,
          title: `Content ${snippetIndex + 1}`,
          matchedTerms: snippet.matchedTerms,
          retrievalReason: snippet.retrievalReason,
          scoreBreakdown: snippet.scoreBreakdown,
          supportSnippets: snippet.supportSnippets,
          citationQuality: snippet.citationQuality,
          locator: snippet.locator,
          queryVariants: snippet.queryVariants,
          hitCount: snippet.hitCount
        }))
      }
    }));
};

const fullContextEvidence = (files: Array<{ id: string; name: string; path: string; content: string | null }>): EvidenceCard[] =>
  files
    .filter((file) => file.content && file.content.trim().length > 0)
    .slice(0, MAX_EVIDENCE_CARDS)
    .map((file, index) => ({
      id: `${index + 1}`,
      fileId: file.id,
      fileName: file.name,
      label: `[${index + 1}] ${file.name}`,
      content: clip(file.content, FULL_CONTEXT_CHAR_LIMIT),
      summary: clip(file.content, 360),
      score: 1,
      metadata: {
        path: file.path,
        retrievalMode: 'full_context'
      }
    }));

const buildPrompt = (input: {
  workspaceName: string;
  query: string;
  conversationContext: TerminalConversationContext;
  fullContextDocs: EvidenceCard[];
  focusedEvidence: EvidenceCard[];
  sourceLocked: boolean;
  scopeLabel: string;
}) => {
  const recent = input.conversationContext.recentMessages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${clip(message.content, 900)}`)
    .join('\n');
  const relevantHistory = input.conversationContext.relevantHistory.length
    ? input.conversationContext.relevantHistory
        .map((item, index) => {
          const mode = item.retrievalMode ? `, ${item.retrievalMode}` : '';
          return `[H${index + 1}] ${item.role}${mode}, ${item.createdAt}: ${clip(item.summary || item.content, 700)}`;
        })
        .join('\n')
    : 'No relevant past chat history retrieved.';
  const fullContextBlock = input.fullContextDocs.length
    ? input.fullContextDocs.map((item) => `${item.label}\n${item.content}`).join('\n\n')
    : 'No full-context documents selected.';
  const focusedItems = input.focusedEvidence.filter((item) => item.metadata.retrievalMode !== 'chat_attachment');
  const focusedBlock = focusedItems.length
    ? focusedItems.map((item) => `${item.label} score=${item.score}\n${item.content}`).join('\n\n')
    : 'No focused retrieval evidence cards were retrieved for this turn.';

  return [
    'The following is context for answering the user request.',
    'Use citations when evidence cards or full-context documents are provided.',
    '',
    `Workspace: ${input.workspaceName}`,
    `Context scope: ${input.scopeLabel}${input.sourceLocked ? ' (locked by user)' : ''}`,
    `Context packing: recent=${input.conversationContext.stats.recentMessageCount}/${input.conversationContext.stats.originalMessageCount - 1} previous messages, olderCompressed=${input.conversationContext.stats.olderMessageCount}, relevantHistory=${input.conversationContext.stats.relevantHistoryCount}.`,
    '',
    'Conversation continuity:',
    input.conversationContext.olderDigest || 'No older conversation digest.',
    '',
    recent ? `Recent conversation window:\n${recent}` : 'Recent conversation window: none',
    '',
    'Relevant past chat history:',
    relevantHistory,
    '',
    'Chat attachments:',
    input.focusedEvidence.some((item) => item.metadata.retrievalMode === 'chat_attachment')
      ? input.focusedEvidence
          .filter((item) => item.metadata.retrievalMode === 'chat_attachment')
          .map((item) => `${item.label}\n${item.content}`)
          .join('\n\n')
      : 'No text-readable chat attachments.',
    '',
    'Full context documents:',
    fullContextBlock,
    '',
    'Focused retrieval evidence cards:',
    focusedBlock,
    '',
    `User request:\n${input.query}`
  ].join('\n');
};

const toTerminalEvidence = (items: EvidenceCard[]) =>
  items.map((item) => ({
    id: item.id,
    kind: item.metadata?.retrievalMode === 'chat_attachment' ? 'chat_attachment' : 'workspace_source',
    title: item.fileName,
    summary: item.summary,
    content: item.content,
    source: item.label,
    score: item.score,
    metadata: item.metadata
  }));

const reindexEvidenceCards = (items: EvidenceCard[]): EvidenceCard[] =>
  items.map((item, index) => ({
    ...item,
    id: `${index + 1}`,
    label: `[${index + 1}] ${item.fileName}`,
    metadata: {
      ...item.metadata,
      citationIndex: index + 1
    }
  }));

const FOLLOW_UP_GENERATION_PROMPT_TEMPLATE = `### Task:
Suggest 3-5 relevant follow-up questions or prompts that the user might naturally ask next in this conversation as a **user**, based on the chat history, to help continue or deepen the discussion.
### Guidelines:
- Write all follow-up questions from the user's point of view, directed to the assistant.
- Make questions concise, clear, and directly related to the discussed topic(s).
- Only suggest follow-ups that make sense given the chat content and do not repeat what was already covered.
- If the conversation is very short or not specific, suggest more general (but relevant) follow-ups the user might ask.
- Use the conversation's primary language; default to English if multilingual.
- Response must be a JSON object with a "follow_ups" key containing an array of strings, no extra text or formatting.
### Output:
JSON format: { "follow_ups": ["Question 1?", "Question 2?", "Question 3?"] }
### Chat History:
<chat_history>
{{MESSAGES:END:6}}
</chat_history>`;

const formatFollowUpMessages = (messages: TerminalMessage[], assistantReply: string) =>
  [...messages, { role: 'assistant' as const, content: assistantReply }]
    .slice(-6)
    .map((message) => `${message.role}: ${clip(message.content, 1800)}`)
    .join('\n\n');

const extractJsonObject = (value: string) => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
};

const normalizeFollowUps = (value: unknown) =>
  uniqueUnbounded(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter((item) => item.length > 0 && item.length <= 180)
  ).slice(0, 5);

const terminalChatModelOptions = {
  useCase: 'chat' as const,
  timeoutMs: Number(process.env.AI_TERMINAL_CHAT_TIMEOUT_MS || 120000),
  systemPrompt: 'Use citations when evidence cards or full-context documents are provided.'
};

class WorkspaceTerminalChatService {
  async chat(input: WorkspaceTerminalChatInput): Promise<WorkspaceTerminalChatResult> {
    const prepared = await this.prepareChat(input);
    if (prepared.kind === 'static') {
      return this.withSavedTurn(input, prepared.userId, prepared.messages, {
        reply: prepared.reply,
        evidence: prepared.evidence,
        status: 'completed' as const
      });
    }

    const result = await aiModelProviderService.chat(
      [{ role: 'user', content: prepared.prompt }],
      { ...terminalChatModelOptions, attachments: prepared.attachments }
    );

    return this.withSavedTurn(input, prepared.userId, prepared.messages, {
      reply: result.reply,
      evidence: prepared.evidence,
      status: 'completed' as const,
      model: result.model,
      provider: result.provider
    });
  }

  async *chatStream(input: WorkspaceTerminalChatInput): AsyncGenerator<TerminalChatStreamEvent> {
    const messages = normalizeMessages(input.messages);
    const query = latestUserMessage(messages);
    yield {
      type: 'status',
      status: {
        action: 'preparing_context',
        description: 'Preparing context',
        done: false
      }
    };
    if (query) {
      yield {
        type: 'status',
        status: {
          action: 'queries_generated',
          queries: [query],
          done: false
        }
      };
      yield {
        type: 'status',
        status: {
          action: 'knowledge_search',
          query,
          done: false
        }
      };
    }

    const prepared = await this.prepareChat(input);
    yield {
      type: 'status',
      status: {
        action: 'sources_retrieved',
        count: prepared.evidence.length,
        done: true
      }
    };

    if (prepared.kind === 'static') {
      yield { type: 'delta', delta: prepared.reply };
      const result = await this.withSavedTurn(input, prepared.userId, prepared.messages, {
        reply: prepared.reply,
        evidence: prepared.evidence,
        status: 'completed' as const
      });
      yield { type: 'final', result };
      return;
    }

    let reply = '';
    const provider = aiModelProviderService.provider(terminalChatModelOptions);
    const model = aiModelProviderService.model(provider, undefined, terminalChatModelOptions.useCase);
    yield {
      type: 'status',
      status: {
        action: 'thinking',
        description: 'Thinking',
        done: false
      }
    };

    for await (const delta of aiModelProviderService.chatStream(
      [{ role: 'user', content: prepared.prompt }],
      { ...terminalChatModelOptions, attachments: prepared.attachments }
    )) {
      reply += delta;
      yield { type: 'delta', delta };
    }

    if (!reply.trim()) {
      throw new Error('AI provider returned an empty response');
    }

    const result = await this.withSavedTurn(input, prepared.userId, prepared.messages, {
      reply,
      evidence: prepared.evidence,
      status: 'completed' as const,
      model,
      provider
    });
    yield { type: 'final', result };
  }

  private async prepareChat(input: WorkspaceTerminalChatInput): Promise<PreparedTerminalChat> {
    const messages = normalizeMessages(input.messages);
    const query = latestUserMessage(messages);
    if (!query) throw new Error('A user message is required');

    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { id: true, name: true, userId: true }
    });
    if (!workspace) throw new Error('Workspace not found');

    const selectedSources = normalizeSelectedSources(input);
    const chatAttachments = await this.loadChatAttachmentContext(input);
    const sourceLocked = selectedSources.length > 0;
    const shouldRetrieveWorkspaceEvidence =
      sourceLocked ||
      chatAttachments.fileIds.length > 0 ||
      asksForWorkspaceEvidence(query) ||
      isVagueWorkspaceQuestion(query);
    const contextItems = shouldRetrieveWorkspaceEvidence
      ? await this.buildOpenWebUiContextItems({
          workspaceId: input.workspaceId,
          selectedSources,
          chatAttachments,
          includeWorkspaceFiles: !sourceLocked
        })
      : [];
    const selectedFiles = contextItems
      .filter((item) => selectedSources.some((source) => source.fileId === item.id))
      .map((item) => item.file)
      .filter((file): file is TerminalContextFile => Boolean(file));
    const itemSources = shouldRetrieveWorkspaceEvidence
      ? await this.getSourcesFromOpenWebUiItems({
          workspaceId: input.workspaceId,
          query,
          messages,
          items: contextItems,
          sourceLocked
        })
      : [];
    const evidence = reindexEvidenceCards(itemSources);

    const scopeLabel = sourceLocked
      ? selectedFiles.length
        ? selectedFiles.map((file) => {
            const mode = selectedSources.find((item) => item.fileId === file.id)?.mode || 'focused';
            return `${file.name}${mode === 'full_context' ? ' (full context)' : ''}`;
          }).join(', ')
        : 'selected sources'
      : chatAttachments.fileIds.length
        ? 'current chat attachments + current workspace sources'
        : 'current workspace sources';

    if (isVagueWorkspaceQuestion(query) && !evidence.length && !chatAttachments.attachments.length) {
      return {
        kind: 'static',
        userId: workspace.userId,
        messages,
        reply: '你想让我围绕哪个主题或哪份 source 展开？可以先锁定一个文件，或者把问题具体到章节、概念、作业要求。当前问题太泛，我不想凭空猜。',
        evidence: [],
        attachments: chatAttachments.attachments
      };
    }

    if ((sourceLocked || asksForWorkspaceEvidence(query)) && !evidence.length && !chatAttachments.attachments.length) {
      const reply = sourceLocked
        ? '我没有在已锁定的 source 中找到可引用的内容。你可以换一个 source、切换成 Full Context、上传/索引相关资料，或者把问题改成通用知识问题。'
        : '我没有在当前 workspace sources 中找到足够依据来回答这个问题。你可以锁定具体 source、补充资料，或改成不依赖资料的通用问题。';
      return {
        kind: 'static',
        userId: workspace.userId,
        messages,
        reply,
        evidence: [],
        attachments: chatAttachments.attachments
      };
    }

    const conversationContext = await this.buildConversationContext({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      sessionId: input.sessionId || null,
      userId: workspace.userId,
      messages,
      query
    });

    const prompt = buildPrompt({
      workspaceName: workspace.name,
      query,
      conversationContext,
      fullContextDocs: evidence.filter((item) => item.metadata.retrievalMode === 'full_context'),
      focusedEvidence: evidence.filter((item) => item.metadata.retrievalMode !== 'full_context'),
      sourceLocked,
      scopeLabel
    });

    return {
      kind: 'model',
      userId: workspace.userId,
      messages,
      prompt,
      evidence,
      attachments: chatAttachments.attachments
    };
  }

  private async loadChatAttachmentContext(input: WorkspaceTerminalChatInput): Promise<ChatAttachmentContextBundle> {
    const fileIds = chatFileIdsFromInput(input);
    if (!fileIds.length) return { fileIds: [], files: [], evidence: [], attachments: [] };

    const expectedSessionId = input.sessionId || '';
    const expectedChatId = chatIdFromSessionId(input.workspaceId, expectedSessionId);
    const rows = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId: input.workspaceId,
        nodeType: 'file',
        scope: 'chat',
        id: { in: fileIds }
      },
      select: {
        id: true,
        name: true,
        path: true,
        content: true,
        storageKey: true,
        isBinary: true,
        extension: true,
        mimeType: true,
        size: true,
        metadataJson: true,
        createdAt: true
      }
    });

    const allowedRows = rows.filter((file) => {
      if (!expectedSessionId && !expectedChatId) return true;
      const metadata = parseMetadataJson(file.metadataJson);
      return metadata.sessionId === expectedSessionId || (expectedChatId && metadata.chatId === expectedChatId);
    });

    const orderedRows = fileIds
      .map((id) => allowedRows.find((file) => file.id === id))
      .filter((file): file is NonNullable<typeof file> => Boolean(file));
    const evidence: EvidenceCard[] = [];
    const attachments: ChatSessionAttachmentContext[] = [];

    for (const file of orderedRows) {
      const kind = attachmentKind(file);
      const text = kind === 'image'
        ? ''
        : await this.loadFileText(input.workspaceId, file).catch(() => '');
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

      if (textContent) {
        evidence.push({
          id: `${evidence.length + 1}`,
          fileId: file.id,
          fileName: file.name,
          label: `[${evidence.length + 1}] ${file.name}`,
          content: clip(textContent, 2400),
          summary: clip(textContent, 420),
          score: 1,
          metadata: {
            path: file.path,
            retrievalMode: 'chat_attachment',
            sourceScope: 'chat',
            fileObjectId: file.id
          }
        });
      }
    }

    return {
      fileIds: orderedRows.map((file) => file.id),
      files: orderedRows,
      evidence,
      attachments
    };
  }

  private async buildConversationContext(input: {
    workspaceId: string;
    workbenchId?: string | null;
    sessionId?: string | null;
    userId: string;
    messages: TerminalMessage[];
    query: string;
  }): Promise<TerminalConversationContext> {
    const packed = packRecentMessages(input.messages);
    const olderDigest = summarizeOlderMessages(packed.olderMessages);
    const relevantHistory = TERMINAL_ENABLE_SEMANTIC_HISTORY
      ? await conversationHistoryService.retrieve({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          userId: input.userId,
          source: 'terminal_chat',
          query: buildHistoryRetrievalQuery(input.query, input.messages),
          currentSessionId: input.sessionId || null,
          limit: TERMINAL_RELEVANT_HISTORY_LIMIT
        }).catch(() => [])
      : [];

    return {
      olderDigest,
      recentMessages: packed.recentMessages,
      relevantHistory,
      stats: {
        originalMessageCount: input.messages.length,
        olderMessageCount: packed.olderMessages.length,
        recentMessageCount: packed.recentMessages.length,
        relevantHistoryCount: relevantHistory.length,
        recentMessageTokens: packed.usedTokens,
        olderDigestTokens: estimateTokens(olderDigest)
      }
    };
  }

  private async loadFileText(workspaceId: string, file: { id: string; name: string; path: string; content?: string | null; storageKey?: string | null; isBinary?: boolean | null; extension?: string | null; mimeType?: string | null }) {
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

  private async buildOpenWebUiContextItems(input: {
    workspaceId: string;
    selectedSources: SelectedSource[];
    chatAttachments: ChatAttachmentContextBundle;
    includeWorkspaceFiles?: boolean;
  }): Promise<TerminalContextItem[]> {
    const selectedFileIds = input.selectedSources.map((item) => item.fileId);
    const workspaceFiles = input.includeWorkspaceFiles || selectedFileIds.length
      ? await prisma.fileSystemObject.findMany({
          where: {
            workspaceId: input.workspaceId,
            nodeType: 'file',
            scope: { not: 'chat' },
            ...(input.includeWorkspaceFiles ? {} : { id: { in: selectedFileIds } })
          },
          select: {
            id: true,
            name: true,
            path: true,
            content: true,
            storageKey: true,
            isBinary: true,
            extension: true,
            mimeType: true,
            scope: true
          },
          orderBy: { updatedAt: 'desc' }
        })
      : [];

    const selectedModeById = new Map(input.selectedSources.map((item) => [item.fileId, item.mode] as const));
    const toFileItem = (file: TerminalContextFile, sourceScope: 'workspace' | 'chat'): TerminalContextItem => ({
      id: file.id,
      type: 'file',
      name: file.name,
      fileObjectId: file.id,
      sourceScope,
      context: selectedModeById.get(file.id) === 'full_context' ? 'full' : undefined,
      file
    });

    const merged = new Map<string, TerminalContextItem>();
    const put = (item: TerminalContextItem) => {
      const key = `${item.type}:${item.id}`;
      const existing = merged.get(key);
      if (!existing || item.context === 'full' || existing.sourceScope !== 'chat') {
        merged.set(key, item);
      }
    };

    workspaceFiles.forEach((file) => put(toFileItem(file, 'workspace')));
    input.chatAttachments.files.forEach((file) => put(toFileItem({ ...file, scope: 'chat' }, 'chat')));

    return Array.from(merged.values());
  }

  private async getSourcesFromOpenWebUiItems(input: {
    workspaceId: string;
    query: string;
    messages: TerminalMessage[];
    items: TerminalContextItem[];
    sourceLocked: boolean;
  }): Promise<EvidenceCard[]> {
    const fullContextDocs: EvidenceCard[] = [];
    const retrievalItems: TerminalContextItem[] = [];

    for (const item of input.items) {
      if (item.type === 'text') {
        const content = item.file?.data?.content || '';
        if (content.trim()) {
          fullContextDocs.push(...fullContextEvidence([{
            id: item.id,
            name: item.name,
            path: item.file?.path || item.name,
            content
          }]).map((card) => ({
            ...card,
            metadata: {
              ...card.metadata,
              retrievalMode: item.context === 'full' ? 'full_context' : 'text_item',
              retrievalPipeline: 'openwebui_get_sources_from_items',
              sourceScope: item.sourceScope || 'workspace',
              fileObjectId: item.id
            }
          })));
        }
        continue;
      }

      if (item.type === 'file' && item.context === 'full' && item.file) {
        const text = item.file.data?.content || await this.loadFileText(input.workspaceId, item.file).catch(() => '');
        if (text.trim()) {
          fullContextDocs.push(...fullContextEvidence([{
            id: item.id,
            name: item.name,
            path: item.file.path,
            content: text
          }]).map((card) => ({
            ...card,
            metadata: {
              ...card.metadata,
              retrievalMode: 'full_context',
              retrievalPipeline: 'openwebui_get_sources_from_items',
              sourceScope: item.sourceScope || 'workspace',
              fileObjectId: item.id
            }
          })));
        }
        continue;
      }

      retrievalItems.push(item);
    }

    const retrievalFileIds = uniqueUnbounded(
      retrievalItems.flatMap((item) => {
        if (item.type === 'file' && item.fileObjectId) return [item.fileObjectId];
        return item.collectionNames || [];
      })
    );
    if (!retrievalFileIds.length) return fullContextDocs.slice(0, MAX_EVIDENCE_CARDS);

    const retrievalFiles = input.items
      .filter((item) => retrievalFileIds.includes(item.fileObjectId || item.id))
      .map((item) => ({ id: item.id, name: item.name, path: item.file?.path || item.name }));
    const queryVariants = buildFocusedQueryVariants(input.query, input.messages, retrievalFiles);
    const searches = await Promise.all(
      queryVariants.map(async (variant, index) => {
        const weight = index === 0 ? 1 : input.sourceLocked ? 0.88 : 0.74;
        const results = await knowledgeSearchService.search({
          workspaceId: input.workspaceId,
          query: variant,
          fileIds: retrievalFileIds,
          activeFileId: retrievalFileIds.length === 1 ? retrievalFileIds[0] : undefined,
          limit: FOCUSED_RETRIEVAL_PER_QUERY_LIMIT,
          requireDiversity: true,
          candidateLimit: Math.min(Number(process.env.AI_TERMINAL_OPENWEBUI_ITEM_CANDIDATES || 8000), Math.max(1200, retrievalFileIds.length * 260))
        }).catch(() => []);
        return {
          variant,
          weight,
          results
        };
      })
    );

    const focusedCards = evidenceFromSearch(mergeFocusedResults(
      searches.filter((search) => search.results.length > 0),
      input.query,
      retrievalFiles,
      input.sourceLocked
    )).map((card) => ({
      ...card,
      metadata: {
        ...card.metadata,
        retrievalPipeline: 'openwebui_get_sources_from_items_hybrid_collection_query',
        sourceScope: input.items.find((item) => item.fileObjectId === card.fileId || item.id === card.fileId)?.sourceScope || 'workspace'
      }
    }));

    return [...fullContextDocs, ...focusedCards].slice(0, MAX_EVIDENCE_CARDS);
  }

  private async withSavedTurn(
    input: WorkspaceTerminalChatInput,
    userId: string,
    messages: TerminalMessage[],
    result: {
      reply: string;
      evidence: EvidenceCard[];
      status: 'completed';
      model?: string;
      provider?: string;
    }
  ): Promise<WorkspaceTerminalChatResult> {
    const savedTurn = await conversationHistoryService.saveTurn({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      userId,
      sessionId: input.sessionId || null,
      title: clip(latestUserMessage(messages), 80),
      source: 'terminal_chat',
      messages,
      assistantReply: result.reply
    }).catch(() => null);
    const followUps = await this.generateFollowUps(messages, result.reply).catch(() => []);

    return {
      reply: result.reply,
      sessionId: savedTurn?.sessionId || input.sessionId || undefined,
      status: result.status,
      evidence: toTerminalEvidence(result.evidence),
      suggestedActions: [],
      followUps,
      memoryContext: { askUserToSave: null },
      model: result.model,
      provider: result.provider
    };
  }

  private async generateFollowUps(messages: TerminalMessage[], assistantReply: string) {
    if (process.env.AI_TERMINAL_FOLLOW_UPS_ENABLED === 'false') return [];
    const prompt = FOLLOW_UP_GENERATION_PROMPT_TEMPLATE.replace(
      '{{MESSAGES:END:6}}',
      formatFollowUpMessages(messages, assistantReply)
    );
    const result = await aiModelProviderService.chat(
      [{ role: 'user', content: prompt }],
      {
        useCase: 'chat',
        timeoutMs: Number(process.env.AI_TERMINAL_FOLLOW_UP_TIMEOUT_MS || 45000)
      }
    );
    const parsed = JSON.parse(extractJsonObject(result.reply));
    return normalizeFollowUps(parsed?.follow_ups);
  }
}

export const workspaceTerminalChatService = new WorkspaceTerminalChatService();
