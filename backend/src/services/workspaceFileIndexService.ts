import prisma from '../config/db';
import { getExtension } from '../utils/path';
import { isTextLikeFile } from './fileTypeService';
import { knowledgeIndexingService } from './knowledgeIndexingService';
import { knowledgeSearchService, KnowledgeSearchResult } from './knowledgeSearchService';
import { visibleWorkspaceKnowledgeWhere } from './fileObjectVisibility';

export interface WorkspaceFileCard {
  fileObjectId: string;
  fileName: string;
  path: string;
  extension?: string | null;
  mimeType?: string | null;
  fileCategory?: string | null;
  resourceType?: string | null;
  scope?: string | null;
  origin?: string | null;
  size?: number | null;
  updatedAt?: string;
  indexable: boolean;
  indexStatus: 'indexed' | 'missing' | 'running' | 'degraded' | 'failed' | 'skipped' | 'not_indexable';
  chunkCount: number;
  tokenEstimate: number;
  summary: string;
  topics: string[];
  sampleHeadings: string[];
  latestJob?: {
    id: string;
    status: string;
    extractor?: string | null;
    chunkCount: number;
    stage?: string;
    reason?: string;
    completedAt?: string | null;
    error?: string | null;
  } | null;
}

export interface WorkspaceFileSearchResult {
  query: string;
  mode: WorkspaceFileRetrievalMode;
  files: WorkspaceFileCard[];
  chunks: KnowledgeSearchResult[];
  coverage: {
    totalFiles: number;
    indexableFiles: number;
    indexedFiles: number;
    missingIndexFiles: number;
    failedFiles: number;
    searchedFileIds: string[];
    autoIndexReport?: WorkspaceIndexReport;
  };
}

export type WorkspaceFileRetrievalMode = 'overview' | 'targeted_search' | 'deep_read';

export interface WorkspaceIndexReport {
  workspaceId: string;
  totalFiles: number;
  indexableFiles: number;
  skippedFiles: number;
  attemptedFiles: number;
  completedFiles: number;
  degradedFiles: number;
  failedFiles: number;
  jobs: Array<{
    fileObjectId: string;
    fileName: string;
    status: string;
    chunkCount: number;
    error?: string | null;
  }>;
}

const INDEXABLE_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'ppt',
  'pptx',
  'md',
  'markdown',
  'txt',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'scss',
  'less',
  'js',
  'ts',
  'tsx',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'java',
  'cpp',
  'c',
  'cc',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'sql',
  'sh',
  'bash',
  'zsh'
]);

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'file',
  'workspace',
  'global',
  'source',
  'sources',
  'resource',
  'resources'
]);

const clip = (value: unknown, maxLength = 600) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const parseJson = (value?: string | null): Record<string, any> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseLifecycle = (value?: string | null): Record<string, any> => parseJson(value);

const hasRecoverableKnowledgeGraphOnlyError = (job: any, chunkCount: number) => {
  if (!job || chunkCount <= 0) return false;
  const lifecycle = parseLifecycle(job.errorMessage);
  return (
    String(job.status || '').toLowerCase() === 'degraded' &&
    typeof lifecycle.courseKnowledgeGraphError === 'string' &&
    !lifecycle.vectorError
  );
};

const indexableFile = (file: any) => {
  if (file?.nodeType !== 'file') return false;
  const extension = String(file.extension || getExtension(file.name || '') || '').toLowerCase();
  return Boolean(
    isTextLikeFile(file) ||
    INDEXABLE_EXTENSIONS.has(extension) ||
    String(file.fileCategory || '').toLowerCase() === 'generated' ||
    String(file.resourceType || '').toLowerCase() === 'generated'
  );
};

const tokenize = (value: string) => {
  const lower = value.toLowerCase();
  const rough = lower
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

  const expanded: string[] = [];
  rough.forEach((token) => {
    expanded.push(token);
    if (CJK_PATTERN.test(token) && token.length > 2) {
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          expanded.push(token.slice(index, index + size));
        }
      }
    }
  });
  return Array.from(new Set(expanded)).slice(0, 80);
};

const extractTopics = (value: string, limit = 10) => {
  const counts = new Map<string, number>();
  tokenize(value)
    .filter((token) => token.length >= 3 || CJK_PATTERN.test(token))
    .forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term)
    .slice(0, limit);
};

