import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  FolderUp,
  Image,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Square,
  Target,
  Wand2,
  X
} from 'lucide-react';
import { LearningGoalDraft, LearningTerminalMessage, TerminalChatFile, WorkbenchItem } from '../../types';
import { learningApi } from '../../services/learningApi';
import OpenWebUIMarkdownPreview, { OpenWebUICitationSource } from '../workbench/OpenWebUIMarkdownPreview';

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
  onCreateWorkbench: () => void;
  onWorkbenchCreated: (workbenchId: string) => void;
  onRefresh: () => Promise<void> | void;
  variant?: 'full' | 'dashboard';
  initialPrompt?: string;
  mode?: 'chat' | 'agentic';
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
  onModeChange?: (mode: 'chat' | 'agentic') => void;
  onSelectedSourcesChange?: (sources: Array<{ fileId: string; mode: 'focused' | 'full_context' }>) => void;
  onChatFilesChange?: (files: TerminalChatFile[]) => void;
  onUploadChatFiles?: (files: File[]) => Promise<TerminalChatFile[]>;
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

const formatBytes = (bytes?: number) => {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
};

const sourceStatusToneClass = (tone?: 'ready' | 'indexing' | 'degraded' | 'failed' | 'empty') => {
  if (tone === 'ready') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'degraded') return 'bg-amber-50 text-amber-700';
  if (tone === 'indexing') return 'bg-blue-50 text-blue-700';
  if (tone === 'failed') return 'bg-red-50 text-red-700';
  return 'bg-gray-100 text-gray-600';
};

const fileIsImage = (file: Pick<TerminalChatFile, 'mimeType' | 'extension' | 'name'>) => {
  const mimeType = (file.mimeType || '').toLowerCase();
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  return mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension);
};

