import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCode2,
  FileText,
  Image,
  Loader2,
  Network,
  Paperclip,
  Play,
  Search,
  Sparkles,
  TerminalSquare,
  Target,
  Wand2,
  X
} from 'lucide-react';
import { AgentUiEvent, LearningGoalDraft, LearningTerminalMessage, TerminalChatFile, WorkbenchItem } from '../../types';
import { learningApi } from '../../services/learningApi';
import { fileSystemApi } from '../../services/fileSystemApi';
import OpenWebUIMarkdownPreview, { OpenWebUICitationSource } from '../workbench/OpenWebUIMarkdownPreview';
import TerminalComposer from './TerminalComposer';
import TerminalResourcePreviewPanel, { TerminalResourcePreview } from './TerminalResourcePreviewPanel';

interface LearningTerminalProps {
  workspaceId: string;
  sessionId?: string;
  workbenchId?: string;
  workspaceName: string;
  major?: string;
  workbenches: WorkbenchItem[];
  fileCount: number;
  messages: LearningTerminalMessage[];
  hasMoreMessages?: boolean;
  loadingEarlierMessages?: boolean;
  initialCheckpointThreadId?: string;
  onMessagesChange: (messages: LearningTerminalMessage[]) => void;
  onLoadEarlierMessages?: () => Promise<void> | void;
  onCheckpointThreadIdChange?: (checkpointThreadId: string) => void;
  onChatStarted: (title: string) => void;
  onUploadMaterials: () => void;
  onWorkbenchCreated: (workbenchId: string) => void;
  onRefresh: () => Promise<void> | void;
  variant?: 'full' | 'dashboard';
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  mode?: 'chat' | 'agentic' | 'new_agentic';
  selectedSources?: Array<{ fileId: string; mode?: 'focused' | 'full_context' }>;
  chatFiles?: TerminalChatFile[];
  sourceFiles?: Array<{
    id: string;
    name: string;
    path: string;
    updatedAt?: string;
    indexStatusLabel?: string;
    indexStatusDetail?: string;
    indexStatusTone?: 'ready' | 'indexing' | 'degraded' | 'failed' | 'empty';
    chunkCount?: number;
  }>;
  onModeChange?: (mode: 'chat' | 'agentic' | 'new_agentic') => void;
  onSelectedSourcesChange?: (sources: Array<{ fileId: string; mode: 'focused' | 'full_context' }>) => void;
  onChatFilesChange?: (files: TerminalChatFile[]) => void;
  onUploadChatFiles?: (files: File[]) => Promise<TerminalChatFile[]>;
  resourcePreview?: TerminalResourcePreview | null;
  onResourcePreviewChange?: (preview: TerminalResourcePreview | null) => void;
}

const starterPrompts = [
  '我想建立一个新的学习目标',
  '帮我总结当前进度',
  '根据已有资料推荐下一步',
  '创建一个项目实战学习现场'
];

const getStarterDescription = (index: number) => {
  if (index === 0) return '从目标开始创建一条可持续的学习路线';
  if (index === 1) return '整理已有 workbench 与资源的状态';
  if (index === 2) return '根据当前文件生成下一步行动';
  return '创建一个带资源和助教的任务现场';
};

const fileIsImage = (file: Pick<TerminalChatFile, 'mimeType' | 'extension' | 'name'>) => {
  const mimeType = (file.mimeType || '').toLowerCase();
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  return mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension);
};

type TerminalEvidence = NonNullable<LearningTerminalMessage['evidence']>[number];
type TerminalStatus = NonNullable<LearningTerminalMessage['statusHistory']>[number];
type TerminalResourceDiscoveryCard = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  fromHistory?: boolean;
};

const webResourceEvidenceKinds = new Set(['web_search_result', 'web_page']);
const webToolPattern = /\bweb\.(search|fetch)\b|searching the web|searched the web|fetching web content|fetched web content/i;

const formatWorkingTime = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
};

const humanizeMachineName = (value?: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized
    .replace(/workspace\.(fs|file|files)\.(list|search|read)/g, (_, area, action) => {
      if (action === 'list') return 'workspace files';
      if (action === 'search') return 'workspace resources';
      if (action === 'read') return 'workspace files';
      return `${area} ${action}`;
    })
    .replace(/knowledge\.search/g, 'knowledge base')
    .replace(/attachment\.read/g, 'attachments')
    .replace(/attachment\.image\.inspect/g, 'images')
    .replace(/web\.search/g, 'web')
    .replace(/web\.fetch/g, 'web page')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const toolActionLabel = (tool?: string, running = false) => {
  const name = String(tool || '').trim();
  const prefix = running ? '正在搜索' : '已搜索';
  if (!name) return running ? '正在处理' : '步骤完成';
  if (name === 'workspace.fs.list' || name === 'workspace.files.list') return running ? '正在列出 workspace 文件' : '已列出 workspace 文件';
  if (name === 'workspace.file.search' || name === 'workspace.files.search') return `${prefix} workspace 资料`;
  if (name === 'workspace.file.read' || name === 'workspace.files.read') return running ? '正在读取 workspace 文件' : '已读取 workspace 文件';
  if (name === 'knowledge.search') return running ? '正在搜索知识库' : '已搜索知识库';
  if (name === 'attachment.list') return running ? '正在检查附件' : '已检查附件';
  if (name === 'attachment.read') return running ? '正在读取附件' : '已读取附件';
  if (name === 'studio.generate_artifact') return running ? '正在生成 Studio 资源' : '已生成 Studio 资源';
  if (name === 'attachment.image.inspect') return running ? '正在检查图片' : '已检查图片';
  if (name === 'web.search') return running ? '正在搜索网页' : '已搜索网页';
  if (name === 'web.fetch') return running ? '正在抓取网页内容' : '已抓取网页内容';
  if (name === 'file.write') return running ? '正在准备文件' : '已准备文件';
  if (name === 'file.write_many') return running ? '正在准备多个文件' : '已准备多个文件';
  if (name === 'file.replace') return running ? '正在更新文件' : '已更新文件';
  if (name === 'markdown_note.create') return running ? '正在准备 Markdown 文件' : '已准备 Markdown 文件';
  if (name === 'workbench.create') return running ? '正在准备 workbench' : '已准备 workbench';
  return running ? `正在使用 ${humanizeMachineName(name)}` : `已使用 ${humanizeMachineName(name)}`;
};

const asRecord = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

const studioTemplateDisplay = (templateId?: string, fallback?: string) => {
  if (templateId === 'mind_map') return '思维导图';
  if (templateId === 'custom_practice') return '练习题';
  if (templateId === 'react_chat_visual') return '可视化讲解';
  if (templateId === 'flashcards') return '复习卡片';
  if (templateId === 'light_visual_lesson') return 'Light Visual Lesson';
  if (templateId === 'code_lab') return 'Code Lab';
  return fallback || 'AI Studio 资源';
};

const studioTemplateIcon = (templateId?: string) => {
  if (templateId === 'mind_map') return Network;
  if (templateId === 'react_chat_visual') return Play;
  if (templateId === 'flashcards') return Brain;
  if (templateId === 'custom_practice') return CheckCircle2;
  if (templateId === 'light_visual_lesson') return Sparkles;
  if (templateId === 'code_lab') return FileCode2;
  return Sparkles;
};

const compactPreview = (value: unknown, max = 420) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
};

const titleFromUrl = (url: string) => {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const metadataString = (metadata: Record<string, unknown> | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const metadataImageUrl = (metadata: Record<string, unknown> | undefined) => {
  const direct = metadataString(metadata, [
    'image',
    'imageUrl',
    'thumbnail',
    'thumbnailUrl',
    'coverUrl',
    'coverImageUrl',
    'ogImage'
  ]);
  if (direct) return direct;

  const images = metadata?.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === 'string' && image.trim()) return image.trim();
      const record = asRecord(image);
      const src = metadataString(record || undefined, ['src', 'url', 'href']);
      if (src) return src;
    }
  }
  return '';
};

const youtubeVideoIdFromUrl = (url: string) => {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (!host.endsWith('youtube.com') && !host.endsWith('youtube-nocookie.com')) return '';
    const fromQuery = parsed.searchParams.get('v');
    if (fromQuery) return fromQuery;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const markerIndex = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
    return markerIndex >= 0 ? parts[markerIndex + 1] || '' : '';
  } catch {
    return '';
  }
};

const thumbnailForWebResource = (url: string, metadata: Record<string, unknown> | undefined) => {
  const fromMetadata = metadataImageUrl(metadata);
  if (fromMetadata) return fromMetadata;
  const youtubeVideoId = youtubeVideoIdFromUrl(url);
  return youtubeVideoId ? `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` : undefined;
};

