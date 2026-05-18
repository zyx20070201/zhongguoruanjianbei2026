import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import prisma from '../../config/db';
import { FileSystemService } from '../fileSystemService';
import { LocalStorageService } from '../storage/localStorageService';
import { StudioDeliveryArtifact } from './visualArtifactAdapters';

type RenderJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StudioRenderJobRecord {
  id: string;
  status: RenderJobStatus;
  stage: string;
  progress: number;
  templateId: string;
  renderer: string;
  framework?: string | null;
  kind: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  logs: string[];
  error?: string | null;
  workspaceId: string;
  workbenchId?: string | null;
  artifactId?: string | null;
  sourceFileObjectId?: string | null;
  outputFileObjectId?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface EnqueueRenderJobInput {
  workspaceId: string;
  workbenchId?: string | null;
  artifactId?: string | null;
  sourceFileObjectId: string;
  templateId: string;
  renderer: string;
  delivery: StudioDeliveryArtifact;
}

const stringify = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const now = () => new Date().toISOString();

const execFileAsync = (
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout || 120000,
      maxBuffer: 1024 * 1024 * 8
    }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(`${error.message}\n${stderr || stdout || ''}`.trim());
        return reject(wrapped);
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });

const commandAvailable = async (command: string, args: string[] = ['--version']) => {
  try {
    await execFileAsync(command, args, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
};

const findFirstFile = async (dir: string, extension: string): Promise<string | null> => {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) return fullPath;
    if (entry.isDirectory()) {
      const nested = await findFirstFile(fullPath, extension);
      if (nested) return nested;
    }
  }
  return null;
};

const mapRow = (row: any): StudioRenderJobRecord => ({
  id: row.id,
  status: row.status,
  stage: row.stage,
  progress: Number(row.progress || 0),
  templateId: row.templateId,
  renderer: row.renderer,
  framework: row.framework,
  kind: row.kind,
  input: parseJson(row.inputJson, {}),
  output: parseJson(row.outputJson, {}),
  logs: parseJson(row.logsJson, []),
  error: row.error,
  workspaceId: row.workspaceId,
  workbenchId: row.workbenchId,
  artifactId: row.artifactId,
  sourceFileObjectId: row.sourceFileObjectId,
  outputFileObjectId: row.outputFileObjectId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt
});

export class StudioRenderJobService {
  async capabilities() {
    const [manim, ffmpeg] = await Promise.all([
      commandAvailable('manim'),
      commandAvailable('ffmpeg')
    ]);
    const remotionBin = path.resolve(process.cwd(), '../frontend/node_modules/.bin/remotion');
    const remotion = await fs.access(remotionBin).then(() => true).catch(() => false);
    return {
      pptx: true,
      html: true,
      manim,
      ffmpeg,
      remotion,
      remotionBin: remotion ? remotionBin : null
    };
  }

  async enqueue(input: EnqueueRenderJobInput) {
    const id = crypto.randomUUID();
    const createdAt = now();
    const logs = [
      `Render job created for ${input.delivery.kind}${input.delivery.framework ? ` via ${input.delivery.framework}` : ''}.`
    ];
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "StudioRenderJob" (
        "id", "status", "stage", "progress", "templateId", "renderer", "framework", "kind",
        "inputJson", "outputJson", "logsJson", "createdAt", "updatedAt",
        "workspaceId", "workbenchId", "artifactId", "sourceFileObjectId"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
      id,
      'queued',
      'queued',
      0,
      input.templateId,
      input.renderer,
      input.delivery.framework || null,
      input.delivery.kind,
      stringify({
        filename: input.delivery.filename,
        mimeType: input.delivery.mimeType,
        framework: input.delivery.framework
      }),
      '{}',
      stringify(logs, '[]'),
      createdAt,
      createdAt,
      input.workspaceId,
      input.workbenchId || null,
      input.artifactId || null,
      input.sourceFileObjectId
    );
    const job = mapRow(rows[0]);

    if (input.delivery.kind === 'pptx' || input.delivery.kind === 'html' || input.delivery.kind === 'markdown') {
      return this.completeImmediate(job.id, input.sourceFileObjectId, [
        `${input.delivery.kind.toUpperCase()} delivery was produced during Studio generation.`,
        'No additional render runtime is required.'
      ]);
    }

    setImmediate(() => {
      this.run(job.id).catch((error) => {
        console.warn('Studio render job failed:', error);
      });
    });

    return job;
  }

