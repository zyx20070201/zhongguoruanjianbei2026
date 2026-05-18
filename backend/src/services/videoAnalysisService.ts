import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import prisma from '../config/db';
import { FileSystemError } from '../types/fileSystem';
import {
  SlideFrame,
  TranscriptSegment,
  VideoAnalysis,
  VideoAnalysisConfidence,
  VideoAnalysisErrorClass,
  VideoAnalysisProgress,
  VideoAnalysisReview,
  VideoAnalysisStage,
  VideoAnalysisStageRecord,
  VideoAnalysisStatus,
  VideoChapter,
  VideoEvidenceSegment,
  VideoKeyPoint,
  VideoProvider
} from '../types/videoAnalysis';
import { backgroundJobService } from './backgroundJobService';
import { aiModelProviderService } from './aiModelProviderService';
import { documentChunkStore, DocumentChunkInput } from './documentChunkStore';
import { LocalStorageService } from './storage/localStorageService';
import { stableHash } from './chunkSchema';
import { vectorStoreService } from './vectorStoreService';
import { generateNewPath, getExtension } from '../utils/path';

const MAX_TRANSCRIPT_SEGMENTS_FOR_LLM = Number(process.env.VIDEO_ANALYSIS_MAX_SEGMENTS || 180);
const MAX_SLIDES = Number(process.env.VIDEO_ANALYSIS_MAX_SLIDES || 12);
const FRAME_INTERVAL_SECONDS = Number(process.env.VIDEO_FRAME_INTERVAL_SECONDS || 60);
const SLIDE_SAMPLE_INTERVAL_SECONDS = Number(process.env.VIDEO_SLIDE_SAMPLE_INTERVAL_SECONDS || 15);
const SLIDE_CHANGE_THRESHOLD = Number(process.env.VIDEO_SLIDE_CHANGE_THRESHOLD || 0.025);
const SLIDE_MIN_GAP_SECONDS = Number(process.env.VIDEO_SLIDE_MIN_GAP_SECONDS || 20);
const SLIDE_END_PADDING_SECONDS = Number(process.env.VIDEO_SLIDE_END_PADDING_SECONDS || 60);
const SLIDE_MAX_SAMPLES = Number(process.env.VIDEO_SLIDE_MAX_SAMPLES || 360);
const SLIDE_SIGNATURE_WIDTH = 64;
const SLIDE_SIGNATURE_HEIGHT = 36;
const TRANSCRIPT_MERGE_GAP_SECONDS = Number(process.env.VIDEO_TRANSCRIPT_MERGE_GAP_SECONDS || 1.2);
const TRANSCRIPT_MIN_SEGMENT_SECONDS = Number(process.env.VIDEO_TRANSCRIPT_MIN_SEGMENT_SECONDS || 15);
const TRANSCRIPT_MAX_SEGMENT_SECONDS = Number(process.env.VIDEO_TRANSCRIPT_MAX_SEGMENT_SECONDS || 45);
const TRANSCRIPT_MIN_SEGMENT_CHARS = Number(process.env.VIDEO_TRANSCRIPT_MIN_SEGMENT_CHARS || 80);
const TRANSCRIPT_MAX_SEGMENT_CHARS = Number(process.env.VIDEO_TRANSCRIPT_MAX_SEGMENT_CHARS || 220);
const VIDEO_ANALYSIS_PROVIDER = (process.env.VIDEO_ANALYSIS_PROVIDER || 'local').trim().toLowerCase();
const VIDEO_ANALYSIS_BASE_URL = (process.env.VIDEO_ANALYSIS_BASE_URL || process.env.VIDEO_ANALYSIS_SERVICE_URL || '').replace(/\/$/, '');
const VIDEO_ANALYSIS_API_KEY = process.env.VIDEO_ANALYSIS_API_KEY || '';
const VIDEO_ANALYSIS_TIMEOUT_MS = Number(process.env.VIDEO_ANALYSIS_TIMEOUT_MS || 30 * 60 * 1000);
const VIDEO_ANALYSIS_STALE_MS = Number(process.env.VIDEO_ANALYSIS_STALE_MS || 30 * 60 * 1000);
const VIDEO_ANALYSIS_HEARTBEAT_STALE_MS = Number(process.env.VIDEO_ANALYSIS_HEARTBEAT_STALE_MS || 90 * 1000);
const VIDEO_YTDLP_COOKIES_FROM_BROWSER = (process.env.VIDEO_YTDLP_COOKIES_FROM_BROWSER || '').trim();
const VIDEO_REMOTE_FRAME_WINDOW_SECONDS = Number(process.env.VIDEO_REMOTE_FRAME_WINDOW_SECONDS || process.env.VIDEO_MAX_DOWNLOAD_SECTION_SECONDS || 600);
const VIDEO_REMOTE_FRAME_FORMAT = process.env.VIDEO_REMOTE_FRAME_FORMAT || '18/b[height<=360][ext=mp4]/bv*[height<=360][ext=mp4]/best[height<=360]/best';
const VIDEO_OCR_LANG = process.env.VIDEO_OCR_LANG || 'eng+chi_sim';
const VIDEO_OCR_TIMEOUT_MS = Number(process.env.VIDEO_OCR_TIMEOUT_MS || 45000);
const VIDEO_SLIDE_DUPLICATE_TEXT_THRESHOLD = Number(process.env.VIDEO_SLIDE_DUPLICATE_TEXT_THRESHOLD || 0.92);
const VIDEO_SLIDE_ALIGN_WINDOW_SECONDS = Number(process.env.VIDEO_SLIDE_ALIGN_WINDOW_SECONDS || 90);

const parseJsonObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const serializeMetadata = (value: Record<string, unknown>) => JSON.stringify(value || {});

const VIDEO_STAGE_LABELS: Record<VideoAnalysisStage, string> = {
  idle: 'Idle',
  queued: 'Queued',
  fetching_metadata: 'Fetching metadata',
  extracting_captions: 'Extracting captions',
  transcript_ready: 'Transcript ready',
  analyzing_transcript: 'Analyzing transcript',
  extracting_slides: 'Extracting slides',
  running_ocr: 'Running OCR',
  aligning_slides: 'Aligning slides',
  indexing_context: 'Indexing context',
  completed: 'Completed',
  degraded: 'Partial result',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

const STAGE_PERCENT: Record<VideoAnalysisStage, number> = {
  idle: 0,
  queued: 3,
  fetching_metadata: 8,
  extracting_captions: 18,
  transcript_ready: 35,
  analyzing_transcript: 52,
  extracting_slides: 70,
  running_ocr: 82,
  aligning_slides: 88,
  indexing_context: 94,
  completed: 100,
  degraded: 100,
  failed: 100,
  cancelled: 100
};

const classifyVideoError = (value: unknown): VideoAnalysisErrorClass => {
  const message = String(value instanceof Error ? value.message : value || '').toLowerCase();
  if (/cancel/.test(message)) return 'cancelled';
  if (/timeout|timed out|etimedout|socket/.test(message)) return 'network_timeout';
  if (/sign in|login|cookies|cookie|confirm.*not.*bot|bot/i.test(message)) return 'cookie_required';
  if (/youtube|403|429|blocked|unavailable|private/.test(message)) return 'youtube_blocked';
  if (/caption|subtitle|subtitles|vtt/.test(message)) return 'caption_unavailable';
  if (/ffmpeg|video format|stream-url|frame/.test(message)) return 'ffmpeg_failed';
  if (/tesseract|ocr/.test(message)) return 'ocr_unavailable';
  if (/llm|deepseek|json|model/.test(message)) return 'llm_timeout';
  if (/vector|qdrant|embedding/.test(message)) return 'vector_index_failed';
  if (/interrupt|heartbeat|stale|lost/.test(message)) return 'job_interrupted';
  return 'unknown';
};

const createProgress = (patch: Partial<VideoAnalysisProgress> = {}): VideoAnalysisProgress => ({
  stage: patch.stage || 'idle',
  percent: patch.percent ?? STAGE_PERCENT[patch.stage || 'idle'],
  message: patch.message,
  heartbeatAt: patch.heartbeatAt,
  jobId: patch.jobId,
  queuePosition: patch.queuePosition,
  attempt: patch.attempt,
  canCancel: patch.canCancel,
  canRetry: patch.canRetry,
  stages: patch.stages || [],
  timings: patch.timings || {},
  costEstimate: patch.costEstimate,
  errorClass: patch.errorClass
});

const createEmptyAnalysis = (patch: Partial<VideoAnalysis> = {}): VideoAnalysis => ({
  version: 1,
  status: patch.status || 'idle',
  provider: patch.provider || 'unknown',
  sourceUrl: patch.sourceUrl,
  duration: patch.duration,
  title: patch.title,
  summary: patch.summary || '',
  summaryEvidenceSegments: patch.summaryEvidenceSegments || [],
  summaryConfidence: patch.summaryConfidence,
  summarySourceRange: patch.summarySourceRange,
  summaryManuallyEdited: patch.summaryManuallyEdited,
  manualRevision: patch.manualRevision,
  review: patch.review,
  original: patch.original,
  transcript: patch.transcript || [],
  chapters: patch.chapters || [],
  keyPoints: patch.keyPoints || [],
  slides: patch.slides || [],
  generatedAt: patch.generatedAt,
  queuedAt: patch.queuedAt,
  startedAt: patch.startedAt,
  completedAt: patch.completedAt,
  failedAt: patch.failedAt,
  runId: patch.runId,
  error: patch.error,
  errorClass: patch.errorClass,
  progress: patch.progress ? createProgress(patch.progress) : undefined,
  warnings: patch.warnings || [],
  tools: patch.tools || {}
});

const secondsToClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

const timestampToSeconds = (value: string) => {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

const stripTags = (value: string) =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCaptionLine = (value: string) => stripTags(value).toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeTranscriptText = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, '$1$2')
    .replace(/\s+([，。！？、；：,.!?;:])/g, '$1')
    .replace(/([，。！？、；：,.!?;:])\s+/g, '$1 ')
    .replace(/([^，。！？,.!?]{1,8}[，。！？,.!?])\s+\1/g, '$1')
    .trim();

const hasSentenceBoundary = (value: string) => /[。！？.!?][”’"')）\]]?$/.test(value.trim());

const removeRollingCaptionOverlap = (previousText: string, currentText: string) => {
  const previous = normalizeTranscriptText(previousText);
  const current = normalizeTranscriptText(currentText);
  if (!current) return '';
  if (!previous) return current;
  if (previous.includes(current)) return '';

  const maxOverlap = Math.min(previous.length, current.length);
  for (let length = maxOverlap; length >= 4; length -= 1) {
    if (previous.endsWith(current.slice(0, length))) {
      return current.slice(length).replace(/^[\s,，、。！？.!?]+/, '').trim();
    }
  }

  return current;
};

const shouldCloseTranscriptGroup = (segment: TranscriptSegment) => {
  const duration = segment.end - segment.start;
  const textLength = segment.text.length;
  if (duration >= TRANSCRIPT_MAX_SEGMENT_SECONDS || textLength >= TRANSCRIPT_MAX_SEGMENT_CHARS) return true;
  if (duration >= TRANSCRIPT_MIN_SEGMENT_SECONDS && textLength >= TRANSCRIPT_MIN_SEGMENT_CHARS && hasSentenceBoundary(segment.text)) return true;
  return false;
};

const groupTranscriptSegments = (segments: TranscriptSegment[]): TranscriptSegment[] => {
  const grouped: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  let lastFlushedText = '';

  const flush = () => {
    if (!current) return;
    const text = normalizeTranscriptText(current.text);
    if (text) {
      grouped.push({
        ...current,
        id: `t${grouped.length + 1}`,
        text
      });
      lastFlushedText = text;
    }
    current = null;
  };

  for (const segment of segments) {
    const text = normalizeTranscriptText(lastFlushedText ? removeRollingCaptionOverlap(lastFlushedText, segment.text) : segment.text);
    if (!text) continue;

    if (!current) {
      current = { ...segment, text };
      if (shouldCloseTranscriptGroup(current)) flush();
      continue;
    }

    const gap = segment.start - current.end;
    const isContinuous = gap <= TRANSCRIPT_MERGE_GAP_SECONDS;
    if (!isContinuous || shouldCloseTranscriptGroup(current)) {
      flush();
      current = { ...segment, text };
      if (shouldCloseTranscriptGroup(current)) flush();
      continue;
    }

    const incrementalText = removeRollingCaptionOverlap(current.text, text);
    current.end = Math.max(current.end, segment.end);
    if (incrementalText) {
      current.text = normalizeTranscriptText(`${current.text} ${incrementalText}`);
    }
    if (shouldCloseTranscriptGroup(current)) flush();
  }

  flush();
  return grouped;
};

const parseCaptionText = (text: string, source: TranscriptSegment['source']): TranscriptSegment[] => {
  const normalized = text.replace(/\r/g, '');
  const blocks = normalized.split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  let previousText = '';

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timeIndex].split('-->').map((value) => value.trim().split(/\s+/)[0]);
    const body = lines.slice(timeIndex + 1).map(stripTags).filter(Boolean).join(' ');
    if (!body) continue;
    const start = timestampToSeconds(rawStart);
    const end = timestampToSeconds(rawEnd);
    const comparable = normalizeCaptionLine(body);
    if (comparable && comparable === previousText) continue;
    previousText = comparable;
    segments.push({
      id: `t${segments.length + 1}`,
      start,
      end: end > start ? end : start + 4,
      text: body,
      source
    });
  }

  return groupTranscriptSegments(segments);
};

