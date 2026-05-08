import crypto from 'crypto';
import { ContextLocator } from '../types/contextSystem';

export type KnowledgeChunkType = 'parent' | 'text' | 'table' | 'list' | 'code' | 'summary';

export interface UnifiedChunkSchema {
  chunkId: string;
  workspaceId: string;
  fileId: string;
  parentId?: string | null;
  chunkType: KnowledgeChunkType;
  text: string;
  summary?: string | null;
  metadata: Record<string, unknown>;
  locator: ContextLocator;
  headingPath: string[];
  sourceHash: string;
  tokenEstimate: number;
  chunkIndex: number;
}

export interface BuildChunkIdInput {
  workspaceId: string;
  fileId: string;
  chunkType: KnowledgeChunkType;
  sourceHash: string;
}

export const stableHash = (value: unknown) =>
  crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');

export const buildChunkId = (input: BuildChunkIdInput) =>
  stableHash([input.workspaceId, input.fileId, input.chunkType, input.sourceHash]).slice(0, 32);

export const estimateChunkTokens = (text: string) => Math.ceil(text.length / 2);

export const normalizeHeadingPath = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

export const sourceHashForChunk = (input: {
  fileId: string;
  chunkType: KnowledgeChunkType;
  text: string;
  locator?: ContextLocator;
  headingPath?: string[];
}) =>
  stableHash({
    fileId: input.fileId,
    chunkType: input.chunkType,
    text: input.text.trim(),
    locator: input.locator || {},
    headingPath: input.headingPath || []
  });
