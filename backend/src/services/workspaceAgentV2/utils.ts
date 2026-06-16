import crypto from 'crypto';
import type { TerminalChatFileRefV2, TerminalMessageV2, WorkspaceAgentTraceEntry } from './types';

export const nowIso = () => new Date().toISOString();

export const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const clip = (value: unknown, maxLength = 1600) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

export const clipPreserveWhitespace = (value: unknown, maxLength = 1600) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

export const compactJson = (value: unknown, maxLength = 3000) => clip(JSON.stringify(value, null, 2), maxLength);

export const compactJsonPreserveWhitespace = (value: unknown, maxLength = 3000) =>
  clipPreserveWhitespace(JSON.stringify(value, null, 2), maxLength);

export const normalizeMessages = (messages: unknown): TerminalMessageV2[] =>
  Array.isArray(messages)
    ? messages
        .map((message: any) => {
          const files = normalizeChatFiles(message?.files);
          return {
            role: message?.role === 'assistant' ? 'assistant' as const : 'user' as const,
            content: String(message?.content || '').trim(),
            files
          };
        })
        .filter((message) => message.content || message.files?.length)
    : [];

export const normalizeChatFiles = (value: unknown): TerminalChatFileRefV2[] =>
  Array.isArray(value)
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

export const latestUserMessage = (messages: TerminalMessageV2[]) =>
  [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

export const unique = (items: string[], limit = 50) =>
  Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, limit);

export const selectedFileIdsFromInput = (input: {
  selectedSourceIds?: string[];
  selectedSources?: Array<{ fileId: string; mode?: string }>;
  chatFiles?: TerminalChatFileRefV2[];
  messages?: TerminalMessageV2[];
}) =>
  unique([
    ...(input.selectedSourceIds || []),
    ...(input.selectedSources || []).map((item) => item.fileId),
    ...(input.chatFiles || []).map((file) => file.id),
    ...(input.messages || []).flatMap((message) => normalizeChatFiles(message.files).map((file) => file.id))
  ], 36);

export const traceEntry = (node: string, message: string, data?: Record<string, unknown>): WorkspaceAgentTraceEntry => ({
  id: createId('trace'),
  node,
  message,
  at: nowIso(),
  data
});
