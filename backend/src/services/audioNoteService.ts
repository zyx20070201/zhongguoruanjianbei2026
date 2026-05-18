import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import { LocalStorageService } from './storage/localStorageService';
import { FileSystemService } from './fileSystemService';
import { backgroundJobService } from './backgroundJobService';
import { aiModelProviderService } from './aiModelProviderService';

const execFileAsync = promisify(execFile);

type AudioNoteStatus = 'recording' | 'queued' | 'processing' | 'draft_ready' | 'ready' | 'failed';
type AudioNoteProvider = 'funasr' | 'faster-whisper' | 'auto';

interface AudioNoteTranscriptSegment {
  id: string;
  start?: number;
  end?: number;
  text: string;
  source?: string;
}

interface AudioNoteAnalysis {
  version: 1;
  status: AudioNoteStatus;
  provider: AudioNoteProvider | 'fallback';
  transcript: AudioNoteTranscriptSegment[];
  transcriptText: string;
  noteDraft: string;
  progress: {
    stage: string;
    percent: number;
    message?: string;
    jobId?: string;
    updatedAt: string;
  };
  chunks: Array<{
    id: string;
    index: number;
    fileObjectId: string;
    name: string;
    size?: number;
    createdAt: string;
  }>;
  warnings: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const AUDIO_NOTE_METADATA_KEY = 'audioNote';
const AUDIO_NOTE_JOB_TYPE = 'audioNote.process';
const AUDIO_NOTE_PROVIDER = (process.env.AUDIO_NOTE_PROVIDER || 'auto').trim().toLowerCase() as AudioNoteProvider;
const FUNASR_URL = (process.env.FUNASR_API_URL || '').replace(/\/$/, '');
const FASTER_WHISPER_URL = (process.env.FASTER_WHISPER_API_URL || '').replace(/\/$/, '');
const ASR_TIMEOUT_MS = Number(process.env.AUDIO_NOTE_ASR_TIMEOUT_MS || 20 * 60 * 1000);

const nowIso = () => new Date().toISOString();

const parseJsonObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const serializeMetadata = (metadata: Record<string, any>) => JSON.stringify(metadata || {});

const clip = (value: string, maxLength: number) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const createEmptyAnalysis = (provider: AudioNoteProvider = AUDIO_NOTE_PROVIDER): AudioNoteAnalysis => {
  const timestamp = nowIso();
  return {
    version: 1,
    status: 'recording',
    provider,
    transcript: [],
    transcriptText: '',
    noteDraft: '',
    progress: {
      stage: 'recording',
      percent: 5,
      message: 'Recording audio chunks.',
      updatedAt: timestamp
    },
    chunks: [],
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const getMetadata = (file: any) => parseJsonObject(file?.metadataJson);

const getAnalysis = (file: any): AudioNoteAnalysis => {
  const metadata = getMetadata(file);
  const existing = metadata[AUDIO_NOTE_METADATA_KEY];
  if (existing && typeof existing === 'object') {
    return {
      ...createEmptyAnalysis(existing.provider || AUDIO_NOTE_PROVIDER),
      ...existing,
      progress: {
        ...createEmptyAnalysis(existing.provider || AUDIO_NOTE_PROVIDER).progress,
        ...(existing.progress || {})
      },
      chunks: Array.isArray(existing.chunks) ? existing.chunks : [],
      transcript: Array.isArray(existing.transcript) ? existing.transcript : [],
      warnings: Array.isArray(existing.warnings) ? existing.warnings : []
    };
  }
  return createEmptyAnalysis();
};

const saveAnalysis = async (fileObjectId: string, analysis: AudioNoteAnalysis) => {
  const file = await prisma.fileSystemObject.findUnique({ where: { id: fileObjectId } });
  if (!file) throw new FileSystemError(404, 'Audio note resource not found');
  const metadata = getMetadata(file);
  const next = {
    ...analysis,
    updatedAt: nowIso()
  };
  await prisma.fileSystemObject.update({
    where: { id: fileObjectId },
    data: {
      metadataJson: serializeMetadata({
        ...metadata,
        [AUDIO_NOTE_METADATA_KEY]: next
      })
    }
  });
  return next;
};

const waitForFetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const normalizeSegments = (value: any): AudioNoteTranscriptSegment[] => {
  const rawSegments = Array.isArray(value?.segments) ? value.segments : [];
  if (rawSegments.length) {
    return rawSegments
      .map((segment: any, index: number) => ({
        id: String(segment.id || `s${index + 1}`),
        start: typeof segment.start === 'number' ? segment.start : undefined,
        end: typeof segment.end === 'number' ? segment.end : undefined,
        text: String(segment.text || '').trim(),
        source: String(segment.source || value.provider || 'asr')
      }))
      .filter((segment: AudioNoteTranscriptSegment) => segment.text);
  }

  const text = String(value?.text || value?.transcript || '').trim();
  return text ? [{ id: 's1', text, source: String(value?.provider || 'asr') }] : [];
};

const callAsrProvider = async (audioPath: string, provider: AudioNoteProvider): Promise<{ provider: AudioNoteProvider | 'fallback'; segments: AudioNoteTranscriptSegment[]; warnings: string[] }> => {
  const candidates = provider === 'funasr'
    ? [{ provider: 'funasr' as const, url: FUNASR_URL }]
    : provider === 'faster-whisper'
      ? [{ provider: 'faster-whisper' as const, url: FASTER_WHISPER_URL }]
      : [
          { provider: 'funasr' as const, url: FUNASR_URL },
          { provider: 'faster-whisper' as const, url: FASTER_WHISPER_URL }
        ];

  const warnings: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.url) {
      warnings.push(`${candidate.provider} service URL is not configured.`);
      continue;
    }

    const form = new FormData();
    const buffer = await fs.readFile(audioPath);
    form.append('file', new Blob([buffer]), path.basename(audioPath));
    form.append('language', 'auto');

    const response = await waitForFetchWithTimeout(`${candidate.url}/transcribe`, {
      method: 'POST',
      body: form
    }, ASR_TIMEOUT_MS);
    if (!response.ok) {
      warnings.push(`${candidate.provider} returned ${response.status}.`);
      continue;
    }

    const data = await response.json();
    const segments = normalizeSegments({ ...data, provider: candidate.provider });
    if (segments.length) return { provider: candidate.provider, segments, warnings };
    warnings.push(`${candidate.provider} returned an empty transcript.`);
  }

  return {
    provider: 'fallback',
    segments: [],
    warnings: [
      ...warnings,
      'No ASR transcript was produced. Configure FUNASR_API_URL or FASTER_WHISPER_API_URL to enable transcription.'
    ]
  };
};

const concatAudioChunks = async (chunkPaths: string[], targetPath: string) => {
  if (chunkPaths.length === 1) {
    await fs.copyFile(chunkPaths[0], targetPath);
    return;
  }

  const listPath = `${targetPath}.txt`;
  await fs.writeFile(listPath, chunkPaths.map((chunkPath) => `file '${chunkPath.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
  try {
    await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', targetPath], {
      timeout: ASR_TIMEOUT_MS
    });
  } finally {
    await fs.unlink(listPath).catch(() => undefined);
  }
};

const generateNoteDraft = async (transcriptText: string, fileName: string) => {
  if (!transcriptText.trim()) {
    return [
      `# ${fileName.replace(/\.[^/.]+$/, '')} 课堂笔记`,
      '',
      '## 转写状态',
      '',
      'ASR 暂未产生可用转写。请确认 FunASR 或 faster-whisper 服务已配置并重试。'
    ].join('\n');
  }

  try {
    const result = await aiModelProviderService.chat(
      [
        {
          role: 'user',
          content: [
            '请把下面的课堂录音转写整理成 Markdown 学习笔记。',
            '要求：保留事实，不要虚构；按主题分段；包含核心概念、老师强调、例子/题目、我的疑问、待复习点。',
            '只输出 Markdown。',
            '',
            `录音文件：${fileName}`,
            '',
            transcriptText.slice(0, 50000)
          ].join('\n')
        }
      ],
      undefined,
      { timeoutMs: 60000, useCase: 'chat' }
    );
    return result.reply.trim() || fallbackNoteDraft(transcriptText, fileName);
  } catch {
    return fallbackNoteDraft(transcriptText, fileName);
  }
};

const fallbackNoteDraft = (transcriptText: string, fileName: string) => [
  `# ${fileName.replace(/\.[^/.]+$/, '')} 课堂笔记`,
  '',
  '## 课堂转写',
  '',
  clip(transcriptText, 12000),
  '',
  '## 待整理',
  '',
  '- 核心概念：',
  '- 例题/证明：',
  '- 我的疑问：',
  '- 待复习点：'
].join('\n');

export class AudioNoteService {
  registerBackgroundJobs() {
    backgroundJobService.register(AUDIO_NOTE_JOB_TYPE, async (payload: { workspaceId: string; fileObjectId: string; provider?: AudioNoteProvider; jobId?: string }) => {
      await this.processAudioNote(payload.workspaceId, payload.fileObjectId, payload.provider || AUDIO_NOTE_PROVIDER, payload.jobId);
    });
  }

