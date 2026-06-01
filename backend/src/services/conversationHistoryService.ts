import crypto from 'crypto';
import prisma from '../config/db';
import { backgroundJobService } from './backgroundJobService';
import { embeddingService } from './embeddingService';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type TerminalPersistedMessage = ChatMessage & Record<string, unknown>;

export interface RetrievedConversationMemory {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  score: number;
  retrievalMode?: 'semantic' | 'keyword' | 'hybrid';
  summary?: string;
  createdAt: string;
}

export interface ConversationSessionListItem {
  id: string;
  title: string;
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: ChatMessage[];
}

const clip = (value: string | null | undefined, maxLength = 900) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const hashMessage = (sessionId: string, role: string, content: string, index: number) =>
  crypto.createHash('sha256').update(`${sessionId}:${role}:${content}:${index}`).digest('hex');

const terms = (value: string) =>
  Array.from(new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .slice(0, 24)
  ));

const textScore = (queryTerms: string[], content: string) => {
  const lower = content.toLowerCase();
  return queryTerms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
};

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

const cosineSimilarity = (left: number[], right: number[]) => {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom ? dot / denom : 0;
};

const summarizeTurnText = (messages: ChatMessage[]) => {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')?.content || '';
  return clip([latestUser ? `User: ${latestUser}` : '', latestAssistant ? `Assistant: ${latestAssistant}` : ''].filter(Boolean).join('\n'), 900);
};

type RetrievalCandidate = RetrievedConversationMemory & {
  rawContent: string;
  metadata: Record<string, unknown>;
};

const CONVERSATION_EMBEDDING_VERSION = 'conversation-search-v2';

const searchTextFor = (role: string, content: string) => clip(`${role}: ${content}`, 1800);

const terminalMessageMetadata = (message: TerminalPersistedMessage) => {
  const { role, content, ...metadata } = message;
  return metadata;
};

const toTerminalMessage = (message: any): TerminalPersistedMessage => {
  const metadata = parseJson<Record<string, unknown>>(message.metadataJson, {});
  const terminal = metadata.terminalMessage && typeof metadata.terminalMessage === 'object'
    ? metadata.terminalMessage as Record<string, unknown>
    : {};
  return {
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
    ...terminal
  };
};

const sameTerminalMessage = (left: TerminalPersistedMessage, right: TerminalPersistedMessage) =>
  left.role === right.role && String(left.content || '') === String(right.content || '');

const mergeTerminalMessages = (
  existing: TerminalPersistedMessage[],
  incoming: TerminalPersistedMessage[]
) => {
  if (!existing.length) return incoming;
  if (!incoming.length) return existing;

  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < existing.length; start += 1) {
    let length = 0;
    while (
      start + length < existing.length &&
      length < incoming.length &&
      sameTerminalMessage(existing[start + length], incoming[length])
    ) {
      length += 1;
    }
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
    }
  }

  if (bestStart >= 0 && bestLength > 0) {
    return [...existing.slice(0, bestStart), ...incoming];
  }
  return [...existing, ...incoming];
};

