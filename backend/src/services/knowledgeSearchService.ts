import prisma from '../config/db';

export interface KnowledgeSearchResult {
  chunkId: string;
  fileObjectId: string;
  fileName: string;
  path: string;
  chunkText: string;
  summary?: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 24);

const parseMetadata = (value?: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const scoreChunk = (query: string, terms: string[], text: string, summary?: string | null) => {
  const lowerText = text.toLowerCase();
  const lowerSummary = summary?.toLowerCase() || '';
  let score = 0;

  if (query && lowerText.includes(query.toLowerCase())) score += 8;

  for (const term of terms) {
    if (lowerText.includes(term)) score += 2;
    if (lowerSummary.includes(term)) score += 1;
  }

  return score;
};

export class KnowledgeSearchService {
  async search(input: {
    workspaceId: string;
    query: string;
    fileIds?: string[];
    limit?: number;
  }): Promise<KnowledgeSearchResult[]> {
    const terms = tokenize(input.query);
    const limit = Math.min(Math.max(input.limit || 6, 1), 20);

    if (terms.length === 0 && !input.query.trim()) return [];

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
      take: 250
    });

    return chunks
      .map((chunk) => ({
        chunkId: chunk.id,
        fileObjectId: chunk.fileObjectId,
        fileName: chunk.fileObject.name,
        path: chunk.fileObject.path,
        chunkText: chunk.text,
        summary: chunk.summary,
        score: scoreChunk(input.query.trim(), terms, chunk.text, chunk.summary),
        metadata: parseMetadata(chunk.metadataJson)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export const knowledgeSearchService = new KnowledgeSearchService();