const lifecycleStage = (job: any) => {
  const lifecycle = parseLifecycle(job?.errorMessage);
  const knowledgeGraphOnlyError =
    typeof lifecycle.courseKnowledgeGraphError === 'string' &&
    !lifecycle.vectorError;
  return {
    stage: typeof lifecycle.stage === 'string' ? lifecycle.stage : undefined,
    reason: typeof lifecycle.reason === 'string' ? lifecycle.reason : undefined,
    error: typeof lifecycle.vectorError === 'string'
      ? lifecycle.vectorError
      : knowledgeGraphOnlyError
        ? undefined
        : typeof lifecycle.courseKnowledgeGraphError === 'string'
        ? lifecycle.courseKnowledgeGraphError
        : job?.status === 'failed'
          ? job?.errorMessage
          : undefined
  };
};

const cardStatus = (input: { indexable: boolean; chunkCount: number; latestJob?: any | null }): WorkspaceFileCard['indexStatus'] => {
  if (!input.indexable) return 'not_indexable';
  const status = String(input.latestJob?.status || '').toLowerCase();
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'degraded') {
    return hasRecoverableKnowledgeGraphOnlyError(input.latestJob, input.chunkCount) ? 'indexed' : 'degraded';
  }
  if (status === 'skipped') return input.chunkCount > 0 ? 'skipped' : 'missing';
  if (input.chunkCount > 0) return 'indexed';
  return 'missing';
};

const scoreCard = (query: string, terms: string[], card: WorkspaceFileCard) => {
  if (!query.trim()) return card.indexStatus === 'indexed' ? 2 : 1;
  const name = card.fileName.toLowerCase();
  const path = card.path.toLowerCase();
  const summary = card.summary.toLowerCase();
  const topicSet = new Set(card.topics.map((topic) => topic.toLowerCase()));
  let score = 0;
  if (name.includes(query.toLowerCase())) score += 35;
  if (path.includes(query.toLowerCase())) score += 20;
  if (summary.includes(query.toLowerCase())) score += 12;
  terms.forEach((term) => {
    if (name.includes(term)) score += 12;
    if (path.includes(term)) score += 7;
    if (summary.includes(term)) score += 4;
    if (topicSet.has(term)) score += 5;
  });
  if (card.indexStatus === 'indexed') score += 2;
  if (card.indexStatus === 'failed') score -= 5;
  return score;
};

export class WorkspaceFileIndexService {
  isIndexable(file: any) {
    return indexableFile(file);
  }

