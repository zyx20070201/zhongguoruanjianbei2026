import type {
  TerminalMessageV2,
  WorkspaceAgentDecision,
  WorkspaceAgentEvidence,
  WorkspaceAgentHistoryBlock,
  WorkspaceAgentHistoryMessage,
  WorkspaceAgentObservation,
  WorkspaceAgentToolCallRecord
} from './types';
import { clip, clipPreserveWhitespace, createId, nowIso } from './utils';

const DEFAULT_MAX_TOOL_RESULT_CHARS = 50000;
const DEFAULT_MAX_TOTAL_HISTORY_CHARS = 600000;
const OUTDATED_FILE_CONTENT = '[outdated - see the latest file content]';
const MISSING_TOOL_RESULT_TEXT = 'Tool execution was interrupted before a result was produced.';

const targetToolNames = new Set([
  'workspace.file.read',
  'attachment.read',
  'attachment.image.inspect',
  'workspace.file.search',
  'workspace.files.search',
  'knowledge.search',
  'workspace.fs.list',
  'web.search',
  'web.fetch'
]);

const readEvidenceKinds = new Set([
  'workspace_file_content',
  'chat_attachment',
  'web_page',
  'workspace_file_image',
  'chat_attachment_image'
]);

export const normalizeAgentMessages = (value: unknown): WorkspaceAgentHistoryMessage[] =>
  Array.isArray(value)
    ? value
        .map((message: any) => ({
          id: typeof message?.id === 'string' ? message.id : createId('hist'),
          role: message?.role === 'assistant' || message?.role === 'tool' ? message.role : 'user',
          turnId: typeof message?.turnId === 'string' ? message.turnId : createId('turn'),
          content: typeof message?.content === 'string' || Array.isArray(message?.content) ? message.content : '',
          createdAt: typeof message?.createdAt === 'string' ? message.createdAt : nowIso(),
          metadata: message?.metadata && typeof message.metadata === 'object' ? message.metadata : undefined
        }))
        .filter((message) => typeof message.content === 'string' ? message.content.trim() : message.content.length)
        .slice(-120)
    : [];

const latestUserContent = (messages: TerminalMessageV2[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

export const appendUserTurnMessage = (
  history: WorkspaceAgentHistoryMessage[],
  turnId: string,
  messages: TerminalMessageV2[]
) => {
  const content = latestUserContent(messages);
  if (!content) return history;
  const last = history[history.length - 1];
  if (last?.role === 'user' && typeof last.content === 'string' && last.content === content) return history;
  return [
    ...history,
    {
      id: createId('hist'),
      role: 'user' as const,
      turnId,
      content,
      createdAt: nowIso(),
      metadata: { userVisible: true }
    }
  ].slice(-120);
};

export const appendAssistantTextMessage = (
  history: WorkspaceAgentHistoryMessage[],
  turnId: string,
  content: string
) => {
  const text = String(content || '').trim();
  if (!text) return history;
  return [
    ...history,
    {
      id: createId('hist'),
      role: 'assistant' as const,
      turnId,
      content: text,
      createdAt: nowIso(),
      metadata: { userVisible: true }
    }
  ].slice(-120);
};

export const appendToolUseMessage = (
  history: WorkspaceAgentHistoryMessage[],
  turnId: string,
  decision: WorkspaceAgentDecision
) => {
  if (decision.type !== 'tool_call' || !decision.tool) return history;
  return [
    ...history,
    {
      id: createId('hist'),
      role: 'assistant' as const,
      turnId,
      content: [{
        type: 'tool_use' as const,
        id: decision.id,
        name: decision.tool,
        input: decision.input || {}
      }],
      createdAt: nowIso(),
      metadata: { userVisible: false }
    }
  ].slice(-120);
};

const evidenceLocator = (item: WorkspaceAgentEvidence): Record<string, unknown> | undefined => {
  const locator = item.metadata?.locator;
  const path = item.metadata?.path || item.source;
  const fileObjectId = item.metadata?.fileObjectId;
  if (!path && !fileObjectId && !locator) return undefined;
  return {
    ...(typeof fileObjectId === 'string' ? { fileObjectId } : {}),
    ...(typeof path === 'string' ? { path } : {}),
    ...(locator && typeof locator === 'object' ? { locator } : {})
  };
};

const evidenceSourceId = (item: WorkspaceAgentEvidence) =>
  typeof item.metadata?.fileObjectId === 'string'
    ? item.metadata.fileObjectId
    : typeof item.metadata?.chunkId === 'string'
      ? item.metadata.chunkId
      : item.source || item.title;

const toolResultPayload = (
  call: WorkspaceAgentToolCallRecord,
  observation: WorkspaceAgentObservation,
  evidence: WorkspaceAgentEvidence[]
) => {
  const evidencePayload = evidence.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    content: item.content,
    source: item.source,
    metadata: item.metadata
  }));
  return clipPreserveWhitespace(JSON.stringify({
    tool: call.tool,
    input: call.input,
    status: observation.status,
    summary: observation.summary,
    evidence: evidencePayload
  }, null, 2), DEFAULT_MAX_TOOL_RESULT_CHARS);
};