const pickCaptionTrack = (metadata: any) => {
  const pools = [metadata?.subtitles, metadata?.automatic_captions];
  const languagePrefs = ['zh-Hans', 'zh-CN', 'zh', 'en'];

  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    const languages = Object.keys(pool);
    const ordered = [
      ...languagePrefs.filter((language) => languages.includes(language)),
      ...languages.filter((language) => !languagePrefs.includes(language))
    ];
    for (const language of ordered) {
      const tracks = Array.isArray(pool[language]) ? pool[language] : [];
      const track =
        tracks.find((item: any) => String(item?.ext || '').toLowerCase() === 'vtt') ||
        tracks.find((item: any) => String(item?.url || '').trim());
      if (track?.url) return { url: track.url, language, kind: pool === metadata?.subtitles ? 'manual' : 'automatic' };
    }
  }

  return null;
};

const execFileAsync = (command: string, args: string[], options: { timeout?: number } = {}) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { timeout: options.timeout || 120000, maxBuffer: 24 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });

const execFileBufferAsync = (command: string, args: string[], options: { timeout?: number; maxBuffer?: number } = {}) =>
  new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    execFile(command, args, {
      timeout: options.timeout || 180000,
      maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
      encoding: 'buffer'
    } as any, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(Buffer.isBuffer(stderr) ? stderr.toString().trim() || error.message : error.message));
        return;
      }
      resolve({
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''),
        stderr: Buffer.isBuffer(stderr) ? stderr.toString() : String(stderr || '')
      });
    });
  });

const pythonCommand = process.env.VIDEO_PYTHON_COMMAND || 'python3';

const ytDlpBaseArgs = [
  '-m',
  'yt_dlp',
  '--force-ipv4',
  '--socket-timeout',
  '20',
  '--retries',
  '2',
  '--fragment-retries',
  '2',
  '--extractor-retries',
  '2',
  '--remote-components',
  'ejs:github'
];

const ytDlpCookieArgs = () =>
  VIDEO_YTDLP_COOKIES_FROM_BROWSER ? ['--cookies-from-browser', VIDEO_YTDLP_COOKIES_FROM_BROWSER] : [];

const inferProvider = (sourceUrl?: string, isUpload?: boolean): VideoProvider => {
  if (isUpload) return 'upload';
  if (!sourceUrl) return 'unknown';
  try {
    const host = new URL(/^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`).hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('bilibili.com')) return 'bilibili';
    return 'web';
  } catch {
    return 'unknown';
  }
};

const normalizeVideoUrl = (sourceUrl?: string) => {
  if (!sourceUrl) return sourceUrl;
  try {
    const parsed = new URL(/^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      parsed.searchParams.delete('list');
      parsed.searchParams.delete('index');
      parsed.searchParams.delete('pp');
      parsed.searchParams.delete('start_radio');
    }
    return parsed.toString();
  } catch {
    return sourceUrl;
  }
};

const extractUrlFromMarkdown = (content?: string | null) => {
  const text = String(content || '');
  return /^URL:\s*(.+)$/mi.exec(text)?.[1]?.trim();
};

const sanitizeFilename = (value: string) =>
  value
    .trim()
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 70)
    .trim() || 'video-frame';

const safeNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isAnalysisStale = (analysis: VideoAnalysis) => {
  if (analysis.status !== 'queued' && analysis.status !== 'processing') return false;
  const timestamp = analysis.startedAt || analysis.queuedAt;
  if (!timestamp) return true;
  const startedAt = new Date(timestamp).getTime();
  return !Number.isFinite(startedAt) || Date.now() - startedAt > VIDEO_ANALYSIS_STALE_MS;
};

const evidenceFromSegment = (segment: TranscriptSegment): VideoEvidenceSegment => ({
  segmentId: segment.id,
  start: segment.start,
  end: segment.end,
  text: segment.text,
  source: segment.source
});

const dedupeEvidenceSegments = (segments: TranscriptSegment[]) => {
  const seen = new Set<string>();
  return segments
    .filter((segment) => {
      if (seen.has(segment.id)) return false;
      seen.add(segment.id);
      return true;
    })
    .map(evidenceFromSegment);
};

const buildEvidenceSegments = (
  transcript: TranscriptSegment[],
  options: { timestamps?: number[]; range?: { start?: number; end?: number }; limit?: number } = {}
) => {
  if (!transcript.length) return [];
  const limit = options.limit || 3;
  const selected: TranscriptSegment[] = [];
  const rangeStart = safeNumber(options.range?.start, transcript[0].start);
  const rangeEnd = safeNumber(options.range?.end, options.range?.start == null ? transcript[transcript.length - 1].end : rangeStart + 90);

  for (const timestamp of options.timestamps || []) {
    const match =
      transcript.find((segment) => timestamp >= segment.start && timestamp <= segment.end) ||
      transcript.reduce((closest, segment) => {
        const currentDistance = Math.min(Math.abs(segment.start - timestamp), Math.abs(segment.end - timestamp));
        const closestDistance = Math.min(Math.abs(closest.start - timestamp), Math.abs(closest.end - timestamp));
        return currentDistance < closestDistance ? segment : closest;
      }, transcript[0]);
    selected.push(match);
  }

  const inRange = transcript.filter((segment) => segment.end >= rangeStart && segment.start <= rangeEnd);
  if (inRange.length) {
    selected.push(inRange[0]);
    selected.push(inRange[Math.floor(inRange.length / 2)]);
    selected.push(inRange[inRange.length - 1]);
  }

  if (!selected.length) {
    selected.push(transcript[0], transcript[Math.floor(transcript.length / 2)], transcript[transcript.length - 1]);
  }

  return dedupeEvidenceSegments(selected.filter(Boolean).slice(0, limit));
};

const confidenceFromEvidence = (
  evidenceSegments: VideoEvidenceSegment[],
  tool: string,
  manuallyEdited = false
): VideoAnalysisConfidence => {
  if (!evidenceSegments.length) return 'low';
  if (manuallyEdited) return 'medium';
  if (tool && tool !== 'local-heuristic' && tool !== 'none') return 'high';
  return 'medium';
};

const compactWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const titleFromOcrText = (text?: string) => {
  const lines = String(text || '')
    .split('\n')
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length >= 3);
  const candidate =
    lines.find((line) => line.length <= 90 && /[A-Za-z\u3400-\u9fff]/.test(line)) ||
    lines.find((line) => /[A-Za-z\u3400-\u9fff]/.test(line));
  return candidate ? candidate.slice(0, 120) : undefined;
};

const textSimilarity = (left?: string, right?: string) => {
  const a = compactWhitespace(String(left || '').toLowerCase());
  const b = compactWhitespace(String(right || '').toLowerCase());
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(/[\s,.;:!?，。；：！？、]+/).filter(Boolean));
  const tokensB = new Set(b.split(/[\s,.;:!?，。；：！？、]+/).filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;
  let intersection = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection += 1;
  });
  return intersection / Math.max(tokensA.size, tokensB.size);
};

const formatFfmpegHeaders = (headers: Record<string, unknown> = {}) =>
  Object.entries(headers)
    .filter(([_key, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${String(value).trim()}`)
    .join('\r\n');

const meanAbsoluteFrameDiff = (left: Buffer, right: Buffer) => {
  const length = Math.min(left.length, right.length);
  if (!length) return 1;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += Math.abs(left[index] - right[index]);
  }
  return sum / (length * 255);
};

const meanFrameLuma = (frame: Buffer) => {
  if (!frame.length) return 0;
  let sum = 0;
  for (const value of frame) sum += value;
  return sum / frame.length;
};

const compactToolError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, '[stream-url]')
    .slice(0, 220);

interface RemoteSlideFrame {
  id?: string;
  timestamp?: number;
  title?: string;
  ocrText?: string;
  mimeType?: string;
  imageBase64?: string;
}

interface RemoteVideoAnalysisResult {
  title?: string;
  duration?: number;
  provider?: VideoProvider;
  transcript?: TranscriptSegment[];
  slides?: RemoteSlideFrame[];
  warnings?: string[];
  tools?: VideoAnalysis['tools'];
}

interface RemoteVideoStream {
  url: string;
  headers: Record<string, string>;
  formatId?: string;
  duration?: number;
}

interface SlideCandidateFrame {
  timestamp: number;
  pixels: Buffer;
}

export class VideoAnalysisService {
  private activeRunIds = new Set<string>();

  registerBackgroundJobs() {
    backgroundJobService.register('video.analyze', async (payload: { workspaceId: string; fileObjectId: string; runId?: string; jobId?: string; preserveManualEdits?: boolean }) => {
      await this.runAnalysis(payload.workspaceId, payload.fileObjectId, payload.runId, {
        jobId: payload.jobId,
        preserveManualEdits: Boolean(payload.preserveManualEdits)
      });
    });
  }

  async getAnalysis(workspaceId: string, fileObjectId: string) {
    const file = await this.getFile(workspaceId, fileObjectId);
    const metadata = parseJsonObject(file.metadataJson);
    const analysis = createEmptyAnalysis(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined);
    if (analysis.status === 'processing' || analysis.status === 'queued') {
      const heartbeatAt = analysis.progress?.heartbeatAt || analysis.startedAt || analysis.queuedAt;
      const heartbeatMs = heartbeatAt ? new Date(heartbeatAt).getTime() : NaN;
      const jobId = analysis.progress?.jobId;
      const job = jobId ? backgroundJobService.get(jobId) : null;
      const isActive = Boolean(analysis.runId && this.activeRunIds.has(analysis.runId));
      const stale = !Number.isFinite(heartbeatMs) || Date.now() - heartbeatMs > VIDEO_ANALYSIS_HEARTBEAT_STALE_MS;
      if (stale && !isActive && (!job || job.status === 'failed' || job.status === 'completed')) {
        const next = this.markAnalysisFailed(analysis, 'Video analysis job was interrupted before completion.', 'job_interrupted');
        await this.updateAnalysis(fileObjectId, metadata, next);
        return next;
      }
      return this.withQueueRuntime(analysis);
    }
    return analysis;
  }