  async list(input: { workspaceId: string; workbenchId?: string | null; sourceFileObjectId?: string | null; limit?: number }) {
    const clauses = ['"workspaceId" = ?'];
    const params: unknown[] = [input.workspaceId];
    if (input.workbenchId) {
      clauses.push('"workbenchId" = ?');
      params.push(input.workbenchId);
    }
    if (input.sourceFileObjectId) {
      clauses.push('"sourceFileObjectId" = ?');
      params.push(input.sourceFileObjectId);
    }
    params.push(Math.min(Math.max(input.limit || 30, 1), 100));
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "StudioRenderJob"
       WHERE ${clauses.join(' AND ')}
       ORDER BY "createdAt" DESC
       LIMIT ?`,
      ...params
    );
    return rows.map(mapRow);
  }

  async get(input: { workspaceId: string; id: string }) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "StudioRenderJob" WHERE "workspaceId" = ? AND "id" = ? LIMIT 1`,
      input.workspaceId,
      input.id
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  private async update(
    id: string,
    patch: {
      status?: RenderJobStatus;
      stage?: string;
      progress?: number;
      logs?: string[];
      error?: string | null;
      output?: Record<string, unknown>;
      outputFileObjectId?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    }
  ) {
    const currentRows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "StudioRenderJob" WHERE "id" = ? LIMIT 1`, id);
    const current = currentRows[0] ? mapRow(currentRows[0]) : null;
    const logs = [...(current?.logs || []), ...(patch.logs || [])];
    const updatedAt = now();
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "StudioRenderJob" SET
        "status" = COALESCE(?, "status"),
        "stage" = COALESCE(?, "stage"),
        "progress" = COALESCE(?, "progress"),
        "logsJson" = ?,
        "error" = ?,
        "outputJson" = ?,
        "outputFileObjectId" = COALESCE(?, "outputFileObjectId"),
        "startedAt" = COALESCE(?, "startedAt"),
        "completedAt" = COALESCE(?, "completedAt"),
        "updatedAt" = ?
       WHERE "id" = ?
       RETURNING *`,
      patch.status || null,
      patch.stage || null,
      typeof patch.progress === 'number' ? patch.progress : null,
      stringify(logs, '[]'),
      patch.error === undefined ? current?.error || null : patch.error,
      stringify({ ...(current?.output || {}), ...(patch.output || {}) }),
      patch.outputFileObjectId || null,
      patch.startedAt || null,
      patch.completedAt || null,
      updatedAt,
      id
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  private async completeImmediate(id: string, outputFileObjectId: string, logs: string[]) {
    return this.update(id, {
      status: 'succeeded',
      stage: 'ready',
      progress: 100,
      logs,
      outputFileObjectId,
      output: { outputFileObjectId },
      startedAt: now(),
      completedAt: now()
    });
  }

  async run(id: string) {
    const job = await this.update(id, {
      status: 'running',
      stage: 'preflight',
      progress: 8,
      logs: ['Running render preflight checks.'],
      startedAt: now()
    });
    if (!job) return null;

    try {
      if (job.kind === 'python') {
        return await this.renderManim(job);
      }
      if (job.kind === 'tsx') {
        return await this.renderRemotion(job);
      }
      return this.update(job.id, {
        status: 'skipped',
        stage: 'skipped',
        progress: 100,
        logs: [`No renderer registered for delivery kind "${job.kind}".`],
        completedAt: now()
      });
    } catch (error) {
      return this.update(job.id, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        logs: ['Render failed.'],
        error: error instanceof Error ? error.message : String(error),
        completedAt: now()
      });
    }
  }

  private async getSourceFile(job: StudioRenderJobRecord) {
    if (!job.sourceFileObjectId) throw new Error('Render job has no source file.');
    const file = await prisma.fileSystemObject.findFirst({
      where: { id: job.sourceFileObjectId, workspaceId: job.workspaceId }
    });
    if (!file) throw new Error('Source file not found.');
    if (!file.storageKey) throw new Error('Source file has no storage key.');
    return file;
  }

  private async readSourceText(job: StudioRenderJobRecord) {
    const file = await this.getSourceFile(job);
    return {
      file,
      content: file.content || await LocalStorageService.readTextFile(file.storageKey!)
    };
  }

  private async renderManim(job: StudioRenderJobRecord) {
    const hasManim = await commandAvailable('manim');
    if (!hasManim) {
      return this.update(job.id, {
        status: 'failed',
        stage: 'missing-runtime',
        progress: 100,
        logs: ['Manim CLI is not installed or not available on PATH. Source file is still saved and downloadable.'],
        error: 'Manim runtime unavailable. Install Manim Community and rerun this render job.',
        completedAt: now()
      });
    }

    const { content } = await this.readSourceText(job);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-studio-manim-'));
    const sourcePath = path.join(tempDir, 'visualize-manim-animation.py');
    await fs.writeFile(sourcePath, content, 'utf-8');
    await this.update(job.id, {
      stage: 'rendering',
      progress: 35,
      logs: ['Manim CLI detected. Rendering MP4 output.']
    });

    await execFileAsync('manim', ['-ql', '--format', 'mp4', '-o', 'ai-studio-render', sourcePath, 'AIStudioExplanation'], {
      cwd: tempDir,
      timeout: 180000
    });
    const mp4 = await findFirstFile(tempDir, '.mp4');
    if (!mp4) throw new Error('Manim completed but no MP4 output was found.');
    const buffer = await fs.readFile(mp4);
    const output = await FileSystemService.saveGeneratedContent({
      workspaceId: job.workspaceId,
      filename: 'visualize-manim-animation.mp4',
      category: 'generated',
      mimeType: 'video/mp4',
      isBinary: true,
      workbenchId: job.workbenchId || undefined,
      resourceRole: 'generated',
      resourceType: 'generated',
      scope: job.workbenchId ? 'workbench' : 'workspace',
      origin: 'ai',
      metadata: {
        generator: 'studio-render-job',
        renderJobId: job.id,
        framework: 'Manim',
        sourceFileObjectId: job.sourceFileObjectId
      },
      content: buffer
    });
    return this.update(job.id, {
      status: 'succeeded',
      stage: 'rendered',
      progress: 100,
      logs: [`Rendered MP4 output: ${output.path}`],
      outputFileObjectId: output.id,
      output: { outputFileObjectId: output.id, path: output.path, mimeType: 'video/mp4' },
      completedAt: now()
    });
  }

  private async renderRemotion(job: StudioRenderJobRecord) {
    const capabilities = await this.capabilities();
    if (!capabilities.remotion) {
      return this.update(job.id, {
        status: 'failed',
        stage: 'missing-runtime',
        progress: 100,
        logs: ['Remotion CLI is not installed in the local frontend project. Source file is still saved and downloadable.'],
        error: 'Remotion runtime unavailable. Install/configure Remotion before rendering UI videos.',
        completedAt: now()
      });
    }
    return this.update(job.id, {
      status: 'skipped',
      stage: 'needs-project-wrapper',
      progress: 100,
      logs: [
        'Remotion CLI was detected, but automated rendering needs a generated Remotion project wrapper.',
        'The TSX source file is saved; render orchestration can be enabled once a composition host is configured.'
      ],
      completedAt: now()
    });
  }
}

export const studioRenderJobService = new StudioRenderJobService();
