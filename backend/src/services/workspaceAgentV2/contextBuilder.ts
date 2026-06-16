import type {
  WorkspaceAgentEvidence,
  WorkspaceAgentHistoryMessage,
  WorkspaceAgentModelContextBlock,
  WorkspaceAgentObservation,
  WorkspaceAgentToolCallRecord,
  WorkspaceAgentV2State
} from './types';
import { buildAgentHistoryForModel, evidenceFromAgentHistory } from './agentMessageHistory';
import { clip } from './utils';

const DEFAULT_DECISION_CONTEXT_CHARS = 18000;
const DEFAULT_FINAL_CONTEXT_CHARS = 32000;

const READ_EVIDENCE_KINDS = new Set([
  'environment',
  'workspace_file_content',
  'chat_attachment',
  'web_page',
  'learner_context',
  'course_graph_node'
]);

const FILE_CARD_KINDS = new Set([
  'workspace_file_card',
  'workspace_file',
  'attachment_metadata',
  'knowledge_chunk',
  'workspace_chunk',
  'web_search_result'
]);

const evidenceSourceId = (item: WorkspaceAgentEvidence) =>
  typeof item.metadata?.fileObjectId === 'string'
    ? item.metadata.fileObjectId
    : typeof item.metadata?.chunkId === 'string'
      ? item.metadata.chunkId
      : item.source || item.title;

const evidenceLocatorKey = (item: WorkspaceAgentEvidence) => {
  const locator = item.metadata?.locator;
  const path = typeof item.metadata?.path === 'string' ? item.metadata.path : item.source || item.title;
  if (!locator || typeof locator !== 'object') return path;
  const lineStart = (locator as any).lineStart;
  const lineEnd = (locator as any).lineEnd;
  if (typeof lineStart !== 'number' && typeof lineEnd !== 'number') return path;
  return `${path}:${lineStart || 1}-${lineEnd || 'EOF'}`;
};

const isReadEvidence = (item: WorkspaceAgentEvidence) =>
  READ_EVIDENCE_KINDS.has(item.kind) || item.kind.endsWith('_content') || Boolean(item.content && /read|attachment|file_content/.test(item.kind));

const isFileCardEvidence = (item: WorkspaceAgentEvidence) =>
  FILE_CARD_KINDS.has(item.kind) || /card|chunk|search_result|workspace_file/.test(item.kind);

const truncateContent = (content: string, maxChars: number) => {
  if (content.length <= maxChars) return content;
  const head = Math.max(0, Math.floor(maxChars * 0.62));
  const tail = Math.max(0, maxChars - head - 80);
  return `${content.slice(0, head).trim()}\n\n...[truncated ${content.length - head - tail} chars to fit context budget]...\n\n${content.slice(content.length - tail).trim()}`;
};

const observationBlock = (observation: WorkspaceAgentObservation): WorkspaceAgentModelContextBlock => ({
  id: observation.id,
  kind: 'observation',
  title: observation.tool,
  summary: observation.summary,
  tool: observation.tool,
  metadata: {
    status: observation.status,
    evidenceIds: observation.evidenceIds,
    at: observation.at
  }
});

const evidenceBlock = (
  item: WorkspaceAgentEvidence,
  kind: WorkspaceAgentModelContextBlock['kind'],
  stale = false
): WorkspaceAgentModelContextBlock => ({
  id: item.id,
  kind,
  title: item.title,
  summary: item.summary,
  content: item.content,
  source: item.source,
  sourceId: evidenceSourceId(item),
  stale,
  metadata: item.metadata
});

const scoreEvidence = (item: WorkspaceAgentEvidence, index: number, total: number) => {
  let score = index / Math.max(1, total);
  if (isReadEvidence(item)) score += 100;
  else if (isFileCardEvidence(item)) score += 20;
  if (item.kind === 'workspace_file_content' || item.kind === 'chat_attachment') score += 40;
  if (item.content) score += Math.min(10, item.content.length / 1000);
  return score;
};

const continuationIntent = (text?: string) =>
  /(刚才|上面|前面|这个|里面|继续|基于这些|基于这个|把.*整理|总结成|生成.*md|生成.*markdown|these|previous|continue|this file)/i.test(String(text || ''));

const markStaleReadBlocks = (blocks: WorkspaceAgentModelContextBlock[]) => {
  const latestByLocator = new Map<string, string>();
  for (const block of blocks) {
    if (block.kind !== 'read_result') continue;
    const locator = typeof block.metadata?.path === 'string'
      ? `${block.metadata.path}:${JSON.stringify(block.metadata.locator || {})}`
      : block.source || block.sourceId || block.title;
    latestByLocator.set(locator, block.id);
  }
  return blocks.map((block) => {
    if (block.kind !== 'read_result') return block;
    const locator = typeof block.metadata?.path === 'string'
      ? `${block.metadata.path}:${JSON.stringify(block.metadata.locator || {})}`
      : block.source || block.sourceId || block.title;
    return latestByLocator.get(locator) === block.id ? block : { ...block, stale: true, content: '[outdated - see the latest file content]' };
  });
};