export class ConversationHistoryService {
  async saveMessages(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    sessionId?: string | null;
    title?: string;
    source?: string;
    messages: ChatMessage[];
  }) {
    const sessionId = input.sessionId || crypto.randomUUID();
    const title = clip(input.title || input.messages.find((message) => message.role === 'user')?.content || 'New chat', 80);
    await prisma.conversationSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: input.userId,
        title,
        source: input.source || 'terminal',
        metadataJson: '{}'
      },
      update: {
        title,
        workbenchId: input.workbenchId || null,
        source: input.source || 'terminal',
        updatedAt: new Date()
      }
    });

    const createdIds: string[] = [];
    for (const [index, message] of input.messages.entries()) {
      const content = clip(message.content, 6000);
      if (!content) continue;
      const contentHash = hashMessage(sessionId, message.role, content, index);
      const searchableText = searchTextFor(message.role, content);
      const metadata: Record<string, unknown> = {
        summary: clip(content, 420),
        searchText: searchableText,
        semanticReady: false,
        embeddingQueued: true,
        embeddingVersion: CONVERSATION_EMBEDDING_VERSION
      };
      const saved = await prisma.conversationMessage.upsert({
        where: {
          sessionId_contentHash: {
            sessionId,
            contentHash
          }
        },
        create: {
          id: crypto.randomUUID(),
          sessionId,
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          userId: input.userId,
          role: message.role,
          content,
          contentHash,
          metadataJson: stringify(metadata)
        },
        update: {
          metadataJson: stringify(metadata)
        }
      });
      createdIds.push(saved.id);
      this.enqueueEmbedding(saved.id);
    }
    return { sessionId, createdIds };
  }

  registerBackgroundJobs() {
    backgroundJobService.register('conversation.embedMessage', async (payload: { messageId: string }) => {
      await this.embedMessage(payload.messageId);
    });
  }

  enqueueEmbedding(messageId: string) {
    backgroundJobService.enqueue('conversation.embedMessage', { messageId }, { id: `conversation.embedMessage:${messageId}`, maxAttempts: 3 });
  }

  async embedMessage(messageId: string) {
    const row = await prisma.conversationMessage.findUnique({ where: { id: messageId } });
    if (!row) return null;
    const metadata = parseJson<Record<string, unknown>>(row.metadataJson, {});
    if (metadata.semanticReady === true && metadata.embeddingVersion === CONVERSATION_EMBEDDING_VERSION) return row;
    const searchableText = searchTextFor(row.role, row.content);
    const embedding = await embeddingService.embed(searchableText);
    const updatedMetadata = {
      ...metadata,
      searchText: searchableText,
      summary: metadata.summary || clip(row.content, 420),
      embedding,
      embeddingModel: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
      embeddingVersion: CONVERSATION_EMBEDDING_VERSION,
      embeddedAt: new Date().toISOString(),
      semanticReady: embedding.length > 0,
      embeddingQueued: false,
      embeddingError: ''
    };
    return prisma.conversationMessage.update({
      where: { id: messageId },
      data: { metadataJson: stringify(updatedMetadata) }
    });
  }

  async backfillEmbeddings(input: { workspaceId?: string; limit?: number; enqueue?: boolean } = {}) {
    const rows = await prisma.conversationMessage.findMany({
      where: {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(input.limit || 100, 1), 1000)
    });
    const stale = rows.filter((row) => {
      const metadata = parseJson<Record<string, unknown>>(row.metadataJson, {});
      return metadata.semanticReady !== true || metadata.embeddingVersion !== CONVERSATION_EMBEDDING_VERSION;
    });
    if (input.enqueue !== false) {
      stale.forEach((row) => this.enqueueEmbedding(row.id));
      return { scanned: rows.length, queued: stale.length, embedded: 0, failed: 0 };
    }
    let embedded = 0;
    let failed = 0;
    for (const row of stale) {
      try {
        await this.embedMessage(row.id);
        embedded += 1;
      } catch {
        failed += 1;
      }
    }
    return { scanned: rows.length, queued: 0, embedded, failed };
  }

  async saveTurn(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    sessionId?: string | null;
    title?: string;
    source?: string;
    messages: ChatMessage[];
    assistantReply: string;
  }) {
    return this.saveMessages({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      userId: input.userId,
      sessionId: input.sessionId || null,
      title: input.title,
      source: input.source || 'terminal',
      messages: [...input.messages, { role: 'assistant', content: input.assistantReply }]
    });
  }

  async saveTerminalConversation(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    sessionId?: string | null;
    title?: string;
    source: string;
    messages: TerminalPersistedMessage[];
    sessionMetadata?: Record<string, unknown>;
  }) {
    const sessionId = input.sessionId || crypto.randomUUID();
    const title = clip(input.title || input.messages.find((message) => message.role === 'user')?.content || 'New chat', 80);
    const sessionMetadata = {
      ...(input.sessionMetadata || {}),
      terminalPersisted: true,
      updatedFrom: 'terminal_chat_persistence'
    };
    await prisma.conversationSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        userId: input.userId,
        title,
        source: input.source,
        metadataJson: stringify(sessionMetadata)
      },
      update: {
        title,
        workbenchId: input.workbenchId || null,
        source: input.source,
        metadataJson: stringify(sessionMetadata),
        updatedAt: new Date()
      }
    });

    const existingRows = await prisma.conversationMessage.findMany({
      where: { sessionId, workspaceId: input.workspaceId },
      orderBy: { createdAt: 'asc' }
    });
    const existingMessages = existingRows.map(toTerminalMessage);
    const nextMessages = mergeTerminalMessages(existingMessages, input.messages);

    if (existingRows.length) {
      await prisma.conversationMessage.deleteMany({
        where: {
          sessionId,
          workspaceId: input.workspaceId
        }
      });
    }

    const savedIds: string[] = [];
    for (const [index, message] of nextMessages.entries()) {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const content = String(message.content || '').slice(0, 50000);
      if (!content.trim()) continue;
      const contentHash = hashMessage(sessionId, role, content, index);
      const metadata = {
        summary: clip(content, 420),
        searchText: searchTextFor(role, content),
        semanticReady: false,
        embeddingQueued: true,
        embeddingVersion: CONVERSATION_EMBEDDING_VERSION,
        terminalMessage: terminalMessageMetadata(message)
      };
      const saved = await prisma.conversationMessage.create({
        data: {
          id: crypto.randomUUID(),
          sessionId,
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          userId: input.userId,
          role,
          content,
          contentHash,
          metadataJson: stringify(metadata)
        }
      });
      savedIds.push(saved.id);
      this.enqueueEmbedding(saved.id);
    }

    return { sessionId, savedIds };
  }

  async retrieve(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId?: string | null;
    source?: string;
    query: string;
    currentSessionId?: string | null;
    limit?: number;
  }) {
    const queryTerms = terms(input.query);
    if (!queryTerms.length) return [];
    const rows = await prisma.conversationMessage.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.source ? { session: { source: input.source } } : {}),
        ...(input.currentSessionId ? { sessionId: { not: input.currentSessionId } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 240
    });
    const keywordItems: RetrievalCandidate[] = rows.map((row) => {
      const metadata = parseJson<Record<string, unknown>>(row.metadataJson, {});
      return {
        id: row.id,
        sessionId: row.sessionId,
        role: row.role,
        content: clip(row.content, 700),
        score: textScore(queryTerms, `${row.content} ${String(metadata.summary || '')}`),
        retrievalMode: 'keyword' as const,
        summary: typeof metadata.summary === 'string' ? metadata.summary : undefined,
        createdAt: row.createdAt.toISOString(),
        rawContent: row.content,
        metadata
      };
    });

    let semanticItems: RetrievalCandidate[] = [];
    try {
      const queryEmbedding = await embeddingService.embed(input.query);
      if (queryEmbedding.length) {
        semanticItems = keywordItems
          .map((item) => {
            const embedding = Array.isArray(item.metadata.embedding) ? item.metadata.embedding.map(Number) : [];
            const semanticScore = cosineSimilarity(queryEmbedding, embedding);
            const keywordBoost = item.score > 0 ? Math.min(item.score / Math.max(queryTerms.length, 1), 1) * 0.18 : 0;
            const recencyBoost = Math.max(0, 1 - (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 90)) * 0.06;
            return {
              ...item,
              score: semanticScore + keywordBoost + recencyBoost,
              retrievalMode: 'semantic' as const
            };
          })
          .filter((item) => item.score > 0.16)
          .sort((a, b) => b.score - a.score)
          .slice(0, 24);

        if (semanticItems.length) {
          const reranked = await embeddingService.rerank({
            query: input.query,
            documents: semanticItems.map((item) => `${item.role}: ${item.content}`)
          }).catch(() => []);
          if (reranked.length) {
            const byIndex = new Map(reranked.map((item) => [item.index, item.score]));
            semanticItems = semanticItems
              .map((item, index) => ({
                ...item,
                score: Number((item.score * 0.35 + (byIndex.get(index) ?? item.score) * 0.65).toFixed(4)),
                retrievalMode: 'hybrid' as const
              }))
              .sort((a, b) => b.score - a.score);
          }
        }
      }
    } catch {
      semanticItems = [];
    }

    const byId = new Map<string, (typeof keywordItems)[number]>();
    [...semanticItems, ...keywordItems.filter((row) => row.score > 0)].forEach((item) => {
      const existing = byId.get(item.id);
      if (!existing || item.score > existing.score) byId.set(item.id, item);
    });

    return Array.from(byId.values())
      .sort((a, b) => b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.min(Math.max(input.limit || 6, 1), 12))
      .map(({ rawContent, metadata, ...item }) => item);
  }

  async listSessions(input: {
    workspaceId: string;
    workbenchId?: string | null;
    source?: string;
    limit?: number;
    includeMessages?: boolean;
  }): Promise<ConversationSessionListItem[]> {
    const sessions = await prisma.conversationSession.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.source ? { source: input.source } : {})
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 20, 1), 60),
      include: input.includeMessages
        ? {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 80
            }
          }
        : undefined
    });
    return sessions.map((session: any) => ({
      id: session.id,
      title: session.title || 'AI 对话',
      source: session.source || 'terminal',
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      metadata: parseJson<Record<string, unknown>>(session.metadataJson, {}),
      messages: Array.isArray(session.messages)
        ? session.messages.map((message: any) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content
          }))
        : []
    }));
  }

  async listTerminalSessions(input: {
    workspaceId: string;
    workbenchId?: string | null;
    limit?: number;
  }) {
    const sessions = await prisma.conversationSession.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        source: { in: ['terminal', 'terminal_chat'] }
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(input.limit || 30, 1), 100),
      include: {
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });
    return sessions.map((session) => {
      const metadata = parseJson<Record<string, unknown>>(session.metadataJson, {});
      const latest = session.messages[0];
      return {
        id: session.id,
        title: session.title || latest?.content?.slice(0, 80) || 'New chat',
        source: session.source,
        mode: session.source === 'terminal_chat' ? 'chat' : 'agentic',
        selectedSources: Array.isArray(metadata.selectedSources) ? metadata.selectedSources : [],
        chatFiles: Array.isArray(metadata.chatFiles) ? metadata.chatFiles : [],
        checkpointThreadId: typeof metadata.checkpointThreadId === 'string' ? metadata.checkpointThreadId : undefined,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messageCount: session._count.messages,
        lastMessagePreview: latest ? clip(latest.content, 180) : ''
      };
    });
  }

  async getTerminalMessages(input: {
    workspaceId: string;
    sessionId: string;
    before?: string | null;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit || 30, 1), 80);
    const beforeDate = input.before ? new Date(input.before) : null;
    const rows = await prisma.conversationMessage.findMany({
      where: {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1
    });
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const oldest = page[page.length - 1];
    return {
      messages: page.reverse().map(toTerminalMessage),
      hasMore,
      nextBefore: hasMore && oldest ? oldest.createdAt.toISOString() : null
    };
  }

  formatRetrieved(items: RetrievedConversationMemory[]) {
    if (!items.length) return 'Reference chat history: none.';
    return [
      'Reference chat history:',
      ...items.map((item, index) => {
        const mode = item.retrievalMode ? `, ${item.retrievalMode}` : '';
        return `- [H${index + 1}] ${item.role}${mode}: ${item.summary || item.content}`;
      })
    ].join('\n');
  }

  buildTurnSummary(messages: ChatMessage[]) {
    return summarizeTurnText(messages);
  }
}

export const conversationHistoryService = new ConversationHistoryService();