const normalizedResourceUrl = (url: string) => {
  const value = url.trim();
  if (!value) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return value;
  }
};

const extractNormalizedUrlsFromText = (text: string) => {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'`）)\]]+/gi) || [];
  const urls: string[] = [];
  const seen = new Set<string>();
  matches.forEach((match) => {
    const url = normalizedResourceUrl(match.replace(/[.,;，。；`]+$/g, ''));
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });
  return urls;
};

const resourceDiscoveryCardsFromEvidence = (
  sources: TerminalEvidence[] = [],
  assistantContent = ''
): TerminalResourceDiscoveryCard[] => {
  const cards: TerminalResourceDiscoveryCard[] = [];
  const seen = new Set<string>();

  sources.forEach((source, index) => {
    if (!webResourceEvidenceKinds.has(source.kind)) return;
    const metadata = source.metadata || {};
    const rawUrl = metadataString(metadata, ['url', 'sourceUrl', 'externalUrl', 'canonicalUrl']) || source.source || '';
    const url = normalizedResourceUrl(rawUrl);
    const key = normalizedResourceUrl(url);
    if (!url || seen.has(key)) return;
    seen.add(key);

    cards.push({
      id: String(source.id || `web-resource-${index + 1}`),
      title: decodeSourceString(source.title || titleFromUrl(url)),
      url,
      thumbnailUrl: thumbnailForWebResource(url, metadata),
      fromHistory: Boolean(metadata.historyMessageId)
    });
  });

  const contentUrls = extractNormalizedUrlsFromText(assistantContent);
  if (contentUrls.length) {
    const cardsByUrl = new Map(cards.map((card) => [normalizedResourceUrl(card.url), card] as const));
    const matchedCards = contentUrls
      .map((url) => cardsByUrl.get(url))
      .filter((card): card is TerminalResourceDiscoveryCard => Boolean(card))
      .slice(0, 8);
    return matchedCards;
  }

  return cards.filter((card) => !card.fromHistory).slice(0, 8);
};

const hasWebResourceDiscoverySignal = (message: LearningTerminalMessage) => {
  if ((message.evidence || []).some((source) => webResourceEvidenceKinds.has(source.kind))) return true;
  if ((message.statusHistory || []).some((status) => webToolPattern.test(`${status.description || ''} ${status.action || ''}`))) return true;
  return (message.agentEvents || []).some((event) => {
    if (event.kind === 'activity') return webToolPattern.test(`${event.title || ''} ${event.detail || ''} ${event.node || ''}`);
    if (event.kind === 'say') return webToolPattern.test(`${event.content || ''} ${event.node || ''}`);
    return false;
  });
};

const knownToolFromText = (value?: string) =>
  String(value || '').match(
    /\b(?:workspace\.(?:fs|file|files)\.(?:list|search|read)|knowledge\.search|attachment\.(?:list|read|image\.inspect)|web\.(?:search|fetch)|file\.(?:write|write_many|replace)|markdown_note\.create|workbench\.create|studio\.generate_artifact)\b/
  )?.[0];

const statusActionLabel = (status: TerminalStatus) => {
  const action = String(status.action || '');
  const running = status.done === false;
  if (action === 'prepare_context_control') return running ? '正在准备 workspace 上下文' : '已准备 workspace 上下文';
  if (action === 'model_decision') return running ? '正在选择下一步' : '已选择下一步';
  if (action === 'tool_call') return toolActionLabel(status.description, running);
  if (action === 'knowledge_search') return `正在搜索知识：“${status.query || ''}”`;
  if (action === 'queries_generated') return '已生成搜索查询';
  if (action === 'sources_retrieved') {
    if (status.count === 0) return '未找到匹配资料';
    if (status.count === 1) return '已检索到 1 条资料';
    return `已检索到 ${status.count || 0} 条资料`;
  }
  if (action === 'thinking') return '思考中';
  return humanizeMachineName(status.description || action) || '处理中';
};

const agentEventLabel = (event: AgentUiEvent) => {
  if (event.kind === 'activity') {
    const raw = event.detail || event.title;
    if (/tools available;\s*mode=/i.test(raw || '')) return '已准备 workspace 上下文';
    if (/fallback: request ordinary workspace search/i.test(raw || '')) return '正在搜索 workspace 资料';
    if (/fallback: search indexed knowledge/i.test(raw || '')) return '正在搜索知识库';
    if (/fallback: read explicit chat attachments/i.test(raw || '')) return '正在读取附件';
    const selectedMatch = raw?.match(/^Selected\s+(.+)$/i);
    if (selectedMatch) return toolActionLabel(selectedMatch[1], true);
    const toolName = knownToolFromText(raw);
    if (toolName) return toolActionLabel(toolName, event.status === 'running');
    if (/^tool_call$/i.test(raw || '') || /^tool call$/i.test(raw || '')) return '正在使用工具';
    if (/^final$/i.test(raw || '')) return '正在起草最终回答';
    if (/^ask_user$/i.test(raw || '')) return '正在准备提问';
    return humanizeMachineName(raw) || raw || '处理中';
  }
  if (event.kind === 'artifact') return `已生成 ${humanizeMachineName(event.artifactType)}：${event.title}`;
  if (event.kind === 'ask') return event.prompt;
  return '';
};

const normalizedAgentEvent = (event: AgentUiEvent): AgentUiEvent => {
  if (event.kind === 'activity') {
    const label = agentEventLabel(event);
    return { ...event, title: label, detail: label };
  }
  if (event.kind === 'artifact') {
    return { ...event, title: agentEventLabel(event) };
  }
  return event;
};

const metadataArray = <T,>(metadata: Record<string, unknown> | undefined, key: string): T[] =>
  Array.isArray(metadata?.[key]) ? (metadata[key] as T[]) : [];

const decodeSourceString = (value?: string) => {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
};

const citationSourcesFromEvidence = (sources: TerminalEvidence[]): OpenWebUICitationSource[] =>
  sources.map((source, index) => ({
    sourceId: String(source.id || index + 1).replace(/^[SF]/, ''),
    fileId: String(source.metadata?.fileId || source.metadata?.path || source.title || index),
    fileName: source.title || source.source || 'Citation',
    label: source.source || `[${index + 1}] ${source.title || 'Citation'}`,
    locator: source.metadata?.locator as Record<string, any> | undefined,
    preview: source.summary || source.content || ''
  }));

const evidenceByCitationId = (sources: TerminalEvidence[]) => {
  const map = new Map<string, TerminalEvidence>();
  sources.forEach((source, index) => {
    const numeric = String(source.id || index + 1).replace(/^[SF]/, '');
    map.set(numeric, source);
    map.set(`S${numeric}`, source);
    map.set(`F${numeric}`, source);
  });
  return map;
};

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const terminalTone = {
  greenBg: 'rgb(216,221,205)',
  greenText: 'rgb(96,121,43)',
  redBg: 'rgb(223,187,185)',
  redText: 'rgb(157,39,30)'
};

const planFromProposal = (action: NonNullable<LearningTerminalMessage['proposedActions']>[number]) => {
  const payload = action.payload || {};
  const plan = (payload as any).plan;
  return plan && typeof plan === 'object' ? plan as Record<string, any> : null;
};

const planTitle = (plan: Record<string, any>) =>
  String(plan.structuredPlan?.objective || plan.objective || plan.structuredPlan?.title || 'Learning plan');

const planPreviewSteps = (plan: Record<string, any>) => {
  const structuredStages = safeArray<Record<string, any>>(plan.structuredPlan?.stages);
  if (structuredStages.length) {
    return structuredStages.map((stage, index) => ({
      id: String(stage.id || stage.order || `stage-${index + 1}`),
      title: String(stage.title || stage.name || `Stage ${index + 1}`),
      detail: String(stage.goal || stage.objective || stage.description || ''),
      load: String(stage.duration || stage.estimatedLoad || ''),
      evidence: safeArray<string>(stage.outputs || stage.expectedEvidence)
    }));
  }
  return safeArray<Record<string, any>>(plan.steps).map((step, index) => ({
    id: String(step.id || `step-${index + 1}`),
    title: String(step.title || step.task || `Step ${index + 1}`),
    detail: String(step.rationale || step.description || ''),
    load: String(step.estimatedLoad || ''),
    evidence: safeArray<string>(step.expectedEvidence)
  }));
};

function ProposalPlanPreview({ plan }: { plan: Record<string, any> }) {
  const steps = planPreviewSteps(plan);
  const plannerMode = String((plan.knowledgeGraphSnapshot as any)?.planningEnhancements ? 'MCL enhanced' : 'MCL');
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-100 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-gray-700">计划预览</p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">{planTitle(plan)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700">
          {plannerMode}
        </span>
      </div>
      {steps.length ? (
        <ol className="mt-3 space-y-2">
          {steps.slice(0, 6).map((step, index) => (
            <li key={step.id} className="flex gap-2 text-xs leading-5 text-gray-700">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-gray-900">{step.title}</span>
                  {step.load ? <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{step.load}</span> : null}
                </div>
                {step.detail ? <p className="line-clamp-2 text-gray-500">{step.detail}</p> : null}
                {step.evidence.length ? (
                  <p className="line-clamp-1 text-[11px] text-gray-400">依据：{step.evidence.slice(0, 3).join(', ')}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-gray-500">这个提案没有返回结构化步骤。</p>
      )}
      {steps.length > 6 ? <p className="mt-2 text-[11px] text-gray-400">保存后在规划中还有 {steps.length - 6} 个步骤。</p> : null}
    </div>
  );
}

function SourceDetailModal({
  source,
  onClose
}: {
  source: TerminalEvidence | null;
  onClose: () => void;
}) {
  if (!source) return null;

  const metadata = source.metadata || {};
  const supportSnippets = metadataArray<{ text?: string; score?: number }>(metadata, 'supportSnippets');
  const documents = source.content
    ? [source.content]
    : [
        source.summary,
        ...supportSnippets.map((snippet) => snippet.text || '').filter(Boolean)
      ].filter(Boolean);

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      className="modal fixed bottom-0 left-0 right-0 top-0 z-[9999] flex h-screen max-h-[100dvh] w-full justify-center overflow-y-auto overscroll-contain bg-black/30 p-3"
      style={{ scrollbarGutter: 'stable' }}
      onMouseDown={onClose}
    >
      <div
        className="m-auto min-h-fit w-[56rem] max-w-full rounded-[2rem] border border-white bg-white/95 shadow-[0_24px_72px_rgba(0,0,0,0.22)] backdrop-blur-sm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between px-[1.125rem] pb-2 pt-3 text-gray-900">
          <div className="flex min-w-0 items-center self-center text-lg font-medium">
            <span className="line-clamp-1 grow underline">{decodeSourceString(source.title || source.source || 'Citation')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="self-center text-gray-900"
            aria-label="关闭引用弹窗"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex w-full flex-col px-5 pb-5 md:flex-row md:space-x-4">
          <div className="scrollbar-thin flex max-h-[22rem] w-full flex-col gap-1 overflow-y-scroll text-gray-800">
            {documents.length ? (
              documents.map((document, documentIndex) => (
                <div key={`${source.id}:document:${documentIndex}`} className="flex w-full flex-col gap-2">
                  <div>
                    <div className="mb-1 flex w-fit items-center gap-2 text-sm font-medium text-gray-900">
                      内容
                    </div>
                    <div className="markdown-prose-sm min-w-full max-w-full text-sm">
                      <OpenWebUIMarkdownPreview
                        content={String(document).trim().replace(/\n\n+/g, '\n\n')}
                        emptyMessage=""
                      />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">暂无预览。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function SourcesCapsule({
  sources,
  onOpenSource
}: {
  sources: TerminalEvidence[];
  onOpenSource: (source: TerminalEvidence) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  return (
    <div className="w-full">
      <div className="-mx-0.5 flex w-full flex-wrap items-center gap-1 py-1">
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded-full border border-gray-50 px-3.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
          aria-label={sources.length === 1 ? '切换 1 条来源' : `切换 ${sources.length} 条来源`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <div>{sources.length === 1 ? '1 条来源' : `${sources.length} 条来源`}</div>
        </button>
      </div>
      {open ? (
        <div className="py-1.5">
          <div className="flex flex-col gap-2 text-xs">
            {sources.map((source, index) => (
              <button
                key={`${source.id}:${source.title}:${index}`}
                type="button"
                id={`source-${source.id}-${index + 1}`}
                aria-label={`View source: ${decodeSourceString(source.title || source.source || 'Citation')}`}
                className="no-toggle outline-hidden flex items-center gap-1.5 rounded-xl bg-transparent text-gray-600"
                onClick={() => onOpenSource(source)}
              >
                <div className="rounded-md bg-gray-50 px-1 font-medium">{index + 1}</div>
                <div className="flex-1 truncate text-left transition hover:text-black">
                  {decodeSourceString(source.title || source.source || 'Citation')}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResourceDiscoveryCards({
  cards,
  onOpen,
  loading = false
}: {
  cards: TerminalResourceDiscoveryCard[];
  onOpen: (card: TerminalResourceDiscoveryCard) => void;
  loading?: boolean;
}) {
  if (!cards.length && !loading) return null;

  return (
    <div className="mb-4 w-full">
      <div className="scrollbar-hidden -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {loading && !cards.length ? Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`resource-card-skeleton-${index}`}
            className="flex w-36 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-100 bg-white"
            aria-hidden="true"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
              <div className="absolute inset-0 animate-pulse bg-gray-100" />
              <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                <Search className="size-5" />
              </div>
            </div>
            <div className="min-h-12 w-full px-2 py-2">
              <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
              <div className="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
        )) : cards.map((card) => (
          <button
            key={`${card.id}:${card.url}`}
            type="button"
            title={card.title}
            className="group flex w-36 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-100 bg-white text-left transition hover:border-gray-200 hover:bg-gray-50"
            onClick={() => onOpen(card)}
          >
            <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <Search className="size-5" />
              </div>
              {card.thumbnailUrl ? (
                <img
                  src={card.thumbnailUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
            </div>
            <div className="min-h-12 w-full px-2 py-2">
              <div className="line-clamp-2 text-xs font-medium leading-4 text-gray-800 group-hover:text-gray-950">
                {card.title}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StudioArtifactCard({
  workspaceId,
  action,
  onOpenPreview
}: {
  workspaceId: string;
  action: NonNullable<LearningTerminalMessage['executedActions']>[number];
  onOpenPreview: (preview: TerminalResourcePreview) => void;
}) {
  const card = asRecord(action.result?.studioCard);
  if (!card) return null;
  const templateId = typeof card.templateId === 'string' ? card.templateId : undefined;
  const Icon = studioTemplateIcon(templateId);
  const title = studioTemplateDisplay(templateId, typeof card.templateTitle === 'string' ? card.templateTitle : undefined);
  const filename = typeof card.filename === 'string' ? card.filename : title;
  const fileObjectId = typeof card.fileObjectId === 'string' ? card.fileObjectId : '';
  const renderJobStatus = typeof card.renderJobStatus === 'string' ? card.renderJobStatus : '';
  const reviewSummary = typeof card.reviewSummary === 'string' ? card.reviewSummary : '';
  const preview = compactPreview(card.previewContent, 520);
  const sourceCount = Array.isArray(card.sourceFileIds) ? card.sourceFileIds.length : 0;
  const evidenceCount = Array.isArray(card.evidenceIds) ? card.evidenceIds.length : 0;
  const downloadUrl = fileObjectId ? fileSystemApi.downloadUrl(workspaceId, fileObjectId) : '';
  const previewResource: TerminalResourcePreview = {
    id: fileObjectId || String(card.runId || action.id),
    title,
    subtitle: filename,
    kind: templateId || (typeof card.deliveryKind === 'string' ? card.deliveryKind : undefined),
    templateId,
    fileObjectId,
    filename,
    previewContent: typeof card.previewContent === 'string' ? card.previewContent : '',
    renderer: typeof card.renderer === 'string' ? card.renderer : undefined,
    framework: typeof card.framework === 'string' ? card.framework : undefined,
    reviewSummary
  };
  const canPreview = Boolean(previewResource.previewContent || previewResource.fileObjectId);

  return (
    <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-3 text-gray-900 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
            {typeof card.reviewScore === 'number' ? (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: terminalTone.greenBg, color: terminalTone.greenText }}
              >
                Score {Math.round(card.reviewScore * 100)}
              </span>
            ) : null}
            {renderJobStatus ? (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                Render {renderJobStatus}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">{filename}</p>
          {reviewSummary ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-600">{reviewSummary}</p> : null}
          {preview ? (
            <div className="mt-2 rounded-xl bg-gray-50 p-2 text-xs leading-5 text-gray-700">
              {preview}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-0.5">{String(card.sourceMode || 'evidence')}</span>
            {evidenceCount ? <span className="rounded-full bg-gray-100 px-2 py-0.5">{evidenceCount} evidence</span> : null}
            {sourceCount ? <span className="rounded-full bg-gray-100 px-2 py-0.5">{sourceCount} source files</span> : null}
            {typeof card.deliveryKind === 'string' ? <span className="rounded-full bg-gray-100 px-2 py-0.5">{card.deliveryKind}</span> : null}
          </div>
          {canPreview || downloadUrl ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {canPreview ? (
                <button
                  type="button"
                  onClick={() => onOpenPreview(previewResource)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gray-900 px-3 text-xs font-medium text-white transition hover:bg-black"
                >
                  <Play className="size-3.5" />
                  打开预览
                </button>
              ) : null}
              {downloadUrl ? (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gray-100 px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-200"
                >
                  <ExternalLink className="size-3.5" />
                  新标签
                </a>
              ) : null}
              {fileObjectId ? (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gray-100 px-3 text-xs font-medium text-gray-600">
                  <FileText className="size-3.5" />
                  {fileObjectId.slice(0, 8)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FollowUps({
  followUps,
  onClick
}: {
  followUps: string[];
  onClick: (followUp: string) => void;
}) {
  if (!followUps.length) return null;

  return (
    <div className="mt-4">
      <div className="text-sm font-medium">继续追问</div>
      <div className="mt-1.5 flex flex-col gap-1 text-left">
        {followUps.map((followUp, index) => (
          <div key={`${followUp}:${index}`}>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 bg-transparent py-1.5 text-left text-sm text-gray-500 transition hover:text-black"
              onClick={() => onClick(followUp)}
              aria-label={`Follow up: ${followUp}`}
              title={followUp}
            >
              <div className="line-clamp-1">{followUp}</div>
            </button>
            {index < followUps.length - 1 ? <hr className="border-gray-50" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const statusDescription = (status: TerminalStatus) => {
  return statusActionLabel(status);
};

function StatusHistory({ statusHistory = [] }: { statusHistory?: TerminalStatus[] }) {
  const visibleHistory = statusHistory.filter((status) => !status.hidden);
  const [open, setOpen] = useState(false);
  if (!visibleHistory.length) return null;

  const latest = visibleHistory[visibleHistory.length - 1];
  const renderStatus = (status: TerminalStatus, forceDone = false) => {
    const loading = !forceDone && status.done === false;
    return (
      <div className="status-description flex w-full items-start gap-2 py-0.5 text-left">
        <div className="flex min-w-0 flex-col justify-center -space-y-0.5">
          <div className={`${loading ? 'animate-pulse' : ''} line-clamp-1 text-wrap text-base text-gray-500`}>
            {statusDescription(status)}
          </div>
          {(status.action === 'queries_generated' || status.action === 'web_search_queries_generated') && status.queries?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {status.queries.slice(0, 4).map((query) => (
                <div key={query} className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-xs text-gray-500">
                  <Search className="size-3" />
                  <span className="line-clamp-1">{query}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full flex-col text-sm">
      <button
        type="button"
        className="w-full"
        aria-label="切换状态历史"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <div className="flex items-start gap-2">{renderStatus(latest)}</div>
      </button>
      {open && visibleHistory.length > 1 ? (
        <div className="flex flex-row">
          <div className="w-full">
            {visibleHistory.map((status, index) => (
              <div key={`${status.action}:${index}`} className="mb-1 flex items-stretch gap-2">
                <div>
                  <div className="mb-1.5 px-1 pt-3">
                    <span className="relative flex size-1.5 items-center justify-center rounded-full">
                      <span className="relative inline-flex size-1.5 rounded-full bg-gray-500" />
                    </span>
                  </div>
                  {index !== visibleHistory.length - 1 ? (
                    <div className="ml-[6.5px] h-[calc(100%-14px)] w-px bg-gray-300" />
                  ) : null}
                </div>
                {renderStatus(status, true)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StreamingInterimText({ content, active }: { content: string; active: boolean }) {
  const [visible, setVisible] = useState(active ? '' : content);
  const visibleRef = useRef(visible);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!active) {
      setVisible(content);
      return;
    }
    let index = content.startsWith(visibleRef.current) ? visibleRef.current.length : 0;
    if (index === 0) setVisible('');
    const timer = window.setInterval(() => {
      index = Math.min(content.length, index + 2);
      setVisible(content.slice(0, index));
      if (index >= content.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [active, content]);

  return (
    <>
      {visible}
      {active && visible.length < content.length ? (
        <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse rounded-full bg-blue-700/60" />
      ) : null}
    </>
  );
}

function InlineAgentUpdates({ events = [], isStreaming }: { events?: AgentUiEvent[]; isStreaming: boolean }) {
  const interimUpdates = events.filter((event): event is Extract<AgentUiEvent, { kind: 'say' }> => event.kind === 'say' && event.phase === 'interim');
  const latestActivity = [...events].reverse().find((event): event is Extract<AgentUiEvent, { kind: 'activity' }> => event.kind === 'activity');
  const artifacts = events.filter((event): event is Extract<AgentUiEvent, { kind: 'artifact' }> => event.kind === 'artifact');
  const asks = events.filter((event): event is Extract<AgentUiEvent, { kind: 'ask' }> => event.kind === 'ask');
  const [open, setOpen] = useState(false);

  if (!events.length) return null;

  if (!isStreaming && interimUpdates.length) {
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <span>{open ? 'Hide' : 'Show'} earlier updates</span>
          <span className="text-gray-400">{interimUpdates.length}</span>
        </button>
        {open ? (
          <div className="mt-2 space-y-2 border-l border-gray-100 pl-3 text-sm leading-6 text-gray-500">
            {interimUpdates.slice(-4).map((event) => (
              <div key={event.id}>{event.content}</div>
            ))}
          </div>
        ) : null}
        {artifacts.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {artifacts.slice(-4).map((event) => (
              <div key={event.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">
                <span className="capitalize text-gray-400">{event.artifactType}</span>
                <span className="min-w-0 truncate">{event.title}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (isStreaming && interimUpdates.length) {
    return (
      <div className="chat-assistant markdown-prose mb-3 w-full min-w-full text-gray-800">
        {interimUpdates.slice(-2).map((event, index, list) => (
          <div key={event.id} className="mb-2 last:mb-0">
            <StreamingInterimText content={event.content} active={index === list.length - 1} />
          </div>
        ))}
      </div>
    );
  }

  if (isStreaming && latestActivity) {
    const activityDotStyle = latestActivity.status === 'error'
      ? { backgroundColor: terminalTone.redText }
      : latestActivity.status === 'done'
        ? { backgroundColor: terminalTone.greenText }
        : undefined;
    return (
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
        <span
          className={`size-1.5 rounded-full ${latestActivity.status === 'error' || latestActivity.status === 'done' ? '' : 'animate-pulse bg-blue-400'}`}
          style={activityDotStyle}
        />
        <span className="truncate">{latestActivity.detail || latestActivity.title}</span>
      </div>
    );
  }

  if (!isStreaming && (artifacts.length || asks.length)) {
    return (
      <div className="mb-3 flex flex-wrap gap-1.5">
        {artifacts.slice(-4).map((event) => (
          <div key={event.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">
            <span className="capitalize text-gray-400">{event.artifactType}</span>
            <span className="min-w-0 truncate">{event.title}</span>
          </div>
        ))}
        {asks.slice(-1).map((event) => (
          <div key={event.id} className="inline-flex max-w-full rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
            {event.prompt}
          </div>
        ))}
      </div>
    );
  }

  return null;
}

const eventStatusLabel = (event: AgentUiEvent) => {
  if (event.kind === 'activity' || event.kind === 'artifact' || event.kind === 'ask') return agentEventLabel(event);
  return '';
};

function AgentTimeline({
  message,
  isStreaming,
  onOpenSource,
  onLinkPreview,
  resourceCards,
  resourceCardsLoading
}: {
  message: LearningTerminalMessage;
  isStreaming: boolean;
  onOpenSource: (source: TerminalEvidence) => void;
  onLinkPreview: (link: { href: string; title?: string; text?: string }) => void;
  resourceCards: TerminalResourceDiscoveryCard[];
  resourceCardsLoading: boolean;
}) {
  const events = message.agentEvents || [];
  const [open, setOpen] = useState(false);
  const runtimeEvents = events.filter((event) => event.kind === 'activity' || event.kind === 'artifact' || event.kind === 'ask');
  const progressSayEvents = events.filter((event): event is Extract<AgentUiEvent, { kind: 'say' }> =>
    event.kind === 'say' && event.node !== 'ResponseComposer' && Boolean(event.content?.trim())
  );
  const answerSayEvents = events.filter((event): event is Extract<AgentUiEvent, { kind: 'say' }> =>
    event.kind === 'say' && event.node === 'ResponseComposer' && Boolean(event.content?.trim())
  );
  const currentStatus = runtimeEvents[runtimeEvents.length - 1];
  const currentSay = progressSayEvents[progressSayEvents.length - 1];
  const assistantContent = isStreaming
    ? answerSayEvents[answerSayEvents.length - 1]?.content || message.content || ''
    : message.content || answerSayEvents[answerSayEvents.length - 1]?.content || '';
  const firstAt = events[0]?.at ? Date.parse(events[0].at) : NaN;
  const lastAt = events[events.length - 1]?.at ? Date.parse(events[events.length - 1].at) : NaN;
  const elapsedSeconds = Number.isFinite(firstAt) && Number.isFinite(lastAt)
    ? Math.max(0, Math.round((lastAt - firstAt) / 1000))
    : 0;
  const visibleEvents = open ? runtimeEvents : [];
  const currentStatusLabel = currentStatus ? eventStatusLabel(currentStatus) : '';

  return (
    <div className="w-full">
      {isStreaming && (currentStatusLabel || currentSay) ? (
        <div className="mb-4 space-y-2 text-gray-500">
          {currentStatusLabel ? (
            <div className="workspace-agent-status-breathe flex min-h-6 items-center gap-3 text-[15px] font-medium leading-6">
              <Search className="size-4 shrink-0" />
              <span key={currentStatus?.id || currentStatusLabel} className="workspace-agent-status-swap min-w-0 flex-1 truncate">
                {currentStatusLabel}
              </span>
            </div>
          ) : null}
          {currentSay ? (
            <div className="flex items-start gap-3 text-[15px] leading-7 text-gray-700">
              <Sparkles className="mt-1 size-4 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <StreamingInterimText content={currentSay.content} active={isStreaming} />
              </div>
            </div>
          ) : null}
        </div>
      ) : !isStreaming && runtimeEvents.length ? (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex items-center gap-1 border-b border-gray-100 pb-2 pr-1 text-base font-medium text-gray-400 transition hover:text-gray-700"
          >
            <span>Worked for {formatWorkingTime(elapsedSeconds)}</span>
            <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      ) : null}
      {visibleEvents.length ? (
        <div className="mb-4 space-y-4">
          {visibleEvents.map((event, eventIndex) => {
            const label = eventStatusLabel(event);
            if (!label) return null;
            const icon = event.kind === 'artifact' || event.kind === 'ask'
              ? <TerminalSquare className="mt-0.5 size-4 shrink-0 text-gray-400" />
              : <Search className="mt-0.5 size-4 shrink-0 text-gray-400" />;
            return (
              <div key={event.id || `activity-${eventIndex}`} className="flex items-start gap-3 text-[15px] font-medium leading-6 text-gray-400">
                {icon}
                <span className="min-w-0 flex-1">{label}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <ResourceDiscoveryCards
        cards={resourceCards}
        loading={resourceCardsLoading}
        onOpen={(card) => onLinkPreview({ href: card.url, text: card.title, title: card.title })}
      />
      {assistantContent.trim() ? (
        <div className="chat-assistant markdown-prose mb-4 w-full min-w-full">
                      <OpenWebUIMarkdownPreview
                        content={assistantContent}
                        emptyMessage=""
                        isStreaming={isStreaming}
                        citationSources={citationSourcesFromEvidence(message.evidence || [])}
                        onLinkPreview={onLinkPreview}
                        onCitationJump={(source) => {
                          const evidence = evidenceByCitationId(message.evidence || []).get(source.sourceId);
                          if (evidence) onOpenSource(evidence);
            }}
          />
        </div>
      ) : null}
      {isStreaming ? (
        <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-full bg-gray-900" />
      ) : null}
    </div>
  );
}

export default function LearningTerminal({
  workspaceId,
  sessionId,
  workbenchId,
  workspaceName,
  workbenches,
  messages,
  onMessagesChange,
  onChatStarted,
  onUploadMaterials,
  onWorkbenchCreated,
  onRefresh,
  variant = 'full',
  initialPrompt,
  onInitialPromptConsumed,
  mode = 'chat',
  selectedSources = [],
  chatFiles = [],
  sourceFiles = [],
  onModeChange,
  onSelectedSourcesChange,
  onChatFilesChange,
  onUploadChatFiles,
  hasMoreMessages = false,
  loadingEarlierMessages = false,
  initialCheckpointThreadId,
  onLoadEarlierMessages,
  onCheckpointThreadIdChange,
  resourcePreview: controlledResourcePreview,
  onResourcePreviewChange
}: LearningTerminalProps) {
  const [input, setInput] = useState('');
  const [goalDraft, setGoalDraft] = useState<LearningGoalDraft | null>(null);
  const [savedInlineMemory, setSavedInlineMemory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checkpointThreadId, setCheckpointThreadId] = useState<string | undefined>(initialCheckpointThreadId);
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const [approvingActionId, setApprovingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingMessageIndex, setStreamingMessageIndex] = useState<number | null>(null);
  const [sourceModalSource, setSourceModalSource] = useState<TerminalEvidence | null>(null);
  const [internalResourcePreview, setInternalResourcePreview] = useState<TerminalResourcePreview | null>(null);
  const [uploadingChatFiles, setUploadingChatFiles] = useState(false);
  const [workingSeconds, setWorkingSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const resourcePreview = controlledResourcePreview !== undefined ? controlledResourcePreview : internalResourcePreview;
  const setResourcePreview = onResourcePreviewChange || setInternalResourcePreview;
  const preserveScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const sentInitialPromptRef = useRef<string | null>(null);
  const isChatMode = mode === 'chat';

  useEffect(() => {
    if (!initialPrompt) return;
    if (messages.length > 0) {
      onInitialPromptConsumed?.();
      return;
    }
    if (sentInitialPromptRef.current === initialPrompt) return;
    sentInitialPromptRef.current = initialPrompt;
    void sendMessage(initialPrompt);
    onInitialPromptConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, messages.length, onInitialPromptConsumed]);

  useEffect(() => {
    if (mode !== 'agentic') {
      setGoalDraft(null);
    }
  }, [mode]);

  useEffect(() => {
    if (!loading) {
      setWorkingSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setWorkingSeconds(0);
    const timer = window.setInterval(() => {
      setWorkingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    const preserved = preserveScrollRef.current;
    const scroller = messageScrollRef.current;
    if (preserved && scroller) {
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight - preserved.scrollHeight + preserved.scrollTop;
        preserveScrollRef.current = null;
      });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content, loading]);

  useEffect(() => {
    setCheckpointThreadId(initialCheckpointThreadId);
  }, [initialCheckpointThreadId]);

  const rememberCheckpointThreadId = (value?: string) => {
    if (!value) return;
    setCheckpointThreadId(value);
    onCheckpointThreadIdChange?.(value);
  };

  const loadEarlierMessages = async () => {
    if (!hasMoreMessages || loadingEarlierMessages || !onLoadEarlierMessages) return;
    const scroller = messageScrollRef.current;
    if (scroller) {
      preserveScrollRef.current = {
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop
      };
    }
    await onLoadEarlierMessages();
  };

  const handleMessageScroll = () => {
    const scroller = messageScrollRef.current;
    if (!scroller || scroller.scrollTop > 80) return;
    void loadEarlierMessages();
  };

  const latestWorkbench = workbenches[0];
  const overviewText = useMemo(() => {
    if (workbenches.length === 0) {
      return '还没有学习现场，可以先从一个明确目标开始。';
    }

    return `最近学习现场：${latestWorkbench.title}`;
  }, [latestWorkbench, workbenches.length]);

  const readyChatFiles = useMemo(
    () => chatFiles.filter((file) => file.status !== 'uploading' && file.status !== 'error'),
    [chatFiles]
  );

  const uploadChatFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length || !onUploadChatFiles || uploadingChatFiles) return;
    setUploadingChatFiles(true);
    setError(null);
    try {
      await onUploadChatFiles(selected);
    } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || '上传聊天附件失败');
    } finally {
      setUploadingChatFiles(false);
    }
  };

  const removeChatFile = (fileId: string) => {
    onChatFilesChange?.(chatFiles.filter((file) => file.id !== fileId));
  };

  const sendMessage = async (preset?: string) => {
    const messageFiles = readyChatFiles.map((file) => ({ ...file }));
    const content = (preset ?? input).trim() || (messageFiles.length ? '请分析这些附件。' : '');
    if (!content || loading) return;

    if (messages.length === 0) {
      onChatStarted(content);
    }

    const nextMessages: LearningTerminalMessage[] = [...messages, { role: 'user', content, files: messageFiles }];
    onMessagesChange(nextMessages);
    setInput('');
    setError(null);
    setAgentProgress(isChatMode ? '正在检索 workspace 资料...' : mode === 'new_agentic' ? '正在启动 Agent V2 循环...' : '正在启动 Agent V2...');
    setStreamingMessageIndex(null);
    setLoading(true);

    let streamedReply = '';
    let statusHistory: TerminalStatus[] = [];
    let agentEvents: AgentUiEvent[] = [];

    try {
      const assistantIndex = nextMessages.length;

      const upsertStreamingAssistant = (content: string) => {
        const assistantMessage: LearningTerminalMessage = {
          role: 'assistant',
          content,
          mode,
          statusHistory,
          agentEvents
        };
        onMessagesChange([
          ...nextMessages,
          assistantMessage
        ]);
        setStreamingMessageIndex(assistantIndex);
      };

      const response = await learningApi.chatTerminalStream(workspaceId, nextMessages, {
        sessionId,
        workbenchId,
        checkpointThreadId,
        mode,
        selectedSources: selectedSources.map((source) => ({
          fileId: source.fileId,
          mode: source.mode === 'full_context' ? 'full_context' : 'focused'
        })),
        chatFiles: messageFiles,
        onEvent: (event, data) => {
          if (data?.message) setAgentProgress(String(data.message));
          if (data?.result?.checkpointThreadId) rememberCheckpointThreadId(data.result.checkpointThreadId);
          if (event === 'say' && data?.say) {
            const say = data.say as { id?: string; at?: string; phase?: 'interim' | 'final'; node?: string; content?: string; delta?: string };
            const sayNode = say.node || data.node;
            const isAnswerSay = sayNode === 'ResponseComposer';
            const content = isAnswerSay
              ? typeof say.content === 'string'
                ? say.content
                : typeof say.delta === 'string'
                  ? `${streamedReply}${say.delta}`
                  : streamedReply
              : typeof say.content === 'string'
                ? say.content
                : typeof say.delta === 'string'
                  ? say.delta
                  : '';
            if (isAnswerSay) {
              streamedReply = content;
            }
            if (content.trim()) {
              const eventId = say.id || 'say';
              const existingIndex = agentEvents.findIndex((item) =>
                item.kind === 'say' && (item.id === eventId || item.node === sayNode)
              );
              const sayEvent: AgentUiEvent = {
                id: eventId,
                kind: 'say',
                at: say.at || new Date().toISOString(),
                phase: say.phase || 'interim',
                node: sayNode,
                content
              };
              agentEvents = existingIndex >= 0
                ? [
                    ...agentEvents.slice(0, existingIndex),
                    sayEvent,
                    ...agentEvents.slice(existingIndex + 1)
                  ].slice(-120)
                : [
                    ...agentEvents,
                    sayEvent
                  ].slice(-120);
            }
            setAgentProgress('正在处理下一步');
            upsertStreamingAssistant(streamedReply);
          }
          if (event === 'ui_event' && data?.uiEvent) {
            const uiEvent = normalizedAgentEvent(data.uiEvent as AgentUiEvent);
            if (mode === 'new_agentic' && uiEvent.kind === 'say') {
              upsertStreamingAssistant(streamedReply);
              return;
            }
            const lastEvent = agentEvents[agentEvents.length - 1];
            if (
              uiEvent.kind === 'say' &&
              uiEvent.phase === 'interim' &&
              lastEvent?.kind === 'say' &&
              lastEvent.phase === 'interim' &&
              lastEvent.node === uiEvent.node
            ) {
              const content = uiEvent.content.startsWith(lastEvent.content)
                ? uiEvent.content
                : `${lastEvent.content}${uiEvent.content}`;
              agentEvents = [...agentEvents.slice(0, -1), { ...lastEvent, content, at: uiEvent.at }].slice(-80);
            } else {
              agentEvents = [...agentEvents, uiEvent].slice(-120);
            }
            if (uiEvent.kind === 'activity') setAgentProgress(uiEvent.detail || uiEvent.title);
            if (uiEvent.kind === 'say') setAgentProgress('正在处理下一步');
            if (uiEvent.kind === 'artifact') setAgentProgress(`已生成 ${uiEvent.artifactType}：${uiEvent.title}`);
            upsertStreamingAssistant(streamedReply);
          }
          const status = event === 'status' ? data?.status || data?.data : null;
          if (status?.action) {
            statusHistory = [...statusHistory, status as TerminalStatus];
            const activityEvent: AgentUiEvent = {
              id: `status-${Date.now()}-${agentEvents.length}`,
              kind: 'activity',
              at: new Date().toISOString(),
              status: status.done === false ? 'running' : 'done',
              node: data?.node,
              title: statusDescription(status as TerminalStatus),
              detail: statusDescription(status as TerminalStatus)
            };
            agentEvents = [
              ...agentEvents,
              normalizedAgentEvent(activityEvent)
            ].slice(-120);
            setAgentProgress(statusDescription(status as TerminalStatus));
            upsertStreamingAssistant(streamedReply);
          }
          const delta = event === 'delta' || event === 'token'
            ? typeof data === 'string'
              ? data
              : typeof data?.delta === 'string'
                ? data.delta
                : ''
            : '';
          if (delta) {
            streamedReply += delta;
            upsertStreamingAssistant(streamedReply);
          }
        }
      });
      if (!response) throw new Error('AI Chat 流在没有最终结果时结束了');
      rememberCheckpointThreadId(response.checkpointThreadId);
      setGoalDraft(response.goalDraft ?? null);
      setStreamingMessageIndex(null);
      onMessagesChange([
        ...nextMessages,
        {
          role: 'assistant',
          content: response.reply || streamedReply,
          sessionTitle: response.sessionTitle,
          mode,
          agentEvents: response.agentEvents || agentEvents,
          statusHistory,
          goalDraft: response.goalDraft,
          proposedActions: response.proposedActions,
          executedActions: response.executedActions,
          agentTrace: response.agentTrace,
          evidence: response.evidence,
          followUps: response.followUps,
          askUserToSave: response.memoryContext?.askUserToSave || null
        }
      ]);
    } catch (chatError: any) {
      if (streamedReply.trim()) {
        setStreamingMessageIndex(null);
        setError(chatError?.message || 'AI Chat 流在元数据完成前结束了');
        onMessagesChange([
          ...nextMessages,
          {
            role: 'assistant',
            content: streamedReply,
            mode,
            agentEvents,
            statusHistory
          }
        ]);
        return;
      }
      try {
        setStreamingMessageIndex(null);
        const response = await learningApi.chatTerminal(workspaceId, nextMessages, {
          sessionId,
          workbenchId,
          checkpointThreadId,
          mode,
          selectedSources: selectedSources.map((source) => ({
            fileId: source.fileId,
            mode: source.mode === 'full_context' ? 'full_context' : 'focused'
          })),
          chatFiles: messageFiles
        });
        rememberCheckpointThreadId(response.checkpointThreadId);
        setGoalDraft(response.goalDraft ?? null);
        onMessagesChange([
          ...nextMessages,
          {
            role: 'assistant',
            content: response.reply,
            sessionTitle: response.sessionTitle,
            mode,
            agentEvents: agentEvents.length ? agentEvents : response.agentEvents,
            statusHistory,
            goalDraft: response.goalDraft,
            proposedActions: response.proposedActions,
            executedActions: response.executedActions,
            agentTrace: response.agentTrace,
            evidence: response.evidence,
            followUps: response.followUps,
            askUserToSave: response.memoryContext?.askUserToSave || null
          }
        ]);
      } catch (fallbackError: any) {
      setError(fallbackError?.response?.data?.error || fallbackError?.message || chatError?.message || 'AI Chat 请求失败');
      }
    } finally {
      setLoading(false);
      setAgentProgress(null);
    }
  };

  const handleProposalDecision = async (
    messageIndex: number,
    actionId: string,
    decision: 'approve' | 'reject'
  ) => {
    if (!checkpointThreadId || approvingActionId) return;
    setApprovingActionId(actionId);
    setError(null);
    try {
      const response = await learningApi.approveTerminalAction({
        workspaceId,
        workbenchId,
        sessionId,
        checkpointThreadId,
        mode,
        messages,
        decision: {
          decision,
          actionIds: [actionId]
        }
      });
      rememberCheckpointThreadId(response.checkpointThreadId);
      const nextMessages = messages.map((message, index) =>
        index === messageIndex
          ? {
              ...message,
              content: response.reply,
              mode,
              agentEvents: response.agentEvents || message.agentEvents,
              proposedActions: response.proposedActions,
              executedActions: response.executedActions,
              agentTrace: response.agentTrace,
              evidence: response.evidence,
              followUps: response.followUps,
              goalDraft: response.goalDraft || message.goalDraft,
              askUserToSave: response.memoryContext?.askUserToSave || message.askUserToSave
            }
          : message
      );
      onMessagesChange(nextMessages);
      const createdWorkbenchId = response.executedActions
        ?.map((action) => action.result?.workbenchId)
        .find((id): id is string => typeof id === 'string');
      const savedPlanId = response.executedActions
        ?.map((action) => action.result?.planId)
        .find((id): id is string => typeof id === 'string');
      if (savedPlanId) {
        window.dispatchEvent(new CustomEvent('learning-plan-saved', {
          detail: { workspaceId, planId: savedPlanId }
        }));
        await onRefresh();
      }
      if (createdWorkbenchId) {
        await onRefresh();
        onWorkbenchCreated(createdWorkbenchId);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '审批操作失败');
    } finally {
      setApprovingActionId(null);
    }
  };

  const saveInlineMemory = async (candidate: NonNullable<LearningTerminalMessage['askUserToSave']>) => {
    const text = candidate.candidate?.text || candidate.text;
    if (!text) return;
    try {
      await learningApi.createSavedMemory({
        workspaceId,
        workbenchId,
        text,
        category: candidate.candidate?.category
      });
      setSavedInlineMemory(text);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '保存长期偏好失败');
    }
  };

  const createGuidedWorkbench = async () => {
    const draft = goalDraft;
    const fallbackGoal = input.trim() || '建立一个新的启发式学习目标';
    setCreating(true);
    setError(null);

    try {
      const result = await learningApi.createGuidedWorkbench({
        workspaceId,
        goalText: draft?.goalText || fallbackGoal,
        title: draft?.title,
        mode: draft?.suggestedMode,
        goalDraft: draft || undefined
      });
      await onRefresh();
      onWorkbenchCreated(result.workbench.id);
    } catch (createError: any) {
      setError(createError?.response?.data?.error || createError?.message || '创建 workbench 失败');
    } finally {
      setCreating(false);
    }
  };

  const renderAssistantPanels = (message: LearningTerminalMessage, index: number) => (
    <>
      {message.askUserToSave && savedInlineMemory !== (message.askUserToSave.candidate?.text || message.askUserToSave.text) ? (
        <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-gray-800">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Brain className="h-3.5 w-3.5 text-gray-700" />
            是否保存为长期偏好？
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">{message.askUserToSave.text}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void saveInlineMemory(message.askUserToSave!)}
              className="inline-flex h-7 items-center rounded-full bg-black px-3 text-xs font-medium text-white transition hover:bg-gray-900"
            >
              保存
            </button>
            <button
              onClick={() => {
                setSavedInlineMemory(message.askUserToSave?.candidate?.text || message.askUserToSave?.text || '');
              }}
              className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-gray-500 transition hover:bg-gray-100"
            >
              不用
            </button>
          </div>
        </div>
      ) : null}
      {message.proposedActions?.length ? (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-100 p-3 text-gray-800">
          <p className="text-xs font-semibold text-gray-800">建议操作</p>
          <div className="mt-2 space-y-2">
            {message.proposedActions.slice(0, 4).map((action) => {
              const plan = planFromProposal(action);
              return (
                <div key={action.id} className="rounded-xl bg-white p-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900">{action.title}</span>
                    <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      {action.risk}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-600">{action.description}</p>
                  {plan ? <ProposalPlanPreview plan={plan} /> : null}
                  {action.changeSet?.items?.length ? (
                    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-100 p-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">预览</p>
                      <div className="mt-1 space-y-1">
                        {action.changeSet.items.slice(0, 4).map((item) => (
                          <div key={item.id} className="text-xs leading-5 text-gray-700">
                            <span className="font-medium">{item.operation}</span>
                            <span className="text-gray-500"> · </span>
                            <span>{item.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {action.artifacts?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {action.artifacts.slice(0, 4).map((artifact) => (
                        <span
                          key={artifact.id}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600"
                          title={artifact.summary}
                        >
                          {artifact.kind}: {artifact.title}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {checkpointThreadId && !message.executedActions?.some((item) => item.proposalId === action.id) ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleProposalDecision(index, action.id, 'approve')}
                        disabled={Boolean(approvingActionId)}
                        className="inline-flex h-7 items-center rounded-full bg-black px-3 text-xs font-medium text-white transition hover:bg-gray-900 disabled:opacity-50"
                      >
                        {approvingActionId === action.id ? '执行中' : '批准'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleProposalDecision(index, action.id, 'reject')}
                        disabled={Boolean(approvingActionId)}
                        className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {message.executedActions?.length ? (
        <div
          className="mt-4 rounded-2xl border p-3 text-xs"
          style={{
            backgroundColor: message.executedActions.some((action) => !action.success) ? terminalTone.redBg : terminalTone.greenBg,
            borderColor: message.executedActions.some((action) => !action.success) ? terminalTone.redBg : terminalTone.greenBg,
            color: message.executedActions.some((action) => !action.success) ? terminalTone.redText : terminalTone.greenText
          }}
        >
          <p className="font-semibold">已执行操作</p>
          <div className="mt-2 space-y-1">
            {message.executedActions.map((action) => (
              <div key={action.id} className="leading-5">
                <div>{action.success ? '完成' : '失败'} · {action.summary}</div>
                {action.result?.planId ? (
                  <div className="mt-1 font-medium">
                    已保存为 workspace 级计划 · {String(action.result.planId)}
                  </div>
                ) : null}
                {action.success && action.result?.studioCard ? (
                  <StudioArtifactCard workspaceId={workspaceId} action={action} onOpenPreview={setResourcePreview} />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {message.agentTrace?.length && !message.agentEvents?.length ? (
        <details className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
          <summary className="cursor-pointer select-none font-semibold text-gray-800">
            Agent 轨迹
          </summary>
          <div className="mt-3">
            <p className="mb-1 font-medium text-gray-500">轨迹</p>
            <div className="space-y-1">
              {message.agentTrace.slice(-8).map((item) => (
                <div key={item.id} className="leading-5">
                  <span className="font-medium text-gray-800">{item.node}</span>
                  <span className="text-gray-400"> · </span>
                  <span>{item.summary}</span>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </>
  );

  const isDashboard = variant === 'dashboard';
  const openLinkPreview = (link: { href: string; title?: string; text?: string }) => {
    const href = String(link.href || '').trim();
    if (!href) return;
    setResourcePreview({
      id: `url-${href}`,
      title: link.text?.trim() || link.title?.trim() || titleFromUrl(href),
      subtitle: href,
      kind: 'web',
      url: href
    });
  };

  return (
    <section className={`workspace-terminal font-primary mx-auto flex w-full flex-col overflow-hidden bg-white text-gray-900 ${
      isDashboard ? 'min-h-[520px] max-w-none px-0 pb-0 pt-0' : 'h-full min-h-0 px-0 pb-0 pt-0'
    }`}>
      <div className={`mx-auto flex min-h-0 w-full flex-1 ${isDashboard ? 'max-w-none flex-col' : 'max-w-none flex-row'}`}>
        <div className={`flex min-h-0 flex-1 flex-col transition-[max-width] duration-200 ${
          isDashboard ? 'w-full' : 'max-w-none'
        }`}>
          <div className={`mx-auto flex min-h-0 w-full flex-1 flex-col ${isDashboard ? 'max-w-none' : 'max-w-6xl'}`}>
        {messages.length > 0 && (
        <div
          ref={messageScrollRef}
          onScroll={handleMessageScroll}
          className={`scrollbar-hidden min-h-0 flex-1 space-y-2 overflow-y-auto ${isDashboard ? 'px-0' : 'px-4 pt-7 md:px-6'}`}
        >
          {hasMoreMessages ? (
            <div className="mx-auto flex w-full max-w-5xl justify-center pb-3">
              <button
                type="button"
                onClick={() => void loadEarlierMessages()}
                disabled={loadingEarlierMessages}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-gray-100 bg-white px-3 text-xs font-medium text-gray-500 shadow-sm transition hover:bg-gray-50 hover:text-gray-800 disabled:opacity-60"
              >
                {loadingEarlierMessages ? <Loader2 className="size-3.5 animate-spin" /> : null}
                加载更早消息
              </button>
            </div>
          ) : null}
          {messages.map((message, index) => {
            const resourceCards = message.role === 'assistant'
              ? resourceDiscoveryCardsFromEvidence(message.evidence || [], message.content)
              : [];
            const resourceCardsLoading = message.role === 'assistant'
              && streamingMessageIndex === index
              && !resourceCards.length
              && hasWebResourceDiscoverySignal(message);

            return (
            <div
              key={`${message.role}-${index}`}
              className={`workspace-message group mx-auto flex w-full max-w-5xl px-0 py-2 text-sm ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
              style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }}
            >
              <div
                className={`min-w-0 ${
                  message.role === 'user'
                    ? 'max-w-[90%] rounded-3xl bg-gray-50 px-4 py-1.5 text-gray-900'
                    : 'flex w-full min-w-0 gap-3 pl-1 text-gray-900'
                }`}
              >
                {message.role === 'assistant' ? (
                  <>
                    <div className="mt-1 hidden size-8 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-white text-[11px] font-semibold text-gray-900 shadow-sm @lg:flex md:flex">
                      SL
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="self-center font-semibold line-clamp-1 flex gap-1 items-center text-sm leading-6 text-black">
                        <span className="line-clamp-1">
                          {message.mode === 'new_agentic' || message.mode === 'agentic' ? 'Agent V2' : 'AI Chat'}
                        </span>
                      </div>
                      {streamingMessageIndex === index ? (
                        <div className="mb-4 flex min-w-0 items-center gap-2 text-sm font-medium text-gray-400">
                          <div className="flex h-5 items-center gap-1">
                            <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-160ms]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-80ms]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-gray-400" />
                          </div>
                          <span>已处理 {formatWorkingTime(workingSeconds)}</span>
                          {agentProgress ? <span className="min-w-0 truncate text-gray-400">· {agentProgress}</span> : null}
                        </div>
                      ) : null}
                      {message.mode === 'new_agentic' ? null : message.agentEvents?.length ? (
                        <InlineAgentUpdates events={message.agentEvents} isStreaming={streamingMessageIndex === index} />
                      ) : (
                        <StatusHistory statusHistory={message.statusHistory} />
                      )}
                      {message.mode === 'new_agentic' ? (
                        <AgentTimeline
                          message={message}
                          isStreaming={streamingMessageIndex === index}
                          onOpenSource={setSourceModalSource}
                          onLinkPreview={openLinkPreview}
                          resourceCards={resourceCards}
                          resourceCardsLoading={resourceCardsLoading}
                        />
                      ) : (
                        <>
                          <ResourceDiscoveryCards
                            cards={resourceCards}
                            loading={resourceCardsLoading}
                            onOpen={(card) => openLinkPreview({ href: card.url, text: card.title, title: card.title })}
                          />
                          <div className="chat-assistant markdown-prose w-full min-w-full">
                            <OpenWebUIMarkdownPreview
                              content={message.content}
                              emptyMessage=""
                              isStreaming={streamingMessageIndex === index}
                              citationSources={citationSourcesFromEvidence(message.evidence || [])}
                              onLinkPreview={openLinkPreview}
                              onCitationJump={(source) => {
                                const evidence = evidenceByCitationId(message.evidence || []).get(source.sourceId);
                                if (evidence) setSourceModalSource(evidence);
                              }}
                            />
                            {streamingMessageIndex === index ? (
                              <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-full bg-gray-900" />
                            ) : null}
                          </div>
                        </>
                      )}
                      {message.evidence?.length ? (
                        <SourcesCapsule sources={message.evidence} onOpenSource={setSourceModalSource} />
                      ) : null}
                      {message.followUps?.length && index === messages.length - 1 && streamingMessageIndex !== index ? (
                        <FollowUps followUps={message.followUps} onClick={(followUp) => void sendMessage(followUp)} />
                      ) : null}
                      {renderAssistantPanels(message, index)}
                    </div>
                  </>
                ) : (
                  <div>
                    {message.files?.length ? (
                      <div className="mb-2 flex max-w-full flex-wrap justify-end gap-1.5">
                        {message.files.slice(0, 6).map((file) => (
                          <span
                            key={file.id}
                            className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600"
                            title={file.name}
                          >
                            {fileIsImage(file) ? <Image className="size-3" /> : <Paperclip className="size-3" />}
                            <span className="truncate">{file.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="whitespace-pre-wrap text-[15px] leading-6">{message.content}</div>
                  </div>
                )}
              </div>
            </div>
          );
          })}

          {goalDraft && (
            <div className="workspace-card-in mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Target className="h-4 w-4 text-gray-700" />
                  <h3 className="truncate text-sm font-semibold text-gray-900">{goalDraft.title}</h3>
                </div>
                <button
                  onClick={() => void createGuidedWorkbench()}
                  disabled={creating}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-black px-3 text-sm font-medium text-white transition hover:bg-gray-900 disabled:opacity-60"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  创建学习现场
                </button>
              </div>
              <p className="text-sm leading-6 text-gray-600">{goalDraft.goalText}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-400">技能拆解</p>
                  <div className="space-y-1.5">
                    {goalDraft.skills.map((skill) => (
                      <div key={skill} className="flex items-center gap-2 text-sm text-gray-700">
                        <CheckCircle2 className="h-4 w-4" style={{ color: terminalTone.greenText }} />
                        <span>{skill}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-400">初始短板</p>
                  <div className="space-y-1.5">
                    {goalDraft.weaknesses.map((weakness) => (
                      <div key={weakness} className="text-sm text-gray-600">
                        {weakness}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        )}

        <div className={`w-full bg-white ${
          messages.length > 0 && !isDashboard
            ? 'shrink-0 sticky bottom-0 mt-6 pt-4'
            : messages.length > 0
              ? 'shrink-0 mt-5'
              : 'min-h-0 flex-1 overflow-y-auto py-8'
        } ${isDashboard ? 'pb-0' : 'pb-3'}`}>
          <div className={`mx-auto w-full ${messages.length === 0 ? 'max-w-5xl px-4 md:px-6' : 'max-w-6xl px-2.5'}`}>
            {messages.length === 0 ? (
              <div className="workspace-hero mx-auto mb-7 w-full text-center">
                <div className="mb-5 text-3xl font-medium leading-tight text-gray-700">
                  今天想让我帮你做什么？
                </div>
                <p className="mx-auto max-w-2xl text-sm leading-6 text-gray-500">
                  {isDashboard
                    ? `${overviewText} 你可以直接让 AI 汇总进度、整理材料或创建新的学习现场。`
                    : `${overviewText} 你可以向 AI Chat 询问 ${workspaceName}。`}
                </p>
              </div>
            ) : null}

            {error && <p className="mx-auto mb-2 max-w-5xl px-3 text-sm" style={{ color: terminalTone.redText }}>{error}</p>}

            <div className="mx-auto w-full max-w-5xl">
            <TerminalComposer
              value={input}
              onValueChange={setInput}
              onSubmit={() => void sendMessage()}
              placeholder="发送消息"
              mode={mode}
              onModeChange={onModeChange}
              selectedSources={selectedSources.map((source) => ({
                fileId: source.fileId,
                mode: source.mode === 'full_context' ? 'full_context' : 'focused'
              }))}
              onSelectedSourcesChange={onSelectedSourcesChange}
              sourceFiles={sourceFiles}
              chatFiles={chatFiles}
              onRemoveChatFile={removeChatFile}
              onUploadChatFiles={uploadChatFiles}
              uploadingChatFiles={uploadingChatFiles}
              onUploadMaterials={onUploadMaterials}
              submitting={loading}
            />
            </div>

          {messages.length === 0 && !isChatMode && (
              <div className="mx-auto mt-5 max-w-2xl px-1 font-primary">
                <div className="grid gap-2 sm:grid-cols-2">
                  {starterPrompts.map((prompt, index) => (
                    <button
                      key={prompt}
                      onClick={() => void sendMessage(prompt)}
                      className="workspace-suggestion block min-h-[70px] w-full rounded-2xl border border-gray-100 px-3 py-2.5 text-left transition hover:bg-gray-50"
                      style={{ animationDelay: `${index * 70 + 120}ms` }}
                    >
                      <span className="block truncate text-sm font-medium text-gray-700">{prompt}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-gray-500">
                        {getStarterDescription(index)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
          </div>
        </div>
      </div>
      {resourcePreview && (!onResourcePreviewChange || isDashboard) ? (
        <div className={`${isDashboard ? 'fixed inset-0 z-[80]' : 'fixed inset-x-0 bottom-0 z-[80] h-[82vh] xl:hidden'} bg-white`}>
          <TerminalResourcePreviewPanel
            workspaceId={workspaceId}
            workbenchId={workbenchId}
            preview={resourcePreview}
            onClose={() => setResourcePreview(null)}
          />
        </div>
      ) : null}
      <SourceDetailModal source={sourceModalSource} onClose={() => setSourceModalSource(null)} />
    </section>
  );
}
