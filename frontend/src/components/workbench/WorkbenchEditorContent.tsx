import {
  ArrowUpRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  ExternalLink,
  FileCode2,
  File,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Info,
  Layers3,
  Languages,
  ListChecks,
  Lock,
  Loader2,
  Maximize2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PencilLine,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Unlock,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
  Video,
  CircleHelp,
  ClipboardList,
  GitCompare,
  Route,
  WandSparkles,
  Hand,
  ShieldCheck,
  Shield,
  Gauge,
  ArrowUp
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { EditorState, ResourceReference } from '../../types';
import {
  FilePreviewInfo,
  ResourceIntelligence,
  RenderableDocument,
  RenderableDocumentChunk,
  SlideFrame,
  TranscriptSegment,
  VideoAnalysis,
  VideoChapter,
  VideoEvidenceSegment,
  VideoKeyPoint,
  VideoReviewStatus,
  WorkbenchNoteRevision,
  fileSystemApi
} from '../../services/fileSystemApi';
import {
  aiApi,
  AiChatAttachment,
  AiChatContext,
  AiChatMessage,
  AiContextMode,
  AiWelcomeContent,
  AiWelcomeSuggestion,
  AgentTimelineItem,
  AiLockedSelectionContext
} from '../../services/aiApi';
import MarkdownPreview from './MarkdownPreview';
import SyntaxHighlightedCode from './SyntaxHighlightedCode';
import {
  getLanguageLabel,
  getResourceKind,
  isJsonResource,
  isMarkdownResource
} from './editorResource';
import BlockSuiteNotesEditor from './BlockSuiteNotesEditor';
import BlockSuiteCodeEditor from './BlockSuiteCodeEditor';
import AIStudioPanel from './AIStudioPanel';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const previewInfoCache = new Map<string, FilePreviewInfo>();
const documentStructureCache = new Map<string, RenderableDocument>();
const webPreviewCache = new Map<string, WebPreviewData>();

type WorkbenchContextSelectionActionDetail = {
  prompt?: string;
  fileId?: string;
  fileName?: string;
  page?: number;
  text?: string;
  selectedRange?: Record<string, any>;
  panelId?: string;
  panelType?: string;
  sourceLabel?: string;
};

type DroppedContextSelection = {
  id: string;
  fileId?: string | null;
  fileName?: string;
  panelId?: string;
  panelType?: string;
  sourceLabel?: string;
  text: string;
  selectedRange?: Record<string, any>;
  createdAt: string;
};

const previewCacheKey = (workspaceId: string, resourceId: string) => `${workspaceId}:${resourceId}`;

interface WorkbenchEditorContentProps {
  editor: EditorState;
  resource: ResourceReference | null;
  workspaceId: string;
  content?: string;
  isDirty?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  savedAt?: string;
  saveError?: string;
  isLoading?: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onSaveContent?: (content?: string) => void;
  onApplyAiNoteEdit?: (
    resourceId: string,
    content: string,
    options?: { baseContentHash?: string | null; revisionSummary?: string; actionType?: string; actor?: string }
  ) => void | Promise<boolean | void>;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onBindResource: (editorId: string) => void;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  resources?: ResourceReference[];
}

const notionListClass = 'w-full divide-y divide-[#e1e1de] border-y border-[#e1e1de] bg-[#f8f8f6]';
const notionRowClass = 'group w-full bg-transparent px-4 py-3 text-left transition duration-200 ease-out hover:bg-white focus-visible:bg-white focus-visible:outline-none';
const notionActiveRowClass = 'bg-white hover:bg-white';
const notionMetaClass = 'font-mono text-[11px] font-semibold text-[#777a80]';

const getEditorIcon = (type: EditorState['type']) => {
  switch (type) {
    case 'resource':
      return <FolderOpen className="h-5 w-5" />;
    case 'notes':
      return <FileText className="h-5 w-5" />;
    case 'code':
      return <FileCode2 className="h-5 w-5" />;
    case 'video':
      return <Video className="h-5 w-5" />;
    case 'external':
      return <Globe className="h-5 w-5" />;
    case 'ai':
      return <Sparkles className="h-5 w-5" />;
    case 'studio':
      return <Layers3 className="h-5 w-5" />;
  }
};

const getTextFromDocumentStructure = (documentStructure: RenderableDocument | null | undefined) =>
  documentStructure?.chunks?.map((chunk) => chunk.text).filter(Boolean).join('\n\n') ||
  documentStructure?.pages?.map((page) => page.text).filter(Boolean).join('\n\n') ||
  '';

const extractSourceMetadata = (content?: string | null) => {
  const text = String(content || '');
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  const sourceType = /^Source type:\s*(.+)$/mi.exec(text)?.[1]?.trim().toLowerCase();
  const url = /^URL:\s*(.+)$/mi.exec(text)?.[1]?.trim();
  const body = text
    .replace(/^#\s+.+$/m, '')
    .replace(/^Source type:\s*.+$/gim, '')
    .replace(/^URL:\s*.+$/gim, '')
    .replace(/^Site:\s*.+$/gim, '')
    .replace(/^Byline:\s*.+$/gim, '')
    .replace(/^Excerpt:\s*.+$/gim, '')
    .replace(/^>\s*This source was added.+$/gim, '')
    .trim();

  return { title, sourceType, url, body };
};

const getResourceSourceUrl = (resource?: ResourceReference | null) => {
  const metadataUrl = resource?.metadata?.sourceUrl;
  return typeof metadataUrl === 'string' && metadataUrl.trim() ? metadataUrl.trim() : undefined;
};

type WebPreviewData = Awaited<ReturnType<typeof fileSystemApi.extractUrlPreview>>;

type ResourceIntelligenceKind = ResourceIntelligence['kind'] | 'html';
type ResourceOutlineNodeUi = NonNullable<NonNullable<ResourceIntelligence['structure']>['outline']>[number];
type ResourceTranscriptSegmentUi = NonNullable<ResourceIntelligence['transcript']>[number];

const getEmbedInfo = (url?: string | null) => {
  if (!url) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const videoId = host.includes('youtu.be')
        ? parsed.pathname.split('/').filter(Boolean)[0]
        : parsed.searchParams.get('v') || parsed.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || parsed.pathname.match(/\/embed\/([^/?#]+)/)?.[1];
      return videoId
        ? {
            type: 'video' as const,
            provider: 'YouTube',
            embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`
          }
        : null;
    }

    if (host.includes('bilibili.com')) {
      const bvid = parsed.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1];
      const aid = parsed.pathname.match(/\/video\/av(\d+)/i)?.[1];
      const page = parsed.searchParams.get('p');
      const params = new URLSearchParams();
      if (bvid) params.set('bvid', bvid);
      if (aid) params.set('aid', aid);
      if (page) params.set('page', page);
      return params.toString()
        ? {
            type: 'video' as const,
            provider: 'Bilibili',
            embedUrl: `https://player.bilibili.com/player.html?${params.toString()}`
          }
        : null;
    }
  } catch {
    return null;
  }

  return null;
};

const formatVideoTime = (seconds?: number) => {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

const videoRangeText = (start?: number, end?: number) => `${formatVideoTime(start)} - ${formatVideoTime(end ?? start)}`;

const containsVideoTime = (start: number, end: number | undefined, currentTime: number, nextStart?: number) => {
  const rangeEnd = end ?? nextStart ?? start + 45;
  return currentTime >= start && currentTime < Math.max(rangeEnd, start + 1);
};

const videoAnalysisStatusLabel: Record<VideoAnalysis['status'], string> = {
  idle: 'Not analyzed',
  queued: 'Queued',
  processing: 'Analyzing',
  ready: 'Ready',
  degraded: 'Partial',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

const confidenceText: Record<string, string> = {
  high: '高置信',
  medium: '中置信',
  low: '低置信'
};

const videoConfidenceClass: Record<string, string> = {
  high: 'border-[#b8dfad] bg-[#f3faf1] text-[#2f6c2f]',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low: 'border-rose-200 bg-rose-50 text-rose-700'
};

const videoStageLabels: Record<string, string> = {
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

const errorClassLabel: Record<string, string> = {
  network_timeout: 'Network timeout',
  youtube_blocked: 'YouTube blocked',
  caption_unavailable: 'Captions unavailable',
  cookie_required: 'Cookies required',
  ffmpeg_failed: 'Frame extraction failed',
  ocr_unavailable: 'OCR unavailable',
  llm_timeout: 'LLM timeout',
  vector_index_failed: 'Context index degraded',
  job_interrupted: 'Job interrupted',
  cancelled: 'Cancelled',
  unknown: 'Unknown error'
};

const formatDuration = (ms?: number) => {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const clipText = (value: string, max = 220) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max).trim()}...` : normalized;
};

const resourceIntelligenceLabel = (kind: ResourceIntelligenceKind) => {
  return 'Source guide';
};

const resourceIntelligenceSubtitle = (kind: ResourceIntelligenceKind, loading: boolean, hasAnalysis: boolean) => {
  if (!hasAnalysis) return loading ? 'Preparing semantic map' : 'Waiting for backend analysis';
  if (kind === 'document') return 'Outline and page guide';
  if (kind === 'code') return 'Outline and readable transcript';
  if (kind === 'web') return 'Article outline and transcript';
  return 'Outline and transcript';
};

const intelligenceRangeLabel = (locator?: Record<string, any>, fallback?: string) => {
  const pageStart = Number(locator?.pageStart || locator?.page);
  const pageEnd = Number(locator?.pageEnd || locator?.pageStart || locator?.page);
  if (Number.isFinite(pageStart) && pageStart > 0) return pageEnd > pageStart ? `p${pageStart}-p${pageEnd}` : `p${pageStart}`;
  return fallback || 'source';
};

const flattenResourceOutline = (nodes?: ResourceOutlineNodeUi[]): ResourceOutlineNodeUi[] => {
  const output: ResourceOutlineNodeUi[] = [];
  const visit = (node: ResourceOutlineNodeUi) => {
    output.push(node);
    (node.children || []).forEach(visit);
  };
  (nodes || []).forEach(visit);
  return output;
};

function ResourceIntelligencePanel({
  resource,
  workspaceId,
  kind,
  collapsed,
  onToggleCollapsed
}: {
  resource: ResourceReference;
  workspaceId: string;
  kind: ResourceIntelligenceKind;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [analysis, setAnalysis] = useState<ResourceIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeTab, setActiveTab] = useState<'outline' | 'slides'>('outline');
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const outlineNodes = analysis?.structure?.outline?.length
    ? analysis.structure.outline
    : analysis?.sections?.length
      ? analysis.sections.map((section, index) => ({
          id: section.id,
          title: section.title,
          level: section.level || (index === 0 ? 1 : 2),
          summary: section.summary,
          locator: section.locator,
          confidence: section.confidence,
          evidenceSnippets: section.evidenceSnippets,
          pageTypes: section.pageTypes,
          children: []
        }))
      : [];
  const slideSegments = analysis?.transcript || [];
  const hasAnalysis =
    (analysis?.status === 'ready' || analysis?.status === 'degraded') &&
    Boolean(outlineNodes.length || slideSegments.length || analysis.sections?.length);
  const isProcessing = starting || analysis?.status === 'processing';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fileSystemApi
      .getResourceIntelligence(workspaceId, resource.id)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resource.id, workspaceId]);

  useEffect(() => {
    if (analysis?.status !== 'processing') return;
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void fileSystemApi
        .getResourceIntelligence(workspaceId, resource.id)
        .then((result) => {
          if (!cancelled) setAnalysis(result);
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [analysis?.status, resource.id, workspaceId]);

  useEffect(() => {
    if (!actionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [actionsOpen]);

  const startAnalysis = (force = false) => {
    setStarting(true);
    const apiKind: ResourceIntelligence['kind'] = kind === 'html' ? 'visualization' : kind;
    void fileSystemApi
      .startResourceIntelligence(workspaceId, resource.id, { force })
      .then(setAnalysis)
      .catch((error) => {
        setAnalysis({
          status: 'failed',
          kind: apiKind,
          title: resource.name,
          overview: '',
          readingAdvice: '',
          sections: [],
          error: error?.response?.data?.error || error?.message || 'Source guide request failed.'
        });
      })
      .finally(() => setStarting(false));
  };

  const jumpToLocator = (item: { id?: string; locator?: Record<string, any>; evidence?: string; summary?: string; text?: string }) => {
    window.dispatchEvent(
      new CustomEvent('workbench:jump-to-citation', {
        detail: {
          fileId: resource.id,
          locator: item.locator || {},
          sourceId: item.id,
          preview: item.evidence || item.summary || item.text
        }
      })
    );
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex h-full w-12 items-center justify-center border-l border-[#eeeeeb] bg-white text-[#5f6368] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
        title={`Open ${resourceIntelligenceLabel(kind)}`}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  const showSemanticMap = Boolean(hasAnalysis);
  const intelligenceTitle = resourceIntelligenceLabel(kind);
  const qualityLabel = analysis?.quality
    ? `Extraction ${analysis.quality.extraction} · Structure ${analysis.quality.structure} · Grounding ${analysis.quality.grounding}`
    : '';
  const flatOutline = flattenResourceOutline(outlineNodes);
  const parsedPages = analysis?.diagnostics?.parsedPageCount;
  const totalPages = analysis?.diagnostics?.pageCount || analysis?.quality?.pageCount;
  const oneLineSummary = clipText(analysis?.overview || analysis?.readingAdvice || '', 140);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#f8f8f6] text-[#25272b]">
      <div className="shrink-0 border-b border-[#e1e1de] bg-[#f8f8f6] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#25272b]">
              Source guide
              {(loading || isProcessing) && <Loader2 className="h-4 w-4 animate-spin text-[#777a80]" />}
            </div>
            <div className="mt-1 text-xs leading-5 text-[#777a80]">
              {analysis?.status === 'failed'
                ? 'Source guide failed'
                : oneLineSummary || resourceIntelligenceSubtitle(kind, loading || isProcessing, hasAnalysis)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div ref={actionsRef} className="relative">
              <button
                type="button"
                onClick={() => setActionsOpen((value) => !value)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#6f7378] transition hover:bg-[#f1f1ee] hover:text-[#202124]"
                title="More actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {actionsOpen && (
                <div className="absolute right-0 top-9 z-20 w-80 overflow-hidden rounded-xl border border-[#e5e5e1] bg-white py-1 text-sm shadow-lg shadow-black/10">
                  <button
                    type="button"
                    onClick={() => {
                      setActionsOpen(false);
                      startAnalysis(true);
                    }}
                    disabled={starting}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[#34373c] transition hover:bg-[#f7f7f5] disabled:opacity-60"
                  >
                    <span>{analysis?.status === 'failed' ? 'Retry source guide' : 'Regenerate'}</span>
                    {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 text-[#8b8f94]" />}
                  </button>
                  {analysis ? (
                    <div className="border-t border-[#eeeeeb] px-3 py-3 text-xs leading-5 text-[#5f6368]">
                      <div className="mb-2 flex items-center gap-2 font-semibold text-[#34373c]">
                        <Info className="h-3.5 w-3.5 text-[#8b8f94]" />
                        Source guide details
                      </div>
                      <div className="space-y-1">
                        <div>Status: {analysis.status}</div>
                        {analysis.progress?.stage ? <div>Stage: {analysis.progress.stage}</div> : null}
                        {analysis.progress?.message ? <div>{analysis.progress.message}</div> : null}
                        {qualityLabel ? <div>{qualityLabel}</div> : null}
                        {typeof analysis.quality?.coverage === 'number' ? <div>Coverage {Math.round(analysis.quality.coverage * 100)}%</div> : null}
                        {typeof analysis.quality?.transcriptCoverage === 'number' ? <div>Transcript {Math.round(analysis.quality.transcriptCoverage * 100)}%</div> : null}
                        {analysis.diagnostics ? (
                          <div>
                            Pages {parsedPages ?? 0}/{totalPages ?? '-'} · Outline {analysis.diagnostics.outlineNodeCount} · Slides {analysis.diagnostics.transcriptSegmentCount}
                          </div>
                        ) : null}
                        {analysis.model ? <div>Model: {analysis.model}</div> : null}
                        {analysis.completedAt ? <div>Completed {new Date(analysis.completedAt).toLocaleString()}</div> : null}
                        {analysis.error ? <div className="text-[#9f341c]">{analysis.error}</div> : null}
                      </div>
                      {analysis.warnings?.length ? (
                        <div className="mt-3 border-t border-[#eeeeeb] pt-2">
                          <div className="mb-1 font-semibold text-[#34373c]">Notes</div>
                          <div className="space-y-1 text-amber-700">
                            {analysis.warnings.slice(0, 5).map((warning, index) => (
                              <div key={`${warning}-${index}`}>{warning}</div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {analysis.progress?.stages?.length ? (
                        <div className="mt-3 border-t border-[#eeeeeb] pt-2">
                          <div className="mb-1 font-semibold text-[#34373c]">Run history</div>
                          <div className="max-h-40 space-y-2 overflow-auto pr-1">
                            {analysis.progress.stages.slice(-6).map((stage) => (
                              <div key={`${stage.stage}-${stage.startedAt || stage.endedAt || ''}`} className="rounded-lg bg-[#fbfbfa] px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-[#34373c]">{stage.label || stage.stage}</span>
                                  <span className="text-[#8b8f94]">{stage.status}</span>
                                </div>
                                {stage.message || stage.warning || stage.error ? (
                                  <div className="mt-0.5 text-[#777a80]">{stage.message || stage.warning || stage.error}</div>
                                ) : null}
                                <div className="mt-0.5 flex flex-wrap gap-2 text-[#8b8f94]">
                                  {stage.durationMs != null ? <span>{formatDuration(stage.durationMs)}</span> : null}
                                  {stage.outputCount != null ? <span>{stage.outputCount} outputs</span> : null}
                                  {stage.tool ? <span>{stage.tool}</span> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#6f7378] transition hover:bg-[#f1f1ee] hover:text-[#202124]"
              title={`Collapse ${intelligenceTitle}`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#f8f8f6] py-4">
        {analysis?.status === 'ready' || analysis?.status === 'degraded' ? (
          <div className="mb-4 px-4 text-sm leading-6 text-[#3f4247]">
            {analysis.status === 'degraded' ? (
              <div className="mb-2 inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">Partial source guide</div>
            ) : null}
            {oneLineSummary || analysis.overview}
            {analysis.readingAdvice ? <span className="text-[#6f7378]"> {analysis.readingAdvice}</span> : null}
            {qualityLabel ? (
              <div className="mt-2 text-xs leading-5 text-[#777a80]">Details are available from the more menu.</div>
            ) : null}
          </div>
        ) : (
          <div className="mb-4 px-4">
            <div className="text-sm font-semibold text-[#25272b]">
              {isProcessing
                ? 'Source guide in progress'
                : analysis?.status === 'failed'
                  ? 'Source guide unavailable'
                  : 'No source guide generated yet'}
            </div>
            <div className="mt-1 text-xs leading-5 text-[#777a80]">
              {isProcessing
                ? 'The backend is extracting structure and building a cited map.'
                : analysis?.error || 'Run source guide to build a cited map for this source.'}
            </div>
            {isProcessing ? null : (
              <button
                type="button"
                onClick={() => startAnalysis(Boolean(analysis?.status === 'failed'))}
                disabled={starting}
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-full bg-[#202124] px-3 text-xs font-medium text-white transition hover:bg-[#34373c] disabled:opacity-60"
              >
                {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {analysis?.status === 'failed' ? 'Retry' : 'Generate'}
              </button>
            )}
          </div>
        )}
        {showSemanticMap ? (
          <div>
            <div className="mb-3 px-4">
            <div className="flex items-center gap-1">
              {(['outline', 'slides'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex h-9 items-center justify-center overflow-hidden rounded-xl transition-all duration-300 ease-out ${
                    activeTab === tab
                      ? 'w-[116px] bg-white px-3 text-[#202124] shadow-[0_8px_24px_rgba(0,0,0,0.07)]'
                      : 'w-9 px-0 text-[#7a7e84] hover:bg-white/70 hover:text-[#202124]'
                  }`}
                  title={tab === 'outline' ? 'Outline' : 'Slides'}
                >
                  {tab === 'outline' ? (
                    <FileText className="h-4 w-4 shrink-0" />
                  ) : (
                    <Image className="h-4 w-4 shrink-0" />
                  )}
                  <span
                    className={`whitespace-nowrap text-sm font-semibold transition-all duration-300 ease-out ${
                      activeTab === tab ? 'ml-2 max-w-[76px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                    }`}
                  >
                    {tab === 'outline' ? `Outline ${flatOutline.length || ''}` : `Slides ${slideSegments.length || ''}`}
                  </span>
                </button>
              ))}
            </div>
            </div>
            {activeTab === 'outline' ? (
              <div className="w-full divide-y divide-[#e1e1de] border-y border-[#e1e1de]">
                {flatOutline.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => jumpToLocator(node)}
                    className="group grid w-full grid-cols-[24px_1fr] gap-3 bg-transparent px-4 py-3 text-left transition duration-200 ease-out hover:bg-white focus-visible:bg-white focus-visible:outline-none"
                    style={{ paddingLeft: `${12 + Math.max(0, (node.level || 1) - 1) * 14}px` }}
                  >
                    <FileText className="mt-0.5 h-5 w-5 text-[#9b9a95] transition group-hover:text-[#777a80]" />
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className={notionMetaClass}>
                          {intelligenceRangeLabel(node.locator, node.pageStart ? `p${node.pageStart}` : undefined)}
                        </span>
                        <span className="text-[11px] text-[#b0b2b6]">L{node.level || 1}</span>
                      </div>
                      <div className="text-sm font-semibold leading-5 text-[#25272b]">{node.title}</div>
                      {node.summary ? <p className="mt-2 text-sm leading-6 text-[#5f6368]">{node.summary}</p> : null}
                      {node.evidenceSnippets?.length ? (
                        <div className="mt-2 text-xs leading-5 text-[#777a80]">
                          {node.evidenceSnippets[0]?.page ? <span className="font-mono text-[rgb(46,113,236)]">p{node.evidenceSnippets[0].page}</span> : null}
                          {node.evidenceSnippets[0]?.page ? ' · ' : ''}
                          {node.evidenceSnippets[0]?.text}
                        </div>
                      ) : null}
                      {node.pageTypes?.length || node.confidence ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {node.confidence ? (
                            <span className="text-[11px] text-[#777a80]">{node.confidence}</span>
                          ) : null}
                          {node.pageTypes?.slice(0, 2).map((pageType) => (
                            <span key={`${node.id}:${pageType}`} className="text-[11px] text-[#777a80]">{pageType}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="w-full divide-y divide-[#e1e1de] border-y border-[#e1e1de]">
                {slideSegments.map((segment: ResourceTranscriptSegmentUi) => (
                  <button
                    key={segment.id}
                    type="button"
                    onClick={() => jumpToLocator(segment)}
                    className="group grid w-full grid-cols-[24px_1fr] gap-3 bg-transparent px-4 py-3 text-left transition duration-200 ease-out hover:bg-white focus-visible:bg-white focus-visible:outline-none"
                  >
                    <FileText className="mt-0.5 h-5 w-5 text-[#9b9a95] transition group-hover:text-[#777a80]" />
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className={notionMetaClass}>
                          {intelligenceRangeLabel(segment.locator, segment.pageStart ? `p${segment.pageStart}` : `Part ${segment.index + 1}`)}
                        </span>
                        {segment.title ? <span className="truncate text-[11px] text-[#96999d]">{segment.title}</span> : null}
                      </div>
                      <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-[#34373c]">{segment.text}</p>
                      {segment.confidence ? (
                        <div className="mt-2">
                          <span className="text-[11px] text-[#777a80]">{segment.confidence}</span>
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : loading || isProcessing ? (
          <div className="space-y-0 divide-y divide-[#e1e1de] border-y border-[#e1e1de]">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="px-4 py-3">
                <div className="h-3 w-24 animate-pulse rounded bg-[#ececea]" />
                <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-[#f0f0ee]" />
                <div className="mt-2 h-3 w-11/12 animate-pulse rounded bg-[#f0f0ee]" />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ResourcePanelShell({
  editor,
  resource,
  workspaceId,
  guideKind,
  guidePanel,
  sourceUrl,
  onUpdateViewState,
  children
}: {
  editor: EditorState;
  resource: ResourceReference;
  workspaceId: string;
  guideKind?: ResourceIntelligenceKind;
  guidePanel?: (props: { collapsed: boolean; onToggleCollapsed: () => void }) => ReactNode;
  sourceUrl?: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  children: ReactNode;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const hasGuide = Boolean(guidePanel || guideKind);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#25272b]">
      <div className="shrink-0 border-b border-[#eeeeeb] bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[#202124]">
              {resource.name}
            </h1>
            <div className="mt-1 truncate text-sm text-[#8b8f94]">{resource.path}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasGuide && (
              <button
                type="button"
                onClick={() => setGuideOpen((value) => !value)}
                className={`inline-flex h-9 items-center justify-center overflow-hidden rounded-xl transition-all duration-300 ease-out ${
                  guideOpen
                    ? 'w-[132px] bg-[#f3f2ee] px-3 text-[#202124] shadow-[0_8px_24px_rgba(0,0,0,0.07)]'
                    : 'w-9 px-0 text-[#7a7e84] hover:bg-[#f6f6f4] hover:text-[#202124]'
                }`}
                title="Source guide"
                aria-pressed={guideOpen}
              >
                <PanelRight className="h-4 w-4 shrink-0" />
                <span
                  className={`whitespace-nowrap text-sm font-semibold transition-all duration-300 ease-out ${
                    guideOpen ? 'ml-2 max-w-[92px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                  }`}
                >
                  Source guide
                </span>
              </button>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#4b4f55] transition hover:bg-[#f1f1ef] hover:text-[#202124]"
                title="Open source"
              >
                <ArrowUpRight className="h-5 w-5" />
              </a>
            )}
          </div>
        </div>
      </div>
      <div
        className={`grid min-h-0 flex-1 bg-white ${
          guideOpen ? 'xl:grid-cols-[minmax(0,1fr)_420px]' : 'xl:grid-cols-[minmax(0,1fr)]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
        {guideOpen && (
        <aside className="min-h-0 border-t border-[#eeeeeb] bg-[#f8f8f6] xl:border-l xl:border-t-0">
          {guidePanel ? (
            guidePanel({
              collapsed: false,
              onToggleCollapsed: () => setGuideOpen(false)
            })
          ) : guideKind ? (
            <ResourceIntelligencePanel
              resource={resource}
              workspaceId={workspaceId}
              kind={guideKind}
              collapsed={false}
              onToggleCollapsed={() => setGuideOpen(false)}
            />
          ) : null}
        </aside>
        )}
      </div>
    </div>
  );
}

function VideoLearningPanel({
  resource,
  workspaceId,
  editorId,
  currentTime = 0,
  onSeek,
  onUpdateViewState,
  onClose
}: {
  resource: ResourceReference;
  workspaceId: string;
  editorId?: string;
  currentTime?: number;
  onSeek?: (seconds: number) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onClose?: () => void;
}) {
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [activeTrack, setActiveTrack] = useState<'learning' | 'chapters' | 'transcript' | 'slides' | 'review'>('chapters');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [opsPanelOpen, setOpsPanelOpen] = useState(false);
  const [preserveManualEdits, setPreserveManualEdits] = useState(true);
  const [draftSummary, setDraftSummary] = useState('');
  const [draftChapters, setDraftChapters] = useState<VideoChapter[]>([]);
  const [draftKeyPoints, setDraftKeyPoints] = useState<VideoKeyPoint[]>([]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number; segmentIds: string[] } | null>(null);
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null);
  const [highlightedTimestamp, setHighlightedTimestamp] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const lastContextRef = useRef('');
  const isStaleAnalysis = Boolean(
    analysis &&
    ['queued', 'processing'].includes(analysis.status) &&
    Date.now() - new Date(analysis.startedAt || analysis.queuedAt || 0).getTime() > 30 * 60 * 1000
  );
  const isLocked = Boolean(analysis?.review?.locked);
  const reviewStatus = analysis?.review?.status || 'draft';

  const loadAnalysis = () => {
    if (!resource.id) return;
    setLoading(true);
    setError('');
    void fileSystemApi
      .getVideoAnalysis(workspaceId, resource.id)
      .then(setAnalysis)
      .catch((err) => setError(err?.response?.data?.error || err?.message || 'Failed to load video analysis.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAnalysis();
  }, [resource.id, workspaceId]);

  useEffect(() => {
    if (!analysis || editing) return;
    setDraftSummary(analysis.summary || '');
    setDraftChapters(analysis.chapters || []);
    setDraftKeyPoints(analysis.keyPoints || []);
  }, [analysis, editing]);

  useEffect(() => {
    if (!analysis || !['queued', 'processing'].includes(analysis.status) || isStaleAnalysis) return;
    const timer = window.setInterval(loadAnalysis, 2500);
    return () => window.clearInterval(timer);
  }, [analysis?.status, isStaleAnalysis, resource.id, workspaceId]);

  useEffect(() => {
    if (!actionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [actionsOpen]);

  const startAnalysis = (force = false) => {
    setStarting(true);
    setError('');
    void fileSystemApi
      .startVideoAnalysis(workspaceId, resource.id, force, preserveManualEdits)
      .then(setAnalysis)
      .catch((err) => setError(err?.response?.data?.error || err?.message || 'Failed to start video analysis.'))
      .finally(() => setStarting(false));
  };

  const cancelAnalysis = () => {
    setStarting(true);
    setError('');
    void fileSystemApi
      .cancelVideoAnalysis(workspaceId, resource.id)
      .then(setAnalysis)
      .catch((err) => setError(err?.response?.data?.error || err?.message || 'Failed to cancel video analysis.'))
      .finally(() => setStarting(false));
  };

  const saveManualEdits = (reviewPatch?: { status?: VideoReviewStatus; locked?: boolean }) => {
    setSavingEdits(true);
    setError('');
    void fileSystemApi
      .updateVideoAnalysis(workspaceId, resource.id, {
        summary: draftSummary,
        chapters: draftChapters,
        keyPoints: draftKeyPoints,
        review: reviewPatch
      })
      .then((next) => {
        setAnalysis(next);
        setEditing(false);
      })
      .catch((err) => setError(err?.response?.data?.error || err?.message || 'Failed to save video analysis edits.'))
      .finally(() => setSavingEdits(false));
  };

  const updateReview = (reviewPatch: { status?: VideoReviewStatus; locked?: boolean }) => {
    if (!analysis) return;
    setSavingEdits(true);
    setError('');
    void fileSystemApi
      .updateVideoAnalysis(workspaceId, resource.id, {
        summary: analysis.summary,
        chapters: analysis.chapters,
        keyPoints: analysis.keyPoints,
        review: reviewPatch
      })
      .then(setAnalysis)
      .catch((err) => setError(err?.response?.data?.error || err?.message || 'Failed to update review state.'))
      .finally(() => setSavingEdits(false));
  };

  const cancelManualEdits = () => {
    setDraftSummary(analysis?.summary || '');
    setDraftChapters(analysis?.chapters || []);
    setDraftKeyPoints(analysis?.keyPoints || []);
    setEditing(false);
  };

  const hasContent = Boolean(
    analysis?.summary ||
    analysis?.transcript?.length ||
    analysis?.chapters?.length ||
    analysis?.keyPoints?.length ||
    analysis?.slides?.length
  );
  const isRunning = analysis?.status === 'queued' || analysis?.status === 'processing';
  const progress = analysis?.progress;
  const showOpsSummary = Boolean(progress && hasContent && !isRunning && !analysis?.error);
  const showOpsDetails = Boolean(progress && opsPanelOpen);
  const activeStage = progress?.stage || analysis?.status || 'idle';
  const progressPercent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const canStartAnalysis = !starting && (isStaleAnalysis || !isRunning);
  const analysisActionLabel = analysis?.status === 'failed' || analysis?.status === 'cancelled'
    ? 'Retry'
    : hasContent || isStaleAnalysis
      ? 'Regenerate'
      : 'Analyze';
  const videoSubtitle = loading && !analysis
    ? 'Loading analysis...'
    : analysis
      ? analysis.status === 'failed' || analysis.status === 'cancelled'
        ? 'Analysis did not finish'
        : isRunning
          ? `${videoAnalysisStatusLabel[analysis.status]} · ${videoStageLabels[activeStage] || activeStage}`
          : hasContent
            ? `${videoAnalysisStatusLabel[analysis.status]} · ${analysis.provider}`
            : videoAnalysisStatusLabel[analysis.status]
      : 'Transcript, chapters, key points, and slide frames';
  const hasAnalysisIssue = Boolean(error || analysis?.error || analysis?.status === 'failed' || analysis?.status === 'cancelled');
  const chapters = editing ? draftChapters : analysis?.chapters || [];
  const keyPoints = editing ? draftKeyPoints : analysis?.keyPoints || [];
  const transcript = analysis?.transcript || [];
  const slides = analysis?.slides || [];
  const activeTranscript = transcript.find((segment) => currentTime >= segment.start && currentTime < segment.end);
  const activeChapter = chapters.find((chapter, index) =>
    containsVideoTime(chapter.start, chapter.end, currentTime, chapters[index + 1]?.start)
  );
  const activeSlide = slides.reduce<SlideFrame | undefined>((best, slide) => {
    if (slide.timestamp > currentTime) return best;
    if (!best || slide.timestamp > best.timestamp) return slide;
    return best;
  }, undefined);
  const nearbySlides = slides
    .filter((slide) => Math.abs(slide.timestamp - currentTime) <= 120 || slide.id === activeSlide?.id || slide.chapterId === activeChapter?.id)
    .slice(0, 6);
  const activeKeyPoints = keyPoints.filter((point) =>
    point.timestamps.some((timestamp) => Math.abs(timestamp - currentTime) <= 45) || point.sourceRange && containsVideoTime(point.sourceRange.start, point.sourceRange.end, currentTime)
  );

  const seekTo = (seconds?: number) => {
    if (seconds == null || Number.isNaN(Number(seconds))) return;
    const next = Math.max(0, Number(seconds));
    setHighlightedTimestamp(next);
    onSeek?.(next);
    window.setTimeout(() => setHighlightedTimestamp(null), 2800);
  };

  const buildRangeText = (range: { start: number; end: number; segmentIds: string[] }) => {
    const segments = range.segmentIds
      .map((id) => transcript.find((segment) => segment.id === id))
      .filter(Boolean) as TranscriptSegment[];
    const text = segments.map((segment) => `[${formatVideoTime(segment.start)}] ${segment.text}`).join('\n');
    return text || `Video range ${videoRangeText(range.start, range.end)}`;
  };

  const publishVideoContext = (range = selectedRange) => {
    if (!editorId || !onUpdateViewState || !analysis) return;
    const selectedText = range ? buildRangeText(range) : '';
    const contextLines = [
      `Video: ${analysis.title || resource.name}`,
      `Current time: ${formatVideoTime(currentTime)}`,
      activeChapter ? `Current chapter: ${videoRangeText(activeChapter.start, activeChapter.end)} ${activeChapter.title}` : '',
      activeSlide ? `Current slide: ${formatVideoTime(activeSlide.timestamp)} ${activeSlide.title || activeSlide.ocrText || ''}` : '',
      activeTranscript ? `Current transcript: ${activeTranscript.text}` : '',
      range ? `Selected range: ${videoRangeText(range.start, range.end)}\n${selectedText}` : ''
    ].filter(Boolean).join('\n');
    onUpdateViewState(editorId, {
      selectedText,
      selectedRange: range
        ? {
            timestampStart: range.start,
            timestampEnd: range.end,
            segmentIds: range.segmentIds,
            textLength: selectedText.length,
            sourceType: 'video_selection'
          }
        : null,
      videoCurrentTime: currentTime,
      videoActiveChapterId: activeChapter?.id,
      videoActiveSlideId: activeSlide?.id,
      videoContextText: contextLines,
      visibleContent: contextLines,
      approxChunkIndex: Math.max(0, Math.floor(currentTime / 30))
    });
  };

  const startVideoDrag = (
    event: React.DragEvent<HTMLElement>,
    payload: {
      text: string;
      selectedRange: Record<string, any>;
      label: string;
    }
  ) => {
    const detail: WorkbenchContextSelectionActionDetail = {
      fileId: resource.id,
      fileName: analysis?.title || resource.name,
      panelId: editorId,
      panelType: 'video',
      sourceLabel: payload.label,
      selectedRange: payload.selectedRange,
      text: payload.text,
      prompt: '请基于我拖入的视频内容回答：'
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-workbench-context-selection', JSON.stringify(detail));
    event.dataTransfer.setData('text/plain', payload.text);
  };

  useEffect(() => {
    if (!analysis || !editorId || !onUpdateViewState) return;
    const signature = [
      Math.floor(currentTime / 5),
      activeChapter?.id || '',
      activeSlide?.id || '',
      activeTranscript?.id || '',
      selectedRange ? `${selectedRange.start}-${selectedRange.end}` : ''
    ].join(':');
    if (signature === lastContextRef.current) return;
    lastContextRef.current = signature;
    publishVideoContext(selectedRange);
  }, [analysis, editorId, onUpdateViewState, currentTime, activeChapter?.id, activeSlide?.id, activeTranscript?.id, selectedRange?.start, selectedRange?.end]);

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent<CitationJumpDetail>).detail;
      if (!detail?.fileId || detail.fileId !== resource.id) return;
      const start = Number(detail.locator?.timestampStart ?? detail.locator?.start ?? detail.locator?.time ?? detail.locator?.timestamp);
      const end = Number(detail.locator?.timestampEnd ?? detail.locator?.end ?? start);
      if (!Number.isFinite(start)) return;
      seekTo(start);
      setSelectedRange(Number.isFinite(end) && end > start ? { start, end, segmentIds: transcript.filter((segment) => segment.end >= start && segment.start <= end).map((segment) => segment.id) } : null);
      trackRef.current?.scrollTo({ top: Math.max(0, start * 3), behavior: 'smooth' });
    };
    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [resource.id, transcript, onSeek]);

  const selectTranscriptRange = (segment: TranscriptSegment) => {
    setRangeAnchorId(segment.id);
    setSelectedRange({ start: segment.start, end: segment.end, segmentIds: [segment.id] });
  };

  const clearRange = () => {
    setSelectedRange(null);
    setRangeAnchorId(null);
    if (editorId && onUpdateViewState) {
      onUpdateViewState(editorId, { selectedText: '', selectedRange: null });
    }
  };

  const EvidenceList = ({ evidence }: { evidence?: VideoEvidenceSegment[] }) => {
    if (!evidence?.length) return null;
    return (
      <div className="mt-3 border-y border-[#e1e1de] bg-[#f8f8f6]">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#777a80]">依据字幕</div>
        <div className={notionListClass}>
          {evidence.slice(0, 3).map((segment) => (
            <button
              key={`${segment.segmentId}-${segment.start}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                seekTo(segment.start);
              }}
              className={`${notionRowClass} grid grid-cols-[64px_1fr] gap-2 text-xs leading-5 text-[#5f6368] hover:text-[#25272b]`}
            >
              <span className="font-semibold text-[rgb(46,113,236)]">{formatVideoTime(segment.start)}</span>
              <span className="line-clamp-2">{segment.text}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const ConfidenceBadge = ({ confidence, edited }: { confidence?: string; edited?: boolean }) => (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${videoConfidenceClass[confidence || 'low'] || videoConfidenceClass.low}`}>
      {edited ? '人工修订' : confidenceText[confidence || 'low']}
    </span>
  );

  const ProgressPanel = () => {
    if (!analysis || !progress) return null;
    const visibleStages = (progress.stages || []).slice(-8);
    if (!showOpsDetails && showOpsSummary) {
      return (
        <button
          type="button"
          onClick={() => setOpsPanelOpen(true)}
          className="mb-3 flex w-full items-center justify-between gap-3 border-y border-[#e1e1de] bg-[#f8f8f6] px-4 py-3 text-left text-xs text-[#777a80] transition hover:bg-white"
        >
          <span>
            <span className="font-semibold text-[#34373c]">{videoStageLabels[activeStage] || activeStage}</span>
            <span className="ml-2">{progress.message || 'Video analysis completed.'}</span>
          </span>
          <span className="shrink-0 font-semibold text-[rgb(46,113,236)]">More</span>
        </button>
      );
    }
    if (!showOpsDetails) return null;
    return (
      <div className="mb-4 border-y border-[#e1e1de] bg-[#f8f8f6] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[#25272b]">
              {videoStageLabels[activeStage] || activeStage}
            </div>
            <div className="mt-1 text-xs leading-5 text-[#777a80]">
              {progress.message || (isRunning ? 'Video analysis is running.' : 'Video analysis status is available.')}
              {progress.queuePosition ? ` Queue position ${progress.queuePosition}.` : ''}
              {progress.heartbeatAt ? ` Last update ${new Date(progress.heartbeatAt).toLocaleTimeString()}.` : ''}
            </div>
          </div>
          <div className="text-right text-xs text-[#777a80]">
            <div className="font-semibold text-[#34373c]">{progressPercent}%</div>
            {progress.costEstimate != null && <div>cost {progress.costEstimate}</div>}
            {!isRunning && hasContent && (
              <button
                type="button"
                onClick={() => setOpsPanelOpen(false)}
                className="mt-1 font-medium text-[rgb(46,113,236)] hover:underline"
              >
                Collapse
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ececea]">
          <div className="h-full rounded-full bg-[rgb(46,113,236)] transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        {visibleStages.length > 0 && (
          <div className="mt-3 divide-y divide-[#e1e1de] border-y border-[#e1e1de]">
            {visibleStages.map((stage) => (
              <div key={`${stage.stage}-${stage.startedAt || ''}`} className="bg-transparent px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-xs font-semibold text-[#34373c]">
                    {stage.label || videoStageLabels[stage.stage] || stage.stage}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    stage.status === 'completed' ? 'bg-[#f3faf1] text-[#2f6c2f]' :
                      stage.status === 'failed' ? 'bg-[#fff3f0] text-[#9f341c]' :
                        stage.status === 'cancelled' ? 'bg-[#f6f6f4] text-[#777a80]' :
                          stage.status === 'skipped' ? 'bg-[#f6f6f4] text-[#777a80]' :
                            'bg-[#f0f2fb] text-[rgb(46,113,236)]'
                  }`}>
                    {stage.status}
                  </span>
                </div>
                <div className="mt-1 text-[11px] leading-4 text-[#777a80]">
                  {stage.message || stage.warning || stage.error || stage.tool || ''}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#8b8f94]">
                  {stage.durationMs != null && <span>{formatDuration(stage.durationMs)}</span>}
                  {stage.outputCount != null && <span>{stage.outputCount} outputs</span>}
                  {stage.errorClass && <span>{errorClassLabel[stage.errorClass] || stage.errorClass}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-[520px] flex-col bg-[#f8f8f6] xl:min-h-0">
      <div className="shrink-0 border-b border-[#e1e1de] bg-[#f8f8f6] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
            <div className="text-sm font-semibold text-[#25272b]">Source guide</div>
          <div className="mt-1 text-xs text-[#777a80]">
            {videoSubtitle}
          </div>
          {hasAnalysisIssue && (
            <button
              type="button"
              onClick={() => {
                setOpsPanelOpen(true);
                setActionsOpen(true);
              }}
              className="mt-2 inline-flex h-7 max-w-full items-center gap-2 rounded-full bg-[#fff3ef] px-3 text-xs font-medium text-[#a3341c] ring-1 ring-[#f1d3ca] transition hover:bg-[#ffebe5]"
            >
              <span className="truncate">
                {analysis?.status === 'failed' || analysis?.status === 'cancelled' ? 'Video analysis did not finish.' : 'Video analysis needs attention.'}
              </span>
              <span className="shrink-0 font-semibold text-[rgb(46,113,236)]">Details</span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasContent && (
            editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelManualEdits}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#eeeeeb] px-3 text-xs font-medium text-[#5f6368] transition hover:bg-[#f6f6f4]"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveManualEdits({ status: reviewStatus, locked: isLocked })}
                  disabled={savingEdits}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#202124] px-3 text-xs font-medium text-white transition hover:bg-[#34373c] disabled:opacity-60"
                >
                  {savingEdits ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={isLocked}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#eeeeeb] px-3 text-xs font-medium text-[#5f6368] transition hover:bg-[#f6f6f4]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </button>
            )
          )}
          <div ref={actionsRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setActionsOpen((value) => !value);
                setOpsPanelOpen(true);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5f6368] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
              title="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {actionsOpen && (
              <div className="absolute right-0 top-9 z-30 w-80 overflow-hidden rounded-xl border border-[#e5e5e1] bg-white py-1 text-sm shadow-lg shadow-black/10">
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    startAnalysis(Boolean(hasContent || isStaleAnalysis));
                  }}
                  disabled={!canStartAnalysis}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[#34373c] transition hover:bg-[#f7f7f5] disabled:opacity-60"
                >
                  <span>{analysisActionLabel}</span>
                  {starting || (!isStaleAnalysis && isRunning)
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : hasContent ? <RefreshCcw className="h-3.5 w-3.5 text-[#8b8f94]" /> : <Sparkles className="h-3.5 w-3.5 text-[#8b8f94]" />}
                </button>
                {isRunning && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionsOpen(false);
                      cancelAnalysis();
                    }}
                    disabled={starting || progress?.canCancel === false}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[#34373c] transition hover:bg-[#f7f7f5] disabled:opacity-60"
                  >
                    <span>Cancel analysis</span>
                    <X className="h-3.5 w-3.5 text-[#8b8f94]" />
                  </button>
                )}
                <div className="border-t border-[#eeeeeb] px-3 py-3 text-xs leading-5 text-[#5f6368]">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-[#34373c]">
                    <Info className="h-3.5 w-3.5 text-[#8b8f94]" />
                    Source guide details
                  </div>
                  <div className="space-y-1">
                    <div>Status: {analysis ? videoAnalysisStatusLabel[analysis.status] : loading ? 'Loading' : 'Not analyzed'}</div>
                    {analysis?.provider ? <div>Source: {analysis.provider}</div> : null}
                    {progress ? <div>Stage: {videoStageLabels[activeStage] || activeStage} · {progressPercent}%</div> : null}
                    {progress?.message ? <div>{progress.message}</div> : null}
                    {progress?.heartbeatAt ? <div>Last update {new Date(progress.heartbeatAt).toLocaleString()}</div> : null}
                    {analysis?.manualRevision ? (
                      <div>Manual revision {analysis.manualRevision.revision} saved {new Date(analysis.manualRevision.updatedAt).toLocaleString()}</div>
                    ) : null}
                    {analysis?.review ? <div>Review: {reviewStatus.replace('_', ' ')}{isLocked ? ' · locked' : ''}</div> : null}
                    {analysis?.errorClass ? <div>{errorClassLabel[analysis.errorClass] || analysis.errorClass}</div> : null}
                    {analysis?.error ? <div className="text-[#9f341c]">{analysis.error}</div> : null}
                    {error ? <div className="text-[#9f341c]">{error}</div> : null}
                  </div>
                  {progress?.stages?.length ? <div className="mt-3"><ProgressPanel /></div> : null}
                  {analysis?.warnings?.length ? (
                    <div className="mt-3 border-t border-[#eeeeeb] pt-2">
                      <div className="mb-1 font-semibold text-[#34373c]">Notes</div>
                      <div className="space-y-1 text-amber-700">
                        {analysis.warnings.slice(0, 5).map((warning, index) => (
                          <div key={`${warning}-${index}`}>{warning}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#6f7378] transition hover:bg-[#f1f1ee] hover:text-[#202124]"
              title="Close source guide"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-[#e1e1de] bg-[#f8f8f6] px-4 py-3">
        <div className="flex items-center gap-1">
          {([
            { key: 'chapters', label: 'Chapters', count: chapters.length, icon: FileText },
            { key: 'transcript', label: 'Transcript', count: transcript.length, icon: FileText },
            { key: 'slides', label: 'Slides', count: slides.length, icon: Image },
            { key: 'learning', label: 'Evidence & Review', count: keyPoints.length, icon: Sparkles }
          ] as const).map(({ key, label, count, icon: Icon }) => {
            const active = activeTrack === key || (activeTrack === 'review' && key === 'learning');
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTrack(key)}
                className={`flex h-9 items-center justify-center overflow-hidden rounded-xl transition-all duration-300 ease-out ${
                  active
                    ? 'w-[132px] bg-white px-3 text-[#202124] shadow-[0_8px_24px_rgba(0,0,0,0.07)]'
                    : 'w-9 px-0 text-[#7a7e84] hover:bg-white/70 hover:text-[#202124]'
                }`}
                title={label}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={`whitespace-nowrap text-sm font-semibold transition-all duration-300 ease-out ${
                  active ? 'ml-2 max-w-[96px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                }`}>
                  {label}{count ? ` ${count}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[#f8f8f6] py-4">
        {!analysis || (!hasContent && analysis.status === 'idle') ? (
          <div className="border-y border-[#e1e1de] px-4 py-5 text-sm leading-6 text-[#5f6368]">
            Start analysis to extract captions, AI chapters, learning key points, and slide-like frames from this video.
          </div>
        ) : (
            <section ref={trackRef} className="min-w-0">
              {activeTrack === 'learning' && (
                <div className="space-y-4">
            {analysis.manualRevision && (
              <div className="border-y border-[#e1e1de] px-4 py-2 text-xs text-[#777a80]">
                Manual revision {analysis.manualRevision.revision} saved {new Date(analysis.manualRevision.updatedAt).toLocaleString()} · {reviewStatus.replace('_', ' ')}{isLocked ? ' · locked' : ''}
              </div>
            )}
            {editing ? (
              <textarea
                value={draftSummary}
                onChange={(event) => setDraftSummary(event.target.value)}
                className="min-h-[140px] w-full rounded-xl border border-[#d7d7d2] px-3 py-2 text-sm leading-6 text-[#34373c] outline-none focus:border-[rgb(46,113,236)] focus:ring-2 focus:ring-[rgb(46,113,236)]/15"
              />
            ) : analysis.summary ? <div className="px-4">
              <div className="mb-2 flex items-center gap-2">
                <ConfidenceBadge confidence={analysis.summaryConfidence} edited={analysis.summaryManuallyEdited} />
                {analysis.summarySourceRange && (
                  <span className="text-xs text-[#777a80]">
                    {videoRangeText(analysis.summarySourceRange.start, analysis.summarySourceRange.end)}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-[#34373c]">{analysis.summary}</p>
              <EvidenceList evidence={analysis.summaryEvidenceSegments} />
            </div> : (
              <p className="text-sm leading-7 text-[#777a80]">No summary is available yet.</p>
            )}
                  {activeChapter && (
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        startVideoDrag(event, {
                          text: `[${videoRangeText(activeChapter.start, activeChapter.end)}] ${activeChapter.title}${activeChapter.summary ? `\n${activeChapter.summary}` : ''}`,
                          selectedRange: {
                            timestampStart: activeChapter.start,
                            timestampEnd: activeChapter.end,
                            sourceType: 'video_chapter',
                            textLength: `${activeChapter.title}${activeChapter.summary || ''}`.length
                          },
                          label: '视频章节'
                        });
                      }}
                      onClick={() => seekTo(activeChapter.start)}
                      className={`${notionRowClass} border-y border-[#e1e1de]`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[#777a80]">Current chapter</div>
                        <span className="text-xs font-semibold text-[rgb(46,113,236)]">{videoRangeText(activeChapter.start, activeChapter.end)}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-[#25272b]">{activeChapter.title}</div>
                      {activeChapter.summary && <p className="mt-1 text-sm leading-6 text-[#5f6368]">{activeChapter.summary}</p>}
                    </button>
                  )}

                  {nearbySlides.length > 0 && (
	                    <div className={notionListClass}>
                      {nearbySlides.map((slide) => {
                        const src = slide.imageUrl || (slide.imageFileId ? fileSystemApi.downloadUrl(workspaceId, slide.imageFileId) : '');
                        const active = slide.id === activeSlide?.id;
                        return (
	                          <button
                              key={slide.id}
                              type="button"
                              draggable
                              onDragStart={(event) => {
                                const transcriptText = (slide.transcriptSegmentIds || [])
                                  .map((segmentId) => analysis.transcript.find((segment) => segment.id === segmentId))
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((segment) => segment?.text)
                                  .filter(Boolean)
                                  .join(' ');
                                startVideoDrag(event, {
                                  text: `[${formatVideoTime(slide.timestamp)}] ${slide.title || 'Slide'}${slide.ocrText ? `\nOCR: ${slide.ocrText}` : ''}${transcriptText ? `\n${transcriptText}` : ''}`,
                                  selectedRange: {
                                    timestampStart: slide.timestamp,
                                    timestampEnd: slide.timestamp,
                                    sourceType: 'video_slide',
                                    chapterId: slide.chapterId,
                                    textLength: `${slide.title || ''}${slide.ocrText || ''}`.length
                                  },
                                  label: '视频幻灯片'
                                });
                              }}
                              onClick={() => seekTo(slide.timestamp)}
                              className={`${notionRowClass} grid grid-cols-[96px_1fr] gap-3 ${active ? notionActiveRowClass : ''}`}
                            >
                            {src ? <img src={src} alt={slide.title || 'Video frame'} className="aspect-video w-full bg-[#f6f6f4] object-cover" /> : <div className="flex aspect-video w-full items-center justify-center bg-[#f6f6f4] text-xs text-[#777a80]">Frame</div>}
                            <div className="min-w-0 text-xs">
                              <div className="font-semibold text-[rgb(46,113,236)]">{formatVideoTime(slide.timestamp)}</div>
                              {slide.title && <div className="mt-1 line-clamp-1 font-semibold text-[#25272b]">{slide.title}</div>}
                              {slide.ocrText && <div className="mt-1 line-clamp-2 text-[#5f6368]">{slide.ocrText}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

	                  <div className="border-y border-[#e1e1de] bg-[#f8f8f6]">
                    <div className="flex items-center justify-between border-b border-[#e1e1de] px-4 py-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#777a80]">Live transcript evidence</div>
                      <div className="text-xs font-semibold text-[rgb(46,113,236)]">{formatVideoTime(currentTime)}</div>
                    </div>
	                    <div className="max-h-[260px] overflow-auto">
                      {transcript.length ? transcript.map((segment) => {
                        const active = activeTranscript?.id === segment.id || highlightedTimestamp != null && highlightedTimestamp >= segment.start && highlightedTimestamp <= segment.end;
                        const selected = selectedRange?.segmentIds.includes(segment.id);
                        return (
                          <button
                            key={segment.id}
                            type="button"
                            draggable
                            onDragStart={(event) => {
                              startVideoDrag(event, {
                                text: `[${videoRangeText(segment.start, segment.end)}] ${segment.text}`,
                                selectedRange: {
                                  timestampStart: segment.start,
                                  timestampEnd: segment.end,
                                  segmentIds: [segment.id],
                                  sourceType: 'video_transcript',
                                  textLength: segment.text.length
                                },
                                label: '视频字幕'
                              });
                            }}
                            onClick={(event) => {
                              seekTo(segment.start);
                              selectTranscriptRange(segment);
                            }}
	                            className={`${notionRowClass} grid grid-cols-[88px_1fr] gap-3 ${
	                              active ? notionActiveRowClass : selected ? 'bg-[#f7f8ff]' : ''
	                            }`}
                          >
                            <span className="text-xs font-semibold text-[rgb(46,113,236)]">{videoRangeText(segment.start, segment.end)}</span>
                            <span className="text-sm leading-6 text-[#34373c]">{segment.text}</span>
                          </button>
                        );
                      }) : <div className="px-4 py-3 text-sm text-[#777a80]">No transcript available.</div>}
                    </div>
                  </div>

                  {activeKeyPoints.length > 0 && (
	                    <div className={notionListClass}>
                      {activeKeyPoints.map((point) => (
	                        <button
                            key={point.id}
                            type="button"
                            draggable
                            onDragStart={(event) => {
                              const ts = point.timestamps[0] ?? point.sourceRange?.start ?? 0;
                              startVideoDrag(event, {
                                text: `[${point.timestamps.map(formatVideoTime).join(', ')}] ${point.concept}\n${point.explanation}`,
                                selectedRange: {
                                  timestampStart: point.sourceRange?.start ?? ts,
                                  timestampEnd: point.sourceRange?.end ?? ts,
                                  sourceType: 'video_key_point',
                                  textLength: `${point.concept}${point.explanation}`.length
                                },
                                label: '视频关键点'
                              });
                            }}
                            onClick={() => seekTo(point.timestamps[0] ?? point.sourceRange?.start)}
                            className={notionRowClass}
                          >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-[#25272b]">{point.concept}</div>
                            <ConfidenceBadge confidence={point.confidence} edited={point.manuallyEdited} />
                          </div>
                          <div className="mt-1 text-xs leading-5 text-[#5f6368]">{point.explanation}</div>
                        </button>
                      ))}
                    </div>
                  )}

            {keyPoints.length > 0 && (
	              <div className={notionListClass}>
                {keyPoints.map((point, index) => (
                  <div
                    key={point.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(event) => {
                      const ts = point.timestamps[0] ?? point.sourceRange?.start ?? 0;
                      startVideoDrag(event, {
                        text: `[${point.timestamps.map(formatVideoTime).join(', ')}] ${point.concept}\n${point.explanation}`,
                        selectedRange: {
                          timestampStart: point.sourceRange?.start ?? ts,
                          timestampEnd: point.sourceRange?.end ?? ts,
                          sourceType: 'video_key_point',
                          textLength: `${point.concept}${point.explanation}`.length
                        },
                        label: '视频关键点'
                      });
                    }}
                    onClick={() => point.timestamps[0] != null && seekTo(point.timestamps[0])}
                    onKeyDown={(event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && point.timestamps[0] != null) {
                        event.preventDefault();
                        seekTo(point.timestamps[0]);
                      }
                    }}
	                    className={notionRowClass}
                  >
                    {editing ? (
                      <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          value={point.concept}
                          onChange={(event) => setDraftKeyPoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, concept: event.target.value } : item))}
                          className="w-full rounded-lg border border-[#d7d7d2] px-2 py-1.5 text-sm font-semibold outline-none focus:border-[rgb(46,113,236)]"
                        />
                        <textarea
                          value={point.explanation}
                          onChange={(event) => setDraftKeyPoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, explanation: event.target.value } : item))}
                          className="min-h-[72px] w-full rounded-lg border border-[#d7d7d2] px-2 py-1.5 text-xs leading-5 outline-none focus:border-[rgb(46,113,236)]"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-[#25272b]">{point.concept}</div>
                          <ConfidenceBadge confidence={point.confidence} edited={point.manuallyEdited} />
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[#5f6368]">{point.explanation}</div>
                      </>
                    )}
                    {point.timestamps.length > 0 && (
                      <div
                        draggable
                        onDragStart={(event) => {
                          const ts = point.timestamps[0] ?? point.sourceRange?.start ?? 0;
                          startVideoDrag(event, {
                            text: `[${point.timestamps.map(formatVideoTime).join(', ')}] ${point.concept}\n${point.explanation}`,
                            selectedRange: {
                              timestampStart: point.sourceRange?.start ?? ts,
                              timestampEnd: point.sourceRange?.end ?? ts,
                              sourceType: 'video_key_point',
                              textLength: `${point.concept}${point.explanation}`.length
                            },
                            label: '视频关键点'
                          });
                        }}
                        className="mt-2 text-xs font-medium text-[rgb(46,113,236)]"
                      >
                        {point.timestamps.map(formatVideoTime).join(', ')}
                      </div>
                    )}
                    {!editing && <EvidenceList evidence={point.evidenceSegments} />}
                  </div>
                ))}
              </div>
            )}
                </div>
              )}

              {activeTrack === 'chapters' && (
	          <div className={notionListClass}>
            {chapters.length ? chapters.map((chapter, index) => {
              const active = activeChapter?.id === chapter.id;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    const end = chapter.end ?? chapters[index + 1]?.start;
                    startVideoDrag(event, {
                      text: `[${videoRangeText(chapter.start, end)}] ${chapter.title}${chapter.summary ? `\n${chapter.summary}` : ''}`,
                      selectedRange: {
                        timestampStart: chapter.start,
                        timestampEnd: end,
                        sourceType: 'video_chapter',
                        textLength: `${chapter.title}${chapter.summary || ''}`.length
                      },
                      label: '视频章节'
                    });
                  }}
                  onClick={() => seekTo(chapter.start)}
	                  className={`${notionRowClass} ${
	                    active ? notionActiveRowClass : ''
	                  }`}
                >
                  <div className="text-xs font-semibold text-[rgb(46,113,236)]">{videoRangeText(chapter.start, chapter.end ?? chapters[index + 1]?.start)}</div>
                  <div className="mt-1 text-sm font-semibold text-[#25272b]">{chapter.title}</div>
                  {chapter.summary && <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#5f6368]">{chapter.summary}</p>}
                  {chapter.keyPoints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {chapter.keyPoints.slice(0, 4).map((point) => (
                        <span key={point} className="bg-[#f0f2fb] px-1.5 py-0.5 text-[11px] text-[#4b4f55]">{point}</span>
                      ))}
                    </div>
                  )}
                </button>
              );
            }) : <div className="px-3 py-4 text-sm text-[#777a80]">No chapters available.</div>}
          </div>
              )}

              {activeTrack === 'transcript' && (
	          <div className={notionListClass}>
            {analysis.transcript.length ? analysis.transcript.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                  startVideoDrag(event, {
                    text: `[${videoRangeText(segment.start, segment.end)}] ${segment.text}`,
                    selectedRange: {
                      timestampStart: segment.start,
                      timestampEnd: segment.end,
                      segmentIds: [segment.id],
                      sourceType: 'video_transcript',
                      textLength: segment.text.length
                    },
                    label: '视频字幕'
                  });
                  }}
                  onClick={(event) => {
                    seekTo(segment.start);
                    selectTranscriptRange(segment);
                  }}
	                  className={`${notionRowClass} grid grid-cols-[96px_1fr] gap-3 py-2 ${
	                  activeTranscript?.id === segment.id ? notionActiveRowClass : selectedRange?.segmentIds.includes(segment.id) ? 'bg-[#f7f8ff]' : ''
	                }`}
              >
                <span className="text-xs font-semibold text-[rgb(46,113,236)]">
                  {videoRangeText(segment.start, segment.end)}
                </span>
                <span className="text-sm leading-6 text-[#34373c]">{segment.text}</span>
              </button>
            )) : <div className="px-4 py-3 text-sm text-[#777a80]">No transcript available.</div>}
          </div>
              )}

              {activeTrack === 'slides' && (
	          <div className={notionListClass}>
            {analysis.slides.length ? analysis.slides.map((slide) => {
              const src = slide.imageUrl || (slide.imageFileId ? fileSystemApi.downloadUrl(workspaceId, slide.imageFileId) : '');
              const chapter = slide.chapterId ? analysis.chapters.find((item) => item.id === slide.chapterId) : undefined;
              const transcript = (slide.transcriptSegmentIds || [])
                .map((segmentId) => analysis.transcript.find((segment) => segment.id === segmentId))
                .filter(Boolean)
                .slice(0, 2);
              return (
                <button
                  key={slide.id}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    const transcriptText = transcript.map((segment) => segment?.text).filter(Boolean).join(' ');
                    startVideoDrag(event, {
                      text: `[${formatVideoTime(slide.timestamp)}] ${slide.title || 'Slide'}${slide.ocrText ? `\nOCR: ${slide.ocrText}` : ''}${transcriptText ? `\n${transcriptText}` : ''}`,
                      selectedRange: {
                        timestampStart: slide.timestamp,
                        timestampEnd: slide.timestamp,
                        sourceType: 'video_slide',
                        chapterId: slide.chapterId,
                        textLength: `${slide.title || ''}${slide.ocrText || ''}${transcriptText}`.length
                      },
                      label: '视频幻灯片'
                    });
                  }}
                  onClick={() => seekTo(slide.timestamp)}
	                  className={`${notionRowClass} grid grid-cols-[104px_1fr] gap-3 py-2 ${activeSlide?.id === slide.id ? notionActiveRowClass : ''}`}
                >
                  {src ? <img src={src} alt={slide.title || 'Video frame'} className="aspect-video w-full bg-[#f6f6f4] object-cover" /> : (
                    <div className="flex aspect-video w-full items-center justify-center bg-[#f6f6f4] text-xs text-[#777a80]">Frame</div>
                  )}
                  <div className="min-w-0 space-y-1 text-xs text-[#4b4f55]">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="text-[rgb(46,113,236)]">{formatVideoTime(slide.timestamp)}</span>
                      {slide.duplicateOf && <span className="rounded-full bg-[#f6f6f4] px-2 py-0.5 text-[11px] text-[#777a80]">重复帧</span>}
                    </div>
                    {slide.title && <div className="font-semibold text-[#25272b] line-clamp-1">{slide.title}</div>}
                    {chapter && <div className="line-clamp-1 text-[#777a80]">章节：{chapter.title}</div>}
                    {slide.ocrText && <div className="line-clamp-2 text-[#5f6368]">OCR：{slide.ocrText}</div>}
                    {transcript.length > 0 && (
                      <div className="line-clamp-2 text-[#777a80]">
                        讲解：{transcript.map((segment) => segment?.text).filter(Boolean).join(' ')}
                      </div>
                    )}
                  </div>
                </button>
              );
            }) : <div className="px-4 py-3 text-sm text-[#777a80]">No slide frames available yet. Uploaded videos can use ffmpeg-based frame extraction.</div>}
          </div>
              )}

              {(activeTrack === 'review' || activeTrack === 'learning') && (
                <div className="space-y-4">
                  <div className="border-y border-[#e1e1de] px-4 py-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#777a80]">Review controls</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex h-8 overflow-hidden border border-[#eeeeeb] bg-white text-xs font-medium">
                        {(['draft', 'in_review', 'reviewed', 'approved'] as VideoReviewStatus[]).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => updateReview({ status })}
                            disabled={savingEdits}
                            className={`px-2.5 capitalize transition ${reviewStatus === status ? 'bg-[#f0f2fb] text-[#202124]' : 'text-[#777a80] hover:bg-[#f6f6f4]'}`}
                          >
                            {status.replace('_', ' ')}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateReview({ locked: !isLocked, status: reviewStatus })}
                        disabled={savingEdits}
                        className={`inline-flex h-8 items-center gap-1.5 border px-3 text-xs font-medium transition ${
                          isLocked ? 'border-[#b8dfad] bg-[#f3faf1] text-[#2f6c2f]' : 'border-[#eeeeeb] bg-white text-[#5f6368] hover:bg-[#f6f6f4]'
                        }`}
                      >
                        {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                        {isLocked ? 'Locked' : 'Lock'}
                      </button>
                      <label className="inline-flex h-8 items-center gap-2 border border-[#eeeeeb] bg-white px-2 text-xs font-medium text-[#5f6368]">
                        <input
                          type="checkbox"
                          checked={preserveManualEdits}
                          onChange={(event) => setPreserveManualEdits(event.target.checked)}
                          className="h-3.5 w-3.5"
                        />
                        Regenerate keeps manual edits
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#e1e1de] px-4 py-3">
                    <div className="text-sm font-semibold text-[#25272b]">Manual revision vs AI original</div>
                    <button type="button" onClick={() => setCompareOriginal((value) => !value)} className="border border-[#eeeeeb] bg-white px-3 py-1.5 text-xs font-medium text-[#5f6368]">
                      {compareOriginal ? 'Hide compare' : 'Compare'}
                    </button>
                  </div>
                  {editing && (
                    <div className="divide-y divide-[#e1e1de] border-y border-[#e1e1de]">
                      {draftChapters.map((chapter, index) => (
                        <div key={chapter.id} className="px-4 py-3">
                          <div className="mb-2 text-xs font-semibold text-[rgb(46,113,236)]">{formatVideoTime(chapter.start)}</div>
                          <input value={chapter.title} onChange={(event) => setDraftChapters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} className="w-full rounded-lg border border-[#d7d7d2] px-2 py-1.5 text-sm font-semibold outline-none focus:border-[rgb(46,113,236)]" />
                          <textarea value={chapter.summary} onChange={(event) => setDraftChapters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, summary: event.target.value } : item))} className="mt-2 min-h-[84px] w-full rounded-lg border border-[#d7d7d2] px-2 py-1.5 text-sm leading-6 outline-none focus:border-[rgb(46,113,236)]" />
                          <input value={chapter.keyPoints.join('；')} onChange={(event) => setDraftChapters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, keyPoints: event.target.value.split(/[;；]/).map((value) => value.trim()).filter(Boolean) } : item))} className="mt-2 w-full rounded-lg border border-[#d7d7d2] px-2 py-1.5 text-xs outline-none focus:border-[rgb(46,113,236)]" />
                        </div>
                      ))}
                    </div>
                  )}
                  {compareOriginal && analysis.original ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="border-y border-[#e1e1de] px-4 py-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#777a80]">AI original</div>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-[#5f6368]">{analysis.original.summary || 'No original summary snapshot.'}</p>
                      </div>
                      <div className="border-y border-[#e1e1de] px-4 py-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#777a80]">Current reviewed version</div>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-[#34373c]">{analysis.summary || 'No current summary.'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="border-y border-[#e1e1de] px-4 py-3 text-sm leading-6 text-[#5f6368]">
                      {analysis.original ? 'Open compare to review the first AI version against the current human-edited version.' : 'The original AI snapshot will be preserved when the first manual revision is saved.'}
                    </div>
                  )}
                </div>
              )}
            </section>
        )}
      </div>
    </div>
  );
}

const PlainTextPreview = ({
  content,
  emptyMessage = 'Nothing to preview yet.',
  onViewportChange,
  fileId
}: {
  content: string;
  emptyMessage?: string;
  onViewportChange?: (patch: Record<string, any>) => void;
  fileId?: string;
}) => {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [highlightedLines, setHighlightedLines] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent<CitationJumpDetail>).detail;
      if (!fileId || !detail?.fileId || detail.fileId !== fileId) return;
      const start = Number(detail.locator?.lineStart || detail.locator?.startLine || 1);
      const end = Number(detail.locator?.lineEnd || detail.locator?.endLine || start);
      const element = preRef.current;
      if (!element) return;
      element.scrollTo({ top: Math.max(0, (start - 3) * 28), behavior: 'smooth' });
      setHighlightedLines({ start, end });
      window.setTimeout(() => setHighlightedLines(null), 2600);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [fileId]);

  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--wb-text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  const reportViewport = (element: HTMLPreElement) => {
    if (!onViewportChange) return;
    const lineHeight = 28;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const start = Math.max(1, Math.floor(element.scrollTop / lineHeight) + 1);
    const end = Math.max(start, Math.ceil((element.scrollTop + element.clientHeight) / lineHeight));
    onViewportChange({
      visibleLineRange: { start, end },
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      approxChunkIndex: Math.max(0, start - 1),
      selectedText: window.getSelection()?.toString().trim() || ''
    });
  };

  return (
    <pre
      ref={preRef}
      className="h-full overflow-auto whitespace-pre-wrap bg-white p-6 font-mono text-sm leading-7 text-[#25272b]"
      onScroll={(event) => reportViewport(event.currentTarget)}
      onMouseEnter={(event) => reportViewport(event.currentTarget)}
      onMouseUp={(event) => reportViewport(event.currentTarget)}
    >
      {highlightedLines ? (
        content.split('\n').map((line, index) => {
          const lineNumber = index + 1;
          const highlighted = lineNumber >= highlightedLines.start && lineNumber <= highlightedLines.end;
          return (
            <span
              key={index}
              className={highlighted ? 'block rounded bg-[#f5d36b]/35 ring-1 ring-[#d3a900]/30' : 'block'}
            >
              {line || ' '}
            </span>
          );
        })
      ) : (
        content
      )}
    </pre>
  );
};

function TextEditorShell({
  toolbar,
  children
}: {
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
};

const confidenceLabel = (confidence?: string) => {
  if (confidence === 'high') return '强依据';
  if (confidence === 'medium') return '辅助依据';
  return '低置信';
};

const confidenceClass = (confidence?: string) => {
  if (confidence === 'high') return 'border-[#b8dfad] bg-[#f3faf1] text-[#2f6c2f]';
  if (confidence === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

const timelineStageMeta: Record<string, { label: string; hint: string }> = {
  ContextService: { label: 'Read the workbench context', hint: 'Collected the active file, visible panel, selection, and attachments.' },
  ProfileAgent: { label: 'Checked learner context', hint: 'Loaded recent focus and lightweight learning preferences.' },
  RetrievalAgent: { label: 'Searched relevant material', hint: 'Pulled matching notes, resources, and recent conversation context.' },
  ExplainAgent: { label: 'Drafted the answer', hint: 'Generated the response from the current question and selected context.' },
  QualityAgent: { label: 'Checked answer quality', hint: 'Reviewed grounding, relevance, and risk before the final reply.' },
  'ProfileAgent.update': { label: 'Updated learner context', hint: 'Refreshed recent focus signals for future answers.' },
  'LearnerStateAnalyzer.chat': { label: 'Refreshed learning signals', hint: 'Extracted low-confidence study signals for the learner state.' },
  'ConversationHistory.saveTurn': { label: 'Saved the turn', hint: 'Stored the conversation for future workbench chats.' }
};

const timelineDisplayLabel = (item: AgentTimelineItem) => timelineStageMeta[item.agentName]?.label || item.agentName;
const timelineDisplayHint = (item: AgentTimelineItem) => timelineStageMeta[item.agentName]?.hint || item.inputSummary;

const formatThinkingDuration = (timeline: AgentTimelineItem[]) => {
  const durationMs = timeline.reduce((total, item) => total + Math.max(0, item.durationMs || 0), 0);
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
};

function ThinkingTrace({
  timeline,
  isActive,
  open,
  onToggle
}: {
  timeline: AgentTimelineItem[];
  isActive: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (!isActive && timeline.length === 0) return null;
  const activeStep = timeline.length ? timelineDisplayLabel(timeline[timeline.length - 1]) : 'Preparing context';
  const title = isActive ? activeStep : `Thought for ${formatThinkingDuration(timeline)}`;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-2 rounded-full px-1 py-1 text-sm font-medium text-[#6b7280] hover:text-[#25272b]"
        title="Show thinking trace"
      >
        {isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
        <span>{title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="mt-2 max-w-xl rounded-2xl border border-[#e5e7eb] bg-[#fbfbfa] px-3 py-2">
          <div className="space-y-2">
            {timeline.length === 0 ? (
              <div className="flex items-start gap-2 text-xs leading-5 text-[#6b7280]">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#a1a1aa]" />
                Preparing context and choosing the next step.
              </div>
            ) : (
              timeline.map((item, index) => (
                <div key={`${item.agentName}-${item.durationMs}-${index}`} className="flex items-start gap-2 text-xs leading-5 text-[#5f6368]">
                  <span
                    className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      item.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-[#d7e8d2] bg-[#f3faf1] text-[#16833a]'
                    }`}
                  >
                    {item.status === 'failed' ? <X className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-[#34373c]">{timelineDisplayLabel(item)}</div>
                    <div className="text-[#7a7f87]">{timelineDisplayHint(item)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageAttachmentStrip({ attachments }: { attachments?: AiChatAttachment[] }) {
  if (!attachments?.length) return null;

  return (
    <div className="mt-3 grid max-w-[420px] gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex min-w-0 items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-3 py-2 text-left shadow-sm"
          title={`${attachment.name} · ${attachment.mimeType} · ${formatBytes(attachment.size)}`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f4f4f5] text-[#6b7280] ring-1 ring-inset ring-black/5">
            {attachment.kind === 'image' && attachment.dataUrl ? (
              <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
            ) : attachment.kind === 'image' ? (
              <Image className="h-4 w-4" />
            ) : (
              <File className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-[#25272b]">{attachment.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#7a7f87]">
              <span className="truncate">{attachment.mimeType}</span>
              <span>·</span>
              <span>{formatBytes(attachment.size)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const sourceTypeLabel = (sourceType?: string) => {
  if (sourceType === 'selection') return '选区';
  if (sourceType === 'viewport') return '可见区域';
  if (sourceType === 'active_file') return '当前文件';
  if (sourceType === 'pinned') return '固定来源';
  return '检索片段';
};

type CitationLocator = Record<string, any>;

interface CitationJumpDetail {
  fileId: string;
  locator?: CitationLocator;
  sourceId?: string;
  preview?: string;
}

type CitationUiSource = {
  sourceId?: string;
  fileId: string;
  fileName: string;
  label: string;
  locator?: Record<string, any>;
  confidence?: 'high' | 'medium' | 'low';
  preview?: string;
  score?: number;
  retrievalReason?: string;
  matchedTerms?: string[];
  scoreBreakdown?: Record<string, number>;
  supportSnippets?: Array<{ text: string; locator?: Record<string, any>; score?: number }>;
  citationQuality?: {
    supportCount?: number;
    sourceCount?: number;
    grounded?: boolean;
  };
};

const formatMessageTime = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const nowDate = new Date();
  const isToday = date.toDateString() === nowDate.toDateString();
  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  const prefix = isToday ? 'Today' : date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${prefix} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

function SourceDetailModal({
  source,
  onClose,
  onJump,
  onPin
}: {
  source: CitationUiSource | null;
  onClose: () => void;
  onJump: (source: CitationUiSource) => void;
  onPin?: (source: CitationUiSource) => void;
}) {
  if (!source) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-6">
      <div className="flex max-h-[84vh] w-[min(860px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] border border-[#eeeeeb] bg-white shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#eeeeeb] px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-[#f1f1ef] px-2.5 py-1 text-xs font-semibold text-[#5f6368]">
                Source
              </span>
              <span className="rounded-lg bg-[#f1f1ef] px-2.5 py-1 text-xs font-semibold text-[#5f6368]">
                {confidenceLabel(source.confidence)}
              </span>
              {typeof source.score === 'number' && (
                <span className="rounded-full border border-[#eeeeeb] bg-[#fbfbfa] px-2.5 py-1 font-mono text-xs text-[#777a80]">
                  score {source.score.toFixed(2)}
                </span>
              )}
            </div>
            <h3 className="mt-3 truncate text-2xl font-semibold text-[#202124]">{source.label || source.fileName}</h3>
            <div className="mt-1 truncate text-sm text-[#777a80]">{source.fileName}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[#777a80] hover:bg-[#f6f6f4] hover:text-[#202124]"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {source.retrievalReason && (
            <div className="mb-4 rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-4 py-3 text-sm leading-6 text-[#5f6368]">
              {source.retrievalReason}
            </div>
          )}
          {source.citationQuality && (
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[#96999d]">Grounded</div>
                <div className="mt-1 text-sm font-semibold text-[#34373c]">
                  {source.citationQuality.grounded ? 'Yes' : 'Weak'}
                </div>
              </div>
              <div className="rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[#96999d]">Support</div>
                <div className="mt-1 font-mono text-sm font-semibold text-[#34373c]">
                  {source.citationQuality.supportCount ?? 1}
                </div>
              </div>
              <div className="rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[#96999d]">Sources</div>
                <div className="mt-1 font-mono text-sm font-semibold text-[#34373c]">
                  {source.citationQuality.sourceCount ?? 1}
                </div>
              </div>
            </div>
          )}
          {source.matchedTerms?.length ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {source.matchedTerms.slice(0, 12).map((term) => (
                <span key={`${source.sourceId}:${term}`} className="rounded-full bg-[#f1f1ef] px-2 py-1 font-mono text-[11px] text-[#777a80]">
                  {term}
                </span>
              ))}
            </div>
          ) : null}
          {source.scoreBreakdown && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(source.scoreBreakdown)
                .filter(([, value]) => typeof value === 'number' && Math.abs(value) > 0)
                .map(([key, value]) => (
                  <div key={`${source.sourceId}:${key}`} className="rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[#96999d]">{key}</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-[#34373c]">{Number(value).toFixed(2)}</div>
                  </div>
                ))}
            </div>
          )}
          <div className="rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#96999d]">Content</div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[#34373c]">
              {source.preview || '暂无可预览的来源内容。'}
            </pre>
          </div>
          {source.supportSnippets?.length ? (
            <div className="mt-4 rounded-2xl border border-[#eeeeeb] bg-white p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#96999d]">
                Supporting Evidence
              </div>
              <div className="space-y-3">
                {source.supportSnippets.slice(0, 4).map((snippet, index) => (
                  <button
                    key={`${source.sourceId}:support:${index}`}
                    onClick={() =>
                      onJump({
                        ...source,
                        locator: snippet.locator || source.locator,
                        preview: snippet.text
                      })
                    }
                    className="block w-full rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-3 text-left hover:bg-[#f6f6f4]"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#96999d]">
                      <span>Evidence {index + 1}</span>
                      {typeof snippet.score === 'number' && <span>{snippet.score.toFixed(2)}</span>}
                    </div>
                    <div className="line-clamp-3 text-sm leading-6 text-[#34373c]">{snippet.text}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#eeeeeb] px-6 py-4">
          {onPin && (
            <button
              onClick={() => onPin(source)}
              className="rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-medium text-[#5f6368] hover:bg-[#f6f6f4]"
            >
              固定来源
            </button>
          )}
          <button
            onClick={() => onJump(source)}
            className="rounded-full bg-[#202124] px-4 py-2 text-sm font-medium text-white hover:bg-[#34373c]"
          >
            跳转到原文
          </button>
        </div>
      </div>
    </div>
  );
}

function SourcesCapsule({
  sources,
  onJump,
  onOpenSource,
  compact = false
}: {
  sources: CitationUiSource[];
  onJump: (source: CitationUiSource) => void;
  onOpenSource: (source: CitationUiSource) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  const first = sources[0];
  const label = compact
    ? `${first.fileName || first.label}${sources.length > 1 ? ` +${sources.length - 1}` : ''}`
    : `Retrieved ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`;

  return (
    <div className="relative inline-flex max-w-full flex-col items-start">
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(420px,calc(100vw-3rem))] rounded-2xl border border-[#e7ece7] bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.10)]">
          {sources.map((source, index) => (
            <button
              key={`${source.fileId}:${source.label}:${source.sourceId || index}`}
              onClick={() => onOpenSource(source)}
              className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-[#34373c] hover:bg-[#f6f8f5]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{source.fileName || source.label}</span>
                <span className="block truncate text-[11px] text-[#7a7f87]">{source.label}</span>
              </span>
              {typeof source.score === 'number' && (
                <span className="rounded-full border border-[#d7e8d2] bg-[#f3faf1] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#2f6c2f]">
                  {Math.round(source.score * 100) / 100}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`group inline-flex max-w-full items-center gap-2 rounded-full border border-[#e5e7eb] bg-[#fbfbfa] font-medium text-[#5f6368] transition-colors hover:border-[#d7e8d2] hover:bg-[#f7fbf6] hover:text-[#25272b] ${
          compact ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2 text-sm'
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {compact && open && (
        <button
          type="button"
          onClick={() => onJump(first)}
          className="absolute left-0 top-full mt-1 text-[11px] font-medium text-[#6b7280] hover:text-[#25272b]"
        >
          跳转第一个来源
        </button>
      )}
    </div>
  );
}

const isTextLikeFile = (file: File) =>
  file.type.startsWith('text/') ||
  /\.(md|markdown|txt|csv|tsv|json|jsonl|xml|html|css|js|jsx|ts|tsx|py|java|cpp|c|h|hpp|sql|yaml|yml)$/i.test(
    file.name
  );

const MAX_INLINE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const inferChatAttachmentKind = (file: File): AiChatAttachment['kind'] => {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (isTextLikeFile(file)) return 'text';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (/\.(doc|docx|ppt|pptx|xls|xlsx)$/i.test(file.name)) return 'document';
  return 'file';
};

const readFileAsText = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').slice(0, 12000));
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

const base64FromDataUrl = (dataUrl: string) => dataUrl.match(/^data:[^;]+;base64,(.+)$/)?.[1] || '';

const stripAttachmentPayload = (attachment: AiChatAttachment): AiChatAttachment => {
  const { dataUrl, base64Data, ...rest } = attachment;
  return rest;
};

const fileFromChatAttachment = async (attachment: AiChatAttachment): Promise<File | null> => {
  if (attachment.textContent) {
    return new window.File([attachment.textContent], attachment.name, { type: attachment.mimeType || 'text/plain' });
  }
  if (!attachment.dataUrl) return null;
  const response = await fetch(attachment.dataUrl);
  const blob = await response.blob();
  return new window.File([blob], attachment.name, { type: attachment.mimeType || blob.type || 'application/octet-stream' });
};

const normalizePdfHighlightRects = (
  locator: Record<string, any> | undefined,
  page: number,
  scale: number
): Array<{ left: number; top: number; width: number; height: number }> => {
  const rawRects = Array.isArray(locator?.rects) && locator.rects.length
    ? locator.rects
    : locator?.bbox
      ? [locator.bbox]
      : [];

  return rawRects
    .filter((rect: any) => Number(rect?.page || page) === page)
    .slice(0, 24)
    .map((rect: any) => ({
      left: Math.round(Number(rect.left || 0) * scale),
      top: Math.round(Number(rect.top || 0) * scale),
      width: Math.max(2, Math.round(Number(rect.width || 0) * scale)),
      height: Math.max(2, Math.round(Number(rect.height || 0) * scale))
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
};

type PdfSearchMatch = {
  page: number;
  index: number;
  preview: string;
};

const normalizePdfSearchText = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

function PdfJsPage({
  pdfDocument,
  pageNumber,
  scale,
  highlighted,
  highlightRects = []
}: {
  pdfDocument: any;
  pageNumber: number;
  scale: number;
  highlighted?: boolean;
  highlightRects?: Array<{ left: number; top: number; width: number; height: number }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;
    let textLayer: any = null;

    void pdfDocument.getPage(pageNumber).then(async (page: any) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const textLayerElement = textLayerRef.current;
      if (!canvas || !textLayerElement) return;

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise;

      if (cancelled) return;
      textLayerElement.innerHTML = '';
      textLayerElement.style.setProperty('--scale-factor', String(scale));
      textLayer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: textLayerElement,
        viewport
      });
      await textLayer.render();
    });

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
        textLayer?.cancel?.();
      } catch {
        // Ignore pdf.js cancellation races during fast tab switches.
      }
    };
  }, [pageNumber, pdfDocument, scale]);

  return (
    <section
      data-doc-unit="true"
      data-pdf-page="true"
      data-page={pageNumber}
      data-chunk-index={pageNumber - 1}
      className={`mx-auto mb-7 overflow-hidden rounded-[3px] border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.06)] transition-all duration-300 ${
        highlighted ? 'border-[rgb(46,113,236)] ring-4 ring-[rgba(46,113,236,0.18)]' : 'border-[#d9d9d5]'
      }`}
      style={size ? { width: size.width, minHeight: size.height } : undefined}
    >
      <div className="relative bg-white" style={size ? { width: size.width, height: size.height } : undefined}>
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div ref={textLayerRef} className="textLayer absolute inset-0" />
        {highlightRects.map((rect, index) => (
          <div
            key={`${pageNumber}-rect-${index}`}
            className="pointer-events-none absolute rounded-[2px] bg-[#f5d36b]/45 ring-1 ring-[#d3a900]/50"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            }}
          />
        ))}
      </div>
    </section>
  );
}

function PdfThumbnail({
  pdfDocument,
  pageNumber,
  active,
  onClick
}: {
  pdfDocument: any;
  pageNumber: number;
  active?: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;

    void pdfDocument.getPage(pageNumber).then(async (page: any) => {
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = 92 / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise;
    });

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
      } catch {
        // Ignore pdf.js cancellation races while the thumbnail rail changes.
      }
    };
  }, [pageNumber, pdfDocument]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full flex-col items-center gap-1.5 rounded-xl p-2.5 text-xs transition ${
        active
          ? 'bg-[rgb(46,113,236)] text-white shadow-[0_8px_18px_rgba(46,113,236,0.24)]'
          : 'text-[#777a80] hover:bg-white'
      }`}
      title={`Page ${pageNumber}`}
    >
      <div
        className={`overflow-hidden rounded-md border bg-white shadow-sm ${
          active ? 'border-white/80' : 'border-[#d2d2d7] group-hover:border-[#b8b8bd]'
        }`}
        style={size ? { width: size.width, height: size.height } : { width: 92, height: 120 }}
      >
        <canvas ref={canvasRef} />
      </div>
      <span className="leading-none">{pageNumber}</span>
    </button>
  );
}

function PdfJsReader({
  sourceUrl,
  fileId,
  resourceName,
  onViewportChange
}: {
  sourceUrl: string;
  fileId: string;
  resourceName: string;
  onViewportChange: (patch: Record<string, any>) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [pageNumbers, setPageNumbers] = useState<number[]>([]);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'continuous' | 'single'>('continuous');
  const [zoomMode, setZoomMode] = useState<'fit-width' | 'fit-page' | 'custom'>('fit-width');
  const [customScale, setCustomScale] = useState(1.25);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState<Array<{ page: number; text: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    text: string;
    page?: number;
    selectedRange?: Record<string, any>;
  } | null>(null);
  const [jumpHighlight, setJumpHighlight] = useState<{
    page: number;
    locator?: Record<string, any>;
  } | null>(null);
  const thumbnailRailWidth = showThumbnails ? 132 : 0;
  const availableWidth = Math.max(280, viewportSize.width - thumbnailRailWidth - 56);
  const availableHeight = Math.max(280, viewportSize.height - 44);
  const fitWidthScale = pageSize ? Math.min(3, Math.max(0.35, availableWidth / pageSize.width)) : 1.25;
  const fitPageScale = pageSize
    ? Math.min(3, Math.max(0.25, Math.min(availableWidth / pageSize.width, availableHeight / pageSize.height)))
    : 1.1;
  const scale = zoomMode === 'fit-width' ? fitWidthScale : zoomMode === 'fit-page' ? fitPageScale : customScale;
  const displayedPages = viewMode === 'single' ? [currentPage] : pageNumbers;
  const scalePercent = Math.round(scale * 100);
  const searchMatches = useMemo<PdfSearchMatch[]>(() => {
    const needle = normalizePdfSearchText(searchQuery);
    if (!needle) return [];

    return searchIndex.flatMap((pageEntry) => {
      const pageText = normalizePdfSearchText(pageEntry.text);
      const matches: PdfSearchMatch[] = [];
      let fromIndex = 0;
      while (matches.length < 80) {
        const matchIndex = pageText.indexOf(needle, fromIndex);
        if (matchIndex < 0) break;
        const previewStart = Math.max(0, matchIndex - 18);
        const previewEnd = Math.min(pageText.length, matchIndex + needle.length + 28);
        matches.push({
          page: pageEntry.page,
          index: matchIndex,
          preview: pageText.slice(previewStart, previewEnd)
        });
        fromIndex = matchIndex + Math.max(needle.length, 1);
      }
      return matches;
    });
  }, [searchIndex, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDocument(null);
    setPageNumbers([]);
    setPageSize(null);
    setCurrentPage(1);
    setSearchIndex([]);
    setSearchQuery('');
    setActiveSearchMatch(0);

    const loadingTask = pdfjsLib.getDocument({
      url: sourceUrl,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS
    });
    void loadingTask.promise
      .then((pdf: any) => {
        if (cancelled) {
          pdf.destroy();
          return;
        }
        setPdfDocument(pdf);
        setPageNumbers(Array.from({ length: pdf.numPages }, (_, index) => index + 1));
        void pdf.getPage(1).then((page: any) => {
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1 });
          setPageSize({ width: viewport.width, height: viewport.height });
        });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load PDF.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (!pdfDocument || !pageNumbers.length) return;
    let cancelled = false;
    setSearching(true);

    const buildSearchIndex = async () => {
      const pages = await Promise.all(
        pageNumbers.map(async (pageNumber) => {
          const page = await pdfDocument.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const text = textContent.items
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ');
          return { page: pageNumber, text };
        })
      );
      if (!cancelled) setSearchIndex(pages);
    };

    void buildSearchIndex()
      .catch(() => {
        if (!cancelled) setSearchIndex([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfDocument, pageNumbers]);

  useEffect(() => {
    setActiveSearchMatch(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!viewMenuRef.current?.contains(event.target as Node)) {
        setViewMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [viewMenuOpen]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateSize = () => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight
      });
    };
    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const scrollToPage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const safePage = Math.min(Math.max(1, page), Math.max(1, pageNumbers.length));
    setCurrentPage(safePage);
    if (viewMode === 'single') return;
    const pageElement = containerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="true"][data-page="${safePage}"]`);
    pageElement?.scrollIntoView({ behavior, block: 'start' });
  };

  const activateSearchMatch = (matchIndex: number) => {
    if (!searchMatches.length) return;
    const safeIndex = ((matchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setActiveSearchMatch(safeIndex);
    const match = searchMatches[safeIndex];
    scrollToPage(match.page);
    setJumpHighlight({ page: match.page });
    window.setTimeout(() => {
      setJumpHighlight((current) => (current?.page === match.page ? null : current));
    }, 1600);
  };

  const activeSearchPreview = searchMatches[activeSearchMatch]?.preview;

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { fileId?: string; locator?: { page?: number; pageStart?: number; primaryPage?: number } }
        | undefined;
      if (!detail?.fileId || detail.fileId !== fileId) return;
      const page = detail.locator?.page || detail.locator?.pageStart || detail.locator?.primaryPage;
      if (!page) return;
      scrollToPage(page);
      setJumpHighlight({ page, locator: detail.locator as Record<string, any> });
      window.setTimeout(() => setJumpHighlight((current) => (current?.page === page ? null : current)), 2400);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [fileId, pageNumbers.length, viewMode]);

  const readSelectionLocator = (element: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const rawText = selection.toString();
    const selectedText = rawText.trim();
    if (!selectedText) return null;

    const range = selection.getRangeAt(0);
    const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rangeRects.length) return null;

    const pages = Array.from(element.querySelectorAll<HTMLElement>('[data-pdf-page="true"]'));
    const rects: Array<{ page: number; left: number; top: number; width: number; height: number }> = [];
    let selectedPage: number | undefined;
    let pageElement: HTMLElement | null = null;

    pages.forEach((pageNode) => {
      const page = Number(pageNode.dataset.page);
      if (!Number.isFinite(page)) return;
      const pageRect = pageNode.getBoundingClientRect();
      rangeRects.forEach((rect) => {
        const intersects =
          rect.right > pageRect.left &&
          rect.left < pageRect.right &&
          rect.bottom > pageRect.top &&
          rect.top < pageRect.bottom;
        if (!intersects) return;
        if (!selectedPage) {
          selectedPage = page;
          pageElement = pageNode;
        }
        if (rects.length < 12) {
          rects.push({
            page,
            left: Math.round(rect.left - pageRect.left),
            top: Math.round(rect.top - pageRect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          });
        }
      });
    });

    if (!selectedPage || !pageElement) return null;

    const pageText = (pageElement as HTMLElement).innerText || (pageElement as HTMLElement).textContent || '';
    const normalizedSelection = selectedText.replace(/\s+/g, ' ');
    const normalizedPage = pageText.replace(/\s+/g, ' ');
    const normalizedIndex = normalizedPage.indexOf(normalizedSelection);
    const firstRect = rangeRects[0];

    return {
      selectedText,
      selectedPage,
      selectedRange: {
        page: selectedPage,
        pageStart: Math.min(...rects.map((rect) => rect.page)),
        pageEnd: Math.max(...rects.map((rect) => rect.page)),
        charStart: normalizedIndex >= 0 ? normalizedIndex : undefined,
        charEnd: normalizedIndex >= 0 ? normalizedIndex + normalizedSelection.length : undefined,
        textLength: selectedText.length,
        rects
      },
      menu: {
        x: Math.round(firstRect.left + firstRect.width / 2),
        y: Math.max(12, Math.round(firstRect.top - 48))
      }
    };
  };

  const reportViewport = () => {
    const element = containerRef.current;
    if (!element) return;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const units = Array.from(element.querySelectorAll<HTMLElement>('[data-pdf-page="true"]'));
    const containerRect = element.getBoundingClientRect();
    const visible = units
      .map((unit) => {
        const rect = unit.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, containerRect.top);
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
        return {
          unit,
          visibleHeight: Math.max(0, visibleBottom - visibleTop)
        };
      })
      .filter((item) => item.visibleHeight > 0)
      .sort((left, right) => right.visibleHeight - left.visibleHeight);
    const visiblePages = visible
      .map((item) => Number(item.unit.dataset.page))
      .filter((page) => Number.isFinite(page) && page > 0);
    const primaryPage = visiblePages[0] || 1;
    const selectionLocator = readSelectionLocator(element);
    const selectedText = selectionLocator?.selectedText || '';
    const selectedPage = selectionLocator?.selectedPage;
    setCurrentPage(selectedPage || primaryPage);

    if (selectionLocator) {
      setSelectionMenu({
        x: selectionLocator.menu.x,
        y: selectionLocator.menu.y,
        text: selectionLocator.selectedText,
        page: selectedPage,
        selectedRange: selectionLocator.selectedRange
      });
    } else {
      setSelectionMenu(null);
    }

    onViewportChange({
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      visiblePages: [...new Set(visiblePages)].sort((left, right) => left - right),
      primaryPage,
      approxChunkIndex: Math.max(0, primaryPage - 1),
      selectedText,
      selectedRange: selectionLocator?.selectedRange || null,
      ...(selectedText && selectedPage
        ? {
            visiblePages: [selectedPage],
            primaryPage: selectedPage,
            approxChunkIndex: Math.max(0, selectedPage - 1),
            selectedRange: selectionLocator?.selectedRange || null
          }
        : {})
    });
  };

  const applySelectionPrompt = (prompt: string) => {
    if (!selectionMenu) return;
    window.dispatchEvent(
      new CustomEvent('workbench:pdf-selection-action', {
        detail: {
          fileId,
          fileName: resourceName,
          page: selectionMenu.page,
          selectedRange: selectionMenu.selectedRange,
          text: selectionMenu.text,
          prompt
        }
      })
    );
  };

  return (
    <div ref={viewportRef} className="relative flex h-full min-h-0 flex-col bg-white">
      {selectionMenu && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-full border border-[#d9d9d5] bg-[#202124] px-2 py-1 text-xs font-medium text-white shadow-[0_12px_35px_rgba(0,0,0,0.22)]"
          style={{ left: selectionMenu.x, top: selectionMenu.y, transform: 'translateX(-50%)' }}
        >
          <button
            className="rounded-full px-2 py-1 hover:bg-white/15"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applySelectionPrompt('请解释我选中的这段 PDF 内容')}
          >
            解释
          </button>
          <button
            className="rounded-full px-2 py-1 hover:bg-white/15"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applySelectionPrompt('请总结我选中的这段 PDF 内容')}
          >
            总结
          </button>
          <button
            className="rounded-full px-2 py-1 hover:bg-white/15"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applySelectionPrompt('请基于我选中的 PDF 内容回答：')}
          >
            提问
          </button>
          <button
            className="rounded-full px-2 py-1 hover:bg-white/15"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applySelectionPrompt('__lock_pdf_selection__')}
          >
            锁定
          </button>
        </div>
      )}
      <div className="relative z-30 flex min-h-0 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#eeeeeb] bg-white px-4 py-2 text-xs text-[#5f6368]">
        <div className="flex min-w-0 items-center gap-3">
          <div ref={viewMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setViewMenuOpen((value) => !value)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[#e5e5e1] bg-white px-3 font-medium text-[#34373c] shadow-sm transition hover:bg-[#fbfbfa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(46,113,236,0.35)]"
              title="View options"
            >
              <PanelLeft className="h-4 w-4" />
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {viewMenuOpen && (
              <div className="absolute left-0 top-11 z-[200] w-56 overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white p-2 text-[13px] text-[#25272b] shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
                {[
                  { label: showThumbnails ? 'Hide Sidebar' : 'Show Sidebar', active: showThumbnails, onClick: () => setShowThumbnails((value) => !value) },
                  { label: 'Continuous Scroll', active: viewMode === 'continuous', onClick: () => setViewMode('continuous') },
                  { label: 'Single Page', active: viewMode === 'single', onClick: () => setViewMode('single') }
                ].map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    onClick={() => {
                      item.onClick();
                      setViewMenuOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-[#f6f6f4]"
                  >
                    <span className="flex w-4 justify-center">{item.active ? <Check className="h-4 w-4" /> : null}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="hidden text-sm font-medium text-[#777a80] sm:block">
            Page {currentPage} of {pageNumbers.length || 1}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-full border border-[#e5e5e1] bg-white shadow-sm">
            <button
              type="button"
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="inline-flex h-9 w-9 items-center justify-center text-[#4b4f55] transition hover:bg-[#f6f6f4] disabled:cursor-not-allowed disabled:opacity-35"
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              value={currentPage}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) scrollToPage(next);
              }}
              className="h-9 w-14 border-x border-[#eeeeeb] bg-transparent text-center text-xs font-semibold text-[#25272b] outline-none focus:bg-[#fbfbfa]"
              aria-label="Current PDF page"
            />
            <button
              type="button"
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={currentPage >= pageNumbers.length}
              className="inline-flex h-9 w-9 items-center justify-center text-[#4b4f55] transition hover:bg-[#f6f6f4] disabled:cursor-not-allowed disabled:opacity-35"
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex overflow-hidden rounded-full border border-[#e5e5e1] bg-white shadow-sm">
            <button
              type="button"
              onClick={() => {
                setZoomMode('custom');
                setCustomScale((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))));
              }}
              className="inline-flex h-9 w-10 items-center justify-center text-[#4b4f55] transition hover:bg-[#f6f6f4]"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode(zoomMode === 'fit-width' ? 'fit-page' : 'fit-width')}
              className="inline-flex h-9 w-10 items-center justify-center border-x border-[#eeeeeb] text-[#4b4f55] transition hover:bg-[#f6f6f4]"
              title={zoomMode === 'fit-page' ? 'Fit width' : 'Fit page'}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoomMode('custom');
                setCustomScale((value) => Math.min(3, Number((value + 0.1).toFixed(2))));
              }}
              className="inline-flex h-9 w-10 items-center justify-center text-[#4b4f55] transition hover:bg-[#f6f6f4]"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>

          <div className="flex h-9 min-w-[238px] items-center gap-2 rounded-full border border-[#e5e5e1] bg-white px-3 shadow-sm">
            <Search className="h-4 w-4 shrink-0 text-[#7b7b80]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') activateSearchMatch(activeSearchMatch + (event.shiftKey ? -1 : 1));
              }}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#1d1d1f] outline-none placeholder:text-[#8e8e93]"
            />
            {searchQuery && (
              <span className="whitespace-nowrap text-[11px] text-[#7b7b80]">
                {searching ? '...' : searchMatches.length ? `${activeSearchMatch + 1}/${searchMatches.length}` : '0'}
              </span>
            )}
            {searchMatches.length > 0 && (
              <div className="flex items-center border-l border-[#eeeeeb] pl-1">
                <button
                  type="button"
                  onClick={() => activateSearchMatch(activeSearchMatch - 1)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#4b4f55] hover:bg-[#f6f6f4]"
                  title="Previous result"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => activateSearchMatch(activeSearchMatch + 1)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#4b4f55] hover:bg-[#f6f6f4]"
                  title="Next result"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
        {activeSearchPreview && searchQuery && (
          <div className="basis-full truncate px-1 text-right text-[11px] text-[#7b7b80]">
            Page {searchMatches[activeSearchMatch]?.page}: {activeSearchPreview}
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 bg-[#f4f4f1]" style={{ gridTemplateColumns: showThumbnails ? '156px minmax(0,1fr)' : 'minmax(0,1fr)' }}>
        {showThumbnails && (
          <aside className="min-h-0 overflow-auto border-r border-[#eeeeeb] bg-[#f8f8f6] p-3">
            <div className="space-y-3">
              {pdfDocument && pageNumbers.map((pageNumber) => (
                <PdfThumbnail
                  key={`thumb-${pageNumber}`}
                  pdfDocument={pdfDocument}
                  pageNumber={pageNumber}
                  active={pageNumber === currentPage}
                  onClick={() => scrollToPage(pageNumber, 'auto')}
                />
              ))}
            </div>
          </aside>
        )}
        <div
          ref={containerRef}
          className={`min-h-0 overflow-auto px-6 py-7 ${viewMode === 'single' ? 'flex items-start justify-center' : ''}`}
          onScroll={reportViewport}
          onMouseEnter={reportViewport}
          onMouseUp={reportViewport}
          onKeyUp={reportViewport}
        >
          {loading && (
            <div className="flex h-80 items-center justify-center text-sm text-[#777a80]">Loading PDF...</div>
          )}
          {error && (
            <div className="mx-auto max-w-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}
          {pdfDocument && displayedPages.map((pageNumber) => (
            <PdfJsPage
              key={`${pageNumber}-${scale}`}
              pdfDocument={pdfDocument}
              pageNumber={pageNumber}
              scale={scale}
              highlighted={jumpHighlight?.page === pageNumber}
              highlightRects={
                jumpHighlight?.page === pageNumber
                  ? normalizePdfHighlightRects(jumpHighlight.locator, pageNumber, scale)
                  : []
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DocumentPreview({
  resource,
  workspaceId,
  editorId,
  onUpdateViewState,
  onExtractedText,
  onDocumentStructure
}: {
  resource: ResourceReference;
  workspaceId: string;
  editorId: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onExtractedText?: (text: string) => void;
  onDocumentStructure?: (documentStructure: RenderableDocument | null) => void;
}) {
  const [previewInfo, setPreviewInfo] = useState<FilePreviewInfo | null>(null);
  const [documentStructure, setDocumentStructure] = useState<RenderableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [jumpHighlight, setJumpHighlight] = useState<{ chunkIndex?: number; blockId?: string } | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const cacheKey = previewCacheKey(workspaceId, resource.id);
    const cachedPreviewInfo = previewInfoCache.get(cacheKey);
    const cachedStructure = documentStructureCache.get(cacheKey);

    if (cachedPreviewInfo || cachedStructure) {
      setPreviewInfo(cachedPreviewInfo ?? null);
      setDocumentStructure(cachedStructure ?? null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);

    Promise.allSettled([
      fileSystemApi.getPreviewInfo(workspaceId, resource.id),
      fileSystemApi.getDocumentStructure(workspaceId, resource.id)
    ])
      .then(([previewResult, structureResult]) => {
        if (!active) return;
        if (previewResult.status === 'fulfilled') {
          previewInfoCache.set(cacheKey, previewResult.value);
          setPreviewInfo(previewResult.value);
        } else {
          const fallbackPreviewInfo = {
            status: 'unavailable',
            previewKind: 'document',
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          } as FilePreviewInfo;
          previewInfoCache.set(cacheKey, fallbackPreviewInfo);
          setPreviewInfo(fallbackPreviewInfo);
        }

        if (structureResult.status === 'fulfilled') {
          documentStructureCache.set(cacheKey, structureResult.value);
          setDocumentStructure(structureResult.value);
        } else {
          setDocumentStructure(null);
        }
      })
      .catch(() => {
        if (active) {
          const fallbackPreviewInfo = {
            status: 'unavailable',
            previewKind: 'document',
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          } as FilePreviewInfo;
          previewInfoCache.set(cacheKey, fallbackPreviewInfo);
          setPreviewInfo(fallbackPreviewInfo);
          setDocumentStructure(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [resource.id, workspaceId]);

  useEffect(() => {
    if (!documentStructure) return;
    onExtractedText?.(getTextFromDocumentStructure(documentStructure));
    onDocumentStructure?.(documentStructure);
  }, [documentStructure, onDocumentStructure, onExtractedText]);

  const reportScroll = (element: HTMLDivElement) => {
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const units = Array.from(element.querySelectorAll<HTMLElement>('[data-doc-unit="true"]'));
    const containerRect = element.getBoundingClientRect();
    const visibleUnits = units
      .map((unit) => {
        const rect = unit.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, containerRect.top);
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        return {
          unit,
          visibleHeight,
          ratio: rect.height > 0 ? visibleHeight / rect.height : 0
        };
      })
      .filter((item) => item.visibleHeight > 0)
      .sort((left, right) => right.visibleHeight - left.visibleHeight);
    const primary = visibleUnits[0]?.unit;
    const visiblePages = visibleUnits
      .map((item) => Number(item.unit.dataset.page))
      .filter((page) => Number.isFinite(page) && page > 0);
    const visibleChunkIndexes = visibleUnits
      .map((item) => Number(item.unit.dataset.chunkIndex))
      .filter((index) => Number.isFinite(index) && index >= 0);
    const primaryPage = primary?.dataset.page ? Number(primary.dataset.page) : undefined;
    const primaryChunkIndex = primary?.dataset.chunkIndex ? Number(primary.dataset.chunkIndex) : undefined;
    const primaryBlockId = primary?.dataset.blockId;
    const selectedText = window.getSelection()?.toString().trim() || '';

    onUpdateViewState?.(editorId, {
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      visiblePages: visiblePages.length
        ? [...new Set(visiblePages)].sort((left, right) => left - right)
        : [Math.max(1, Math.floor((element.scrollTop / totalScrollable) * Math.max(1, documentStructure?.pageCount || 10)) + 1)],
      primaryPage:
        primaryPage || Math.max(1, Math.floor((element.scrollTop / totalScrollable) * Math.max(1, documentStructure?.pageCount || 10)) + 1),
      visibleBlockIds: primaryBlockId ? [primaryBlockId] : [],
      approxChunkIndex:
        typeof primaryChunkIndex === 'number'
          ? primaryChunkIndex
          : visibleChunkIndexes[0] ?? Math.max(0, Math.floor((element.scrollTop / totalScrollable) * Math.max(1, documentStructure?.chunks?.length || 20))),
      selectedText
    });
  };

  const handleSelection = () => {
    const element = readerRef.current;
    if (!element) return;
    reportScroll(element);
  };

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent<CitationJumpDetail>).detail;
      if (!detail?.fileId || detail.fileId !== resource.id) return;
      const locator = detail.locator || {};
      const chunkIndex = typeof locator.chunkIndex === 'number' ? locator.chunkIndex : undefined;
      const blockId = typeof locator.blockId === 'string' ? locator.blockId : undefined;
      const selector = blockId
        ? `[data-block-id="${CSS.escape(blockId)}"]`
        : typeof chunkIndex === 'number'
          ? `[data-chunk-index="${chunkIndex}"]`
          : '[data-doc-unit="true"]';
      const target = readerRef.current?.querySelector<HTMLElement>(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setJumpHighlight({ chunkIndex, blockId });
      window.setTimeout(() => setJumpHighlight(null), 2600);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [resource.id]);

  const renderChunk = (chunk: RenderableDocumentChunk) => {
    const highlighted =
      (typeof jumpHighlight?.chunkIndex === 'number' && jumpHighlight.chunkIndex === chunk.chunkIndex) ||
      (jumpHighlight?.blockId && jumpHighlight.blockId === chunk.blockId);
    return (
      <section
        key={`chunk-${chunk.chunkIndex}`}
        data-doc-unit="true"
        data-chunk-index={chunk.chunkIndex}
        data-block-id={chunk.blockId || ''}
        className={`rounded-lg px-3 py-2 transition-colors ${
          highlighted ? 'bg-[#f5d36b]/35 ring-2 ring-[#d3a900]/30' : 'hover:bg-[#f8f8f6]'
        }`}
      >
        {chunk.headingPath?.length && (
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[#16833a]">
            {chunk.headingPath.join(' / ')}
          </div>
        )}
        {chunk.html ? (
          <div
            className="prose prose-sm max-w-none text-[#25272b] prose-headings:font-semibold prose-p:my-2 prose-li:my-1"
            dangerouslySetInnerHTML={{ __html: chunk.html }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-7 text-[#25272b]">{chunk.text}</p>
        )}
      </section>
    );
  };

  if (
    documentStructure?.kind === 'pdf' ||
    (previewInfo?.status === 'ready' && (previewInfo.previewKind === 'pdf' || previewInfo.previewKind === 'document') && previewInfo.previewUrl)
  ) {
    return (
      <PdfJsReader
        sourceUrl={previewInfo?.previewUrl || fileSystemApi.previewUrl(workspaceId, resource.id)}
        fileId={resource.id}
        resourceName={resource.name}
        onViewportChange={(patch) => onUpdateViewState?.(editorId, patch)}
      />
    );
  }

  return (
    <div
      ref={readerRef}
      className="h-full overflow-auto bg-white px-5 pb-5 text-[#25272b]"
      onScroll={(event) => reportScroll(event.currentTarget)}
      onMouseEnter={(event) => reportScroll(event.currentTarget)}
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
    >
      <div className="mx-auto flex min-h-full max-w-5xl flex-col bg-white pt-1">
        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-[#777a80]">
              Loading...
            </div>
          ) : documentStructure?.chunks?.length ? (
            <div className="mx-auto max-w-3xl bg-white px-6 py-5">
              {documentStructure.chunks.map(renderChunk)}
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center gap-4 p-6 text-sm text-[#777a80]">
              <p>{documentStructure?.fallbackReason || previewInfo?.message || 'This document cannot be rendered right now.'}</p>
              {previewInfo?.sourceUrl && (
                <a
                  href={previewInfo.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-[#e5e5e1] bg-white px-3 py-2 text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
                >
                  Open original
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HtmlVisualizationPreview({
  resource,
  workspaceId
}: {
  resource: ResourceReference;
  workspaceId: string;
}) {
  const previewUrl = fileSystemApi.downloadUrl(workspaceId, resource.id);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-end bg-white px-5 py-3">
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-[#e5e5e1] bg-white px-3 py-1.5 text-xs text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Open Fullscreen
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-5 pb-5">
        <iframe title={resource.name} src={previewUrl} className="h-full w-full bg-white" />
      </div>
    </div>
  );
}

function WebSourcePreview({
  title,
  url,
  body,
  workspaceId,
  resource,
  editorId,
  onUpdateViewState,
  onExtractedText
}: {
  title: string;
  url?: string;
  body?: string;
  workspaceId: string;
  resource?: ResourceReference;
  editorId?: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onExtractedText?: (text: string) => void;
}) {
  const embed = getEmbedInfo(url);
  const [previewData, setPreviewData] = useState<WebPreviewData | null>(null);
  const [activeUrl, setActiveUrl] = useState(url || '');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    text: string;
    selectedRange: Record<string, any>;
  } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const displayedTitle = previewData?.title || title;
  const displayedUrl = previewData?.url || activeUrl || url;
  const richHtml = previewData?.contentHtml || '';
  const readableText = previewData?.contentMarkdown || body || '';

  useEffect(() => {
    setActiveUrl(url || '');
    setPreviewData(null);
  }, [url]);

  useEffect(() => {
    const text = [displayedTitle, displayedUrl, previewData?.excerpt, readableText]
      .filter(Boolean)
      .join('\n\n');
    onExtractedText?.(text);
  }, [displayedTitle, displayedUrl, onExtractedText, previewData?.excerpt, readableText]);

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent<CitationJumpDetail>).detail;
      if (!resource?.id || !detail?.fileId || detail.fileId !== resource.id) return;
      const element = scrollerRef.current;
      if (!element) return;
      const locator = detail.locator || {};
      const lineStart = Number(locator.lineStart || locator.startLine || 1);
      const lineCount = Math.max(1, readableText.split('\n').length);
      const scrollRatio = Number.isFinite(Number(locator.scrollRatio))
        ? Number(locator.scrollRatio)
        : Number.isFinite(lineStart)
          ? Math.min(1, Math.max(0, (lineStart - 1) / lineCount))
          : 0;
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTo({ top: maxScroll * scrollRatio, behavior: 'smooth' });
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [readableText, resource?.id]);

  useEffect(() => {
    if (!activeUrl || embed) return;

    const cacheKey = `${workspaceId}:${activeUrl}`;
    const cachedPreview = webPreviewCache.get(cacheKey);
    if (cachedPreview) {
      setPreviewData(cachedPreview);
      setIsExtracting(false);
      setExtractError('');
      return;
    }

    let cancelled = false;
    setIsExtracting(true);
    setExtractError('');
    setPreviewData(null);

    void fileSystemApi
      .extractUrlPreview(workspaceId, { url: activeUrl, title })
      .then((result) => {
        webPreviewCache.set(cacheKey, result);
        if (!cancelled) setPreviewData(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setExtractError(error?.response?.data?.error || error?.message || 'Failed to extract webpage content.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsExtracting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeUrl, embed, title, workspaceId]);

  const handleArticleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor?.href) return;
    const nextUrl = anchor.href;
    const isInternal = displayedUrl ? new URL(nextUrl).hostname === new URL(displayedUrl).hostname : false;
    if (!isInternal) return;
    event.preventDefault();
    setActiveUrl(nextUrl);
  };

  const readWebSelection = () => {
    const element = scrollerRef.current;
    const selection = window.getSelection();
    if (!element || !selection || selection.rangeCount === 0) return null;
    const selectedText = selection.toString().trim();
    if (!selectedText) return null;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    const normalizedSelection = selectedText.replace(/\s+/g, ' ');
    const normalizedText = readableText.replace(/\s+/g, ' ');
    const charStart = normalizedText.indexOf(normalizedSelection);
    const lineStart = Math.max(1, readableText.slice(0, Math.max(0, charStart)).split('\n').length);
    const lineEnd = lineStart + Math.max(0, selectedText.split('\n').length - 1);
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    return {
      selectedText,
      selectedRange: {
        sourceType: 'web_selection',
        url: displayedUrl,
        lineStart: charStart >= 0 ? lineStart : undefined,
        lineEnd: charStart >= 0 ? lineEnd : undefined,
        charStart: charStart >= 0 ? charStart : undefined,
        charEnd: charStart >= 0 ? charStart + normalizedSelection.length : undefined,
        textLength: selectedText.length,
        scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable))
      },
      menu: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.max(12, Math.round(rect.top - 48))
      }
    };
  };

  const reportWebContext = () => {
    const element = scrollerRef.current;
    if (!resource?.id || !editorId || !onUpdateViewState || !element) return;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const selectionLocator = readWebSelection();
    const scrollRatio = Math.min(1, Math.max(0, element.scrollTop / totalScrollable));
    const lineCount = Math.max(1, readableText.split('\n').length);
    const approxLine = Math.max(1, Math.round(scrollRatio * lineCount));
    if (selectionLocator) {
      setSelectionMenu({
        x: selectionLocator.menu.x,
        y: selectionLocator.menu.y,
        text: selectionLocator.selectedText,
        selectedRange: selectionLocator.selectedRange
      });
    } else {
      setSelectionMenu(null);
    }
    onUpdateViewState(editorId, {
      scrollRatio,
      approxChunkIndex: Math.max(0, approxLine - 1),
      visibleLineRange: { start: approxLine, end: Math.min(lineCount, approxLine + 40) },
      selectedText: selectionLocator?.selectedText || '',
      selectedRange: selectionLocator?.selectedRange || null,
      visibleContent: selectionLocator?.selectedText || readableText.slice(Math.max(0, approxLine - 1), approxLine + 2500)
    });
  };

  const applyWebSelectionPrompt = (prompt: string) => {
    if (!selectionMenu || !resource?.id) return;
    window.dispatchEvent(
      new CustomEvent('workbench:context-selection-action', {
        detail: {
          fileId: resource.id,
          fileName: displayedTitle || resource.name,
          panelId: editorId,
          panelType: 'web',
          sourceLabel: '网页选区',
          selectedRange: selectionMenu.selectedRange,
          text: selectionMenu.text,
          prompt
        } as WorkbenchContextSelectionActionDetail
      })
    );
  };

  if (embed && resource) {
    return (
      <EmbeddedVideoSourcePreview
        sourceUrl={activeUrl || url}
        title={title}
      />
    );
  }

  if (embed) {
    return (
      <div ref={scrollerRef} className="h-full overflow-auto bg-white px-6 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden bg-black">
            <iframe
              title={`${embed.provider} video`}
              src={embed.embedUrl}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="mt-4 bg-white px-1 py-2 text-sm leading-6 text-[#5f6368]">
            {embed.provider} video source. Use the player above for playback; the original link stays attached for citation and follow-up extraction.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="h-full overflow-auto bg-white px-6 py-5"
      onScroll={reportWebContext}
      onMouseUp={reportWebContext}
      onKeyUp={reportWebContext}
      onMouseEnter={reportWebContext}
    >
      {selectionMenu && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-full border border-[#d9d9d5] bg-[#202124] px-2 py-1 text-xs font-medium text-white shadow-[0_12px_35px_rgba(0,0,0,0.22)]"
          style={{ left: selectionMenu.x, top: selectionMenu.y, transform: 'translateX(-50%)' }}
        >
          <button className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(event) => event.preventDefault()} onClick={() => applyWebSelectionPrompt('请解释我选中的这段网页内容')}>解释</button>
          <button className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(event) => event.preventDefault()} onClick={() => applyWebSelectionPrompt('请总结我选中的这段网页内容')}>总结</button>
          <button className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(event) => event.preventDefault()} onClick={() => applyWebSelectionPrompt('请基于我选中的网页内容回答：')}>提问</button>
          <button className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(event) => event.preventDefault()} onClick={() => applyWebSelectionPrompt('__lock_context_selection__')}>锁定</button>
        </div>
      )}
      <div className="mx-auto max-w-5xl">
        <article className="min-w-0 text-[#25272b]">
          {richHtml.trim() ? (
            <div className="bg-white px-2 py-4">
              <div className="mb-6 pb-5">
                <h1 className="text-4xl font-semibold tracking-normal text-[#202124]">{displayedTitle}</h1>
                {displayedUrl && <div className="mt-3 break-all text-sm text-[#777a80]">{displayedUrl}</div>}
                {(previewData?.byline || previewData?.siteName || previewData?.excerpt) && (
                  <div className="mt-4 space-y-1 text-sm leading-6 text-[#70757a]">
                    {previewData.siteName && <div>Site: {previewData.siteName}</div>}
                    {previewData.byline && <div>Byline: {previewData.byline}</div>}
                    {previewData.excerpt && <div>Excerpt: {previewData.excerpt}</div>}
                  </div>
                )}
              </div>
              <div
                className="web-rich-preview"
                onClick={handleArticleClick}
                dangerouslySetInnerHTML={{ __html: richHtml }}
              />
            </div>
          ) : isExtracting ? (
            <div className="flex items-center gap-3 bg-white px-2 py-6 text-sm leading-7 text-[#5f6368]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting webpage content...
            </div>
          ) : body?.trim() ? (
            <MarkdownPreview content={`# ${title}\n\n${body}`} variant="document" />
          ) : (
            <div className="bg-white px-2 py-6 text-sm leading-7 text-[#5f6368]">
              {extractError || 'No readable webpage content could be extracted from this link.'}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function EmbeddedVideoSourcePreview({
  sourceUrl,
  title,
  seekTarget,
  onTimeChange
}: {
  sourceUrl?: string;
  title?: string;
  seekTarget?: number;
  onTimeChange?: (seconds: number) => void;
}) {
  const embed = getEmbedInfo(sourceUrl);
  const [embedStart, setEmbedStart] = useState(0);

  if (!embed) {
    return null;
  }

  useEffect(() => {
    if (typeof seekTarget !== 'number') return;
    const start = Math.max(0, Math.floor(seekTarget));
    onTimeChange?.(start);
    setEmbedStart(start);
  }, [onTimeChange, seekTarget]);

  const embedUrl = `${embed.embedUrl}${embed.embedUrl.includes('?') ? '&' : '?'}start=${embedStart}&autoplay=${embedStart > 0 ? '1' : '0'}`;

  return (
    <div className="h-full overflow-auto bg-white px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <div className="overflow-hidden bg-black">
          <iframe
            key={`${embed.embedUrl}:${embedStart}`}
            title={title || `${embed.provider} video`}
            src={embedUrl}
            className="aspect-video w-full"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

function VideoFilePreview({
  resource,
  workspaceId,
  seekTarget,
  onTimeChange
}: {
  resource: ResourceReference;
  workspaceId: string;
  seekTarget?: number;
  onTimeChange?: (seconds: number) => void;
}) {
  const sourceUrl = fileSystemApi.downloadUrl(workspaceId, resource.id);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current || typeof seekTarget !== 'number') return;
    videoRef.current.currentTime = Math.max(0, seekTarget);
    onTimeChange?.(Math.max(0, seekTarget));
    void videoRef.current.play().catch(() => undefined);
  }, [onTimeChange, seekTarget]);

  return (
    <div className="h-full overflow-auto bg-white px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <video
          ref={videoRef}
          src={sourceUrl}
          controls
          className="aspect-video w-full bg-black shadow-sm"
          onTimeUpdate={(event) => onTimeChange?.(event.currentTarget.currentTime)}
          onSeeked={(event) => onTimeChange?.(event.currentTarget.currentTime)}
        >
          <track kind="captions" />
        </video>
      </div>
    </div>
  );
}

function VideoSourcePanel({
  editor,
  resource,
  workspaceId,
  sourceUrl,
  sourceTitle,
  onUpdateViewState
}: {
  editor: EditorState;
  resource: ResourceReference;
  workspaceId: string;
  sourceUrl?: string;
  sourceTitle?: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined);
  const externalUrl = sourceUrl || getResourceSourceUrl(resource) || fileSystemApi.downloadUrl(workspaceId, resource.id);
  const embed = getEmbedInfo(sourceUrl);

  const handleSeek = (seconds: number) => {
    setCurrentTime(Math.max(0, seconds));
    setSeekTarget(Math.max(0, seconds));
  };

  return (
    <ResourcePanelShell
      editor={editor}
      resource={resource}
      workspaceId={workspaceId}
      sourceUrl={externalUrl}
      onUpdateViewState={onUpdateViewState}
      guidePanel={({ collapsed, onToggleCollapsed }) =>
        collapsed ? null : (
          <div className="h-full">
            <VideoLearningPanel
              resource={resource}
              workspaceId={workspaceId}
              editorId={editor.id}
              currentTime={currentTime}
              onSeek={handleSeek}
              onUpdateViewState={onUpdateViewState}
              onClose={onToggleCollapsed}
            />
          </div>
        )
      }
    >
      {embed ? (
        <EmbeddedVideoSourcePreview
          sourceUrl={sourceUrl}
          title={sourceTitle || resource.name}
          seekTarget={seekTarget}
          onTimeChange={setCurrentTime}
        />
      ) : (
        <VideoFilePreview
          resource={resource}
          workspaceId={workspaceId}
          seekTarget={seekTarget}
          onTimeChange={setCurrentTime}
        />
      )}
    </ResourcePanelShell>
  );
}

function TextEditingSurface({
  editor,
  resource,
  content,
  isLoading,
  onChangeContent,
  onUpdateViewState
}: {
  editor: EditorState;
  resource: ResourceReference;
  content: string;
  isLoading: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resourceKind = getResourceKind(resource);
  const languageLabel = getLanguageLabel(resource);
  const previewMode =
    (editor.viewState.mode as 'edit' | 'preview' | undefined) ||
    (editor.type === 'notes' ? 'edit' : 'preview');
  const editable = resourceKind !== 'binary' && resourceKind !== 'document' && resourceKind !== 'pdf';
  const showMarkdownPreview = isMarkdownResource(resource);
  const showStructuredEditor = resourceKind === 'structured' || resourceKind === 'code';

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent<CitationJumpDetail>).detail;
      if (!resource.id || !detail?.fileId || detail.fileId !== resource.id) return;
      const locator = detail.locator || {};
      const lineStart = Number(locator.lineStart || locator.startLine || 1);
      const lineEnd = Number(locator.lineEnd || locator.endLine || lineStart);
      const textarea = textareaRef.current;
      if (!textarea) return;
      const lines = String(content || '').split('\n');
      const startOffset = lines.slice(0, Math.max(0, lineStart - 1)).join('\n').length + (lineStart > 1 ? 1 : 0);
      const endOffset = lines.slice(0, Math.max(0, lineEnd)).join('\n').length;
      textarea.focus();
      textarea.setSelectionRange(Math.min(startOffset, textarea.value.length), Math.min(endOffset, textarea.value.length));
      textarea.scrollTop = Math.max(0, (lineStart - 3) * 24);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [content, resource.id]);

  const handleFormat = () => {
    if (!resource.id || !isJsonResource(resource)) return;

    try {
      const formatted = JSON.stringify(JSON.parse(content || '{}'), null, 2);
      onChangeContent?.(resource.id, formatted);
    } catch {
      // Keep the current content when JSON is invalid.
    }
  };
  const reportVisibleTextState = (element: HTMLTextAreaElement) => {
    const lineHeight = 24;
    const start = Math.max(1, Math.floor(element.scrollTop / lineHeight) + 1);
    const end = Math.max(start, Math.ceil((element.scrollTop + element.clientHeight) / lineHeight));
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const selectedText =
      element.selectionStart !== element.selectionEnd
        ? element.value.slice(element.selectionStart, element.selectionEnd)
        : '';

    onUpdateViewState?.(editor.id, {
      visibleLineRange: { start, end },
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      approxChunkIndex: Math.max(0, start - 1),
      selectedText
    });
  };

  return (
    <TextEditorShell
      toolbar={
        <div className="flex items-center justify-between border-b border-[#eeeeeb] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdateViewState?.(editor.id, { mode: 'edit' })}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                previewMode === 'edit'
                  ? 'bg-[#202124] text-white shadow-sm'
                  : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
              }`}
            >
              <PencilLine className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={() => onUpdateViewState?.(editor.id, { mode: 'preview' })}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                previewMode === 'preview'
                  ? 'bg-[#202124] text-white shadow-sm'
                  : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#777a80]">
            <span>{languageLabel}</span>
            {showStructuredEditor && isJsonResource(resource) && (
              <button
                onClick={handleFormat}
                className="rounded-full border border-[#e5e5e1] bg-white px-3 py-1.5 font-medium text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
              >
                Format JSON
              </button>
            )}
          </div>
        </div>
      }
    >
      {previewMode === 'edit' && editable ? (
        <textarea
          ref={textareaRef}
          value={String(content ?? '')}
          onChange={(event) => {
            resource.id && onChangeContent?.(resource.id, event.target.value);
            reportVisibleTextState(event.currentTarget);
          }}
          onScroll={(event) => reportVisibleTextState(event.currentTarget)}
          onSelect={(event) => reportVisibleTextState(event.currentTarget)}
          onFocus={(event) => reportVisibleTextState(event.currentTarget)}
          className="h-full w-full resize-none border-0 bg-white px-5 py-4 font-mono text-sm leading-6 text-[#25272b] outline-none placeholder:text-[#a6a8ab]"
          placeholder={isLoading ? 'Loading file content...' : 'Open a file to start editing.'}
          spellCheck={editor.type === 'notes'}
        />
      ) : showMarkdownPreview ? (
        <MarkdownPreview
          content={content}
          emptyMessage={isLoading ? 'Loading file content...' : 'Open a markdown note to preview.'}
          onViewportChange={(patch) => onUpdateViewState?.(editor.id, patch)}
          fileId={resource.id}
        />
      ) : resourceKind === 'note' ? (
        <PlainTextPreview
          content={content}
          emptyMessage={isLoading ? 'Loading file content...' : 'Open a text note to preview.'}
          onViewportChange={(patch) => onUpdateViewState?.(editor.id, patch)}
          fileId={resource.id}
        />
      ) : (
        <SyntaxHighlightedCode
          code={content}
          language={languageLabel}
          emptyMessage={isLoading ? 'Loading file content...' : 'Open a file to preview.'}
          onViewportChange={(patch) => onUpdateViewState?.(editor.id, patch)}
          fileId={resource.id}
        />
      )}
    </TextEditorShell>
  );
}

function ExternalEditorView({
  editor
}: {
  editor: EditorState;
}) {
  const externalResource = editor.viewState?.externalResource as
    | { title?: string; url?: string; description?: string }
    | undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white text-[#25272b]">
      <div className="flex items-center justify-between border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-[#16833a]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#25272b]">
              {externalResource?.title || editor.title}
            </div>
            <div className="truncate text-xs text-[#96999d]">External Reference</div>
          </div>
        </div>
        {externalResource?.url && (
          <a
            href={externalResource.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[#e5e5e1] bg-white px-2.5 py-1.5 text-xs text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Open
          </a>
        )}
      </div>

      <div className="p-5">
        <div className="rounded-3xl border border-[#e5e5e1] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#16833a]">
            <Globe className="h-4 w-4" />
            External Resource
          </div>
          <div className="mt-4 text-2xl font-semibold text-[#25272b]">
            {externalResource?.title || editor.title}
          </div>
          <div className="mt-2 break-all text-sm text-[#777a80]">
            {externalResource?.url || 'No URL provided'}
          </div>
          {externalResource?.description && (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#777a80]">
              {externalResource.description}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {externalResource?.url && (
              <a
                href={externalResource.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#34373c] active:scale-95"
              >
                <ExternalLink className="h-4 w-4" />
                Open Source
              </a>
            )}
            <div className="inline-flex items-center rounded-full border border-[#e5e5e1] px-4 py-2 text-sm text-[#777a80]">
              This panel references an external source and does not own storage.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const aiWelcomeCache = new Map<string, AiWelcomeContent>();
const rememberAiWelcomeContent = (signature: string, content: AiWelcomeContent) => {
  aiWelcomeCache.set(signature, content);
  if (aiWelcomeCache.size > 40) {
    const firstKey = aiWelcomeCache.keys().next().value;
    if (firstKey) aiWelcomeCache.delete(firstKey);
  }
};

const clipWelcomeText = (value?: string | null, length = 180) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length);

const buildAiWelcomeSignature = (aiContext?: WorkbenchEditorContentProps['aiContext']) => {
  const activePanel =
    aiContext?.openPanels?.find((panel) => panel.panelId === aiContext.activePanelId) ||
    aiContext?.openPanels?.find((panel) => panel.fileId === aiContext.activeFileId) ||
    aiContext?.openPanels?.[0];
  return [
    aiContext?.workbenchId || '',
    aiContext?.workbenchTitle || '',
    aiContext?.activeFileId || '',
    activePanel?.panelId || '',
    activePanel?.fileName || aiContext?.activeFile?.name || '',
    clipWelcomeText(activePanel?.selectedText || aiContext?.selectedText, 120),
    clipWelcomeText(activePanel?.visibleContent, 240),
    (aiContext?.openPanels || []).map((panel) => panel.fileId || panel.panelId).join(',')
  ].join('|');
};

const getWelcomeActionIcon = (suggestion: AiWelcomeSuggestion) => {
  switch (suggestion.icon) {
    case 'translate':
      return <Languages className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'analysis':
      return <Brain className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'task':
      return <ClipboardList className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'outline':
      return <ListChecks className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'question':
      return <CircleHelp className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'compare':
      return <GitCompare className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'search':
      return <Search className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'practice':
      return <Check className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'plan':
      return <Route className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
    case 'summary':
    default:
      return <FileText className="h-4.5 w-4.5 shrink-0 text-[#555960]" />;
  }
};

const NOTE_EDIT_INTENT_PATTERN =
  /修改|改写|重写|润色|整理|补充|追加|加入|写进|放进|插入|删除|更新|扩写|缩写|合并|应用到|改成|改为|改得|改的|调整|优化|精简|简化|压缩|提炼|浓缩|写成|变成|变得|edit|rewrite|revise|polish|update|append|insert|delete|shorten|simplify|condense|optimize/i;
const NOTE_EDIT_TARGET_PATTERN = /这段|选区|选中|当前|笔记|note|markdown|md|内容|文本|段落|文章|全文/i;
const WHOLE_NOTE_EDIT_PATTERN = /全文|整篇|整个笔记|整份笔记|全部内容|通篇|重构整|整理整|rewrite the whole|entire note|whole note/i;
const NOTE_EDIT_PROPOSAL_MARKER_PREFIX = 'pp1-note-edit-proposal';
const NOTE_EDIT_PROPOSAL_MARKER_PATTERN = /<!--\s*pp1-note-edit-proposal(?::([^>\s:]+))?(?::([^>\s:]+))?\s*-->/;
const buildNoteEditProposalMarker = (fileId?: string | null, baseContentHash?: string | null) =>
  `<!-- ${NOTE_EDIT_PROPOSAL_MARKER_PREFIX}${fileId ? `:${fileId}` : ''}${baseContentHash ? `:${baseContentHash}` : ''} -->`;

const extractMarkdownProposal = (content: string) => {
  const text = String(content || '');
  const marker = text.match(NOTE_EDIT_PROPOSAL_MARKER_PATTERN);
  if (!marker) return null;

  const fences = [...text.matchAll(/```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)```/g)];
  const markdownFence =
    fences.find((match) => /^(markdown|md|note|note-update|updated-note)$/i.test(match[1] || '')) ||
    fences.find((match) => !(match[1] || '').trim());

  const proposal = markdownFence?.[2]?.trim();
  return proposal ? { content: proposal, targetFileId: marker[1]?.trim() || null, baseContentHash: marker[2]?.trim() || null, mode: 'whole' as const } : null;
};

const extractSelectionReplacementProposal = (content: string) => {
  const text = String(content || '');
  const marker = text.match(NOTE_EDIT_PROPOSAL_MARKER_PATTERN);
  if (!marker) return null;

  const fences = [...text.matchAll(/```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)```/g)];
  const replacementFence =
    fences.find((match) => /^(replacement|selection|selected-text|text|markdown|md)$/i.test(match[1] || '')) ||
    fences.find((match) => !(match[1] || '').trim());

  const replacement = replacementFence?.[2]?.trim();
  return replacement ? { content: replacement, targetFileId: marker[1]?.trim() || null, baseContentHash: marker[2]?.trim() || null, mode: 'selection' as const } : null;
};

const replaceUniqueSelectedText = (baseContent: string, selectedText: string, replacement: string) => {
  const selection = String(selectedText || '').trim();
  if (!selection) return null;

  const directIndex = baseContent.indexOf(selectedText);
  if (directIndex >= 0) {
    if (baseContent.indexOf(selectedText, directIndex + selectedText.length) >= 0) return null;
    return `${baseContent.slice(0, directIndex)}${replacement}${baseContent.slice(directIndex + selectedText.length)}`;
  }

  const normalizedIndex = baseContent.indexOf(selection);
  if (normalizedIndex >= 0) {
    if (baseContent.indexOf(selection, normalizedIndex + selection.length) >= 0) return null;
    return `${baseContent.slice(0, normalizedIndex)}${replacement}${baseContent.slice(normalizedIndex + selection.length)}`;
  }

  return null;
};

const isUserWorkbenchNote = (file?: AiChatContext['activeFile'] | null, panel?: any) => {
  const fileCategory = String(file?.fileCategory || panel?.fileCategory || '').toLowerCase();
  const resourceType = String(file?.resourceType || panel?.resourceType || '').toLowerCase();
  const scope = String(file?.scope || panel?.scope || '').toLowerCase();
  const origin = String(file?.origin || panel?.origin || 'user').toLowerCase();
  const extension = (file?.name || panel?.fileName || '').split('.').pop()?.toLowerCase();

  return (
    Boolean(file?.id || panel?.fileId) &&
    (fileCategory.includes('note') || resourceType === 'note' || extension === 'md' || extension === 'markdown') &&
    scope === 'workbench' &&
    origin === 'user'
  );
};

const buildNoteEditInstruction = (fileName?: string, filePath?: string, selectedText?: string, mode: 'selection' | 'whole' = 'selection') =>
  [
    '',
    '【笔记修改提案模式】',
    `目标笔记：${fileName || '当前笔记'}`,
    filePath ? `路径：${filePath}` : '',
    selectedText?.trim() ? `当前选区（最高优先级）：\n${selectedText.trim().slice(0, 3000)}` : '',
    '用户希望你修改当前 Workbench 内由用户创建的 markdown 笔记。',
    '上下文优先级：1）用户当前选中的文本最高；2）选区附近段落和标题；3）当前笔记全文；4）Workbench/Workspace 其它资料。',
    '如果存在选区，请围绕选区完成用户要求；只有在用户明确要求整理全文、补全全文或更新整篇笔记时，才大幅改动选区之外的内容。',
    '不要声称你已经写入文件；前端会让用户确认后再保存。',
    '请先用 1-3 条简短 bullet 说明你准备改什么，然后输出一个且仅一个 fenced code block。',
    mode === 'whole'
      ? 'fenced code block 的语言必须是 markdown，内容必须是“修改后的完整笔记 markdown”，不是 diff。'
      : 'fenced code block 的语言必须是 replacement，内容必须是“可直接替换当前选区的文本”，不是完整笔记，也不是 diff。',
    '不要把引用标记或“来源”写进 fenced code block 里；如需说明依据，放在 code block 之外。'
  ]
    .filter(Boolean)
    .join('\n');

const hashText = async (value: string) => {
  const bytes = new TextEncoder().encode(value || '');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

type DiffLine = { type: 'same' | 'add' | 'remove'; text: string };

const buildLineDiff = (before: string, after: string): DiffLine[] => {
  const beforeLines = String(before || '').split('\n');
  const afterLines = String(after || '').split('\n');
  const rows = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0));

  for (let left = beforeLines.length - 1; left >= 0; left -= 1) {
    for (let right = afterLines.length - 1; right >= 0; right -= 1) {
      rows[left][right] =
        beforeLines[left] === afterLines[right]
          ? rows[left + 1][right + 1] + 1
          : Math.max(rows[left + 1][right], rows[left][right + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let left = 0;
  let right = 0;
  while (left < beforeLines.length && right < afterLines.length) {
    if (beforeLines[left] === afterLines[right]) {
      diff.push({ type: 'same', text: beforeLines[left] });
      left += 1;
      right += 1;
    } else if (rows[left + 1][right] >= rows[left][right + 1]) {
      diff.push({ type: 'remove', text: beforeLines[left] });
      left += 1;
    } else {
      diff.push({ type: 'add', text: afterLines[right] });
      right += 1;
    }
  }
  while (left < beforeLines.length) {
    diff.push({ type: 'remove', text: beforeLines[left] });
    left += 1;
  }
  while (right < afterLines.length) {
    diff.push({ type: 'add', text: afterLines[right] });
    right += 1;
  }
  return diff;
};

const diffStats = (lines: DiffLine[]) => ({
  added: lines.filter((line) => line.type === 'add').length,
  removed: lines.filter((line) => line.type === 'remove').length
});

export function AiEditorView({
  editor,
  workspaceId,
  aiContext,
  resources = [],
  onUpdateViewState,
  onApplyNoteEdit,
  hideHeader = false,
  compactWelcome = false
}: {
  editor: EditorState;
  workspaceId: string;
  aiContext?: WorkbenchEditorContentProps['aiContext'];
  resources?: ResourceReference[];
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onApplyNoteEdit?: (resourceId: string, content: string) => void | Promise<boolean | void>;
  hideHeader?: boolean;
  compactWelcome?: boolean;
}) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<AgentTimelineItem[]>([]);
  const [thinkingTraceOpen, setThinkingTraceOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [contextModeMenuOpen, setContextModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [inspectedChipId, setInspectedChipId] = useState<string | null>(null);
  const [sourceModalSource, setSourceModalSource] = useState<CitationUiSource | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [savingAttachmentId, setSavingAttachmentId] = useState<string | null>(null);
  const [aiWelcomeContent, setAiWelcomeContent] = useState<AiWelcomeContent | null>(() => {
    const signature = buildAiWelcomeSignature(aiContext);
    return aiWelcomeCache.get(signature) || null;
  });
  const [isWelcomeLoading, setIsWelcomeLoading] = useState(false);
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ provider: string; model: string }>>([]);
  const [applyingNoteEditKey, setApplyingNoteEditKey] = useState<string | null>(null);
  const [appliedNoteEditKey, setAppliedNoteEditKey] = useState<string | null>(null);
  const [noteEditPreview, setNoteEditPreview] = useState<{
    messageIndex: number;
    proposal: { content: string; targetFileId?: string | null; baseContentHash?: string | null; mode?: 'selection' | 'whole' };
    targetFileId: string;
    targetFileName: string;
    baseContent: string;
    nextContent: string;
    baseContentHash: string;
    diffLines: DiffLine[];
  } | null>(null);
  const [noteRevisions, setNoteRevisions] = useState<WorkbenchNoteRevision[]>([]);
  const [isLoadingRevisions, setIsLoadingRevisions] = useState(false);
  const [isRevertingRevision, setIsRevertingRevision] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedModelEntry = useMemo(
    () => availableModels.find((item) => `${item.provider}:${item.model}` === selectedModel) || availableModels[0] || null,
    [availableModels, selectedModel]
  );
  const openComposerMenu = (menu: 'attachment' | 'context' | 'model' | 'scope') => {
    setAttachmentMenuOpen((open) => (menu === 'attachment' ? !open : false));
    setContextModeMenuOpen((open) => (menu === 'context' ? !open : false));
    setModelMenuOpen((open) => (menu === 'model' ? !open : false));
    setDebugOpen((open) => (menu === 'scope' ? !open : false));
  };
  const messages = useMemo(
    () => (Array.isArray(editor.viewState?.messages) ? editor.viewState.messages : []),
    [editor.viewState?.messages]
  );
  const chatSessionAttachments = useMemo(
    () =>
      Array.isArray(editor.viewState?.chatSessionAttachments)
        ? ((editor.viewState.chatSessionAttachments as any[]) as AiChatAttachment[])
        : [],
    [editor.viewState?.chatSessionAttachments]
  );
  const storedContextMode = editor.viewState?.contextMode as AiContextMode | 'workspace' | undefined;
  const contextMode: AiContextMode =
    storedContextMode === 'workspace' || storedContextMode === 'selection_only'
      ? 'auto'
      : storedContextMode || 'auto';
  const hiddenChipIds = useMemo(
    () =>
      new Set(
        Array.isArray(editor.viewState?.hiddenContextChipIds)
          ? (editor.viewState.hiddenContextChipIds as string[])
          : []
      ),
    [editor.viewState?.hiddenContextChipIds]
  );
  const lockedSelection = useMemo(
    () =>
      editor.viewState?.lockedContextSelection && typeof editor.viewState.lockedContextSelection === 'object'
        ? (editor.viewState.lockedContextSelection as AiLockedSelectionContext)
        : null,
    [editor.viewState?.lockedContextSelection]
  );
  const droppedContextSelections = useMemo(
    () =>
      Array.isArray(editor.viewState?.droppedContextSelections)
        ? ((editor.viewState.droppedContextSelections as any[]) as DroppedContextSelection[])
        : [],
    [editor.viewState?.droppedContextSelections]
  );
  const persistentCitations = useMemo(
    () =>
      Array.isArray(editor.viewState?.persistentCitations)
        ? ((editor.viewState.persistentCitations as any[]) as Array<{
            sourceId?: string;
            fileId: string;
            fileName: string;
            label: string;
            locator?: Record<string, any>;
            confidence?: 'high' | 'medium' | 'low';
            preview?: string;
            supportSnippets?: Array<{ text: string; locator?: Record<string, any>; score?: number }>;
            citationQuality?: {
              supportCount?: number;
              sourceCount?: number;
              grounded?: boolean;
            };
            createdAt?: string;
          }>)
        : [],
    [editor.viewState?.persistentCitations]
  );
  const workbenchResourceFiles = useMemo(
    () => resources.filter((item) => item.type !== 'folder').slice(0, 12),
    [resources]
  );
  const resourceScopeLabel = workbenchResourceFiles.length
    ? `资源范围：当前 Workbench ${workbenchResourceFiles.length} 个文件`
    : '资源范围：当前 Workbench 暂无文件';
  const activePanelContext = useMemo(
    () =>
      aiContext?.openPanels?.find((panel) => panel.panelId === aiContext.activePanelId) ||
      aiContext?.openPanels?.find((panel) => panel.fileId === aiContext.activeFileId) ||
      aiContext?.openPanels?.[0],
    [aiContext?.activeFileId, aiContext?.activePanelId, aiContext?.liveContextVersion, aiContext?.openPanels]
  );
  const canApplyNoteEdit = useMemo(
    () => Boolean(onApplyNoteEdit && isUserWorkbenchNote(aiContext?.activeFile, activePanelContext)),
    [activePanelContext, aiContext?.activeFile, onApplyNoteEdit]
  );

  const activeNoteFileId = aiContext?.activeFile?.id || activePanelContext?.fileId || '';

  const aiWelcomeSignature = useMemo(
    () => buildAiWelcomeSignature(aiContext),
    [
      aiContext?.activeFileId,
      aiContext?.activePanelId,
      aiContext?.workbenchId,
      aiContext?.workbenchTitle,
      activePanelContext?.panelId,
      activePanelContext?.fileName,
      activePanelContext?.selectedText,
      activePanelContext?.visibleContent,
      aiContext?.openPanels?.length
    ]
  );

  useEffect(() => {
    if (messages.length > 0) return;
    const cached = aiWelcomeCache.get(aiWelcomeSignature);
    if (cached) {
      setAiWelcomeContent(cached);
      setWelcomeError(null);
      setIsWelcomeLoading(false);
      return;
    }

    let cancelled = false;
    setIsWelcomeLoading(true);
    setWelcomeError(null);
    setAiWelcomeContent(null);
    const timer = window.setTimeout(() => {
      void aiApi
        .chatWelcome({ context: aiContext })
        .then((content) => {
          if (cancelled) return;
          rememberAiWelcomeContent(aiWelcomeSignature, content);
          setAiWelcomeContent(content);
        })
        .catch((error) => {
          if (cancelled) return;
          setWelcomeError(error instanceof Error ? error.message : 'AI 起始建议生成失败');
        })
        .finally(() => {
          if (!cancelled) setIsWelcomeLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiContext, aiWelcomeSignature, messages.length]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-ai-composer-menu]')) return;
      setAttachmentMenuOpen(false);
      setContextModeMenuOpen(false);
      setModelMenuOpen(false);
      setDebugOpen(false);
    };
    window.addEventListener('mousedown', closeMenus);
    return () => window.removeEventListener('mousedown', closeMenus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void aiApi
      .listModels()
      .then((response) => {
        if (cancelled) return;
        setAvailableModels(Array.isArray(response.models) ? response.models : []);
        if (Array.isArray(response.models) && response.models[0]?.model) {
          setSelectedModel(`${response.models[0].provider}:${response.models[0].model}`);
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const handleSelectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as WorkbenchContextSelectionActionDetail | undefined;
      if (!detail?.prompt) return;
      if ((detail.prompt === '__lock_pdf_selection__' || detail.prompt === '__lock_context_selection__') && detail.text) {
        addDroppedContextSelection(detail);
        return;
      }
      setInput(detail.prompt);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };

    window.addEventListener('workbench:pdf-selection-action', handleSelectionAction);
    window.addEventListener('workbench:context-selection-action', handleSelectionAction);
    return () => {
      window.removeEventListener('workbench:pdf-selection-action', handleSelectionAction);
      window.removeEventListener('workbench:context-selection-action', handleSelectionAction);
    };
  }, [activePanelContext, addDroppedContextSelection, editor.id, onUpdateViewState]);

  const contextChips = useMemo(() => {
    const chips: Array<{
      id: string;
      kind: 'selection' | 'viewport' | 'active_file' | 'resource_scope';
      label: string;
      detail: string;
    }> = [];
    const selectedText =
      activePanelContext?.selectedText?.trim() || aiContext?.selectedText?.trim() || '';
    const lineRange = activePanelContext?.visibleLineRange || null;
    const selectedRange = activePanelContext?.selectedRange || null;
    const visiblePages = activePanelContext?.visiblePages || [];
    const fileName =
      activePanelContext?.fileName || aiContext?.activeFile?.name || activePanelContext?.title || '当前内容';

    if (lockedSelection?.content?.trim()) {
      const locator = lockedSelection.locator || {};
      const loc = locator.page
        ? `第${locator.page}页`
        : typeof locator.timestampStart === 'number'
          ? `${formatVideoTime(locator.timestampStart)}${typeof locator.timestampEnd === 'number' ? `-${formatVideoTime(locator.timestampEnd)}` : ''}`
        : typeof locator.lineStart === 'number'
          ? `第${locator.lineStart}-${locator.lineEnd || locator.lineStart}行`
          : '锁定选区';
      chips.push({
        id: `selection:${lockedSelection.id || lockedSelection.fileId || 'locked'}`,
        kind: 'selection',
        label: `已锁定：${lockedSelection.fileName || '选区'} ${loc} · ${lockedSelection.content.length}字`,
        detail: [
          `locator: ${JSON.stringify(locator)}`,
          lockedSelection.content
        ].join('\n\n')
      });
    }

    if (selectedText && !lockedSelection?.content?.trim()) {
      const loc = selectedRange?.page
        ? `第${selectedRange.page}页`
        : typeof selectedRange?.timestampStart === 'number'
          ? `${formatVideoTime(selectedRange.timestampStart)}${typeof selectedRange.timestampEnd === 'number' ? `-${formatVideoTime(selectedRange.timestampEnd)}` : ''}`
        : typeof selectedRange?.lineStart === 'number'
          ? `第${selectedRange.lineStart}-${selectedRange.lineEnd || selectedRange.lineStart}行`
        : visiblePages[0]
          ? `第${visiblePages[0]}页`
        : lineRange
          ? `第${lineRange.start}-${lineRange.end}行`
          : '选中内容';
      const lengthLabel = selectedText.length > 0 ? ` · ${selectedText.length}字` : '';
      chips.push({
        id: `selection:${activePanelContext?.panelId || aiContext?.activeFileId || 'current'}`,
        kind: 'selection',
        label: `选区：${fileName} ${loc}${lengthLabel}`,
        detail: [
          selectedRange
            ? `locator: ${JSON.stringify({
                page: selectedRange.page,
                pageStart: selectedRange.pageStart,
                pageEnd: selectedRange.pageEnd,
                timestampStart: selectedRange.timestampStart,
                timestampEnd: selectedRange.timestampEnd,
                segmentIds: selectedRange.segmentIds,
                sourceType: selectedRange.sourceType,
                lineStart: selectedRange.lineStart,
                lineEnd: selectedRange.lineEnd,
                charStart: selectedRange.charStart,
                charEnd: selectedRange.charEnd,
                rects: selectedRange.rects?.slice?.(0, 3)
              })}`
            : '',
          selectedText
        ]
          .filter(Boolean)
          .join('\n\n')
      });
    }

    if (activePanelContext) {
      const loc = visiblePages.length
        ? `第${visiblePages.join(',')}页`
        : lineRange
          ? `第${lineRange.start}-${lineRange.end}行`
          : typeof activePanelContext.scrollRatio === 'number'
            ? `滚动 ${Math.round(activePanelContext.scrollRatio * 100)}%`
            : '当前可见区域';
      chips.push({
        id: `viewport:${activePanelContext.panelId}`,
        kind: 'viewport',
        label: `可见范围：${fileName} ${loc}`,
        detail: activePanelContext.visibleContent || '暂无可见文本，后端会尽量使用文件索引与定位信息。'
      });
    }

    if (aiContext?.activeFile) {
      chips.push({
        id: `active:${aiContext.activeFile.id}`,
        kind: 'active_file',
        label: `当前文件：${aiContext.activeFile.name}`,
        detail: aiContext.activeFileContent?.slice(0, 2000) || aiContext.activeFile.path || ''
      });
    }

    const resourceCount =
      new Set((aiContext?.openPanels || []).map((panel) => panel.fileId).filter(Boolean)).size ||
      (aiContext?.activeFile ? 1 : 0);
    if (resourceCount > 0) {
      chips.push({
        id: 'scope:workbench',
        kind: 'resource_scope',
        label: `资源范围：当前 Workbench ${resourceCount} 个文件`,
        detail: (aiContext?.openPanels || [])
          .filter((panel) => panel.fileName)
          .map((panel) => panel.fileName)
          .join('\n')
      });
    }

    return chips.filter((chip) => !hiddenChipIds.has(chip.id));
  }, [activePanelContext, aiContext, hiddenChipIds, lockedSelection]);
  const inspectedChip = contextChips.find((chip) => chip.id === inspectedChipId) || null;
  const pinnedContextChips = [
    ...droppedContextSelections.map((selection) => ({
      id: selection.id,
      kind: 'selection' as const,
      label: (() => {
        const locator = selection.selectedRange || {};
        const timeLabel =
          typeof locator.timestampStart === 'number'
            ? `${formatVideoTime(locator.timestampStart)}${typeof locator.timestampEnd === 'number' && locator.timestampEnd !== locator.timestampStart ? `-${formatVideoTime(locator.timestampEnd)}` : ''}`
            : '';
        return [selection.sourceLabel || '引用', selection.fileName, timeLabel].filter(Boolean).join(' · ');
      })(),
      detail: selection.text,
      selection
    })),
    ...contextChips.filter((chip) => chip.kind === 'active_file')
  ];
  const menuContextChips = contextChips.filter((chip) => chip.kind !== 'selection' && chip.kind !== 'active_file');
  const lastAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') return index;
    }
    return -1;
  }, [messages]);

  const hideChip = (chipId: string) => {
    if (chipId.startsWith('dropped:')) {
      removeDroppedContextSelection(chipId);
      return;
    }
    const next = [...hiddenChipIds, chipId];
    onUpdateViewState?.(editor.id, { hiddenContextChipIds: next });
    if (inspectedChipId === chipId) setInspectedChipId(null);
  };

  const lockCurrentSelection = () => {
    const selectedText = activePanelContext?.selectedText?.trim() || aiContext?.selectedText?.trim() || '';
    if (!selectedText || !activePanelContext) return;
    const locator = {
      ...(activePanelContext.selectedRange || {}),
      lineStart: activePanelContext.visibleLineRange?.start,
      lineEnd: activePanelContext.visibleLineRange?.end,
      blockIds: activePanelContext.visibleBlockIds,
      scrollRatio: activePanelContext.scrollRatio ?? undefined,
      chunkIndex: activePanelContext.approxChunkIndex ?? undefined
    };
    onUpdateViewState?.(editor.id, {
      lockedContextSelection: {
        id: `locked:${activePanelContext.fileId || activePanelContext.panelId}:${Date.now()}`,
        panelId: activePanelContext.panelId,
        panelType: activePanelContext.panelType,
        fileId: activePanelContext.fileId,
        fileName: activePanelContext.fileName || activePanelContext.title,
        filePath: activePanelContext.filePath,
        content: selectedText,
        locator,
        createdAt: new Date().toISOString()
      }
    });
  };

  function addDroppedContextSelection(detail: WorkbenchContextSelectionActionDetail) {
    const content = String(detail.text || '').trim();
    if (!content) return;
    const nextSelection: DroppedContextSelection = {
      id: `dropped:${detail.fileId || detail.panelId || 'context'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      panelId: detail.panelId || activePanelContext?.panelId,
      panelType: detail.panelType || activePanelContext?.panelType || 'resource',
      fileId: detail.fileId || activePanelContext?.fileId || null,
      fileName: detail.fileName || activePanelContext?.fileName,
      sourceLabel: detail.sourceLabel,
      text: content,
      selectedRange: detail.selectedRange || {
        page: detail.page,
        pageStart: detail.page,
        pageEnd: detail.page,
        textLength: content.length
      },
      createdAt: new Date().toISOString()
    };
    onUpdateViewState?.(editor.id, {
      droppedContextSelections: [...droppedContextSelections, nextSelection].slice(-8)
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const removeDroppedContextSelection = (selectionId: string) => {
    onUpdateViewState?.(editor.id, {
      droppedContextSelections: droppedContextSelections.filter((selection) => selection.id !== selectionId)
    });
  };

  const clearLockedSelection = () => {
    onUpdateViewState?.(editor.id, { lockedContextSelection: null });
  };

  const setContextMode = (mode: AiContextMode) => {
    onUpdateViewState?.(editor.id, { contextMode: mode });
  };

  const buildDroppedSelectionContext = (): AiLockedSelectionContext | null => {
    if (!droppedContextSelections.length) return null;
    const first = droppedContextSelections[0];
    return {
      id: `dropped-context:${droppedContextSelections.map((selection) => selection.id).join('|')}`,
      panelId: first.panelId,
      panelType: first.panelType || 'video',
      fileId: first.fileId || null,
      fileName: first.fileName,
      content: droppedContextSelections
        .map((selection, index) => {
          const locator = selection.selectedRange || {};
          const timeLabel =
            typeof locator.timestampStart === 'number'
              ? `${formatVideoTime(locator.timestampStart)}${typeof locator.timestampEnd === 'number' && locator.timestampEnd !== locator.timestampStart ? `-${formatVideoTime(locator.timestampEnd)}` : ''}`
              : '';
          const label = [selection.sourceLabel || '引用', selection.fileName, timeLabel].filter(Boolean).join(' · ');
          return `#${index + 1} ${label}\n${selection.text}`;
        })
        .join('\n\n'),
      locator: {
        sourceType: 'dropped_context_group',
        textLength: droppedContextSelections.reduce((sum, selection) => sum + selection.text.length, 0)
      },
      createdAt: new Date().toISOString()
    };
  };

  const jumpToCitation = (citation: { fileId: string; locator?: Record<string, any>; sourceId?: string; preview?: string }) => {
    window.dispatchEvent(
      new CustomEvent('workbench:jump-to-citation', {
        detail: {
          fileId: citation.fileId,
          locator: citation.locator || {},
          sourceId: citation.sourceId,
          preview: citation.preview
        }
      })
    );
  };

  const persistCitation = (
    citation: {
      sourceId?: string;
      fileId: string;
      fileName: string;
      label: string;
      locator?: Record<string, any>;
      confidence?: 'high' | 'medium' | 'low';
    }
  ) => {
    const next = [
      {
        ...citation,
        createdAt: new Date().toISOString()
      },
      ...persistentCitations.filter((item) => `${item.fileId}:${item.label}` !== `${citation.fileId}:${citation.label}`)
    ].slice(0, 12);
    onUpdateViewState?.(editor.id, { persistentCitations: next });
  };

  const removePersistentCitation = (key: string) => {
    onUpdateViewState?.(editor.id, {
      persistentCitations: persistentCitations.filter((item) => `${item.fileId}:${item.label}` !== key)
    });
  };

  const openSourceDetail = (source: CitationUiSource) => {
    setSourceModalSource(source);
  };

  const insertMention = (value: string) => {
    setInput((current) => {
      const separator = current && !current.endsWith(' ') ? ' ' : '';
      return `${current}${separator}${value} `;
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleAttachmentFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;

    const nextAttachments = await Promise.all(
      selectedFiles.map(async (file): Promise<AiChatAttachment> => {
        const kind = inferChatAttachmentKind(file);
        const baseAttachment: AiChatAttachment = {
          id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID?.() || Date.now()}`,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          kind,
          createdAt: new Date().toISOString(),
          status: 'ready'
        };

        if (kind === 'text') {
          const textContent = await readFileAsText(file);
          return {
            ...baseAttachment,
            textContent,
            status: textContent ? 'ready' : 'metadata_only'
          };
        }

        if (file.size <= MAX_INLINE_ATTACHMENT_BYTES) {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            ...baseAttachment,
            dataUrl,
            base64Data: base64FromDataUrl(dataUrl),
            status: dataUrl ? 'ready' : 'metadata_only'
          };
        }

        return {
          ...baseAttachment,
          status: 'metadata_only',
          error:
            kind === 'image'
              ? '图片超过 8MB，当前仅保留附件元数据。'
              : '该文件超过 8MB，当前仅保留附件元数据；可保存到 Workbench 后走资源索引。'
        };
      })
    );

    onUpdateViewState?.(editor.id, {
      chatSessionAttachments: [...chatSessionAttachments, ...nextAttachments].slice(-8)
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (attachmentId: string) => {
    onUpdateViewState?.(editor.id, {
      chatSessionAttachments: chatSessionAttachments.filter((attachment) => attachment.id !== attachmentId)
    });
  };

  const saveAttachmentToWorkbench = async (attachment: AiChatAttachment) => {
    if (!aiContext?.workbenchId || savingAttachmentId) return;
    setSavingAttachmentId(attachment.id);
    try {
      const file = await fileFromChatAttachment(attachment);
      if (!file) {
        setError('这个附件当前只有元数据，无法直接保存。请从资源面板重新上传原文件。');
        return;
      }
      const result = await fileSystemApi.upload(workspaceId, [file], undefined, undefined, {
        workbenchId: aiContext.workbenchId,
        resourceRole: 'source',
        scope: 'workbench',
        origin: 'chat_attachment',
        metadata: {
          source: 'ai_chat_attachment',
          chatSessionId: editor.id,
          attachmentId: attachment.id
        }
      });
      const createdFile = Array.isArray(result?.results)
        ? result.results.find((item: any) => item?.success)?.file
        : result?.file || result;
      onUpdateViewState?.(editor.id, {
        chatSessionAttachments: chatSessionAttachments.map((item) =>
          item.id === attachment.id
            ? {
                ...item,
                savedToWorkbench: true,
                fileObjectId: createdFile?.id || item.fileObjectId
              }
            : item
        )
      });
    } catch (saveError: any) {
      setError(saveError?.response?.data?.error || saveError?.message || '保存附件到 Workbench 失败。');
    } finally {
      setSavingAttachmentId(null);
    }
  };

  const refreshNoteRevisions = async (fileId = activeNoteFileId) => {
    if (!fileId || !canApplyNoteEdit) return;
    setIsLoadingRevisions(true);
    try {
      const result = await fileSystemApi.listNoteRevisions(workspaceId, fileId, 8);
      setNoteRevisions(result.revisions || []);
    } catch {
      setNoteRevisions([]);
    } finally {
      setIsLoadingRevisions(false);
    }
  };

  useEffect(() => {
    if (!activeNoteFileId || !canApplyNoteEdit) {
      setNoteRevisions([]);
      return;
    }
    void refreshNoteRevisions(activeNoteFileId);
  }, [activeNoteFileId, canApplyNoteEdit, workspaceId]);

  const submitMessages = async ({
    prompt,
    baseMessages
  }: {
    prompt: string;
    baseMessages: AiChatMessage[];
  }) => {
    const trimmedInput = prompt.trim();
    if ((!trimmedInput && chatSessionAttachments.length === 0) || isSending) return;

    const userContent = trimmedInput || '请分析当前 Chat 附件。';
    const selectedNoteText = activePanelContext?.selectedText?.trim() || aiContext?.selectedText?.trim() || '';
    const hasSelectedNoteText = Boolean(selectedNoteText);
    const shouldRequestNoteEditProposal =
      canApplyNoteEdit &&
      NOTE_EDIT_INTENT_PATTERN.test(userContent) &&
      (NOTE_EDIT_TARGET_PATTERN.test(userContent) || hasSelectedNoteText) &&
      Boolean(aiContext?.activeFile?.id || activePanelContext?.fileId);
    const noteEditProposalMode: 'selection' | 'whole' =
      shouldRequestNoteEditProposal && hasSelectedNoteText && !WHOLE_NOTE_EDIT_PATTERN.test(userContent) ? 'selection' : 'whole';
    const createdAt = new Date().toISOString();

    const previousMessages = [...baseMessages] as AiChatMessage[];
    const pendingAttachments = chatSessionAttachments.map((attachment) => ({ ...attachment }));
    const messageAttachments = pendingAttachments.map(stripAttachmentPayload);
    const nextMessages: AiChatMessage[] = [
      ...previousMessages,
      { role: 'user', content: userContent, createdAt, attachments: messageAttachments }
    ];

    onUpdateViewState?.(editor.id, { messages: nextMessages, chatSessionAttachments: [] });
    setInput('');
    setError(null);
    setTimeline([]);
    setThinkingTraceOpen(true);
    setIsSending(true);

    try {
      const effectiveContextMode: AiContextMode = /@选区/.test(trimmedInput)
        ? 'selection_only'
        : /@当前页|@可见/.test(trimmedInput)
          ? 'viewport'
          : /@当前文件/.test(trimmedInput)
            ? 'active_file'
            : /@Workbench/i.test(trimmedInput)
              ? 'workbench'
              : /@模型知识|@模型|@通用知识/i.test(trimmedInput)
                ? 'model_knowledge'
                : contextMode;
      const assistantCreatedAt = new Date().toISOString();
      const targetNoteFileId = aiContext?.activeFile?.id || activePanelContext?.fileId;
      const droppedSelectionContext = buildDroppedSelectionContext();
      const activeContextChipsForRequest = contextChips.map((chip) => ({
        id: chip.id,
        kind: chip.kind,
        enabled: true
      }));
      if (droppedSelectionContext?.content?.trim() && !activeContextChipsForRequest.some((chip) => chip.kind === 'selection')) {
        activeContextChipsForRequest.unshift({
          id: droppedSelectionContext.id || 'dropped-context-selection',
          kind: 'selection' as const,
          enabled: true
        });
      }
      const droppedSelectionCitations = droppedContextSelections.map((selection, index) => ({
        sourceId: `D${index + 1}`,
        fileId: selection.fileId || selection.panelId || `dropped-${index + 1}`,
        fileName: selection.fileName || selection.sourceLabel || '视频引用',
        label: (() => {
          const locator = selection.selectedRange || {};
          const timeLabel =
            typeof locator.timestampStart === 'number'
              ? `${formatVideoTime(locator.timestampStart)}${typeof locator.timestampEnd === 'number' && locator.timestampEnd !== locator.timestampStart ? `-${formatVideoTime(locator.timestampEnd)}` : ''}`
              : '';
          return [selection.sourceLabel || '视频引用', selection.fileName, timeLabel].filter(Boolean).join(' · ');
        })(),
        locator: selection.selectedRange,
        confidence: 'high' as const,
        preview: selection.text
      }));
      const baseContentHash = shouldRequestNoteEditProposal
        ? await hashText(aiContext?.activeFileContent || '')
        : null;
      const initialAssistantContent = shouldRequestNoteEditProposal
        ? `${buildNoteEditProposalMarker(targetNoteFileId, baseContentHash)}\n`
        : '';
      let assistantContent = initialAssistantContent;
      const streamMessages: AiChatMessage[] = [...nextMessages, { role: 'assistant', content: initialAssistantContent, createdAt: assistantCreatedAt }];
      const requestMessages = shouldRequestNoteEditProposal
        ? nextMessages.map((message, messageIndex) =>
            messageIndex === nextMessages.length - 1
              ? {
                  ...message,
                  content: `${message.content}${buildNoteEditInstruction(
                    aiContext?.activeFile?.name || activePanelContext?.fileName,
                    aiContext?.activeFile?.path || activePanelContext?.filePath,
                    selectedNoteText,
                    noteEditProposalMode
                  )}`
                }
              : message
          )
        : nextMessages;
      const contextPayload = {
        userId: aiContext?.userId,
        sessionId: editor.id,
        workbenchTitle: aiContext?.workbenchTitle,
        workbenchDescription: aiContext?.workbenchDescription,
        workspaceId,
        workbenchId: aiContext?.workbenchId,
        liveContextVersion: aiContext?.liveContextVersion,
        liveContextUpdatedAt: aiContext?.liveContextUpdatedAt,
        contextMode: effectiveContextMode,
        lockedSelection: droppedSelectionContext || lockedSelection,
        persistentCitations: [...droppedSelectionCitations, ...persistentCitations],
        activeContextChips: activeContextChipsForRequest,
        activePanelId: aiContext?.activePanelId,
        activeFileId: aiContext?.activeFileId || aiContext?.activeFile?.id || null,
        preferredProvider: selectedModelEntry?.provider || undefined,
        preferredModel: selectedModelEntry?.model || undefined,
        activeFile: aiContext?.activeFile
          ? {
              ...aiContext.activeFile,
              content: aiContext.activeFileContent || undefined
            }
          : null,
        activeExternal: aiContext?.activeExternal || null,
        openPanels: aiContext?.openPanels || [],
        visiblePanels: aiContext?.visiblePanels || [],
        chatSessionAttachments,
        selectedText:
          window.getSelection()?.toString().trim() ||
          activePanelContext?.selectedText ||
          aiContext?.selectedText ||
          '',
        recentMessages: nextMessages.map((message) => ({
          ...message,
          attachments: message.attachments?.map(stripAttachmentPayload)
        }))
      };

      onUpdateViewState?.(editor.id, { chatSessionAttachments: [] });
      onUpdateViewState?.(editor.id, { droppedContextSelections: [] });
      onUpdateViewState?.(editor.id, { messages: streamMessages });

      const response = await aiApi.chatStream(
        {
          messages: requestMessages,
          context: contextPayload
        },
        {
          onDelta: (delta) => {
            assistantContent += delta;
            streamMessages[streamMessages.length - 1] = {
              role: 'assistant',
              content: assistantContent,
              createdAt: assistantCreatedAt
            };
            onUpdateViewState?.(editor.id, { messages: [...streamMessages] });
          },
          onReplace: (content) => {
            assistantContent = `${initialAssistantContent}${content}`;
            streamMessages[streamMessages.length - 1] = {
              role: 'assistant',
              content: assistantContent,
              createdAt: assistantCreatedAt
            };
            onUpdateViewState?.(editor.id, { messages: [...streamMessages] });
          },
          onTimeline: (nextTimeline) => setTimeline(nextTimeline),
          onMeta: (meta) => {
            onUpdateViewState?.(editor.id, {
              lastModel: meta.model || selectedModelEntry?.model || 'deepseek-chat'
            });
          }
        }
      );

      setTimeline(response.timeline || []);
      streamMessages[streamMessages.length - 1] = {
        role: 'assistant',
        content: `${initialAssistantContent}${response.reply}`,
        createdAt: assistantCreatedAt
      };
      onUpdateViewState?.(editor.id, {
        messages: [...streamMessages],
        lastModel: response.model || selectedModelEntry?.model || 'deepseek-chat'
      });
    } catch (sendError: any) {
      const message =
        sendError?.response?.data?.error ||
        sendError?.message ||
        'AI request failed. Please check the backend configuration.';
      setError(
        message === 'fetch failed'
          ? 'AI 请求失败：后端或检索模型服务暂时不可用。已更新为本地 BM25 降级链路，请重启后端后重试。'
          : message
      );
      onUpdateViewState?.(editor.id, { messages: previousMessages, chatSessionAttachments: pendingAttachments });
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    await submitMessages({
      prompt: input,
      baseMessages: [...messages] as AiChatMessage[]
    });
  };

  const copyMessage = async (content: string, index: number) => {
    await navigator.clipboard?.writeText(content).catch(() => undefined);
    setCopiedMessageIndex(index);
    window.setTimeout(() => setCopiedMessageIndex(null), 1200);
  };

  const deleteMessage = (index: number) => {
    const next = [...(messages as AiChatMessage[])];
    const removed = next[index];
    next.splice(index, 1);
    if (removed?.role === 'user' && next[index]?.role === 'assistant') {
      next.splice(index, 1);
    }
    onUpdateViewState?.(editor.id, { messages: next });
  };

  const startEditMessage = (index: number, content: string) => {
    setEditingMessageIndex(index);
    setEditingMessageContent(content.split('\n\n【本轮临时附件】')[0]);
  };

  const saveEditMessage = async (index: number) => {
    const next = [...messages] as AiChatMessage[];
    next[index] = {
      ...next[index],
      content: editingMessageContent.trim() || next[index].content,
      createdAt: next[index].createdAt || new Date().toISOString()
    };
    setEditingMessageIndex(null);
    setEditingMessageContent('');
    onUpdateViewState?.(editor.id, { messages: next });
  };

  const regenerateFrom = async (assistantIndex: number) => {
    if (isSending) return;
    const history = [...messages] as AiChatMessage[];
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && history[userIndex].role !== 'user') userIndex -= 1;
    if (userIndex < 0) return;
    const userPrompt = history[userIndex].content.split('\n\n【本轮临时附件】')[0];
    await submitMessages({
      prompt: userPrompt,
      baseMessages: history.slice(0, userIndex)
    });
  };

  const openNoteEditPreview = async (
    messageIndex: number,
    proposal: { content: string; targetFileId?: string | null; baseContentHash?: string | null; mode?: 'selection' | 'whole' }
  ) => {
    const targetFileId = proposal.targetFileId || aiContext?.activeFile?.id || activePanelContext?.fileId;
    const targetFileName = aiContext?.activeFile?.name || activePanelContext?.fileName || '当前笔记';
    if (!targetFileId || !onApplyNoteEdit) return;
    const baseContent = aiContext?.activeFileContent || '';
    const baseContentHash = proposal.baseContentHash || await hashText(baseContent);
    const selectedText = activePanelContext?.selectedText?.trim() || aiContext?.selectedText?.trim() || '';
    const mode = proposal.mode || 'whole';
    const nextContent =
      mode === 'selection'
        ? replaceUniqueSelectedText(baseContent, selectedText, proposal.content)
        : proposal.content;
    if (!nextContent) {
      setError('AI 已生成修改，但无法在当前 markdown 中精确定位选区。请重新选择一段连续文本，或让 AI 输出整篇笔记版本。');
      return;
    }
    setNoteEditPreview({
      messageIndex,
      proposal: { ...proposal, mode },
      targetFileId,
      targetFileName,
      baseContent,
      nextContent,
      baseContentHash,
      diffLines: buildLineDiff(baseContent, nextContent)
    });
  };

  const applyNoteEditProposal = async () => {
    if (!noteEditPreview || !onApplyNoteEdit) return;

    const { messageIndex, targetFileId, baseContentHash, nextContent } = noteEditPreview;
    const key = `${messageIndex}:${targetFileId}`;
    setApplyingNoteEditKey(key);
    setError(null);
    try {
      await fileSystemApi.saveContentWithRevision(workspaceId, {
        id: targetFileId,
        content: nextContent,
        baseContentHash,
        revisionSummary: 'AI note edit applied from chat',
        actionType: 'ai_note_edit',
        actor: 'ai'
      });
      await onApplyNoteEdit(targetFileId, nextContent);
      setNoteEditPreview(null);
      setAppliedNoteEditKey(key);
      void refreshNoteRevisions(targetFileId);
      window.setTimeout(() => setAppliedNoteEditKey((current) => (current === key ? null : current)), 1800);
    } catch (applyError: any) {
      const rawError = applyError?.response?.data?.error || applyError?.message || '应用笔记修改失败。';
      try {
        const parsed = JSON.parse(rawError);
        setError(parsed?.message || rawError);
        if (parsed?.currentContent) {
          setNoteEditPreview((current) =>
            current
              ? {
                  ...current,
                  baseContent: parsed.currentContent,
                  baseContentHash: parsed.currentContentHash || current.baseContentHash,
                  diffLines: buildLineDiff(parsed.currentContent, current.nextContent)
                }
              : current
          );
        }
      } catch {
        setError(rawError);
      }
    } finally {
      setApplyingNoteEditKey(null);
    }
  };

  const revertLatestNoteRevision = async () => {
    if (!activeNoteFileId || noteRevisions.length === 0 || !onApplyNoteEdit) return;
    const latest = noteRevisions[0];
    const confirmed = window.confirm(`撤销最近一次笔记修改（Revision ${latest.revisionNumber}）？`);
    if (!confirmed) return;

    setIsRevertingRevision(true);
    setError(null);
    try {
      const result = await fileSystemApi.revertNoteRevision(workspaceId, activeNoteFileId, {
        revisionId: latest.id,
        actor: 'user'
      });
      await onApplyNoteEdit(activeNoteFileId, result.afterContent);
      void refreshNoteRevisions(activeNoteFileId);
    } catch (revertError: any) {
      setError(revertError?.response?.data?.error || revertError?.message || '撤销笔记修改失败。');
    } finally {
      setIsRevertingRevision(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <SourceDetailModal
        source={sourceModalSource}
        onClose={() => setSourceModalSource(null)}
        onJump={(source) => {
          jumpToCitation(source);
          setSourceModalSource(null);
        }}
        onPin={persistCitation}
      />
      {!hideHeader && (
        <div className="border-b border-[#eeeeeb] bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-[#16833a]" />
            <div className="truncate text-sm font-medium text-[#25272b]">
              {editor.title || 'AI Assistant'}
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          {hideHeader && error && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {error}
            </div>
          )}
          {messages.length === 0 && (
            <div className={`ai-message-in mr-auto flex w-full max-w-2xl flex-col items-start ${compactWelcome ? 'pt-5' : 'pt-12'}`}>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e5e5e1] bg-white text-[#202124] shadow-[0_14px_34px_rgba(15,23,42,0.1)] transition-transform duration-300 hover:scale-[1.03]">
                <Bot className="h-7 w-7" />
              </div>
              <h2 className="max-w-xl text-left text-2xl font-bold tracking-0 text-[#25272b]">
                {aiWelcomeContent?.greeting || (isWelcomeLoading ? '正在结合上下文准备建议...' : 'AI 建议暂时没有生成成功')}
              </h2>
              <div className="mt-7 grid w-full max-w-xl gap-2">
                {aiWelcomeContent?.actions.map((suggestion) => (
                  <button
                    key={`${suggestion.icon}-${suggestion.label}`}
                    type="button"
                    onClick={() => {
                      setInput(suggestion.label);
                      window.setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="ai-soft-button flex items-center gap-3 rounded-xl px-4 py-2.5 text-left text-[15px] font-medium text-[#34373c] hover:bg-[#f6f6f4]"
                  >
                    {getWelcomeActionIcon(suggestion)}
                    <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                  </button>
                ))}
                {isWelcomeLoading && (
                  <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-left text-[15px] font-medium text-[#777a80]">
                    <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin" />
                    <span>正在生成适合当前内容的开场建议</span>
                  </div>
                )}
                {!isWelcomeLoading && welcomeError && !aiWelcomeContent && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
                    暂时没能生成 AI 建议，你仍然可以直接输入想做的事。
                  </div>
                )}
              </div>
            </div>
          )}
          {messages.map((message: AiChatMessage, index: number) => {
            const isAssistant = message.role === 'assistant';
            const cleanMessageContent = message.content.replace(NOTE_EDIT_PROPOSAL_MARKER_PATTERN, '').trimStart();
            const displayContent = cleanMessageContent.split('\n\n【本轮临时附件】')[0];
            const messageTime = formatMessageTime(message.createdAt);
            const noteEditProposal =
              isAssistant && canApplyNoteEdit && !(isSending && index === messages.length - 1)
                ? extractSelectionReplacementProposal(message.content) || extractMarkdownProposal(message.content)
                : null;
            const currentTargetFileId = aiContext?.activeFile?.id || activePanelContext?.fileId || '';
            const noteEditTargetMatches = !noteEditProposal?.targetFileId || noteEditProposal.targetFileId === currentTargetFileId;
            const noteEditKey = `${index}:${noteEditProposal?.targetFileId || currentTargetFileId}`;
            const showThinkingTrace = isAssistant && index === lastAssistantIndex && (timeline.length > 0 || (isSending && index === messages.length - 1));
            return (
              <div
                key={`${message.role}-${index}`}
                className={`ai-message-in group flex w-full ${isAssistant ? 'items-start gap-4' : 'justify-end'}`}
              >
                {isAssistant && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#eeeeeb] bg-white text-[#111827]">
                    <Bot className="h-4.5 w-4.5" />
                  </div>
                )}
                <div className={isAssistant ? 'min-w-0 flex-1 border-b border-[#eeeeeb] pb-7' : 'flex max-w-[min(72%,640px)] flex-col items-end'}>
                  {isAssistant ? (
                    <>
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-[#111827]">AI Assistant</span>
                        <span className="text-xs font-medium text-[#a1a1aa] opacity-0 transition-opacity group-hover:opacity-100">
                          {messageTime}
                        </span>
                      </div>
                      {showThinkingTrace && (
                        <ThinkingTrace
                          timeline={timeline}
                          isActive={isSending && index === messages.length - 1}
                          open={thinkingTraceOpen || (isSending && timeline.length === 0)}
                          onToggle={() => setThinkingTraceOpen((value) => !value)}
                        />
                      )}
                      <MarkdownPreview
                        content={cleanMessageContent || ''}
                        variant="message"
                        citationSources={[]}
                        onCitationJump={jumpToCitation}
                        isStreaming={isSending && index === messages.length - 1}
                      />
                      {noteEditProposal && noteEditTargetMatches && (
                        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#d7e8d2] bg-[#f7fbf6] px-3 py-2">
                          <div className="min-w-0 flex-1 text-xs text-[#4f5f4a]">
                            可应用到当前用户笔记：{aiContext?.activeFile?.name || activePanelContext?.fileName || '当前笔记'}
                          </div>
                          <button
                            type="button"
                            onClick={() => void openNoteEditPreview(index, noteEditProposal)}
                            disabled={applyingNoteEditKey === noteEditKey}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#202124] px-3 text-xs font-semibold text-white hover:bg-[#34373c] disabled:cursor-not-allowed disabled:bg-[#c9cbc7]"
                            title="确认后写入当前笔记"
                          >
                            {applyingNoteEditKey === noteEditKey ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : appliedNoteEditKey === noteEditKey ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <PencilLine className="h-3.5 w-3.5" />
                            )}
                            {appliedNoteEditKey === noteEditKey ? '已应用' : '应用到笔记'}
                          </button>
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => void copyMessage(cleanMessageContent, index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Copy">
                          {copiedMessageIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button onClick={() => void regenerateFrom(index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Regenerate">
                          <RefreshCcw className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <MessageAttachmentStrip attachments={message.attachments} />
                      <div className="mb-1 flex items-center gap-2 pr-2 text-xs font-medium text-[#a1a1aa] opacity-0 transition-opacity group-hover:opacity-100">
                        <span>{messageTime}</span>
                      </div>
                      <div className="rounded-[20px] bg-[#f4f4f5] px-4 py-2.5 text-[14px] leading-6 text-[#374151] shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5">
                        {editingMessageIndex === index ? (
                          <div className="w-[min(520px,calc(100vw-7rem))]">
                            <textarea
                              value={editingMessageContent}
                              onChange={(event) => setEditingMessageContent(event.target.value)}
                              className="block min-h-[76px] w-full resize-y rounded-2xl border border-[#e5e7eb] bg-white p-3 text-sm text-[#111827] outline-none focus:border-[#111827]"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button onClick={() => setEditingMessageIndex(null)} className="rounded-full px-3 py-1.5 text-xs font-medium text-[#6b7280] hover:bg-[#ededee]">Cancel</button>
                              <button onClick={() => void saveEditMessage(index)} className="rounded-full bg-[#111827] px-3 py-1.5 text-xs font-medium text-white">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {displayContent}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => startEditMessage(index, message.content)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Edit">
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => void copyMessage(displayContent, index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Copy">
                          {copiedMessageIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button onClick={() => deleteMessage(index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#fef2f2] hover:text-[#b91c1c]" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canApplyNoteEdit && activeNoteFileId && (
        <div className="border-t border-[#eeeeeb] bg-[#fafafa] px-5 py-2">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 text-xs text-[#6b7280]">
            <div className="min-w-0 truncate">
              {isLoadingRevisions
                ? '正在读取笔记修改历史...'
                : noteRevisions.length
                  ? `最近修改：Revision ${noteRevisions[0].revisionNumber} · ${new Date(noteRevisions[0].createdAt).toLocaleString()}`
                  : '暂无 AI 笔记修改历史'}
            </div>
            <button
              type="button"
              onClick={() => void revertLatestNoteRevision()}
              disabled={noteRevisions.length === 0 || isRevertingRevision}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-white px-3 font-semibold text-[#374151] hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:text-[#a1a1aa]"
              title="撤销最近一次 AI 应用到笔记的修改"
            >
              {isRevertingRevision ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              撤销最近修改
            </button>
          </div>
        </div>
      )}

      {noteEditPreview && (() => {
        const stats = diffStats(noteEditPreview.diffLines);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
            <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
              <div className="flex items-center justify-between gap-3 border-b border-[#eeeeeb] px-5 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#111827]">预览 AI 笔记修改</div>
                  <div className="mt-1 truncate text-xs text-[#6b7280]">
                    {noteEditPreview.targetFileName} · +{stats.added} / -{stats.removed} · base {noteEditPreview.baseContentHash.slice(0, 10)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setNoteEditPreview(null)}
                  className="rounded-lg p-2 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[#fbfbfa] p-4">
                <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white font-mono text-xs leading-5">
                  {noteEditPreview.diffLines.map((line, index) => (
                    <div
                      key={`${line.type}-${index}-${line.text}`}
                      className={`grid grid-cols-[42px_1fr] gap-3 border-b border-white/60 px-3 py-1 ${
                        line.type === 'add'
                          ? 'bg-emerald-50 text-emerald-900'
                          : line.type === 'remove'
                            ? 'bg-rose-50 text-rose-900'
                            : 'bg-white text-[#4b5563]'
                      }`}
                    >
                      <span className="select-none text-right text-[#9ca3af]">
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''}
                      </span>
                      <span className="whitespace-pre-wrap break-words">{line.text || ' '}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eeeeeb] px-5 py-4">
                <div className="text-xs text-[#6b7280]">
                  应用前会再次校验 baseContentHash；如果笔记已变化，会停止覆盖并刷新对比。
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setNoteEditPreview(null)}
                    className="h-9 rounded-lg border border-[#e5e7eb] bg-white px-4 text-sm font-semibold text-[#374151] hover:bg-[#f4f4f5]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyNoteEditProposal()}
                    disabled={Boolean(applyingNoteEditKey)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-semibold text-white hover:bg-[#34373c] disabled:cursor-not-allowed disabled:bg-[#c9cbc7]"
                  >
                    {applyingNoteEditKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    确认应用
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="bg-white px-5 py-4">
        <div className="mx-auto max-w-4xl">
          <div
            data-ai-composer-menu
            className="ai-composer-lift relative rounded-[24px] border border-[#e5e7eb] bg-white p-2.5 shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('application/x-workbench-context-selection')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(event) => {
              const raw = event.dataTransfer.getData('application/x-workbench-context-selection');
              if (!raw) return;
              event.preventDefault();
              try {
                addDroppedContextSelection(JSON.parse(raw) as WorkbenchContextSelectionActionDetail);
              } catch {
                // Ignore malformed drag payloads from outside the workbench.
              }
            }}
          >
            {(pinnedContextChips.length > 0 || persistentCitations.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pinnedContextChips.slice(0, 8).map((chip) => (
                  <span
                    key={chip.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#dfe5dc] bg-[#f7fbf6] px-2 py-0.5 text-[10px] font-medium text-[#4f6f49]"
                  >
                    {chip.kind === 'selection' ? <FileText className="h-3 w-3" /> : <File className="h-3 w-3" />}
                    <button
                      onClick={() => setInspectedChipId(inspectedChipId === chip.id ? null : chip.id)}
                      className="min-w-0 truncate text-left"
                      title={chip.label}
                    >
                      {chip.label}
                    </button>
                    <button
                      onClick={() => hideChip(chip.id)}
                      className="rounded-full p-0.5 text-[#a6a8ab] hover:bg-[#eeeeeb] hover:text-[#34373c]"
                      title="隐藏上下文"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {persistentCitations.length > 0 && (
                  <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#dfe5dc] bg-[#f7fbf6] px-1 py-0.5 text-[10px] font-medium text-[#4f6f49]">
                    <SourcesCapsule
                      sources={persistentCitations.map((citation, index) => ({
                        ...citation,
                        sourceId: citation.sourceId || `P${index + 1}`,
                        confidence: citation.confidence
                      }))}
                      onJump={jumpToCitation}
                      onOpenSource={openSourceDetail}
                      compact
                    />
                    <button
                      onClick={() => onUpdateViewState?.(editor.id, { persistentCitations: [] })}
                      className="rounded-full p-0.5 text-[#a6a8ab] hover:bg-[#eeeeeb] hover:text-[#34373c]"
                      title="清空固定来源"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={1}
              placeholder="使用 AI 处理各种任务..."
              disabled={isSending}
              className="block min-h-[38px] w-full resize-none border-0 bg-transparent px-1 py-1 text-[14px] leading-5 text-[#111827] outline-none placeholder:text-[#a1a1aa]"
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void handleAttachmentFiles(event.target.files);
              }}
            />
            {chatSessionAttachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {chatSessionAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex min-w-0 max-w-[260px] items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-[#fbfbfb] px-2 py-1.5 text-xs text-[#525866]"
                    title={`${attachment.name} · ${attachment.mimeType} · ${formatBytes(attachment.size)}`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-[#6b7280] ring-1 ring-inset ring-[#e5e7eb]">
                      {attachment.kind === 'image' && attachment.dataUrl ? (
                        <img src={attachment.dataUrl} alt={attachment.name} className="h-full w-full object-cover" />
                      ) : attachment.kind === 'image' ? (
                        <Image className="h-3.5 w-3.5" />
                      ) : (
                        <File className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[#25272b]">{attachment.name}</div>
                      <div className="truncate text-[10px] text-[#8a8f98]">{formatBytes(attachment.size)}</div>
                    </div>
                    <button
                      onClick={() => removeAttachment(attachment.id)}
                      className="rounded-full p-1 text-[#a6a8ab] hover:bg-[#eeeeeb] hover:text-[#34373c]"
                      title="Remove attachment"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="relative flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openComposerMenu('attachment')}
                  className="ai-soft-button inline-flex h-8 w-8 items-center justify-center text-[#6f7378] hover:text-[#25272b]"
                  title="Add photos and files"
                >
                  <Plus className="h-4.5 w-4.5" />
                </button>
                {attachmentMenuOpen && (
                  <div data-ai-composer-menu className="ai-menu-pop absolute bottom-full left-0 z-30 mb-2 w-56 rounded-2xl border border-[#e5e5e1] bg-white/95 p-1.5 text-xs text-[#525866] shadow-[0_18px_45px_rgba(15,23,42,0.14)] backdrop-blur">
                    <button
                      type="button"
                      onClick={() => {
                        setAttachmentMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-[#f6f6f4]"
                    >
                      <Image className="h-3.5 w-3.5 text-[#777a80]" />
                      <span>Add photos & files</span>
                    </button>
                  </div>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => openComposerMenu('context')}
                    className="ai-soft-button inline-flex h-8 items-center gap-1.5 text-xs font-medium text-[#666b73] hover:text-[#25272b]"
                    title="Context strategy"
                  >
                    <Hand className="h-3.5 w-3.5" />
                    <span className="max-w-[110px] truncate">
                      {contextMode === 'auto'
                        ? 'Auto context'
                        : contextMode === 'viewport'
                          ? 'Visible context'
                          : contextMode === 'active_file'
                            ? 'Current file'
                            : contextMode === 'workbench'
                              ? 'Workbench'
                              : 'Model knowledge'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {contextModeMenuOpen && (
                    <div data-ai-composer-menu className="ai-menu-pop absolute bottom-full left-0 z-30 mb-2 w-56 rounded-2xl border border-[#e5e5e1] bg-white/95 p-1.5 text-xs text-[#525866] shadow-[0_18px_45px_rgba(15,23,42,0.14)] backdrop-blur">
                      {([
                        ['auto', 'Auto context', Hand],
                        ['viewport', 'Visible context', Eye],
                        ['active_file', 'Current file', FileText],
                        ['workbench', 'Workbench resources', FolderOpen],
                        ['model_knowledge', 'Model knowledge', Brain]
                      ] as Array<[AiContextMode, string, typeof Hand]>).map(([mode, label, Icon]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setContextMode(mode);
                            setContextModeMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-[#f6f6f4]"
                        >
                          <Icon className="h-3.5 w-3.5 text-[#777a80]" />
                          <span className="min-w-0 flex-1">{label}</span>
                          {contextMode === mode && <Check className="h-3.5 w-3.5 text-[#16833a]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => openComposerMenu('scope')}
                    className={`ai-soft-button inline-flex h-8 w-8 items-center justify-center text-[#6f7378] hover:text-[#25272b] ${debugOpen ? 'text-[#25272b]' : ''}`}
                    title="Resource scope"
                  >
                    <Gauge className="h-4 w-4" />
                  </button>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => openComposerMenu('model')}
                    className={`ai-soft-button inline-flex h-8 items-center gap-1.5 text-xs font-medium text-[#666b73] hover:text-[#25272b] ${modelMenuOpen ? 'text-[#25272b]' : ''}`}
                    title="Model"
                  >
                    <Brain className="h-3.5 w-3.5" />
                    <span className="max-w-[120px] truncate">
                      {selectedModelEntry ? selectedModelEntry.model : 'Model'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {modelMenuOpen && (
                    <div data-ai-composer-menu className="ai-menu-pop absolute bottom-full right-0 z-30 mb-2 w-64 rounded-2xl border border-[#e5e5e1] bg-white/95 p-1.5 text-xs text-[#525866] shadow-[0_18px_45px_rgba(15,23,42,0.14)] backdrop-blur">
                      {!availableModels.length && (
                        <div className="px-2.5 py-2 text-[#8a8f98]">No configured chat model</div>
                      )}
                      {availableModels.map((entry) => {
                        const key = `${entry.provider}:${entry.model}`;
                        const isSelected = selectedModel === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setSelectedModel(key);
                              setModelMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-[#f6f6f4] ${isSelected ? 'bg-[#f3f7f2]' : ''}`}
                          >
                            <Brain className="h-3.5 w-3.5 text-[#777a80]" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[#25272b]">{entry.model}</span>
                              <span className="block truncate text-[10px] text-[#8a8f98]">{entry.provider}</span>
                            </span>
                            {isSelected && <Check className="h-3.5 w-3.5 text-[#16833a]" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void handleSend()}
                  disabled={isSending || (!input.trim() && chatSessionAttachments.length === 0)}
                  className="ai-soft-button inline-flex h-8 w-8 items-center justify-center text-[#111827] hover:text-[#000000] disabled:cursor-not-allowed disabled:text-[#c2c3c5]"
                  title="Send"
                >
                  <ArrowUp className="h-4.5 w-4.5 stroke-[2.25]" />
                </button>
              </div>
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => openComposerMenu('scope')}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-[#fbfbfa] px-2.5 py-1 text-[10px] font-medium text-[#5f6368] hover:bg-[#f7fbf6] hover:text-[#25272b]"
              >
                <Gauge className="h-3.5 w-3.5" />
                {resourceScopeLabel}
              </button>
              {debugOpen && (
                <div data-ai-composer-menu className="mt-2 w-full max-w-md rounded-2xl border border-[#e7ece7] bg-white p-3 text-xs text-[#4b5563] shadow-[0_14px_38px_rgba(15,23,42,0.10)]">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#96999d]">资源范围</div>
                  <div className="space-y-1.5">
                    {workbenchResourceFiles.map((item, index) => (
                      <div key={item.id} className="flex items-start gap-2">
                        <span className="mt-0.5 text-[#a1a1aa]">{index + 1}.</span>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {inspectedChip && (
            <div className="mt-2 rounded-2xl border border-[#e5e5e1] bg-[#fbfbfa] p-3 text-xs text-[#34373c]">
              <div className="mb-1 font-semibold">{inspectedChip.label}</div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-mono leading-5 text-[#777a80]">
                {inspectedChip.detail || '暂无文本详情'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkbenchEditorContent({
  editor,
  resource,
  workspaceId,
  content,
  isDirty = false,
  saveStatus = 'idle',
  savedAt,
  saveError,
  isLoading = false,
  onChangeContent,
  onSaveContent,
  onApplyAiNoteEdit,
  onUpdateViewState,
  onBindResource,
  aiContext,
  resources = []
}: WorkbenchEditorContentProps) {
  const detectedResourceKind = getResourceKind(resource);
  const [sourceFileContent, setSourceFileContent] = useState('');
  const effectiveContent =
    detectedResourceKind === 'web' && (content == null || content === '')
      ? sourceFileContent
      : String(content ?? '');
  const sourceMetadata = extractSourceMetadata(effectiveContent);

  useEffect(() => {
    if (!resource?.id || detectedResourceKind !== 'web') return;
    if (content != null && content !== '') return;

    let cancelled = false;
    setSourceFileContent('');
    void fileSystemApi
      .getContent(workspaceId, resource.id)
      .then((response) => {
        if (!cancelled) setSourceFileContent(response.content || '');
      })
      .catch(() => {
        if (!cancelled) setSourceFileContent('');
      });

    return () => {
      cancelled = true;
    };
  }, [content, detectedResourceKind, resource?.id, workspaceId]);

  if (editor.type === 'notes') {
    return (
      <BlockSuiteNotesEditor
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        content={content ?? ''}
        isDirty={isDirty}
        saveStatus={saveStatus}
        savedAt={savedAt}
        saveError={saveError}
        isLoading={Boolean(isLoading)}
        onChangeContent={onChangeContent}
        onSaveContent={onSaveContent}
        onApplyAiNoteEdit={onApplyAiNoteEdit}
        onUpdateViewState={onUpdateViewState}
        onBindResource={onBindResource}
      />
    );
  }

  if (editor.type === 'ai') {
    return (
      <AiEditorView
        editor={editor}
        workspaceId={workspaceId}
        aiContext={aiContext}
        resources={resources}
        onUpdateViewState={onUpdateViewState}
        onApplyNoteEdit={onApplyAiNoteEdit}
      />
    );
  }

  if (editor.type === 'studio') {
    return (
      <AIStudioPanel
        editor={editor}
        workspaceId={workspaceId}
        aiContext={aiContext}
        resources={resources}
        onUpdateViewState={onUpdateViewState}
      />
    );
  }

  if (editor.type === 'external') {
    return <ExternalEditorView editor={editor} />;
  }

  if (!resource) {
    return (
      <div className="flex h-full overflow-hidden flex-col items-center justify-center gap-4 bg-white px-8 text-center">
        <div className="rounded-2xl border border-[#e5e5e1] bg-[#f6f6f4] p-4 text-[#777a80] shadow-sm">
          {getEditorIcon(editor.type)}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#25272b]">No resource bound yet</h3>
          <p className="mt-2 max-w-md text-sm text-[#777a80]">
            This editor references a workspace file. The file content remains in the shared file
            system.
          </p>
        </div>
        <button
          onClick={() => onBindResource(editor.id)}
          className="rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-medium text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4] active:scale-95"
        >
          Bind Resource
        </button>
      </div>
    );
  }

  const resourceKind = getResourceKind(resource);
  const resourceSourceUrl = getResourceSourceUrl(resource);
  const sourceUrl = sourceMetadata.url || resourceSourceUrl;
  const sourceTitle = sourceMetadata.title || resource.name.replace(/\.source$/i, '');
  if (resourceKind === 'html') {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        guideKind="html"
        sourceUrl={fileSystemApi.downloadUrl(workspaceId, resource.id)}
        onUpdateViewState={onUpdateViewState}
      >
        <HtmlVisualizationPreview resource={resource} workspaceId={workspaceId} />
      </ResourcePanelShell>
    );
  }

  if (resourceKind === 'web') {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={{ ...resource, name: sourceTitle }}
        workspaceId={workspaceId}
        guideKind="web"
        sourceUrl={sourceUrl}
        onUpdateViewState={onUpdateViewState}
      >
        <WebSourcePreview
          title={sourceTitle}
          url={sourceUrl}
          body={sourceMetadata.body || effectiveContent}
          workspaceId={workspaceId}
          resource={resource}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
        />
      </ResourcePanelShell>
    );
  }

  if (editor.type === 'video' || resourceKind === 'video') {
    const videoSourceUrl = sourceUrl || resourceSourceUrl;
    return (
      <VideoSourcePanel
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        sourceUrl={videoSourceUrl}
        sourceTitle={sourceTitle}
        onUpdateViewState={onUpdateViewState}
      />
    );
  }

  if (resourceKind === 'pdf' || resourceKind === 'document' || editor.type === 'resource') {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        guideKind="document"
        sourceUrl={fileSystemApi.downloadUrl(workspaceId, resource.id)}
        onUpdateViewState={onUpdateViewState}
      >
        <DocumentPreview
          resource={resource}
          workspaceId={workspaceId}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
        />
      </ResourcePanelShell>
    );
  }

  if (editor.type === 'code' && (resourceKind === 'code' || resourceKind === 'structured')) {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        guideKind="code"
        sourceUrl={fileSystemApi.downloadUrl(workspaceId, resource.id)}
        onUpdateViewState={onUpdateViewState}
      >
        <BlockSuiteCodeEditor
          editor={editor}
          resource={resource}
          content={String(content ?? '')}
          isDirty={isDirty}
          saveStatus={saveStatus}
          savedAt={savedAt}
          saveError={saveError}
          isLoading={isLoading}
          onChangeContent={onChangeContent}
          onSaveContent={onSaveContent}
          onUpdateViewState={onUpdateViewState}
        />
      </ResourcePanelShell>
    );
  }

  return (
    <ResourcePanelShell
      editor={editor}
      resource={resource}
      workspaceId={workspaceId}
      guideKind={resourceKind === 'code' || resourceKind === 'structured' ? 'code' : 'text'}
      sourceUrl={fileSystemApi.downloadUrl(workspaceId, resource.id)}
      onUpdateViewState={onUpdateViewState}
    >
      <TextEditingSurface
        editor={editor}
        resource={resource}
        content={String(content ?? '')}
        isLoading={isLoading}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
      />
    </ResourcePanelShell>
  );
}
