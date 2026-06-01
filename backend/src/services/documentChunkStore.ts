import prisma, { withPrismaRetry } from '../config/db';
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

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const MAX_INDEX_TERMS_PER_CHUNK = Number(process.env.KNOWLEDGE_INVERTED_MAX_TERMS_PER_CHUNK || 120);
const MAX_INVERTED_SEARCH_TERMS = Number(process.env.KNOWLEDGE_INVERTED_MAX_QUERY_TERMS || 32);

const cjkNgrams = (token: string) => {
  if (!CJK_PATTERN.test(token) || token.length <= 2) return [token];

  const grams = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= token.length - size; index += 1) {
      grams.add(token.slice(index, index + size));
    }
  }
  grams.add(token);
  return Array.from(grams);
};

const tokenizeForInvertedIndex = (value: string | null | undefined, maxTerms = MAX_INDEX_TERMS_PER_CHUNK) =>
  String(value || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 64)
    .flatMap(cjkNgrams)
    .slice(0, maxTerms);

const countTerms = (terms: string[]) => {
  const counts = new Map<string, number>();
  terms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
  return counts;
};

const uniqueTerms = (terms: string[], maxTerms = MAX_INVERTED_SEARCH_TERMS) =>
  terms
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2 && term.length <= 64)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, maxTerms);

const uniqueStrings = (values: string[], maxValues = 500) =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, maxValues);

