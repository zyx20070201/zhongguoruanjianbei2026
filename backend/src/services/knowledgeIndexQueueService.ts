import prisma, { withPrismaRetry } from '../config/db';
import { knowledgeIndexingService } from './knowledgeIndexingService';

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const WORKER_CONCURRENCY = parsePositiveInt(process.env.KNOWLEDGE_INDEX_WORKER_CONCURRENCY, 1);
const WORKER_BATCH_SIZE = parsePositiveInt(process.env.KNOWLEDGE_INDEX_WORKER_BATCH_SIZE, Math.max(4, WORKER_CONCURRENCY * 2));
const WORKER_POLL_MS = parsePositiveInt(process.env.KNOWLEDGE_INDEX_WORKER_POLL_MS, 2000);
const WORKER_STALE_MS = parsePositiveInt(process.env.KNOWLEDGE_INDEX_WORKER_STALE_MS, 30 * 60 * 1000);

export class KnowledgeIndexQueueService {
  private timer: NodeJS.Timeout | null = null;
  private running = 0;
  private draining = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.drain();
    }, WORKER_POLL_MS);
    void this.drain();
  }

  async enqueueFile(input: {
    workspaceId: string;
    fileObjectId: string;
    reason?: string;
    force?: boolean;
  }) {
    const job = await knowledgeIndexingService.enqueueFile(input);
    void this.drain();
    return job;
  }

  stats() {
    return {
      running: this.running,
      concurrency: WORKER_CONCURRENCY,
      batchSize: WORKER_BATCH_SIZE,
      pollMs: WORKER_POLL_MS,
      staleMs: WORKER_STALE_MS
    };
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.requeueStaleJobs();
      while (this.running < WORKER_CONCURRENCY) {
        const capacity = WORKER_CONCURRENCY - this.running;
        const jobs = await this.claimQueuedJobs(Math.min(WORKER_BATCH_SIZE, capacity));
        if (!jobs.length) break;
        jobs.forEach((job) => this.runClaimedJob(job.id));
      }
    } catch (error) {
      console.warn('Knowledge index queue drain failed:', error instanceof Error ? error.message : error);
    } finally {
      this.draining = false;
    }
  }

  private async requeueStaleJobs() {
    const staleBefore = new Date(Date.now() - WORKER_STALE_MS);
    await withPrismaRetry(() =>
      prisma.knowledgeIndexJob.updateMany({
        where: {
          status: 'running',
          updatedAt: { lt: staleBefore }
        },
        data: {
          status: 'queued',
          startedAt: null
        }
      })
    );
  }

  private async claimQueuedJobs(limit: number) {
    if (limit <= 0) return [];
    const candidates = await withPrismaRetry(() =>
      prisma.knowledgeIndexJob.findMany({
        where: { status: 'queued' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit
      })
    );

    const claimed = [];
    for (const candidate of candidates) {
      const result = await withPrismaRetry(() =>
        prisma.knowledgeIndexJob.updateMany({
          where: {
            id: candidate.id,
            status: 'queued'
          },
          data: {
            status: 'running',
            startedAt: new Date()
          }
        })
      );
      if (result.count === 1) claimed.push(candidate);
    }
    return claimed;
  }

  private runClaimedJob(jobId: string) {
    this.running += 1;
    void knowledgeIndexingService
      .processQueuedJob(jobId)
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Knowledge index queued job failed for ${jobId}:`, message);
        await withPrismaRetry(() =>
          prisma.knowledgeIndexJob.updateMany({
            where: { id: jobId, status: { in: ['queued', 'running', 'pending'] } },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: JSON.stringify({
                stage: 'failed',
                reason: 'queued-index-worker',
                vectorError: message,
                timings: {},
                completedStages: ['failed']
              })
            }
          })
        );
      })
      .finally(() => {
        this.running = Math.max(0, this.running - 1);
        void this.drain();
      });
  }
}

export const knowledgeIndexQueueService = new KnowledgeIndexQueueService();
