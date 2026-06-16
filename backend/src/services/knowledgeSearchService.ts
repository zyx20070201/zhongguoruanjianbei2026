import { DocumentChunkRecord, documentChunkStore } from './documentChunkStore';
import { embeddingService } from './embeddingService';
import { vectorStoreService, VectorSearchResult } from './vectorStoreService';
import { KnowledgeChunkType } from './chunkSchema';
import prisma from '../config/db';
import { visibleWorkspaceKnowledgeWhere } from './fileObjectVisibility';

export interface KnowledgeSearchResult {
  chunkId: string;
  fileObjectId: string;
  fileName: string;
  path: string;
  chunkText: string;
  summary?: string | null;
  score: number;
  rank: number;
  matchedTerms: string[];
  scoreBreakdown: {
    lexical: number;
    phrase: number;
    semantic: number;
    vector: number;
    rerank: number;
    recency: number;
    fileBoost: number;
    diversityPenalty: number;
  };
  retrievalReason: string;
  metadata: Record<string, unknown>;
  supportSnippets?: Array<{
    text: string;
    locator?: Record<string, unknown>;
    score?: number;
  }>;
  citationQuality?: {
    supportCount: number;
    sourceCount: number;
    grounded: boolean;
  };
}

interface Candidate {
  chunk: DocumentChunkRecord;
  score: number;
  matchedTerms: string[];
  scoreBreakdown: KnowledgeSearchResult['scoreBreakdown'];
  sources: Set<'lexical' | 'vector'>;
  warnings?: string[];
}

interface Bm25Stats {
  documentFrequency: Map<string, number>;
  documentCount: number;
  averageDocumentLength: number;
}

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const DEFAULT_CANDIDATE_LIMIT = Number(process.env.CONTEXT_SEARCH_CANDIDATES || 250);
const INVERTED_CANDIDATE_LIMIT = Number(process.env.CONTEXT_INVERTED_CANDIDATES || 160);
const LEXICAL_TOP_K = Number(process.env.CONTEXT_LEXICAL_TOP_K || 40);
const VECTOR_TOP_K = Number(process.env.CONTEXT_VECTOR_TOP_K || 40);
const RERANK_TOP_K = Number(process.env.CONTEXT_RERANK_TOP_K || 24);

const emptyBreakdown = (): KnowledgeSearchResult['scoreBreakdown'] => ({
  lexical: 0,
  phrase: 0,
  semantic: 0,
  vector: 0,
  rerank: 0,
  recency: 0,
  fileBoost: 0,
  diversityPenalty: 0
});

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

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .flatMap(cjkNgrams)
    .filter((token, index, all) => all.indexOf(token) === index)
    .slice(0, 80);

const normalizeVector = (terms: string[]) => {
  const counts = new Map<string, number>();
  terms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
  const norm = Math.sqrt(Array.from(counts.values()).reduce((sum, value) => sum + value * value, 0)) || 1;
  return { counts, norm };
};

const cosine = (leftTerms: string[], rightTerms: string[]) => {
  if (leftTerms.length === 0 || rightTerms.length === 0) return 0;
  const left = normalizeVector(leftTerms);
  const right = normalizeVector(rightTerms);
  let dot = 0;
  left.counts.forEach((value, term) => {
    dot += value * (right.counts.get(term) || 0);
  });
  return dot / (left.norm * right.norm);
};

const unique = <T>(items: T[]) => items.filter((item, index, all) => all.indexOf(item) === index);

const buildBm25Stats = (chunks: DocumentChunkRecord[]): Bm25Stats => {
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;

  chunks.forEach((chunk) => {
    const terms = tokenize(`${chunk.summary || ''}\n${chunk.text}`).slice(0, 500);
    totalLength += terms.length;
    new Set(terms).forEach((term) => documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1));
  });

  return {
    documentFrequency,
    documentCount: Math.max(1, chunks.length),
    averageDocumentLength: Math.max(1, totalLength / Math.max(1, chunks.length))
  };
};

