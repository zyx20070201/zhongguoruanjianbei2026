import type { ProviderChatMessage } from '../aiModelProviderService';
import { buildAgentHistoryForModel } from './agentMessageHistory';
import type { WorkspaceAgentHistoryBlock, WorkspaceAgentHistoryMessage, WorkspaceAgentModelContextBlock, WorkspaceAgentV2State } from './types';
import { clip, clipPreserveWhitespace, compactJson, compactJsonPreserveWhitespace } from './utils';

const DEFAULT_MAX_TOTAL_CHARS = 60000;
const DEFAULT_MAX_TOOL_CONTEXT_CHARS = 28000;
const PROTECTED_DIALOGUE_TAIL = 8;

export const FINAL_ANSWER_SYSTEM_PROMPT = [
  '你是 Workspace Agent V2 的 ResponseComposer。',
  '请像 Cline/Codex 一样，把最近 user/assistant 对话消息作为一等上下文来理解当前请求。',
  '工具结果、Evidence 和 Observations 是辅助上下文；它们可以支持回答，但不能覆盖最近对话中明确的用户意图。',
  '默认使用简体中文，回答清晰直接；说明用到了哪些资料或工具观察。',
  '不要声称执行了未执行的写入操作。',
  '如果 DeliveryContract 要求 workspace/workbench 文件，但尚未 satisfied，不要把聊天区 Markdown 当作文件交付。'
].join('\n');

export interface FinalAnswerMessageBuildResult {
  messages: ProviderChatMessage[];
  systemPrompt: string;
}

const visibleTextMessage = (message: WorkspaceAgentHistoryMessage) =>
  (message.role === 'user' || message.role === 'assistant')
  && typeof message.content === 'string'
  && message.content.trim();

const normalizeDialogueMessages = (state: WorkspaceAgentV2State): ProviderChatMessage[] => {
  const fromHistory = (state.agentMessages || [])
    .filter(visibleTextMessage)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: String(message.content || '').trim(),
      createdAt: message.createdAt
    }));

  const fromTerminal = (state.messages || [])
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
      createdAt: ''
    }));

  const combined = fromHistory.length ? fromHistory : fromTerminal;
  const deduped: ProviderChatMessage[] = [];
  for (const message of combined) {
    const previous = deduped[deduped.length - 1];
    if (previous?.role === message.role && previous.content === message.content) continue;
    deduped.push({ role: message.role, content: message.content });
  }
  return deduped.slice(-PROTECTED_DIALOGUE_TAIL).map((message) => ({
    role: message.role,
    content: clipPreserveWhitespace(message.content, 6000)
  }));
};

const blockLabel = (block: WorkspaceAgentHistoryBlock) => {
  if (block.type === 'tool_use') return `tool_use:${block.name}`;
  if (block.type === 'tool_result') return `tool_result:${block.name}${block.isError ? ':error' : ''}`;
  return 'text';
};

const renderHistoryBlock = (block: WorkspaceAgentHistoryBlock) => {
  if (block.type === 'text') return block.text;
  if (block.type === 'tool_use') {
    return [
      `<${blockLabel(block)}>`,
      compactJson(block.input, 2200),
      `</${blockLabel(block)}>`
    ].join('\n');
  }
  return [
    `<${blockLabel(block)}>`,
    block.content,
    `</${blockLabel(block).split(':')[0]}>`
  ].join('\n');
};

const renderToolHistory = (state: WorkspaceAgentV2State, maxChars: number) => {
  const history = buildAgentHistoryForModel(state.agentMessages || [], {
    maxToolResultChars: Math.min(12000, Math.max(3000, Math.floor(maxChars / 3))),
    maxTotalChars: maxChars
  });
  const chunks: string[] = [];
  for (const message of history) {
    if (typeof message.content === 'string') continue;
    const toolBlocks = message.content.filter((block) => block.type === 'tool_use' || block.type === 'tool_result');
    if (!toolBlocks.length) continue;
    chunks.push([
      `## ${message.role} turn=${message.turnId}`,
      ...toolBlocks.map(renderHistoryBlock)
    ].join('\n\n'));
  }
  return clip(chunks.join('\n\n'), maxChars);
};

