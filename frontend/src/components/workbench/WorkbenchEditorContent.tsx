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
  Lock,
  Loader2,
  Lightbulb,
  MessageCircle,
  Pin,
  PencilLine,
  RefreshCcw,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Unlock,
  Volume2,
  X,
  Video,
  WandSparkles,
  Hand,
  ShieldCheck,
  Shield,
  ArrowUp
} from 'lucide-react';
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
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
  AgentTimelineItem,
  AiLockedSelectionContext
} from '../../services/aiApi';
import { learningApi } from '../../services/learningApi';
import MarkdownPreview from './MarkdownPreview';
import SyntaxHighlightedCode from './SyntaxHighlightedCode';
import {
  OWClipIcon,
  OWChatBubbleIcon,
  OWClockRotateRightIcon,
  OWComponentIcon,
  OWDatabaseIcon,
  OWDocumentPageIcon,
  OWAdjustmentsHorizontalIcon,
  OWDownloadIcon,
  OWGlobeAltIcon,
  OWPlusAltIcon,
  OWPencilSquareIcon,
  OWWrenchIcon,
  OWXMarkIcon
} from '../common/openWebUIIcons';
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

export type WorkbenchContextSelectionActionDetail = {
  prompt?: string;
  submitImmediately?: boolean;
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

type ComposerAttachMenu = 'root' | 'knowledge' | 'notes' | 'chats' | 'webpage';

type QueuedChatRequest = {
  id: string;
  prompt: string;
  attachments: AiChatAttachment[];
  droppedSelections: DroppedContextSelection[];
};

type SelectionAskRequest = {
  question: string;
  prompt: string;
  selectedText: string;
  detail: WorkbenchContextSelectionActionDetail;
};

export type SelectionAskResult = {
  userMessage: AiChatMessage;
  assistantMessage: AiChatMessage;
};

type SelectionAskSubmitHandler = (
  question: string,
  history: AiChatMessage[],
  handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
) => Promise<SelectionAskResult>;
type SelectionExplainSubmitHandler = (
  history: AiChatMessage[],
  handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
) => Promise<SelectionAskResult>;
type SelectionAskAddHandler = (messages: AiChatMessage[]) => void;

const previewCacheKey = (workspaceId: string, resourceId: string) => `${workspaceId}:${resourceId}`;

const normalizeComposerUrl = (value: string) => /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;

const makeComposerTitleFromUrl = (value: string) => {
  try {
    const url = new URL(normalizeComposerUrl(value));
    return url.hostname.replace(/^www\./, '') || 'web-source';
  } catch {
    return 'web-source';
  }
};

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
  onBindResource?: (editorId: string, anchorRect?: DOMRect | null) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  resources?: ResourceReference[];
  minimalPreview?: boolean;
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

const getResourceSize = (resource?: ResourceReference | null) => {
  const directSize = typeof resource?.size === 'number' ? resource.size : undefined;
  const metadataSize = resource?.metadata?.size;
  return directSize ?? (typeof metadataSize === 'number' ? metadataSize : undefined);
};

const parseKnowledgeIndexLifecycle = (value?: string | null): Record<string, any> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const getResourceIndexMeta = (resource?: ResourceReference | null) => {
  const latestJob = resource?.knowledgeIndexJobs?.[0];
  const chunkCount = Number(resource?._count?.knowledgeChunks || resource?.chunkCount || latestJob?.chunkCount || 0);
  const lifecycle = parseKnowledgeIndexLifecycle(latestJob?.errorMessage);
  const stage = String(lifecycle.stage || '').toLowerCase();
  const status = String(latestJob?.status || '').toLowerCase();
  const vectorIndexed = lifecycle.vectorIndexed === true;
  const vectorError = typeof lifecycle.vectorError === 'string' ? lifecycle.vectorError : '';
  const isProcessing = status === 'queued' || status === 'pending' || status === 'running' || ['pending', 'extracting', 'chunking', 'embedding', 'upserting', 'verifying'].includes(stage);

  if (isProcessing) {
    return {
      chunks: chunkCount > 0 ? `${chunkCount} chunks` : 'Indexing',
      status: 'Indexing'
    };
  }

  if (chunkCount > 0) {
    if (status === 'degraded' || stage === 'degraded' || vectorError || !vectorIndexed) {
      return {
        chunks: `${chunkCount} chunks`,
        status: `Vector ${vectorIndexed ? 'ready' : 'not ready'}`
      };
    }

    return {
      chunks: `${chunkCount} chunks`,
      status: 'Indexed'
    };
  }

  if (status === 'failed' || stage === 'failed') {
    return {
      chunks: 'No chunks',
      status: 'Index failed'
    };
  }

  if (latestJob) {
    return {
      chunks: 'No chunks',
      status: 'Not indexed'
    };
  }

  return null;
};

const getResourceHeaderMeta = (resource?: ResourceReference | null) => {
  const items: string[] = [];
  const size = getResourceSize(resource);
  if (typeof size === 'number' && size > 0) {
    items.push(formatBytes(size));
  }

  const indexMeta = getResourceIndexMeta(resource);
  if (indexMeta) {
    items.push(indexMeta.chunks);
    items.push(indexMeta.status);
  }

  return items;
};

type OpenWebUIGuideTab = string;

const openWebUIGuideTabs: Array<{ key: OpenWebUIGuideTab; label: string }> = [
  { key: 'controls', label: 'Control' },
  { key: 'overview', label: 'Overview' }
];

const documentGuideTabs: Array<{ key: OpenWebUIGuideTab; label: string }> = [
  { key: 'controls', label: 'Control' },
  { key: 'outline', label: 'Outline' },
  { key: 'slides', label: 'Slides' }
];

const videoGuideTabs: Array<{ key: OpenWebUIGuideTab; label: string }> = [
  { key: 'controls', label: 'Control' },
  { key: 'summary', label: 'Summary' },
  { key: 'chapters', label: 'Chapters' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'slides', label: 'Slides' },
  { key: 'keypoints', label: 'Key Points' }
];

const getResourceFileSizeLabel = (resource?: ResourceReference | null) => {
  const size = getResourceSize(resource);
  return typeof size === 'number' && size > 0 ? formatBytes(size) : '';
};

function OpenWebUITabs({
  activeTab,
  onChange,
  tabs = openWebUIGuideTabs
}: {
  activeTab: OpenWebUIGuideTab;
  onChange: (tab: OpenWebUIGuideTab) => void;
  tabs?: Array<{ key: OpenWebUIGuideTab; label: string }>;
}) {
  return (
    <div className="flex min-w-0 gap-1 overflow-x-auto text-sm font-medium">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-sm transition ${
            activeTab === tab.key ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function OpenWebUICollapsible({
  title,
  children,
  defaultOpen = true
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left text-sm text-gray-700 transition hover:text-gray-900"
      >
        <span>{title}</span>
        <ChevronUp strokeWidth={3.5} className={`size-3.5 shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      {open ? <div className="mt-1.5 text-sm font-normal text-gray-700">{children}</div> : null}
    </div>
  );
}

function OpenWebUIResourceFileCard({ resource }: { resource: ResourceReference }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2">
      <FileText className="size-4 shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{resource.name}</div>
      <div className="shrink-0 text-xs text-gray-500">{getResourceFileSizeLabel(resource) || 'File'}</div>
    </div>
  );
}

function OpenWebUIParamRows({
  rows
}: {
  rows: Array<{
    label: ReactNode;
    value?: ReactNode;
    onClick?: () => void;
    onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
    draggable?: boolean;
    tone?: 'default' | 'danger' | 'accent';
  }>;
}) {
  return (
    <div className="space-y-0.5 py-0.5">
      {rows.map((row, index) => (
        <button
          key={index}
          type="button"
          onClick={row.onClick}
          onDragStart={row.onDragStart}
          draggable={row.draggable}
          disabled={!row.onClick}
          className={`flex w-full items-center justify-between gap-3 py-0.5 text-left text-xs ${
            row.onClick ? 'cursor-pointer hover:text-gray-900' : 'cursor-default'
          }`}
        >
          <span className="min-w-0 text-gray-700">{row.label}</span>
          <span
            className={`shrink-0 text-right ${
              row.tone === 'danger' ? 'text-red-600' : row.tone === 'accent' ? 'text-blue-600' : 'text-gray-700'
            }`}
          >
            {row.value ?? 'Default'}
          </span>
        </button>
      ))}
    </div>
  );
}

function OpenWebUISectionBreak() {
  return <hr className="my-2 border-gray-50" />;
}

function OpenWebUIGuideShell({
  resource,
  activeTab,
  onTabChange,
  tabs,
  onClose,
  children
}: {
  resource: ResourceReference;
  activeTab: OpenWebUIGuideTab;
  onTabChange: (tab: OpenWebUIGuideTab) => void;
  tabs?: Array<{ key: OpenWebUIGuideTab; label: string }>;
  onClose?: () => void;
  children: ReactNode;
}) {
  const headerMeta = getResourceHeaderMeta(resource);

  return (
    <section className="flex h-full min-h-0 flex-col bg-white text-gray-900">
      <div className="shrink-0 px-2 pb-2 pt-2">
        <div className="flex items-center justify-between gap-4">
          <OpenWebUITabs activeTab={activeTab} onChange={onTabChange} tabs={tabs} />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex shrink-0 items-center justify-center rounded-lg p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
              title="Close"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="mt-3 min-w-0 px-1">
          <div className="truncate text-sm font-medium text-gray-900">{resource.name}</div>
          <div className="mt-1 flex min-w-0 items-center gap-x-1.5 text-xs font-medium text-gray-500">
            <span className="min-w-0 truncate">{resource.path}</span>
            {headerMeta.map((item, index) => (
              <Fragment key={`${item}-${index}`}>
                <span className="shrink-0 text-gray-300">•</span>
                <span className="shrink-0">{item}</span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1 text-sm text-gray-700">{children}</div>
    </section>
  );
}

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
  const [activeGuideTab, setActiveGuideTab] = useState<OpenWebUIGuideTab>('outline');
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

  const startSlideDrag = (event: React.DragEvent<HTMLButtonElement>, segment: ResourceTranscriptSegmentUi) => {
    const locator = segment.locator || {};
    const label = segment.title || `Part ${segment.index + 1}`;
    const detail: WorkbenchContextSelectionActionDetail = {
      fileId: resource.id,
      fileName: resource.name,
      panelType: 'resource',
      sourceLabel: '文档切片',
      selectedRange: {
        page: segment.pageStart ?? locator.page ?? locator.pageStart,
        pageStart: segment.pageStart ?? locator.pageStart ?? locator.page,
        pageEnd: segment.pageEnd ?? locator.pageEnd ?? locator.page ?? segment.pageStart,
        lineStart: locator.lineStart,
        lineEnd: locator.lineEnd,
        textLength: segment.text.length,
        sourceType: 'resource_slide'
      },
      text: `[${intelligenceRangeLabel(segment.locator, segment.pageStart ? `p${segment.pageStart}` : `Part ${segment.index + 1}`)}] ${label}\n${segment.text}`,
      prompt: '请基于我拖入的资源内容回答：'
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-workbench-context-selection', JSON.stringify(detail));
    event.dataTransfer.setData('text/plain', detail.text || segment.text);
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

  const intelligenceTitle = resourceIntelligenceLabel(kind);
  const qualityLabel = analysis?.quality
    ? `Extraction ${analysis.quality.extraction} · Structure ${analysis.quality.structure} · Grounding ${analysis.quality.grounding}`
    : '';
  const flatOutline = flattenResourceOutline(outlineNodes);
  const parsedPages = analysis?.diagnostics?.parsedPageCount;
  const totalPages = analysis?.diagnostics?.pageCount || analysis?.quality?.pageCount;
  const oneLineSummary = clipText(analysis?.overview || analysis?.readingAdvice || '', 140);

  return (
    <OpenWebUIGuideShell
      resource={resource}
      activeTab={activeGuideTab}
      onTabChange={setActiveGuideTab}
      tabs={documentGuideTabs}
      onClose={onToggleCollapsed}
    >
      {activeGuideTab === 'controls' ? (
        <div className="space-y-1">
          <OpenWebUICollapsible title="Files">
            <OpenWebUIResourceFileCard resource={resource} />
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Index">
            <OpenWebUIParamRows
              rows={[
                { label: 'Source Type', value: intelligenceTitle },
                { label: 'Status', value: loading ? 'Loading' : analysis?.status || 'Not analyzed' },
                { label: 'Chunks', value: getResourceIndexMeta(resource)?.chunks || 'Default' },
                { label: 'Vector Index', value: getResourceIndexMeta(resource)?.status || 'Default' },
                { label: 'Pages', value: totalPages != null ? `${parsedPages ?? 0}/${totalPages}` : 'Default' }
              ]}
            />
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Actions">
            <OpenWebUIParamRows
              rows={[
                {
                  label: analysis?.status === 'failed' ? 'Retry Source Guide' : hasAnalysis ? 'Regenerate Source Guide' : 'Generate Source Guide',
                  value: starting ? <Loader2 className="ml-auto h-4 w-4 animate-spin" /> : 'Run',
                  onClick: () => startAnalysis(Boolean(hasAnalysis || analysis?.status === 'failed')),
                  tone: 'accent'
                }
              ]}
            />
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Debug">
            <OpenWebUIParamRows
              rows={[
                { label: 'Status', value: analysis?.status || 'Default', tone: analysis?.status === 'failed' ? 'danger' : 'default' },
                { label: 'Stage', value: analysis?.progress?.stage || 'Default' },
                { label: 'Model', value: analysis?.model || 'Default' },
                { label: 'Quality', value: qualityLabel || 'Default' },
                { label: 'Coverage', value: typeof analysis?.quality?.coverage === 'number' ? `${Math.round(analysis.quality.coverage * 100)}%` : 'Default' },
                { label: 'Completed', value: analysis?.completedAt ? new Date(analysis.completedAt).toLocaleString() : 'Default' }
              ]}
            />
            {analysis?.error ? <div className="mt-2 text-xs leading-5 text-red-600">{analysis.error}</div> : null}
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Warnings" defaultOpen={Boolean(analysis?.warnings?.length)}>
            {analysis?.warnings?.length ? (
              <OpenWebUIParamRows
                rows={analysis.warnings.slice(0, 8).map((warning, index) => ({
                  label: `Warning ${index + 1}`,
                  value: <span className="max-w-[180px] whitespace-normal text-right leading-5">{warning}</span>,
                  tone: 'danger' as const
                }))}
              />
            ) : (
              <div className="text-xs text-gray-500">Default</div>
            )}
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Run History" defaultOpen={Boolean(analysis?.progress?.stages?.length)}>
            {analysis?.progress?.stages?.length ? (
              <OpenWebUIParamRows
                rows={analysis.progress.stages.slice(-8).map((stage) => ({
                  label: stage.label || stage.stage,
                  value: <span className="max-w-[180px] whitespace-normal text-right leading-5">{stage.status}{stage.message ? ` · ${stage.message}` : ''}</span>
                }))}
              />
            ) : (
              <div className="text-xs text-gray-500">Default</div>
            )}
          </OpenWebUICollapsible>
        </div>
      ) : activeGuideTab === 'outline' ? (
        <div className="space-y-1">
          <OpenWebUICollapsible title="Summary" defaultOpen={Boolean(analysis?.overview || analysis?.readingAdvice)}>
            {analysis?.status === 'ready' || analysis?.status === 'degraded' ? (
              <OpenWebUIParamRows
                rows={[
                  { label: 'Status', value: analysis.status === 'degraded' ? 'Partial' : 'Ready', tone: analysis.status === 'degraded' ? 'danger' : 'default' },
                  { label: 'Overview', value: <span className="max-w-[190px] whitespace-normal text-right leading-5">{oneLineSummary || analysis.overview || 'Default'}</span> },
                  ...(analysis.readingAdvice ? [{
                    label: 'Reading Advice',
                    value: <span className="max-w-[190px] whitespace-normal text-right leading-5">{analysis.readingAdvice}</span>
                  }] : [])
                ]}
              />
            ) : (
              <OpenWebUIParamRows
                rows={[
                  {
                    label: 'Status',
                    value: <span className="max-w-[190px] whitespace-normal text-right leading-5">
                      {isProcessing
                        ? 'Extracting'
                        : analysis?.error || 'Not generated'}
                    </span>,
                    tone: analysis?.error ? 'danger' : 'default'
                  }
                ]}
              />
            )}
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Outline">
            {flatOutline.length ? (
              <OpenWebUIParamRows
                rows={flatOutline.map((node) => ({
                  label: (
                    <span className="block min-w-0">
                      <span className="block truncate">{node.title}</span>
                      {node.summary ? <span className="mt-0.5 block line-clamp-2 text-gray-500">{node.summary}</span> : null}
                    </span>
                  ),
                  value: (
                    <span className="whitespace-nowrap text-gray-500">
                      {intelligenceRangeLabel(node.locator, node.pageStart ? `p${node.pageStart}` : undefined) || `L${node.level || 1}`}
                    </span>
                  ),
                  onClick: () => jumpToLocator(node)
                }))}
              />
            ) : loading || isProcessing ? (
              <div className="space-y-2">
                {[0, 1, 2].map((item) => <div key={item} className="h-3 animate-pulse rounded bg-gray-100" />)}
              </div>
            ) : (
              <div className="text-xs text-gray-500">Default</div>
            )}
          </OpenWebUICollapsible>
        </div>
      ) : activeGuideTab === 'slides' ? (
        <div className="space-y-1">
          <OpenWebUICollapsible title="Slides">
            {slideSegments.length ? (
              <OpenWebUIParamRows
                rows={slideSegments.map((segment: ResourceTranscriptSegmentUi) => ({
                  label: (
                    <span className="block min-w-0">
                      <span className="block truncate">{segment.title || `Part ${segment.index + 1}`}</span>
                      <span className="mt-0.5 block line-clamp-2 text-gray-500">{segment.text}</span>
                    </span>
                  ),
                  value: intelligenceRangeLabel(segment.locator, segment.pageStart ? `p${segment.pageStart}` : `Part ${segment.index + 1}`),
                  onClick: () => jumpToLocator(segment),
                  onDragStart: (event) => startSlideDrag(event, segment),
                  draggable: true
                }))}
              />
            ) : (
              <div className="text-xs text-gray-500">Default</div>
            )}
          </OpenWebUICollapsible>
        </div>
      ) : (
        <div className="text-xs text-gray-500">Default</div>
      )}
    </OpenWebUIGuideShell>
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
  const [guideWidth, setGuideWidth] = useState(() => {
    if (typeof window === 'undefined') return 420;
    const stored = Number(window.localStorage.getItem('workbench.resourceGuideWidth') || 420);
    return Number.isFinite(stored) ? Math.max(320, Math.min(640, stored)) : 420;
  });
  const [isResizingGuide, setIsResizingGuide] = useState(false);
  const hasGuide = Boolean(guidePanel || guideKind);
  const headerMeta = getResourceHeaderMeta(resource);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isResizingGuide) return;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const handleMove = (event: MouseEvent) => {
      if (!shellRef.current) return;
      const bounds = shellRef.current.getBoundingClientRect();
      const next = Math.max(320, Math.min(640, bounds.right - event.clientX));
      setGuideWidth(next);
    };
    const handleUp = () => {
      setIsResizingGuide(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingGuide]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('workbench.resourceGuideWidth', String(Math.round(guideWidth)));
    }
  }, [guideWidth]);

  return (
    <div ref={shellRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#25272b]">
      <div className="shrink-0 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[#202124]">
              {resource.name}
            </h1>
            <div className="mt-1 flex min-w-0 items-center gap-x-1.5 text-xs font-medium text-[#8b8f94]">
              <span className="min-w-0 truncate">{resource.path}</span>
              {headerMeta.map((item, index) => (
                <Fragment key={`${item}-${index}`}>
                  <span className="shrink-0 text-[#c6c9ce]">•</span>
                  <span className="shrink-0">{item}</span>
                </Fragment>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasGuide && (
              <button
                type="button"
                onClick={() => setGuideOpen((value) => !value)}
                className="flex cursor-pointer rounded-xl px-2 py-2 text-[#55585d] transition hover:bg-gray-50 hover:text-[#202124]"
                title="Controls"
                aria-pressed={guideOpen}
              >
                <div className="m-auto self-center">
                  <OWAdjustmentsHorizontalIcon className="size-5" strokeWidth={1} />
                </div>
              </button>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                download
                className="flex cursor-pointer rounded-xl px-2 py-2 text-[#55585d] transition hover:bg-gray-50 hover:text-[#202124]"
                title="Download source"
              >
                <div className="m-auto self-center">
                  <OWDownloadIcon className="size-5" strokeWidth={1.5} />
                </div>
              </a>
            )}
          </div>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col bg-white xl:flex-row"
        style={{ '--resource-guide-width': `${guideWidth}px` } as React.CSSProperties}
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        {guideOpen && (
          <>
            <div
              className="relative z-20 hidden items-center justify-center border-l border-gray-50 transition hover:border-gray-200 xl:flex"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingGuide(true);
              }}
            >
              <div className="absolute -bottom-0 -left-1.5 -right-1.5 -top-0 z-20 cursor-col-resize bg-transparent" />
            </div>
            <aside
              className="min-h-0 w-full border-t border-[#eeeeeb] bg-white xl:w-[var(--resource-guide-width)] xl:shrink-0 xl:border-l xl:border-t-0"
            >
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
          </>
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
  const [activeGuideTab, setActiveGuideTab] = useState<OpenWebUIGuideTab>('chapters');
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
    <OpenWebUIGuideShell
      resource={resource}
      activeTab={activeGuideTab}
      onTabChange={setActiveGuideTab}
      tabs={videoGuideTabs}
      onClose={onClose}
    >
      {activeGuideTab === 'controls' ? (
        <div className="space-y-1">
          <OpenWebUICollapsible title="Files">
            <OpenWebUIResourceFileCard resource={resource} />
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Analysis">
            <OpenWebUIParamRows
              rows={[
                { label: 'Status', value: analysis ? videoAnalysisStatusLabel[analysis.status] : loading ? 'Loading' : 'Not analyzed' },
                { label: 'Provider', value: analysis?.provider || 'Default' },
                { label: 'Stage', value: progress ? videoStageLabels[activeStage] || activeStage : 'Default' },
                { label: 'Progress', value: progress ? `${progressPercent}%` : 'Default' },
                { label: 'Current Time', value: formatVideoTime(currentTime) },
                { label: 'Review', value: `${reviewStatus.replace('_', ' ')}${isLocked ? ' · locked' : ''}` }
              ]}
            />
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Actions">
            <OpenWebUIParamRows
              rows={[
                {
                  label: analysisActionLabel,
                  value: starting || (!isStaleAnalysis && isRunning) ? <Loader2 className="ml-auto h-4 w-4 animate-spin" /> : 'Run',
                  onClick: canStartAnalysis ? () => startAnalysis(Boolean(hasContent || isStaleAnalysis)) : undefined,
                  tone: 'accent'
                },
                ...(isRunning ? [{
                  label: 'Cancel Analysis',
                  value: 'Stop',
                  onClick: progress?.canCancel === false ? undefined : cancelAnalysis,
                  tone: 'danger' as const
                }] : []),
                ...(hasContent ? [{
                  label: editing ? 'Save Manual Edits' : 'Edit Analysis',
                  value: editing ? 'Save' : 'Edit',
                  onClick: editing ? () => saveManualEdits({ status: reviewStatus, locked: isLocked }) : isLocked ? undefined : () => setEditing(true),
                  tone: 'accent' as const
                }] : []),
                ...(editing ? [{
                  label: 'Cancel Edits',
                  value: 'Cancel',
                  onClick: cancelManualEdits
                }] : []),
                ...(analysis ? [{
                  label: isLocked ? 'Unlock Review' : 'Lock Review',
                  value: isLocked ? 'Locked' : 'Unlocked',
                  onClick: () => updateReview({ locked: !isLocked, status: reviewStatus })
                }] : [])
              ]}
            />
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Debug">
            <OpenWebUIParamRows
              rows={[
                { label: 'Status', value: analysis ? videoAnalysisStatusLabel[analysis.status] : 'Default', tone: hasAnalysisIssue ? 'danger' : 'default' },
                { label: 'Error Class', value: analysis?.errorClass ? errorClassLabel[analysis.errorClass] || analysis.errorClass : 'Default' },
                { label: 'Heartbeat', value: progress?.heartbeatAt ? new Date(progress.heartbeatAt).toLocaleString() : 'Default' },
                { label: 'Manual Revision', value: analysis?.manualRevision ? String(analysis.manualRevision.revision) : 'Default' },
                { label: 'Transcript', value: `${transcript.length}` },
                { label: 'Chapters', value: `${chapters.length}` },
                { label: 'Slides', value: `${slides.length}` }
              ]}
            />
            {analysis?.error || error ? <div className="mt-2 text-xs leading-5 text-red-600">{analysis?.error || error}</div> : null}
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Run History" defaultOpen={Boolean(progress?.stages?.length)}>
            {progress?.stages?.length ? (
              <OpenWebUIParamRows
                rows={progress.stages.slice(-10).map((stage) => ({
                  label: stage.label || videoStageLabels[stage.stage] || stage.stage,
                  value: <span className="max-w-[180px] whitespace-normal text-right leading-5">{stage.status}{stage.message ? ` · ${stage.message}` : ''}</span>
                }))}
              />
            ) : (
              <div className="text-xs text-gray-500">Default</div>
            )}
          </OpenWebUICollapsible>
          <OpenWebUISectionBreak />
          <OpenWebUICollapsible title="Warnings" defaultOpen={Boolean(analysis?.warnings?.length)}>
            {analysis?.warnings?.length ? (
              <OpenWebUIParamRows
                rows={analysis.warnings.slice(0, 8).map((warning, index) => ({
                  label: `Warning ${index + 1}`,
                  value: <span className="max-w-[180px] whitespace-normal text-right leading-5">{warning}</span>,
                  tone: 'danger' as const
                }))}
              />
            ) : (
              <div className="text-xs text-gray-500">Default</div>
            )}
          </OpenWebUICollapsible>
        </div>
      ) : (
        <section ref={trackRef} className="space-y-1">
          {!analysis || (!hasContent && analysis.status === 'idle') ? (
            <div className="py-2 text-sm leading-6 text-gray-500">
              Start analysis to extract captions, AI chapters, learning key points, and slide-like frames from this video.
            </div>
          ) : activeGuideTab === 'summary' ? (
            <OpenWebUICollapsible title="Summary">
              {editing ? (
                <textarea
                  value={draftSummary}
                  onChange={(event) => setDraftSummary(event.target.value)}
                  className="min-h-[120px] w-full rounded-lg border border-gray-100 bg-transparent px-2.5 py-1.5 text-xs leading-5 text-gray-700 outline-none focus:border-gray-300"
                />
              ) : analysis.summary ? (
                <OpenWebUIParamRows
                  rows={[
                    {
                      label: 'Summary',
                      value: <span className="max-w-[210px] whitespace-normal text-right leading-5">{analysis.summary}</span>
                    },
                    ...(analysis.summarySourceRange ? [{
                      label: 'Source Range',
                      value: videoRangeText(analysis.summarySourceRange.start, analysis.summarySourceRange.end)
                    }] : [])
                  ]}
                />
              ) : (
                <div className="text-xs text-gray-500">Default</div>
              )}
            </OpenWebUICollapsible>
          ) : activeGuideTab === 'chapters' ? (
            <OpenWebUICollapsible title="Chapters">
              {chapters.length ? (
                <OpenWebUIParamRows
                  rows={chapters.map((chapter, index) => {
                    const end = chapter.end ?? chapters[index + 1]?.start;
                    return {
                      label: (
                        <span
                          className="block min-w-0"
                          draggable
                          onDragStart={(event) => {
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
                        >
                          <span className="block truncate">{chapter.title}</span>
                          {chapter.summary ? <span className="mt-0.5 block line-clamp-2 text-gray-500">{chapter.summary}</span> : null}
                        </span>
                      ),
                      value: videoRangeText(chapter.start, end),
                      onClick: () => seekTo(chapter.start)
                    };
                  })}
                />
              ) : (
                <div className="text-xs text-gray-500">Default</div>
              )}
            </OpenWebUICollapsible>
          ) : activeGuideTab === 'transcript' ? (
            <OpenWebUICollapsible title="Transcript">
              {transcript.length ? (
                <OpenWebUIParamRows
                  rows={transcript.map((segment) => ({
                    label: (
                      <span
                        className="block min-w-0 line-clamp-2 text-gray-700"
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
                      >
                        {segment.text}
                      </span>
                    ),
                    value: videoRangeText(segment.start, segment.end),
                    onClick: () => {
                      seekTo(segment.start);
                      selectTranscriptRange(segment);
                    }
                  }))}
                />
              ) : (
                <div className="text-xs text-gray-500">Default</div>
              )}
            </OpenWebUICollapsible>
          ) : activeGuideTab === 'slides' ? (
            <OpenWebUICollapsible title="Slides">
              {slides.length ? (
                <OpenWebUIParamRows
                  rows={slides.map((slide) => ({
                    label: (
                      <span className="block min-w-0">
                        <span className="block truncate">{slide.title || 'Frame'}</span>
                        {slide.ocrText ? <span className="mt-0.5 block line-clamp-2 text-gray-500">{slide.ocrText}</span> : null}
                      </span>
                    ),
                    value: formatVideoTime(slide.timestamp),
                    onClick: () => seekTo(slide.timestamp)
                  }))}
                />
              ) : (
                <div className="text-xs text-gray-500">Default</div>
              )}
            </OpenWebUICollapsible>
          ) : activeGuideTab === 'keypoints' ? (
            <OpenWebUICollapsible title="Key Points">
              {keyPoints.length ? (
                <OpenWebUIParamRows
                  rows={keyPoints.map((point, index) => {
                    const ts = point.timestamps[0] ?? point.sourceRange?.start ?? 0;
                    return {
                      label: editing ? (
                        <span className="block min-w-0 space-y-1" onClick={(event) => event.stopPropagation()}>
                          <input
                            value={point.concept}
                            onChange={(event) => setDraftKeyPoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, concept: event.target.value } : item))}
                            className="w-full rounded-sm border border-gray-100 bg-transparent px-1 py-0.5 text-xs outline-none focus:border-gray-300"
                          />
                          <textarea
                            value={point.explanation}
                            onChange={(event) => setDraftKeyPoints((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, explanation: event.target.value } : item))}
                            className="min-h-[54px] w-full rounded-sm border border-gray-100 bg-transparent px-1 py-0.5 text-xs leading-5 outline-none focus:border-gray-300"
                          />
                        </span>
                      ) : (
                        <span
                          className="block min-w-0"
                          draggable
                          onDragStart={(event) => {
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
                        >
                          <span className="block truncate">{point.concept}</span>
                          <span className="mt-0.5 block line-clamp-2 text-gray-500">{point.explanation}</span>
                        </span>
                      ),
                      value: point.timestamps[0] != null ? formatVideoTime(point.timestamps[0]) : 'Default',
                      onClick: () => point.timestamps[0] != null && seekTo(point.timestamps[0])
                    };
                  })}
                />
              ) : (
                <div className="text-xs text-gray-500">Default</div>
              )}
            </OpenWebUICollapsible>
          ) : (
            <div className="py-2 text-xs text-gray-500">Default</div>
          )}
        </section>
      )}
    </OpenWebUIGuideShell>
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

const formatOpenWebUIFileSize = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes.toFixed(1)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
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

function OpenWebUIFileItem({
  name,
  type = 'file',
  size,
  loading = false,
  dismissible = false,
  className = 'w-60',
  onOpen,
  onDismiss
}: {
  name: string;
  type?: string;
  size?: number;
  loading?: boolean;
  dismissible?: boolean;
  className?: string;
  onOpen?: () => void;
  onDismiss?: () => void;
}) {
  const decodedName = (() => {
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  })();
  const typeLabel = type === 'note' ? 'Note' : type === 'chat' ? 'Chat' : type === 'collection' ? 'Collection' : type === 'folder' ? 'Folder' : type === 'file' ? 'File' : type;
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`relative group ${className} flex items-center gap-1 bg-white dark:bg-gray-850 border border-gray-50/30 dark:border-gray-800/30 rounded-xl p-2 text-left ${onOpen ? 'cursor-pointer' : ''}`}
      title={decodedName}
    >
      <div className="pl-1.5">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : type === 'note' ? (
          <OWPencilSquareIcon className="h-4 w-4" strokeWidth={1.5} />
        ) : type === 'chat' ? (
          <OWChatBubbleIcon className="h-4 w-4" strokeWidth={1.5} />
        ) : type === 'collection' ? (
          <OWDatabaseIcon className="h-4 w-4" strokeWidth={1.5} />
        ) : type === 'folder' ? (
          <FolderOpen className="h-4 w-4" strokeWidth={1.5} />
        ) : (
          <OWDocumentPageIcon className="h-4 w-4" strokeWidth={1.5} />
        )}
      </div>
      <div className="flex flex-col justify-center -space-y-0.5 px-1 w-full min-w-0">
        <div className="dark:text-gray-100 text-sm flex justify-between items-center min-w-0">
          <div className="font-medium line-clamp-1 flex-1 pr-1 min-w-0">{decodedName}</div>
          {size ? (
            <div className="text-gray-500 text-xs capitalize shrink-0">{formatOpenWebUIFileSize(size)}</div>
          ) : (
            <div className="text-gray-500 text-xs capitalize shrink-0">{typeLabel}</div>
          )}
        </div>
      </div>
      {dismissible && (
        <div className="absolute -top-1 -right-1">
          <button
            aria-label="Remove File"
            className="bg-white text-black border border-gray-50 rounded-full outline-hidden focus:outline-hidden group-hover:visible invisible transition"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss?.();
            }}
          >
            <OWXMarkIcon className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function SelectionCapsule({
  label,
  preview,
  onInspect,
  onDismiss
}: {
  label: string;
  preview: string;
  onInspect?: () => void;
  onDismiss?: () => void;
}) {
  const text = preview.replace(/\s+/g, ' ').trim() || label;
  const display = text.slice(0, 42) || 'Selection';
  return (
    <div className="relative group w-60 flex items-center gap-1 bg-white dark:bg-gray-850 border border-gray-50/30 dark:border-gray-800/30 rounded-xl p-2 text-left">
      <div className="pl-1.5">
        <OWDocumentPageIcon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <button type="button" onClick={onInspect} disabled={!onInspect} className="flex flex-col justify-center -space-y-0.5 px-1 w-full min-w-0 text-left disabled:cursor-default" title={text}>
        <div className="dark:text-gray-100 text-sm flex justify-between items-center min-w-0">
          <div className="font-medium line-clamp-1 flex-1 pr-1 min-w-0">{display}</div>
        </div>
      </button>
      {onDismiss && (
        <div className="absolute -top-1 -right-1">
          <button
            aria-label="Remove Selection"
            className="bg-white text-black border border-gray-50 rounded-full outline-hidden focus:outline-hidden group-hover:visible invisible transition"
            type="button"
            onClick={onDismiss}
          >
            <OWXMarkIcon className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const attachmentFileType = (attachment: AiChatAttachment) =>
  attachment.displayType ||
  (attachment.kind === 'image' ? 'image' : attachment.kind === 'pdf' || attachment.kind === 'document' || attachment.kind === 'text' ? 'doc' : 'file');

function ComposerAttachmentTray({
  attachments,
  onRemove,
  onOpen
}: {
  attachments: AiChatAttachment[];
  onRemove: (attachmentId: string) => void;
  onOpen?: (attachment: AiChatAttachment) => void;
}) {
  if (!attachments.length) return null;

  return (
    <div className="mx-2 mt-2.5 pb-1.5 flex items-center flex-wrap gap-2" dir="auto">
      {attachments.map((attachment) =>
        attachment.kind === 'image' && attachment.dataUrl ? (
          <div key={attachment.id} className="relative group">
            <div className="relative flex items-center">
              <button type="button" onClick={() => onOpen?.(attachment)} className="rounded-xl">
                <img src={attachment.dataUrl} alt="" className="size-10 rounded-xl object-cover" />
              </button>
            </div>
            <div className="absolute -top-1 -right-1">
              <button
                className="bg-white text-black border border-white rounded-full outline-hidden focus:outline-hidden group-hover:visible invisible transition"
                type="button"
                aria-label="Remove file"
                onClick={() => onRemove(attachment.id)}
              >
                <OWXMarkIcon className="size-4" />
              </button>
            </div>
          </div>
        ) : (
          <OpenWebUIFileItem
            key={attachment.id}
            name={attachment.name}
            type={attachmentFileType(attachment)}
            size={attachment.size}
            loading={attachment.status !== 'ready' && attachment.status !== 'metadata_only'}
            dismissible
            onOpen={() => onOpen?.(attachment)}
            onDismiss={() => onRemove(attachment.id)}
          />
        )
      )}
    </div>
  );
}

function MessageAttachmentStrip({ attachments, onOpen }: { attachments?: AiChatAttachment[]; onOpen?: (attachment: AiChatAttachment) => void }) {
  if (!attachments?.length) return null;

  return (
    <div className="mb-1 w-full flex flex-col justify-end overflow-x-auto gap-1 flex-wrap" dir="auto">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="self-end">
          {attachment.kind === 'image' && attachment.dataUrl ? (
            <button type="button" onClick={() => onOpen?.(attachment)} className="rounded-lg">
              <img src={attachment.dataUrl} alt={attachment.name} className="max-h-96 rounded-lg" />
            </button>
          ) : attachment.displayType === 'selection' ? (
            <SelectionCapsule label={attachment.name} preview={attachment.textContent || attachment.summary || attachment.name} onInspect={() => onOpen?.(attachment)} />
          ) : (
            <OpenWebUIFileItem
              name={attachment.name}
              type={attachmentFileType(attachment)}
              size={attachment.size}
              onOpen={() => onOpen?.(attachment)}
            />
          )}
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
  if (attachment.kind === 'image') {
    const { base64Data, ...rest } = attachment;
    return rest;
  }
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

const editorTypeForAttachmentPreview = (resource: ResourceReference): EditorState['type'] => {
  const kind = getResourceKind(resource);
  if (kind === 'pdf' || kind === 'document') return 'resource';
  if (kind === 'web') return 'external';
  if (kind === 'video') return 'video';
  if (kind === 'code' || kind === 'structured') return 'code';
  if (kind === 'markdown' || kind === 'note') return 'notes';
  return 'resource';
};

const shouldLoadAttachmentPreviewContent = (resource: ResourceReference) => {
  const kind = getResourceKind(resource);
  return kind === 'markdown' || kind === 'note' || kind === 'code' || kind === 'structured' || kind === 'unknown' || kind === 'web';
};

function AttachmentPreviewModal({
  workspaceId,
  attachment,
  resource,
  onClose
}: {
  workspaceId: string;
  attachment: AiChatAttachment | null;
  resource?: ResourceReference | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!attachment) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [attachment, onClose]);

  useEffect(() => {
    if (!workspaceId || !resource || !shouldLoadAttachmentPreviewContent(resource)) {
      setContent('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setContent('');
    void fileSystemApi
      .getContent(workspaceId, resource.id)
      .then((response) => {
        if (!cancelled) setContent(response.content || '');
      })
      .catch(() => {
        if (!cancelled) setContent('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resource, workspaceId]);

  if (!attachment) return null;

  const title = attachment.name || resource?.name || 'Attachment';
  const sourceUrl = resource ? fileSystemApi.downloadUrl(workspaceId, resource.id) : attachment.dataUrl || undefined;
  const previewText = attachment.textContent || attachment.summary || attachment.error || '';

  return createPortal(
    <div
      aria-modal="true"
      role="dialog"
      className="modal fixed bottom-0 left-0 right-0 top-0 z-[9999] flex h-screen max-h-[100dvh] w-full justify-center overflow-y-auto overscroll-contain bg-black/30 p-3 animate-[openwebui-fade_10ms_ease-out]"
      style={{ scrollbarGutter: 'stable' }}
      onMouseDown={onClose}
    >
      <style>
        {`@keyframes openwebui-fade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes openwebui-scale-up { from { transform: scale(0.985); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}
      </style>
      <div
        className="m-auto flex h-[min(860px,calc(100vh-24px))] min-h-fit w-[84rem] max-w-full flex-col overflow-hidden rounded-[32px] border border-white bg-white/95 text-gray-900 shadow-[0_24px_90px_rgba(0,0,0,0.24)] backdrop-blur-sm animate-[openwebui-scale-up_100ms_ease-out_forwards]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-4.5 pb-2 pt-3 text-gray-900">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden pr-4">
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="block max-w-full truncate text-lg font-medium hover:underline" title={title}>
                {title}
              </a>
            ) : (
              <div className="block max-w-full truncate text-lg font-medium" title={title}>{title}</div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="self-center rounded-lg p-1 text-gray-700 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close attachment preview"
          >
            <OWXMarkIcon className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 border-t border-gray-100 bg-white">
          {resource ? (
            <WorkbenchEditorContent
              editor={{
                id: `attachment-preview-${resource.id}`,
                type: editorTypeForAttachmentPreview(resource),
                title: resource.name,
                resourceId: resource.id,
                resourcePath: resource.path,
                x: 0,
                y: 0,
                w: 12,
                h: 12,
                zIndex: 1,
                minimized: false,
                viewState: { mode: 'preview' }
              }}
              resource={resource}
              workspaceId={workspaceId}
              content={content}
              isLoading={loading}
              onChangeContent={() => undefined}
              onSaveContent={() => undefined}
              onBindResource={() => undefined}
              onUpdateViewState={() => undefined}
              minimalPreview
            />
          ) : attachment.kind === 'image' && attachment.dataUrl ? (
            <div className="flex h-full items-center justify-center bg-[#111] p-4">
              <img src={attachment.dataUrl} alt={title} className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <div className="h-full overflow-auto bg-white p-6">
              {attachment.mimeType.includes('markdown') || attachment.name.toLowerCase().endsWith('.md') ? (
                <MarkdownPreview content={previewText || 'No preview available.'} variant="document" />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-gray-800">{previewText || 'No preview available.'}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

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

type SelectionPopoverBoundary = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const rectBoundary = (rect: DOMRect): SelectionPopoverBoundary => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom
});

const clampNumber = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
};

const lastUsableRangeRect = (range: Range) => {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  return rects[rects.length - 1] || range.getBoundingClientRect();
};

const buildSelectionAskPrompt = (prompt: string, selectedText: string) =>
  selectedText.trim()
    ? `${prompt.trim()}\n\n【选区内容】\n${selectedText.trim()}`
    : prompt.trim();

const streamSelectionAsk = async ({
  workspaceId,
  request,
  history = [],
  handlers
}: {
  workspaceId: string;
  request: SelectionAskRequest;
  history?: AiChatMessage[];
  handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void };
}): Promise<SelectionAskResult> => {
  const userContent = buildSelectionAskPrompt(request.prompt, request.selectedText);
  const displayUserContent = request.question.trim() || request.prompt.trim();
  const userCreatedAt = new Date().toISOString();
  const assistantCreatedAt = new Date().toISOString();
  let assistantContent = '';
  const lockedSelection: AiLockedSelectionContext | null = request.selectedText.trim()
    ? {
        id: `inline-selection-${Date.now()}`,
        panelId: request.detail.panelId,
        panelType: request.detail.panelType,
        fileId: request.detail.fileId || null,
        fileName: request.detail.fileName || request.detail.sourceLabel,
        content: request.selectedText,
        locator: request.detail.selectedRange as AiLockedSelectionContext['locator'],
        createdAt: userCreatedAt
      }
    : null;

  const response = await aiApi.chatStream(
    {
      messages: [
        ...history,
        { role: 'user', content: userContent, createdAt: userCreatedAt }
      ],
      context: {
        workspaceId,
        contextMode: 'selection_only',
        lockedSelection
      } as AiChatContext
    },
    {
      onDelta: (delta) => {
        assistantContent += delta;
        handlers.onDelta(delta);
      },
      onReplace: (content) => {
        assistantContent = content;
        handlers.onReplace?.(content);
      }
    }
  );

  const finalAssistantContent = response.reply || assistantContent;
  return {
    userMessage: { role: 'user', content: displayUserContent, createdAt: userCreatedAt },
    assistantMessage: { role: 'assistant', content: finalAssistantContent, createdAt: assistantCreatedAt }
  };
};

function SelectionActionPopover({
  x,
  y,
  anchorRect,
  boundaryRect,
  sourceLabel,
  askPlaceholder = 'Ask about this selection',
  onAsk,
  onAddToAssistant,
  onExplain,
  onPin,
  onDismiss
}: {
  x: number;
  y: number;
  anchorRect?: SelectionPopoverBoundary;
  boundaryRect?: SelectionPopoverBoundary;
  sourceLabel?: string;
  askPlaceholder?: string;
  onAsk: SelectionAskSubmitHandler;
  onAddToAssistant?: SelectionAskAddHandler;
  onExplain: SelectionExplainSubmitHandler;
  onPin: () => void;
  onDismiss?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inlineMessagesRef = useRef<AiChatMessage[]>([]);
  const inlineMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'menu' | 'ask'>('menu');
  const [question, setQuestion] = useState('');
  const [inlineMessages, setInlineMessages] = useState<AiChatMessage[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [addedToAssistant, setAddedToAssistant] = useState(false);
  const desiredPopoverWidth = mode === 'ask' ? 320 : 188;
  const hasInlineConversation = inlineMessages.length > 0;
  const hasAssistantReply = inlineMessages.some((message) => message.role === 'assistant' && message.content.trim());
  const popoverHeight = mode === 'ask' ? (hasInlineConversation || askError ? 270 : 46) : 30;
  const gap = 6;
  const margin = 8;
  const viewportBoundary = {
    left: 0,
    top: 0,
    right: typeof window === 'undefined' ? 0 : window.innerWidth,
    bottom: typeof window === 'undefined' ? 0 : window.innerHeight
  };
  const boundary = boundaryRect || viewportBoundary;
  const popoverWidth = Math.min(
    desiredPopoverWidth,
    Math.max(120, boundary.right - boundary.left - margin * 2)
  );
  const left = clampNumber(x - popoverWidth / 2, boundary.left + margin, boundary.right - popoverWidth - margin);
  const top = anchorRect
    ? (() => {
        const above = anchorRect.top - popoverHeight - gap;
        const below = anchorRect.bottom + gap;
        if (above >= boundary.top + margin) return above;
        if (below <= boundary.bottom - popoverHeight - margin) return below;
        return clampNumber(above, boundary.top + margin, boundary.bottom - popoverHeight - margin);
      })()
    : clampNumber(y, boundary.top + margin, boundary.bottom - popoverHeight - margin);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      onDismiss?.();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [onDismiss]);

  useEffect(() => {
    inlineMessagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [inlineMessages, isAsking, askError]);

  const runInlineAction = async (
    displayPrompt: string,
    submit: (
      history: AiChatMessage[],
      handlers: { onDelta: (delta: string) => void; onReplace?: (content: string) => void }
    ) => Promise<SelectionAskResult>
  ) => {
    const trimmedPrompt = displayPrompt.trim();
    if (!trimmedPrompt || isAsking) return;
    const history = inlineMessagesRef.current.filter((message) => message.content.trim());
    const userCreatedAt = new Date().toISOString();
    const assistantCreatedAt = new Date().toISOString();
    const localUserMessage: AiChatMessage = { role: 'user', content: trimmedPrompt, createdAt: userCreatedAt };
    const localAssistantMessage: AiChatMessage = { role: 'assistant', content: '', createdAt: assistantCreatedAt };
    const assistantMessageIndex = history.length + 1;
    const nextMessages = [...history, localUserMessage, localAssistantMessage];
    inlineMessagesRef.current = nextMessages;
    setInlineMessages(nextMessages);
    setMode('ask');
    setIsAsking(true);
    setAskError(null);
    setAddedToAssistant(false);
    try {
      const updateAssistantMessage = (contentUpdater: string | ((current: string) => string)) => {
        const updatedMessages = inlineMessagesRef.current.map((message, index) => {
          if (index !== assistantMessageIndex) return message;
          const nextContent =
            typeof contentUpdater === 'function' ? contentUpdater(message.content) : contentUpdater;
          return { ...message, content: nextContent };
        });
        inlineMessagesRef.current = updatedMessages;
        setInlineMessages(updatedMessages);
      };
      const result = await submit(history, {
        onDelta: (delta) => updateAssistantMessage((current) => `${current}${delta}`),
        onReplace: (content) => updateAssistantMessage(content)
      });
      const finalizedMessages = inlineMessagesRef.current.map((message, index) => {
        if (index === assistantMessageIndex) return result.assistantMessage;
        if (index === assistantMessageIndex - 1) return result.userMessage;
        return message;
      });
      inlineMessagesRef.current = finalizedMessages;
      setInlineMessages(finalizedMessages);
      setQuestion('');
    } catch (error: any) {
      const revertedMessages = inlineMessagesRef.current.filter((_, index) => index !== assistantMessageIndex);
      inlineMessagesRef.current = revertedMessages;
      setInlineMessages(revertedMessages);
      setAskError(error?.response?.data?.error || error?.message || 'AI 请求失败');
    } finally {
      setIsAsking(false);
    }
  };

  const submitAsk = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;
    await runInlineAction(trimmedQuestion, (history, handlers) => onAsk(trimmedQuestion, history, handlers));
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-50 text-xs text-gray-700"
      title={sourceLabel}
      style={{
        left,
        top,
        width: popoverWidth
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {mode === 'menu' ? (
        <div className="flex w-full shrink-0 flex-row rounded-xl border border-gray-100 bg-white p-0.5 shadow-xl">
          <button
            type="button"
            aria-label="Ask"
            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] font-medium text-gray-700 transition hover:bg-gray-50"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMode('ask');
            }}
          >
            <MessageCircle className="size-3 shrink-0 text-gray-500" />
            <span className="shrink-0">Ask</span>
          </button>
          <button
            type="button"
            aria-label="Explain"
            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] font-medium text-gray-700 transition hover:bg-gray-50"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void runInlineAction('Explain this selection', (history, handlers) => onExplain(history, handlers));
            }}
          >
            <Lightbulb className="size-3 shrink-0 text-gray-500" />
            <span className="shrink-0">Explain</span>
          </button>
          <button
            type="button"
            aria-label="Pin"
            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] font-medium text-gray-700 transition hover:bg-gray-50"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPin();
            }}
          >
            <Pin className="size-3 shrink-0 text-gray-500" />
            <span className="shrink-0">Pin</span>
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex w-full rounded-full border border-gray-100 bg-white py-1 shadow-xl">
            <input
              type="text"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={question}
              disabled={isAsking}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitAsk();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onDismiss?.();
                }
              }}
              placeholder={askPlaceholder}
              className="ml-5 min-w-0 flex-1 appearance-none border-0 bg-transparent text-sm font-normal text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0 disabled:text-gray-400"
            />
            <div className="ml-1 mr-1">
              <button
                type="button"
                className={`m-0.5 rounded-full p-1.5 transition ${
                  question.trim() && !isAsking ? 'bg-black text-white hover:bg-gray-900' : 'bg-gray-200 text-white'
                }`}
                disabled={!question.trim() || isAsking}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void submitAsk();
                }}
                aria-label="Ask about selection"
              >
                {isAsking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </div>
          {(hasInlineConversation || askError || isAsking) ? (
            <div className="w-full rounded-2xl border border-gray-100 bg-white p-2 text-xs font-normal text-gray-700 shadow-xl">
              {sourceLabel ? <div className="mb-1 line-clamp-1 px-1 text-xs font-medium leading-5 text-gray-500">{sourceLabel}</div> : null}
              <div className="max-h-[18rem] overflow-y-auto overscroll-contain pr-1 text-sm leading-6 [&>div>div]:gap-1 [&_li]:text-sm [&_li]:leading-6 [&_ol]:space-y-1 [&_p]:text-sm [&_p]:font-normal [&_p]:leading-6 [&_ul]:space-y-1">
                {inlineMessages.map((message, index) =>
                  message.role === 'user' ? (
                    <div key={`${message.createdAt || 'user'}-${index}`} className="mb-1 ml-8 rounded-xl bg-gray-50 px-2 py-1.5 text-sm font-normal leading-6 text-gray-700">
                      {message.content}
                    </div>
                  ) : message.content ? (
                    <div key={`${message.createdAt || 'assistant'}-${index}`} className="mr-5 rounded-xl bg-white px-2 py-1.5 text-sm font-normal leading-6 text-gray-700">
                      <MarkdownPreview
                        content={message.content}
                        variant="message"
                        emptyMessage=""
                        isStreaming={isAsking && index === inlineMessages.length - 1}
                      />
                    </div>
                  ) : null
                )}
                {isAsking &&
                inlineMessages[inlineMessages.length - 1]?.role === 'assistant' &&
                !inlineMessages[inlineMessages.length - 1]?.content.trim() ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-sm text-gray-500">
                    <Loader2 className="size-4 animate-spin" />
                    Thinking...
                  </div>
                ) : null}
                {askError ? <div className="px-1 py-1 text-[#b42318]">{askError}</div> : null}
                <div ref={inlineMessagesEndRef} />
              </div>
              {hasAssistantReply && !askError && onAddToAssistant ? (
                <div className="mt-1 flex justify-end border-t border-gray-100 pt-1">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center justify-center rounded-full bg-transparent px-3 text-sm font-medium text-gray-700 outline-none transition hover:bg-gray-100 disabled:text-gray-400"
                    title={addedToAssistant ? 'Added' : 'Add to AI Assistant'}
                    aria-label={addedToAssistant ? 'Added to AI Assistant' : 'Add to AI Assistant'}
                    disabled={addedToAssistant}
                    onClick={() => {
                      onAddToAssistant?.(inlineMessages.filter((message) => message.content.trim()));
                      setAddedToAssistant(true);
                    }}
                  >
                    {addedToAssistant ? 'Added' : 'Add'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SelectionActionLayer({
  children,
  workspaceId,
  aiContext,
  fileId,
  fileName,
  panelId,
  panelType,
  sourceLabel = '选区',
  onAddSelectionAskToAssistant,
  onSelectionChange
}: {
  children: ReactNode;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  fileId?: string | null;
  fileName?: string;
  panelId?: string;
  panelType?: string;
  sourceLabel?: string;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  onSelectionChange?: (patch: Record<string, any>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    anchorRect: SelectionPopoverBoundary;
    boundaryRect: SelectionPopoverBoundary;
    text: string;
    selectedRange: Record<string, any>;
  } | null>(null);
  const selectionMenuRef = useRef<typeof selectionMenu>(null);
  const lastAskDetailRef = useRef<WorkbenchContextSelectionActionDetail | null>(null);

  useEffect(() => {
    selectionMenuRef.current = selectionMenu;
  }, [selectionMenu]);

  const showSelectionMenu = (nextMenu: NonNullable<typeof selectionMenu>) => {
    selectionMenuRef.current = nextMenu;
    setSelectionMenu(nextMenu);
  };

  const closeSelectionMenu = () => {
    selectionMenuRef.current = null;
    setSelectionMenu(null);
    onSelectionChange?.({ selectedText: '', selectedRange: null });
  };

  const readSelection = () => {
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const rect = lastUsableRangeRect(range);
    if (!rect.width && !rect.height) return null;
    const hostRect = host.getBoundingClientRect();
    const boundaryRect = rectBoundary(hostRect);
    const anchorRect = rectBoundary(rect);
    return {
      text,
      selectedRange: {
        sourceType: 'text_selection',
        textLength: text.length,
        scrollRatio: host.scrollHeight > host.clientHeight
          ? Math.min(1, Math.max(0, host.scrollTop / Math.max(1, host.scrollHeight - host.clientHeight)))
          : undefined
      },
      menu: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.max(boundaryRect.top + 8, Math.round(rect.top - 36)),
        anchorRect,
        boundaryRect
      }
    };
  };

  const reportSelection = (showActions = false) => {
    const locator = readSelection();
    if (!locator) {
      if (!selectionMenuRef.current) {
        onSelectionChange?.({ selectedText: '', selectedRange: null });
      }
      return;
    }
    if (showActions) {
      showSelectionMenu({
        x: locator.menu.x,
        y: locator.menu.y,
        anchorRect: locator.menu.anchorRect,
        boundaryRect: locator.menu.boundaryRect,
        text: locator.text,
        selectedRange: locator.selectedRange
      });
    }
    onSelectionChange?.({
      selectedText: locator.text,
      selectedRange: locator.selectedRange
    });
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      window.setTimeout(() => reportSelection(false), 0);
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [fileId, panelId, panelType, sourceLabel]);

  const applySelectionPrompt = (prompt: string, submitImmediately = false) => {
    const latestSelectionMenu = selectionMenuRef.current || selectionMenu;
    if (!latestSelectionMenu) return;
    window.dispatchEvent(
      new CustomEvent('workbench:context-selection-action', {
        detail: {
          fileId: fileId || undefined,
          fileName,
          panelId,
          panelType,
          sourceLabel,
          selectedRange: latestSelectionMenu.selectedRange,
          text: latestSelectionMenu.text,
          prompt,
          submitImmediately
        } as WorkbenchContextSelectionActionDetail
      })
    );
  };

  const buildSelectionActionDetail = (prompt: string): WorkbenchContextSelectionActionDetail | null => {
    const latestSelectionMenu = selectionMenuRef.current || selectionMenu;
    if (!latestSelectionMenu) return null;
    return {
      fileId: fileId || undefined,
      fileName,
      panelId,
      panelType,
      sourceLabel,
      selectedRange: latestSelectionMenu.selectedRange,
      text: latestSelectionMenu.text,
      prompt
    };
  };

  const askSelectionInline: SelectionAskSubmitHandler = (question, history, handlers) => {
    const prompt = `请基于我选中的内容回答：${question}`;
    const detail = buildSelectionActionDetail(prompt);
    if (!detail?.text) return Promise.reject(new Error('选区已失效，请重新选择文本。'));
    lastAskDetailRef.current = detail;
    return streamSelectionAsk({
      workspaceId,
      request: {
        question,
        prompt,
        selectedText: detail.text,
        detail
      },
      history,
      handlers
    });
  };

  const explainSelectionInline: SelectionExplainSubmitHandler = (history, handlers) => {
    const prompt = '请解释我选中的这段内容';
    const detail = buildSelectionActionDetail(prompt);
    if (!detail?.text) return Promise.reject(new Error('选区已失效，请重新选择文本。'));
    lastAskDetailRef.current = detail;
    return streamSelectionAsk({
      workspaceId,
      request: {
        question: 'Explain this selection',
        prompt,
        selectedText: detail.text,
        detail
      },
      history,
      handlers
    });
  };

  return (
    <div
      ref={hostRef}
      className="relative h-full min-h-0"
      onMouseDown={() => closeSelectionMenu()}
      onMouseUp={() => window.setTimeout(() => reportSelection(true), 0)}
      onKeyUp={() => window.setTimeout(() => reportSelection(true), 0)}
    >
      {selectionMenu && (
        <SelectionActionPopover
          x={selectionMenu.x}
          y={selectionMenu.y}
          anchorRect={selectionMenu.anchorRect}
          boundaryRect={selectionMenu.boundaryRect}
          sourceLabel={sourceLabel}
          onAsk={askSelectionInline}
          onAddToAssistant={(result) => {
            const detail = lastAskDetailRef.current;
            if (detail) onAddSelectionAskToAssistant?.(result, detail);
          }}
          onExplain={explainSelectionInline}
          onPin={() => applySelectionPrompt('__lock_context_selection__')}
          onDismiss={closeSelectionMenu}
        />
      )}
      {children}
    </div>
  );
}

function PdfJsReader({
  sourceUrl,
  workspaceId,
  aiContext,
  fileId,
  resourceName,
  onViewportChange,
  onAddSelectionAskToAssistant,
  enableSelectionActions = true
}: {
  sourceUrl: string;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  fileId: string;
  resourceName: string;
  onViewportChange: (patch: Record<string, any>) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  enableSelectionActions?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    anchorRect: SelectionPopoverBoundary;
    boundaryRect: SelectionPopoverBoundary;
    text: string;
    page?: number;
    selectedRange?: Record<string, any>;
  } | null>(null);
  const selectionMenuRef = useRef<typeof selectionMenu>(null);
  const lastAskDetailRef = useRef<WorkbenchContextSelectionActionDetail | null>(null);

  useEffect(() => {
    selectionMenuRef.current = selectionMenu;
  }, [selectionMenu]);

  const showSelectionMenu = (nextMenu: NonNullable<typeof selectionMenu>) => {
    selectionMenuRef.current = nextMenu;
    setSelectionMenu(nextMenu);
  };

  const closeSelectionMenu = () => {
    selectionMenuRef.current = null;
    setSelectionMenu(null);
    onViewportChange({
      selectedText: '',
      selectedRange: null
    });
  };

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: any = null;
    const container = containerRef.current;
    const viewerElement = viewerRef.current;
    if (!container || !viewerElement) return;

    setLoading(true);
    setError(null);
    selectionMenuRef.current = null;
    setSelectionMenu(null);
    viewerElement.replaceChildren();

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      removePageBorders: false,
      enableAutoLinking: true
    });
    linkService.setViewer(pdfViewer);
    pdfViewerRef.current = pdfViewer;
    linkServiceRef.current = linkService;

    const handlePagesInit = () => {
      if (cancelled) return;
      pdfViewer.currentScaleValue = 'page-width';
      setLoading(false);
      window.requestAnimationFrame(() => reportViewport(false));
    };
    const handlePageChanging = () => {
      window.requestAnimationFrame(() => reportViewport(false));
    };

    eventBus.on('pagesinit', handlePagesInit);
    eventBus.on('pagechanging', handlePageChanging);
    eventBus.on('textlayerrendered', handlePageChanging);

    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    void fileSystemApi.previewData(workspaceId, fileId, sourceUrl)
      .then((buffer) => {
        if (cancelled) return null;
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buffer),
          verbosity: pdfjsLib.VerbosityLevel.ERRORS
        });
        return loadingTask.promise;
      })
      .then((pdf: any) => {
        if (!pdf) return;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        loadedPdf = pdf;
        linkService.setDocument(pdf);
        pdfViewer.setDocument(pdf);
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
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
      eventBus.off('pagesinit', handlePagesInit);
      eventBus.off('pagechanging', handlePageChanging);
      eventBus.off('textlayerrendered', handlePageChanging);
      clearJumpHighlights();
      pdfViewer.cleanup();
      linkService.setDocument(null);
      void loadingTask?.destroy();
      void loadedPdf?.destroy?.();
      if (pdfViewerRef.current === pdfViewer) pdfViewerRef.current = null;
      if (linkServiceRef.current === linkService) linkServiceRef.current = null;
      viewerElement.replaceChildren();
    };
  }, [sourceUrl]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateScale = () => {
      const pdfViewer = pdfViewerRef.current;
      if (pdfViewer?.pdfDocument) {
        pdfViewer.currentScaleValue = 'page-width';
      }
    };
    updateScale();

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const pageSelector = (page: number) => `.page[data-page-number="${page}"]`;

  const clearJumpHighlights = () => {
    containerRef.current
      ?.querySelectorAll<HTMLElement>('[data-workbench-pdf-jump-highlight="true"]')
      .forEach((node) => node.remove());
  };

  const showJumpHighlight = (page: number, locator?: Record<string, any>) => {
    const pageElement = containerRef.current?.querySelector<HTMLElement>(pageSelector(page));
    if (!pageElement) return;

    clearJumpHighlights();
    const pageOverlay = document.createElement('div');
    pageOverlay.dataset.workbenchPdfJumpHighlight = 'true';
    Object.assign(pageOverlay.style, {
      position: 'absolute',
      inset: '0',
      border: '2px solid rgb(46,113,236)',
      boxShadow: '0 0 0 4px rgba(46,113,236,0.18)',
      pointerEvents: 'none',
      zIndex: '6'
    });
    pageElement.appendChild(pageOverlay);

    normalizePdfHighlightRects(locator, page, 1).forEach((rect) => {
      const rectOverlay = document.createElement('div');
      rectOverlay.dataset.workbenchPdfJumpHighlight = 'true';
      Object.assign(rectOverlay.style, {
        position: 'absolute',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        background: 'rgba(245,211,107,0.45)',
        border: '1px solid rgba(211,169,0,0.5)',
        borderRadius: '2px',
        pointerEvents: 'none',
        zIndex: '7'
      });
      pageElement.appendChild(rectOverlay);
    });

    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => {
      clearJumpHighlights();
      highlightTimeoutRef.current = null;
    }, 2400);
  };

  const scrollToPage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const pageCount = Math.max(1, pdfViewerRef.current?.pagesCount || page);
    const safePage = Math.min(Math.max(1, page), pageCount);
    linkServiceRef.current?.goToPage(safePage);
    const pageElement = containerRef.current?.querySelector<HTMLElement>(pageSelector(safePage));
    pageElement?.scrollIntoView({ behavior, block: 'start' });
  };

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { fileId?: string; locator?: { page?: number; pageStart?: number; primaryPage?: number } }
        | undefined;
      if (!detail?.fileId || detail.fileId !== fileId) return;
      const page = detail.locator?.page || detail.locator?.pageStart || detail.locator?.primaryPage;
      if (!page) return;
      scrollToPage(page);
      window.setTimeout(() => showJumpHighlight(page, detail.locator as Record<string, any>), 100);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [fileId]);

  const readSelectionLocator = (element: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const rawText = selection.toString();
    const selectedText = rawText.trim();
    if (!selectedText) return null;

    const range = selection.getRangeAt(0);
    const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rangeRects.length) return null;

    const pages = Array.from(element.querySelectorAll<HTMLElement>('.page[data-page-number]'));
    const rects: Array<{ page: number; left: number; top: number; width: number; height: number }> = [];
    let selectedPage: number | undefined;
    let pageElement: HTMLElement | null = null;

    pages.forEach((pageNode) => {
      const page = Number(pageNode.dataset.pageNumber);
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
    const anchorDomRect = rangeRects[rangeRects.length - 1];
    const containerBoundary = rectBoundary(element.getBoundingClientRect());
    const anchorRect = rectBoundary(anchorDomRect);
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
        x: Math.round(anchorDomRect.left + anchorDomRect.width / 2),
        y: Math.max(containerBoundary.top + 8, Math.round(anchorDomRect.top - 36)),
        anchorRect,
        boundaryRect: containerBoundary
      }
    };
  };

  const reportViewport = (showActions = false) => {
    const element = containerRef.current;
    if (!element) return;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const units = Array.from(element.querySelectorAll<HTMLElement>('.page[data-page-number]'));
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
      .map((item) => Number(item.unit.dataset.pageNumber))
      .filter((page) => Number.isFinite(page) && page > 0);
    const primaryPage = visiblePages[0] || 1;
    const selectionLocator = readSelectionLocator(element);
    const selectedText = selectionLocator?.selectedText || selectionMenuRef.current?.text || '';
    const selectedPage = selectionLocator?.selectedPage;

    if (enableSelectionActions && selectionLocator && showActions) {
      showSelectionMenu({
        x: selectionLocator.menu.x,
        y: selectionLocator.menu.y,
        anchorRect: selectionLocator.menu.anchorRect,
        boundaryRect: selectionLocator.menu.boundaryRect,
        text: selectionLocator.selectedText,
        page: selectedPage,
        selectedRange: selectionLocator.selectedRange
      });
    }

    onViewportChange({
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      visiblePages: [...new Set(visiblePages)].sort((left, right) => left - right),
      primaryPage,
      approxChunkIndex: Math.max(0, primaryPage - 1),
      selectedText,
      selectedRange: selectionLocator?.selectedRange || selectionMenuRef.current?.selectedRange || null,
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

  const applySelectionPrompt = (prompt: string, submitImmediately = false) => {
    const latestSelectionMenu = selectionMenuRef.current || selectionMenu;
    if (!latestSelectionMenu) return;
    window.dispatchEvent(
      new CustomEvent('workbench:pdf-selection-action', {
        detail: {
          fileId,
          fileName: resourceName,
          page: latestSelectionMenu.page,
          selectedRange: latestSelectionMenu.selectedRange,
          text: latestSelectionMenu.text,
          prompt,
          submitImmediately
        }
      })
    );
  };
  const buildPdfSelectionDetail = (prompt: string): WorkbenchContextSelectionActionDetail | null => {
    const latestSelectionMenu = selectionMenuRef.current || selectionMenu;
    if (!latestSelectionMenu) return null;
    return {
      fileId,
      fileName: resourceName,
      page: latestSelectionMenu.page,
      selectedRange: latestSelectionMenu.selectedRange,
      text: latestSelectionMenu.text,
      prompt,
      sourceLabel: `PDF selection${latestSelectionMenu.page ? ` · Page ${latestSelectionMenu.page}` : ''}`
    };
  };
  const askSelection: SelectionAskSubmitHandler = (question, history, handlers) => {
    const prompt = `请基于我选中的 PDF 内容回答：${question}`;
    const detail = buildPdfSelectionDetail(prompt);
    if (!detail?.text) return Promise.reject(new Error('选区已失效，请重新选择 PDF 内容。'));
    lastAskDetailRef.current = detail;
    return streamSelectionAsk({
      workspaceId,
      request: {
        question,
        prompt,
        selectedText: detail.text,
        detail
      },
      history,
      handlers
    });
  };
  const explainSelection: SelectionExplainSubmitHandler = (history, handlers) => {
    const prompt = '请解释我选中的这段 PDF 内容';
    const detail = buildPdfSelectionDetail(prompt);
    if (!detail?.text) return Promise.reject(new Error('选区已失效，请重新选择 PDF 内容。'));
    lastAskDetailRef.current = detail;
    return streamSelectionAsk({
      workspaceId,
      request: {
        question: 'Explain this selection',
        prompt,
        selectedText: detail.text,
        detail
      },
      history,
      handlers
    });
  };

  useEffect(() => {
    if (!enableSelectionActions) return;
    const handleSelectionChange = () => {
      window.setTimeout(() => reportViewport(false), 0);
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [enableSelectionActions, fileId]);

  return (
    <div ref={viewportRef} className="relative flex h-full min-h-0 flex-col bg-white">
      {enableSelectionActions && selectionMenu && (
        <SelectionActionPopover
          x={selectionMenu.x}
          y={selectionMenu.y}
          anchorRect={selectionMenu.anchorRect}
          boundaryRect={selectionMenu.boundaryRect}
          sourceLabel={`PDF selection${selectionMenu.page ? ` · Page ${selectionMenu.page}` : ''}`}
          onAsk={askSelection}
          onAddToAssistant={(result) => {
            const detail = lastAskDetailRef.current;
            if (detail) onAddSelectionAskToAssistant?.(result, detail);
          }}
          onExplain={explainSelection}
          onPin={() => applySelectionPrompt('__lock_pdf_selection__')}
          onDismiss={closeSelectionMenu}
        />
      )}
      <div className="relative min-h-0 flex-1 bg-white">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto px-6 py-7"
          onScroll={() => reportViewport(false)}
          onMouseEnter={() => reportViewport(false)}
          onMouseDown={() => closeSelectionMenu()}
          onMouseUp={() => reportViewport(true)}
          onKeyUp={() => reportViewport(true)}
        >
          <div ref={viewerRef} className="pdfViewer" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[#777a80]">Loading PDF...</div>
          )}
          {error && (
            <div className="mx-auto max-w-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentPreview({
  resource,
  workspaceId,
  aiContext,
  editorId,
  onUpdateViewState,
  onExtractedText,
  onDocumentStructure,
  onAddSelectionAskToAssistant,
  enableSelectionActions = true
}: {
  resource: ResourceReference;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  editorId: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onExtractedText?: (text: string) => void;
  onDocumentStructure?: (documentStructure: RenderableDocument | null) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  enableSelectionActions?: boolean;
}) {
  const [previewInfo, setPreviewInfo] = useState<FilePreviewInfo | null>(null);
  const [documentStructure, setDocumentStructure] = useState<RenderableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [jumpHighlight, setJumpHighlight] = useState<{ chunkIndex?: number; blockId?: string } | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const isPdfResource = getResourceKind(resource) === 'pdf';

  useEffect(() => {
    let active = true;
    const cacheKey = previewCacheKey(workspaceId, resource.id);
    const cachedPreviewInfo = previewInfoCache.get(cacheKey);
    const usableCachedPreviewInfo = cachedPreviewInfo?.status === 'unavailable' ? undefined : cachedPreviewInfo;
    const cachedStructure = documentStructureCache.get(cacheKey);

    if (usableCachedPreviewInfo || cachedStructure) {
      setPreviewInfo(usableCachedPreviewInfo ?? null);
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
            status: isPdfResource ? 'ready' : 'unavailable',
            previewKind: isPdfResource ? 'pdf' : 'document',
            previewUrl: isPdfResource ? fileSystemApi.previewUrl(workspaceId, resource.id) : undefined,
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          } as FilePreviewInfo;
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
            status: isPdfResource ? 'ready' : 'unavailable',
            previewKind: isPdfResource ? 'pdf' : 'document',
            previewUrl: isPdfResource ? fileSystemApi.previewUrl(workspaceId, resource.id) : undefined,
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          } as FilePreviewInfo;
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
    isPdfResource ||
    documentStructure?.kind === 'pdf' ||
    (previewInfo?.status === 'ready' && (previewInfo.previewKind === 'pdf' || previewInfo.previewKind === 'document') && previewInfo.previewUrl)
  ) {
    return (
      <PdfJsReader
        sourceUrl={previewInfo?.previewUrl || fileSystemApi.previewUrl(workspaceId, resource.id)}
        workspaceId={workspaceId}
        aiContext={aiContext}
        fileId={resource.id}
        resourceName={resource.name}
        onViewportChange={(patch) => onUpdateViewState?.(editorId, patch)}
        onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        enableSelectionActions={enableSelectionActions}
      />
    );
  }

  const reader = (
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

  return enableSelectionActions ? (
    <SelectionActionLayer
      fileId={resource.id}
      fileName={resource.name}
      panelId={editorId}
      panelType="document"
      sourceLabel="文档选区"
      workspaceId={workspaceId}
      aiContext={aiContext}
      onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
      onSelectionChange={(patch) => onUpdateViewState?.(editorId, patch)}
    >
      {reader}
    </SelectionActionLayer>
  ) : reader;
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
  aiContext,
  resource,
  editorId,
  onUpdateViewState,
  onExtractedText,
  onAddSelectionAskToAssistant,
  enableSelectionActions = true
}: {
  title: string;
  url?: string;
  body?: string;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  resource?: ResourceReference;
  editorId?: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onExtractedText?: (text: string) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  enableSelectionActions?: boolean;
}) {
  const embed = getEmbedInfo(url);
  const [previewData, setPreviewData] = useState<WebPreviewData | null>(null);
  const [activeUrl, setActiveUrl] = useState(url || '');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    anchorRect: SelectionPopoverBoundary;
    boundaryRect: SelectionPopoverBoundary;
    text: string;
    selectedRange: Record<string, any>;
  } | null>(null);
  const selectionMenuRef = useRef<typeof selectionMenu>(null);
  const lastAskDetailRef = useRef<WorkbenchContextSelectionActionDetail | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const displayedTitle = previewData?.title || title;
  const displayedUrl = previewData?.url || activeUrl || url;
  const richHtml = previewData?.contentHtml || '';
  const readableText = previewData?.contentMarkdown || body || '';

  useEffect(() => {
    selectionMenuRef.current = selectionMenu;
  }, [selectionMenu]);

  const showSelectionMenu = (nextMenu: NonNullable<typeof selectionMenu>) => {
    selectionMenuRef.current = nextMenu;
    setSelectionMenu(nextMenu);
  };

  const closeSelectionMenu = () => {
    selectionMenuRef.current = null;
    setSelectionMenu(null);
    if (resource?.id && editorId && onUpdateViewState) {
      onUpdateViewState(editorId, {
        selectedText: '',
        selectedRange: null
      });
    }
  };

  useEffect(() => {
    setActiveUrl(url || '');
    setPreviewData(null);
    selectionMenuRef.current = null;
    setSelectionMenu(null);
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
    const rect = lastUsableRangeRect(range);
    if (!rect.width && !rect.height) return null;
    const boundaryRect = rectBoundary(element.getBoundingClientRect());
    const anchorRect = rectBoundary(rect);
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
        y: Math.max(boundaryRect.top + 8, Math.round(rect.top - 36)),
        anchorRect,
        boundaryRect
      }
    };
  };

  const reportWebContext = (showActions = false) => {
    const element = scrollerRef.current;
    if (!resource?.id || !editorId || !onUpdateViewState || !element) return;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const selectionLocator = enableSelectionActions ? readWebSelection() : null;
    const latestSelectionMenu = selectionMenuRef.current;
    const scrollRatio = Math.min(1, Math.max(0, element.scrollTop / totalScrollable));
    const lineCount = Math.max(1, readableText.split('\n').length);
    const approxLine = Math.max(1, Math.round(scrollRatio * lineCount));
    if (selectionLocator && showActions) {
      showSelectionMenu({
        x: selectionLocator.menu.x,
        y: selectionLocator.menu.y,
        anchorRect: selectionLocator.menu.anchorRect,
        boundaryRect: selectionLocator.menu.boundaryRect,
        text: selectionLocator.selectedText,
        selectedRange: selectionLocator.selectedRange
      });
    }
    onUpdateViewState(editorId, {
      scrollRatio,
      approxChunkIndex: Math.max(0, approxLine - 1),
      visibleLineRange: { start: approxLine, end: Math.min(lineCount, approxLine + 40) },
      selectedText: selectionLocator?.selectedText || latestSelectionMenu?.text || '',
      selectedRange: selectionLocator?.selectedRange || latestSelectionMenu?.selectedRange || null,
      visibleContent: selectionLocator?.selectedText || latestSelectionMenu?.text || readableText.slice(Math.max(0, approxLine - 1), approxLine + 2500)
    });
  };

  const applyWebSelectionPrompt = (prompt: string, submitImmediately = false) => {
    const latestSelectionMenu = selectionMenuRef.current || selectionMenu;
    if (!latestSelectionMenu || !resource?.id) return;
    window.dispatchEvent(
      new CustomEvent('workbench:context-selection-action', {
        detail: {
          fileId: resource.id,
          fileName: displayedTitle || resource.name,
          panelId: editorId,
          panelType: 'web',
          sourceLabel: '网页选区',
          selectedRange: latestSelectionMenu.selectedRange,
          text: latestSelectionMenu.text,
          prompt,
          submitImmediately
        } as WorkbenchContextSelectionActionDetail
      })
    );
  };
  const buildWebSelectionDetail = (prompt: string): WorkbenchContextSelectionActionDetail | null => {
    const latestSelectionMenu = selectionMenuRef.current || selectionMenu;
    if (!latestSelectionMenu || !resource?.id) return null;
    return {
      fileId: resource.id,
      fileName: displayedTitle || resource.name,
      panelId: editorId,
      panelType: 'web',
      sourceLabel: '网页选区',
      selectedRange: latestSelectionMenu.selectedRange,
      text: latestSelectionMenu.text,
      prompt
    };
  };
  const askWebSelection: SelectionAskSubmitHandler = (question, history, handlers) => {
    const prompt = `请基于我选中的网页内容回答：${question}`;
    const detail = buildWebSelectionDetail(prompt);
    if (!detail?.text) return Promise.reject(new Error('选区已失效，请重新选择网页内容。'));
    lastAskDetailRef.current = detail;
    return streamSelectionAsk({
      workspaceId,
      request: {
        question,
        prompt,
        selectedText: detail.text,
        detail
      },
      history,
      handlers
    });
  };
  const explainWebSelection: SelectionExplainSubmitHandler = (history, handlers) => {
    const prompt = '请解释我选中的这段网页内容';
    const detail = buildWebSelectionDetail(prompt);
    if (!detail?.text) return Promise.reject(new Error('选区已失效，请重新选择网页内容。'));
    lastAskDetailRef.current = detail;
    return streamSelectionAsk({
      workspaceId,
      request: {
        question: 'Explain this selection',
        prompt,
        selectedText: detail.text,
        detail
      },
      history,
      handlers
    });
  };

  useEffect(() => {
    if (!enableSelectionActions) return;
    const handleSelectionChange = () => {
      window.setTimeout(() => reportWebContext(false), 0);
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [activeUrl, displayedUrl, enableSelectionActions, readableText, resource?.id]);

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
      onScroll={() => reportWebContext(false)}
      onMouseDown={() => closeSelectionMenu()}
      onMouseUp={() => reportWebContext(true)}
      onKeyUp={() => reportWebContext(true)}
      onMouseEnter={() => reportWebContext(false)}
    >
      {enableSelectionActions && selectionMenu && (
        <SelectionActionPopover
          x={selectionMenu.x}
          y={selectionMenu.y}
          anchorRect={selectionMenu.anchorRect}
          boundaryRect={selectionMenu.boundaryRect}
          sourceLabel="Web selection"
          onAsk={askWebSelection}
          onAddToAssistant={(result) => {
            const detail = lastAskDetailRef.current;
            if (detail) onAddSelectionAskToAssistant?.(result, detail);
          }}
          onExplain={explainWebSelection}
          onPin={() => applyWebSelectionPrompt('__lock_context_selection__')}
          onDismiss={closeSelectionMenu}
        />
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
  workspaceId,
  aiContext,
  content,
  isLoading,
  onChangeContent,
  onUpdateViewState,
  onAddSelectionAskToAssistant,
  minimalPreview = false
}: {
  editor: EditorState;
  resource: ResourceReference;
  workspaceId: string;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
  content: string;
  isLoading: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  minimalPreview?: boolean;
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

  const previewContent = showMarkdownPreview ? (
    <SelectionActionLayer
      fileId={resource.id}
      fileName={resource.name}
      panelId={editor.id}
      panelType={editor.type}
      sourceLabel="Markdown 选区"
      workspaceId={workspaceId}
      aiContext={aiContext}
      onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
      onSelectionChange={(patch) => onUpdateViewState?.(editor.id, patch)}
    >
      <MarkdownPreview
        content={content}
        emptyMessage={isLoading ? 'Loading file content...' : 'Open a markdown note to preview.'}
        onViewportChange={(patch) => onUpdateViewState?.(editor.id, patch)}
        fileId={resource.id}
      />
    </SelectionActionLayer>
  ) : resourceKind === 'note' ? (
    <SelectionActionLayer
      fileId={resource.id}
      fileName={resource.name}
      panelId={editor.id}
      panelType={editor.type}
      sourceLabel="文本选区"
      workspaceId={workspaceId}
      aiContext={aiContext}
      onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
      onSelectionChange={(patch) => onUpdateViewState?.(editor.id, patch)}
    >
      <PlainTextPreview
        content={content}
        emptyMessage={isLoading ? 'Loading file content...' : 'Open a text note to preview.'}
        onViewportChange={(patch) => onUpdateViewState?.(editor.id, patch)}
        fileId={resource.id}
      />
    </SelectionActionLayer>
  ) : (
    <SelectionActionLayer
      fileId={resource.id}
      fileName={resource.name}
      panelId={editor.id}
      panelType={editor.type}
      sourceLabel="代码选区"
      workspaceId={workspaceId}
      aiContext={aiContext}
      onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
      onSelectionChange={(patch) => onUpdateViewState?.(editor.id, patch)}
    >
      <SyntaxHighlightedCode
        code={content}
        language={languageLabel}
        emptyMessage={isLoading ? 'Loading file content...' : 'Open a file to preview.'}
        onViewportChange={(patch) => onUpdateViewState?.(editor.id, patch)}
        fileId={resource.id}
      />
    </SelectionActionLayer>
  );

  if (minimalPreview) {
    return <TextEditorShell>{previewContent}</TextEditorShell>;
  }

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
      ) : previewContent}
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
  const [queuedChatRequests, setQueuedChatRequests] = useState<QueuedChatRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<AgentTimelineItem[]>([]);
  const [thinkingTraceOpen, setThinkingTraceOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentSubmenu, setAttachmentSubmenu] = useState<ComposerAttachMenu>('root');
  const [contextModeMenuOpen, setContextModeMenuOpen] = useState(false);
  const [contextSubmenuOpen, setContextSubmenuOpen] = useState(false);
  const [webpageUrlDraft, setWebpageUrlDraft] = useState('');
  const [webpageTitleDraft, setWebpageTitleDraft] = useState('');
  const [attachBusyKey, setAttachBusyKey] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [referencedChatSessions, setReferencedChatSessions] = useState<any[] | null>(null);
  const [referenceChatsLoading, setReferenceChatsLoading] = useState(false);
  const [workspaceKnowledgeResources, setWorkspaceKnowledgeResources] = useState<ResourceReference[] | null>(null);
  const [workspaceKnowledgeLoading, setWorkspaceKnowledgeLoading] = useState(false);
  const [inspectedChipId, setInspectedChipId] = useState<string | null>(null);
  const [sourceModalSource, setSourceModalSource] = useState<CitationUiSource | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AiChatAttachment | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [savingAttachmentId, setSavingAttachmentId] = useState<string | null>(null);
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
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const isStoppingRef = useRef(false);
  const openComposerMenu = (menu: 'attachment' | 'context') => {
    setAttachmentMenuOpen((open) => {
      const next = menu === 'attachment' ? !open : false;
      if (next) {
        setAttachmentSubmenu('root');
        setAttachError(null);
      }
      return next;
    });
    setContextModeMenuOpen((open) => {
      const next = menu === 'context' ? !open : false;
      if (!next) setContextSubmenuOpen(false);
      return next;
    });
  };
  const messages = useMemo(
    () => (Array.isArray(editor.viewState?.messages) ? editor.viewState.messages : []),
    [editor.viewState?.messages]
  );
  const messagesRef = useRef<AiChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages as AiChatMessage[];
  }, [messages]);
  const chatSessionAttachments = useMemo(
    () =>
      Array.isArray(editor.viewState?.chatSessionAttachments)
        ? ((editor.viewState.chatSessionAttachments as any[]) as AiChatAttachment[])
        : [],
    [editor.viewState?.chatSessionAttachments]
  );
  const previewResources = useMemo(
    () => [...resources, ...(workspaceKnowledgeResources || [])].filter((resource) => resource.type !== 'folder'),
    [resources, workspaceKnowledgeResources]
  );
  const previewResourceForAttachment = useMemo(
    () =>
      previewAttachment?.fileObjectId
        ? previewResources.find((resource) => resource.id === previewAttachment.fileObjectId) || null
        : null,
    [previewAttachment?.fileObjectId, previewResources]
  );
  const storedContextMode = editor.viewState?.contextMode as AiContextMode | 'workspace' | undefined;
  const contextMode: AiContextMode =
    storedContextMode === 'workspace' || storedContextMode === 'selection_only'
      ? 'auto'
      : storedContextMode || 'auto';
  const contextModeOptions = useMemo(
    () =>
      [
        ['auto', 'Auto context', Hand],
        ['viewport', 'Visible context', Eye],
        ['active_file', 'Current file', FileText],
        ['workbench', 'Workbench resources', FolderOpen],
        ['model_knowledge', 'Model knowledge', Brain]
      ] as Array<[AiContextMode, string, typeof Hand]>,
    []
  );
  const contextModeLabel = contextModeOptions.find(([mode]) => mode === contextMode)?.[1] || 'Auto context';
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

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-ai-composer-menu]')) return;
      setAttachmentMenuOpen(false);
      setAttachmentSubmenu('root');
      setContextModeMenuOpen(false);
      setContextSubmenuOpen(false);
    };
    window.addEventListener('mousedown', closeMenus);
    return () => window.removeEventListener('mousedown', closeMenus);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('openwebui-composer-menu-animations')) return;
    const style = document.createElement('style');
    style.id = 'openwebui-composer-menu-animations';
    style.textContent = `
      @keyframes openwebui-composer-dropdown-in {
        from {
          opacity: 0;
          transform: translate3d(0, -8px, 0) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }

      @keyframes openwebui-composer-slide-root {
        from {
          opacity: 0;
          transform: translate3d(-20px, 0, 0);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
      }

      @keyframes openwebui-composer-slide-sub {
        from {
          opacity: 0;
          transform: translate3d(20px, 0, 0);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
      }

      .openwebui-composer-dropdown-in {
        transform-origin: bottom left;
        animation: openwebui-composer-dropdown-in 200ms cubic-bezier(0.33, 1, 0.68, 1);
        will-change: transform, opacity;
      }

      .openwebui-composer-slide-root {
        animation: openwebui-composer-slide-root 150ms cubic-bezier(0.33, 1, 0.68, 1);
        will-change: transform, opacity;
      }

      .openwebui-composer-slide-sub {
        animation: openwebui-composer-slide-sub 150ms cubic-bezier(0.33, 1, 0.68, 1);
        will-change: transform, opacity;
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (attachmentMenuOpen && attachmentSubmenu === 'chats') {
      void loadReferenceChats();
    }
    if (attachmentMenuOpen && attachmentSubmenu === 'knowledge') {
      void loadWorkspaceKnowledge();
    }
  }, [attachmentMenuOpen, attachmentSubmenu]);

  useEffect(() => {
    setWorkspaceKnowledgeResources(null);
    setReferencedChatSessions(null);
  }, [workspaceId, aiContext?.workbenchId]);
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
  const contextAttachmentDisplayType = (selection: DroppedContextSelection): AiChatAttachment['displayType'] => {
    const sourceLabel = String(selection.sourceLabel || '').toLowerCase();
    const sourceType = String(selection.selectedRange?.sourceType || '').toLowerCase();
    if (sourceLabel.includes('note')) return 'note';
    if (sourceLabel.includes('chat') || sourceType === 'reference_chat') return 'chat';
    if (sourceLabel.includes('knowledge')) return 'collection';
    if (sourceLabel.includes('webpage') || sourceType === 'webpage') return 'webpage';
    return 'selection';
  };
  const droppedSelectionToAttachment = (selection: DroppedContextSelection): AiChatAttachment => {
    const sourceLabel = selection.sourceLabel || 'Selection';
    const displayText = selection.text.replace(/\s+/g, ' ').trim();
    const displayName =
      contextAttachmentDisplayType(selection) === 'selection'
        ? displayText.slice(0, 42) || sourceLabel
        : [sourceLabel, selection.fileName].filter(Boolean).join(' · ') || displayText.slice(0, 42) || sourceLabel;
    return {
      id: `context:${selection.id}`,
      name: displayName,
      mimeType: 'text/plain',
      size: new Blob([selection.text]).size,
      kind: 'text',
      displayType: contextAttachmentDisplayType(selection),
      sourceLabel,
      locator: selection.selectedRange,
      textContent: selection.text,
      summary: selection.text.slice(0, 500),
      fileObjectId: selection.fileId || undefined,
      createdAt: selection.createdAt || new Date().toISOString(),
      status: 'ready'
    };
  };
  const composerContextAttachments = useMemo(
    () => droppedContextSelections.map(droppedSelectionToAttachment),
    [droppedContextSelections]
  );
  const menuContextChips = contextChips.filter((chip) => chip.kind !== 'selection' && chip.kind !== 'active_file');
  const lastAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') return index;
    }
    return -1;
  }, [messages]);

  const hideChip = (chipId: string) => {
    if (droppedContextSelections.some((selection) => selection.id === chipId)) {
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

  const isWorkbenchUserMarkdownNote = (resource: ResourceReference) =>
    resource.type !== 'folder' &&
    resource.fileCategory === 'note' &&
    resource.resourceType === 'note' &&
    resource.scope === 'workbench' &&
    resource.origin === 'user' &&
    (resource.extension === 'md' || resource.mimeType === 'text/markdown' || resource.name.toLowerCase().endsWith('.md'));

  const isWorkspaceKnowledgeResource = (resource: ResourceReference) =>
    resource.type !== 'folder' &&
    resource.scope === 'workspace' &&
    resource.resourceType === 'source';

  const knowledgeAttachResources = useMemo(
    () => (workspaceKnowledgeResources || []).filter(isWorkspaceKnowledgeResource).slice(0, 50),
    [workspaceKnowledgeResources]
  );
  const noteAttachResources = useMemo(
    () => resources.filter(isWorkbenchUserMarkdownNote).slice(0, 30),
    [resources]
  );

  const closeAttachmentMenu = () => {
    setAttachmentMenuOpen(false);
    setAttachmentSubmenu('root');
    setAttachError(null);
  };

  const buildResourceContextText = async (resource: ResourceReference) => {
    const isActiveResource = aiContext?.activeFile?.id === resource.id;
    const activeContent = isActiveResource ? aiContext?.activeFileContent || aiContext?.activeFile?.content || '' : '';
    if (activeContent.trim()) return activeContent.trim().slice(0, 12000);

    try {
      const structure = await fileSystemApi.getDocumentStructure(workspaceId, resource.id);
      const pageText = Array.isArray(structure.pages)
        ? structure.pages.map((page) => page.text).filter(Boolean).join('\n\n')
        : '';
      const chunkText = Array.isArray(structure.chunks)
        ? structure.chunks.map((chunk) => chunk.text).filter(Boolean).join('\n\n')
        : '';
      const text = pageText || chunkText;
      if (text.trim()) return text.trim().slice(0, 12000);
    } catch {
      // The resource can still be referenced by metadata if extraction is unavailable.
    }

    try {
      const preview = await fileSystemApi.getPreviewInfo(workspaceId, resource.id);
      return [
        resource.name,
        resource.path,
        preview.message,
        preview.sourceUrl || preview.previewUrl
      ].filter(Boolean).join('\n');
    } catch {
      return [resource.name, resource.path, resource.resourceType, resource.fileCategory].filter(Boolean).join('\n');
    }
  };

  const attachResourceContext = async (resource: ResourceReference, sourceLabel: string) => {
    if (attachBusyKey) return;
    setAttachBusyKey(`${sourceLabel}:${resource.id}`);
    setAttachError(null);
    try {
      const text = await buildResourceContextText(resource);
      addDroppedContextSelection({
        fileId: resource.id,
        fileName: resource.name,
        sourceLabel,
        panelType: isWorkbenchUserMarkdownNote(resource) ? 'notes' : 'resource',
        text
      });
      closeAttachmentMenu();
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : 'Failed to attach resource.');
    } finally {
      setAttachBusyKey(null);
    }
  };

  const attachWebpageContext = async () => {
    const rawUrl = webpageUrlDraft.trim();
    if (!rawUrl || attachBusyKey) return;
    let normalizedUrl = '';
    try {
      normalizedUrl = normalizeComposerUrl(rawUrl);
      new URL(normalizedUrl);
    } catch {
      setAttachError('Please enter a valid URL.');
      return;
    }

    setAttachBusyKey('webpage');
    setAttachError(null);
    try {
      const preview = await fileSystemApi.extractUrlPreview(workspaceId, {
        url: normalizedUrl,
        title: webpageTitleDraft.trim() || undefined
      });
      const title = webpageTitleDraft.trim() || preview.title || makeComposerTitleFromUrl(normalizedUrl);
      const imported = aiContext?.workbenchId
        ? await fileSystemApi.importUrl(workspaceId, {
            url: normalizedUrl,
            title,
            workbenchId: aiContext.workbenchId,
            resourceRole: 'source',
            resourceType: 'source',
            scope: 'workbench',
            origin: 'web'
          }).catch(() => null)
        : null;
      const file = imported?.file;
      addDroppedContextSelection({
        fileId: file?.id || normalizedUrl,
        fileName: file?.name || title,
        sourceLabel: 'Webpage',
        panelType: 'external',
        selectedRange: {
          sourceType: 'webpage',
          url: preview.url || normalizedUrl,
          textLength: (preview.contentMarkdown || preview.excerpt || '').length
        },
        text: [title, preview.url || normalizedUrl, preview.excerpt, preview.contentMarkdown]
          .filter(Boolean)
          .join('\n\n')
      });
      setWebpageUrlDraft('');
      setWebpageTitleDraft('');
      closeAttachmentMenu();
    } catch (error: any) {
      setAttachError(error?.response?.data?.error || error?.message || 'Failed to attach webpage.');
    } finally {
      setAttachBusyKey(null);
    }
  };

  const loadReferenceChats = async () => {
    if (referenceChatsLoading || referencedChatSessions) return;
    setReferenceChatsLoading(true);
    setAttachError(null);
    try {
      const result = await learningApi.listConversationSessions(workspaceId, {
        workbenchId: aiContext?.workbenchId,
        source: 'workbench_ai',
        includeMessages: true,
        limit: 100
      });
      setReferencedChatSessions(Array.isArray(result.sessions) ? result.sessions : []);
    } catch (error: any) {
      setAttachError(error?.response?.data?.error || error?.message || 'Failed to load chats.');
      setReferencedChatSessions([]);
    } finally {
      setReferenceChatsLoading(false);
    }
  };

  const loadWorkspaceKnowledge = async () => {
    if (workspaceKnowledgeLoading || workspaceKnowledgeResources) return;
    setWorkspaceKnowledgeLoading(true);
    setAttachError(null);
    try {
      const result = await fileSystemApi.getResources(workspaceId, {
        scope: 'workspace',
        role: 'source'
      });
      setWorkspaceKnowledgeResources(Array.isArray(result) ? (result as ResourceReference[]) : []);
    } catch (error: any) {
      setAttachError(error?.response?.data?.error || error?.message || 'Failed to load knowledge.');
      setWorkspaceKnowledgeResources([]);
    } finally {
      setWorkspaceKnowledgeLoading(false);
    }
  };

  const attachChatContext = (session: any) => {
    const sessionMessages = Array.isArray(session.messages)
      ? session.messages
      : Array.isArray(session.viewState?.messages)
        ? session.viewState.messages
        : [];
    const text = sessionMessages
      .slice(-20)
      .map((message: any) => `${message.role || 'message'}: ${String(message.content || '').trim()}`)
      .filter((line: string) => line.trim() && !line.endsWith(':'))
      .join('\n\n');
    addDroppedContextSelection({
      fileId: session.id,
      fileName: session.title || 'AI Chat',
      sourceLabel: 'Chat',
      panelType: 'ai',
      selectedRange: {
        sourceType: 'reference_chat',
        sessionId: session.id,
        messageCount: sessionMessages.length
      },
      text: [`Conversation: ${session.title || 'AI Chat'}`, text || session.lastMessagePreview || 'No messages available.']
        .filter(Boolean)
        .join('\n\n')
    });
    closeAttachmentMenu();
  };

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

  const buildDroppedSelectionContext = (selections: DroppedContextSelection[] = droppedContextSelections): AiLockedSelectionContext | null => {
    if (!selections.length) return null;
    const first = selections[0];
    return {
      id: `dropped-context:${selections.map((selection) => selection.id).join('|')}`,
      panelId: first.panelId,
      panelType: first.panelType || 'video',
      fileId: first.fileId || null,
      fileName: first.fileName,
      content: selections
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
        textLength: selections.reduce((sum, selection) => sum + selection.text.length, 0)
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
    baseMessages,
    attachments,
    droppedSelections,
    clearComposer = true
  }: {
    prompt: string;
    baseMessages: AiChatMessage[];
    attachments?: AiChatAttachment[];
    droppedSelections?: DroppedContextSelection[];
    clearComposer?: boolean;
  }): Promise<boolean> => {
    const trimmedInput = prompt.trim();
    const effectiveAttachments = (attachments || chatSessionAttachments).map((attachment) => ({ ...attachment }));
    const effectiveDroppedSelections = (droppedSelections || droppedContextSelections).map((selection) => ({ ...selection }));
    const effectiveContextAttachments = effectiveDroppedSelections.map(droppedSelectionToAttachment);
    if (!trimmedInput && effectiveAttachments.length === 0 && effectiveContextAttachments.length === 0) return false;

    const userContent = trimmedInput || '请分析当前附件和上下文。';
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
    const previousDroppedContextSelections = droppedContextSelections.map((selection) => ({ ...selection }));
    const pendingAttachments = effectiveAttachments;
    const pendingContextAttachments = effectiveContextAttachments.map((attachment) => ({ ...attachment }));
    const messageAttachments = [...pendingContextAttachments, ...pendingAttachments].map(stripAttachmentPayload);
    const nextMessages: AiChatMessage[] = [
      ...previousMessages,
      { role: 'user', content: userContent, createdAt, attachments: messageAttachments }
    ];

    onUpdateViewState?.(editor.id, {
      messages: nextMessages,
      ...(clearComposer ? { chatSessionAttachments: [], droppedContextSelections: [] } : {})
    });
    if (clearComposer) setInput('');
    setError(null);
    setTimeline([]);
    setThinkingTraceOpen(true);
    setIsSending(true);

    let abortController: AbortController | null = null;
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
      const droppedSelectionContext = buildDroppedSelectionContext(effectiveDroppedSelections);
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
      const droppedSelectionCitations = effectiveDroppedSelections.map((selection, index) => ({
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
        activeFile: aiContext?.activeFile
          ? {
              ...aiContext.activeFile,
              content: aiContext.activeFileContent || undefined
            }
          : null,
        activeExternal: aiContext?.activeExternal || null,
        openPanels: aiContext?.openPanels || [],
        visiblePanels: aiContext?.visiblePanels || [],
        chatSessionAttachments: pendingAttachments,
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

      if (clearComposer) onUpdateViewState?.(editor.id, { chatSessionAttachments: [], droppedContextSelections: [] });
      onUpdateViewState?.(editor.id, { messages: streamMessages });

      abortController = new AbortController();
      streamAbortControllerRef.current = abortController;
      isStoppingRef.current = false;
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
              lastModel: meta.model || 'default'
            });
          }
        },
        { signal: abortController.signal }
      );

      setTimeline(response.timeline || []);
      streamMessages[streamMessages.length - 1] = {
        role: 'assistant',
        content: `${initialAssistantContent}${response.reply}`,
        createdAt: assistantCreatedAt
      };
      onUpdateViewState?.(editor.id, {
        messages: [...streamMessages],
        lastModel: response.model || 'default'
      });
      return true;
    } catch (sendError: any) {
      if (sendError?.name === 'AbortError' || abortController?.signal.aborted || isStoppingRef.current) {
        setError(null);
        return true;
      }
      const message =
        sendError?.response?.data?.error ||
        sendError?.message ||
        'AI request failed. Please check the backend configuration.';
      setError(
        message === 'fetch failed'
          ? 'AI 请求失败：后端或检索模型服务暂时不可用。已更新为本地 BM25 降级链路，请重启后端后重试。'
          : message
      );
      onUpdateViewState?.(editor.id, {
        messages: previousMessages,
        ...(clearComposer
          ? {
              chatSessionAttachments: pendingAttachments,
              droppedContextSelections: previousDroppedContextSelections
            }
          : {})
      });
      return false;
    } finally {
      if (streamAbortControllerRef.current === abortController) {
        streamAbortControllerRef.current = null;
        isStoppingRef.current = false;
      }
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    const hasContent = input.trim() || chatSessionAttachments.length > 0 || composerContextAttachments.length > 0;
    if (isSending) {
      if (!hasContent) return;
      setQueuedChatRequests((items) => [
        ...items,
        {
          id: `queued:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          prompt: input,
          attachments: chatSessionAttachments.map((attachment) => ({ ...attachment })),
          droppedSelections: droppedContextSelections.map((selection) => ({ ...selection }))
        }
      ]);
      setInput('');
      onUpdateViewState?.(editor.id, { chatSessionAttachments: [], droppedContextSelections: [] });
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    await submitMessages({
      prompt: input,
      baseMessages: [...messages] as AiChatMessage[]
    });
  };

  const stopGeneration = () => {
    isStoppingRef.current = true;
    streamAbortControllerRef.current?.abort();
    setIsSending(false);
  };

  useEffect(() => {
    if (isSending || queuedChatRequests.length === 0) return;
    const [next, ...rest] = queuedChatRequests;
    setQueuedChatRequests(rest);
    void submitMessages({
      prompt: next.prompt,
      baseMessages: [...messagesRef.current],
      attachments: next.attachments,
      droppedSelections: next.droppedSelections,
      clearComposer: false
    });
  }, [isSending, queuedChatRequests]);

  const submitSelectionPrompt = async (prompt: string, detail?: WorkbenchContextSelectionActionDetail) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    const selectionText = String(detail?.text || '').trim();
    const promptWithSelection = selectionText
      ? `${trimmedPrompt}\n\n【选区内容】\n${selectionText}`
      : trimmedPrompt;
    setInput(promptWithSelection);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    if (isSending) {
      setQueuedChatRequests((items) => [
        ...items,
        {
          id: `queued:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          prompt: promptWithSelection,
          attachments: chatSessionAttachments.map((attachment) => ({ ...attachment })),
          droppedSelections: droppedContextSelections.map((selection) => ({ ...selection }))
        }
      ]);
      setInput('');
      onUpdateViewState?.(editor.id, { chatSessionAttachments: [], droppedContextSelections: [] });
      return;
    }
    const submitted = await submitMessages({
      prompt: promptWithSelection,
      baseMessages: [...messagesRef.current]
    });
    if (!submitted) {
      setInput(promptWithSelection);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    const handleSelectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as WorkbenchContextSelectionActionDetail | undefined;
      if (!detail?.prompt) return;
      if ((detail.prompt === '__lock_pdf_selection__' || detail.prompt === '__lock_context_selection__') && detail.text) {
        addDroppedContextSelection(detail);
        return;
      }
      if (detail.submitImmediately) {
        void submitSelectionPrompt(detail.prompt, detail);
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
  }, [addDroppedContextSelection, isSending, submitSelectionPrompt]);

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
      <AttachmentPreviewModal
        workspaceId={workspaceId}
        attachment={previewAttachment}
        resource={previewResourceForAttachment}
        onClose={() => setPreviewAttachment(null)}
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

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
          {hideHeader && error && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {error}
            </div>
          )}
          {messages.length === 0 && (
            <div className={`ai-message-in mx-auto flex w-full max-w-2xl flex-col items-center text-center ${compactWelcome ? 'pt-8' : 'pt-16'}`}>
              <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-gray-50 text-3xl">
                <span aria-hidden="true">🙂</span>
              </div>
              <h2 className="max-w-xl text-2xl font-medium tracking-0 text-gray-900">
                开始新聊天
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#777a80]">
                直接输入你想做的事，或者把问题、选中的内容、下一步目标发给我。
              </p>
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
                  className={`ai-message-in group flex w-full ${isAssistant ? 'items-start' : 'justify-end'}`}
                >
                <div className={isAssistant ? 'min-w-0 flex-1 pb-4' : 'flex max-w-[min(85%,640px)] flex-col items-end'}>
                  {isAssistant ? (
                    <>
                      <div className="mb-0.5 flex items-center text-xs">
                        <div className="text-[0.65rem] font-medium first-letter:capitalize text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="line-clamp-1">{messageTime}</span>
                        </div>
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
                      <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => void copyMessage(cleanMessageContent, index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="复制">
                          {copiedMessageIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button onClick={() => void regenerateFrom(index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="重新生成">
                          <RefreshCcw className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mb-1 flex items-center gap-2 pr-2 text-xs font-medium text-[#a1a1aa] opacity-0 transition-opacity group-hover:opacity-100">
                        <span>{messageTime}</span>
                      </div>
                      <MessageAttachmentStrip attachments={message.attachments} onOpen={setPreviewAttachment} />
                      <div className={`rounded-3xl max-w-[90%] px-4 py-1.5 bg-gray-50 dark:bg-gray-850 ${message.attachments ? 'rounded-tr-lg' : ''}`}>
                        {editingMessageIndex === index ? (
                          <div className="w-[min(520px,calc(100vw-7rem))]">
                            <textarea
                              value={editingMessageContent}
                              onChange={(event) => setEditingMessageContent(event.target.value)}
                              className="block min-h-[76px] w-full resize-y rounded-2xl border border-[#e5e7eb] bg-white p-3 text-sm text-[#111827] outline-none focus:border-[#111827]"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button onClick={() => setEditingMessageIndex(null)} className="rounded-full px-3 py-1.5 text-xs font-medium text-[#6b7280] hover:bg-[#ededee]">取消</button>
                              <button onClick={() => void saveEditMessage(index)} className="rounded-full bg-[#111827] px-3 py-1.5 text-xs font-medium text-white">保存</button>
                            </div>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {displayContent}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1 pr-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => startEditMessage(index, message.content)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="编辑">
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => void copyMessage(displayContent, index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="复制">
                          {copiedMessageIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button onClick={() => deleteMessage(index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#fef2f2] hover:text-[#b91c1c]" title="删除">
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

      <div className="bg-white px-4 pb-4 pt-2">
        <div className="mx-auto w-full max-w-3xl">
          <div
            data-ai-composer-menu
            id="message-input-container"
            className="flex-1 flex flex-col relative w-full shadow-lg rounded-3xl border border-gray-100/30 dark:border-gray-850/30 hover:border-gray-200 focus-within:border-gray-100 hover:dark:border-gray-800 focus-within:dark:border-gray-800 transition px-1 bg-white/5 dark:bg-gray-500/5 backdrop-blur-sm dark:text-gray-100"
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
                  chip.kind === 'selection' ? (
                    <SelectionCapsule
                      key={chip.id}
                      label={chip.label}
                      preview={chip.detail}
                      onInspect={() => setInspectedChipId(inspectedChipId === chip.id ? null : chip.id)}
                      onDismiss={() => hideChip(chip.id)}
                    />
                  ) : (
                    <OpenWebUIFileItem
                      key={chip.id}
                      name={chip.label}
                      type="file"
                      dismissible
                      onDismiss={() => hideChip(chip.id)}
                    />
                  )
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
              id="chat-input"
              className="scrollbar-hidden rtl:text-right ltr:text-left bg-transparent dark:text-gray-100 outline-hidden w-full pb-1 px-1 resize-none h-fit max-h-96 overflow-auto pt-2.5"
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
            <ComposerAttachmentTray attachments={chatSessionAttachments} onRemove={removeAttachment} onOpen={setPreviewAttachment} />
            <div className=" flex justify-between mt-0.5 mb-2.5 mx-0.5 max-w-full" dir="ltr">
              <div className="ml-1 self-end flex items-center flex-1 max-w-[80%]">
                <button
                  type="button"
                  onClick={() => openComposerMenu('attachment')}
                  className="bg-transparent hover:bg-gray-100 text-gray-700 dark:text-white dark:hover:bg-gray-800 rounded-full size-8 flex justify-center items-center outline-hidden focus:outline-hidden"
                  title="More"
                >
                  <OWPlusAltIcon />
                </button>
                {attachmentMenuOpen && (
                  <div data-ai-composer-menu className="ai-menu-pop openwebui-composer-dropdown-in absolute bottom-full left-0 z-[10000] mb-2 w-70 rounded-2xl border border-gray-100 bg-white px-1 py-1 text-black shadow-lg max-h-72 overflow-y-auto overflow-x-hidden scrollbar-thin transition dark:border-gray-800 dark:bg-gray-850 dark:text-white">
                    {attachmentSubmenu === 'root' ? (
                      <div key="attachment-root" className="openwebui-composer-slide-root">
                        <button
                          type="button"
                          onClick={() => {
                            closeAttachmentMenu();
                            fileInputRef.current?.click();
                          }}
                          className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <OWClipIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                          <div className="line-clamp-1">上传文件</div>
                        </button>
                        {([
                          ['webpage', '附加网页', OWGlobeAltIcon],
                          ['knowledge', '附加知识', OWDatabaseIcon],
                          ['notes', '附加笔记', OWPencilSquareIcon],
                          ['chats', '引用对话', OWClockRotateRightIcon]
                        ] as Array<[ComposerAttachMenu, string, typeof OWDatabaseIcon]>).map(([key, label, Icon]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setAttachmentSubmenu(key)}
                            className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                          >
                            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                            <div className="flex w-full items-center justify-between">
                              <div className="line-clamp-1">{label}</div>
                              <ChevronRight className="h-4 w-4 text-gray-500" strokeWidth={1.5} />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div key={attachmentSubmenu} className="openwebui-composer-slide-sub">
                        <button
                          type="button"
                          onClick={() => setAttachmentSubmenu('root')}
                          className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <ChevronLeft className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={1.5} />
                          <div className="line-clamp-1">
                            {attachmentSubmenu === 'webpage'
                              ? '附加网页'
                              : attachmentSubmenu === 'knowledge'
                                ? '附加知识'
                                : attachmentSubmenu === 'notes'
                                  ? '附加笔记'
                                  : '引用对话'}
                          </div>
                        </button>
                        {attachmentSubmenu === 'webpage' && (
                          <div className="space-y-1 px-1 pb-1 pt-0.5">
                            <input
                              value={webpageUrlDraft}
                              onChange={(event) => setWebpageUrlDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void attachWebpageContext();
                              }}
                              placeholder="URL"
                              className="h-8 w-full rounded-xl border border-gray-100 bg-transparent px-3 text-sm outline-hidden focus:border-gray-200 dark:border-gray-800"
                              autoFocus
                            />
                            <input
                              value={webpageTitleDraft}
                              onChange={(event) => setWebpageTitleDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void attachWebpageContext();
                              }}
                              placeholder="标题"
                              className="h-8 w-full rounded-xl border border-gray-100 bg-transparent px-3 text-sm outline-hidden focus:border-gray-200 dark:border-gray-800"
                            />
                            <button
                              type="button"
                              onClick={() => void attachWebpageContext()}
                              disabled={!webpageUrlDraft.trim() || attachBusyKey === 'webpage'}
                              className="flex w-full cursor-pointer select-none items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 dark:hover:bg-gray-800/50"
                            >
                              {attachBusyKey === 'webpage' && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />}
                              <span>{attachBusyKey === 'webpage' ? '附加中...' : '附加'}</span>
                            </button>
                          </div>
                        )}
                        {attachmentSubmenu === 'knowledge' && (
                          <div className="pb-1">
                            {workspaceKnowledgeLoading ? (
                              <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
                                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                                <span>加载中...</span>
                              </div>
                            ) : knowledgeAttachResources.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">未找到知识。</div>
                            ) : (
                              knowledgeAttachResources.map((resource) => (
                                <button
                                  key={resource.id}
                                  type="button"
                                  onClick={() => void attachResourceContext(resource, 'Knowledge')}
                                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                >
                                  <OWDatabaseIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                                  <div className="min-w-0 flex-1 text-left">
                                    <div className="truncate">{resource.name}</div>
                                    <div className="truncate text-xs text-gray-500">{resource.path}</div>
                                  </div>
                                  {attachBusyKey === `Knowledge:${resource.id}` && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        {attachmentSubmenu === 'notes' && (
                          <div className="pb-1">
                            {noteAttachResources.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">未找到笔记。</div>
                            ) : (
                              noteAttachResources.map((resource) => (
                                <button
                                  key={resource.id}
                                  type="button"
                                  onClick={() => void attachResourceContext(resource, 'Note')}
                                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                >
                                  <OWPencilSquareIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                                  <div className="min-w-0 flex-1 text-left">
                                    <div className="truncate">{resource.name}</div>
                                    <div className="truncate text-xs text-gray-500">{resource.path}</div>
                                  </div>
                                  {attachBusyKey === `Note:${resource.id}` && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        {attachmentSubmenu === 'chats' && (
                          <div className="pb-1">
                            {referenceChatsLoading ? (
                              <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
                                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                                <span>加载中...</span>
                              </div>
                            ) : !referencedChatSessions?.length ? (
                              <div className="px-3 py-2 text-sm text-gray-500">未找到对话。</div>
                            ) : (
                              referencedChatSessions.map((session) => (
                                <button
                                  key={session.id}
                                  type="button"
                                  onClick={() => attachChatContext(session)}
                                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                >
                                  <OWClockRotateRightIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                                  <div className="min-w-0 flex-1 text-left">
                                    <div className="truncate">{session.title || 'AI Chat'}</div>
                                    <div className="truncate text-xs text-gray-500">{session.lastMessagePreview || `${session.messageCount || 0} messages`}</div>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        {attachError && <div className="px-3 pb-2 pt-1 text-xs text-red-500">{attachError}</div>}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex self-center w-[1px] h-4 mx-1 bg-gray-200/50 dark:bg-gray-800/50" />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => openComposerMenu('context')}
                    className="bg-transparent hover:bg-gray-100 text-gray-700 dark:text-white dark:hover:bg-gray-800 rounded-full size-8 flex justify-center items-center outline-hidden focus:outline-hidden"
                    title="选择上下文"
                  >
                    <OWComponentIcon strokeWidth={1.5} />
                  </button>
                  {contextModeMenuOpen && (
                    <div data-ai-composer-menu className="ai-menu-pop absolute bottom-full left-0 z-[10000] mb-2 w-70 rounded-2xl border border-gray-100 bg-white px-1 py-1 text-black shadow-lg max-h-72 overflow-visible transition dark:border-gray-800 dark:bg-gray-850 dark:text-white">
                      <button
                        type="button"
                        onMouseEnter={() => setContextSubmenuOpen(true)}
                        onClick={() => setContextSubmenuOpen((open) => !open)}
                        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <OWComponentIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                        <div className="flex w-full items-center justify-between">
                          <div className="line-clamp-1">选择上下文</div>
                          <ChevronRight className="h-4 w-4 text-gray-500" strokeWidth={1.5} />
                        </div>
                      </button>
                      <div className="px-3 pb-1 pt-0.5 text-xs text-gray-500 dark:text-gray-400">{contextModeLabel}</div>
                      <button
                        type="button"
                        onMouseEnter={() => setContextSubmenuOpen(false)}
                        onClick={() => {
                          setContextModeMenuOpen(false);
                          window.setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <OWWrenchIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                        <div className="line-clamp-1">工具</div>
                      </button>
                      {contextSubmenuOpen && (
                        <div className="absolute bottom-0 left-full z-[10001] ml-2 w-70 rounded-2xl border border-gray-100 bg-white px-1 py-1 text-black shadow-lg max-h-72 overflow-y-auto overflow-x-hidden scrollbar-thin transition dark:border-gray-800 dark:bg-gray-850 dark:text-white">
                          {contextModeOptions.map(([mode, label, Icon]) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setContextMode(mode);
                                setContextModeMenuOpen(false);
                                setContextSubmenuOpen(false);
                              }}
                              className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
                            >
                              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                              {contextMode === mode && <Check className="h-4 w-4 text-gray-900 dark:text-gray-100" strokeWidth={1.5} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="self-end flex space-x-1 mr-1 shrink-0 gap-[0.5px]">
                <button
                  onClick={() => {
                    if (isSending) {
                      stopGeneration();
                      return;
                    }
                    void handleSend();
                  }}
                  disabled={!isSending && !input.trim() && chatSessionAttachments.length === 0 && composerContextAttachments.length === 0}
                  className="bg-gray-900 hover:bg-gray-850 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full p-1.5 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                  title={isSending ? 'Stop generating' : 'Send'}
                >
                  {isSending ? (
                    <span className="block h-[18px] w-[18px] p-[4px]">
                      <span className="block h-full w-full rounded-[2px] bg-current" />
                    </span>
                  ) : (
                    <ArrowUp className="h-[18px] w-[18px] stroke-[2.25]" />
                  )}
                </button>
              </div>
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
  onAddSelectionAskToAssistant,
  aiContext,
  resources = [],
  minimalPreview = false
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
        onBindResource={onBindResource ?? (() => undefined)}
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
          <h3 className="text-sm font-semibold text-[#25272b]">打开工作区文件</h3>
          <p className="mt-2 max-w-md text-sm text-[#777a80]">
            从工作区文件树中选择一个文件，在当前窗格中打开。
          </p>
        </div>
      </div>
    );
  }

  const resourceKind = getResourceKind(resource);
  const resourceSourceUrl = getResourceSourceUrl(resource);
  const sourceUrl = sourceMetadata.url || resourceSourceUrl;
  const sourceTitle = sourceMetadata.title || resource.name.replace(/\.source$/i, '');
  if (resourceKind === 'html') {
    if (minimalPreview) {
      return <HtmlVisualizationPreview resource={resource} workspaceId={workspaceId} />;
    }
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
    if (minimalPreview) {
      return (
        <WebSourcePreview
          title={sourceTitle}
          url={sourceUrl}
          body={sourceMetadata.body || effectiveContent}
          workspaceId={workspaceId}
          aiContext={aiContext}
          resource={resource}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
          onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
          enableSelectionActions={false}
        />
      );
    }
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
          aiContext={aiContext}
          resource={resource}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
          onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        />
      </ResourcePanelShell>
    );
  }

  if (editor.type === 'video' || resourceKind === 'video') {
    const videoSourceUrl = sourceUrl || resourceSourceUrl;
    if (minimalPreview) {
      const embed = getEmbedInfo(videoSourceUrl);
      return embed ? (
        <EmbeddedVideoSourcePreview sourceUrl={videoSourceUrl} title={sourceTitle || resource.name} />
      ) : (
        <VideoFilePreview resource={resource} workspaceId={workspaceId} />
      );
    }
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
    if (minimalPreview) {
      return (
        <DocumentPreview
          resource={resource}
          workspaceId={workspaceId}
          aiContext={aiContext}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
          onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
          enableSelectionActions={false}
        />
      );
    }
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
          aiContext={aiContext}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
          onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        />
      </ResourcePanelShell>
    );
  }

  if (editor.type === 'code' && (resourceKind === 'code' || resourceKind === 'structured')) {
    if (minimalPreview) {
      return (
        <TextEditingSurface
          editor={editor}
          resource={resource}
          workspaceId={workspaceId}
          aiContext={aiContext}
          content={String(content ?? '')}
          isLoading={isLoading}
          onChangeContent={onChangeContent}
          onUpdateViewState={onUpdateViewState}
          onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
          minimalPreview
        />
      );
    }
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

  if (minimalPreview) {
    return (
      <TextEditingSurface
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        aiContext={aiContext}
        content={String(content ?? '')}
        isLoading={isLoading}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
        onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        minimalPreview
      />
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
        workspaceId={workspaceId}
        aiContext={aiContext}
        content={String(content ?? '')}
        isLoading={isLoading}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
        onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        minimalPreview={minimalPreview}
      />
    </ResourcePanelShell>
  );
}