  async createRecording(input: { workspaceId: string; workbenchId: string; name?: string; mimeType?: string }) {
    if (!input.workbenchId) throw new FileSystemError(400, 'workbenchId is required');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const extension = input.mimeType?.includes('mp4') ? 'm4a' : input.mimeType?.includes('wav') ? 'wav' : 'webm';
    const name = input.name?.trim() || `lecture-recording-${timestamp}.${extension}`;
    const file = await FileSystemService.createFile({
      workspaceId: input.workspaceId,
      name,
      content: '',
      fileCategory: 'media',
      mimeType: input.mimeType || 'audio/webm',
      workbenchId: input.workbenchId,
      resourceRole: 'source',
      resourceType: 'source',
      scope: 'workbench',
      origin: 'recording',
      metadata: {
        [AUDIO_NOTE_METADATA_KEY]: createEmptyAnalysis()
      }
    });
    return { file, analysis: createEmptyAnalysis() };
  }

  async appendChunk(input: { workspaceId: string; fileObjectId: string; file: any; chunkIndex?: number }) {
    const recording = await prisma.fileSystemObject.findFirst({ where: { id: input.fileObjectId, workspaceId: input.workspaceId } });
    if (!recording) throw new FileSystemError(404, 'Recording resource not found');
    const chunkName = `${recording.name.replace(/\.[^/.]+$/, '')}.chunk-${String(input.chunkIndex ?? 0).padStart(4, '0')}.webm`;
    const chunk = await FileSystemService.handleUploadedFile(
      input.workspaceId,
      { ...input.file, originalname: chunkName },
      undefined,
      undefined,
      {
        workbenchId: recording.ownerWorkbenchId || undefined,
        resourceRole: 'source',
        scope: 'workbench',
        metadata: {
          audioNoteParentId: recording.id,
          chunkIndex: input.chunkIndex ?? 0
        },
        indexInBackground: false
      }
    );

    const analysis = getAnalysis(recording);
    const next = await saveAnalysis(recording.id, {
      ...analysis,
      status: 'recording',
      progress: {
        stage: 'recording',
        percent: Math.min(45, 5 + (analysis.chunks.length + 1) * 3),
        message: 'Audio chunk uploaded.',
        updatedAt: nowIso()
      },
      chunks: [
        ...analysis.chunks,
        {
          id: crypto.randomUUID(),
          index: input.chunkIndex ?? analysis.chunks.length,
          fileObjectId: chunk.id,
          name: chunk.name,
          size: chunk.size,
          createdAt: nowIso()
        }
      ]
    });
    return { chunk, analysis: next };
  }