const bm25 = (queryTerms: string[], documentTerms: string[], stats?: Bm25Stats) => {
  if (!stats || queryTerms.length === 0 || documentTerms.length === 0) return 0;
  const k1 = 1.5;
  const b = 0.75;
  const termCounts = new Map<string, number>();
  documentTerms.forEach((term) => termCounts.set(term, (termCounts.get(term) || 0) + 1));

  return unique(queryTerms).reduce((score, term) => {
    const tf = termCounts.get(term) || 0;
    if (tf === 0) return score;
    const df = stats.documentFrequency.get(term) || 0;
    const idf = Math.log(1 + (stats.documentCount - df + 0.5) / (df + 0.5));
    const denominator = tf + k1 * (1 - b + b * (documentTerms.length / stats.averageDocumentLength));
    return score + idf * ((tf * (k1 + 1)) / denominator);
  }, 0);
};

const overlap = (left: string, right: string) => {
  const leftTerms = new Set(tokenize(left).slice(0, 120));
  const rightTerms = tokenize(right).slice(0, 120);
  if (leftTerms.size === 0 || rightTerms.length === 0) return 0;
  const hits = rightTerms.filter((term) => leftTerms.has(term)).length;
  return hits / Math.max(leftTerms.size, rightTerms.length);
};

const scoreLexical = (query: string, terms: string[], chunk: DocumentChunkRecord, stats?: Bm25Stats) => {
  const text = chunk.text;
  const summary = chunk.summary || '';
  const sourceText = `${chunk.fileName || ''}\n${chunk.filePath || ''}`;
  const lowerText = text.toLowerCase();
  const lowerSummary = summary.toLowerCase();
  const lowerSource = sourceText.toLowerCase();
  const documentTerms = tokenize(`${sourceText}\n${summary}\n${text}`).slice(0, 500);
  const matchedTerms: string[] = [];
  let lexical = bm25(terms, documentTerms, stats) * 4;
  let phrase = 0;

  if (query && lowerText.includes(query.toLowerCase())) phrase += 12;
  if (query && lowerSummary.includes(query.toLowerCase())) phrase += 6;
  if (query && lowerSource.includes(query.toLowerCase())) phrase += 8;

  for (const term of terms) {
    let matched = false;
    if (lowerSource.includes(term)) {
      lexical += 3.2;
      matched = true;
    }
    if (lowerText.includes(term)) {
      lexical += 2.4;
      matched = true;
    }
    if (lowerSummary.includes(term)) {
      lexical += 1.2;
      matched = true;
    }
    if (matched) matchedTerms.push(term);
  }

  const semantic = cosine(terms, documentTerms.slice(0, 240)) * 18;

  return {
    lexical,
    phrase,
    semantic,
    matchedTerms: unique(matchedTerms).slice(0, 12),
    score: lexical + phrase + semantic
  };
};

const recencyScore = (chunk: DocumentChunkRecord) => {
  const ageMs = chunk.updatedAt ? Math.max(0, Date.now() - chunk.updatedAt.getTime()) : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(ageMs) ? Math.max(0, 1.5 - ageMs / (1000 * 60 * 60 * 24 * 30)) : 0;
};

const fileBoost = (chunk: DocumentChunkRecord, activeFileId?: string | null, fileIds?: string[]) =>
  activeFileId && chunk.fileObjectId === activeFileId ? 4 : fileIds?.includes(chunk.fileObjectId) ? 1.5 : 0;

