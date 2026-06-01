import prisma, { withPrismaRetry } from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import { stableHash } from './chunkSchema';
import { documentTextExtractionService } from './documentTextExtractionService';
import { documentChunkStore } from './documentChunkStore';
import { knowledgeChunkingService } from './knowledgeChunkingService';
import { vectorStoreService } from './vectorStoreService';
import { videoAnalysisService } from './videoAnalysisService';

interface IndexFileInput {
  workspaceId: string;
  fileObjectId: string;
  reason?: string;
  force?: boolean;
  jobId?: string;
}

type IndexStage = 'pending' | 'extracting' | 'chunking' | 'embedding' | 'upserting' | 'verifying' | 'indexed' | 'degraded' | 'skipped' | 'failed';
const KNOWLEDGE_INDEX_REUSABLE_STATUSES = ['completed', 'degraded', 'skipped'];
const KNOWLEDGE_INDEX_ACTIVE_STATUSES = ['queued', 'running', 'pending'];

interface IndexLifecycleSnapshot {
  stage: IndexStage;
  reason?: string;
  sourceHash?: string;
  extractor?: string;
  chunkCount?: number;
  vectorIndexed?: boolean;
  vectorError?: string;
  timings: Record<string, number>;
  completedStages: IndexStage[];
}

const now = () => Date.now();

const lifecycleMessage = (snapshot: IndexLifecycleSnapshot) => JSON.stringify(snapshot);

const parseLifecycle = (value?: string | null): IndexLifecycleSnapshot | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as IndexLifecycleSnapshot : null;
  } catch {
    return null;
  }
};

const fileSourceHash = (file: any) =>
  stableHash({
    id: file.id,
    name: file.name,
    path: file.path,
    extension: file.extension,
    mimeType: file.mimeType,
    size: file.size,
    storageKey: file.storageKey,
    content: file.content || '',
    updatedAt: file.updatedAt?.toISOString?.() || file.updatedAt
  });

const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const hasIndexableVideoAnalysis = (file: any) => {
  const metadata = parseJsonObject(file.metadataJson);
  const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis : null;
  return Boolean(
    analysis &&
    (
      analysis.summary ||
      (Array.isArray(analysis.transcript) && analysis.transcript.length) ||
      (Array.isArray(analysis.chapters) && analysis.chapters.length) ||
      (Array.isArray(analysis.keyPoints) && analysis.keyPoints.length) ||
      (Array.isArray(analysis.slides) && analysis.slides.length)
    )
  );
};

