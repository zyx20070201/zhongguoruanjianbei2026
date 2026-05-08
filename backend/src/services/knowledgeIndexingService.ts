import prisma from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import { stableHash } from './chunkSchema';
import { documentTextExtractionService } from './documentTextExtractionService';
import { documentChunkStore } from './documentChunkStore';
import { knowledgeChunkingService } from './knowledgeChunkingService';
import { vectorStoreService } from './vectorStoreService';

interface IndexFileInput {
  workspaceId: string;
  fileObjectId: string;
  reason?: string;
  force?: boolean;
}

type IndexStage = 'pending' | 'extracting' | 'chunking' | 'embedding' | 'upserting' | 'verifying' | 'indexed' | 'degraded' | 'skipped' | 'failed';
const KNOWLEDGE_INDEX_REUSABLE_STATUSES = ['completed', 'degraded', 'skipped'];

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

export class KnowledgeIndexingService {
  async indexFile(input: IndexFileInput) {
    const file = await prisma.fileSystemObject.findFirst({
      where: {
        id: input.fileObjectId,
        workspaceId: input.workspaceId
      }
    });

    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Cannot index a folder');

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
      return prisma.knowledgeIndexJob.create({
        data: {
          workspaceId: input.workspaceId,
          fileObjectId: input.fileObjectId,
          status: 'skipped',
          extractor: latestLifecycle.extractor,
          chunkCount: existingChunkCount,
          startedAt: new Date(),
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
        }
      });
    }

    const job = await prisma.knowledgeIndexJob.create({
      data: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        status: 'pending',
        startedAt: new Date(),
        errorMessage: lifecycleMessage({
          stage: 'pending',
          reason: input.reason || 'index-job',
          sourceHash,
          timings: {},
          completedStages: []
        })
      }
    });

    const snapshot: IndexLifecycleSnapshot = {
      stage: 'pending',
      reason: input.reason || 'index-job',
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
      await prisma.knowledgeIndexJob.update({
        where: { id: job.id },
        data: {
          status: stage === 'failed' ? 'failed' : stage === 'indexed' ? 'completed' : stage === 'degraded' ? 'degraded' : 'running',
          extractor: snapshot.extractor,
          chunkCount: snapshot.chunkCount || 0,
          errorMessage: lifecycleMessage(snapshot)
        }
      });
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
        source: input.reason || 'index-job',
        purpose: file.fileCategory || 'grounding',
        metadata: {
          ...extracted.metadata,
          fileSourceHash: sourceHash,
          lifecycleReason: input.reason || 'index-job'
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

      const finalStage: IndexStage = vectorError ? 'degraded' : 'indexed';
      snapshot.timings[snapshot.stage] = now() - (stageStartedAt.get(snapshot.stage) || now());

      return prisma.knowledgeIndexJob.update({
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
      });
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Failed to index file';

      await prisma.knowledgeChunk.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          fileObjectId: input.fileObjectId
        }
      });

      return prisma.knowledgeIndexJob.update({
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
      });
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

    const jobs = [];
    for (const file of files) {
      jobs.push(
        await this.indexFile({
          workspaceId,
          fileObjectId: file.id,
          reason: 'workspace-reindex',
          force: true
        })
      );
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