export const appendToolResultMessage = (
  history: WorkspaceAgentHistoryMessage[],
  turnId: string,
  call: WorkspaceAgentToolCallRecord,
  observation: WorkspaceAgentObservation,
  evidence: WorkspaceAgentEvidence[],
  toolUseId = call.id
) => {
  const locators = evidence.map(evidenceLocator).filter((item): item is Record<string, unknown> => Boolean(item));
  const sourceIds = evidence.map(evidenceSourceId).filter(Boolean).map(String);
  return [
    ...history,
    {
      id: createId('hist'),
      role: 'tool' as const,
      turnId,
      content: [{
        type: 'tool_result' as const,
        toolUseId,
        name: call.tool,
        content: toolResultPayload(call, observation, evidence),
        isError: observation.status === 'failed' || observation.status === 'skipped',
        evidenceIds: evidence.map((item) => item.id),
        locators,
        sourceIds
      }],
      createdAt: nowIso(),
      metadata: { userVisible: false }
    }
  ].slice(-120);
};

const toolUseIds = (history: WorkspaceAgentHistoryMessage[]) => {
  const ids = new Map<string, string>();
  for (const message of history) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'tool_use') ids.set(block.id, block.name);
    }
  }
  return ids;
};

const toolResultIds = (history: WorkspaceAgentHistoryMessage[]) => {
  const ids = new Set<string>();
  for (const message of history) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'tool_result') ids.add(block.toolUseId);
    }
  }
  return ids;
};

const addMissingToolResults = (history: WorkspaceAgentHistoryMessage[]) => {
  const uses = toolUseIds(history);
  const results = toolResultIds(history);
  const missing = [...uses].filter(([id]) => !results.has(id));
  if (!missing.length) return history;
  return [
    ...history,
    {
      id: createId('hist'),
      role: 'tool' as const,
      turnId: history[history.length - 1]?.turnId || createId('turn'),
      content: missing.map(([toolUseId, name]) => ({
        type: 'tool_result' as const,
        toolUseId,
        name,
        content: name ? `${MISSING_TOOL_RESULT_TEXT} Tool: ${name}.` : MISSING_TOOL_RESULT_TEXT,
        isError: true
      })),
      createdAt: nowIso(),
      metadata: { userVisible: false }
    }
  ].slice(-120);
};

const readLocatorKey = (locator: Record<string, unknown>) => {
  const path = typeof locator.path === 'string' ? locator.path : '';
  const fileObjectId = typeof locator.fileObjectId === 'string' ? locator.fileObjectId : '';
  const range = locator.locator && typeof locator.locator === 'object' ? JSON.stringify(locator.locator) : '';
  return `${fileObjectId || path}:${range}`;
};

const blockTextLength = (block: WorkspaceAgentHistoryBlock) =>
  block.type === 'text'
    ? block.text.length
    : block.type === 'tool_result'
      ? block.content.length
      : JSON.stringify(block.input).length + block.name.length;

const messageTextLength = (message: WorkspaceAgentHistoryMessage) =>
  typeof message.content === 'string'
    ? message.content.length
    : message.content.reduce((sum, block) => sum + blockTextLength(block), 0);

const truncateToolResult = (block: WorkspaceAgentHistoryBlock, maxChars: number): WorkspaceAgentHistoryBlock => {
  if (block.type !== 'tool_result' || block.content.length <= maxChars) return block;
  const head = Math.floor(maxChars * 0.62);
  const tail = Math.max(0, maxChars - head - 80);
  return {
    ...block,
    content: `${block.content.slice(0, head).trim()}\n\n...[truncated ${block.content.length - head - tail} chars]...\n\n${block.content.slice(block.content.length - tail).trim()}`
  };
};

