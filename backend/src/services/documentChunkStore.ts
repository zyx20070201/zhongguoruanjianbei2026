import prisma from '../config/db';
import { ContextLocator } from '../types/contextSystem';
import {
  KnowledgeChunkType,
  UnifiedChunkSchema,
  buildChunkId,
  estimateChunkTokens,
  normalizeHeadingPath,
  sourceHashForChunk
} from './chunkSchema';

export interface DocumentChunkInput extends Partial<UnifiedChunkSchema> {
  workspaceId: string;
  fileObjectId: string;
  fileId?: string;
  chunkIndex: number;
  text: string;
  summary?: string | null;
  tokenEstimate?: number;
  source?: string;
  purpose?: string;
  parentId?: string | null;
  chunkType?: KnowledgeChunkType;
  sourceHash?: string;
  headingPath?: string[];
  locator?: ContextLocator;
  metadata?: Record<string, unknown>;
}

export interface DocumentChunkRecord extends UnifiedChunkSchema {
  chunkId: string;
  workspaceId: string;
  fileObjectId: string;
  fileId: string;
  fileName?: string;
  filePath?: string;
  chunkIndex: number;
  text: string;
  summary?: string | null;
  tokenEstimate: number;
  parentId?: string | null;
  chunkType: KnowledgeChunkType;
  sourceHash: string;
  headingPath: string[];
  locator: ContextLocator;
  metadata: Record<string, unknown>;
  updatedAt?: Date;
}

const parseMetadata = (value?: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const sanitizeLocator = (locator?: ContextLocator | null): ContextLocator => {
  if (!locator) return {};
  return {
    page: locator.page,
    pageStart: locator.pageStart,
    pageEnd: locator.pageEnd,
    visiblePages: locator.visiblePages,
    primaryPage: locator.primaryPage,
    scrollRatio: locator.scrollRatio,
    startLine: locator.startLine,
    endLine: locator.endLine,
    lineStart: locator.lineStart,
    lineEnd: locator.lineEnd,
    cursorLine: locator.cursorLine,
    blockId: locator.blockId,
    blockIds: locator.blockIds,
    blockIndex: locator.blockIndex,
    headingPath: locator.headingPath,
    paragraphIndex: locator.paragraphIndex,
    chunkIndex: locator.chunkIndex,
    charStart: locator.charStart,
    charEnd: locator.charEnd,
    textLength: locator.textLength,
    rects: locator.rects,
    bbox: locator.bbox,
    timestampStart: locator.timestampStart,
    timestampEnd: locator.timestampEnd
  };
};

const normalizeChunk = (chunk: any): DocumentChunkRecord => {
  const metadata = parseMetadata(chunk.metadataJson);
  const metadataLocator =
    metadata.locator && typeof metadata.locator === 'object'
      ? (metadata.locator as ContextLocator)
      : (metadata as ContextLocator);
  const fileId = String(metadata.fileId || chunk.fileObjectId);
  const headingPath = normalizeHeadingPath(metadata.headingPath || metadataLocator.headingPath);
  const chunkType = (typeof metadata.chunkType === 'string' ? metadata.chunkType : 'text') as KnowledgeChunkType;
  const locator = sanitizeLocator({ ...metadataLocator, headingPath, chunkIndex: chunk.chunkIndex });
  const sourceHash =
    typeof metadata.sourceHash === 'string'
      ? metadata.sourceHash
      : sourceHashForChunk({
          fileId,
          chunkType,
          text: chunk.text,
          locator,
          headingPath
        });
  return {
    chunkId: chunk.id,
    workspaceId: chunk.workspaceId,
    fileObjectId: chunk.fileObjectId,
    fileId,
    fileName: chunk.fileObject?.name,
    filePath: chunk.fileObject?.path,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    summary: chunk.summary,
    tokenEstimate: chunk.tokenEstimate || estimateChunkTokens(chunk.text),
    parentId: typeof metadata.parentId === 'string' ? metadata.parentId : null,
    chunkType,
    sourceHash,
    headingPath,
    locator,
    metadata,
    updatedAt: chunk.updatedAt
  };
};

export class DocumentChunkStore {
  async replaceFileChunks(input: {
    workspaceId: string;
    fileObjectId: string;
    chunks: DocumentChunkInput[];
  }) {
    await prisma.knowledgeChunk.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId
      }
    });

    if (input.chunks.length === 0) return [];

    const created = await prisma.$transaction(
      input.chunks.map((chunk, index) => {
        const fileId = chunk.fileId || chunk.fileObjectId;
        const chunkType = chunk.chunkType || 'text';
        const headingPath = normalizeHeadingPath(chunk.headingPath || chunk.locator?.headingPath);
        const locator = sanitizeLocator({ ...chunk.locator, headingPath, chunkIndex: index });
        const sourceHash =
          chunk.sourceHash ||
          sourceHashForChunk({
            fileId,
            chunkType,
            text: chunk.text,
            locator,
            headingPath
          });
        const chunkId = chunk.chunkId || buildChunkId({ workspaceId: input.workspaceId, fileId, chunkType, sourceHash });
        return prisma.knowledgeChunk.create({
          data: {
            id: chunkId,
            workspaceId: input.workspaceId,
            fileObjectId: input.fileObjectId,
            chunkIndex: index,
            text: chunk.text,
            summary: chunk.summary || null,
            tokenEstimate: chunk.tokenEstimate || estimateChunkTokens(chunk.text),
            metadataJson: JSON.stringify({
              schemaVersion: 2,
              workspaceId: input.workspaceId,
              fileId,
              parentId: chunk.parentId || null,
              chunkType,
              text: chunk.text,
              sourceHash,
              headingPath,
              source: chunk.source || 'workspace-file',
              purpose: chunk.purpose || 'grounding',
              ...(chunk.metadata || {}),
              chunks: undefined,
              locator,
              ...locator,
              chunkIndex: index
            })
          }
        });
      })
    );

    return created.map(normalizeChunk);
  }

  async listFileChunks(input: { workspaceId: string; fileObjectId: string; take?: number }) {
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId
      },
      include: {
        fileObject: {
          select: {
            name: true,
            path: true
          }
        }
      },
      orderBy: { chunkIndex: 'asc' },
      take: input.take
    });

    return chunks.map(normalizeChunk);
  }

  async getChunkById(input: { workspaceId: string; chunkId: string }) {
    const chunk = await prisma.knowledgeChunk.findFirst({
      where: {
        id: input.chunkId,
        workspaceId: input.workspaceId
      },
      include: {
        fileObject: {
          select: {
            id: true,
            name: true,
            path: true
          }
        }
      }
    });

    return chunk ? normalizeChunk(chunk) : null;
  }

  async searchableChunks(input: { workspaceId: string; fileIds?: string[]; take?: number }) {
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.fileIds?.length ? { fileObjectId: { in: input.fileIds } } : {})
      },
      include: {
        fileObject: {
          select: {
            id: true,
            name: true,
            path: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: input.take || 250
    });

    return chunks.map(normalizeChunk);
  }
}

export const documentChunkStore = new DocumentChunkStore();
