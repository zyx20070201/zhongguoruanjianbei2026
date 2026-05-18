export type VideoAnalysisStatus = 'idle' | 'queued' | 'processing' | 'ready' | 'degraded' | 'failed' | 'cancelled';

export type VideoAnalysisStage =
  | 'idle'
  | 'queued'
  | 'fetching_metadata'
  | 'extracting_captions'
  | 'transcript_ready'
  | 'analyzing_transcript'
  | 'extracting_slides'
  | 'running_ocr'
  | 'aligning_slides'
  | 'indexing_context'
  | 'completed'
  | 'degraded'
  | 'failed'
  | 'cancelled';

export type VideoAnalysisErrorClass =
  | 'network_timeout'
  | 'youtube_blocked'
  | 'caption_unavailable'
  | 'cookie_required'
  | 'ffmpeg_failed'
  | 'ocr_unavailable'
  | 'llm_timeout'
  | 'vector_index_failed'
  | 'job_interrupted'
  | 'cancelled'
  | 'unknown';

export interface VideoAnalysisStageRecord {
  stage: VideoAnalysisStage;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  label?: string;
  message?: string;
  tool?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  outputCount?: number;
  costEstimate?: number;
  warning?: string;
  error?: string;
  errorClass?: VideoAnalysisErrorClass;
}

export interface VideoAnalysisProgress {
  stage: VideoAnalysisStage;
  percent: number;
  message?: string;
  heartbeatAt?: string;
  jobId?: string;
  queuePosition?: number;
  attempt?: number;
  canCancel?: boolean;
  canRetry?: boolean;
  stages: VideoAnalysisStageRecord[];
  timings?: Record<string, number>;
  costEstimate?: number;
  errorClass?: VideoAnalysisErrorClass;
}

export type VideoProvider = 'youtube' | 'bilibili' | 'upload' | 'web' | 'unknown';

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  source: 'platform_caption' | 'asr' | 'manual' | 'unknown';
}

export type VideoAnalysisConfidence = 'high' | 'medium' | 'low';

export interface VideoSourceRange {
  start: number;
  end: number;
}

export interface VideoEvidenceSegment {
  segmentId: string;
  start: number;
  end: number;
  text: string;
  source: TranscriptSegment['source'];
}

export interface VideoManualRevision {
  revision: number;
  updatedAt: string;
  preservedFromRunId?: string;
}

export type VideoReviewStatus = 'draft' | 'in_review' | 'reviewed' | 'approved';

export interface VideoAnalysisReview {
  status: VideoReviewStatus;
  locked?: boolean;
  updatedAt?: string;
}

export interface VideoAnalysisOriginalSnapshot {
  summary: string;
  chapters: VideoChapter[];
  keyPoints: VideoKeyPoint[];
  generatedAt?: string;
  runId?: string;
}

export interface VideoChapter {
  id: string;
  title: string;
  start: number;
  end?: number;
  summary: string;
  keyPoints: string[];
  evidenceSegments?: VideoEvidenceSegment[];
  confidence?: VideoAnalysisConfidence;
  sourceRange?: VideoSourceRange;
  manuallyEdited?: boolean;
}

export interface VideoKeyPoint {
  id: string;
  concept: string;
  explanation: string;
  timestamps: number[];
  evidenceSegments?: VideoEvidenceSegment[];
  confidence?: VideoAnalysisConfidence;
  sourceRange?: VideoSourceRange;
  manuallyEdited?: boolean;
}

export interface SlideFrame {
  id: string;
  timestamp: number;
  imageFileId?: string;
  imageUrl?: string;
  ocrText?: string;
  title?: string;
  transcriptSegmentIds?: string[];
  chapterId?: string;
  duplicateOf?: string;
  clusterId?: string;
  signature?: string;
}

export interface VideoAnalysis {
  version: 1;
  status: VideoAnalysisStatus;
  provider: VideoProvider;
  sourceUrl?: string;
  duration?: number;
  title?: string;
  summary: string;
  summaryEvidenceSegments?: VideoEvidenceSegment[];
  summaryConfidence?: VideoAnalysisConfidence;
  summarySourceRange?: VideoSourceRange;
  summaryManuallyEdited?: boolean;
  manualRevision?: VideoManualRevision;
  review?: VideoAnalysisReview;
  original?: VideoAnalysisOriginalSnapshot;
  transcript: TranscriptSegment[];
  chapters: VideoChapter[];
  keyPoints: VideoKeyPoint[];
  slides: SlideFrame[];
  generatedAt?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  runId?: string;
  error?: string;
  errorClass?: VideoAnalysisErrorClass;
  progress?: VideoAnalysisProgress;
  warnings: string[];
  tools: {
    remote?: string;
    captions?: string;
    download?: string;
    asr?: string;
    frames?: string;
    llm?: string;
  };
}