const renderModelContext = (blocks: WorkspaceAgentModelContextBlock[], maxChars: number) =>
  compactJsonPreserveWhitespace(blocks.map((item) => ({
    title: item.title,
    kind: item.kind,
    summary: item.summary,
    content: item.content || '',
    source: item.source,
    sourceId: item.sourceId,
    stale: item.stale,
    metadata: item.metadata
  })), maxChars);

const buildFinalToolContext = (
  state: WorkspaceAgentV2State,
  evidence: WorkspaceAgentModelContextBlock[],
  options: { maxToolContextChars: number }
): string => {
  const observations = compactJson(state.observations.slice(-8), 5000);
  const deliveryContract = compactJson(state.contextControl?.deliveryContract, 1800);
  const toolHistory = renderToolHistory(state, Math.floor(options.maxToolContextChars * 0.45));
  const modelContext = renderModelContext(evidence, Math.floor(options.maxToolContextChars * 0.55));
  return [
    'Internal runtime context follows. Use it only as private support for answering the visible conversation.',
    'Never explain, quote, translate, or mention this runtime context unless the user explicitly asks about agent internals.',
    'If the visible conversation asks about an attached image, inspect the image content directly and do not explain these context fields.',
    '',
    `Latest visible user request: ${state.userInput}`,
    '',
    `Delivery status:\n${deliveryContract}`,
    '',
    `Recent tool observations:\n${observations}`,
    '',
    toolHistory ? `Tool history:\n${toolHistory}` : '',
    '',
    modelContext ? `Retrieved context:\n${modelContext}` : ''
  ].filter(Boolean).join('\n');
};

const totalChars = (messages: ProviderChatMessage[]) =>
  messages.reduce((sum, message) => sum + message.content.length + 80, 0);

const trimToBudget = (messages: ProviderChatMessage[], maxChars: number) => {
  if (totalChars(messages) <= maxChars) return messages;
  if (messages.length <= 2) return messages;
  const result = [...messages];
  while (result.length > 3 && totalChars(result) > maxChars) {
    result.splice(0, 1);
  }
  return result;
};

const mergeAdjacentSameRole = (messages: ProviderChatMessage[]) => {
  const result: ProviderChatMessage[] = [];
  for (const message of messages) {
    const previous = result[result.length - 1];
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`.trim();
      continue;
    }
    result.push({ ...message });
  }
  return result;
};

export const buildFinalAnswerMessages = (
  state: WorkspaceAgentV2State,
  evidence: WorkspaceAgentModelContextBlock[],
  options: { maxTotalChars?: number; maxToolContextChars?: number } = {}
): ProviderChatMessage[] => {
  const result = buildFinalAnswerMessagePayload(state, evidence, options);
  return result.messages;
};

export const buildFinalAnswerMessagePayload = (
  state: WorkspaceAgentV2State,
  evidence: WorkspaceAgentModelContextBlock[],
  options: { maxTotalChars?: number; maxToolContextChars?: number } = {}
): FinalAnswerMessageBuildResult => {
  const maxTotalChars = options.maxTotalChars || state.contextControl?.contextBudget?.maxFinalContextChars || DEFAULT_MAX_TOTAL_CHARS;
  const maxToolContextChars = options.maxToolContextChars || Math.min(DEFAULT_MAX_TOOL_CONTEXT_CHARS, Math.max(8000, Math.floor(maxTotalChars * 0.7)));
  const dialogue = normalizeDialogueMessages(state);
  const hasCurrentUser = dialogue.some((message, index) =>
    index === dialogue.length - 1
    && message.role === 'user'
    && message.content.trim() === state.userInput.trim()
  );
  const protectedDialogue = hasCurrentUser || !state.userInput.trim()
    ? dialogue
    : [...dialogue, { role: 'user' as const, content: state.userInput.trim() }].slice(-PROTECTED_DIALOGUE_TAIL);
  const messages = mergeAdjacentSameRole(trimToBudget(protectedDialogue, maxTotalChars));
  const systemPrompt = [
    FINAL_ANSWER_SYSTEM_PROMPT,
    buildFinalToolContext(state, evidence, { maxToolContextChars })
  ].filter(Boolean).join('\n\n');
  return { messages, systemPrompt };
};