const markOutdatedReads = (messages: WorkspaceAgentHistoryMessage[]) => {
  const latestByLocator = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result' || block.isError) continue;
      if (!['workspace.file.read', 'attachment.read', 'web.fetch'].includes(block.name)) continue;
      for (const locator of block.locators || []) {
        latestByLocator.set(readLocatorKey(locator), `${message.id}:${block.toolUseId}`);
      }
    }
  }
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((block) => {
      if (block.type !== 'tool_result' || block.isError || !['workspace.file.read', 'attachment.read', 'web.fetch'].includes(block.name)) return block;
      const outdated = (block.locators || []).some((locator) => latestByLocator.get(readLocatorKey(locator)) !== `${message.id}:${block.toolUseId}`);
      if (!outdated) return block;
      changed = true;
      return { ...block, content: OUTDATED_FILE_CONTENT };
    });
    return changed ? { ...message, content } : message;
  });
};

export const buildAgentHistoryForModel = (
  history: WorkspaceAgentHistoryMessage[],
  options: { maxToolResultChars?: number; maxTotalChars?: number } = {}
) => {
  const maxToolResultChars = options.maxToolResultChars || DEFAULT_MAX_TOOL_RESULT_CHARS;
  const maxTotalChars = options.maxTotalChars || DEFAULT_MAX_TOTAL_HISTORY_CHARS;
  const prepared = markOutdatedReads(addMissingToolResults(history)).map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((block) => targetToolNames.has(block.type === 'tool_result' ? block.name : block.type === 'tool_use' ? block.name : '')
        ? truncateToolResult(block, maxToolResultChars)
        : block)
    };
  });
  const result: WorkspaceAgentHistoryMessage[] = [];
  let used = 0;
  for (let index = prepared.length - 1; index >= 0; index -= 1) {
    const message = prepared[index];
    const length = messageTextLength(message) + 120;
    if (used + length > maxTotalChars && result.length > 0) continue;
    used += length;
    result.unshift(message);
  }
  return result;
};

export const evidenceFromAgentHistory = (history: WorkspaceAgentHistoryMessage[]): WorkspaceAgentEvidence[] => {
  const evidence: WorkspaceAgentEvidence[] = [];
  for (const message of history) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result' || !block.content || block.content === OUTDATED_FILE_CONTENT) continue;
      try {
        const parsed = JSON.parse(block.content);
        const items = Array.isArray(parsed?.evidence) ? parsed.evidence : [];
        for (const item of items) {
          if (!item?.id || !item?.kind || !item?.title) continue;
          evidence.push({
            id: String(item.id),
            kind: String(item.kind),
            title: String(item.title),
            summary: String(item.summary || ''),
            content: typeof item.content === 'string' ? item.content : undefined,
            source: typeof item.source === 'string' ? item.source : undefined,
            metadata: item.metadata && typeof item.metadata === 'object'
              ? { ...item.metadata, sourceTurnId: message.turnId, historyMessageId: message.id }
              : { sourceTurnId: message.turnId, historyMessageId: message.id }
          });
        }
      } catch {
        // Ignore non-JSON legacy tool results.
      }
    }
  }
  return evidence;
};

export const hasCurrentTurnEvidence = (history: WorkspaceAgentHistoryMessage[], turnId: string) =>
  history.some((message) => message.turnId === turnId && Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_result'));

export const summarizeAgentHistory = (history: WorkspaceAgentHistoryMessage[], maxItems = 12) =>
  history.slice(-maxItems).map((message) => ({
    role: message.role,
    turnId: message.turnId,
    content: typeof message.content === 'string'
      ? clip(message.content, 300)
      : message.content.map((block) => block.type === 'tool_result'
          ? { type: block.type, name: block.name, evidenceIds: block.evidenceIds, sourceIds: block.sourceIds, locators: block.locators?.slice(0, 3), content: clip(block.content, 500) }
          : block.type === 'tool_use'
            ? { type: block.type, name: block.name, input: block.input }
            : { type: block.type, text: clip(block.text, 300) })
  }));

export const isReadEvidenceKind = (kind: string) =>
  readEvidenceKinds.has(kind) || kind.endsWith('_content');