  async listFileCards(input: {
    workspaceId: string;
    query?: string;
    limit?: number;
    includeChatScoped?: boolean;
    visibleWorkspaceOnly?: boolean;
  }): Promise<WorkspaceFileCard[]> {
    const files = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId: input.workspaceId,
        nodeType: 'file',
        ...(!input.includeChatScoped ? { scope: { not: 'chat' } } : {}),
        ...(input.visibleWorkspaceOnly ? visibleWorkspaceKnowledgeWhere : {})
      },
      include: {
        knowledgeChunks: {
          select: {
            id: true,
            summary: true,
            text: true,
            tokenEstimate: true,
            metadataJson: true,
            chunkIndex: true
          },
          orderBy: { chunkIndex: 'asc' },
          take: 12
        },
        knowledgeIndexJobs: {
          select: {
            id: true,
            status: true,
            extractor: true,
            chunkCount: true,
            errorMessage: true,
            completedAt: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        _count: {
          select: { knowledgeChunks: true }
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { path: 'asc' }]
    });

    const cards = files.map((file: any) => this.cardFromFile(file));
    const query = String(input.query || '').trim();
    const terms = tokenize(query);
    const ranked = query
      ? cards
          .map((card) => ({ card, score: scoreCard(query, terms, card) }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score || left.card.path.localeCompare(right.card.path))
          .map((item) => item.card)
      : cards.sort((left, right) => {
          const leftIndexed = left.indexable && left.chunkCount > 0 ? 0 : 1;
          const rightIndexed = right.indexable && right.chunkCount > 0 ? 0 : 1;
          return leftIndexed - rightIndexed || left.path.localeCompare(right.path);
        });

    return ranked.slice(0, Math.max(1, Math.min(input.limit || 80, 300)));
  }

  async ensureWorkspaceIndexed(input: {
    workspaceId: string;
    force?: boolean;
    maxFiles?: number;
    fileIds?: string[];
    visibleWorkspaceOnly?: boolean;
  }): Promise<WorkspaceIndexReport> {
    const files = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId: input.workspaceId,
        nodeType: 'file',
        ...(input.fileIds?.length ? { id: { in: input.fileIds } } : {}),
        ...(input.visibleWorkspaceOnly ? visibleWorkspaceKnowledgeWhere : {})
      },
      include: {
        _count: { select: { knowledgeChunks: true } },
        knowledgeIndexJobs: {
          select: { id: true, status: true, errorMessage: true, chunkCount: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { path: 'asc' }]
    });

    const indexable = files.filter(indexableFile);
    const candidates = indexable.filter((file: any) => {
      if (input.force) return true;
      const latest = file.knowledgeIndexJobs?.[0];
      if (file._count?.knowledgeChunks > 0 && ['completed', 'skipped'].includes(latest?.status || '')) {
        return false;
      }
      if (hasRecoverableKnowledgeGraphOnlyError(latest, Number(file._count?.knowledgeChunks || 0))) {
        return false;
      }
      return true;
    });
    const selected = candidates.slice(0, Math.max(1, Math.min(input.maxFiles || 24, 200)));
    const jobs: WorkspaceIndexReport['jobs'] = [];

    for (const file of selected) {
      try {
        const job = await knowledgeIndexingService.indexFile({
          workspaceId: input.workspaceId,
          fileObjectId: file.id,
          reason: input.force ? 'workspace-file-index-force' : 'workspace-file-index'
        });
        jobs.push({
          fileObjectId: file.id,
          fileName: file.name,
          status: job?.status || 'unknown',
          chunkCount: job?.chunkCount || 0,
          error: job?.errorMessage || null
        });
      } catch (error) {
        jobs.push({
          fileObjectId: file.id,
          fileName: file.name,
          status: 'failed',
          chunkCount: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      workspaceId: input.workspaceId,
      totalFiles: files.length,
      indexableFiles: indexable.length,
      skippedFiles: indexable.length - selected.length,
      attemptedFiles: selected.length,
      completedFiles: jobs.filter((job) => ['completed', 'skipped'].includes(job.status)).length,
      degradedFiles: jobs.filter((job) => job.status === 'degraded').length,
      failedFiles: jobs.filter((job) => job.status === 'failed').length,
      jobs
    };
  }

  async search(input: {
    workspaceId: string;
    query: string;
    mode?: WorkspaceFileRetrievalMode;
    fileIds?: string[];
    fileLimit?: number;
    chunkLimit?: number;
    ensureIndexed?: boolean;
    visibleWorkspaceOnly?: boolean;
  }): Promise<WorkspaceFileSearchResult> {
    const mode = input.mode || 'targeted_search';
    const overviewMode = mode === 'overview';
    const fileLimit = Math.max(overviewMode ? 12 : 3, Math.min(input.fileLimit || (overviewMode ? 40 : 10), 80));
    const chunkLimit = Math.max(overviewMode ? 12 : 1, Math.min(input.chunkLimit || (overviewMode ? 24 : 8), 60));
    let files = await this.listFileCards({
      workspaceId: input.workspaceId,
      query: overviewMode || input.fileIds?.length ? undefined : input.query,
      limit: input.fileIds?.length ? 300 : fileLimit,
      includeChatScoped: Boolean(input.fileIds?.length),
      visibleWorkspaceOnly: input.visibleWorkspaceOnly
    });
    if (input.fileIds?.length) {
      const allow = new Set(input.fileIds);
      files = files.filter((file) => allow.has(file.fileObjectId)).slice(0, fileLimit);
    }
    let autoIndexReport: WorkspaceIndexReport | undefined;

    if (input.ensureIndexed) {
      const missing = files
        .filter((file) => file.indexable && ['missing', 'failed', 'degraded'].includes(file.indexStatus))
        .map((file) => file.fileObjectId);
      if (missing.length) {
        autoIndexReport = await this.ensureWorkspaceIndexed({
          workspaceId: input.workspaceId,
          fileIds: missing,
          force: true,
          maxFiles: Math.min(missing.length, Number(process.env.WORKSPACE_FILE_SEARCH_AUTOINDEX_MAX || (overviewMode ? 12 : 6))),
          visibleWorkspaceOnly: input.visibleWorkspaceOnly
        });
        files = await this.listFileCards({
          workspaceId: input.workspaceId,
          query: overviewMode || input.fileIds?.length ? undefined : input.query,
          limit: input.fileIds?.length ? 300 : fileLimit,
          includeChatScoped: Boolean(input.fileIds?.length),
          visibleWorkspaceOnly: input.visibleWorkspaceOnly
        });
        if (input.fileIds?.length) {
          const allow = new Set(input.fileIds);
          files = files.filter((file) => allow.has(file.fileObjectId)).slice(0, fileLimit);
        }
      }
    }

    const searchedFileIds = files
      .filter((file) => file.indexStatus !== 'not_indexable')
      .map((file) => file.fileObjectId)
      .slice(0, fileLimit);
    const chunks = await knowledgeSearchService.search({
      workspaceId: input.workspaceId,
      query: input.query,
      fileIds: searchedFileIds.length ? searchedFileIds : undefined,
      limit: chunkLimit,
      requireDiversity: true,
      visibleWorkspaceOnly: input.visibleWorkspaceOnly && !searchedFileIds.length
    });

    const allCards = await this.listFileCards({
      workspaceId: input.workspaceId,
      limit: 300,
      visibleWorkspaceOnly: input.visibleWorkspaceOnly
    });
    return {
      query: input.query,
      mode,
      files,
      chunks,
      coverage: {
        totalFiles: allCards.length,
        indexableFiles: allCards.filter((file) => file.indexable).length,
        indexedFiles: allCards.filter((file) => ['indexed', 'skipped', 'degraded'].includes(file.indexStatus) && file.chunkCount > 0).length,
        missingIndexFiles: allCards.filter((file) => file.indexable && file.chunkCount === 0 && file.indexStatus !== 'failed').length,
        failedFiles: allCards.filter((file) => file.indexStatus === 'failed').length,
        searchedFileIds,
        autoIndexReport
      }
    };
  }

  private cardFromFile(file: any): WorkspaceFileCard {
    const chunks = Array.isArray(file.knowledgeChunks) ? file.knowledgeChunks : [];
    const latestJob = Array.isArray(file.knowledgeIndexJobs) ? file.knowledgeIndexJobs[0] : null;
    const lifecycle = lifecycleStage(latestJob);
    const metadata = parseJson(file.metadataJson);
    const chunkText = chunks.map((chunk: any) => `${chunk.summary || ''}\n${clip(chunk.text, 500)}`).join('\n');
    const cachedCard = metadata.workspaceFileCard && typeof metadata.workspaceFileCard === 'object'
      ? metadata.workspaceFileCard
      : {};
    const sampleHeadings = chunks
      .flatMap((chunk: any) => {
        const chunkMetadata = parseJson(chunk.metadataJson);
        const headingPath = Array.isArray(chunkMetadata.headingPath)
          ? chunkMetadata.headingPath
          : Array.isArray(chunkMetadata.locator?.headingPath)
            ? chunkMetadata.locator.headingPath
            : [];
        return headingPath.map((item: unknown) => String(item || '').trim()).filter(Boolean);
      })
      .filter((value: string, index: number, all: string[]) => all.indexOf(value) === index)
      .slice(0, 8);
    const summary = clip(
      cachedCard.summary ||
      chunks.map((chunk: any) => chunk.summary).filter(Boolean).slice(0, 4).join(' / ') ||
      chunks.map((chunk: any) => clip(chunk.text, 220)).filter(Boolean).slice(0, 2).join(' ') ||
      `${file.name} (${file.path})`,
      700
    );
    const topics = Array.isArray(cachedCard.topics) && cachedCard.topics.length
      ? cachedCard.topics.map(String).slice(0, 12)
      : extractTopics(`${file.name}\n${file.path}\n${summary}\n${sampleHeadings.join('\n')}\n${chunkText}`, 12);
    const tokenEstimate = chunks.reduce((sum: number, chunk: any) => sum + Number(chunk.tokenEstimate || 0), 0);
    const indexable = indexableFile(file);
    const chunkCount = Number(file._count?.knowledgeChunks || chunks.length || 0);

    return {
      fileObjectId: file.id,
      fileName: file.name,
      path: file.path,
      extension: file.extension,
      mimeType: file.mimeType,
      fileCategory: file.fileCategory,
      resourceType: file.resourceType,
      scope: file.scope,
      origin: file.origin,
      size: file.size,
      updatedAt: file.updatedAt instanceof Date ? file.updatedAt.toISOString() : file.updatedAt ? String(file.updatedAt) : undefined,
      indexable,
      indexStatus: cardStatus({ indexable, chunkCount, latestJob }),
      chunkCount,
      tokenEstimate,
      summary,
      topics,
      sampleHeadings,
      latestJob: latestJob ? {
        id: latestJob.id,
        status: latestJob.status,
        extractor: latestJob.extractor,
        chunkCount: latestJob.chunkCount || 0,
        stage: lifecycle.stage,
        reason: lifecycle.reason,
        completedAt: latestJob.completedAt instanceof Date ? latestJob.completedAt.toISOString() : latestJob.completedAt ? String(latestJob.completedAt) : null,
        error: lifecycle.error || null
      } : null
    };
  }
}

export const workspaceFileIndexService = new WorkspaceFileIndexService();