const mergeCandidate = (map: Map<string, Candidate>, next: Candidate) => {
  const existing = map.get(next.chunk.chunkId);
  if (!existing) {
    map.set(next.chunk.chunkId, next);
    return;
  }

  existing.score += next.score;
  existing.matchedTerms = unique([...existing.matchedTerms, ...next.matchedTerms]).slice(0, 16);
  existing.sources = new Set([...existing.sources, ...next.sources]);
  existing.warnings = [...(existing.warnings || []), ...(next.warnings || [])];
  Object.entries(next.scoreBreakdown).forEach(([key, value]) => {
    existing.scoreBreakdown[key as keyof KnowledgeSearchResult['scoreBreakdown']] += value;
  });
};

const normalizeVectorScore = (score: number) => Math.max(0, Math.min(1, score)) * 24;

const vectorPayloadToChunk = (item: VectorSearchResult): DocumentChunkRecord => ({
  chunkId: item.chunkId,
  workspaceId: String(item.payload.workspaceId || ''),
  fileObjectId: String(item.payload.fileObjectId || ''),
  fileId: String(item.payload.fileId || item.payload.fileObjectId || ''),
  fileName: item.payload.fileName,
  filePath: item.payload.filePath,
  chunkIndex: Number(item.payload.chunkIndex || 0),
  text: String(item.payload.text || ''),
  summary: item.payload.summary ?? null,
  tokenEstimate: Number(item.payload.tokenEstimate || 0),
  parentId: typeof item.payload.parentId === 'string' ? item.payload.parentId : null,
  chunkType: (typeof item.payload.chunkType === 'string' ? item.payload.chunkType : 'text') as KnowledgeChunkType,
  sourceHash: typeof item.payload.sourceHash === 'string' ? item.payload.sourceHash : '',
  headingPath: Array.isArray(item.payload.headingPath) ? item.payload.headingPath.filter((value: unknown): value is string => typeof value === 'string') : [],
  locator: item.payload.locator || {},
  metadata: item.payload.metadata || {},
  updatedAt: item.payload.updatedAt ? new Date(item.payload.updatedAt) : undefined
});

