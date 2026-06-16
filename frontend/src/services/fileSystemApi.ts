import client from '../api/client';
import { FileSystemObject } from '../types';

const RESOURCE_REQUEST_TIMEOUT_MS = 60000;

const apiUrl = (path: string): string => {
  const baseURL = String(client.defaults.baseURL || '/api').replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(`${baseURL}${normalizedPath}`, window.location.origin).toString();
};

export interface FilePreviewInfo {
  status: 'ready' | 'unavailable' | 'unsupported';
  previewKind: 'pdf' | 'document' | 'binary' | 'unknown';
  previewUrl?: string;
  sourceUrl?: string;
  message?: string;
}

export interface RenderableDocumentPage {
  fileId?: string;
  page: number;
  text: string;
  charStart?: number;
  charEnd?: number;
}

export interface RenderableDocumentChunk {
  fileId?: string;
  chunkIndex: number;
  chunkType?: 'parent' | 'text' | 'table' | 'list' | 'code' | 'summary' | 'video_transcript' | 'video_chapter' | 'video_key_point' | 'video_slide';
  text: string;
  html?: string;
  headingPath?: string[];
  paragraphIndex?: number;
  blockId?: string;
  blockIndex?: number;
  slideIndex?: number;
  shapeIndex?: number;
  tableIndex?: number;
  rowIndex?: number;
  columnIndex?: number;
  page?: number;
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
}

export interface RenderableDocument {
  kind: 'pdf' | 'docx' | 'pptx' | 'markdown' | 'code' | 'text';
  fileId?: string;
  fileName?: string;
  pageCount?: number;
  pages?: RenderableDocumentPage[];
  chunks?: RenderableDocumentChunk[];
  extractor: string;
  fallbackReason?: string;
}

export interface DiscoveredResource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  summary?: string;
  score?: number;
  source?: string;
  provider: 'exa' | 'tavily';
  publishedAt?: string;
  author?: string;
  contentPreview?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

export interface SourceDiscoveryResult {
  provider: 'exa' | 'tavily';
  query: string;
  results: DiscoveredResource[];
}

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

export type VideoReviewStatus = 'draft' | 'in_review' | 'reviewed' | 'approved';

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
  status: 'idle' | 'queued' | 'processing' | 'ready' | 'degraded' | 'failed' | 'cancelled';
  provider: 'youtube' | 'bilibili' | 'upload' | 'web' | 'unknown';
  sourceUrl?: string;
  duration?: number;
  title?: string;
  summary: string;
  summaryEvidenceSegments?: VideoEvidenceSegment[];
  summaryConfidence?: VideoAnalysisConfidence;
  summarySourceRange?: VideoSourceRange;
  summaryManuallyEdited?: boolean;
  manualRevision?: {
    revision: number;
    updatedAt: string;
    preservedFromRunId?: string;
  };
  review?: {
    status: VideoReviewStatus;
    locked?: boolean;
    updatedAt?: string;
  };
  original?: {
    summary: string;
    chapters: VideoChapter[];
    keyPoints: VideoKeyPoint[];
    generatedAt?: string;
    runId?: string;
  };
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
  errorClass?: string;
  progress?: {
    stage: string;
    percent: number;
    message?: string;
    heartbeatAt?: string;
    jobId?: string;
    queuePosition?: number;
    attempt?: number;
    canCancel?: boolean;
    canRetry?: boolean;
    costEstimate?: number;
    errorClass?: string;
    timings?: Record<string, number>;
    stages: Array<{
      stage: string;
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
      errorClass?: string;
    }>;
  };
  warnings: string[];
  tools: Record<string, string | undefined>;
}

export interface ResourceIntelligenceSection {
  id: string;
  title: string;
  summary: string;
  level?: number;
  parentId?: string;
  rangeLabel: string;
  locator: Record<string, any>;
  evidence?: string;
  evidenceSnippets?: Array<{
    id: string;
    text: string;
    page?: number;
    lineStart?: number;
    lineEnd?: number;
    bbox?: { page?: number; left: number; top: number; width: number; height: number };
    confidence?: 'high' | 'medium' | 'low';
  }>;
  confidence?: 'high' | 'medium' | 'low';
  pageTypes?: string[];
}

export interface ResourceOutlineNode {
  id: string;
  title: string;
  level: number;
  pageStart?: number;
  pageEnd?: number;
  parentId?: string;
  children?: ResourceOutlineNode[];
  summary?: string;
  confidence?: 'high' | 'medium' | 'low';
  locator?: Record<string, any>;
  evidenceSnippets?: ResourceIntelligenceSection['evidenceSnippets'];
  pageTypes?: string[];
}