  async finishRecording(input: { workspaceId: string; fileObjectId: string; provider?: AudioNoteProvider }) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: input.fileObjectId, workspaceId: input.workspaceId } });
    if (!file) throw new FileSystemError(404, 'Recording resource not found');
    const analysis = getAnalysis(file);
    const jobId = `${AUDIO_NOTE_JOB_TYPE}:${file.id}`;
    const queued = await saveAnalysis(file.id, {
      ...analysis,
      status: 'queued',
      provider: input.provider || analysis.provider || AUDIO_NOTE_PROVIDER,
      progress: {
        stage: 'queued',
        percent: 50,
        message: 'Waiting for ASR worker.',
        jobId,
        updatedAt: nowIso()
      }
    });
    backgroundJobService.enqueue(AUDIO_NOTE_JOB_TYPE, {
      workspaceId: input.workspaceId,
      fileObjectId: file.id,
      provider: input.provider || analysis.provider || AUDIO_NOTE_PROVIDER,
      jobId
    }, { id: jobId, maxAttempts: 1 });
    return queued;
  }

  async getAnalysis(workspaceId: string, fileObjectId: string) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'Audio note resource not found');
    const analysis = getAnalysis(file);
    const jobId = analysis.progress?.jobId;
    const job = jobId ? backgroundJobService.get(jobId) : null;
    return {
      ...analysis,
      progress: {
        ...analysis.progress,
        message: job?.lastError && job.status === 'failed' ? job.lastError : analysis.progress.message
      }
    };
  }

  async processAudioNote(workspaceId: string, fileObjectId: string, provider: AudioNoteProvider, jobId?: string) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'Audio note resource not found');
    let analysis = await saveAnalysis(file.id, {
      ...getAnalysis(file),
      status: 'processing',
      progress: {
        stage: 'preparing_audio',
        percent: 58,
        message: 'Preparing audio for ASR.',
        jobId,
        updatedAt: nowIso()
      }
    });

    try {
      const chunkRows = analysis.chunks.length
        ? await prisma.fileSystemObject.findMany({
            where: { id: { in: analysis.chunks.map((chunk) => chunk.fileObjectId) }, workspaceId }
          })
        : [file];
      const ordered = analysis.chunks.length
        ? analysis.chunks
            .map((chunk) => chunkRows.find((row) => row.id === chunk.fileObjectId))
            .filter(Boolean) as any[]
        : chunkRows;
      const chunkPaths = ordered
        .map((chunk) => chunk.storageKey ? LocalStorageService.getFilePath(chunk.storageKey) : null)
        .filter((value): value is string => Boolean(value));
      if (!chunkPaths.length) throw new Error('No audio chunks are available for transcription.');

      const workDir = path.resolve(__dirname, '../../uploads/.audio-notes');
      await fs.mkdir(workDir, { recursive: true });
      const mergedPath = path.join(workDir, `${file.id}.webm`);
      await concatAudioChunks(chunkPaths, mergedPath);

      analysis = await saveAnalysis(file.id, {
        ...analysis,
        status: 'processing',
        progress: {
          stage: 'transcribing',
          percent: 70,
          message: 'Running FunASR/faster-whisper transcription.',
          jobId,
          updatedAt: nowIso()
        }
      });

      const asr = await callAsrProvider(mergedPath, provider);
      const transcriptText = asr.segments.map((segment) => segment.text).join('\n').trim();
      const noteDraft = await generateNoteDraft(transcriptText, file.name);
      const { storageKey, size } = await LocalStorageService.saveBuffer(await fs.readFile(mergedPath), file.storageKey || undefined);
      await prisma.fileSystemObject.update({
        where: { id: file.id },
        data: { storageKey, size, isBinary: true }
      });
      await fs.unlink(mergedPath).catch(() => undefined);

      await saveAnalysis(file.id, {
        ...analysis,
        status: asr.segments.length ? 'draft_ready' : 'failed',
        provider: asr.provider,
        transcript: asr.segments,
        transcriptText,
        noteDraft,
        progress: {
          stage: asr.segments.length ? 'draft_ready' : 'failed',
          percent: 100,
          message: asr.segments.length ? 'Transcript and note draft are ready.' : 'ASR did not produce transcript text.',
          jobId,
          updatedAt: nowIso()
        },
        warnings: asr.warnings,
        error: asr.segments.length ? undefined : 'ASR did not produce transcript text.',
        completedAt: nowIso()
      });
    } catch (error: any) {
      await saveAnalysis(file.id, {
        ...analysis,
        status: 'failed',
        progress: {
          stage: 'failed',
          percent: 100,
          message: error?.message || 'Audio note processing failed.',
          jobId,
          updatedAt: nowIso()
        },
        error: error?.message || 'Audio note processing failed.'
      });
      throw error;
    }
  }
}

export const audioNoteService = new AudioNoteService();