const explainReason = (item: Candidate) => {
  const parts = [];
  if (item.sources.has('lexical')) parts.push('BM25/关键词候选');
  if (item.sources.has('vector')) parts.push('Qdrant 向量候选');
  if (item.scoreBreakdown.rerank > 0) parts.push('bge-reranker-v2-m3 重排靠前');
  if (item.scoreBreakdown.phrase > 0) parts.push('命中完整问题短语');
  if (item.matchedTerms.length) parts.push(`命中关键词：${item.matchedTerms.slice(0, 5).join('、')}`);
  if (item.scoreBreakdown.fileBoost > 0) parts.push('来自当前上下文范围');
  if (item.warnings?.length) parts.push(`降级：${item.warnings.join('；')}`);
  return parts.join('；') || '综合排序靠前';
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class KnowledgeSearchService {
  async search(input: {
    workspaceId: string;
    query: string;
    fileIds?: string[];
    limit?: number;
    activeFileId?: string | null;
    requireDiversity?: boolean;
    candidateLimit?: number;
    includeChatScoped?: boolean;
    visibleWorkspaceOnly?: boolean;
  }): Promise<KnowledgeSearchResult[]> {
    const query = input.query.trim();
    const terms = tokenize(query);
    const limit = Math.min(Math.max(input.limit || 6, 1), 20);

    if (terms.length === 0 && !query) return [];
    let effectiveFileIds = input.fileIds;
    if (input.visibleWorkspaceOnly && !input.fileIds?.length && !input.includeChatScoped) {
      const visibleFiles = await prisma.fileSystemObject.findMany({
        where: {
          workspaceId: input.workspaceId,
          nodeType: 'file',
          scope: { not: 'chat' },
          ...visibleWorkspaceKnowledgeWhere
        },
        select: { id: true },
        orderBy: [{ updatedAt: 'desc' }, { path: 'asc' }],
        take: Number(process.env.KNOWLEDGE_VISIBLE_FILE_FILTER_MAX || 5000)
      });
      effectiveFileIds = visibleFiles.map((file) => file.id);
      if (!effectiveFileIds.length) return [];
    }

    const lexicalCandidateTake =
      input.candidateLimit != null
        ? Math.max(LEXICAL_TOP_K, Math.min(input.candidateLimit, DEFAULT_CANDIDATE_LIMIT))
        : DEFAULT_CANDIDATE_LIMIT;
    const invertedCandidateTake = Math.max(
      LEXICAL_TOP_K,
      Math.min(input.candidateLimit || INVERTED_CANDIDATE_LIMIT, Number(process.env.KNOWLEDGE_INVERTED_MAX_RESULTS || 500))
    );
    let lexicalChunks = await documentChunkStore
      .searchByTerms({
        workspaceId: input.workspaceId,
        terms,
        fileIds: effectiveFileIds,
        take: invertedCandidateTake,
        includeChatScoped: input.includeChatScoped
      })
      .catch(() => [] as DocumentChunkRecord[]);
    if (lexicalChunks.length < Math.min(LEXICAL_TOP_K, 12)) {
      lexicalChunks = await documentChunkStore.searchableChunks({
        workspaceId: input.workspaceId,
        fileIds: effectiveFileIds,
        includeChatScoped: input.includeChatScoped,
        take: Math.max(
          lexicalCandidateTake,
          effectiveFileIds?.length
            ? Math.min(Number(process.env.CONTEXT_EXPLICIT_FILE_CANDIDATES || 6000), effectiveFileIds.length * 240)
            : 0
        )
      });
    }
    const vectorWarnings: string[] = [];
    const vectorResults = await vectorStoreService
      .search({
        workspaceId: input.workspaceId,
        query,
        fileIds: effectiveFileIds,
        limit: VECTOR_TOP_K
      })
      .catch((error) => {
        vectorWarnings.push(`向量检索不可用：${errorMessage(error)}`);
        return [] as VectorSearchResult[];
      });

    const candidates = new Map<string, Candidate>();
    const bm25Stats = buildBm25Stats(lexicalChunks);

    lexicalChunks
      .map((chunk) => {
        const lexical = scoreLexical(query, terms, chunk, bm25Stats);
        const recency = recencyScore(chunk);
        const boost = fileBoost(chunk, input.activeFileId, effectiveFileIds);
        const breakdown = emptyBreakdown();
        breakdown.lexical = Number(lexical.lexical.toFixed(3));
        breakdown.phrase = Number(lexical.phrase.toFixed(3));
        breakdown.semantic = Number(lexical.semantic.toFixed(3));
        breakdown.recency = Number(recency.toFixed(3));
        breakdown.fileBoost = boost;
        return {
          chunk,
          score: lexical.score + recency + boost,
          matchedTerms: lexical.matchedTerms,
          scoreBreakdown: breakdown,
          sources: new Set<'lexical' | 'vector'>(['lexical'])
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, LEXICAL_TOP_K)
      .forEach((candidate) => mergeCandidate(candidates, candidate));

    vectorResults.forEach((item) => {
      const chunk = vectorPayloadToChunk(item);
      if (!chunk.text || !chunk.workspaceId || !chunk.fileObjectId) return;
      const lexical = scoreLexical(query, terms, chunk, bm25Stats);
      const recency = recencyScore(chunk);
      const boost = fileBoost(chunk, input.activeFileId, effectiveFileIds);
      const vector = normalizeVectorScore(item.score);
      const breakdown = emptyBreakdown();
      breakdown.vector = Number(vector.toFixed(3));
      breakdown.lexical = Number(Math.min(lexical.lexical, 8).toFixed(3));
      breakdown.phrase = Number(lexical.phrase.toFixed(3));
      breakdown.semantic = Number(lexical.semantic.toFixed(3));
      breakdown.recency = Number(recency.toFixed(3));
      breakdown.fileBoost = boost;
      mergeCandidate(candidates, {
        chunk,
        score: vector + Math.min(lexical.score, 10) + recency + boost,
        matchedTerms: lexical.matchedTerms,
        scoreBreakdown: breakdown,
        sources: new Set<'lexical' | 'vector'>(['vector'])
      });
    });

    const merged = Array.from(candidates.values()).sort((left, right) => right.score - left.score);
    const diversified = this.mmr(merged, input.requireDiversity !== false, RERANK_TOP_K);
    if (vectorWarnings.length) {
      diversified.forEach((candidate) => {
        candidate.warnings = [...(candidate.warnings || []), ...vectorWarnings];
      });
    }
    const expanded = await this.expandSmallToBig(input.workspaceId, diversified);
    const reranked = await this.rerank(query, expanded, vectorWarnings);

    return reranked.slice(0, limit).map((candidate, index) => ({
      chunkId: candidate.chunk.chunkId,
      fileObjectId: candidate.chunk.fileObjectId,
      fileName: candidate.chunk.fileName || 'Untitled',
      path: candidate.chunk.filePath || '',
      chunkText: candidate.chunk.text,
      summary: candidate.chunk.summary,
      score: Number(candidate.score.toFixed(3)),
      rank: index + 1,
      matchedTerms: candidate.matchedTerms,
      scoreBreakdown: Object.fromEntries(
        Object.entries(candidate.scoreBreakdown).map(([key, value]) => [key, Number(value.toFixed(3))])
      ) as KnowledgeSearchResult['scoreBreakdown'],
      retrievalReason: explainReason(candidate),
      metadata: {
        ...candidate.chunk.metadata,
        locator: candidate.chunk.locator
      },
      supportSnippets: Array.isArray(candidate.chunk.metadata.supportSnippets)
        ? candidate.chunk.metadata.supportSnippets as KnowledgeSearchResult['supportSnippets']
        : undefined,
      citationQuality:
        candidate.chunk.metadata.citationQuality && typeof candidate.chunk.metadata.citationQuality === 'object'
          ? candidate.chunk.metadata.citationQuality as KnowledgeSearchResult['citationQuality']
          : undefined
    }));
  }

  private mmr(candidates: Candidate[], enabled: boolean, limit: number) {
    if (!enabled) return candidates.slice(0, limit);
    const selected: Candidate[] = [];
    const pool = [...candidates];
    while (selected.length < limit && pool.length) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      pool.forEach((candidate, index) => {
        const diversityPenalty = selected.reduce(
          (max, chosen) => Math.max(max, overlap(candidate.chunk.text, chosen.chunk.text)),
          0
        ) * 5;
        const diversifiedScore = candidate.score - diversityPenalty;
        if (diversifiedScore > bestScore) {
          bestScore = diversifiedScore;
          bestIndex = index;
        }
      });

      const [picked] = pool.splice(bestIndex, 1);
      const diversityPenalty = Math.max(0, picked.score - bestScore);
      picked.score = bestScore;
      picked.scoreBreakdown.diversityPenalty = Number(diversityPenalty.toFixed(3));
      selected.push(picked);
    }
    return selected;
  }

  private async rerank(query: string, candidates: Candidate[], existingWarnings: string[] = []) {
    if (candidates.length === 0) return candidates;

    const rerankResults = await embeddingService
      .rerank({
        query,
        documents: candidates.map((candidate) => `${candidate.chunk.summary || ''}\n${candidate.chunk.text}`)
      })
      .catch((error) => {
        const warning = `reranker 不可用：${errorMessage(error)}`;
        candidates.forEach((candidate) => {
          candidate.warnings = [...(candidate.warnings || []), ...existingWarnings, warning];
        });
        return [];
      });
    if (rerankResults.length === 0) return candidates.sort((left, right) => right.score - left.score);
    const scoreByIndex = new Map(rerankResults.map((item) => [item.index, item.score]));

    return candidates
      .map((candidate, index) => {
        const rerank = scoreByIndex.get(index) || 0;
        candidate.score += rerank * 30;
        candidate.scoreBreakdown.rerank = Number((rerank * 30).toFixed(3));
        return candidate;
      })
      .sort((left, right) => right.score - left.score);
  }

  private async expandSmallToBig(workspaceId: string, candidates: Candidate[]) {
    const cache = new Map<string, DocumentChunkRecord | null>();
    const siblingCache = new Map<string, DocumentChunkRecord[]>();

    return Promise.all(
      candidates.map(async (candidate) => {
        const parentId = candidate.chunk.parentId;
        if (!parentId || candidate.chunk.chunkType === 'parent') {
          return this.attachCitationEvidence(workspaceId, candidate, siblingCache);
        }

        if (!cache.has(parentId)) {
          cache.set(parentId, await documentChunkStore.getChunkById({ workspaceId, chunkId: parentId }).catch(() => null));
        }
        const parent = cache.get(parentId);
        if (!parent?.text) return candidate;

        const childText = candidate.chunk.text.trim();
        const parentText = parent.text.trim();
        const text = parentText.includes(childText)
          ? parentText
          : `${parentText}\n\nRelevant excerpt:\n${childText}`;

        const expanded: Candidate = {
          ...candidate,
          chunk: {
            ...candidate.chunk,
            text,
            summary: parent.summary || candidate.chunk.summary,
            metadata: {
              ...candidate.chunk.metadata,
              parentChunkId: parent.chunkId,
              parentLocator: parent.locator,
              expandedFromChild: true
            }
          },
          scoreBreakdown: {
            ...candidate.scoreBreakdown,
            semantic: candidate.scoreBreakdown.semantic + 1.2
          }
        };
        return this.attachCitationEvidence(workspaceId, expanded, siblingCache);
      })
    );
  }

  private async attachCitationEvidence(
    workspaceId: string,
    candidate: Candidate,
    siblingCache: Map<string, DocumentChunkRecord[]>
  ): Promise<Candidate> {
    const key = `${candidate.chunk.fileObjectId}:${candidate.chunk.parentId || 'root'}`;
    if (!siblingCache.has(key)) {
      const chunks = await documentChunkStore
        .listFileChunks({
          workspaceId,
          fileObjectId: candidate.chunk.fileObjectId,
          take: Number(process.env.CONTEXT_CITATION_SIBLING_TAKE || 24)
        })
        .catch(() => []);
      siblingCache.set(
        key,
        chunks.filter((chunk) =>
          candidate.chunk.parentId
            ? chunk.parentId === candidate.chunk.parentId || chunk.chunkId === candidate.chunk.parentId
            : Math.abs(chunk.chunkIndex - candidate.chunk.chunkIndex) <= 1
        )
      );
    }

    const supporting = (siblingCache.get(key) || [])
      .filter((chunk) => chunk.chunkId !== candidate.chunk.chunkId && chunk.text.trim())
      .sort((left, right) => Math.abs(left.chunkIndex - candidate.chunk.chunkIndex) - Math.abs(right.chunkIndex - candidate.chunk.chunkIndex))
      .slice(0, 2)
      .map((chunk) => ({
        text: chunk.text.slice(0, 700),
        locator: chunk.locator,
        score: Number(Math.max(0, candidate.score - Math.abs(chunk.chunkIndex - candidate.chunk.chunkIndex)).toFixed(3))
      }));

    return {
      ...candidate,
      chunk: {
        ...candidate.chunk,
        metadata: {
          ...candidate.chunk.metadata,
          supportSnippets: supporting,
          citationQuality: {
            supportCount: supporting.length + 1,
            sourceCount: new Set([candidate.chunk.fileObjectId, ...supporting.map(() => candidate.chunk.fileObjectId)]).size,
            grounded: candidate.score > 0 && candidate.chunk.text.trim().length > 0
          }
        }
      }
    };
  }
}

export const knowledgeSearchService = new KnowledgeSearchService();