  async enqueueAnalysis(workspaceId: string, fileObjectId: string, options: { force?: boolean; preserveManualEdits?: boolean } = {}) {
    const file = await this.getFile(workspaceId, fileObjectId);
    const metadata = parseJsonObject(file.metadataJson);
    const existing = createEmptyAnalysis(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined);

    if (!options.force && (existing.status === 'queued' || existing.status === 'processing') && !isAnalysisStale(existing)) {
      return existing;
    }

    if (!options.force && existing.status === 'ready') {
      return existing;
    }

    const runId = `${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
    const jobId = `video.analyze:${workspaceId}:${fileObjectId}:${runId}`;
    const next = createEmptyAnalysis({
      ...existing,
      status: 'queued',
      provider: inferProvider(this.resolveSourceUrl(file, metadata), file.fileCategory === 'media'),
      sourceUrl: normalizeVideoUrl(this.resolveSourceUrl(file, metadata)),
      queuedAt: new Date().toISOString(),
      startedAt: undefined,
      completedAt: undefined,
      failedAt: undefined,
      generatedAt: undefined,
      runId,
      error: undefined,
      errorClass: undefined,
      warnings: [],
      progress: createProgress({
        stage: 'queued',
        percent: STAGE_PERCENT.queued,
        message: 'Waiting for a video analysis worker.',
        heartbeatAt: new Date().toISOString(),
        jobId,
        canCancel: true,
        canRetry: false,
        stages: [{
          stage: 'queued',
          status: 'running',
          label: VIDEO_STAGE_LABELS.queued,
          message: 'Waiting for a video analysis worker.',
          startedAt: new Date().toISOString()
        }]
      })
    });

    await this.updateAnalysis(file.id, metadata, next);
    backgroundJobService.enqueue(
      'video.analyze',
      { workspaceId, fileObjectId, runId, jobId, preserveManualEdits: Boolean(options.preserveManualEdits) },
      { id: jobId, maxAttempts: 1 }
    );
    return this.withQueueRuntime(next);
  }

  async cancelAnalysis(workspaceId: string, fileObjectId: string) {
    const file = await this.getFile(workspaceId, fileObjectId);
    const metadata = parseJsonObject(file.metadataJson);
    const existing = createEmptyAnalysis(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined);
    if (existing.progress?.jobId) backgroundJobService.cancel(existing.progress.jobId);
    const nowIso = new Date().toISOString();
    const next = createEmptyAnalysis({
      ...existing,
      status: 'cancelled',
      failedAt: nowIso,
      error: 'Video analysis was cancelled.',
      errorClass: 'cancelled',
      progress: this.mergeProgress(existing.progress, {
        stage: 'cancelled',
        percent: 100,
        message: 'Video analysis was cancelled.',
        heartbeatAt: nowIso,
        canCancel: false,
        canRetry: true,
        errorClass: 'cancelled',
        record: {
          stage: 'cancelled',
          status: 'cancelled',
          message: 'Video analysis was cancelled.',
          startedAt: nowIso,
          endedAt: nowIso,
          durationMs: 0,
          errorClass: 'cancelled'
        }
      })
    });
    await this.updateAnalysis(fileObjectId, metadata, next);
    return next;
  }

  async saveManualRevision(workspaceId: string, fileObjectId: string, patch: {
    summary?: string;
    chapters?: Array<Partial<VideoChapter> & { id: string }>;
    keyPoints?: Array<Partial<VideoKeyPoint> & { id: string }>;
    review?: Partial<VideoAnalysisReview>;
  }) {
    const file = await this.getFile(workspaceId, fileObjectId);
    const metadata = parseJsonObject(file.metadataJson);
    const existing = createEmptyAnalysis(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined);
    const updatedAt = new Date().toISOString();
    const manualRevision = {
      revision: (existing.manualRevision?.revision || 0) + 1,
      updatedAt,
      preservedFromRunId: existing.runId
    };
    const original = existing.original || {
      summary: existing.summary,
      chapters: existing.chapters,
      keyPoints: existing.keyPoints,
      generatedAt: existing.generatedAt,
      runId: existing.runId
    };
    const review = patch.review
      ? {
          status: patch.review.status || existing.review?.status || 'draft',
          locked: patch.review.locked ?? existing.review?.locked ?? false,
          updatedAt
        }
      : existing.review;

    const next = createEmptyAnalysis({
      ...existing,
      summary: typeof patch.summary === 'string' ? patch.summary.trim() : existing.summary,
      summaryManuallyEdited: typeof patch.summary === 'string' ? true : existing.summaryManuallyEdited,
      manualRevision,
      review,
      original,
      chapters: Array.isArray(patch.chapters)
        ? patch.chapters.map((chapter, index) => {
            const previous = existing.chapters.find((item) => item.id === chapter.id);
            return {
              id: chapter.id || previous?.id || `c${index + 1}`,
              title: String(chapter.title ?? previous?.title ?? `Chapter ${index + 1}`).trim(),
              start: safeNumber(chapter.start, previous?.start || 0),
              end: chapter.end == null ? previous?.end : safeNumber(chapter.end, previous?.end || safeNumber(chapter.start, previous?.start || 0)),
              summary: String(chapter.summary ?? previous?.summary ?? '').trim(),
              keyPoints: Array.isArray(chapter.keyPoints)
                ? chapter.keyPoints.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 12)
                : previous?.keyPoints || [],
              evidenceSegments: chapter.evidenceSegments || previous?.evidenceSegments || [],
              confidence: confidenceFromEvidence(chapter.evidenceSegments || previous?.evidenceSegments || [], existing.tools.llm || '', true),
              sourceRange: chapter.sourceRange || previous?.sourceRange,
              manuallyEdited: true
            };
          })
        : existing.chapters,
      keyPoints: Array.isArray(patch.keyPoints)
        ? patch.keyPoints.map((point, index) => {
            const previous = existing.keyPoints.find((item) => item.id === point.id);
            return {
              id: point.id || previous?.id || `k${index + 1}`,
              concept: String(point.concept ?? previous?.concept ?? `Key point ${index + 1}`).trim(),
              explanation: String(point.explanation ?? previous?.explanation ?? '').trim(),
              timestamps: Array.isArray(point.timestamps)
                ? point.timestamps.map((value) => safeNumber(value)).filter((value) => value >= 0).slice(0, 8)
                : previous?.timestamps || [],
              evidenceSegments: point.evidenceSegments || previous?.evidenceSegments || [],
              confidence: confidenceFromEvidence(point.evidenceSegments || previous?.evidenceSegments || [], existing.tools.llm || '', true),
              sourceRange: point.sourceRange || previous?.sourceRange,
              manuallyEdited: true
            };
          })
        : existing.keyPoints
    });

    await this.updateAnalysis(fileObjectId, metadata, next);
    await this.indexVideoAnalysis(workspaceId, fileObjectId, next, 'video-analysis-manual-revision');
    return next;
  }

  async indexStoredAnalysis(workspaceId: string, fileObjectId: string, reason = 'video-analysis-context-index') {
    const analysis = await this.getAnalysis(workspaceId, fileObjectId);
    if (!analysis.summary && !analysis.transcript.length && !analysis.chapters.length && !analysis.keyPoints.length && !analysis.slides.length) {
      return [];
    }
    return this.indexVideoAnalysis(workspaceId, fileObjectId, this.enrichSlides(analysis), reason);
  }

  private withQueueRuntime(analysis: VideoAnalysis) {
    const jobId = analysis.progress?.jobId;
    if (!jobId) return this.normalizeTerminalProgress(analysis);
    const job = backgroundJobService.get(jobId);
    const queuePosition = backgroundJobService.queuePosition(jobId);
    return this.normalizeTerminalProgress(createEmptyAnalysis({
      ...analysis,
      progress: createProgress({
        ...analysis.progress,
        queuePosition,
        attempt: job?.attempts ?? analysis.progress?.attempt,
        canCancel: analysis.status === 'queued' || analysis.status === 'processing',
        canRetry: analysis.status === 'failed' || analysis.status === 'degraded' || analysis.status === 'cancelled'
      })
    }));
  }

  private normalizeTerminalProgress(analysis: VideoAnalysis) {
    if (!analysis.progress || ['queued', 'processing'].includes(analysis.status)) return analysis;
    return createEmptyAnalysis({
      ...analysis,
      progress: createProgress({
        ...analysis.progress,
        canCancel: false,
        canRetry: analysis.status === 'failed' || analysis.status === 'degraded' || analysis.status === 'cancelled',
        stages: (analysis.progress.stages || []).map((stage) => {
          if (stage.status !== 'running') return stage;
          return {
            ...stage,
            status: analysis.status === 'failed'
              ? 'failed'
              : analysis.status === 'cancelled'
                ? 'cancelled'
                : 'completed',
            endedAt: stage.endedAt || analysis.completedAt || analysis.failedAt || new Date().toISOString()
          };
        })
      })
    });
  }

  private mergeProgress(
    previous: VideoAnalysisProgress | undefined,
    patch: Partial<VideoAnalysisProgress> & { record?: Partial<VideoAnalysisStageRecord> }
  ): VideoAnalysisProgress {
    const nowIso = new Date().toISOString();
    const stage = patch.stage || previous?.stage || 'idle';
    const stages = [...(previous?.stages || [])];
    const recordPatch = patch.record;
    if (recordPatch) {
      const existingIndex = stages.findIndex((item) => item.stage === recordPatch.stage);
      const previousRecord = existingIndex >= 0 ? stages[existingIndex] : undefined;
      const startedAt = recordPatch.startedAt || previousRecord?.startedAt || nowIso;
      const endedAt = recordPatch.endedAt;
      const durationMs = recordPatch.durationMs ?? (
        endedAt && startedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()) : previousRecord?.durationMs
      );
      const nextRecord: VideoAnalysisStageRecord = {
        stage: recordPatch.stage || stage,
        status: recordPatch.status || previousRecord?.status || 'running',
        label: recordPatch.label || previousRecord?.label || VIDEO_STAGE_LABELS[recordPatch.stage || stage],
        message: recordPatch.message ?? previousRecord?.message,
        tool: recordPatch.tool ?? previousRecord?.tool,
        startedAt,
        endedAt: recordPatch.endedAt ?? previousRecord?.endedAt,
        durationMs,
        outputCount: recordPatch.outputCount ?? previousRecord?.outputCount,
        costEstimate: recordPatch.costEstimate ?? previousRecord?.costEstimate,
        warning: recordPatch.warning ?? previousRecord?.warning,
        error: recordPatch.error ?? previousRecord?.error,
        errorClass: recordPatch.errorClass ?? previousRecord?.errorClass
      };
      if (existingIndex >= 0) stages[existingIndex] = nextRecord;
      else stages.push(nextRecord);
    }
    const timings = { ...(previous?.timings || {}), ...(patch.timings || {}) };
    const costEstimate = patch.costEstimate ?? previous?.costEstimate;
    const isTerminalStage = ['completed', 'degraded', 'failed', 'cancelled'].includes(stage);
    const normalizedStages = isTerminalStage
      ? stages.map((item) => {
          if (item.status !== 'running') return item;
          return {
            ...item,
            status: stage === 'failed' ? 'failed' : stage === 'cancelled' ? 'cancelled' : 'completed',
            endedAt: item.endedAt || nowIso
          } as VideoAnalysisStageRecord;
        })
      : stages;
    return createProgress({
      ...previous,
      ...patch,
      stage,
      percent: patch.percent ?? Math.max(previous?.percent || 0, STAGE_PERCENT[stage]),
      message: patch.message ?? previous?.message,
      heartbeatAt: patch.heartbeatAt || nowIso,
      jobId: patch.jobId ?? previous?.jobId,
      canCancel: patch.canCancel ?? previous?.canCancel,
      canRetry: patch.canRetry ?? previous?.canRetry,
      stages: normalizedStages,
      timings,
      costEstimate,
      errorClass: patch.errorClass ?? previous?.errorClass
    });
  }

  private markAnalysisFailed(analysis: VideoAnalysis, error: string, errorClass: VideoAnalysisErrorClass) {
    const nowIso = new Date().toISOString();
    return createEmptyAnalysis({
      ...analysis,
      status: errorClass === 'cancelled' ? 'cancelled' : 'failed',
      failedAt: nowIso,
      error,
      errorClass,
      progress: this.mergeProgress(analysis.progress, {
        stage: errorClass === 'cancelled' ? 'cancelled' : 'failed',
        percent: 100,
        message: error,
        heartbeatAt: nowIso,
        canCancel: false,
        canRetry: true,
        errorClass,
        record: {
          stage: errorClass === 'cancelled' ? 'cancelled' : 'failed',
          status: errorClass === 'cancelled' ? 'cancelled' : 'failed',
          message: error,
          startedAt: nowIso,
          endedAt: nowIso,
          error,
          errorClass
        }
      })
    });
  }

  private isCancellationRequested(analysis: VideoAnalysis) {
    return Boolean(analysis.progress?.jobId && backgroundJobService.isCancellationRequested(analysis.progress.jobId));
  }

  private async loadCurrentAnalysis(workspaceId: string, fileObjectId: string) {
    const file = await this.getFile(workspaceId, fileObjectId);
    const metadata = parseJsonObject(file.metadataJson);
    return {
      file,
      metadata,
      analysis: createEmptyAnalysis(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined)
    };
  }

  private async updateStage(workspaceId: string, fileObjectId: string, patch: {
    runId?: string;
    stage: VideoAnalysisStage;
    status?: VideoAnalysisStageRecord['status'];
    message?: string;
    percent?: number;
    tool?: string;
    outputCount?: number;
    warning?: string;
    error?: string;
    errorClass?: VideoAnalysisErrorClass;
    costEstimate?: number;
    statusOverride?: VideoAnalysisStatus;
    mutate?: (analysis: VideoAnalysis) => VideoAnalysis;
  }) {
    const { metadata, analysis } = await this.loadCurrentAnalysis(workspaceId, fileObjectId);
    if (patch.runId && analysis.runId && patch.runId !== analysis.runId) return analysis;
    const nowIso = new Date().toISOString();
    const currentStage = analysis.progress?.stages.find((item) => item.stage === patch.stage);
    const startedAt = currentStage?.startedAt || nowIso;
    const endedAt = patch.status && ['completed', 'failed', 'skipped', 'cancelled'].includes(patch.status) ? nowIso : undefined;
    const durationMs = endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()) : undefined;
    const nextProgress = this.mergeProgress(analysis.progress, {
      stage: patch.stage,
      percent: patch.percent ?? STAGE_PERCENT[patch.stage],
      message: patch.message,
      heartbeatAt: nowIso,
      canCancel: patch.statusOverride !== 'ready' && patch.statusOverride !== 'failed' && patch.statusOverride !== 'degraded',
      canRetry: false,
      errorClass: patch.errorClass,
      costEstimate: patch.costEstimate,
      timings: durationMs != null ? { [patch.stage]: durationMs } : undefined,
      record: {
        stage: patch.stage,
        status: patch.status || 'running',
        label: VIDEO_STAGE_LABELS[patch.stage],
        message: patch.message,
        tool: patch.tool,
        outputCount: patch.outputCount,
        warning: patch.warning,
        error: patch.error,
        errorClass: patch.errorClass,
        startedAt,
        endedAt,
        durationMs,
        costEstimate: patch.costEstimate
      }
    });
    let next = createEmptyAnalysis({
      ...analysis,
      status: patch.statusOverride || analysis.status,
      error: patch.error ?? analysis.error,
      errorClass: patch.errorClass ?? analysis.errorClass,
      progress: nextProgress
    });
    if (patch.mutate) next = patch.mutate(next);
    await this.updateAnalysis(fileObjectId, metadata, next);
    return next;
  }

  private async runAnalysis(workspaceId: string, fileObjectId: string, runId?: string, options: { preserveManualEdits?: boolean; jobId?: string } = {}) {
    const file = await this.getFile(workspaceId, fileObjectId);
    const metadata = parseJsonObject(file.metadataJson);
    const sourceUrl = normalizeVideoUrl(this.resolveSourceUrl(file, metadata));
    const provider = inferProvider(sourceUrl, file.fileCategory === 'media' || Boolean(file.mimeType?.startsWith('video/')));
    const started = createEmptyAnalysis({
      ...(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined),
      status: 'processing',
      provider,
      sourceUrl: normalizeVideoUrl(sourceUrl),
      title: file.name,
      startedAt: new Date().toISOString(),
      runId: runId || (metadata.videoAnalysis as Partial<VideoAnalysis> | undefined)?.runId,
      error: undefined,
      errorClass: undefined,
      progress: this.mergeProgress((metadata.videoAnalysis as Partial<VideoAnalysis> | undefined)?.progress, {
        stage: 'fetching_metadata',
        percent: STAGE_PERCENT.fetching_metadata,
        message: 'Fetching video metadata and caption tracks.',
        heartbeatAt: new Date().toISOString(),
        jobId: options.jobId || (metadata.videoAnalysis as Partial<VideoAnalysis> | undefined)?.progress?.jobId,
        canCancel: true,
        canRetry: false,
        record: {
          stage: 'fetching_metadata',
          status: 'running',
          message: 'Fetching video metadata and caption tracks.',
          startedAt: new Date().toISOString()
        }
      })
    });
    await this.updateAnalysisIfCurrentRun(workspaceId, fileObjectId, started);
    if (started.runId) this.activeRunIds.add(started.runId);

    const warnings: string[] = [];
    const tools: VideoAnalysis['tools'] = {};
    let transcript: TranscriptSegment[] = [];
    let title = file.name;
    let duration: number | undefined;
    let slides: SlideFrame[] = [];

    try {
      const assertNotCancelled = async () => {
        const current = await this.getAnalysis(workspaceId, fileObjectId);
        if (current.status === 'cancelled' || this.isCancellationRequested(current)) {
          throw new Error('cancelled');
        }
      };

      await assertNotCancelled();
      if (sourceUrl) {
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_captions',
          percent: STAGE_PERCENT.extracting_captions,
          message: 'Extracting platform captions with yt-dlp.'
        });
        const remote = await this.tryExtractRemoteCaptions(sourceUrl);
        transcript = remote.transcript;
        title = remote.title || title;
        duration = remote.duration;
        tools.captions = remote.tool;
        warnings.push(...remote.warnings);
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: transcript.length ? 'transcript_ready' : 'extracting_captions',
          status: transcript.length ? 'completed' : 'failed',
          percent: transcript.length ? STAGE_PERCENT.transcript_ready : STAGE_PERCENT.extracting_captions,
          message: transcript.length
            ? `Transcript ready with ${transcript.length} segments.`
            : 'No caption track was available.',
          tool: remote.tool,
          outputCount: transcript.length,
          warning: remote.warnings[0],
          errorClass: transcript.length ? undefined : 'caption_unavailable',
          mutate: (analysis) => createEmptyAnalysis({
            ...analysis,
            title,
            duration,
            transcript,
            tools: { ...analysis.tools, captions: remote.tool },
            warnings: [...new Set([...analysis.warnings, ...warnings])]
          })
        });
      }

      await assertNotCancelled();
      if (!slides.length && sourceUrl && VIDEO_YTDLP_COOKIES_FROM_BROWSER) {
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_slides',
          percent: STAGE_PERCENT.extracting_slides,
          message: 'Extracting slide-like frames from the remote video stream.'
        });
        slides = await this.tryExtractSlidesFromRemoteUrl(workspaceId, file, sourceUrl, warnings, tools);
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_slides',
          status: slides.length ? 'completed' : 'skipped',
          percent: STAGE_PERCENT.running_ocr,
          message: slides.length ? `Extracted ${slides.length} slide frames.` : 'No remote slide frames were extracted.',
          tool: tools.frames || tools.download,
          outputCount: slides.length,
          warning: warnings[warnings.length - 1],
          errorClass: slides.length ? undefined : 'ffmpeg_failed',
          mutate: (analysis) => createEmptyAnalysis({
            ...analysis,
            slides,
            tools: { ...analysis.tools, ...tools },
            warnings: [...new Set([...analysis.warnings, ...warnings])]
          })
        });
      }

      await assertNotCancelled();
      const shouldUseRemoteFallback = VIDEO_ANALYSIS_PROVIDER === 'autodl' && (!sourceUrl || !VIDEO_YTDLP_COOKIES_FROM_BROWSER);
      if (shouldUseRemoteFallback && (!transcript.length || !slides.length)) {
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: transcript.length ? 'extracting_slides' : 'extracting_captions',
          percent: transcript.length ? STAGE_PERCENT.extracting_slides : STAGE_PERCENT.extracting_captions,
          message: 'Running remote video analysis fallback.'
        });
        const remote = await this.tryRemoteAnalysis(workspaceId, file, sourceUrl, provider);
        transcript = transcript.length ? transcript : remote.transcript || [];
        title = remote.title || title;
        duration = duration ?? remote.duration;
        slides = slides.length ? slides : await this.persistRemoteSlides(workspaceId, file, remote.slides || []);
        tools.remote = 'autodl';
        Object.assign(tools, remote.tools || {});
        warnings.push(...(remote.warnings || []));
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: transcript.length ? 'transcript_ready' : 'extracting_captions',
          status: transcript.length || slides.length ? 'completed' : 'skipped',
          percent: transcript.length ? STAGE_PERCENT.transcript_ready : STAGE_PERCENT.extracting_slides,
          message: `Remote fallback returned ${transcript.length} transcript segments and ${slides.length} slides.`,
          tool: tools.remote,
          outputCount: transcript.length + slides.length,
          warning: warnings[warnings.length - 1],
          mutate: (analysis) => createEmptyAnalysis({
            ...analysis,
            title,
            duration,
            transcript,
            slides,
            tools: { ...analysis.tools, ...tools },
            warnings: [...new Set([...analysis.warnings, ...warnings])]
          })
        });
      }

      await assertNotCancelled();
      if (!transcript.length && sourceUrl) {
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_captions',
          percent: STAGE_PERCENT.extracting_captions,
          message: 'Retrying caption extraction.'
        });
        const remote = await this.tryExtractRemoteCaptions(sourceUrl);
        transcript = remote.transcript;
        title = remote.title || title;
        duration = remote.duration;
        tools.captions = remote.tool;
        warnings.push(...remote.warnings);
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: transcript.length ? 'transcript_ready' : 'extracting_captions',
          status: transcript.length ? 'completed' : 'failed',
          percent: transcript.length ? STAGE_PERCENT.transcript_ready : STAGE_PERCENT.extracting_captions,
          message: transcript.length ? `Transcript ready with ${transcript.length} segments.` : 'Caption retry did not find captions.',
          tool: remote.tool,
          outputCount: transcript.length,
          warning: remote.warnings[0],
          errorClass: transcript.length ? undefined : 'caption_unavailable',
          mutate: (analysis) => createEmptyAnalysis({
            ...analysis,
            title,
            duration,
            transcript,
            tools: { ...analysis.tools, captions: remote.tool },
            warnings: [...new Set([...analysis.warnings, ...warnings])]
          })
        });
      }

      await assertNotCancelled();
      if (!transcript.length && file.storageKey && file.mimeType?.startsWith('video/')) {
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_captions',
          percent: STAGE_PERCENT.extracting_captions,
          message: 'Transcribing uploaded video with ASR.'
        });
        const asr = await this.tryTranscribeLocalVideo(LocalStorageService.getFilePath(file.storageKey));
        transcript = asr.transcript;
        tools.asr = asr.tool;
        warnings.push(...asr.warnings);
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: transcript.length ? 'transcript_ready' : 'extracting_captions',
          status: transcript.length ? 'completed' : 'failed',
          percent: transcript.length ? STAGE_PERCENT.transcript_ready : STAGE_PERCENT.extracting_captions,
          message: transcript.length ? `ASR transcript ready with ${transcript.length} segments.` : 'ASR did not produce a transcript.',
          tool: asr.tool,
          outputCount: transcript.length,
          warning: asr.warnings[0],
          errorClass: transcript.length ? undefined : 'caption_unavailable',
          mutate: (analysis) => createEmptyAnalysis({
            ...analysis,
            transcript,
            tools: { ...analysis.tools, asr: asr.tool },
            warnings: [...new Set([...analysis.warnings, ...warnings])]
          })
        });
      }

      await assertNotCancelled();
      await this.updateStage(workspaceId, fileObjectId, {
        runId: started.runId,
        stage: 'analyzing_transcript',
        percent: STAGE_PERCENT.analyzing_transcript,
        message: 'Generating summary, chapters, and key points.'
      });
      const llm = await this.analyzeTranscript(title, transcript);
      tools.llm = llm.tool;
      warnings.push(...llm.warnings);
      await this.updateStage(workspaceId, fileObjectId, {
        runId: started.runId,
        stage: 'analyzing_transcript',
        status: llm.summary || llm.chapters.length || llm.keyPoints.length ? 'completed' : 'skipped',
        percent: STAGE_PERCENT.extracting_slides,
        message: `Generated ${llm.chapters.length} chapters and ${llm.keyPoints.length} key points.`,
        tool: llm.tool,
        outputCount: llm.chapters.length + llm.keyPoints.length + (llm.summary ? 1 : 0),
        warning: llm.warnings[0],
        mutate: (analysis) => createEmptyAnalysis({
          ...analysis,
          tools: { ...analysis.tools, llm: llm.tool },
          warnings: [...new Set([...analysis.warnings, ...warnings])]
        })
      });

      await assertNotCancelled();
      if (!slides.length && file.storageKey && file.mimeType?.startsWith('video/')) {
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_slides',
          percent: STAGE_PERCENT.extracting_slides,
          message: 'Extracting slide-like frames from uploaded video.'
        });
        slides = await this.tryExtractSlides(workspaceId, file, LocalStorageService.getFilePath(file.storageKey), warnings, tools);
        await this.updateStage(workspaceId, fileObjectId, {
          runId: started.runId,
          stage: 'extracting_slides',
          status: slides.length ? 'completed' : 'skipped',
          percent: STAGE_PERCENT.running_ocr,
          message: slides.length ? `Extracted ${slides.length} slide frames.` : 'No slide frames were extracted.',
          tool: tools.frames,
          outputCount: slides.length,
          warning: warnings[warnings.length - 1],
          errorClass: slides.length ? undefined : 'ffmpeg_failed',
          mutate: (analysis) => createEmptyAnalysis({
            ...analysis,
            slides,
            tools: { ...analysis.tools, ...tools },
            warnings: [...new Set([...analysis.warnings, ...warnings])]
          })
        });
      }

      await this.updateStage(workspaceId, fileObjectId, {
        runId: started.runId,
        stage: 'aligning_slides',
        percent: STAGE_PERCENT.aligning_slides,
        message: 'Aligning slides with chapters and transcript.'
      });
      const summaryRange = transcript.length ? { start: transcript[0].start, end: transcript[transcript.length - 1].end } : undefined;
      const summaryEvidenceSegments = buildEvidenceSegments(transcript, { range: summaryRange, limit: 4 });
      const chapters = this.withChapterEvidence(llm.chapters, transcript, llm.tool);
      const keyPoints = this.withKeyPointEvidence(llm.keyPoints, transcript, llm.tool);
      const status: VideoAnalysis['status'] = transcript.length || slides.length ? 'ready' : 'degraded';
      const completed = createEmptyAnalysis({
        status,
        provider,
        sourceUrl,
        title,
        duration,
        summary: llm.summary,
        summaryEvidenceSegments,
        summaryConfidence: confidenceFromEvidence(summaryEvidenceSegments, llm.tool),
        summarySourceRange: summaryRange,
        transcript,
        chapters,
        keyPoints,
        slides,
        generatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        warnings,
        tools
      });
      const finalAnalysis = options.preserveManualEdits
        ? this.applyManualEdits(completed, createEmptyAnalysis(metadata.videoAnalysis as Partial<VideoAnalysis> | undefined))
        : completed;
      const enrichedAnalysis = this.enrichSlides(finalAnalysis);
      if (!transcript.length) {
        enrichedAnalysis.warnings.push('No transcript was available. Install yt-dlp or configure ASR to enable summaries and chapters.');
      }
      enrichedAnalysis.progress = this.mergeProgress((await this.getAnalysis(workspaceId, fileObjectId)).progress, {
        stage: 'indexing_context',
        percent: STAGE_PERCENT.indexing_context,
        message: 'Writing video knowledge chunks into Workbench context.',
        heartbeatAt: new Date().toISOString(),
        canCancel: true,
        canRetry: false,
        record: {
          stage: 'aligning_slides',
          status: 'completed',
          message: 'Slides aligned with transcript and chapters.',
          endedAt: new Date().toISOString(),
          outputCount: enrichedAnalysis.slides.length
        }
      });
      await this.updateAnalysisIfCurrentRun(workspaceId, fileObjectId, enrichedAnalysis);
      await assertNotCancelled();
      await this.indexVideoAnalysis(workspaceId, fileObjectId, enrichedAnalysis, 'video-analysis-completed');
      const latest = await this.getAnalysis(workspaceId, fileObjectId);
      await this.updateStage(workspaceId, fileObjectId, {
        runId: started.runId,
        stage: status === 'ready' ? 'completed' : 'degraded',
        status: 'completed',
        statusOverride: status,
        percent: 100,
        message: status === 'ready' ? 'Video analysis completed.' : 'Video analysis completed with partial results.',
        outputCount: latest.transcript.length + latest.chapters.length + latest.keyPoints.length + latest.slides.length,
        mutate: (analysis) => createEmptyAnalysis({
          ...analysis,
          status,
          completedAt: new Date().toISOString(),
          progress: this.mergeProgress(analysis.progress, {
            stage: status === 'ready' ? 'completed' : 'degraded',
            percent: 100,
            message: status === 'ready' ? 'Video analysis completed.' : 'Video analysis completed with partial results.',
            heartbeatAt: new Date().toISOString(),
            canCancel: false,
            canRetry: status !== 'ready'
          })
        })
      });
    } catch (error) {
      const errorClass = classifyVideoError(error);
      const failed = this.markAnalysisFailed(createEmptyAnalysis({
        ...(await this.getAnalysis(workspaceId, fileObjectId)),
        warnings,
        tools
      }), error instanceof Error ? error.message : String(error), errorClass);
      await this.updateAnalysisIfCurrentRun(workspaceId, fileObjectId, failed);
      throw error;
    } finally {
      if (started.runId) this.activeRunIds.delete(started.runId);
    }
  }

  private async tryExtractRemoteCaptions(sourceUrl: string): Promise<{
    transcript: TranscriptSegment[];
    title?: string;
    duration?: number;
    tool: string;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    const normalizedUrl = normalizeVideoUrl(sourceUrl) || sourceUrl;
    try {
      const { stdout } = await execFileAsync(
        pythonCommand,
        [
          ...ytDlpBaseArgs,
          ...ytDlpCookieArgs(),
          '--ignore-no-formats-error',
          '--no-playlist',
          '-J',
          '--skip-download',
          normalizedUrl
        ],
        { timeout: 120000 }
      );
      const metadata = JSON.parse(stdout);
      const track = pickCaptionTrack(metadata);
      if (!track) {
        return {
          transcript: [],
          title: metadata?.title,
          duration: safeNumber(metadata?.duration, undefined as any),
          tool: 'yt-dlp:metadata',
          warnings: ['yt-dlp found the video, but no subtitle or auto-caption track was available.']
        };
      }

      const captionText = await this.downloadCaptionTextWithYtDlp(normalizedUrl, track.language).catch(async () => {
        const response = await fetch(track.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
          },
          signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error(`Caption download failed with status ${response.status}`);
        return response.text();
      });
      return {
        transcript: parseCaptionText(captionText, 'platform_caption'),
        title: metadata?.title,
        duration: safeNumber(metadata?.duration, undefined as any),
        tool: `yt-dlp:${track.language}:${track.kind}`,
        warnings
      };
    } catch (error) {
      warnings.push(`yt-dlp caption extraction unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { transcript: [], tool: 'yt-dlp:unavailable', warnings };
    }
  }

  private async downloadCaptionTextWithYtDlp(sourceUrl: string, language: string) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-video-captions-'));
    try {
      const languageAttempts = [
        language,
        [language, 'zh-Hans', 'zh-CN', 'zh', 'en.*'].filter(Boolean).join(',')
      ].filter((value, index, values) => value && values.indexOf(value) === index);

      let lastError: unknown;
      for (const subLanguages of languageAttempts) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        await fs.mkdir(tmpDir, { recursive: true });
        try {
          await execFileAsync(
            pythonCommand,
            [
              ...ytDlpBaseArgs,
              ...ytDlpCookieArgs(),
              '--ignore-no-formats-error',
              '--no-playlist',
              '--skip-download',
              '--write-subs',
              '--write-auto-subs',
              '--sub-langs',
              subLanguages,
              '--sub-format',
              'vtt',
              '-o',
              path.join(tmpDir, 'caption.%(ext)s'),
              sourceUrl
            ],
            { timeout: 90000 }
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      const files = (await fs.readdir(tmpDir)).filter((file) => file.endsWith('.vtt')).sort();
      if (!files.length) throw new Error(`yt-dlp did not write a ${language} caption file`);
      const preferredLanguages = [language, 'zh-Hans', 'zh-CN', 'zh', 'en-orig', 'en'];
      const selected =
        preferredLanguages
          .map((preferred) => files.find((file) => file.includes(`.${preferred}.`)))
          .find((file): file is string => Boolean(file)) || files[0];
      return fs.readFile(path.join(tmpDir, selected), 'utf-8');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async tryRemoteAnalysis(
    workspaceId: string,
    file: any,
    sourceUrl: string | undefined,
    provider: VideoProvider
  ): Promise<RemoteVideoAnalysisResult> {
    if (!VIDEO_ANALYSIS_BASE_URL) {
      return {
        transcript: [],
        slides: [],
        tools: { remote: 'autodl:unconfigured' },
        warnings: ['VIDEO_ANALYSIS_PROVIDER=autodl, but VIDEO_ANALYSIS_BASE_URL is not configured.']
      };
    }

    const payload: Record<string, unknown> = {
      workspaceId,
      fileObjectId: file.id,
      sourceUrl,
      provider,
      title: file.name,
      mimeType: file.mimeType,
      maxSlides: MAX_SLIDES,
      frameIntervalSeconds: FRAME_INTERVAL_SECONDS,
      whisperModel: process.env.VIDEO_WHISPER_MODEL || 'base'
    };

    if (!sourceUrl && file.storageKey && file.mimeType?.startsWith('video/')) {
      const bytes = await fs.readFile(LocalStorageService.getFilePath(file.storageKey));
      payload.fileName = file.name;
      payload.fileBase64 = bytes.toString('base64');
    }

    const response = await fetch(`${VIDEO_ANALYSIS_BASE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(VIDEO_ANALYSIS_API_KEY ? { Authorization: `Bearer ${VIDEO_ANALYSIS_API_KEY}` } : {})
      },
      signal: AbortSignal.timeout(VIDEO_ANALYSIS_TIMEOUT_MS),
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.detail || data?.error || `AutoDL video analysis failed with status ${response.status}`);
    }

    return {
      ...data,
      transcript: Array.isArray(data?.transcript)
        ? data.transcript.map((segment: any, index: number) => ({
            id: String(segment.id || `t${index + 1}`),
            start: safeNumber(segment.start),
            end: safeNumber(segment.end, safeNumber(segment.start) + 4),
            text: String(segment.text || '').trim(),
            source: segment.source === 'platform_caption' || segment.source === 'asr' ? segment.source : 'unknown'
          })).filter((segment: TranscriptSegment) => segment.text)
        : [],
      slides: Array.isArray(data?.slides) ? data.slides : [],
      warnings: Array.isArray(data?.warnings) ? data.warnings.map(String) : [],
      tools: data?.tools && typeof data.tools === 'object' ? data.tools : { remote: 'autodl' }
    };
  }

  private async persistRemoteSlides(workspaceId: string, sourceFile: any, slides: RemoteSlideFrame[]): Promise<SlideFrame[]> {
    const persisted: SlideFrame[] = [];
    for (const [index, slide] of slides.slice(0, MAX_SLIDES).entries()) {
      let imageFileId: string | undefined;
      let ocrText = slide.ocrText || '';
      if (slide.imageBase64) {
        const image = Buffer.from(slide.imageBase64, 'base64');
        if (!ocrText) ocrText = await this.ocrSlideBuffer(image, []);
        const imageFile = await this.createSlideImageFile(workspaceId, sourceFile, image, index + 1);
        imageFileId = imageFile.id;
      }
      persisted.push({
        id: String(slide.id || `s${index + 1}`),
        timestamp: safeNumber(slide.timestamp, index * FRAME_INTERVAL_SECONDS),
        imageFileId,
        title: slide.title || titleFromOcrText(ocrText) || `Frame ${index + 1}`,
        ocrText
      });
    }
    return persisted;
  }

  private async tryTranscribeLocalVideo(filePath: string): Promise<{ transcript: TranscriptSegment[]; tool: string; warnings: string[] }> {
    const warnings: string[] = [];
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-video-asr-'));
    try {
      const script = [
        'from faster_whisper import WhisperModel',
        'import json, os, sys',
        'video_path, output_dir, model_name = sys.argv[1], sys.argv[2], sys.argv[3]',
        'model = WhisperModel(model_name, device=os.environ.get("VIDEO_WHISPER_DEVICE", "cpu"), compute_type=os.environ.get("VIDEO_WHISPER_COMPUTE_TYPE", "int8"))',
        'segments, info = model.transcribe(video_path, beam_size=5, vad_filter=True)',
        'def clock(value):',
        '    value = max(0, float(value or 0))',
        '    h = int(value // 3600)',
        '    m = int((value % 3600) // 60)',
        '    s = value % 60',
        '    return f"{h:02d}:{m:02d}:{s:06.3f}"',
        'vtt_path = os.path.join(output_dir, "transcript.vtt")',
        'with open(vtt_path, "w", encoding="utf-8") as f:',
        '    f.write("WEBVTT\\n\\n")',
        '    for index, segment in enumerate(segments, start=1):',
        '        f.write(f"{index}\\n{clock(segment.start)} --> {clock(segment.end)}\\n{segment.text.strip()}\\n\\n")',
        'print(json.dumps({"language": info.language, "duration": info.duration}, ensure_ascii=False))'
      ].join('\n');
      await execFileAsync(pythonCommand, ['-c', script, filePath, tmpDir, process.env.VIDEO_WHISPER_MODEL || 'base'], {
        timeout: Number(process.env.VIDEO_ASR_TIMEOUT_MS || 900000)
      });
      const files = await fs.readdir(tmpDir);
      const vtt = files.find((file) => file.endsWith('.vtt'));
      if (!vtt) throw new Error('faster-whisper did not produce a VTT transcript');
      const text = await fs.readFile(path.join(tmpDir, vtt), 'utf-8');
      return { transcript: parseCaptionText(text, 'asr'), tool: 'faster-whisper', warnings };
    } catch (error) {
      warnings.push(`ASR unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { transcript: [], tool: 'faster-whisper:unavailable', warnings };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async analyzeTranscript(title: string, transcript: TranscriptSegment[]): Promise<{
    summary: string;
    chapters: VideoChapter[];
    keyPoints: VideoKeyPoint[];
    tool: string;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    if (!transcript.length) {
      return { summary: '', chapters: [], keyPoints: [], tool: 'none', warnings };
    }

    const sampled = transcript.slice(0, MAX_TRANSCRIPT_SEGMENTS_FOR_LLM).map((segment) => ({
      start: segment.start,
      end: segment.end,
      t: secondsToClock(segment.start),
      text: segment.text
    }));

    if (!aiModelProviderService.isConfigured({ useCase: 'video' })) {
      warnings.push('AI video provider is not configured. Used a local heuristic summary.');
      return this.heuristicTranscriptAnalysis(transcript);
    }

    try {
      const response = await aiModelProviderService.json<{
        summary?: string;
        chapters?: Array<{ title?: string; start?: number; end?: number; summary?: string; keyPoints?: string[] }>;
        keyPoints?: Array<{ concept?: string; explanation?: string; timestamps?: number[] }>;
      }>({
        useCase: 'video',
        instruction: [
          '你是一个学习视频分析器。请基于字幕生成适合 Workbench 展示的中文学习摘要、章节和知识点。',
          '章节时间必须来自输入字幕的 start/end 附近，不要凭空编造超出范围的时间。',
          '知识点应是可复习的概念、方法、公式、步骤或易错点。'
        ].join('\n'),
        schema: {
          summary: 'string',
          chapters: [{ title: 'string', start: 'number seconds', end: 'number seconds', summary: 'string', keyPoints: ['string'] }],
          keyPoints: [{ concept: 'string', explanation: 'string', timestamps: ['number seconds'] }]
        },
        input: { title, transcript: sampled },
        timeoutMs: 90000
      });

      return {
        summary: String(response.data.summary || '').trim(),
        chapters: this.normalizeChapters(response.data.chapters || [], transcript),
        keyPoints: this.normalizeKeyPoints(response.data.keyPoints || []),
        tool: response.model,
        warnings
      };
    } catch (error) {
      warnings.push(`LLM analysis failed: ${error instanceof Error ? error.message : String(error)}. Used a local heuristic summary.`);
      return this.heuristicTranscriptAnalysis(transcript, warnings);
    }
  }

  private heuristicTranscriptAnalysis(transcript: TranscriptSegment[], warnings: string[] = []) {
    const chunks: TranscriptSegment[][] = [];
    const chunkSize = Math.max(12, Math.ceil(transcript.length / 5));
    for (let index = 0; index < transcript.length; index += chunkSize) {
      chunks.push(transcript.slice(index, index + chunkSize));
    }
    const chapters = chunks.map((chunk, index) => ({
      id: `c${index + 1}`,
      title: `Part ${index + 1}: ${secondsToClock(chunk[0]?.start || 0)}`,
      start: chunk[0]?.start || 0,
      end: chunk[chunk.length - 1]?.end,
      summary: chunk.map((segment) => segment.text).join(' ').slice(0, 220),
      keyPoints: []
    }));
    return {
      summary: transcript.map((segment) => segment.text).join(' ').slice(0, 600),
      chapters,
      keyPoints: [] as VideoKeyPoint[],
      tool: 'local-heuristic',
      warnings
    };
  }

  private normalizeChapters(raw: Array<{ title?: string; start?: number; end?: number; summary?: string; keyPoints?: string[] }>, transcript: TranscriptSegment[]) {
    const minStart = transcript[0]?.start || 0;
    const maxEnd = transcript[transcript.length - 1]?.end || minStart;
    return raw
      .filter((item) => item?.title || item?.summary)
      .slice(0, 12)
      .map((item, index) => ({
        id: `c${index + 1}`,
        title: String(item.title || `Chapter ${index + 1}`).trim(),
        start: Math.min(Math.max(safeNumber(item.start, minStart), minStart), maxEnd),
        end: item.end == null ? undefined : Math.min(Math.max(safeNumber(item.end, maxEnd), minStart), maxEnd),
        summary: String(item.summary || '').trim(),
        keyPoints: Array.isArray(item.keyPoints) ? item.keyPoints.map(String).filter(Boolean).slice(0, 8) : []
      }));
  }

  private normalizeKeyPoints(raw: Array<{ concept?: string; explanation?: string; timestamps?: number[] }>) {
    return raw
      .filter((item) => item?.concept || item?.explanation)
      .slice(0, 24)
      .map((item, index) => ({
        id: `k${index + 1}`,
        concept: String(item.concept || `Key point ${index + 1}`).trim(),
        explanation: String(item.explanation || '').trim(),
        timestamps: Array.isArray(item.timestamps) ? item.timestamps.map((value) => safeNumber(value)).filter((value) => value >= 0).slice(0, 6) : []
      }));
  }

  private withChapterEvidence(chapters: VideoChapter[], transcript: TranscriptSegment[], tool: string): VideoChapter[] {
    return chapters.map((chapter) => {
      const sourceRange = { start: chapter.start, end: chapter.end ?? chapter.start + 120 };
      const evidenceSegments = buildEvidenceSegments(transcript, { range: sourceRange, limit: 3 });
      return {
        ...chapter,
        evidenceSegments,
        confidence: confidenceFromEvidence(evidenceSegments, tool),
        sourceRange
      };
    });
  }

  private withKeyPointEvidence(keyPoints: VideoKeyPoint[], transcript: TranscriptSegment[], tool: string): VideoKeyPoint[] {
    return keyPoints.map((point) => {
      const firstTimestamp = point.timestamps[0];
      const sourceRange = point.timestamps.length
        ? { start: Math.min(...point.timestamps), end: Math.max(...point.timestamps) + 45 }
        : firstTimestamp == null
          ? undefined
          : { start: firstTimestamp, end: firstTimestamp + 45 };
      const evidenceSegments = buildEvidenceSegments(transcript, {
        timestamps: point.timestamps,
        range: sourceRange,
        limit: 3
      });
      return {
        ...point,
        evidenceSegments,
        confidence: confidenceFromEvidence(evidenceSegments, tool),
        sourceRange
      };
    });
  }

  private applyManualEdits(generated: VideoAnalysis, previous: VideoAnalysis): VideoAnalysis {
    const previousManualChapters = previous.chapters.filter((chapter) => chapter.manuallyEdited);
    const previousManualKeyPoints = previous.keyPoints.filter((point) => point.manuallyEdited);
    return createEmptyAnalysis({
      ...generated,
      summary: previous.summaryManuallyEdited ? previous.summary : generated.summary,
      summaryEvidenceSegments: previous.summaryManuallyEdited ? previous.summaryEvidenceSegments : generated.summaryEvidenceSegments,
      summaryConfidence: previous.summaryManuallyEdited ? confidenceFromEvidence(previous.summaryEvidenceSegments || [], generated.tools.llm || '', true) : generated.summaryConfidence,
      summarySourceRange: previous.summaryManuallyEdited ? previous.summarySourceRange : generated.summarySourceRange,
      summaryManuallyEdited: previous.summaryManuallyEdited,
      manualRevision: previous.manualRevision
        ? { ...previous.manualRevision, preservedFromRunId: previous.runId }
        : generated.manualRevision,
      chapters: previousManualChapters.length ? previousManualChapters : generated.chapters,
      keyPoints: previousManualKeyPoints.length ? previousManualKeyPoints : generated.keyPoints,
      warnings: previous.manualRevision
        ? [...generated.warnings, `Preserved manual edits from revision ${previous.manualRevision.revision}.`]
        : generated.warnings
    });
  }

  private enrichSlides(analysis: VideoAnalysis): VideoAnalysis {
    if (!analysis.slides.length) return analysis;
    const slides: SlideFrame[] = [];
    const clusterBySignature = new Map<string, string>();

    for (const slide of analysis.slides) {
      const title = slide.title && !/^Slide \d+$/i.test(slide.title) ? slide.title : titleFromOcrText(slide.ocrText) || slide.title;
      const signature = stableHash(compactWhitespace(`${title || ''}\n${slide.ocrText || ''}`).toLowerCase()).slice(0, 16);
      const duplicate = slides.find((existing) => {
        if (slide.signature && existing.signature && slide.signature === existing.signature) return true;
        if (slide.ocrText && existing.ocrText && textSimilarity(slide.ocrText, existing.ocrText) >= VIDEO_SLIDE_DUPLICATE_TEXT_THRESHOLD) return true;
        return false;
      });
      const chapter = this.chapterForTimestamp(analysis.chapters, slide.timestamp);
      const nearbyTranscript = analysis.transcript.filter(
        (segment) =>
          segment.end >= slide.timestamp - 5 &&
          segment.start <= slide.timestamp + VIDEO_SLIDE_ALIGN_WINDOW_SECONDS
      );
      const clusterId = duplicate?.clusterId || clusterBySignature.get(signature) || `slide-cluster-${slides.length + 1}`;
      clusterBySignature.set(signature, clusterId);
      slides.push({
        ...slide,
        title,
        signature,
        clusterId,
        duplicateOf: duplicate?.id,
        chapterId: chapter?.id,
        transcriptSegmentIds: nearbyTranscript.slice(0, 6).map((segment) => segment.id)
      });
    }

    return createEmptyAnalysis({ ...analysis, slides });
  }

  private chapterForTimestamp(chapters: VideoChapter[], timestamp: number) {
    return chapters.find((chapter, index) => {
      const next = chapters[index + 1];
      const end = chapter.end ?? next?.start ?? Number.POSITIVE_INFINITY;
      return timestamp >= chapter.start && timestamp < end;
    });
  }

  private async tryExtractSlides(
    workspaceId: string,
    file: any,
    filePath: string,
    warnings: string[],
    tools: VideoAnalysis['tools']
  ): Promise<SlideFrame[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-video-frames-'));
    try {
      const candidates = await this.extractSlideCandidateFrames(['-i', filePath]);
      const timestamps = this.selectSmartSlideTimestamps(candidates);
      const slides = await this.persistSmartSlides(workspaceId, file, tmpDir, timestamps, (timestamp) => [
        '-ss',
        String(timestamp),
        '-i',
        filePath
      ]);
      tools.frames = slides.length ? 'ffmpeg:smart-diff' : 'ffmpeg:smart-diff:unavailable';
      return slides;
    } catch (error) {
      warnings.push(`Slide frame extraction unavailable: ${error instanceof Error ? error.message : String(error)}`);
      tools.frames = 'ffmpeg:unavailable';
      return [];
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async tryExtractSlidesFromRemoteUrl(
    workspaceId: string,
    file: any,
    sourceUrl: string,
    warnings: string[],
    tools: VideoAnalysis['tools']
  ): Promise<SlideFrame[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-video-url-frames-'));
    try {
      const stream = await this.resolveRemoteVideoStream(sourceUrl);
      const headerText = formatFfmpegHeaders(stream.headers);

      const remoteInputArgs = (timestamp?: number) => [
        ...(timestamp == null ? [] : ['-ss', String(timestamp)]),
        ...(headerText ? ['-headers', `${headerText}\r\n`] : []),
        ...(stream.headers['User-Agent'] ? ['-user_agent', stream.headers['User-Agent']] : []),
        '-i',
        stream.url
      ];
      const scanWindow = stream.duration || VIDEO_REMOTE_FRAME_WINDOW_SECONDS;
      const candidates = await this.extractSlideCandidateFrames(remoteInputArgs(), scanWindow);
      const timestamps = this
        .selectSmartSlideTimestamps(candidates)
        .filter((timestamp) => !stream.duration || timestamp <= Math.max(0, stream.duration - SLIDE_END_PADDING_SECONDS));
      const frames = await this.persistSmartSlides(workspaceId, file, tmpDir, timestamps, remoteInputArgs, warnings);

      tools.download = `yt-dlp:stream-url${stream.formatId ? `:${stream.formatId}` : ''}`;
      tools.frames = frames.length ? 'ffmpeg:remote-smart-diff' : 'ffmpeg:remote-smart-diff:unavailable';
      return frames;
    } catch (error) {
      warnings.push(`Remote URL frame extraction unavailable: ${error instanceof Error ? error.message : String(error)}`);
      tools.download = 'yt-dlp:stream-url:unavailable';
      return [];
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async extractSlideCandidateFrames(inputArgs: string[], duration?: number): Promise<SlideCandidateFrame[]> {
    const frameSize = SLIDE_SIGNATURE_WIDTH * SLIDE_SIGNATURE_HEIGHT;
    const sampleCount = Math.max(
      1,
      Math.min(
        SLIDE_MAX_SAMPLES,
        Math.ceil(safeNumber(duration, SLIDE_MAX_SAMPLES * SLIDE_SAMPLE_INTERVAL_SECONDS) / SLIDE_SAMPLE_INTERVAL_SECONDS) + 1
      )
    );
    const { stdout } = await execFileBufferAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs,
      '-vf',
      `fps=1/${SLIDE_SAMPLE_INTERVAL_SECONDS},scale=${SLIDE_SIGNATURE_WIDTH}:${SLIDE_SIGNATURE_HEIGHT}:force_original_aspect_ratio=decrease,pad=${SLIDE_SIGNATURE_WIDTH}:${SLIDE_SIGNATURE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=gray`,
      '-frames:v',
      String(sampleCount),
      '-f',
      'rawvideo',
      'pipe:1'
    ], {
      timeout: Number(process.env.VIDEO_SLIDE_SCAN_TIMEOUT_MS || 300000),
      maxBuffer: Math.max(32 * 1024 * 1024, frameSize * sampleCount * 2)
    });

    const frames: SlideCandidateFrame[] = [];
    for (let offset = 0; offset + frameSize <= stdout.length; offset += frameSize) {
      frames.push({
        timestamp: frames.length * SLIDE_SAMPLE_INTERVAL_SECONDS,
        pixels: stdout.subarray(offset, offset + frameSize)
      });
    }
    return frames;
  }

  private selectSmartSlideTimestamps(candidates: SlideCandidateFrame[]) {
    if (candidates.length <= MAX_SLIDES) return candidates.map((frame) => frame.timestamp);

    const selected: SlideCandidateFrame[] = [];
    const addCandidate = (candidate: SlideCandidateFrame) => {
      if (meanFrameLuma(candidate.pixels) < 8 && candidates.length > 1) return;
      const previous = selected[selected.length - 1];
      if (!previous) {
        selected.push(candidate);
        return;
      }
      if (candidate.timestamp - previous.timestamp < SLIDE_MIN_GAP_SECONDS) {
        selected[selected.length - 1] = candidate;
        return;
      }
      selected.push(candidate);
    };

    for (let index = 1; index < candidates.length; index += 1) {
      const diff = meanAbsoluteFrameDiff(candidates[index - 1].pixels, candidates[index].pixels);
      if (diff >= SLIDE_CHANGE_THRESHOLD) {
        addCandidate(candidates[index - 1]);
      }
    }
    addCandidate(candidates[candidates.length - 1]);

    const unique = selected.filter((frame, index, list) => index === 0 || frame.timestamp !== list[index - 1].timestamp);
    if (unique.length <= MAX_SLIDES) return unique.map((frame) => frame.timestamp);

    const stride = Math.ceil(unique.length / MAX_SLIDES);
    return unique.filter((_frame, index) => index % stride === 0).slice(0, MAX_SLIDES).map((frame) => frame.timestamp);
  }

  private async persistSmartSlides(
    workspaceId: string,
    file: any,
    tmpDir: string,
    timestamps: number[],
    inputArgsForTimestamp: (timestamp: number) => string[],
    warnings: string[] = []
  ) {
    const slides: SlideFrame[] = [];
    for (const timestamp of timestamps.slice(0, MAX_SLIDES)) {
      const framePath = path.join(tmpDir, `slide_${String(slides.length + 1).padStart(3, '0')}.jpg`);
      try {
        await execFileAsync('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          ...inputArgsForTimestamp(timestamp),
          '-frames:v',
          '1',
          '-vf',
          'scale=720:-1',
          '-y',
          framePath
        ], { timeout: Number(process.env.VIDEO_REMOTE_FRAME_TIMEOUT_MS || 45000) });
        const ocrText = await this.ocrSlideImage(framePath, warnings);
        const image = await fs.readFile(framePath);
        const imageFile = await this.createSlideImageFile(workspaceId, file, image, slides.length + 1);
        slides.push({
          id: `s${slides.length + 1}`,
          timestamp,
          imageFileId: imageFile.id,
          title: titleFromOcrText(ocrText) || `Slide ${slides.length + 1}`,
          ocrText
        });
      } catch (error) {
        warnings.push(`Slide ${secondsToClock(timestamp)} unavailable: ${compactToolError(error)}`);
      }
    }
    return slides;
  }

  private async resolveRemoteVideoStream(sourceUrl: string): Promise<RemoteVideoStream> {
    const { stdout } = await execFileAsync(
      pythonCommand,
      [
        ...ytDlpBaseArgs,
        ...ytDlpCookieArgs(),
        '--ignore-no-formats-error',
        '--no-playlist',
        '-f',
        VIDEO_REMOTE_FRAME_FORMAT,
        '-J',
        '--skip-download',
        normalizeVideoUrl(sourceUrl) || sourceUrl
      ],
      { timeout: Number(process.env.VIDEO_REMOTE_STREAM_URL_TIMEOUT_MS || 120000) }
    );
    const metadata = JSON.parse(stdout);
    const formats = Array.isArray(metadata?.formats) ? metadata.formats : [];
    const candidates = formats
      .filter((format: any) => {
        const height = safeNumber(format?.height, 0);
        return format?.url && format?.vcodec && format.vcodec !== 'none' && height > 0 && height <= 360;
      })
      .sort((left: any, right: any) => {
        const score = (format: any) => {
          let value = safeNumber(format?.height, 0);
          if (String(format?.format_id) === '18') value += 1000;
          if (String(format?.ext) === 'mp4') value += 100;
          if (String(format?.protocol || '').startsWith('http')) value += 50;
          if (format?.acodec && format.acodec !== 'none') value += 25;
          return value;
        };
        return score(right) - score(left);
      });
    const selected = candidates[0];
    if (!selected) throw new Error('yt-dlp did not expose a <=360p playable video format');
    return {
      url: String(selected.url),
      headers: selected.http_headers && typeof selected.http_headers === 'object' ? selected.http_headers : {},
      formatId: selected.format_id ? String(selected.format_id) : undefined,
      duration: safeNumber(metadata?.duration, undefined as any)
    };
  }

  private async createSlideImageFile(workspaceId: string, sourceFile: any, image: Buffer, index: number) {
    const storage = await LocalStorageService.saveBuffer(image);
    const baseName = `${sanitizeFilename(sourceFile.name)} frame ${String(index).padStart(2, '0')}.jpg`;
    const parentPath = `${sourceFile.path.replace(/\/[^/]+$/, '')}/Video Frames`;
    const pathValue = generateNewPath(parentPath, `${crypto.randomBytes(3).toString('hex')}-${baseName}`);
    return prisma.fileSystemObject.create({
      data: {
        name: baseName,
        nodeType: 'file',
        fileCategory: 'media',
        resourceType: 'generated',
        scope: sourceFile.scope || 'workspace',
        origin: 'system',
        metadataJson: serializeMetadata({ generatedFromVideoId: sourceFile.id, frameIndex: index }),
        tags: JSON.stringify(['video-frame']),
        extension: getExtension(baseName),
        path: pathValue,
        mimeType: 'image/jpeg',
        storageKey: storage.storageKey,
        size: storage.size,
        isBinary: true,
        workspaceId,
        ownerWorkbenchId: sourceFile.ownerWorkbenchId || undefined
      } as any
    });
  }

  private async ocrSlideImage(framePath: string, warnings: string[]) {
    try {
      const { stdout } = await execFileAsync('tesseract', [
        framePath,
        'stdout',
        '-l',
        VIDEO_OCR_LANG,
        '--psm',
        '6'
      ], { timeout: VIDEO_OCR_TIMEOUT_MS });
      return stdout
        .replace(/\f/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim();
    } catch (error) {
      warnings.push(`Slide OCR unavailable for ${path.basename(framePath)}: ${compactToolError(error)}`);
      return '';
    }
  }

  private async ocrSlideBuffer(image: Buffer, warnings: string[]) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-video-ocr-'));
    const framePath = path.join(tmpDir, 'frame.png');
    try {
      await fs.writeFile(framePath, image);
      return await this.ocrSlideImage(framePath, warnings);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private buildVideoKnowledgeChunks(workspaceId: string, fileObjectId: string, analysis: VideoAnalysis): DocumentChunkInput[] {
    const chunks: DocumentChunkInput[] = [];
    const push = (chunk: Omit<DocumentChunkInput, 'workspaceId' | 'fileObjectId' | 'fileId' | 'chunkIndex'>) => {
      chunks.push({
        workspaceId,
        fileObjectId,
        fileId: fileObjectId,
        chunkIndex: chunks.length,
        ...chunk
      });
    };

    if (analysis.summary) {
      push({
        text: [
          `Video summary: ${analysis.title || 'Untitled video'}`,
          analysis.summary,
          analysis.summaryEvidenceSegments?.length
            ? `Evidence timestamps: ${analysis.summaryEvidenceSegments.map((segment) => secondsToClock(segment.start)).join(', ')}`
            : ''
        ].filter(Boolean).join('\n\n'),
        summary: analysis.summary.slice(0, 240),
        chunkType: 'summary',
        source: 'video-analysis',
        purpose: 'video_summary_grounding',
        headingPath: ['Video intelligence', 'Summary'],
        locator: {
          headingPath: ['Video intelligence', 'Summary'],
          timestampStart: analysis.summarySourceRange?.start,
          timestampEnd: analysis.summarySourceRange?.end
        },
        metadata: {
          sourceKind: 'video_summary',
          confidence: analysis.summaryConfidence,
          evidenceSegments: analysis.summaryEvidenceSegments || []
        }
      });
    }

    for (const chapter of analysis.chapters) {
      const relatedSlides = analysis.slides.filter((slide) => slide.chapterId === chapter.id && !slide.duplicateOf);
      push({
        text: [
          `Video chapter: ${chapter.title}`,
          `Time range: ${secondsToClock(chapter.start)} - ${secondsToClock(chapter.end ?? chapter.sourceRange?.end ?? chapter.start)}`,
          chapter.summary,
          chapter.keyPoints.length ? `Key points:\n${chapter.keyPoints.map((point) => `- ${point}`).join('\n')}` : '',
          relatedSlides.length ? `Related slides:\n${relatedSlides.map((slide) => `- ${secondsToClock(slide.timestamp)} ${slide.title || ''}`.trim()).join('\n')}` : '',
          chapter.evidenceSegments?.length
            ? `Transcript evidence:\n${chapter.evidenceSegments.map((segment) => `[${secondsToClock(segment.start)}] ${segment.text}`).join('\n')}`
            : ''
        ].filter(Boolean).join('\n\n'),
        summary: chapter.summary || chapter.title,
        chunkType: 'video_chapter',
        source: 'video-analysis',
        purpose: 'video_chapter_grounding',
        headingPath: ['Video intelligence', 'Chapters', chapter.title],
        locator: {
          headingPath: ['Video intelligence', 'Chapters', chapter.title],
          timestampStart: chapter.start,
          timestampEnd: chapter.end ?? chapter.sourceRange?.end
        },
        metadata: {
          sourceKind: 'video_chapter',
          chapterId: chapter.id,
          confidence: chapter.confidence,
          manuallyEdited: chapter.manuallyEdited,
          evidenceSegments: chapter.evidenceSegments || [],
          relatedSlideIds: relatedSlides.map((slide) => slide.id)
        }
      });
    }

    for (const point of analysis.keyPoints) {
      const start = point.sourceRange?.start ?? point.timestamps[0];
      const end = point.sourceRange?.end ?? point.timestamps[point.timestamps.length - 1];
      push({
        text: [
          `Video key point: ${point.concept}`,
          point.explanation,
          point.timestamps.length ? `Timestamps: ${point.timestamps.map(secondsToClock).join(', ')}` : '',
          point.evidenceSegments?.length
            ? `Transcript evidence:\n${point.evidenceSegments.map((segment) => `[${secondsToClock(segment.start)}] ${segment.text}`).join('\n')}`
            : ''
        ].filter(Boolean).join('\n\n'),
        summary: point.concept,
        chunkType: 'video_key_point',
        source: 'video-analysis',
        purpose: 'video_key_point_grounding',
        headingPath: ['Video intelligence', 'Key points', point.concept],
        locator: {
          headingPath: ['Video intelligence', 'Key points', point.concept],
          timestampStart: start,
          timestampEnd: end
        },
        metadata: {
          sourceKind: 'video_key_point',
          keyPointId: point.id,
          confidence: point.confidence,
          manuallyEdited: point.manuallyEdited,
          evidenceSegments: point.evidenceSegments || []
        }
      });
    }

    for (const segment of analysis.transcript) {
      push({
        text: `[${secondsToClock(segment.start)} - ${secondsToClock(segment.end)}] ${segment.text}`,
        summary: segment.text.slice(0, 180),
        chunkType: 'video_transcript',
        source: 'video-analysis',
        purpose: 'video_transcript_grounding',
        headingPath: ['Video intelligence', 'Transcript'],
        locator: {
          headingPath: ['Video intelligence', 'Transcript'],
          timestampStart: segment.start,
          timestampEnd: segment.end
        },
        metadata: {
          sourceKind: 'video_transcript',
          transcriptSegmentId: segment.id,
          transcriptSource: segment.source
        }
      });
    }

    for (const slide of analysis.slides.filter((item) => !item.duplicateOf)) {
      const chapter = slide.chapterId ? analysis.chapters.find((item) => item.id === slide.chapterId) : undefined;
      const transcript = (slide.transcriptSegmentIds || [])
        .map((segmentId) => analysis.transcript.find((segment) => segment.id === segmentId))
        .filter((segment): segment is TranscriptSegment => Boolean(segment));
      push({
        text: [
          `Video slide: ${slide.title || `Slide at ${secondsToClock(slide.timestamp)}`}`,
          `Timestamp: ${secondsToClock(slide.timestamp)}`,
          chapter ? `Chapter: ${chapter.title}` : '',
          slide.ocrText ? `Slide OCR:\n${slide.ocrText}` : '',
          transcript.length ? `Nearby transcript:\n${transcript.map((segment) => `[${secondsToClock(segment.start)}] ${segment.text}`).join('\n')}` : ''
        ].filter(Boolean).join('\n\n'),
        summary: slide.title || titleFromOcrText(slide.ocrText) || `Slide at ${secondsToClock(slide.timestamp)}`,
        chunkType: 'video_slide',
        source: 'video-analysis',
        purpose: 'video_slide_grounding',
        headingPath: ['Video intelligence', 'Slides', slide.title || secondsToClock(slide.timestamp)],
        locator: {
          headingPath: ['Video intelligence', 'Slides', slide.title || secondsToClock(slide.timestamp)],
          timestampStart: slide.timestamp,
          timestampEnd: transcript[transcript.length - 1]?.end ?? slide.timestamp
        },
        metadata: {
          sourceKind: 'video_slide',
          slideId: slide.id,
          imageFileId: slide.imageFileId,
          chapterId: slide.chapterId,
          clusterId: slide.clusterId,
          signature: slide.signature,
          transcriptSegmentIds: slide.transcriptSegmentIds || []
        }
      });
    }

    return chunks;
  }

  private async indexVideoAnalysis(workspaceId: string, fileObjectId: string, analysis: VideoAnalysis, reason: string) {
    const sourceHash = stableHash({
      runId: analysis.runId,
      generatedAt: analysis.generatedAt,
      manualRevision: analysis.manualRevision,
      transcriptCount: analysis.transcript.length,
      chapterCount: analysis.chapters.length,
      keyPointCount: analysis.keyPoints.length,
      slideCount: analysis.slides.length
    });
    const chunks = this.buildVideoKnowledgeChunks(workspaceId, fileObjectId, analysis).map((chunk) => ({
      ...chunk,
      metadata: {
        ...(chunk.metadata || {}),
        videoAnalysisSourceHash: sourceHash
      }
    }));
    const indexed = await documentChunkStore.replaceFileChunks({
      workspaceId,
      fileObjectId,
      chunks
    });

    let vectorIndexed = false;
    let vectorError: string | undefined;
    if (indexed.length > 0) {
      try {
        await vectorStoreService.replaceFileChunks({ workspaceId, fileObjectId, chunks: indexed });
        vectorIndexed = true;
      } catch (error) {
        vectorError = error instanceof Error ? error.message : String(error);
        console.warn(`Video vector indexing skipped for ${fileObjectId}: ${vectorError}`);
      }
    }

    await prisma.knowledgeIndexJob.create({
      data: {
        workspaceId,
        fileObjectId,
        status: vectorError ? 'degraded' : 'completed',
        extractor: 'video-analysis',
        chunkCount: indexed.length,
        startedAt: new Date(),
        completedAt: new Date(),
        errorMessage: JSON.stringify({
          stage: vectorError ? 'degraded' : 'indexed',
          reason,
          sourceHash,
          extractor: 'video-analysis',
          chunkCount: indexed.length,
          vectorIndexed,
          vectorError,
          completedStages: ['extracting', 'chunking', vectorError ? 'degraded' : 'indexed'],
          timings: {}
        })
      }
    });

    return indexed;
  }

  private resolveSourceUrl(file: any, metadata: Record<string, any>) {
    const metadataUrl = typeof metadata.sourceUrl === 'string' ? metadata.sourceUrl.trim() : '';
    return metadataUrl || extractUrlFromMarkdown(file.content);
  }

  private async updateAnalysis(fileObjectId: string, metadata: Record<string, any>, analysis: VideoAnalysis) {
    await prisma.fileSystemObject.update({
      where: { id: fileObjectId },
      data: {
        metadataJson: serializeMetadata({
          ...metadata,
          videoAnalysis: analysis
        })
      } as any
    });
  }

  private async updateAnalysisIfCurrentRun(workspaceId: string, fileObjectId: string, analysis: VideoAnalysis) {
    const currentFile = await this.getFile(workspaceId, fileObjectId);
    const currentMetadata = parseJsonObject(currentFile.metadataJson);
    const currentAnalysis = createEmptyAnalysis(currentMetadata.videoAnalysis as Partial<VideoAnalysis> | undefined);
    if (analysis.runId && currentAnalysis.runId && analysis.runId !== currentAnalysis.runId) return;
    await this.updateAnalysis(fileObjectId, currentMetadata, analysis);
  }

  private async getFile(workspaceId: string, fileObjectId: string) {
    const file = await prisma.fileSystemObject.findFirst({ where: { id: fileObjectId, workspaceId } });
    if (!file) throw new FileSystemError(404, 'File not found');
    if (file.nodeType !== 'file') throw new FileSystemError(400, 'Video analysis requires a file resource');
    return file as any;
  }
}

export const videoAnalysisService = new VideoAnalysisService();