export class KnowledgeIndexingService {
  async enqueueFile(input: Omit<IndexFileInput, 'jobId'>) {
    const file = await prisma.fileSystemObject.findFirst({
      where: {
        id: input.fileObjectId,
        workspaceId: input.workspaceId
      }
    });

    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot index a folder');

    const sourceHash = fileSourceHash(file);
    const reason = input.reason || 'queued-index';
    const latestActive = await prisma.knowledgeIndexJob.findFirst({
      where: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        status: { in: KNOWLEDGE_INDEX_ACTIVE_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!input.force && latestActive) {
      return latestActive;
    }

    return prisma.knowledgeIndexJob.create({
      data: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        status: 'queued',
        errorMessage: lifecycleMessage({
          stage: 'pending',
          reason,
          sourceHash,
          timings: {},
          completedStages: []
        })
      }
    });
  }

  async indexFile(input: IndexFileInput) {
    const job = input.jobId
      ? await prisma.knowledgeIndexJob.findFirst({
          where: {
            id: input.jobId,
            workspaceId: input.workspaceId,
            fileObjectId: input.fileObjectId
          }
        })
      : null;

    if (input.jobId && !job) {
      throw new FileSystemError(404, 'Index job not found');
    }

    return this.runIndexFile(input, job);
  }

  async processQueuedJob(jobId: string) {
    const job = await prisma.knowledgeIndexJob.findFirst({ where: { id: jobId } });
    if (!job) throw new FileSystemError(404, 'Index job not found');
    return this.runIndexFile({
      workspaceId: job.workspaceId,
      fileObjectId: job.fileObjectId,
      reason: parseLifecycle(job.errorMessage)?.reason || 'queued-index',
      jobId: job.id
    }, job);
  }

  private async runIndexFile(input: IndexFileInput, existingJob?: any) {
    const file = await prisma.fileSystemObject.findFirst({
      where: {
        id: input.fileObjectId,
        workspaceId: input.workspaceId
      }
    });

    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot index a folder');
    const sourceLifecycle = parseLifecycle(existingJob?.errorMessage);
    const initialReason = input.reason || sourceLifecycle?.reason || 'index-job';

    if (hasIndexableVideoAnalysis(file)) {
      await videoAnalysisService.indexStoredAnalysis(input.workspaceId, input.fileObjectId, initialReason || 'knowledge-index-video-analysis');
      if (existingJob) {
        const chunkCount = await prisma.knowledgeChunk.count({
          where: { workspaceId: input.workspaceId, fileObjectId: input.fileObjectId }
        });
        return prisma.knowledgeIndexJob.update({
          where: { id: existingJob.id },
          data: {
            status: 'completed',
            chunkCount,
            completedAt: new Date(),
            errorMessage: lifecycleMessage({
              stage: 'indexed',
              reason: initialReason,
              chunkCount,
              vectorIndexed: true,
              timings: {},
              completedStages: ['indexed']
            })
          }
        });
      }
      return this.getLatestStatus(input.workspaceId, input.fileObjectId);
    }

    const sourceHash = fileSourceHash(file);
    const latestCompleted = await prisma.knowledgeIndexJob.findFirst({
      where: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        status: { in: KNOWLEDGE_INDEX_REUSABLE_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    });
    const latestLifecycle = parseLifecycle(latestCompleted?.errorMessage);
    const existingChunkCount = await prisma.knowledgeChunk.count({
      where: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId
      }
    });

    if (!input.force && latestLifecycle?.sourceHash === sourceHash && existingChunkCount > 0) {
      const data = {
          workspaceId: input.workspaceId,
          fileObjectId: input.fileObjectId,
          status: 'skipped',
          extractor: latestLifecycle.extractor,
          chunkCount: existingChunkCount,
          startedAt: existingJob?.startedAt || new Date(),
          completedAt: new Date(),
          errorMessage: lifecycleMessage({
            stage: 'skipped',
            reason: 'source-hash-unchanged',
            sourceHash,
            extractor: latestLifecycle.extractor,
            chunkCount: existingChunkCount,
            vectorIndexed: latestLifecycle.vectorIndexed,
            timings: {},
            completedStages: ['skipped']
          })
        };
      return existingJob
        ? prisma.knowledgeIndexJob.update({ where: { id: existingJob.id }, data })
        : prisma.knowledgeIndexJob.create({ data });
    }

    const job = existingJob || await prisma.knowledgeIndexJob.create({
      data: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        status: 'pending',
        startedAt: new Date(),
        errorMessage: lifecycleMessage({
          stage: 'pending',
          reason: initialReason,
          sourceHash,
          timings: {},
          completedStages: []
        })
      }
    });

    const snapshot: IndexLifecycleSnapshot = {
      stage: 'pending',
      reason: initialReason,
      sourceHash,
      timings: {},
      completedStages: []
    };
    const stageStartedAt = new Map<IndexStage, number>();
    const setStage = async (stage: IndexStage, patch: Partial<IndexLifecycleSnapshot> = {}) => {
      const previous = snapshot.stage;
      if (previous && stageStartedAt.has(previous)) {
        snapshot.timings[previous] = now() - (stageStartedAt.get(previous) || now());
      }
      snapshot.stage = stage;
      Object.assign(snapshot, patch);
      if (!snapshot.completedStages.includes(stage)) snapshot.completedStages.push(stage);
      stageStartedAt.set(stage, now());
      await withPrismaRetry(() =>
        prisma.knowledgeIndexJob.update({
          where: { id: job.id },
          data: {
            status: stage === 'failed' ? 'failed' : stage === 'indexed' ? 'completed' : stage === 'degraded' ? 'degraded' : 'running',
            extractor: snapshot.extractor,
            chunkCount: snapshot.chunkCount || 0,
            startedAt: job.startedAt || new Date(),
            completedAt: ['failed', 'indexed', 'degraded'].includes(stage) ? new Date() : job.completedAt || null,
            errorMessage: lifecycleMessage(snapshot)
          }
        })
      );
    };

    try {
      await setStage('extracting');
      const extracted = await documentTextExtractionService.extract(file);
      snapshot.extractor = extracted.extractor;

      await setStage('chunking', { extractor: extracted.extractor });
      const chunks = await knowledgeChunkingService.indexFile({
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        content: extracted.text,
        source: initialReason,
        purpose: file.fileCategory || 'grounding',
        metadata: {
          ...extracted.metadata,
          fileSourceHash: sourceHash,
          lifecycleReason: initialReason
        }
      });
      snapshot.chunkCount = chunks.length;

      let vectorIndexed = false;
      let vectorError: string | undefined;
      if (chunks.length > 0) {
        await setStage('embedding', { chunkCount: chunks.length });
        await setStage('upserting', { chunkCount: chunks.length });
        try {
          await vectorStoreService.replaceFileChunks({
            workspaceId: input.workspaceId,
            fileObjectId: input.fileObjectId,
            chunks
          });
          vectorIndexed = true;
        } catch (error) {
          vectorError = error instanceof Error ? error.message : String(error);
          console.warn(`Vector indexing skipped for ${input.fileObjectId}: ${vectorError}`);
        }
      }

      await setStage('verifying', { chunkCount: chunks.length, vectorIndexed, vectorError });
      const verifiedChunkCount = await documentChunkStore.listFileChunks({
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId
      });

      snapshot.timings[snapshot.stage] = now() - (stageStartedAt.get(snapshot.stage) || now());

      const finalStage: IndexStage = vectorError ? 'degraded' : 'indexed';
      return withPrismaRetry(() =>
        prisma.knowledgeIndexJob.update({
          where: { id: job.id },
          data: {
            status: finalStage === 'indexed' ? 'completed' : 'degraded',
            extractor: extracted.extractor,
            chunkCount: verifiedChunkCount.length,
            completedAt: new Date(),
            errorMessage: lifecycleMessage({
              ...snapshot,
              stage: finalStage,
              chunkCount: verifiedChunkCount.length,
              vectorIndexed,
              vectorError,
              completedStages: [...new Set([...snapshot.completedStages, finalStage])]
            })
          }
        })
      );
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Failed to index file';

      await withPrismaRetry(() =>
        prisma.knowledgeChunk.deleteMany({
          where: {
            workspaceId: input.workspaceId,
            fileObjectId: input.fileObjectId
          }
        })
      );

      return withPrismaRetry(() =>
        prisma.knowledgeIndexJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            errorMessage: lifecycleMessage({
              ...snapshot,
              stage: 'failed',
              vectorError: message,
              completedStages: [...new Set<IndexStage>([...snapshot.completedStages, 'failed'])]
            }),
            completedAt: new Date()
          }
        })
      );
    }
  }

  async getLatestStatus(workspaceId: string, fileObjectId: string) {
    const job = await prisma.knowledgeIndexJob.findFirst({
      where: { workspaceId, fileObjectId },
      orderBy: { createdAt: 'desc' }
    });
    if (!job) return null;
    return {
      ...job,
      lifecycle: parseLifecycle(job.errorMessage)
    };
  }

  async indexWorkspace(workspaceId: string) {
    const files = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId,
        nodeType: 'file'
      },
      orderBy: { updatedAt: 'desc' }
    });

    const jobs: NonNullable<Awaited<ReturnType<KnowledgeIndexingService['indexFile']>>>[] = [];
    for (const file of files) {
      const job = await this.indexFile({
        workspaceId,
        fileObjectId: file.id,
        reason: 'workspace-reindex',
        force: true
      });
      if (job) jobs.push(job);
    }

    return jobs;
  }

  async listJobs(workspaceId: string, limit = 50) {
    const jobs = await prisma.knowledgeIndexJob.findMany({
      where: { workspaceId },
      include: {
        fileObject: {
          select: {
            id: true,
            name: true,
            path: true,
            fileCategory: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200)
    });
    return jobs.map((job) => ({
      ...job,
      lifecycle: parseLifecycle(job.errorMessage)
    }));
  }
}

export const knowledgeIndexingService = new KnowledgeIndexingService();