export interface ResourceTranscriptSegment {
  id: string;
  index: number;
  title?: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  locator: Record<string, any>;
  evidenceSnippets?: ResourceIntelligenceSection['evidenceSnippets'];
  confidence?: 'high' | 'medium' | 'low';
}

export interface ResourceElement {
  id: string;
  type: 'table' | 'figure' | 'formula' | 'code' | 'quote' | 'list';
  title?: string;
  text: string;
  page?: number;
  locator: Record<string, any>;
  confidence?: 'high' | 'medium' | 'low';
}

export interface ResourceIntelligence {
  status: 'idle' | 'processing' | 'ready' | 'degraded' | 'failed';
  kind: 'document' | 'web' | 'code' | 'text' | 'visualization' | 'resource';
  title?: string;
  overview: string;
  readingAdvice: string;
  sections: ResourceIntelligenceSection[];
  generatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  model?: string;
  error?: string;
  sourceHash?: string;
  progress?: {
    stage: string;
    percent: number;
    message?: string;
    heartbeatAt?: string;
    canRetry?: boolean;
    stages: Array<{
      stage: string;
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
      label?: string;
      message?: string;
      tool?: string;
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
      outputCount?: number;
      warning?: string;
      error?: string;
    }>;
  };
  warnings?: string[];
  tools?: Record<string, string | undefined>;
  quality?: {
    extraction: 'high' | 'medium' | 'low';
    structure: 'high' | 'medium' | 'low';
    grounding: 'high' | 'medium' | 'low';
    coverage: number;
    transcriptCoverage?: number;
    outlineDepth?: number;
    elementCount?: number;
    scannedPageCount?: number;
    pageCount?: number;
  };
  structure?: {
    extractor?: string;
    pageCount?: number;
    pageTypes?: Record<string, number>;
    pages?: Array<{
      page: number;
      pageType: string;
      titleCandidates: string[];
      dominantHeading?: string;
      textLength: number;
      semanticTextLength: number;
      lineCount: number;
      noiseLineCount: number;
      keywordSignature: string[];
      confidence: 'high' | 'medium' | 'low';
    }>;
    outline?: ResourceOutlineNode[];
  };
  transcript?: ResourceTranscriptSegment[];
  elements?: ResourceElement[];
  diagnostics?: {
    pageCount?: number;
    parsedPageCount: number;
    transcriptSegmentCount: number;
    outlineNodeCount: number;
    elementCount: number;
    scannedPageCount: number;
    lowConfidencePages: number[];
    warnings: string[];
  };
}

export interface ResourceCreateOptions {
  workbenchId?: string;
  resourceRole?: 'source' | 'note' | 'generated' | 'artifact' | 'resource' | 'file' | string;
  resourceType?: string;
  scope?: 'workspace' | 'workbench' | string;
  origin?: string;
  metadata?: Record<string, unknown>;
  relativePaths?: string[];
}

export interface WorkbenchNoteRevision {
  id: string;
  workspaceId: string;
  workbenchId?: string | null;
  fileObjectId: string;
  revisionNumber: number;
  actionType: string;
  actor: string;
  summary?: string | null;
  baseContentHash?: string | null;
  beforeContent: string;
  beforeContentHash: string;
  afterContent: string;
  afterContentHash: string;
  createdAt: string;
}

export interface WorkbenchNoteRevisionResult {
  file: FileSystemObject;
  revisionNumber: number;
  beforeContent: string;
  afterContent: string;
  baseContentHash?: string | null;
  currentContentHash: string;
  revertedFromRevisionNumber?: number;
}

