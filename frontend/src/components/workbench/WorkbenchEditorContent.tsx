import {
  ArrowUpRight,
  Check,
  ChevronDown,
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
  Loader2,
  PencilLine,
  Plus,
  RefreshCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  X,
  Video
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { EditorState, ResourceReference } from '../../types';
import {
  FilePreviewInfo,
  RenderableDocument,
  RenderableDocumentChunk,
  fileSystemApi
} from '../../services/fileSystemApi';
import {
  aiApi,
  AiChatContext,
  AiChatMessage,
  AiContextMode,
  AgentTimelineItem,
  AiLockedSelectionContext,
  AiSourceInspectorItem
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

interface WorkbenchEditorContentProps {
  editor: EditorState;
  resource: ResourceReference | null;
  workspaceId: string;
  content?: string;
  isDirty?: boolean;
  isLoading?: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onBindResource: (editorId: string) => void;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
}

interface TemporaryAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'file';
  textContent?: string;
}

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

type WebPreviewData = Awaited<ReturnType<typeof fileSystemApi.extractUrlPreview>>;

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
            embedUrl: `https://www.youtube.com/embed/${videoId}`
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

function SourceGuide({
  resource,
  workspaceId,
  editorId,
  sourceText,
  sourceUrl,
  onUpdateViewState
}: {
  resource: ResourceReference;
  workspaceId: string;
  editorId: string;
  sourceText?: string;
  sourceUrl?: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [summary, setSummary] = useState<string>(() => String(resource.path ? '' : ''));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clippedText = String(sourceText || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
    const key = `sourceGuide:${resource.id}:${clippedText ? 'text' : 'meta'}`;
    const existing = sessionStorage.getItem(key);
    if (existing) {
      setSummary(existing);
      return;
    }

    const fallback = clippedText
      ? `${clippedText.slice(0, 220)}${clippedText.length > 220 ? '...' : ''}`
      : sourceUrl
        ? `这个来源来自 ${sourceUrl}。当前版本会展示可用的网页或视频内容，并保留链接用于后续检索与学习引用。`
        : '这个资源暂时没有可读取的正文，但可以作为工作台中的引用材料继续打开、预览和讨论。';

    if (!clippedText && sourceUrl) {
      setSummary(fallback);
      sessionStorage.setItem(key, fallback);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void aiApi
      .chat({
        messages: [
          {
            role: 'user',
            content: [
              '请为这个学习资源写一段 source guide。',
              '要求：中文，100-200字，说明材料主题、适合怎么学习、值得注意的重点；只输出正文，不要标题。',
              '',
              `资源名称：${resource.name}`,
              sourceUrl ? `URL：${sourceUrl}` : '',
              '',
              clippedText || fallback
            ].filter(Boolean).join('\n')
          }
        ],
        context: {
          workspaceId,
          activeFileId: resource.id,
          activeFile: {
            id: resource.id,
            name: resource.name,
            path: resource.path,
            content: clippedText
          },
          contextMode: 'active_file'
        }
      })
      .then((response) => {
        if (cancelled) return;
        const nextSummary = response.reply.trim() || fallback;
        setSummary(nextSummary);
        sessionStorage.setItem(key, nextSummary);
        onUpdateViewState?.(editorId, {
          sourceGuideByResourceId: {
            [resource.id]: nextSummary
          }
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(fallback);
        sessionStorage.setItem(key, fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editorId, onUpdateViewState, resource.id, resource.name, resource.path, sourceText, sourceUrl, workspaceId]);

  return (
    <section className="rounded-2xl bg-[#f0f2fb] px-4 py-4 text-[#25272b]">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-5 w-5" />
          Source guide
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#777a80]" />}
        </span>
        {isOpen ? <ChevronUp className="h-4 w-4 text-[#5f6368]" /> : <ChevronDown className="h-4 w-4 text-[#5f6368]" />}
      </button>
      {isOpen && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#3f4247]">
          {summary || 'Generating source guide...'}
        </p>
      )}
    </section>
  );
}

function ResourcePanelShell({
  editor,
  resource,
  workspaceId,
  sourceText,
  sourceUrl,
  onUpdateViewState,
  children
}: {
  editor: EditorState;
  resource: ResourceReference;
  workspaceId: string;
  sourceText?: string;
  sourceUrl?: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#25272b]">
      <div className="shrink-0 border-b border-[#eeeeeb] bg-white px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.01em] text-[#202124]">
              {resource.name}
            </h1>
            <div className="mt-1 truncate text-sm text-[#8b8f94]">{resource.path}</div>
          </div>
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
        <div className="mt-5">
          <SourceGuide
            resource={resource}
            workspaceId={workspaceId}
            editorId={editor.id}
            sourceText={sourceText}
            sourceUrl={sourceUrl}
            onUpdateViewState={onUpdateViewState}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
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
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(420px,calc(100vw-3rem))] rounded-2xl border border-[#e7e7e4] bg-white p-2 shadow-[0_18px_45px_rgba(0,0,0,0.12)]">
          {sources.map((source, index) => (
            <button
              key={`${source.fileId}:${source.label}:${source.sourceId || index}`}
              onClick={() => onOpenSource(source)}
              className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-[#34373c] hover:bg-[#f6f6f4]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{source.fileName || source.label}</span>
                <span className="block truncate text-xs text-[#909399]">{source.label}</span>
              </span>
              {typeof source.score === 'number' && (
                <span className="rounded-md bg-[#d8f5df] px-1.5 py-0.5 font-mono text-xs font-semibold text-[#126b32]">
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
        className={`group inline-flex max-w-full items-center gap-2 rounded-full bg-[#f4f4f5] font-medium text-[#71717a] transition-colors hover:bg-[#ececee] hover:text-[#27272a] ${
          compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {compact && open && (
        <button
          type="button"
          onClick={() => onJump(first)}
          className="absolute left-0 top-full mt-1 text-[11px] font-medium text-[#777a80] hover:text-[#202124]"
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
      className={`mx-auto mb-5 overflow-hidden rounded-xl border bg-white shadow-sm transition-all duration-300 ${
        highlighted ? 'border-[#16833a] ring-4 ring-[#d7e8d2]' : 'border-[#d9d9d5]'
      }`}
      style={size ? { width: size.width, minHeight: size.height } : undefined}
    >
      <div className="flex items-center justify-between border-b border-[#eeeeeb] px-4 py-2 text-xs text-[#96999d]">
        <span>Page {pageNumber}</span>
      </div>
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
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [pageNumbers, setPageNumbers] = useState<number[]>([]);
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
  const scale = 1.25;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDocument(null);
    setPageNumbers([]);

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
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { fileId?: string; locator?: { page?: number; pageStart?: number; primaryPage?: number } }
        | undefined;
      if (!detail?.fileId || detail.fileId !== fileId) return;
      const page = detail.locator?.page || detail.locator?.pageStart || detail.locator?.primaryPage;
      if (!page) return;
      const pageElement = containerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="true"][data-page="${page}"]`);
      if (!pageElement) return;
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setJumpHighlight({ page, locator: detail.locator as Record<string, any> });
      window.setTimeout(() => setJumpHighlight((current) => (current?.page === page ? null : current)), 2400);
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
    <div className="relative h-full">
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
      <div
        ref={containerRef}
        className="h-full overflow-auto bg-white px-5 pb-5"
        onScroll={reportViewport}
        onMouseEnter={reportViewport}
        onMouseUp={reportViewport}
        onKeyUp={reportViewport}
      >
      {loading && (
        <div className="flex h-80 items-center justify-center text-sm text-[#777a80]">Loading PDF...</div>
      )}
      {error && (
        <div className="mx-auto max-w-3xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}
      {pdfDocument && pageNumbers.map((pageNumber) => (
        <PdfJsPage
          key={pageNumber}
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
  );
}

function DocumentPreview({
  resource,
  workspaceId,
  editorId,
  onUpdateViewState,
  onExtractedText
}: {
  resource: ResourceReference;
  workspaceId: string;
  editorId: string;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onExtractedText?: (text: string) => void;
}) {
  const [previewInfo, setPreviewInfo] = useState<FilePreviewInfo | null>(null);
  const [documentStructure, setDocumentStructure] = useState<RenderableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [jumpHighlight, setJumpHighlight] = useState<{ chunkIndex?: number; blockId?: string } | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.allSettled([
      fileSystemApi.getPreviewInfo(workspaceId, resource.id),
      fileSystemApi.getDocumentStructure(workspaceId, resource.id)
    ])
      .then(([previewResult, structureResult]) => {
        if (!active) return;
        if (previewResult.status === 'fulfilled') {
          setPreviewInfo(previewResult.value);
        } else {
          setPreviewInfo({
            status: 'unavailable',
            previewKind: 'document',
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          });
        }

        if (structureResult.status === 'fulfilled') {
          setDocumentStructure(structureResult.value);
        } else {
          setDocumentStructure(null);
        }
      })
      .catch(() => {
        if (active) {
          setPreviewInfo({
            status: 'unavailable',
            previewKind: 'document',
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          });
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
  }, [documentStructure, onExtractedText]);

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

  if (documentStructure?.kind === 'pdf') {
    return (
      <PdfJsReader
        sourceUrl={fileSystemApi.previewUrl(workspaceId, resource.id)}
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
      <div className="flex items-center justify-between border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#25272b]">{resource.name}</div>
          <div className="truncate text-xs text-[#96999d]">
            Interactive visualization
          </div>
        </div>
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
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="h-full overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white shadow-sm">
          <iframe title={resource.name} src={previewUrl} className="h-full w-full bg-white" />
        </div>
      </div>
    </div>
  );
}

function WebSourcePreview({
  title,
  url,
  body,
  workspaceId
}: {
  title: string;
  url?: string;
  body?: string;
  workspaceId: string;
}) {
  const embed = getEmbedInfo(url);
  const [previewData, setPreviewData] = useState<WebPreviewData | null>(null);
  const [activeUrl, setActiveUrl] = useState(url || '');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const displayedTitle = previewData?.title || title;
  const displayedUrl = previewData?.url || activeUrl || url;
  const richHtml = previewData?.contentHtml || '';

  useEffect(() => {
    setActiveUrl(url || '');
    setPreviewData(null);
  }, [url]);

  useEffect(() => {
    if (!activeUrl || embed) return;

    let cancelled = false;
    setIsExtracting(true);
    setExtractError('');
    setPreviewData(null);

    void fileSystemApi
      .extractUrlPreview(workspaceId, { url: activeUrl, title })
      .then((result) => {
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

  if (embed) {
    return (
      <div className="h-full overflow-auto bg-white px-6 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-2xl border border-[#e5e5e1] bg-black shadow-sm">
            <iframe
              title={`${embed.provider} video`}
              src={embed.embedUrl}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="mt-4 rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-4 py-3 text-sm leading-6 text-[#5f6368]">
            {embed.provider} video source. Use the player above for playback; the original link stays attached for citation and follow-up extraction.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <article className="min-w-0 text-[#25272b]">
          {richHtml.trim() ? (
            <div className="rounded-2xl border border-[#eeeeeb] bg-white px-8 py-8 shadow-sm">
              <div className="mb-6 border-b border-[#eeeeeb] pb-5">
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
          ) : body?.trim() ? (
            <MarkdownPreview content={`# ${title}\n\n${body}`} variant="document" />
          ) : isExtracting ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-5 py-6 text-sm leading-7 text-[#5f6368]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting webpage content...
            </div>
          ) : (
            <div className="rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa] px-5 py-6 text-sm leading-7 text-[#5f6368]">
              {extractError || 'No readable webpage content could be extracted from this link.'}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function VideoFilePreview({
  resource,
  workspaceId
}: {
  resource: ResourceReference;
  workspaceId: string;
}) {
  const sourceUrl = fileSystemApi.downloadUrl(workspaceId, resource.id);

  return (
    <div className="h-full overflow-auto bg-white px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <video
          src={sourceUrl}
          controls
          className="aspect-video w-full rounded-2xl bg-black shadow-sm"
        >
          <track kind="captions" />
        </video>
      </div>
    </div>
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
  const codeOpenMode =
    (editor.viewState.codeOpenMode as 'blocksuite' | 'plain' | undefined) || 'blocksuite';

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
            {editor.type === 'code' && (
              <>
                <button
                  onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'blocksuite' })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    codeOpenMode === 'blocksuite'
                      ? 'bg-[#202124] text-white shadow-sm'
                      : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
                  }`}
                >
                  BlockSuite
                </button>
                <button
                  onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'plain' })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    codeOpenMode === 'plain'
                      ? 'bg-[#202124] text-white shadow-sm'
                      : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
                  }`}
                >
                  Plain
                </button>
              </>
            )}
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

const buildLocalAiSuggestions = (aiContext?: WorkbenchEditorContentProps['aiContext']) => {
  const activePanel =
    aiContext?.openPanels?.find((panel) => panel.panelId === aiContext.activePanelId) ||
    aiContext?.openPanels?.find((panel) => panel.fileId === aiContext.activeFileId) ||
    aiContext?.openPanels?.[0];
  const fileName = activePanel?.fileName || aiContext?.activeFile?.name;
  const selectedText = activePanel?.selectedText?.trim() || aiContext?.selectedText?.trim();
  const openFileCount = new Set((aiContext?.openPanels || []).map((panel) => panel.fileId).filter(Boolean)).size;

  if (selectedText) {
    return [
      '解释这段选区的关键意思',
      '基于选区整理可复习要点',
      '检查选区里可能遗漏的问题'
    ];
  }

  if (fileName) {
    const name = fileName.length > 24 ? `${fileName.slice(0, 24)}...` : fileName;
    return [
      `梳理 ${name} 的核心内容`,
      '找出当前文件最值得追问的点',
      '把可见内容转成复习提纲'
    ];
  }

  if (openFileCount > 1) {
    return [
      `比较当前打开的 ${openFileCount} 个资源`,
      '生成这个 Workbench 的学习路线',
      '找出资料之间的关联和缺口'
    ];
  }

  return [
    '判断我现在最适合推进的任务',
    '整理这个 Workbench 的下一步计划',
    '帮我把现有材料变成复习问题'
  ];
};

export function AiEditorView({
  editor,
  workspaceId,
  aiContext,
  onUpdateViewState,
  hideHeader = false,
  compactWelcome = false
}: {
  editor: EditorState;
  workspaceId: string;
  aiContext?: WorkbenchEditorContentProps['aiContext'];
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  hideHeader?: boolean;
  compactWelcome?: boolean;
}) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<AgentTimelineItem[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [inspectedChipId, setInspectedChipId] = useState<string | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [temporaryAttachments, setTemporaryAttachments] = useState<TemporaryAttachment[]>([]);
  const [sourceModalSource, setSourceModalSource] = useState<CitationUiSource | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [aiSuggestedPrompts, setAiSuggestedPrompts] = useState<string[]>(() => buildLocalAiSuggestions(aiContext));
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messages = useMemo(
    () => (Array.isArray(editor.viewState?.messages) ? editor.viewState.messages : []),
    [editor.viewState?.messages]
  );
  const contextMode = ((editor.viewState?.contextMode as AiContextMode | undefined) || 'auto');
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
  const activePanelContext = useMemo(
    () =>
      aiContext?.openPanels?.find((panel) => panel.panelId === aiContext.activePanelId) ||
      aiContext?.openPanels?.find((panel) => panel.fileId === aiContext.activeFileId) ||
      aiContext?.openPanels?.[0],
    [aiContext?.activeFileId, aiContext?.activePanelId, aiContext?.liveContextVersion, aiContext?.openPanels]
  );

  useEffect(() => {
    setAiSuggestedPrompts(buildLocalAiSuggestions(aiContext));
  }, [
    aiContext?.activeFileId,
    aiContext?.activePanelId,
    aiContext?.workbenchId,
    activePanelContext?.selectedText,
    aiContext?.openPanels?.length
  ]);
  useEffect(() => {
    const handlePdfSelectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { prompt?: string; fileId?: string; fileName?: string; page?: number; text?: string; selectedRange?: Record<string, any> }
        | undefined;
      if (!detail?.prompt) return;
      if (detail.prompt === '__lock_pdf_selection__' && detail.text) {
        onUpdateViewState?.(editor.id, {
          lockedContextSelection: {
            id: `locked:${detail.fileId || 'pdf'}:${Date.now()}`,
            panelId: activePanelContext?.panelId,
            panelType: activePanelContext?.panelType || 'resource',
            fileId: detail.fileId || activePanelContext?.fileId || null,
            fileName: detail.fileName || activePanelContext?.fileName,
            filePath: activePanelContext?.filePath,
            content: detail.text,
            locator: detail.selectedRange || {
              page: detail.page,
              pageStart: detail.page,
              pageEnd: detail.page,
              textLength: detail.text.length
            },
            createdAt: new Date().toISOString()
          }
        });
        setInput('请基于我锁定的 PDF 选区回答：');
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      setInput(detail.prompt);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };

    window.addEventListener('workbench:pdf-selection-action', handlePdfSelectionAction);
    return () => window.removeEventListener('workbench:pdf-selection-action', handlePdfSelectionAction);
  }, [activePanelContext, editor.id, onUpdateViewState]);

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
        label: `资源范围：当前 Workbench ${resourceCount}个文件`,
        detail: (aiContext?.openPanels || [])
          .filter((panel) => panel.fileName)
          .map((panel) => panel.fileName)
          .join('\n')
      });
    }

    return chips.filter((chip) => !hiddenChipIds.has(chip.id));
  }, [activePanelContext, aiContext, hiddenChipIds, lockedSelection]);
  const inspectedChip = contextChips.find((chip) => chip.id === inspectedChipId) || null;
  const pinnedContextChips = contextChips.filter((chip) => chip.kind === 'selection' || chip.kind === 'active_file');
  const menuContextChips = contextChips.filter((chip) => chip.kind !== 'selection' && chip.kind !== 'active_file');
  const lastContextDebug = editor.viewState?.lastContextDebug as
    | {
        contextCapsule?: unknown;
        contextPolicy?: unknown;
        usedContextSummary?: unknown;
      }
    | undefined;
  const lastCitations = useMemo(
    () => ((lastContextDebug?.contextCapsule as any)?.citations || []) as Array<{
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
    }>,
    [lastContextDebug?.contextCapsule]
  );
  const sourceInspectorItems = useMemo(
    () => (((lastContextDebug?.contextCapsule as any)?.sourceMap || []) as AiSourceInspectorItem[]),
    [lastContextDebug?.contextCapsule]
  );
  const answerSources = useMemo(() => {
    const sourceById = new Map(sourceInspectorItems.map((source) => [source.sourceId, source]));
    const seen = new Set<string>();
    return lastCitations
      .map((citation, index) => {
        const sourceId = citation.sourceId || `S${index + 1}`;
        const richSource = sourceById.get(sourceId);
        return {
          ...citation,
          ...richSource,
          sourceId,
          fileId: richSource?.fileId || citation.fileId,
          fileName: richSource?.fileName || citation.fileName,
          label: richSource?.label || citation.label,
          locator: richSource?.locator || citation.locator,
          confidence: richSource?.confidence || citation.confidence,
          preview: richSource?.preview || citation.preview,
          supportSnippets: richSource?.supportSnippets || citation.supportSnippets,
          citationQuality: richSource?.citationQuality || citation.citationQuality
        } as CitationUiSource;
      })
      .filter((source) => {
        const key = `${source.fileId}:${source.label}:${source.sourceId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [lastCitations, sourceInspectorItems]);
  const lastAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') return index;
    }
    return -1;
  }, [messages]);

  const hideChip = (chipId: string) => {
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

  const clearLockedSelection = () => {
    onUpdateViewState?.(editor.id, { lockedContextSelection: null });
  };

  const setContextMode = (mode: AiContextMode) => {
    onUpdateViewState?.(editor.id, { contextMode: mode });
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
    setContextMenuOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleAttachmentFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) return;

    const nextAttachments = await Promise.all(
      selectedFiles.map(
        (file) =>
          new Promise<TemporaryAttachment>((resolve) => {
            const baseAttachment: TemporaryAttachment = {
              id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID?.() || Date.now()}`,
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
              kind: file.type.startsWith('image/') ? 'image' : 'file'
            };

            if (!isTextLikeFile(file)) {
              resolve(baseAttachment);
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                ...baseAttachment,
                textContent: String(reader.result || '').slice(0, 12000)
              });
            };
            reader.onerror = () => resolve(baseAttachment);
            reader.readAsText(file);
          })
      )
    );

    setTemporaryAttachments((current) => [...current, ...nextAttachments].slice(-8));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setTemporaryAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const submitMessages = async ({
    prompt,
    baseMessages,
    attachments = []
  }: {
    prompt: string;
    baseMessages: AiChatMessage[];
    attachments?: TemporaryAttachment[];
  }) => {
    const trimmedInput = prompt.trim();
    if ((!trimmedInput && attachments.length === 0) || isSending) return;

    const attachmentContext = attachments
      .map((attachment) =>
        [
          `临时附件：${attachment.name}`,
          `类型：${attachment.type || attachment.kind}`,
          `大小：${formatBytes(attachment.size)}`,
          attachment.textContent ? `内容预览：\n${attachment.textContent}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');
    const userContent = [trimmedInput, attachmentContext ? `【本轮临时附件】\n${attachmentContext}` : '']
      .filter(Boolean)
      .join('\n\n');
    const createdAt = new Date().toISOString();

    const previousMessages = [...baseMessages] as AiChatMessage[];
    const nextMessages: AiChatMessage[] = [
      ...previousMessages,
      { role: 'user', content: userContent, createdAt }
    ];

    onUpdateViewState?.(editor.id, { messages: nextMessages });
    setInput('');
    setTemporaryAttachments([]);
    setError(null);
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
              : contextMode;
      let assistantContent = '';
      const assistantCreatedAt = new Date().toISOString();
      const streamMessages: AiChatMessage[] = [...nextMessages, { role: 'assistant', content: '', createdAt: assistantCreatedAt }];
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
        lockedSelection,
        persistentCitations,
        activeContextChips: contextChips.map((chip) => ({
          id: chip.id,
          kind: chip.kind,
          enabled: true
        })),
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
        selectedText:
          window.getSelection()?.toString().trim() ||
          activePanelContext?.selectedText ||
          aiContext?.selectedText ||
          '',
        recentMessages: nextMessages.slice(-8)
      };

      onUpdateViewState?.(editor.id, { messages: streamMessages });

      const response = await aiApi.chatStream(
        {
          messages: nextMessages,
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
            assistantContent = content;
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
              lastModel: meta.model || 'deepseek-chat',
              lastContextDebug: {
                contextCapsule: meta.contextCapsule,
                contextPolicy: meta.contextPolicy,
                usedContextSummary: meta.usedContextSummary
              }
            });
          }
        }
      );

      setTimeline(response.timeline || []);
      streamMessages[streamMessages.length - 1] = {
        role: 'assistant',
        content: response.reply,
        createdAt: assistantCreatedAt
      };
      onUpdateViewState?.(editor.id, {
        messages: [...streamMessages],
        lastModel: response.model || 'deepseek-chat',
        lastContextDebug: {
          contextCapsule: response.contextCapsule,
          contextPolicy: response.contextPolicy,
          usedContextSummary: response.usedContextSummary
        }
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
      onUpdateViewState?.(editor.id, { messages: previousMessages });
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    await submitMessages({
      prompt: input,
      baseMessages: [...messages] as AiChatMessage[],
      attachments: temporaryAttachments
    });
  };

  const copyMessage = async (content: string, index: number) => {
    await navigator.clipboard?.writeText(content).catch(() => undefined);
    setCopiedMessageIndex(index);
    window.setTimeout(() => setCopiedMessageIndex(null), 1200);
  };

  const deleteMessage = (index: number) => {
    const next = (messages as AiChatMessage[]).filter((_, messageIndex) => messageIndex !== index);
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
      baseMessages: history.slice(0, userIndex),
      attachments: []
    });
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
            <Sparkles className="h-4 w-4 shrink-0 text-[#16833a]" />
            <div className="truncate text-sm font-medium text-[#25272b]">
              {editor.title || 'AI Assistant'}
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {error}
            </div>
          )}
          {timeline.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {timeline.map((item) => (
                <span
                  key={`${item.agentName}-${item.durationMs}`}
                  title={`${item.inputSummary}\n${item.outputSummary}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    item.status === 'completed'
                      ? 'border-[#d7e8d2] bg-[#f3faf1] text-[#37652f]'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {item.agentName} · {item.durationMs}ms
                </span>
              ))}
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
          {hideHeader && timeline.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {timeline.map((item) => (
                <span
                  key={`${item.agentName}-${item.durationMs}`}
                  title={`${item.inputSummary}\n${item.outputSummary}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    item.status === 'completed'
                      ? 'border-[#d7e8d2] bg-[#f3faf1] text-[#37652f]'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {item.agentName} · {item.durationMs}ms
                </span>
              ))}
            </div>
          )}
          {messages.length === 0 && (
            <div className={`ai-message-in mx-auto flex w-full max-w-2xl flex-col ${compactWelcome ? 'pt-8' : 'pt-16'}`}>
              <div className="mb-7 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#e5e5e1] bg-white text-[#202124] shadow-[0_18px_45px_rgba(15,23,42,0.12)] transition-transform duration-300 hover:scale-[1.03]">
                  <Sparkles className="h-7 w-7" />
                </div>
              </div>
              <h2 className="text-center text-2xl font-bold tracking-0 text-[#25272b]">
                随时待命，我能帮上什么忙吗？
              </h2>
              <div className="mx-auto mt-7 grid w-full max-w-xl gap-2">
                {aiSuggestedPrompts.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setInput(suggestion);
                      window.setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="ai-soft-button flex items-center gap-3 rounded-xl px-4 py-2.5 text-left text-[15px] font-medium text-[#34373c] hover:bg-[#f6f6f4]"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-[#5f6368]" />
                    <span className="truncate">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message: AiChatMessage, index: number) => {
            const isAssistant = message.role === 'assistant';
            const displayContent = message.content.split('\n\n【本轮临时附件】')[0];
            const messageTime = formatMessageTime(message.createdAt);
            return (
              <div
                key={`${message.role}-${index}`}
                className={`ai-message-in group flex w-full ${isAssistant ? 'items-start gap-4' : 'justify-end'}`}
              >
                {isAssistant && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#eeeeeb] bg-white text-xs font-bold text-[#111827]">
                    AI
                  </div>
                )}
                <div className={isAssistant ? 'min-w-0 flex-1 border-b border-[#eeeeeb] pb-7' : 'flex max-w-[78%] flex-col items-end'}>
                  {isAssistant ? (
                    <>
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-[#111827]">AI Assistant</span>
                        <span className="text-xs font-medium text-[#a1a1aa] opacity-0 transition-opacity group-hover:opacity-100">
                          {messageTime}
                        </span>
                      </div>
                      <MarkdownPreview
                        content={message.content || ''}
                        variant="message"
                        citationSources={sourceInspectorItems}
                        onCitationJump={jumpToCitation}
                        isStreaming={isSending && index === messages.length - 1}
                      />
                      {index === lastAssistantIndex && answerSources.length > 0 && !(isSending && index === messages.length - 1) && (
                        <div className="mt-4">
                          <SourcesCapsule
                            sources={answerSources}
                            onJump={jumpToCitation}
                            onOpenSource={openSourceDetail}
                          />
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => startEditMessage(index, message.content)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Edit">
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => void copyMessage(message.content, index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Copy">
                          {copiedMessageIndex === index ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <button className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Read aloud">
                          <Volume2 className="h-4 w-4" />
                        </button>
                        <button className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Details">
                          <Info className="h-4 w-4" />
                        </button>
                        <button className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Good response">
                          <ThumbsUp className="h-4 w-4" />
                        </button>
                        <button className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Bad response">
                          <ThumbsDown className="h-4 w-4" />
                        </button>
                        <button onClick={() => void regenerateFrom(index)} className="rounded-lg p-1.5 text-[#6b7280] hover:bg-[#f4f4f5] hover:text-[#111827]" title="Regenerate">
                          <RefreshCcw className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mb-1 flex items-center gap-2 pr-2 text-xs font-medium text-[#a1a1aa] opacity-0 transition-opacity group-hover:opacity-100">
                        <span>{messageTime}</span>
                      </div>
                      <div className="rounded-[24px] bg-[#f4f4f5] px-5 py-3 text-[15px] leading-7 text-[#374151] shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5">
                        {editingMessageIndex === index ? (
                          <div className="w-[min(560px,70vw)]">
                            <textarea
                              value={editingMessageContent}
                              onChange={(event) => setEditingMessageContent(event.target.value)}
                              className="block min-h-[90px] w-full resize-y rounded-2xl border border-[#e5e7eb] bg-white p-3 text-sm text-[#111827] outline-none focus:border-[#111827]"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button onClick={() => setEditingMessageIndex(null)} className="rounded-full px-3 py-1.5 text-xs font-medium text-[#6b7280] hover:bg-[#ededee]">Cancel</button>
                              <button onClick={() => void saveEditMessage(index)} className="rounded-full bg-[#111827] px-3 py-1.5 text-xs font-medium text-white">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {displayContent}
                            {message.content.includes('【本轮临时附件】') && (
                              <div className="mt-2 border-t border-black/10 pt-2 text-xs text-[#71717a]">
                                已附加本轮临时文件
                              </div>
                            )}
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

      <div className="bg-white px-5 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="ai-composer-lift relative rounded-[28px] border border-[#e5e7eb] bg-white p-3 shadow-[0_14px_45px_rgba(15,23,42,0.08)]">
            {(pinnedContextChips.length > 0 || persistentCitations.length > 0 || temporaryAttachments.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pinnedContextChips.slice(0, 2).map((chip) => (
                  <span
                    key={chip.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#f4f4f5] px-2.5 py-1 text-xs font-medium text-[#71717a]"
                  >
                    {chip.kind === 'selection' ? <FileText className="h-3.5 w-3.5" /> : <File className="h-3.5 w-3.5" />}
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
                    {chip.kind === 'selection' && !lockedSelection && (
                      <button
                        onClick={lockCurrentSelection}
                        className="rounded-full px-1 text-[11px] text-[#16833a] hover:bg-[#f3faf1]"
                        title="锁定当前选区"
                      >
                        锁定
                      </button>
                    )}
                    {chip.kind === 'selection' && lockedSelection && (
                      <button
                        onClick={clearLockedSelection}
                        className="rounded-full px-1 text-[11px] text-[#777a80] hover:bg-[#eeeeeb]"
                        title="解除锁定选区"
                      >
                        解锁
                      </button>
                    )}
                  </span>
                ))}
                {persistentCitations.length > 0 && (
                  <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f4f4f5] px-1 py-0.5 text-xs font-medium text-[#5f6368]">
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
                {temporaryAttachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#f4f4f5] px-2.5 py-1 text-xs font-medium text-[#71717a]"
                    title={`${attachment.name} · ${formatBytes(attachment.size)}`}
                  >
                    {attachment.kind === 'image' ? <Image className="h-3.5 w-3.5" /> : <File className="h-3.5 w-3.5" />}
                    <span className="max-w-[220px] truncate">{attachment.name}</span>
                    <button
                      onClick={() => removeAttachment(attachment.id)}
                      className="rounded-full p-0.5 text-[#a6a8ab] hover:bg-[#eeeeeb] hover:text-[#34373c]"
                      title="移除附件"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
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
              rows={2}
              placeholder="使用 AI 处理各种任务..."
              disabled={isSending}
              className="block min-h-[70px] w-full resize-none border-0 bg-transparent text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#a1a1aa]"
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
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="ai-soft-button inline-flex h-9 w-9 items-center justify-center rounded-full text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#25272b]"
                  title="添加临时图片或文件"
                >
                  <Plus className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setContextMenuOpen((value) => !value)}
                  className={`ai-soft-button inline-flex h-9 w-9 items-center justify-center rounded-full border ${
                    contextMenuOpen
                      ? 'border-[#16833a] bg-[#f3faf1] text-[#16833a]'
                      : 'border-transparent text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#25272b]'
                  }`}
                  title="调整上下文"
                >
                  <SlidersHorizontal className="h-4.5 w-4.5" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={contextMode}
                  onChange={(event) => setContextMode(event.target.value as AiContextMode)}
                  className="rounded-full border-0 bg-transparent px-2 py-1 text-sm font-semibold text-[#777a80] outline-none"
                  title="Context mode"
                >
                  <option value="auto">自动</option>
                  <option value="selection_only">仅选区</option>
                  <option value="viewport">当前可见区域</option>
                  <option value="active_file">当前文件</option>
                  <option value="workbench">当前 Workbench</option>
                  <option value="workspace">整个 Workspace</option>
                </select>
                <button
                  onClick={() => void handleSend()}
                  disabled={isSending || (!input.trim() && temporaryAttachments.length === 0)}
                  className="ai-soft-button inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#202124] text-white hover:bg-[#34373c] disabled:cursor-not-allowed disabled:bg-[#f1f1ef] disabled:text-[#c2c3c5]"
                  title="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
            {contextMenuOpen && (
              <div className="ai-menu-pop ai-session-menu-pop absolute bottom-[76px] left-3 z-20 w-[min(520px,calc(100vw-3rem))] rounded-2xl border border-[#e5e5e1] bg-white p-3 text-xs text-[#34373c] shadow-[0_18px_55px_rgba(0,0,0,0.16)]">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-semibold text-[#25272b]">上下文设置</div>
                  {hiddenChipIds.size > 0 && (
                    <button
                      onClick={() => onUpdateViewState?.(editor.id, { hiddenContextChipIds: [] })}
                      className="rounded-full px-2 py-1 text-[#777a80] hover:bg-[#f6f6f4]"
                    >
                      恢复隐藏项
                    </button>
                  )}
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => insertMention('@选区')}
                    className="rounded-full border border-[#eeeeeb] px-2.5 py-1 font-medium text-[#777a80] hover:bg-[#f6f6f4]"
                  >
                    @选区
                  </button>
                  <button
                    onClick={() => insertMention('@当前页')}
                    className="rounded-full border border-[#eeeeeb] px-2.5 py-1 font-medium text-[#777a80] hover:bg-[#f6f6f4]"
                  >
                    @当前页
                  </button>
                  <button
                    onClick={() => insertMention('@当前文件')}
                    className="rounded-full border border-[#eeeeeb] px-2.5 py-1 font-medium text-[#777a80] hover:bg-[#f6f6f4]"
                  >
                    @当前文件
                  </button>
                  <button
                    onClick={() => insertMention('@Workbench')}
                    className="rounded-full border border-[#eeeeeb] px-2.5 py-1 font-medium text-[#777a80] hover:bg-[#f6f6f4]"
                  >
                    @Workbench
                  </button>
                </div>
                <div className="grid gap-2">
                  {menuContextChips.length === 0 && pinnedContextChips.length === 0 && (
                    <div className="rounded-xl bg-[#fbfbfa] px-3 py-2 text-[#96999d]">暂无可用上下文</div>
                  )}
                  {[...pinnedContextChips, ...menuContextChips].map((chip) => (
                    <div
                      key={chip.id}
                      className="flex min-w-0 items-center gap-2 rounded-xl border border-[#eeeeeb] px-3 py-2"
                    >
                      <button
                        onClick={() => setInspectedChipId(inspectedChipId === chip.id ? null : chip.id)}
                        className="min-w-0 flex-1 truncate text-left"
                        title={chip.label}
                      >
                        {chip.label}
                      </button>
                      <button
                        onClick={() => hideChip(chip.id)}
                        className="rounded-full p-1 text-[#96999d] hover:bg-[#f6f6f4] hover:text-[#34373c]"
                        title="隐藏上下文"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setDebugOpen((value) => !value)}
                  className="mt-3 rounded-full border border-[#e5e5e1] px-3 py-1.5 font-medium text-[#777a80] hover:bg-[#f6f6f4]"
                >
                  Context Debug
                </button>
              </div>
            )}
          </div>
          {inspectedChip && (
            <div className="mt-2 rounded-2xl border border-[#e5e5e1] bg-[#fbfbfa] p-3 text-xs text-[#34373c]">
              <div className="mb-1 font-semibold">{inspectedChip.label}</div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-mono leading-5 text-[#777a80]">
                {inspectedChip.detail || '暂无文本详情'}
              </pre>
            </div>
          )}
          {debugOpen && (
            <div className="fixed inset-y-4 right-4 z-40 flex w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#d7e8d2] bg-white text-xs text-[#34373c] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
              <div className="flex items-center justify-between border-b border-[#eeeeeb] px-4 py-3">
                <div>
                  <div className="font-semibold text-[#25272b]">Context Debug</div>
                  <div className="mt-0.5 text-[11px] text-[#777a80]">开发态上下文抽屉，可用于检查与手动调试</div>
                </div>
                <button
                  onClick={() => setDebugOpen(false)}
                  className="rounded-full p-1.5 text-[#777a80] hover:bg-[#f6f6f4] hover:text-[#25272b]"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#fbfbfa] p-4">
                <section className="rounded-xl border border-[#eeeeeb] bg-white p-3">
                  <div className="mb-2 font-semibold text-[#25272b]">Live Context</div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <div>activePanel: {aiContext?.activePanelId || 'none'}</div>
                    <div>activeFile: {aiContext?.activeFile?.name || 'none'}</div>
                    <div>openPanels: {aiContext?.openPanels?.length || 0}</div>
                    <div>contextMode: {contextMode}</div>
                    <div>liveVersion: {aiContext?.liveContextVersion ?? 0}</div>
                    <div>chips: {contextChips.length}</div>
                    <div>lockedSelection: {lockedSelection ? `${lockedSelection.content.length} chars` : 'none'}</div>
                    <div>pinnedSources: {persistentCitations.length}</div>
                  </div>
                </section>
                <section className="rounded-xl border border-[#eeeeeb] bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold text-[#25272b]">可调试选项</div>
                    <button
                      onClick={() => onUpdateViewState?.(editor.id, { hiddenContextChipIds: [], persistentCitations: [] })}
                      className="rounded-full border border-[#eeeeeb] px-2 py-1 text-[#777a80] hover:bg-[#f6f6f4]"
                    >
                      重置隐藏项/固定来源
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['auto', 'selection_only', 'viewport', 'active_file', 'workbench', 'workspace'] as AiContextMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setContextMode(mode)}
                        className={`rounded-full border px-2.5 py-1 font-medium ${
                          contextMode === mode
                            ? 'border-[#16833a] bg-[#f3faf1] text-[#16833a]'
                            : 'border-[#eeeeeb] text-[#777a80] hover:bg-[#f6f6f4]'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="rounded-xl border border-[#eeeeeb] bg-white p-3">
                  <div className="mb-2 font-semibold text-[#25272b]">Capsule Summary</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f7f7f5] p-2 font-mono leading-5 text-[#777a80]">
                    {JSON.stringify(
                      {
                        activeChips: contextChips.map((chip) => ({ id: chip.id, kind: chip.kind, label: chip.label })),
                        policyDecision: lastContextDebug?.contextPolicy || null,
                        usedContextSummary: lastContextDebug?.usedContextSummary || null,
                        estimatedTokensByLayer: (lastContextDebug?.contextCapsule as any)?.estimatedTokensByLayer || null,
                        fallbackReasons: (lastContextDebug?.contextCapsule as any)?.fallbackReasons || [],
                        clippedItems: (lastContextDebug?.contextCapsule as any)?.clippedItems || [],
                        citations: (lastContextDebug?.contextCapsule as any)?.citations || [],
                        sourceMap: sourceInspectorItems.map((source) => ({
                          sourceId: source.sourceId,
                          sourceType: source.sourceType,
                          confidence: source.confidence,
                          label: source.label,
                          score: source.score,
                          includedInPrompt: source.includedInPrompt
                        }))
                      },
                      null,
                      2
                    )}
                  </pre>
                </section>
                <section className="rounded-xl border border-[#eeeeeb] bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[#25272b]">Source Inspector</div>
                      <div className="mt-0.5 text-[11px] text-[#777a80]">
                        Stable source id、可信度和检索分数拆解
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full border border-[#eeeeeb] px-2 py-1 text-[11px] text-[#777a80]">
                      {sourceInspectorItems.length} sources
                    </div>
                  </div>
                  {sourceInspectorItems.length === 0 ? (
                    <div className="rounded-lg bg-[#f7f7f5] p-3 text-[#96999d]">
                      还没有可检查的来源。发送一次问题后会显示 S1/S2/S3。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sourceInspectorItems.map((source) => (
                        <div
                          key={source.sourceId}
                          className="rounded-xl border border-[#eeeeeb] bg-[#fbfbfa] p-3"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-md bg-[#202124] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
                                  {source.sourceId}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${confidenceClass(source.confidence)}`}>
                                  {confidenceLabel(source.confidence)}
                                </span>
                                <span className="rounded-full border border-[#eeeeeb] bg-white px-2 py-0.5 text-[11px] text-[#777a80]">
                                  {sourceTypeLabel(source.sourceType)}
                                </span>
                                {!source.includedInPrompt && (
                                  <span className="rounded-full border border-[#eeeeeb] bg-white px-2 py-0.5 text-[11px] text-[#96999d]">
                                    pinned only
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => jumpToCitation(source)}
                                className="mt-2 max-w-full truncate text-left font-semibold text-[#25272b] hover:underline"
                                title="点击回跳到来源位置"
                              >
                                {source.label}
                              </button>
                              <div className="mt-1 truncate text-[11px] text-[#777a80]">
                                {source.fileName}
                                {typeof source.score === 'number' ? ` · score ${source.score.toFixed(2)}` : ''}
                              </div>
                            </div>
                            <button
                              onClick={() => persistCitation(source)}
                              className="shrink-0 rounded-full border border-[#eeeeeb] bg-white px-2 py-1 text-[11px] font-medium text-[#777a80] hover:bg-[#f6f6f4]"
                              title="固定这个来源"
                            >
                              固定
                            </button>
                          </div>
                          {source.retrievalReason && (
                            <div className="mt-2 rounded-lg bg-white px-2 py-1.5 text-[11px] leading-5 text-[#5f6368]">
                              {source.retrievalReason}
                            </div>
                          )}
                          {source.matchedTerms?.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {source.matchedTerms.slice(0, 8).map((term) => (
                                <span
                                  key={`${source.sourceId}:${term}`}
                                  className="rounded-full border border-[#eeeeeb] bg-white px-2 py-0.5 font-mono text-[10px] text-[#777a80]"
                                >
                                  {term}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {source.scoreBreakdown && (
                            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
                              {Object.entries(source.scoreBreakdown)
                                .filter(([, value]) => typeof value === 'number' && Math.abs(value) > 0)
                                .map(([key, value]) => (
                                  <div key={`${source.sourceId}:${key}`} className="rounded-lg bg-white px-2 py-1">
                                    <div className="text-[10px] uppercase tracking-wide text-[#96999d]">{key}</div>
                                    <div className="font-mono text-[11px] font-semibold text-[#34373c]">
                                      {Number(value).toFixed(2)}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}
                          {source.preview && (
                            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-[11px] leading-5 text-[#777a80]">
                              {source.preview}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="rounded-xl border border-[#eeeeeb] bg-white p-3">
                  <div className="mb-2 font-semibold text-[#25272b]">Retrieved Chunks</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f7f7f5] p-2 font-mono leading-5 text-[#777a80]">
                    {JSON.stringify(
                      ((lastContextDebug?.contextCapsule as any)?.retrievedChunks || []).map((chunk: any) => ({
                        sourceId: chunk.sourceId,
                        confidence: chunk.confidence,
                        fileName: chunk.fileName,
                        score: chunk.score,
                        retrievalReason: chunk.retrievalReason,
                        matchedTerms: chunk.matchedTerms,
                        scoreBreakdown: chunk.scoreBreakdown,
                        locator: chunk.locator,
                        preview: chunk.content?.slice?.(0, 300)
                      })),
                      null,
                      2
                    )}
                  </pre>
                </section>
                <section className="rounded-xl border border-[#eeeeeb] bg-white p-3">
                  <div className="mb-2 font-semibold text-[#25272b]">Final Prompt Context Preview</div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[#f7f7f5] p-2 font-mono leading-5 text-[#777a80]">
                    {(lastContextDebug?.contextCapsule as any)?.promptContextPreview || '还没有发送过带 Debug 信息的请求'}
                  </pre>
                </section>
              </div>
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
  isLoading = false,
  onChangeContent,
  onUpdateViewState,
  onBindResource,
  aiContext
}: WorkbenchEditorContentProps) {
  const detectedResourceKind = getResourceKind(resource);
  const [resourceGuideText, setResourceGuideText] = useState('');
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
        content={content ?? ''}
        isLoading={Boolean(isLoading)}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
        onBindResource={onBindResource}
      />
    );
  }

  if (editor.type === 'ai') {
    return <AiEditorView editor={editor} workspaceId={workspaceId} aiContext={aiContext} onUpdateViewState={onUpdateViewState} />;
  }

  if (editor.type === 'studio') {
    return <AIStudioPanel editor={editor} workspaceId={workspaceId} aiContext={aiContext} onUpdateViewState={onUpdateViewState} />;
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
  const sourceTitle = sourceMetadata.title || resource.name.replace(/\.source$/i, '');
  const sourceText = resourceKind === 'web'
    ? [sourceTitle, sourceMetadata.url, sourceMetadata.body].filter(Boolean).join('\n\n')
    : resourceGuideText || effectiveContent;

  if (resourceKind === 'html') {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        sourceText={effectiveContent}
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
        sourceText={sourceText}
        sourceUrl={sourceMetadata.url}
        onUpdateViewState={onUpdateViewState}
      >
        <WebSourcePreview
          title={sourceTitle}
          url={sourceMetadata.url}
          body={sourceMetadata.body}
          workspaceId={workspaceId}
        />
      </ResourcePanelShell>
    );
  }

  if (editor.type === 'video' || resourceKind === 'video') {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        sourceText={`${resource.name}\n${resource.path}`}
        sourceUrl={fileSystemApi.downloadUrl(workspaceId, resource.id)}
        onUpdateViewState={onUpdateViewState}
      >
        <VideoFilePreview resource={resource} workspaceId={workspaceId} />
      </ResourcePanelShell>
    );
  }

  if (resourceKind === 'pdf' || resourceKind === 'document' || editor.type === 'resource') {
    return (
      <ResourcePanelShell
        editor={editor}
        resource={resource}
        workspaceId={workspaceId}
        sourceText={sourceText}
        sourceUrl={fileSystemApi.downloadUrl(workspaceId, resource.id)}
        onUpdateViewState={onUpdateViewState}
      >
        <DocumentPreview
          resource={resource}
          workspaceId={workspaceId}
          editorId={editor.id}
          onUpdateViewState={onUpdateViewState}
          onExtractedText={setResourceGuideText}
        />
      </ResourcePanelShell>
    );
  }

  if (
    editor.type === 'code' &&
    (resourceKind === 'code' || resourceKind === 'structured') &&
    ((editor.viewState.codeOpenMode as 'blocksuite' | 'plain' | undefined) || 'blocksuite') ===
      'blocksuite'
  ) {
    return (
      <BlockSuiteCodeEditor
        editor={editor}
        resource={resource}
        content={String(content ?? '')}
        isLoading={isLoading}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
      />
    );
  }

  return (
    <TextEditingSurface
      editor={editor}
      resource={resource}
      content={String(content ?? '')}
      isLoading={isLoading}
      onChangeContent={onChangeContent}
      onUpdateViewState={onUpdateViewState}
    />
  );
}