const termsFromStoredChunk = (chunk: DocumentChunkRecord) => {
  const weighted = new Map<string, { termFrequency: number; fieldWeight: number }>();
  const add = (value: string | null | undefined, fieldWeight: number, maxTerms?: number) => {
    const counts = countTerms(tokenizeForInvertedIndex(value, maxTerms));
    counts.forEach((termFrequency, term) => {
      const existing = weighted.get(term);
      if (!existing) {
        weighted.set(term, { termFrequency, fieldWeight });
        return;
      }
      existing.termFrequency += termFrequency;
      existing.fieldWeight = Math.max(existing.fieldWeight, fieldWeight);
    });
  };

  add(`${chunk.fileName || ''}\n${chunk.filePath || ''}\n${chunk.headingPath.join('\n')}`, 3, 80);
  add(chunk.summary || '', 2, 80);
  add(chunk.text || '', 1, MAX_INDEX_TERMS_PER_CHUNK);

  return Array.from(weighted.entries())
    .sort((left, right) => right[1].termFrequency * right[1].fieldWeight - left[1].termFrequency * left[1].fieldWeight)
    .slice(0, MAX_INDEX_TERMS_PER_CHUNK)
    .map(([term, value]) => ({
      chunkId: chunk.chunkId,
      workspaceId: chunk.workspaceId,
      fileObjectId: chunk.fileObjectId,
      term,
      termFrequency: value.termFrequency,
      fieldWeight: value.fieldWeight
    }));
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
  private async deleteTermsForFile(input: { workspaceId: string; fileObjectId: string }) {
    await withPrismaRetry(() =>
      prisma.$executeRawUnsafe(
        'DELETE FROM "KnowledgeChunkTerm" WHERE "workspaceId" = ? AND "fileObjectId" = ?',
        input.workspaceId,
        input.fileObjectId
      )
    );
  }

  private async writeInvertedTerms(chunks: DocumentChunkRecord[]) {
    const rows = chunks.flatMap(termsFromStoredChunk);
    if (rows.length === 0) return;

    const batchSize = Number(process.env.KNOWLEDGE_INVERTED_INSERT_BATCH || 120);
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').join(', ');
      const values = batch.flatMap((row) => [
        row.workspaceId,
        row.fileObjectId,
        row.chunkId,
        row.term,
        row.termFrequency,
        row.fieldWeight
      ]);
      await withPrismaRetry(() =>
        prisma.$executeRawUnsafe(
          `INSERT OR REPLACE INTO "KnowledgeChunkTerm"
            ("workspaceId", "fileObjectId", "chunkId", "term", "termFrequency", "fieldWeight", "updatedAt")
           VALUES ${placeholders}`,
          ...values
        )
      );
    }
  }

  async replaceFileChunks(input: {
    workspaceId: string;
    fileObjectId: string;
    chunks: DocumentChunkInput[];
  }) {
    await this.deleteTermsForFile(input);
    await withPrismaRetry(() =>
      prisma.knowledgeChunk.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          fileObjectId: input.fileObjectId
        }
      })
    );

    if (input.chunks.length === 0) return [];

    const created = await withPrismaRetry(() =>
      prisma.$transaction(
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
      )
    );

    const fileObject = await prisma.fileSystemObject
      .findUnique({
        where: { id: input.fileObjectId },
        select: { id: true, name: true, path: true }
      })
      .catch(() => null);
    const normalized = created.map((chunk) =>
      normalizeChunk({
        ...chunk,
        fileObject: fileObject || undefined
      })
    );

    await this.writeInvertedTerms(normalized).catch((error) => {
      console.warn(`Knowledge inverted index write skipped for ${input.fileObjectId}:`, error);
    });

    return normalized;
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

  async searchableChunks(input: { workspaceId: string; fileIds?: string[]; take?: number; includeChatScoped?: boolean }) {
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.fileIds?.length ? { fileObjectId: { in: input.fileIds } } : {}),
        ...(!input.fileIds?.length && !input.includeChatScoped
          ? { fileObject: { scope: { not: 'chat' } } }
          : {})
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

  async searchByTerms(input: {
    workspaceId: string;
    terms: string[];
    fileIds?: string[];
    take?: number;
    includeChatScoped?: boolean;
  }) {
    const terms = uniqueTerms(input.terms);
    if (terms.length === 0) return [];

    const fileIds = uniqueStrings(input.fileIds || [], 500);
    const take = Math.min(Math.max(input.take || 160, 1), Number(process.env.KNOWLEDGE_INVERTED_MAX_RESULTS || 500));
    const termPlaceholders = terms.map(() => '?').join(', ');
    const fileFilter = fileIds.length ? `AND kct."fileObjectId" IN (${fileIds.map(() => '?').join(', ')})` : '';
    const scopeFilter = !fileIds.length && !input.includeChatScoped ? 'AND f."scope" != ?' : '';
    const values: Array<string | number> = [input.workspaceId, ...terms, ...fileIds];
    if (scopeFilter) values.push('chat');
    values.push(take);

    const hits = await withPrismaRetry(() =>
      prisma.$queryRawUnsafe<Array<{ chunkId: string; invertedScore: number; matchedTermCount: number }>>(
        `SELECT
          kct."chunkId",
          SUM(kct."termFrequency" * kct."fieldWeight") AS "invertedScore",
          COUNT(DISTINCT kct."term") AS "matchedTermCount"
        FROM "KnowledgeChunkTerm" kct
        ${scopeFilter ? 'JOIN "FileSystemObject" f ON f."id" = kct."fileObjectId"' : ''}
        WHERE kct."workspaceId" = ?
          AND kct."term" IN (${termPlaceholders})
          ${fileFilter}
          ${scopeFilter}
        GROUP BY kct."chunkId"
        ORDER BY "matchedTermCount" DESC, "invertedScore" DESC
        LIMIT ?`,
        ...values
      )
    );

    if (hits.length === 0) return [];

    const rankById = new Map(hits.map((hit, index) => [hit.chunkId, index]));
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        workspaceId: input.workspaceId,
        id: { in: hits.map((hit) => hit.chunkId) }
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

    return chunks
      .map(normalizeChunk)
      .sort((left, right) => (rankById.get(left.chunkId) ?? Number.MAX_SAFE_INTEGER) - (rankById.get(right.chunkId) ?? Number.MAX_SAFE_INTEGER));
  }

  async backfillInvertedIndex(input: { workspaceId?: string; fileObjectId?: string; batchSize?: number } = {}) {
    const batchSize = Math.min(Math.max(input.batchSize || 200, 1), 1000);
    let cursor: string | undefined;
    let indexedChunks = 0;

    for (;;) {
      const chunks = await prisma.knowledgeChunk.findMany({
        where: {
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.fileObjectId ? { fileObjectId: input.fileObjectId } : {}),
          ...(cursor ? { id: { gt: cursor } } : {})
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
        orderBy: { id: 'asc' },
        take: batchSize
      });

      if (chunks.length === 0) break;
      const normalized = chunks.map(normalizeChunk);
      await this.writeInvertedTerms(normalized);
      indexedChunks += normalized.length;
      cursor = chunks[chunks.length - 1].id;
    }

    return { indexedChunks };
  }
}

export const documentChunkStore = new DocumentChunkStore();