export const fileSystemApi = {
  getTree: async (workspaceId: string): Promise<FileSystemObject[]> => {
    const response = await client.get(`/files/workspace/${workspaceId}/tree`);
    return response.data;
  },

  init: async (workspaceId: string): Promise<FileSystemObject[]> => {
    const response = await client.post(`/files/workspace/${workspaceId}/init`);
    return response.data;
  },

  getResources: async (
    workspaceId: string,
    params?: { workbenchId?: string; scope?: 'all' | 'workspace' | 'workbench' | string; role?: string }
  ): Promise<FileSystemObject[]> => {
    const response = await client.get(`/files/workspace/${workspaceId}/resources`, { params });
    return response.data;
  },

  createFolder: async (workspaceId: string, data: { name: string; parentId?: string | null; parentPath?: string } & ResourceCreateOptions): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/folder`, data);
    return response.data;
  },

  createFile: async (workspaceId: string, data: { name: string; content?: string; parentId?: string | null; parentPath?: string; fileCategory?: string; mimeType?: string; tags?: string[] } & ResourceCreateOptions): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/file`, data, { timeout: RESOURCE_REQUEST_TIMEOUT_MS });
    return response.data;
  },

  importUrl: async (
    workspaceId: string,
    data: { url: string; title?: string; parentId?: string | null; parentPath?: string } & ResourceCreateOptions
  ): Promise<{ file: FileSystemObject; source: { url: string; title: string } }> => {
    const response = await client.post(`/files/workspace/${workspaceId}/import-url`, data, { timeout: RESOURCE_REQUEST_TIMEOUT_MS });
    return response.data;
  },

  extractUrlPreview: async (
    workspaceId: string,
    data: { url: string; title?: string }
  ): Promise<{
    url: string;
    title: string;
    contentMarkdown: string;
    contentHtml?: string;
    excerpt?: string;
    siteName?: string;
    byline?: string;
    links?: Array<{ href: string; text: string; internal: boolean }>;
    images?: Array<{ src: string; alt?: string }>;
  }> => {
    const response = await client.post(`/files/workspace/${workspaceId}/extract-url-preview`, data, { timeout: RESOURCE_REQUEST_TIMEOUT_MS });
    return response.data;
  },

  discoverSources: async (
    workspaceId: string,
    data: { query: string; maxResults?: number; provider?: 'auto' | 'exa' | 'tavily' }
  ): Promise<SourceDiscoveryResult> => {
    const response = await client.post(`/files/workspace/${workspaceId}/discover-sources`, data, { timeout: RESOURCE_REQUEST_TIMEOUT_MS });
    return response.data;
  },

  discoverSourcesGlobal: async (
    data: { query: string; maxResults?: number; provider?: 'auto' | 'exa' | 'tavily' }
  ): Promise<SourceDiscoveryResult> => {
    const response = await client.post('/files/discover-sources', data, { timeout: RESOURCE_REQUEST_TIMEOUT_MS });
    return response.data;
  },

  getVideoAnalysis: async (workspaceId: string, id: string): Promise<VideoAnalysis> => {
    const response = await client.get(`/files/workspace/${workspaceId}/${id}/video-analysis`, { timeout: 30000 });
    return response.data;
  },

  startVideoAnalysis: async (workspaceId: string, id: string, force = false, preserveManualEdits = false): Promise<VideoAnalysis> => {
    const response = await client.post(`/files/workspace/${workspaceId}/${id}/video-analysis`, { force, preserveManualEdits }, { timeout: 30000 });
    return response.data;
  },

  cancelVideoAnalysis: async (workspaceId: string, id: string): Promise<VideoAnalysis> => {
    const response = await client.post(`/files/workspace/${workspaceId}/${id}/video-analysis/cancel`, {}, { timeout: 30000 });
    return response.data;
  },

  updateVideoAnalysis: async (
    workspaceId: string,
    id: string,
    data: {
      summary?: string;
      chapters?: VideoChapter[];
      keyPoints?: VideoKeyPoint[];
      review?: { status?: VideoReviewStatus; locked?: boolean };
    }
  ): Promise<VideoAnalysis> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/${id}/video-analysis`, data, { timeout: 30000 });
    return response.data;
  },

  rename: async (workspaceId: string, data: { id: string; newName: string }): Promise<FileSystemObject> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/rename`, data);
    return response.data;
  },

  move: async (workspaceId: string, data: { id: string; targetParentId?: string | null }): Promise<FileSystemObject> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/move`, data);
    return response.data;
  },

  updateTags: async (workspaceId: string, data: { id: string; tags: string[] }): Promise<FileSystemObject> => {
    const response = await client.patch(`/files/workspace/${workspaceId}/tags`, data);
    return response.data;
  },

  remove: async (workspaceId: string, id: string): Promise<{ success: boolean }> => {
    const response = await client.delete(`/files/workspace/${workspaceId}`, { data: { id } });
    return response.data;
  },

  copy: async (workspaceId: string, data: { id: string; targetParentId?: string | null }): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/copy`, data);
    return response.data;
  },

  upload: async (
    workspaceId: string,
    files: File[],
    parentId?: string | null,
    parentPath?: string,
    options?: ResourceCreateOptions
  ): Promise<any> => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (parentId) formData.append('parentId', parentId);
    if (parentPath) formData.append('parentPath', parentPath);
    if (options?.workbenchId) formData.append('workbenchId', options.workbenchId);
    if (options?.resourceRole) formData.append('resourceRole', options.resourceRole);
    if (options?.resourceType) formData.append('resourceType', options.resourceType);
    if (options?.scope) formData.append('scope', options.scope);
    if (options?.origin) formData.append('origin', options.origin);
    if (options?.metadata) formData.append('metadata', JSON.stringify(options.metadata));
    if (options?.relativePaths) formData.append('relativePaths', JSON.stringify(options.relativePaths));

    const response = await client.post(`/files/workspace/${workspaceId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: RESOURCE_REQUEST_TIMEOUT_MS
    });
    return response.data;
  },

  getContent: async (workspaceId: string, id: string): Promise<{ content: string }> => {
    const response = await client.get(`/files/workspace/${workspaceId}/content`, { params: { id } });
    return response.data;
  },

  saveContent: async (workspaceId: string, data: { id: string; content: string }): Promise<FileSystemObject> => {
    const response = await client.put(`/files/workspace/${workspaceId}/content`, data);
    return response.data;
  },

  saveContentWithRevision: async (
    workspaceId: string,
    data: {
      id: string;
      content: string;
      baseContentHash?: string | null;
      revisionSummary?: string;
      actionType?: string;
      actor?: string;
    }
  ): Promise<WorkbenchNoteRevisionResult> => {
    const response = await client.put(`/files/workspace/${workspaceId}/content`, {
      ...data,
      createRevision: true
    });
    return response.data;
  },

  listNoteRevisions: async (
    workspaceId: string,
    fileObjectId: string,
    limit = 20
  ): Promise<{ revisions: WorkbenchNoteRevision[] }> => {
    const response = await client.get(`/files/workspace/${workspaceId}/${fileObjectId}/revisions`, {
      params: { limit }
    });
    return response.data;
  },

  revertNoteRevision: async (
    workspaceId: string,
    fileObjectId: string,
    data?: { revisionId?: string; actor?: string }
  ): Promise<WorkbenchNoteRevisionResult> => {
    const response = await client.post(`/files/workspace/${workspaceId}/${fileObjectId}/revisions/revert`, data || {});
    return response.data;
  },

  saveGenerated: async (workspaceId: string, data: { targetDir: string; filename: string; content: string; category?: string } & ResourceCreateOptions): Promise<FileSystemObject> => {
    const response = await client.post(`/files/workspace/${workspaceId}/generated`, data);
    return response.data;
  },

  getPreviewInfo: async (workspaceId: string, id: string): Promise<FilePreviewInfo> => {
    const response = await client.get(`/files/workspace/${workspaceId}/preview-info`, {
      params: { id }
    });
    const data = response.data as FilePreviewInfo;

    const resolveUrl = (value?: string) => {
      if (!value) return undefined;
      if (/^https?:\/\//i.test(value)) return value;
      const normalizedValue = value.startsWith('/api/')
        ? value.slice('/api'.length)
        : value;
      return apiUrl(normalizedValue);
    };

    return {
      ...data,
      previewUrl: resolveUrl(data.previewUrl),
      sourceUrl: resolveUrl(data.sourceUrl)
    };
  },

  getDocumentStructure: async (workspaceId: string, id: string): Promise<RenderableDocument> => {
    const response = await client.get(`/files/workspace/${workspaceId}/document-structure`, {
      params: { id }
    });
    return response.data;
  },

  getResourceIntelligence: async (workspaceId: string, id: string): Promise<ResourceIntelligence> => {
    const response = await client.get(`/files/workspace/${workspaceId}/${id}/resource-intelligence`);
    return response.data;
  },

  startResourceIntelligence: async (
    workspaceId: string,
    id: string,
    options?: { force?: boolean }
  ): Promise<ResourceIntelligence> => {
    const response = await client.post(`/files/workspace/${workspaceId}/${id}/resource-intelligence`, options || {});
    return response.data;
  },

  downloadUrl: (workspaceId: string, id: string): string => {
    return apiUrl(`/files/workspace/${workspaceId}/download?id=${encodeURIComponent(id)}`);
  },

  previewUrl: (workspaceId: string, id: string): string => {
    return apiUrl(`/files/workspace/${workspaceId}/preview?id=${encodeURIComponent(id)}`);
  },

  previewData: async (workspaceId: string, id: string, previewUrl?: string): Promise<ArrayBuffer> => {
    const url = previewUrl || `/files/workspace/${workspaceId}/preview?id=${encodeURIComponent(id)}`;
    const response = await client.get(url, {
      responseType: 'arraybuffer',
      timeout: RESOURCE_REQUEST_TIMEOUT_MS
    });
    return response.data;
  }
};