const withBudget = (blocks: WorkspaceAgentModelContextBlock[], maxChars: number) => {
  const result: WorkspaceAgentModelContextBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    const fixedChars = block.title.length + block.summary.length + (block.source || '').length + 180;
    const remaining = maxChars - used - fixedChars;
    if (remaining <= 0) break;
    const content = block.content ? truncateContent(block.content, Math.max(400, remaining)) : undefined;
    used += fixedChars + (content || '').length;
    result.push({ ...block, content });
  }
  return result;
};

const toolByObservationId = (toolCalls: WorkspaceAgentToolCallRecord[]) => {
  const map = new Map<string, string>();
  for (const call of toolCalls) {
    if (call.observationId) map.set(call.observationId, call.tool);
  }
  return map;
};

export const buildWorkspaceAgentModelContext = (
  state: Pick<WorkspaceAgentV2State, 'evidence' | 'observations' | 'toolCalls' | 'contextControl'> & {
    agentMessages?: WorkspaceAgentHistoryMessage[];
    userInput?: string;
  },
  options: { phase: 'decision' | 'final'; maxChars?: number }
): WorkspaceAgentModelContextBlock[] => {
  const maxChars = options.maxChars
    || (options.phase === 'final'
      ? state.contextControl?.contextBudget?.maxFinalContextChars
      : state.contextControl?.contextBudget?.maxDecisionContextChars)
    || (options.phase === 'final' ? DEFAULT_FINAL_CONTEXT_CHARS : DEFAULT_DECISION_CONTEXT_CHARS);
  const historyEvidence = evidenceFromAgentHistory(state.agentMessages || []);
  const currentEvidenceIds = new Set((state.evidence || []).map((item) => item.id));
  const evidence = [
    ...historyEvidence.filter((item) => !currentEvidenceIds.has(item.id)),
    ...(state.evidence || [])
  ];
  const continuesPriorContext = continuationIntent(state.userInput);
  const latestReadByLocator = new Map<string, WorkspaceAgentEvidence>();
  for (const item of evidence) {
    if (!isReadEvidence(item)) continue;
    latestReadByLocator.set(evidenceLocatorKey(item), item);
  }

  const scored = evidence
    .map((item, index) => {
      const fromHistory = Boolean(item.metadata?.historyMessageId);
      const score = scoreEvidence(item, index, evidence.length)
        + (fromHistory && continuesPriorContext ? 35 : 0)
        - (fromHistory && !continuesPriorContext ? 12 : 0);
      return { item, index, score };
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const blocks: WorkspaceAgentModelContextBlock[] = [];
  for (const { item } of scored) {
    const read = isReadEvidence(item);
    const key = read ? `read:${evidenceLocatorKey(item)}` : `evidence:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const latest = read ? latestReadByLocator.get(evidenceLocatorKey(item)) : undefined;
    if (read && latest && latest.id !== item.id) continue;
    const fromHistory = Boolean(item.metadata?.historyMessageId);
    blocks.push(evidenceBlock(
      item,
      read ? 'read_result' : isFileCardEvidence(item) ? 'file_card' : 'tool_result',
      fromHistory && !continuesPriorContext
    ));
  }

  const toolMap = toolByObservationId(state.toolCalls || []);
  for (const observation of (state.observations || []).slice(-6).reverse()) {
    blocks.push({
      ...observationBlock(observation),
      tool: toolMap.get(observation.id) || observation.tool
    });
  }

  const historyMessages = buildAgentHistoryForModel(state.agentMessages || [], {
    maxToolResultChars: Math.min(8000, Math.max(2000, Math.floor(maxChars / 3))),
    maxTotalChars: Math.min(12000, Math.max(3000, Math.floor(maxChars / 2)))
  });
  for (const message of historyMessages.slice(-8)) {
    blocks.push({
      id: message.id,
      kind: 'tool_result',
      title: `history:${message.role}`,
      summary: typeof message.content === 'string'
        ? clip(message.content, 600)
        : clip(JSON.stringify(message.content), 900),
      content: typeof message.content === 'string' ? undefined : JSON.stringify(message.content, null, 2),
      sourceId: message.turnId,
      stale: message.turnId !== historyMessages[historyMessages.length - 1]?.turnId && !continuesPriorContext,
      metadata: { turnId: message.turnId, role: message.role, source: 'agent_message_history' }
    });
  }

  return withBudget(markStaleReadBlocks(blocks), maxChars).map((block) => ({
    ...block,
    summary: clip(block.summary, 900)
  }));
};
