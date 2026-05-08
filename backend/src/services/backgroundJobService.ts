type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface JobRecord {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  lastError?: string;
}

interface QueueJobOptions {
  id?: string;
  maxAttempts?: number;
}

const MAX_CONCURRENT = Number(process.env.BACKGROUND_JOB_CONCURRENCY || 2);
const RETRY_DELAY_MS = Number(process.env.BACKGROUND_JOB_RETRY_DELAY_MS || 3000);

export class BackgroundJobService {
  private handlers = new Map<string, (payload: any) => Promise<void>>();
  private queue: Array<{ record: JobRecord; payload: any }> = [];
  private records = new Map<string, JobRecord>();
  private running = 0;

  register(type: string, handler: (payload: any) => Promise<void>) {
    this.handlers.set(type, handler);
  }

  enqueue(type: string, payload: any, options: QueueJobOptions = {}) {
    const id = options.id || `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const existing = this.records.get(id);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing;

    const record: JobRecord = {
      id,
      type,
      status: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, options.maxAttempts || 3),
      queuedAt: new Date().toISOString()
    };
    this.records.set(id, record);
    this.queue.push({ record, payload });
    void this.drain();
    return record;
  }

  stats() {
    const records = Array.from(this.records.values());
    return {
      queued: this.queue.length,
      running: this.running,
      totalTracked: records.length,
      byStatus: records.reduce((acc, record) => {
        acc[record.status] = (acc[record.status] || 0) + 1;
        return acc;
      }, {} as Record<JobStatus, number>),
      recent: records.slice(-20).reverse()
    };
  }

  private async drain() {
    while (this.running < MAX_CONCURRENT && this.queue.length) {
      const job = this.queue.shift();
      if (!job) return;
      this.running += 1;
      void this.runJob(job).finally(() => {
        this.running -= 1;
        void this.drain();
      });
    }
  }

  private async runJob(job: { record: JobRecord; payload: any }) {
    const handler = this.handlers.get(job.record.type);
    if (!handler) {
      job.record.status = 'failed';
      job.record.lastError = `No handler registered for ${job.record.type}`;
      job.record.failedAt = new Date().toISOString();
      return;
    }

    job.record.status = 'running';
    job.record.startedAt = new Date().toISOString();
    job.record.attempts += 1;

    try {
      await handler(job.payload);
      job.record.status = 'completed';
      job.record.completedAt = new Date().toISOString();
    } catch (error) {
      job.record.lastError = error instanceof Error ? error.message : String(error);
      if (job.record.attempts < job.record.maxAttempts) {
        job.record.status = 'queued';
        setTimeout(() => {
          this.queue.push(job);
          void this.drain();
        }, RETRY_DELAY_MS);
      } else {
        job.record.status = 'failed';
        job.record.failedAt = new Date().toISOString();
      }
    }
  }
}

export const backgroundJobService = new BackgroundJobService();