type TerminalEvidence = NonNullable<LearningTerminalMessage['evidence']>[number];
type TerminalStatus = NonNullable<LearningTerminalMessage['statusHistory']>[number];

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
    <div className="mt-3 rounded-xl border border-amber-100 bg-white/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-amber-800">Plan preview</p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">{planTitle(plan)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
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
                  <p className="line-clamp-1 text-[11px] text-gray-400">Evidence: {step.evidence.slice(0, 3).join(', ')}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-gray-500">No structured steps were returned with this proposal.</p>
      )}
      {steps.length > 6 ? <p className="mt-2 text-[11px] text-gray-400">+ {steps.length - 6} more steps in Planning after saving.</p> : null}
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

  return (
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
            aria-label="Close citation modal"
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
                      Content
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
              <div className="text-sm text-gray-500">No preview available.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
          aria-label={sources.length === 1 ? 'Toggle 1 source' : `Toggle ${sources.length} sources`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <div>{sources.length === 1 ? '1 Source' : `${sources.length} Sources`}</div>
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
      <div className="text-sm font-medium">Follow up</div>
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
  if (status.action === 'knowledge_search') return `Searching Knowledge for "${status.query || ''}"`;
  if (status.action === 'queries_generated') return 'Querying';
  if (status.action === 'sources_retrieved') {
    if (status.count === 0) return 'No sources found';
    if (status.count === 1) return 'Retrieved 1 source';
    return `Retrieved ${status.count || 0} sources`;
  }
  if (status.action === 'thinking') return 'Thinking';
  return status.description || status.action;
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
        aria-label="Toggle status history"
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
  onCreateWorkbench,
  onWorkbenchCreated,
  onRefresh,
  variant = 'full',
  initialPrompt,
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
  onCheckpointThreadIdChange
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
  const [uploadingChatFiles, setUploadingChatFiles] = useState(false);
  const [workingSeconds, setWorkingSeconds] = useState(0);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const preserveScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const sentInitialPromptRef = useRef<string | null>(null);
  const isChatMode = mode === 'chat';

  useEffect(() => {
    if (!initialPrompt) return;
    if (sentInitialPromptRef.current === initialPrompt) return;
    sentInitialPromptRef.current = initialPrompt;
    void sendMessage(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  useEffect(() => {
    setSourceMenuOpen(false);
    if (mode === 'chat') {
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

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (sourceMenuRef.current?.contains(target)) return;
      setSourceMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const latestWorkbench = workbenches[0];
  const overviewText = useMemo(() => {
    if (workbenches.length === 0) {
      return '还没有学习现场，可以先从一个明确目标开始。';
    }

    return `最近学习现场：${latestWorkbench.title}`;
  }, [latestWorkbench, workbenches.length]);

  const activeSources = useMemo(
    () => sourceFiles.filter((file) => selectedSources.some((source) => source.fileId === file.id)),
    [selectedSources, sourceFiles]
  );

  const readyChatFiles = useMemo(
    () => chatFiles.filter((file) => file.status !== 'uploading' && file.status !== 'error'),
    [chatFiles]
  );

  const selectedSourceModeById = useMemo(
    () => new Map(selectedSources.map((source) => [source.fileId, source.mode || 'focused'] as const)),
    [selectedSources]
  );

  const toggleSourceId = (sourceId: string) => {
    const next = selectedSources.some((source) => source.fileId === sourceId)
      ? selectedSources.filter((source) => source.fileId !== sourceId)
      : [...selectedSources, { fileId: sourceId, mode: 'focused' as const }];
    onSelectedSourcesChange?.(next.slice(0, 12).map((source) => ({
      fileId: source.fileId,
      mode: source.mode === 'full_context' ? 'full_context' : 'focused'
    })));
  };

  const updateSourceMode = (sourceId: string, nextMode: 'focused' | 'full_context') => {
    onSelectedSourcesChange?.(selectedSources.map((source) =>
      source.fileId === sourceId
        ? { fileId: source.fileId, mode: nextMode }
        : { fileId: source.fileId, mode: source.mode === 'full_context' ? 'full_context' : 'focused' }
    ));
  };

  const uploadChatFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length || !onUploadChatFiles || uploadingChatFiles) return;
    setUploadingChatFiles(true);
    setError(null);
    try {
      await onUploadChatFiles(selected);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '上传 Chat 附件失败');
    } finally {
      setUploadingChatFiles(false);
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
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
    setAgentProgress(isChatMode ? 'Retrieving workspace sources...' : 'Starting Workspace Agent graph...');
    setStreamingMessageIndex(null);
    setLoading(true);

    let streamedReply = '';
    let statusHistory: TerminalStatus[] = [];

    try {
      const assistantIndex = nextMessages.length;

      const upsertStreamingAssistant = (content: string) => {
        const assistantMessage: LearningTerminalMessage = {
          role: 'assistant',
          content,
          mode,
          statusHistory
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
        selectedSources: isChatMode ? selectedSources.map((source) => ({
          fileId: source.fileId,
          mode: source.mode === 'full_context' ? 'full_context' : 'focused'
        })) : undefined,
        chatFiles: messageFiles,
        onEvent: (event, data) => {
          if (data?.message) setAgentProgress(String(data.message));
          if (data?.result?.checkpointThreadId) rememberCheckpointThreadId(data.result.checkpointThreadId);
          const status = event === 'status' ? data?.status || data?.data : null;
          if (status?.action) {
            statusHistory = [...statusHistory, status as TerminalStatus];
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
      if (!response) throw new Error('AI Terminal stream ended without a final result');
      rememberCheckpointThreadId(response.checkpointThreadId);
      setGoalDraft(response.goalDraft ?? null);
      setStreamingMessageIndex(null);
      onMessagesChange([
        ...nextMessages,
        {
          role: 'assistant',
          content: response.reply || streamedReply,
          mode,
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
        setError(chatError?.message || 'AI Terminal stream ended before metadata was finalized');
        onMessagesChange([
          ...nextMessages,
          {
            role: 'assistant',
            content: streamedReply,
            mode,
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
          selectedSources: isChatMode ? selectedSources.map((source) => ({
            fileId: source.fileId,
            mode: source.mode === 'full_context' ? 'full_context' : 'focused'
          })) : undefined,
          chatFiles: messageFiles
        });
        rememberCheckpointThreadId(response.checkpointThreadId);
        setGoalDraft(response.goalDraft ?? null);
        onMessagesChange([
          ...nextMessages,
          {
            role: 'assistant',
            content: response.reply,
            mode,
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
        setError(fallbackError?.response?.data?.error || fallbackError?.message || chatError?.message || 'AI Terminal request failed');
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
              proposedActions: response.proposedActions,
              executedActions: response.executedActions,
              agentTrace: response.agentTrace,
              evidence: response.evidence,
              followUps: response.followUps,
              goalDraft: response.goalDraft || message.goalDraft
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
      setError(createError?.response?.data?.error || createError?.message || 'Failed to create workbench');
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
        <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/60 p-3 text-gray-800">
          <p className="text-xs font-semibold text-amber-900">Proposed actions</p>
          <div className="mt-2 space-y-2">
            {message.proposedActions.slice(0, 4).map((action) => {
              const plan = planFromProposal(action);
              return (
                <div key={action.id} className="rounded-xl bg-white/70 p-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900">{action.title}</span>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {action.risk}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-600">{action.description}</p>
                  {plan ? <ProposalPlanPreview plan={plan} /> : null}
                  {checkpointThreadId && !message.executedActions?.some((item) => item.proposalId === action.id) ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleProposalDecision(index, action.id, 'approve')}
                        disabled={Boolean(approvingActionId)}
                        className="inline-flex h-7 items-center rounded-full bg-black px-3 text-xs font-medium text-white transition hover:bg-gray-900 disabled:opacity-50"
                      >
                        {approvingActionId === action.id ? 'Running' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleProposalDecision(index, action.id, 'reject')}
                        disabled={Boolean(approvingActionId)}
                        className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
                      >
                        Reject
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
        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs text-emerald-900">
          <p className="font-semibold">Executed actions</p>
          <div className="mt-2 space-y-1">
            {message.executedActions.map((action) => (
              <div key={action.id} className="leading-5">
                <div>{action.success ? 'Done' : 'Failed'} · {action.summary}</div>
                {action.result?.planId ? (
                  <div className="mt-1 text-emerald-700">
                    Saved as workspace-level plan · {String(action.result.planId)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {message.agentTrace?.length ? (
        <details className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
          <summary className="cursor-pointer select-none font-semibold text-gray-800">
            Agent trace
          </summary>
          <div className="mt-3">
            <p className="mb-1 font-medium text-gray-500">Trace</p>
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

  return (
    <section className={`workspace-terminal font-primary mx-auto flex w-full flex-col overflow-hidden bg-white text-gray-900 ${
      isDashboard ? 'min-h-[520px] max-w-none px-0 pb-0 pt-0' : 'h-full min-h-0 px-0 pb-0 pt-0'
    }`}>
      <div className={`mx-auto flex min-h-0 w-full flex-1 flex-col ${isDashboard ? 'max-w-none' : 'max-w-6xl'}`}>
        <div className={`mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-4 md:px-6 ${messages.length > 0 ? 'pb-0' : 'pb-3'}`}>
          <div className="inline-flex rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-500">
            <button
              type="button"
              onClick={() => onModeChange?.('chat')}
              className={`rounded-full px-3 py-1.5 transition ${isChatMode ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-700'}`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => onModeChange?.('agentic')}
              className={`rounded-full px-3 py-1.5 transition ${!isChatMode ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-700'}`}
            >
              Agentic
            </button>
          </div>
          {isChatMode ? (
            <div ref={sourceMenuRef} className="relative flex max-w-[62%] justify-end">
              <button
                type="button"
                onClick={() => setSourceMenuOpen((current) => !current)}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <BookOpen className="size-3.5" />
                <span className="max-w-[18rem] truncate">
                  {activeSources.length > 0 ? `${activeSources.length} locked source${activeSources.length > 1 ? 's' : ''}` : 'Workspace scope'}
                </span>
                <ChevronDown className="size-3.5" />
              </button>
              {sourceMenuOpen ? (
                <div className="absolute right-0 top-10 z-20 w-80 rounded-2xl border border-gray-100 bg-white p-2 shadow-lg">
                  <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    Lock sources for this chat
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {sourceFiles.length > 0 ? (
                      sourceFiles.map((source) => {
                        const isActive = selectedSourceModeById.has(source.id);
                        const sourceMode = selectedSourceModeById.get(source.id) || 'focused';
                        return (
                          <div
                            key={source.id}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50"
                          >
                            <button
                              type="button"
                              onClick={() => toggleSourceId(source.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="truncate text-sm font-medium text-gray-900">{source.name}</div>
                              <div className="truncate text-xs text-gray-500">{source.path}</div>
                              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceStatusToneClass(source.indexStatusTone)}`}>
                                  {source.indexStatusLabel || 'Unknown'}
                                </span>
                                <span className="truncate text-[10px] text-gray-400">
                                  {source.indexStatusDetail || 'Index status unavailable'}
                                </span>
                              </div>
                              {isActive && Number(source.chunkCount || 0) === 0 ? (
                                <div className="mt-1 text-[10px] text-red-500">No chunks yet; focused retrieval may not find evidence.</div>
                              ) : null}
                            </button>
                            <div className="flex shrink-0 items-center gap-2">
                              {isActive ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    updateSourceMode(source.id, sourceMode === 'focused' ? 'full_context' : 'focused');
                                  }}
                                  className="rounded-full border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
                                >
                                  {sourceMode === 'focused' ? 'Focused Retrieval' : 'Full Context'}
                                </button>
                              ) : null}
                              {isActive ? <Check className="size-4 shrink-0 text-black" /> : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-3 py-3 text-sm text-gray-500">No workspace sources available.</div>
                    )}
                  </div>
                  <div className="mt-2 flex justify-between gap-2 border-t border-gray-100 px-2 pt-2">
                    <button
                      type="button"
                      onClick={() => onSelectedSourcesChange?.([])}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceMenuOpen(false)}
                      className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex max-w-[62%] items-center gap-2 text-xs text-gray-500">
              <Search className="size-3.5" />
              Agentic mode
            </div>
          )}
        </div>
        {messages.length > 0 && (
        <div
          ref={messageScrollRef}
          onScroll={handleMessageScroll}
          className={`scrollbar-hidden min-h-0 flex-1 space-y-2 overflow-y-auto ${isDashboard ? 'px-0' : 'px-4 pt-7 md:px-6'}`}
        >
          {hasMoreMessages ? (
            <div className="mx-auto flex w-full max-w-3xl justify-center pb-3">
              <button
                type="button"
                onClick={() => void loadEarlierMessages()}
                disabled={loadingEarlierMessages}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-gray-100 bg-white px-3 text-xs font-medium text-gray-500 shadow-sm transition hover:bg-gray-50 hover:text-gray-800 disabled:opacity-60"
              >
                {loadingEarlierMessages ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Load earlier messages
              </button>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`workspace-message group mx-auto flex w-full max-w-3xl px-0 py-2 text-sm ${
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
                      AI
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="self-center font-semibold line-clamp-1 flex gap-1 items-center text-sm leading-6 text-black">
                        <span className="line-clamp-1">
                          {message.mode === 'agentic' ? 'Workspace Agent' : 'AI Terminal'}
                        </span>
                      </div>
                      <StatusHistory statusHistory={message.statusHistory} />
                      <div className="chat-assistant markdown-prose w-full min-w-full">
                        <OpenWebUIMarkdownPreview
                          content={message.content}
                          emptyMessage=""
                          isStreaming={streamingMessageIndex === index}
                          citationSources={citationSourcesFromEvidence(message.evidence || [])}
                          onCitationJump={(source) => {
                            const evidence = evidenceByCitationId(message.evidence || []).get(source.sourceId);
                            if (evidence) setSourceModalSource(evidence);
                          }}
                        />
                        {streamingMessageIndex === index ? (
                          <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-full bg-gray-900" />
                        ) : null}
                      </div>
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
          ))}

          {loading && (
            <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-0 py-3 text-sm text-gray-500">
              <div className="flex h-6 items-center gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-160ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-80ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
              </div>
              <span>Working {workingSeconds}s</span>
              {agentProgress ? <span className="truncate text-gray-400">· {agentProgress}</span> : null}
            </div>
          )}

          {goalDraft && (
            <div className="workspace-card-in mx-auto mt-4 w-full max-w-3xl rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
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
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
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
          <div className={`mx-auto w-full ${messages.length === 0 ? 'max-w-3xl px-4 md:px-6' : 'max-w-6xl px-2.5'}`}>
            {messages.length === 0 ? (
              <div className="workspace-hero mx-auto mb-7 w-full text-center">
                <div className="mb-5 text-3xl font-medium leading-tight text-gray-700">
                  How can I help you today?
                </div>
                <p className="mx-auto max-w-2xl text-sm leading-6 text-gray-500">
                  {isDashboard
                    ? `${overviewText} 你可以直接让 AI 汇总进度、整理材料或创建新的学习现场。`
                    : `${overviewText} Ask AI Terminal about ${workspaceName}.`}
                </p>
              </div>
            ) : null}

            {error && <p className="mx-auto mb-2 max-w-3xl px-3 text-sm text-red-600">{error}</p>}

            <div className="mx-auto w-full max-w-3xl">
            <form
              className="workspace-composer flex w-full flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
            <div className="flex flex-1 flex-col rounded-3xl border border-gray-100/30 bg-white/95 px-1 shadow-lg backdrop-blur-sm transition hover:border-gray-200 focus-within:border-gray-100">
              <input
                ref={chatFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) void uploadChatFiles(event.target.files);
                }}
              />
              {chatFiles.length > 0 ? (
                <div className="flex max-w-full gap-2 overflow-x-auto px-3 pt-3">
                  {chatFiles.map((file) => (
                    <div
                      key={file.id}
                      className="group/attachment flex h-10 max-w-52 shrink-0 items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-2 text-xs text-gray-700"
                      title={`${file.name}${file.size ? ` · ${formatBytes(file.size)}` : ''}`}
                    >
                      <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-gray-500">
                        {fileIsImage(file) && file.downloadUrl ? (
                          <img src={file.downloadUrl} alt={file.name} className="h-full w-full object-cover" />
                        ) : fileIsImage(file) ? (
                          <Image className="size-3.5" />
                        ) : (
                          <Paperclip className="size-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-800">{file.name}</div>
                        <div className="truncate text-[10px] text-gray-400">{formatBytes(file.size) || file.mimeType || 'Attachment'}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeChatFile(file.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-gray-400 opacity-80 transition hover:bg-gray-200 hover:text-gray-700 group-hover/attachment:opacity-100"
                        title="Remove attachment"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="px-2.5">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                className="scrollbar-hidden min-h-[52px] max-h-96 w-full resize-none bg-transparent px-1 pb-1 pt-3 text-[15px] leading-6 text-gray-900 outline-none placeholder:text-gray-500"
                placeholder="Send a Message"
                rows={1}
              />
              </div>

              <div className="mx-0.5 mb-2.5 mt-0.5 flex max-w-full justify-between" dir="ltr">
                <div className="ml-1 flex max-w-[80%] flex-1 items-center self-end">
                  <button
                    type="button"
                    onClick={() => chatFileInputRef.current?.click()}
                    disabled={uploadingChatFiles || !onUploadChatFiles}
                    className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100 disabled:opacity-40"
                    title="Attach to this chat"
                  >
                    {uploadingChatFiles ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4.5" />}
                  </button>
                  {isChatMode ? (
                    <button
                      type="button"
                      onClick={onUploadMaterials}
                      className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100"
                      title="Add sources to Knowledge"
                    >
                      <Plus className="size-5" />
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={onCreateWorkbench}
                      className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-600 outline-none transition hover:bg-gray-100 hover:text-gray-800"
                        title="New workbench"
                      >
                        <FolderUp className="size-4.5" />
                      </button>
                    </>
                  )}
                </div>

                <div className="mr-1 flex shrink-0 items-center gap-[0.5px] self-end">
                  {loading ? (
                    <button
                      type="button"
                      disabled
                      className="self-center rounded-full bg-white p-1.5 text-gray-800 transition hover:bg-gray-100"
                      title="Stop"
                    >
                      <Square className="size-5 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!input.trim() && readyChatFiles.length === 0}
                      className={`self-center rounded-full p-1.5 transition ${
                        input.trim() || readyChatFiles.length > 0
                          ? 'bg-black text-white hover:bg-gray-900'
                          : 'cursor-not-allowed bg-gray-200 text-white'
                      }`}
                      title="Send message"
                    >
                      <ArrowUp className="size-5" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="mb-1" />
            </form>
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
      <SourceDetailModal source={sourceModalSource} onClose={() => setSourceModalSource(null)} />
    </section>
  );
}
