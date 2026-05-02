import prisma from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import { documentTextExtractionService } from './documentTextExtractionService';
import { knowledgeChunkingService } from './knowledgeChunkingService';

interface IndexFileInput {
  workspaceId: string;
  fileObjectId: string;
  reason?: string;
}

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

    const job = await prisma.knowledgeIndexJob.create({
      data: {
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        status: 'running',
        startedAt: new Date()
      }
    });

    try {
      const extracted = await documentTextExtractionService.extract(file);
      const chunks = await knowledgeChunkingService.indexFile({
        workspaceId: input.workspaceId,
        fileObjectId: input.fileObjectId,
        content: extracted.text,
        source: input.reason || 'index-job',
        purpose: file.fileCategory || 'grounding',
        metadata: extracted.metadata
      });

      return prisma.knowledgeIndexJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          extractor: extracted.extractor,
          chunkCount: chunks.length,
          completedAt: new Date()
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
          errorMessage: message,
          completedAt: new Date()
        }
      });
    }
  }

  async getLatestStatus(workspaceId: string, fileObjectId: string) {
    return prisma.knowledgeIndexJob.findFirst({
      where: { workspaceId, fileObjectId },
      orderBy: { createdAt: 'desc' }
    });
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
          reason: 'workspace-reindex'
        })
      );
    }

    return jobs;
  }

  async listJobs(workspaceId: string, limit = 50) {
    return prisma.knowledgeIndexJob.findMany({
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
  }
}

export const knowledgeIndexingService = new KnowledgeIndexingService();
