import { randomUUID } from 'crypto';
import { CourseGraphBuildReport, courseGraphBuildService, CourseGraphBuildProgress } from './courseGraphBuildService';

type CourseGraphBuildJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CourseGraphBuildJob {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  status: CourseGraphBuildJobStatus;
  progress: CourseGraphBuildProgress;
  report?: CourseGraphBuildReport;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

const MAX_RETAINED_JOBS = Number(process.env.COURSE_GRAPH_BUILD_JOB_RETAIN || 80);

export class CourseGraphBuildJobService {
  private jobs = new Map<string, CourseGraphBuildJob>();

  start(input: Parameters<typeof courseGraphBuildService.build>[0]) {
    const job: CourseGraphBuildJob = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      status: 'queued',
      progress: {
        stage: 'queued',
        message: '课程图谱构建任务已排队。',
        percent: 1
      },
      error: null,
      createdAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.trimOldJobs();

    setImmediate(() => {
      void this.run(job.id, input);
    });

    return job;
  }

  get(jobId: string) {
    return this.jobs.get(jobId) || null;
  }

  list(workspaceId: string, limit = 10) {
    return Array.from(this.jobs.values())
      .filter((job) => job.workspaceId === workspaceId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }

  private async run(jobId: string, input: Parameters<typeof courseGraphBuildService.build>[0]) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.progress = {
      stage: 'starting',
      message: '正在准备课程资源和 workbench 范围。',
      percent: 4
    };

    try {
      const report = await courseGraphBuildService.build(input, {
        onProgress: (progress) => {
          const current = this.jobs.get(jobId);
          if (!current || current.status !== 'running') return;
          current.progress = {
            ...current.progress,
            ...progress,
            percent: Math.max(current.progress.percent || 0, progress.percent || 0)
          };
        }
      });
      job.report = report;
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.progress = {
        stage: 'completed',
        message: '课程图谱构建完成。',
        percent: 100,
        processedFiles: report.summary.uniqueFileCount,
        totalFiles: report.summary.uniqueFileCount,
        currentFileName: null
      };
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = {
        ...job.progress,
        stage: 'failed',
        message: job.error || '课程图谱构建失败。',
        percent: Math.max(job.progress.percent || 0, 1)
      };
    }
  }

  private trimOldJobs() {
    const jobs = Array.from(this.jobs.values()).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    jobs.slice(MAX_RETAINED_JOBS).forEach((job) => this.jobs.delete(job.id));
  }
}

export const courseGraphBuildJobService = new CourseGraphBuildJobService();
