import {
  Check,
  ChevronDown,
  ChevronsRight,
  MessagesSquare,
  FolderOpen,
  WandSparkles,
  Maximize2,
  MessageCirclePlus,
  Minimize2,
  PanelLeftOpen,
  PanelRight,
  PanelRightOpen,
  Search,
} from 'lucide-react';
import { aiApi, AiChatMessage } from '../services/aiApi';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndProvider, useDragDropManager } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  EditorLayoutNode,
  EditorState,
  FileSystemObject,
  ResourceReference,
  Workbench,
  WorkbenchEditorType
} from '../types';
import { DiscoveredResource, fileSystemApi } from '../services/fileSystemApi';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useAuthStore } from '../store/authStore';
import { workbenchApi } from '../services/workbenchApi';
import { learningApi } from '../services/learningApi';
import { useTheme } from '../theme';
import ResourcePickerDialog from '../components/workbench/ResourcePickerDialog';
import WorkbenchSidebar from '../components/workbench/WorkbenchSidebar';
import WorkbenchEditor from '../components/workbench/WorkbenchEditor';
import { AiEditorView } from '../components/workbench/WorkbenchEditorContent';
import AIStudioPanel from '../components/workbench/AIStudioPanel';
import WorkbenchSettingsDialog from '../components/workbench/WorkbenchSettingsDialog';
import { AddSourcesDialog } from '../components/workspace/AddSourcesDialog';
import {
  canEditResource,
  getResourceKind
} from '../components/workbench/editorResource';
import {
  createLeaf,
  createPaneId,
  collectLeafIds,
  findLeafById,
  getResolvedLayout,
  mapLayoutTree,
  normalizeLeaf,
  removeEditorFromLayout,
  updateLeafEditors,
  WorkbenchDropPlacement
} from '../utils/workbenchLayout';

const getEditorTypeForResource = (resource: ResourceReference): WorkbenchEditorType => {
  const kind = getResourceKind(resource);
  if (kind === 'video') return 'video';
  if (kind === 'html') return 'resource';
  if (kind === 'markdown' || kind === 'note') return 'notes';
  if (kind === 'code' || kind === 'structured') return 'code';
  return 'resource';
};

type OpenResourceOptions =
  | { kind: 'tab'; paneId?: string | null; bindEditorId?: string | null }
  | { kind: 'split'; paneId: string | null; placement: WorkbenchDropPlacement };

interface ResourcePickerState {
  mode: 'replace' | 'add-tab';
  editorId?: string | null;
  paneId?: string | null;
}

interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: typeof Search;
  run: () => void;
}

type AIAssistantMode = 'floating' | 'sidebar' | 'fullscreen';
type AIAssistantState = NonNullable<NonNullable<Workbench['state']>['aiAssistant']>;
type AIAssistantSession = NonNullable<AIAssistantState['sessions']>[number];
type AIStudioState = NonNullable<NonNullable<Workbench['state']>['aiStudio']>;
type AIToolPanelState = NonNullable<NonNullable<Workbench['state']>['aiToolPanel']>;

const makeAiSessionId = () => `ai-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const makeAiSession = (title = 'AI 对话'): AIAssistantSession => ({
  id: makeAiSessionId(),
  title,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  viewState: { messages: [], contextHint: 'workbench' }
});

const getAiSessions = (assistant: AIAssistantState | undefined, fallbackTitle = 'AI 对话') => {
  if (assistant?.sessions?.length) return assistant.sessions;
  return [
    {
      id: assistant?.activeSessionId || assistant?.id || makeAiSessionId(),
      title: assistant?.title && assistant.title !== '新建 AI 对话' ? assistant.title : fallbackTitle,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      viewState: assistant?.viewState || { messages: [], contextHint: 'workbench' }
    }
  ];
};

const makeLocalAiChatTitle = (messages: AiChatMessage[]) => {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content || '';
  const cleaned = firstUserMessage
    .split('\n\n【本轮临时附件】')[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'AI 对话';
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}...` : cleaned;
};

const makeSourceFilename = (title: string, fallback: string) => {
  const safeBase = (title || fallback)
    .trim()
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || fallback;

  return `${safeBase}.source`;
};

const makeTitleFromUrl = (value: string) => {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, '') || 'web-source';
  } catch {
    return 'web-source';
  }
};

const isAiSessionBlank = (session: AIAssistantSession) => {
  const messages = Array.isArray(session.viewState?.messages)
    ? (session.viewState.messages as AiChatMessage[])
    : [];
  return messages.length === 0;
};

const sessionHasMessages = (session: AIAssistantSession) => {
  const messages = Array.isArray(session.viewState?.messages)
    ? (session.viewState.messages as AiChatMessage[])
    : [];
  return messages.some((message) => message.role === 'user' || message.content.trim());
};

interface AIToolPanelShellProps {
  activeTool: AIToolPanelState['activeTool'];
  chatEditor: EditorState;
  studioEditor: EditorState;
  workspaceId: string;
  mode: AIAssistantMode;
  sessions: AIAssistantState['sessions'];
  activeSessionId: string;
  sidebarWidth: number;
  aiContext: React.ComponentProps<typeof AiEditorView>['aiContext'];
  resources: ResourceReference[];
  onModeChange: (mode: AIAssistantMode) => void;
  onClose: () => void;
  onResizeSidebar: (width: number) => void;
  onSelectTool: (tool: AIToolPanelState['activeTool']) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onUpdateChatViewState: (editorId: string, patch: Record<string, any>) => void;
  onUpdateStudioViewState: (editorId: string, patch: Record<string, any>) => void;
  onApplyNoteEdit?: (resourceId: string, content: string) => void | Promise<boolean | void>;
  onOpenResource?: (resource: ResourceReference) => void;
  initialStudioTemplateId?: string | null;
  initialStudioTemplateRequestId?: number | null;
}

interface AIToolShellProps {
  title: string;
  mode: AIAssistantMode;
  sidebarWidth: number;
  onModeChange: (mode: AIAssistantMode) => void;
  onClose: () => void;
  onResizeSidebar: (width: number) => void;
  children: React.ReactNode;
  headerLeft?: React.ReactNode;
  headerActions?: React.ReactNode;
  closeTitle?: string;
}

function AIToolShell({
  title,
  mode,
  sidebarWidth,
  onModeChange,
  onClose,
  onResizeSidebar,
  children,
  headerLeft,
  headerActions,
  closeTitle
}: AIToolShellProps) {
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const modeOptions: Array<{ mode: AIAssistantMode; label: string; icon: typeof PanelRight }> = [
    { mode: 'sidebar', label: '侧边栏', icon: PanelRight },
    { mode: 'floating', label: '浮动', icon: PanelRightOpen },
    { mode: 'fullscreen', label: '全屏', icon: Maximize2 }
  ];
  const isSidebar = mode === 'sidebar';
  const isFullscreen = mode === 'fullscreen';

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isSidebar) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(760, Math.max(360, startWidth - (moveEvent.clientX - startX)));
      onResizeSidebar(nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleShellPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Node;
    if (isModeMenuOpen && !modeMenuRef.current?.contains(target)) {
      setIsModeMenuOpen(false);
    }
  };

  return (
    <div
      onPointerDown={handleShellPointerDown}
      className={`ai-panel-surface z-40 ${
        isSidebar
          ? 'ai-sidebar-drift relative flex h-full shrink-0 border-l border-[#e6e5df] bg-white'
          : isFullscreen
            ? 'ai-fullscreen-rise absolute inset-3 flex rounded-[24px] border border-[#e6e5df] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]'
            : 'ai-panel-pop absolute bottom-5 right-5 flex h-[min(620px,calc(100vh-56px))] w-[min(520px,calc(100vw-40px))] rounded-[24px] border border-[#e6e5df] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.2)]'
      }`}
      style={isSidebar ? { width: sidebarWidth } : undefined}
    >
      {isSidebar && (
        <div
          className="group/ai-resize absolute left-0 top-0 z-30 h-full w-2 -translate-x-1 cursor-col-resize"
          onPointerDown={handleResizeStart}
          title="调整 AI 侧边栏宽度"
        >
          <div className="absolute left-1 top-0 h-full w-px bg-[#e6e5df] transition-colors group-hover/ai-resize:bg-[#b8babf]" />
        </div>
      )}
      <div className={`flex min-h-0 w-full flex-col overflow-hidden bg-white ${isSidebar ? '' : 'rounded-[inherit]'}`}>
        <div className="relative z-20 flex h-14 shrink-0 items-center justify-between px-4">
          <div className="relative min-w-0">
            {headerLeft || (
              <div className="inline-flex max-w-[260px] min-w-0 items-center gap-2 rounded-full px-2.5 py-1.5 text-left text-[15px] font-semibold text-[#25272b]">
                <span className="truncate">{title}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {headerActions}
            <div ref={modeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsModeMenuOpen((value) => !value)}
                className={`ai-soft-button inline-flex h-9 w-9 items-center justify-center rounded-full text-[#3f4247] ${
                  isModeMenuOpen ? 'bg-[#f1f1ef]' : 'hover:bg-[#f1f1ef]'
                }`}
                title="切换显示方式"
              >
                {isSidebar ? <PanelRight className="h-5 w-5" /> : isFullscreen ? <Maximize2 className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
              </button>
              {isModeMenuOpen && (
                <div className="ai-menu-pop absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white p-1.5 text-sm text-[#25272b] shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
                  {modeOptions.map((option, index) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.mode}
                        type="button"
                        onClick={() => {
                          onModeChange(option.mode);
                          setIsModeMenuOpen(false);
                        }}
                        className={`ai-soft-button flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#f6f6f4] ${
                          index === 2 ? 'mt-1 border-t border-[#eeeeeb]' : ''
                        }`}
                      >
                        <Icon className="h-4.5 w-4.5 text-[#4b4f55]" />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {mode === option.mode && <Check className="h-4 w-4 text-[#25272b]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ai-soft-button inline-flex h-9 w-9 items-center justify-center rounded-full text-[#3f4247] hover:bg-[#f1f1ef]"
              title={closeTitle || (isSidebar ? '隐藏面板' : '最小化')}
            >
              {isSidebar ? <ChevronsRight className="h-5 w-5" /> : <Minimize2 className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

function AIToolPanelShell({
  activeTool,
  chatEditor,
  studioEditor,
  workspaceId,
  mode,
  sessions = [],
  activeSessionId,
  sidebarWidth,
  aiContext,
  resources,
  onModeChange,
  onClose,
  onResizeSidebar,
  onSelectTool,
  onSelectSession,
  onCreateSession,
  onUpdateChatViewState,
  onUpdateStudioViewState,
  onApplyNoteEdit,
  onOpenResource,
  initialStudioTemplateId,
  initialStudioTemplateRequestId
}: AIToolPanelShellProps) {
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];
  const title = activeSession?.title || chatEditor.title || 'AI 对话';
  const isChatActive = activeTool === 'chat';
  const tabs: Array<{ key: AIToolPanelState['activeTool']; label: string }> = [
    { key: 'chat', label: 'AI Chat' },
    { key: 'studio', label: 'AI Studio' }
  ];

  return (
    <AIToolShell
      title={isChatActive ? title : 'AI Studio'}
      mode={mode}
      sidebarWidth={sidebarWidth}
      onModeChange={onModeChange}
      onClose={onClose}
      onResizeSidebar={onResizeSidebar}
      closeTitle={mode === 'sidebar' ? '隐藏 AI 面板' : '最小化'}
      headerLeft={
        <div className="flex min-w-0 items-center gap-3">
          <div className="inline-flex shrink-0 items-center gap-5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onSelectTool(tab.key)}
                className={`group relative inline-flex h-9 items-center justify-center px-0 text-[15px] font-semibold transition-colors duration-200 ${
                  activeTool === tab.key ? 'text-[#202124]' : 'text-[#85898f] hover:text-[#3f4247]'
                }`}
                aria-pressed={activeTool === tab.key}
              >
                <span className="whitespace-nowrap">{tab.label}</span>
                <span
                  className={`absolute bottom-0 left-0 h-px bg-current transition-all duration-200 ${
                    activeTool === tab.key ? 'w-full opacity-100' : 'w-0 opacity-0 group-hover:w-full group-hover:opacity-30'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      }
      headerActions={
        isChatActive ? (
          <button
            type="button"
            onClick={onCreateSession}
            className="ai-soft-button inline-flex h-9 w-9 items-center justify-center rounded-full text-[#3f4247] hover:bg-[#f1f1ef]"
            title="新建对话"
          >
            <MessageCirclePlus className="h-5 w-5" />
          </button>
        ) : undefined
      }
    >
      {isChatActive ? (
        <>
          <div className="relative z-10 shrink-0 border-b border-[#f0f0ec] bg-white px-5 py-2.5">
            <div ref={sessionMenuRef} className="relative inline-flex min-w-0">
              <button
                type="button"
                onClick={() => setIsSessionMenuOpen((value) => !value)}
                className="ai-soft-button inline-flex max-w-[260px] min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[14px] font-medium text-[#4b4f55] hover:bg-[#f1f1ef]"
                title="切换 AI 对话"
              >
                <span className="truncate">{title}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[#8f9399] transition-transform duration-200 ${isSessionMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isSessionMenuOpen && (
                <div className="ai-menu-pop ai-session-menu-pop absolute left-0 top-10 z-50 w-72 overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white p-1.5 text-sm text-[#25272b] shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
                  <button
                    type="button"
                    onClick={() => {
                      onCreateSession();
                      setIsSessionMenuOpen(false);
                    }}
                    className="ai-soft-button mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left font-medium hover:bg-[#f6f6f4]"
                  >
                    <MessageCirclePlus className="h-4 w-4 text-[#4b4f55]" />
                    新建 AI 对话
                  </button>
                  <div className="max-h-72 overflow-y-auto border-t border-[#eeeeeb] pt-1">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          onSelectSession(session.id);
                          setIsSessionMenuOpen(false);
                        }}
                        className="ai-soft-button flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-[#f6f6f4]"
                      >
                        <span className="min-w-0 flex-1 truncate">{session.title || 'AI 对话'}</span>
                        {session.id === activeSessionId && <Check className="h-4 w-4 shrink-0 text-[#25272b]" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <AiEditorView
            editor={chatEditor}
            workspaceId={workspaceId}
            aiContext={aiContext}
            onUpdateViewState={onUpdateChatViewState}
            onApplyNoteEdit={onApplyNoteEdit}
            hideHeader
            compactWelcome={mode === 'sidebar'}
          />
        </>
      ) : (
        <AIStudioPanel
          editor={studioEditor}
          workspaceId={workspaceId}
          aiContext={aiContext}
          resources={resources}
          onUpdateViewState={onUpdateStudioViewState}
          onOpenResource={onOpenResource}
          initialTemplateId={initialStudioTemplateId}
          initialTemplateRequestId={initialStudioTemplateRequestId}
        />
      )}
    </AIToolShell>
  );
}

function WorkbenchPageContent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dndManager = useDragDropManager();
  const [searchParams, setSearchParams] = useSearchParams();
  const [resourcePickerState, setResourcePickerState] = useState<ResourcePickerState | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isSidebarPreviewOpen, setIsSidebarPreviewOpen] = useState(false);
  const [isAddSourcesOpen, setIsAddSourcesOpen] = useState(false);
  const [liveContextVersion, setLiveContextVersion] = useState(0);
  const [liveContextUpdatedAt, setLiveContextUpdatedAt] = useState<string | null>(null);
  const [studioTemplateLaunch, setStudioTemplateLaunch] = useState<{ templateId: string | null; requestId: number }>({
    templateId: null,
    requestId: 0
  });
  const liveContextLastEmitAtRef = useRef<Record<string, number>>({});
  const sidebarPreviewCloseTimer = useRef<number | null>(null);
  const [workspaceWorkbenches, setWorkspaceWorkbenches] = useState<Workbench[]>([]);
  const [workbenchPlans, setWorkbenchPlans] = useState<any[]>([]);
  const [documentStateByResourceId, setDocumentStateByResourceId] = useState<
    Record<string, { content: string; savedContent: string; loading?: boolean }>
  >({});
  const [documentSaveStateByResourceId, setDocumentSaveStateByResourceId] = useState<
    Record<string, { status: 'idle' | 'saving' | 'saved' | 'error'; savedAt?: string; error?: string }>
  >({});
  const documentStateRef = useRef<Record<string, { content: string; savedContent: string; loading?: boolean }>>({});
  const savingDocumentIdsRef = useRef<Set<string>>(new Set());
  const pendingSaveDocumentIdsRef = useRef<Set<string>>(new Set());
  const user = useAuthStore((authState) => authState.user);
  const { theme, setTheme } = useTheme();
  const {
    workbench,
    state,
    resources,
    loading,
    saveStatus,
    error,
    loadWorkbench,
    setResources,
    setWorkbenchMeta,
    addEditor,
    updateEditorViewState,
    updateWorkbenchState,
    activateEditor,
    closeEditor,
    bindResourceToEditor,
    saveNow,
    reset
  } = useWorkbenchStore();

  useEffect(() => {
    documentStateRef.current = documentStateByResourceId;
  }, [documentStateByResourceId]);

  const isLiveContextPatch = (patch: Record<string, any>) => {
    const liveKeys = new Set([
      'visibleLineRange',
      'visiblePages',
      'primaryPage',
      'visibleBlockIds',
      'scrollRatio',
      'selectedText',
      'selectedRange',
      'approxChunkIndex'
    ]);
    const keys = Object.keys(patch);
    return keys.length > 0 && keys.some((key) => liveKeys.has(key));
  };

  const mergeAiSessionsFromHistory = (historySessions: any[]) => {
    if (!historySessions.length || !workbench) return;
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const localSessions = getAiSessions(latestState.aiAssistant, 'AI 对话');
    const localById = new Map(localSessions.map((session) => [session.id, session]));
    const hydratedSessions: AIAssistantSession[] = historySessions.map((session) => {
      const local = localById.get(String(session.id));
      const messages = Array.isArray(session.messages)
        ? session.messages.map((message: any) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: String(message.content || '')
          }))
        : [];
      return {
        id: String(session.id),
        title: String(session.title || local?.title || 'AI 对话'),
        createdAt: String(session.createdAt || local?.createdAt || new Date().toISOString()),
        updatedAt: String(session.updatedAt || local?.updatedAt || new Date().toISOString()),
        viewState: local?.viewState && sessionHasMessages(local)
          ? local.viewState
          : { ...(local?.viewState || { contextHint: 'workbench' }), messages }
      };
    });
    const hydratedIds = new Set(hydratedSessions.map((session) => session.id));
    const mergedSessions = [
      ...hydratedSessions,
      ...localSessions.filter((session) => !hydratedIds.has(session.id) && (sessionHasMessages(session) || isAiSessionBlank(session)))
    ].slice(0, 30);
    if (!mergedSessions.length) return;
    const activeSessionId =
      latestState.aiAssistant?.activeSessionId && mergedSessions.some((session) => session.id === latestState.aiAssistant?.activeSessionId)
        ? latestState.aiAssistant.activeSessionId
        : mergedSessions[0].id;
    const activeSession = mergedSessions.find((session) => session.id === activeSessionId) || mergedSessions[0];
    const previousSessions = getAiSessions(latestState.aiAssistant, 'AI 对话');
    const sameShape =
      previousSessions.length === mergedSessions.length &&
      previousSessions.every((session, index) => {
        const nextSession = mergedSessions[index];
        return (
          session.id === nextSession.id &&
          session.title === nextSession.title &&
          (session.viewState?.messages as AiChatMessage[] | undefined)?.length ===
            (nextSession.viewState?.messages as AiChatMessage[] | undefined)?.length
        );
      });
    if (sameShape && latestState.aiAssistant?.activeSessionId === activeSessionId) return;
    updateWorkbenchState({
      aiAssistant: {
        ...(latestState.aiAssistant || {
          id: `ai-assistant-${workbench.id}`,
          title: 'AI 对话',
          mode: 'floating' as const,
          isOpen: false,
          sidebarWidth: 460,
          viewState: { messages: [], contextHint: 'workbench' }
        }),
        activeSessionId,
        sessions: mergedSessions,
        title: activeSession.title,
        viewState: activeSession.viewState
      }
    });
  };

  const isSameLiveContextValue = (a: unknown, b: unknown) => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  };

  const handleUpdateEditorViewState = (editorId: string, patch: Record<string, any>) => {
    const isLivePatch = isLiveContextPatch(patch);
    if (!isLivePatch) {
      updateEditorViewState(editorId, patch);
      return;
    }

    const currentState = useWorkbenchStore.getState().state;
    const currentEditor = currentState?.editors.find((editor) => editor.id === editorId);
    if (currentEditor) {
      const keys = Object.keys(patch);
      const changed = keys.some((key) => !isSameLiveContextValue(currentEditor.viewState?.[key], patch[key]));
      if (!changed) return;
    }

    const now = Date.now();
    const lastAt = liveContextLastEmitAtRef.current[editorId] || 0;
    if (now - lastAt < 120) return;
    liveContextLastEmitAtRef.current[editorId] = now;

    updateEditorViewState(editorId, patch);
    if (isLivePatch) {
      setLiveContextVersion((value) => value + 1);
      setLiveContextUpdatedAt(new Date().toISOString());
    }
  };

  const openSidebarPreview = () => {
    if (sidebarPreviewCloseTimer.current) {
      window.clearTimeout(sidebarPreviewCloseTimer.current);
      sidebarPreviewCloseTimer.current = null;
    }
    setIsSidebarPreviewOpen(true);
  };

  const scheduleCloseSidebarPreview = () => {
    if (sidebarPreviewCloseTimer.current) {
      window.clearTimeout(sidebarPreviewCloseTimer.current);
    }
    sidebarPreviewCloseTimer.current = window.setTimeout(() => {
      setIsSidebarPreviewOpen(false);
      sidebarPreviewCloseTimer.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (sidebarPreviewCloseTimer.current) {
        window.clearTimeout(sidebarPreviewCloseTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const saveBeforeUnload = () => {
      void useWorkbenchStore.getState().saveNow();
    };
    window.addEventListener('beforeunload', saveBeforeUnload);
    return () => window.removeEventListener('beforeunload', saveBeforeUnload);
  }, []);

  useEffect(() => {
    if (!id) return;

    void loadWorkbench(id);

    return () => {
      reset();
    };
  }, [id, loadWorkbench, reset]);

  useEffect(() => {
    if (!workbench?.id) return;

    void workbenchApi
      .getResourceGroups(workbench.id)
      .then((groups) => setResources([...groups.sources, ...groups.files, ...groups.generated]))
      .catch((loadError) => {
        console.error('Failed to load workbench resources:', loadError);
      });
  }, [workbench?.id, setResources]);

  useEffect(() => {
    if (!workbench?.workspaceId) return;

    void workbenchApi
      .listByWorkspace(workbench.workspaceId)
      .then(setWorkspaceWorkbenches)
      .catch((loadError) => {
        console.error('Failed to load workspace workbenches:', loadError);
        setWorkspaceWorkbenches(workbench ? [workbench] : []);
      });
  }, [workbench]);

  const reloadWorkbenchPlans = useCallback(async () => {
    if (!workbench?.workspaceId || !workbench.id) return;
    try {
      const result = await learningApi.listLearningPlans(workbench.workspaceId, { workbenchId: workbench.id, limit: 20 });
      setWorkbenchPlans(Array.isArray(result.plans) ? result.plans : []);
    } catch (loadError) {
      console.error('Failed to load workbench plans:', loadError);
      setWorkbenchPlans([]);
    }
  }, [workbench?.workspaceId, workbench?.id]);

  useEffect(() => {
    void reloadWorkbenchPlans();
  }, [reloadWorkbenchPlans]);

  const resourceOptions = useMemo(
    () => resources.filter((resource) => resource.type !== 'folder'),
    [resources]
  );

  const resourceMap = useMemo(
    () => new Map(resourceOptions.map((resource) => [resource.id, resource])),
    [resourceOptions]
  );

  const handlePlanStepStatusChange = useCallback(
    async (planId: string, stepId: string, status: 'pending' | 'active' | 'done' | 'skipped' | 'blocked') => {
      if (!workbench?.workspaceId) return;
      setWorkbenchPlans((current) =>
        current.map((plan) => {
          if (plan.id !== planId) return plan;
          if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
            const stages = Array.isArray(plan.structuredPlan?.stages) ? plan.structuredPlan.stages : [];
            if (!stages.length) return plan;
            return {
              ...plan,
              structuredPlan: {
                ...plan.structuredPlan,
                stages: stages.map((stage: any, index: number) => {
                  const matches = String(stage.id || '') === stepId || `structured-${stage.order || index + 1}` === stepId || `step-${index + 1}` === stepId;
                  if (!matches && status === 'active' && stage.status === 'active') return { ...stage, status: 'pending' };
                  return matches ? { ...stage, status } : stage;
                })
              }
            };
          }
          return {
            ...plan,
            steps: plan.steps.map((step: any, index: number) => {
              const matches = String(step.id || '') === stepId || `step-${index + 1}` === stepId || `structured-${index + 1}` === stepId;
              if (!matches && status === 'active' && step.status === 'active') return { ...step, status: 'pending' };
              return matches ? { ...step, status } : step;
            })
          };
        })
      );
      try {
        const result = await learningApi.updateLearningPlanStepStatus(planId, stepId, {
          workspaceId: workbench.workspaceId,
          status
        });
        if (result?.plan) {
          setWorkbenchPlans((current) => current.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
        }
        await reloadWorkbenchPlans();
      } catch (updateError) {
        console.error('Failed to update plan step status:', updateError);
        await reloadWorkbenchPlans();
        throw updateError;
      }
    },
    [reloadWorkbenchPlans, workbench?.workspaceId]
  );

  const replaceWorkbenchPlan = useCallback((nextPlan: any) => {
    if (!nextPlan?.id) return;
    setWorkbenchPlans((current) => current.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan)));
  }, []);

  const handlePlanAction = useCallback(
    async (
      planId: string,
      action: 'start' | 'pause' | 'resume' | 'complete' | 'archive' | 'restore' | 'supersede' | 'set_primary' | 'reopen' | 'duplicate' | 'replan',
      options?: { targetPlanId?: string; title?: string; note?: string }
    ) => {
      if (!workbench?.workspaceId) return;
      try {
        const result = options?.targetPlanId
          ? await learningApi.rollbackLearningPlan(planId, {
              workspaceId: workbench.workspaceId,
              targetPlanId: options.targetPlanId
            })
          : await learningApi.performLearningPlanAction(planId, {
              workspaceId: workbench.workspaceId,
              action,
              targetPlanId: options?.targetPlanId,
              title: options?.title,
              note: options?.note
            });
        if (result?.plan) {
          replaceWorkbenchPlan(result.plan);
        }
        await reloadWorkbenchPlans();
      } catch (updateError) {
        console.error('Failed to update plan action:', updateError);
        await reloadWorkbenchPlans();
        throw updateError;
      }
    },
    [reloadWorkbenchPlans, replaceWorkbenchPlan, workbench?.workspaceId]
  );

  const handlePlanStepUpdate = useCallback(
    async (
      planId: string,
      stepId: string,
      patch: { title?: string; description?: string; note?: string; estimateMinutes?: number | null; dueDate?: string | null; tags?: string[] }
    ) => {
      if (!workbench?.workspaceId) return;
      try {
        const result = await learningApi.updateLearningPlanStepDetails(planId, stepId, {
          workspaceId: workbench.workspaceId,
          ...patch
        });
        if (result?.plan) {
          replaceWorkbenchPlan(result.plan);
        }
        await reloadWorkbenchPlans();
      } catch (updateError) {
        console.error('Failed to update plan step details:', updateError);
        await reloadWorkbenchPlans();
        throw updateError;
      }
    },
    [reloadWorkbenchPlans, replaceWorkbenchPlan, workbench?.workspaceId]
  );

  const handlePlanFeedback = useCallback(
    async (
      planId: string,
      feedback: { stepId?: string | null; category: 'too_hard' | 'too_easy' | 'blocked' | 'resource_mismatch' | 'replan' | 'other'; note?: string; rating?: number | null }
    ) => {
      if (!workbench?.workspaceId) return;
      try {
        const result = await learningApi.recordLearningPlanFeedback(planId, {
          workspaceId: workbench.workspaceId,
          ...feedback
        });
        if (result?.plan) {
          replaceWorkbenchPlan(result.plan);
        }
        await reloadWorkbenchPlans();
      } catch (updateError) {
        console.error('Failed to record plan feedback:', updateError);
        await reloadWorkbenchPlans();
        throw updateError;
      }
    },
    [reloadWorkbenchPlans, replaceWorkbenchPlan, workbench?.workspaceId]
  );

  const activeEditor = useMemo(
    () => state?.editors.find((editor) => editor.id === state.activeEditorId) ?? null,
    [state]
  );
  const activeExternalContext = useMemo(() => {
    if (activeEditor?.type === 'external' && activeEditor.viewState?.externalResource) {
      return activeEditor.viewState.externalResource as {
        title: string;
        url: string;
        description?: string;
      };
    }

    return (
      state?.editors.find((editor) => editor.type === 'external' && editor.viewState?.externalResource)
        ?.viewState?.externalResource ?? null
    ) as { title: string; url: string; description?: string } | null;
  }, [activeEditor, state?.editors]);
  const preferredFileEditor = useMemo(() => {
    if (!state?.editors?.length) return null;

    const candidates = state.editors.filter((editor) => editor.resourceId);
    if (candidates.length === 0) return null;

    if (activeEditor?.resourceId) {
      return activeEditor;
    }

    return [...candidates].sort((left, right) => right.zIndex - left.zIndex)[0] ?? null;
  }, [activeEditor, state?.editors]);
  const activeFileContext = useMemo(() => {
    if (!preferredFileEditor?.resourceId) return null;
    const resource = resourceMap.get(preferredFileEditor.resourceId);
    return resource
      ? {
          id: resource.id,
          name: resource.name,
          path: resource.path,
          fileCategory: resource.fileCategory,
          resourceType: resource.resourceType,
          scope: resource.scope,
          origin: resource.origin,
          ownerWorkbenchId: resource.ownerWorkbenchId
        }
      : null;
  }, [preferredFileEditor, resourceMap]);
  const activeFileContent = useMemo(() => {
    if (!preferredFileEditor?.resourceId) return null;
    return documentStateByResourceId[preferredFileEditor.resourceId]?.content ?? null;
  }, [documentStateByResourceId, preferredFileEditor]);
  const openPanelContexts = useMemo(
    () =>
      (state?.editors ?? []).map((editor) => {
        const resource = editor.resourceId ? resourceMap.get(editor.resourceId) : null;
        const content = editor.resourceId ? documentStateByResourceId[editor.resourceId]?.content ?? '' : '';
        const lineRange = editor.viewState.visibleLineRange as { start: number; end: number } | undefined;
        const lines = content.split('\n');
        const documentVisibleContent = lineRange
          ? lines.slice(Math.max(0, lineRange.start - 1), Math.min(lines.length, lineRange.end)).join('\n')
          : content.slice(0, 2400);
        const visibleContent =
          typeof editor.viewState.videoContextText === 'string' && editor.viewState.videoContextText.trim()
            ? (editor.viewState.videoContextText as string)
            : typeof editor.viewState.visibleContent === 'string' && editor.viewState.visibleContent.trim() && editor.type === 'video'
              ? (editor.viewState.visibleContent as string)
              : documentVisibleContent;

        return {
          panelId: editor.id,
          panelType: editor.type,
          title: editor.title,
          fileId: resource?.id ?? null,
          fileName: resource?.name,
          filePath: resource?.path,
          fileCategory: resource?.fileCategory,
          resourceType: resource?.resourceType,
          scope: resource?.scope,
          origin: resource?.origin,
          ownerWorkbenchId: resource?.ownerWorkbenchId,
          visiblePages: Array.isArray(editor.viewState.visiblePages)
            ? (editor.viewState.visiblePages as number[])
            : undefined,
          primaryPage:
            typeof editor.viewState.primaryPage === 'number'
              ? (editor.viewState.primaryPage as number)
              : Array.isArray(editor.viewState.visiblePages)
                ? (editor.viewState.visiblePages as number[])[0]
                : undefined,
          visibleLineRange: lineRange ?? null,
          visibleBlockIds: Array.isArray(editor.viewState.visibleBlockIds)
            ? (editor.viewState.visibleBlockIds as string[])
            : undefined,
          approxChunkIndex:
            typeof editor.viewState.approxChunkIndex === 'number'
              ? (editor.viewState.approxChunkIndex as number)
              : null,
          scrollRatio:
            typeof editor.viewState.scrollRatio === 'number'
              ? (editor.viewState.scrollRatio as number)
              : null,
          selectedText:
            typeof editor.viewState.selectedText === 'string'
              ? (editor.viewState.selectedText as string)
              : undefined,
          selectedRange:
            editor.viewState.selectedRange && typeof editor.viewState.selectedRange === 'object'
              ? (editor.viewState.selectedRange as any)
              : null,
          visibleContent
        };
      }),
    [documentStateByResourceId, resourceMap, state?.editors]
  );
  const visiblePanelIds = useMemo(() => {
    if (!state?.editors?.length) return new Set<string>();
    const layout = getResolvedLayout(
      state.editorLayout,
      state.editors.map((editor) => editor.id),
      state.activeEditorId
    );
    if (!layout) return new Set<string>();

    return new Set(
      collectLeafIds(layout)
        .map((paneId) => {
          const leaf = findLeafById(layout, paneId);
          if (!leaf) return null;
          const normalizedLeaf = normalizeLeaf(leaf);
          const activeId =
            normalizedLeaf.activeEditorId && normalizedLeaf.editorIds.includes(normalizedLeaf.activeEditorId)
              ? normalizedLeaf.activeEditorId
              : normalizedLeaf.editorIds.find((editorId) => editorId === state.activeEditorId) ||
                normalizedLeaf.editorIds[0] ||
                null;
          return activeId;
        })
        .filter((value): value is string => Boolean(value))
    );
  }, [state?.activeEditorId, state?.editorLayout, state?.editors]);
  const visiblePanelContexts = useMemo(
    () => openPanelContexts.filter((panel) => visiblePanelIds.has(panel.panelId)),
    [openPanelContexts, visiblePanelIds]
  );
  const aiAssistantContext = useMemo(
    () => ({
      userId: user?.id,
      workbenchTitle: workbench?.title,
      workbenchDescription: workbench?.description,
      workbenchId: workbench?.id,
      liveContextVersion,
      liveContextUpdatedAt: liveContextUpdatedAt || undefined,
      activePanelId:
        activeEditor?.type === 'ai'
          ? preferredFileEditor?.id ?? state?.activeEditorId ?? null
          : state?.activeEditorId ?? null,
      activeFileId: activeFileContext?.id ?? null,
      activeFile: activeFileContext,
      activeFileContent,
      activeExternal: activeExternalContext,
      openPanels: openPanelContexts,
      visiblePanels: visiblePanelContexts
    }),
    [
      activeEditor?.type,
      activeExternalContext,
      activeFileContent,
      activeFileContext,
      liveContextUpdatedAt,
      liveContextVersion,
      openPanelContexts,
      visiblePanelContexts,
      preferredFileEditor?.id,
      state?.activeEditorId,
      user?.id,
      workbench?.description,
      workbench?.id,
      workbench?.title
    ]
  );
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: 'view.sidebar',
        title: 'View: Toggle Sidebar',
        subtitle: 'Pin or unpin the workbench sidebar',
        icon: PanelLeftOpen,
        run: () => setIsSidebarPinned((value) => !value)
      },
      {
        id: 'workbench.new-ai',
        title: 'Workbench: Open AI Conversation',
        subtitle: 'Open the workbench AI assistant',
        icon: MessagesSquare,
        run: () => {
          handleCreateAiPanel();
        }
      },
      {
        id: 'workbench.ai-studio',
        title: 'Workbench: Open AI Studio',
        subtitle: 'Generate reports, slides, mind maps, flashcards, quizzes and tables',
        icon: WandSparkles,
        run: () => {
          handleCreateStudioPanel();
        }
      },
      {
        id: 'workbench.rename',
        title: 'Workbench: Rename',
        subtitle: 'Rename the current workbench',
        icon: FolderOpen,
        run: () => void handleRename()
      },
      {
        id: 'file.save-all',
        title: 'File: Save All',
        subtitle: 'Save open editable resources and workbench state',
        icon: FolderOpen,
        run: () => void handleSaveAllEditors()
      }
    ],
    []
  );
  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandPaletteItems;

    return commandPaletteItems.filter((item) =>
      `${item.title} ${item.subtitle || ''}`.toLowerCase().includes(query)
    );
  }, [commandPaletteItems, commandQuery]);

  const openTextResourceIds = useMemo(
    () => [
      ...new Set(
        (state?.editors ?? [])
          .filter((editor) => editor.type === 'notes' || editor.type === 'code')
          .map((editor) => editor.resourceId)
          .filter((value): value is string => Boolean(value))
          .filter((resourceId) => {
            const resource = resourceMap.get(resourceId);
            return Boolean(resource && canEditResource(resource));
          })
      )
    ],
    [resourceMap, state?.editors]
  );

  const saveDocumentContent = useCallback(
    async (
      resourceId: string,
      options?: {
        force?: boolean;
        contentOverride?: string;
        baseContentHash?: string | null;
        revisionSummary?: string;
        actionType?: string;
        actor?: string;
      }
    ) => {
      if (!workbench?.workspaceId) return false;
      if (savingDocumentIdsRef.current.has(resourceId)) {
        if (typeof options?.contentOverride === 'string') {
          const latest = documentStateRef.current[resourceId];
          const nextEntry = {
            ...(latest ?? { savedContent: '' }),
            content: options.contentOverride,
            loading: false
          };
          documentStateRef.current = {
            ...documentStateRef.current,
            [resourceId]: nextEntry
          };
          setDocumentStateByResourceId((current) => ({
            ...current,
            [resourceId]: {
              ...(current[resourceId] ?? { savedContent: '' }),
              content: options.contentOverride as string,
              loading: false
            }
          }));
        }
        pendingSaveDocumentIdsRef.current.add(resourceId);
        return false;
      }

      const entry = documentStateRef.current[resourceId];
      if (!entry || entry.loading) return false;
      const contentToSave = typeof options?.contentOverride === 'string' ? options.contentOverride : entry.content;
      if (typeof options?.contentOverride === 'string') {
        const nextEntry = {
          ...entry,
          content: contentToSave,
          loading: false
        };
        documentStateRef.current = {
          ...documentStateRef.current,
          [resourceId]: nextEntry
        };
        setDocumentStateByResourceId((current) => ({
          ...current,
          [resourceId]: nextEntry
        }));
      }
      if (!options?.force && contentToSave === entry.savedContent) return true;

      savingDocumentIdsRef.current.add(resourceId);
      setDocumentSaveStateByResourceId((current) => ({
        ...current,
        [resourceId]: {
          status: 'saving',
          savedAt: current[resourceId]?.savedAt
        }
      }));

      try {
        if (options?.baseContentHash || options?.revisionSummary || options?.actionType) {
          await fileSystemApi.saveContentWithRevision(workbench.workspaceId, {
            id: resourceId,
            content: contentToSave,
            baseContentHash: options.baseContentHash,
            revisionSummary: options.revisionSummary,
            actionType: options.actionType,
            actor: options.actor || 'ai'
          });
        } else {
          await fileSystemApi.saveContent(workbench.workspaceId, {
            id: resourceId,
            content: contentToSave
          });
        }

        setDocumentStateByResourceId((current) => {
          const latest = current[resourceId];
          if (!latest) return current;

          return {
            ...current,
            [resourceId]: latest.content === contentToSave
              ? {
                  ...latest,
                  savedContent: contentToSave,
                  loading: false
                }
              : {
                  ...latest,
                  savedContent: latest.savedContent,
                  loading: false
                }
          };
        });
        setDocumentSaveStateByResourceId((current) => ({
          ...current,
          [resourceId]: {
            status: 'saved',
            savedAt: new Date().toISOString()
          }
        }));
        return true;
      } catch (saveError) {
        console.error('Failed to save document content:', saveError);
        setDocumentSaveStateByResourceId((current) => ({
          ...current,
          [resourceId]: {
            status: 'error',
            savedAt: current[resourceId]?.savedAt,
            error: saveError instanceof Error ? saveError.message : 'Save failed'
          }
        }));
        return false;
      } finally {
        savingDocumentIdsRef.current.delete(resourceId);
        const latest = documentStateRef.current[resourceId];
        const shouldSavePending =
          pendingSaveDocumentIdsRef.current.has(resourceId) ||
          Boolean(latest && !latest.loading && latest.content !== latest.savedContent);

        pendingSaveDocumentIdsRef.current.delete(resourceId);
        if (shouldSavePending) {
          window.setTimeout(() => {
            void saveDocumentContent(resourceId, { force: true });
          }, 0);
        }
      }
    },
    [workbench?.workspaceId]
  );

  useEffect(() => {
    if (!workbench?.workspaceId) return;

    openTextResourceIds.forEach((resourceId) => {
      if (documentStateByResourceId[resourceId]) return;

      setDocumentStateByResourceId((current) => ({
        ...current,
        [resourceId]: { content: '', savedContent: '', loading: true }
      }));

      void fileSystemApi
        .getContent(workbench.workspaceId, resourceId)
        .then((response) => {
          const loadedContent = response.content ?? '';
          setDocumentStateByResourceId((current) => {
            const existing = current[resourceId];
            if (existing && !existing.loading && existing.content !== existing.savedContent) {
              return {
                ...current,
                [resourceId]: {
                  ...existing,
                  loading: false
                }
              };
            }

            return {
              ...current,
              [resourceId]: {
                content: loadedContent,
                savedContent: loadedContent,
                loading: false
              }
            };
          });
        })
        .catch(() => {
          setDocumentStateByResourceId((current) => ({
            ...current,
            [resourceId]: {
              content: '',
              savedContent: '',
              loading: false
            }
          }));
        });
    });
  }, [documentStateByResourceId, openTextResourceIds, workbench?.workspaceId]);

  useEffect(() => {
    if (!state) return;

    const invalidResourceIds = (state.editors ?? [])
      .map((editor) => editor.resourceId)
      .filter((value): value is string => Boolean(value))
      .filter((resourceId) => !resourceMap.has(resourceId));

    if (invalidResourceIds.length === 0) return;

    setDocumentStateByResourceId((current) => {
      const next = { ...current };
      invalidResourceIds.forEach((resourceId) => {
        delete next[resourceId];
      });
      return next;
    });
  }, [resourceMap, state]);

  useEffect(() => {
    const dirtyResourceIds = Object.entries(documentStateByResourceId)
      .filter(([, value]) => !value.loading && value.content !== value.savedContent)
      .map(([resourceId]) => resourceId);

    if (dirtyResourceIds.length === 0) return;

    const timer = window.setTimeout(() => {
      dirtyResourceIds.forEach((resourceId) => {
        void saveDocumentContent(resourceId);
      });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [documentStateByResourceId, saveDocumentContent]);

  useEffect(() => {
    if (!state) return;
    if (state.editorLayout || state.editors.length === 0) return;

    const defaultPaneId = 'pane-1';
    updateWorkbenchState({
      editorLayout: createLeaf(
        defaultPaneId,
        state.editors.map((editor) => editor.id),
        state.activeEditorId ?? state.editors[0]?.id ?? null
      ),
      activeEditorPaneId: defaultPaneId
    });
  }, [state, updateWorkbenchState]);

  useEffect(() => {
    if (!workbench?.workspaceId || !workbench.id || !state) return;
    let cancelled = false;
    void learningApi
      .listConversationSessions(workbench.workspaceId, {
        workbenchId: workbench.id,
        source: 'workbench_ai',
        includeMessages: true,
        limit: 30
      })
      .then((result) => {
        if (cancelled) return;
        const sessions = Array.isArray(result.sessions) ? result.sessions : [];
        mergeAiSessionsFromHistory(sessions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workbench?.id, workbench?.workspaceId, Boolean(state)]);

  useEffect(() => {
    const flush = () => {
      const store = useWorkbenchStore.getState();
      if (store.dirty) {
        void store.saveNow();
      }
      Object.entries(documentStateByResourceId)
        .filter(([, value]) => !value.loading && value.content !== value.savedContent)
        .forEach(([resourceId]) => {
          void saveDocumentContent(resourceId, { force: true });
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      flush();
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [documentStateByResourceId, saveDocumentContent]);

  useEffect(() => {
    if (!state) return;

    const editorsNeedingMetadata = state.editors.filter(
      (editor) =>
        typeof editor.viewState.editorGroupId !== 'string' ||
        typeof editor.viewState.editorOrder !== 'number'
    );

    if (editorsNeedingMetadata.length === 0) return;

    editorsNeedingMetadata.forEach((editor, index) => {
      updateEditorViewState(editor.id, {
        editorGroupId:
          typeof editor.viewState.editorGroupId === 'string'
            ? editor.viewState.editorGroupId
            : 'group-1',
        editorOrder:
          typeof editor.viewState.editorOrder === 'number'
            ? editor.viewState.editorOrder
            : index
      });
    });
  }, [state, updateEditorViewState]);

  useEffect(() => {
    if (!state) return;

    const resourceId = searchParams.get('resourceId');
    if (!resourceId) return;

    const existingEditor = state.editors.find((editor) => editor.resourceId === resourceId);
    const resource = resources.find((item) => item.id === resourceId);

    if (existingEditor) {
      activateEditor(existingEditor.id);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('resourceId');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    if (resource) {
      requestOpenResource(resource, { kind: 'tab' });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('resourceId');
      setSearchParams(nextParams, { replace: true });
    }
  }, [activateEditor, resources, searchParams, setSearchParams, state]);

  const handleChangeDocumentContent = (resourceId: string, content: string) => {
    setDocumentStateByResourceId((current) => ({
      ...current,
      [resourceId]: {
        ...(current[resourceId] ?? { savedContent: '' }),
        content,
        loading: false
      }
    }));
    setDocumentSaveStateByResourceId((current) => ({
      ...current,
      [resourceId]: {
        status: current[resourceId]?.status === 'saving' ? 'saving' : 'idle',
        savedAt: current[resourceId]?.savedAt
      }
    }));
    if (savingDocumentIdsRef.current.has(resourceId)) {
      pendingSaveDocumentIdsRef.current.add(resourceId);
    }
  };

  const createEditorInitialViewState = (resource: ResourceReference) => ({
    resourceName: resource.name,
    resourceType: resource.type,
    blocksuiteMode: 'page' as const
  });

  const createEditorInstance = (resource: ResourceReference) => {
    const type = getEditorTypeForResource(resource);
    const index = state?.editors.length ?? 0;

    return {
      id: `editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      title: resource.name,
      resourceId: resource.id,
      resourcePath: resource.path,
      x: 48 + (index % 8) * 28,
      y: 48 + (index % 8) * 24,
      w: type === 'notes' ? 420 : 380,
      h: type === 'notes' ? 320 : 260,
      zIndex: (state?.editors.length ?? 0) + 1,
      minimized: false,
      viewState: createEditorInitialViewState(resource)
    };
  };

  const commitOpenResource = (
    resource: ResourceReference,
    options: OpenResourceOptions
  ) => {
    const currentState = useWorkbenchStore.getState().state;
    if (!currentState) return;

    const existingEditor = currentState.editors.find((editor) => editor.resourceId === resource.id);
    if (existingEditor) {
      activateEditor(existingEditor.id, options.kind === 'split' ? options.paneId : options.paneId);
      return;
    }

    if (options.kind === 'tab' && options.bindEditorId) {
      bindResourceToEditor(options.bindEditorId, resource);
      updateEditorViewState(options.bindEditorId, createEditorInitialViewState(resource));
      activateEditor(options.bindEditorId);
      setResourcePickerState(null);
      return;
    }

    if (options.kind === 'split') {
      if (!state || !options.paneId || options.placement === 'center') {
        addEditor(
          getEditorTypeForResource(resource),
          resource,
          createEditorInitialViewState(resource),
          options.paneId
        );
        return;
      }

      const baseLayout = getResolvedLayout(
        state.editorLayout,
        state.editors.map((editor) => editor.id),
        state.activeEditorId
      );
      if (!baseLayout) {
        addEditor(
          getEditorTypeForResource(resource),
          resource,
          createEditorInitialViewState(resource)
        );
        return;
      }

      const targetLeaf = findLeafById(baseLayout, options.paneId);
      if (!targetLeaf) return;

      const newEditor = createEditorInstance(resource);
      const nextPaneId = createPaneId();
      const isHorizontalSplit = options.placement === 'left' || options.placement === 'right';
      const nextLeaf = createLeaf(nextPaneId, [newEditor.id], newEditor.id);
      const currentLeaf = {
        ...targetLeaf,
        editorIds: targetLeaf.editorIds,
        activeEditorId: targetLeaf.activeEditorId ?? targetLeaf.editorIds[0] ?? null
      };

      const nextLayout = mapLayoutTree(baseLayout, options.paneId, () => ({
        id: `${options.paneId}-split-${options.placement}-${Date.now()}`,
        type: 'split',
        direction: isHorizontalSplit ? 'row' : 'column',
        ratio: 0.5,
        children:
          options.placement === 'left' || options.placement === 'top'
            ? [nextLeaf, currentLeaf]
            : [currentLeaf, nextLeaf]
      }));

      updateWorkbenchState({
        editors: [...state.editors, newEditor],
        editorLayout: nextLayout,
        activeEditorId: newEditor.id,
        activeEditorPaneId: nextPaneId
      });
      return;
    }

    addEditor(
      getEditorTypeForResource(resource),
      resource,
      createEditorInitialViewState(resource),
      options.paneId
    );
  };

  const requestOpenResource = (resource: ResourceReference, options: OpenResourceOptions) => {
    commitOpenResource(resource, options);
  };

  const handleOpenResourceReference = (resource: ResourceReference) => {
    if (!state) return;

    if (!resourceMap.has(resource.id)) {
      setResources([...resources, resource]);
    }

    const existingEditor = state.editors.find((editor) => editor.resourceId === resource.id);
    if (existingEditor) {
      activateEditor(existingEditor.id);
      return;
    }

    requestOpenResource(resource, { kind: 'tab' });
  };

  const handleOpenResourceInWorkbench = (file: FileSystemObject) => {
    if (file.nodeType !== 'file') return;

    const resource: ResourceReference = {
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.fileCategory || file.extension || 'file',
      extension: file.extension,
      mimeType: file.mimeType,
      fileCategory: file.fileCategory,
      isBinary: file.isBinary
    };

    handleOpenResourceReference(resource);
  };

  const handleCreateNote = async () => {
    if (!workbench?.workspaceId) return;

    const defaultName = `note-${new Date().toISOString().slice(0, 10)}.md`;
    const name = prompt('Note file name', defaultName)?.trim();
    if (!name) return;

    const finalName = /\.[^./]+$/.test(name) ? name : `${name}.md`;
    try {
      const created = await fileSystemApi.createFile(workbench.workspaceId, {
        name: finalName,
        fileCategory: 'note',
        workbenchId: workbench.id,
        resourceRole: 'note',
        resourceType: 'note',
        scope: 'workbench',
        origin: 'user'
      });
      await refreshWorkbenchResources();
      handleOpenResourceInWorkbench(created);
    } catch (createError) {
      console.error('Failed to create note:', createError);
    }
  };

  const refreshWorkbenchResources = async () => {
    if (!workbench?.id) return;
    const groups = await workbenchApi.getResourceGroups(workbench.id);
    setResources([...groups.sources, ...groups.files, ...groups.generated]);
  };

  const uploadResourcesToTarget = async (selectedFiles: File[]) => {
    if (!workbench?.workspaceId || selectedFiles.length === 0) return;

    await fileSystemApi.upload(workbench.workspaceId, selectedFiles, undefined, undefined, {
      workbenchId: workbench.id,
      resourceRole: 'source',
      scope: 'workbench',
      origin: 'upload'
    });
    await refreshWorkbenchResources();
  };

  const addWebsiteSource = async ({ title, url }: { title: string; url: string }) => {
    if (!workbench?.workspaceId) return;

    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const sourceTitle = title.trim() || makeTitleFromUrl(normalizedUrl);

    await fileSystemApi.importUrl(workbench.workspaceId, {
      url: normalizedUrl,
      title: sourceTitle,
      workbenchId: workbench.id,
      resourceRole: 'source',
      resourceType: 'source',
      scope: 'workbench',
      origin: 'web'
    });
    await refreshWorkbenchResources();
  };

  const discoverSources = async ({ query, maxResults }: { query: string; maxResults?: number }) => {
    if (!workbench?.workspaceId) return [];
    const response = await fileSystemApi.discoverSources(workbench.workspaceId, {
      query,
      maxResults,
      provider: 'auto'
    });
    return response.results;
  };

  const importDiscoveredSources = async (sources: DiscoveredResource[]) => {
    if (!workbench?.workspaceId || sources.length === 0) return;

    for (const source of sources) {
      await fileSystemApi.importUrl(workbench.workspaceId, {
        url: source.url,
        title: source.title,
        workbenchId: workbench.id,
        resourceRole: 'source',
        resourceType: 'source',
        scope: 'workbench',
        origin: 'web'
      });
    }
    await refreshWorkbenchResources();
  };

  const addCopiedTextSource = async ({ title, content }: { title: string; content: string }) => {
    if (!workbench?.workspaceId) return;

    const sourceTitle = title.trim() || 'pasted-source';

    await fileSystemApi.createFile(workbench.workspaceId, {
      name: makeSourceFilename(sourceTitle, 'pasted-source'),
      fileCategory: 'text-source',
      workbenchId: workbench.id,
      resourceRole: 'source',
      resourceType: 'source',
      scope: 'workbench',
      origin: 'user',
      content: `# ${sourceTitle}\n\nSource type: copied text\n\n${content.trim()}\n`
    });
    await refreshWorkbenchResources();
  };

  const handleUploadResources = () => {
    if (!workbench?.workspaceId) return;
    setIsAddSourcesOpen(true);
  };

  const handleDuplicateResource = async (resource: ResourceReference) => {
    if (!workbench?.workspaceId) return;

    try {
      const originalContent = canEditResource(resource)
        ? (await fileSystemApi.getContent(workbench.workspaceId, resource.id)).content
        : '';
      const extension = resource.extension || resource.name.split('.').pop() || '';
      const baseName = resource.name.replace(/\.[^/.]+$/, '') || resource.name;
      const duplicateName = extension ? `${baseName}-copy.${extension}` : `${baseName}-copy`;

      const created = await fileSystemApi.createFile(workbench.workspaceId, {
        name: duplicateName,
        content: originalContent,
        fileCategory: resource.fileCategory,
        mimeType: resource.mimeType,
        workbenchId: workbench.id,
        resourceRole: resource.resourceType || 'file',
        resourceType: resource.resourceType || 'file',
        scope: 'workbench',
        origin: resource.origin || 'user',
        metadata: resource.metadata
      });
      await refreshWorkbenchResources();
      handleOpenResourceInWorkbench(created);
    } catch (error) {
      console.error('Failed to duplicate resource:', error);
    }
  };

  const handleDeleteResource = async (resource: ResourceReference) => {
    if (!workbench?.workspaceId || !state) return;
    const confirmed = window.confirm(`Delete "${resource.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await fileSystemApi.remove(workbench.workspaceId, resource.id);
      state.editors
        .filter((editor) => editor.resourceId === resource.id)
        .forEach((editor) => closeEditor(editor.id));
      await refreshWorkbenchResources();
    } catch (error) {
      console.error('Failed to delete resource:', error);
    }
  };

  const handleReorderResources = async (orderedIds: string[]) => {
    if (!workbench?.id) return;
    try {
      const groups = await workbenchApi.reorderResources(workbench.id, orderedIds);
      setResources([...groups.sources, ...groups.files, ...groups.generated]);
    } catch (error) {
      console.error('Failed to reorder resources:', error);
      await refreshWorkbenchResources();
    }
  };

  const handleDropResourceToPane = (
    resource: ResourceReference,
    paneId: string,
    placement: WorkbenchDropPlacement
  ) => {
    requestOpenResource(resource, { kind: 'split', paneId, placement });
  };

  const handleCreateAiPanel = () => {
    const latestState = useWorkbenchStore.getState().state;
    const sessions = getAiSessions(latestState?.aiAssistant, 'AI 对话');
    const activeSessionId =
      latestState?.aiAssistant?.activeSessionId && sessions.some((session) => session.id === latestState.aiAssistant?.activeSessionId)
        ? latestState.aiAssistant.activeSessionId
        : sessions[0].id;
    updateWorkbenchState({
      aiAssistant: {
        id: latestState?.aiAssistant?.id || `ai-assistant-${workbench?.id || Date.now()}`,
        title: sessions.find((session) => session.id === activeSessionId)?.title || 'AI 对话',
        activeSessionId,
        sessions,
        viewState: sessions.find((session) => session.id === activeSessionId)?.viewState || { messages: [], contextHint: 'workbench' }
      },
      aiToolPanel: {
        id: latestState?.aiToolPanel?.id || `ai-tool-panel-${workbench?.id || Date.now()}`,
        activeTool: 'chat',
        mode: latestState?.aiToolPanel?.mode || 'floating',
        isOpen: true,
        sidebarWidth: latestState?.aiToolPanel?.sidebarWidth || 520
      }
    });
  };

  const handleCreateStudioPanel = () => {
    const latestState = useWorkbenchStore.getState().state;
    setStudioTemplateLaunch((current) => ({ templateId: null, requestId: current.requestId + 1 }));
    updateWorkbenchState({
      aiStudio: {
        id: latestState?.aiStudio?.id || `ai-studio-${workbench?.id || Date.now()}`,
        title: 'AI Studio',
        viewState: latestState?.aiStudio?.viewState || { studioResults: [] }
      },
      aiToolPanel: {
        id: latestState?.aiToolPanel?.id || `ai-tool-panel-${workbench?.id || Date.now()}`,
        activeTool: 'studio',
        mode: latestState?.aiToolPanel?.mode || 'floating',
        isOpen: true,
        sidebarWidth: latestState?.aiToolPanel?.sidebarWidth || 520
      }
    });
  };

  const handleCreatePlan = () => {
    const latestState = useWorkbenchStore.getState().state;
    setStudioTemplateLaunch((current) => ({ templateId: 'study_plan', requestId: current.requestId + 1 }));
    updateWorkbenchState({
      aiStudio: {
        id: latestState?.aiStudio?.id || `ai-studio-${workbench?.id || Date.now()}`,
        title: 'AI Studio',
        viewState: latestState?.aiStudio?.viewState || { studioResults: [] }
      },
      aiToolPanel: {
        id: latestState?.aiToolPanel?.id || `ai-tool-panel-${workbench?.id || Date.now()}`,
        activeTool: 'studio',
        mode: latestState?.aiToolPanel?.mode || 'floating',
        isOpen: true,
        sidebarWidth: latestState?.aiToolPanel?.sidebarWidth || 520
      }
    });
  };

  const updateAiToolPanelState = (patch: Partial<AIToolPanelState> = {}) => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const currentPanel = latestState.aiToolPanel || {
      id: `ai-tool-panel-${workbench?.id || Date.now()}`,
      activeTool: 'chat' as const,
      mode: 'floating' as const,
      isOpen: false,
      sidebarWidth: 520
    };
    updateWorkbenchState({
      aiToolPanel: {
        ...currentPanel,
        ...patch,
        sidebarWidth: typeof patch.sidebarWidth === 'number' ? patch.sidebarWidth : currentPanel.sidebarWidth || 520
      }
    });
  };

  const updateAiAssistantState = (patch: Partial<NonNullable<Workbench['state']>['aiAssistant']> = {}) => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const currentSessions = getAiSessions(latestState.aiAssistant, 'AI 对话');
    const nextSessions = patch.sessions || currentSessions;
    const nextActiveSessionId =
      patch.activeSessionId && nextSessions.some((session) => session.id === patch.activeSessionId)
        ? patch.activeSessionId
        : latestState.aiAssistant?.activeSessionId && nextSessions.some((session) => session.id === latestState.aiAssistant?.activeSessionId)
          ? latestState.aiAssistant.activeSessionId
          : nextSessions[0]?.id;
    const nextActiveSession = nextSessions.find((session) => session.id === nextActiveSessionId) || nextSessions[0];
    const nextViewState =
      patch.viewState ||
      nextActiveSession?.viewState ||
      latestState.aiAssistant?.viewState || { messages: [], contextHint: 'workbench' };
    const baseAssistant = {
      id: latestState.aiAssistant?.id || `ai-assistant-${workbench?.id || Date.now()}`,
      title: patch.title || nextActiveSession?.title || latestState.aiAssistant?.title || 'AI 对话',
      activeSessionId: nextActiveSessionId,
      sessions: nextSessions,
      viewState: nextViewState
    };
    updateWorkbenchState({
      aiAssistant: {
        ...baseAssistant,
        ...patch,
        activeSessionId: nextActiveSessionId,
        sessions: nextSessions,
        viewState: nextViewState
      }
    });
  };

  const handleUpdateAiAssistantViewState = (_editorId: string, patch: Record<string, any>) => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const sessions = getAiSessions(latestState.aiAssistant, 'AI 对话');
    const activeSessionId =
      latestState.aiAssistant?.activeSessionId && sessions.some((session) => session.id === latestState.aiAssistant?.activeSessionId)
        ? latestState.aiAssistant.activeSessionId
        : sessions[0].id;
    const previousSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];
    const nextViewState = {
      ...(previousSession.viewState || {}),
      ...patch
    };
    const nextMessages = Array.isArray(nextViewState.messages) ? (nextViewState.messages as AiChatMessage[]) : [];
    const nextTitle =
      previousSession.title === 'AI 对话' || previousSession.title === '新建 AI 对话'
        ? makeLocalAiChatTitle(nextMessages)
        : previousSession.title;
    const nextSessions = sessions.map((session) =>
      session.id === activeSessionId
        ? {
            ...session,
            title: nextTitle,
            updatedAt: new Date().toISOString(),
            viewState: nextViewState
          }
        : session
    );
    const currentAssistant = latestState.aiAssistant || {
      id: `ai-assistant-${workbench?.id || Date.now()}`,
      title: 'AI 对话',
      activeSessionId,
      sessions,
      viewState: { messages: [], contextHint: 'workbench' }
    };
    const nextAssistant = {
      ...currentAssistant,
      title: nextTitle,
      activeSessionId,
      sessions: nextSessions,
      viewState: nextViewState
    };

    useWorkbenchStore.setState((current) => {
      if (!current.state) return current;
      return {
        state: {
          ...current.state,
          aiAssistant: nextAssistant
        },
        dirty: true,
        saveStatus: 'idle'
      };
    });
    useWorkbenchStore.getState().scheduleSave();
    if ('lastModel' in patch || 'lastContextDebug' in patch) {
      void useWorkbenchStore.getState().saveNow();
    }
  };

  const updateAiStudioState = (patch: Partial<AIStudioState> = {}) => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const currentStudio = latestState.aiStudio || {
      id: `ai-studio-${workbench?.id || Date.now()}`,
      title: 'AI Studio',
      viewState: { studioResults: [] }
    };
    updateWorkbenchState({
      aiStudio: {
        ...currentStudio,
        ...patch,
        viewState: patch.viewState || currentStudio.viewState || { studioResults: [] }
      }
    });
  };

  const handleUpdateAiStudioViewState = (_editorId: string, patch: Record<string, any>) => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const currentStudio = latestState.aiStudio || {
      id: `ai-studio-${workbench?.id || Date.now()}`,
      title: 'AI Studio',
      viewState: { studioResults: [] }
    };
    updateWorkbenchState({
      aiStudio: {
        ...currentStudio,
        viewState: {
          ...(currentStudio.viewState || {}),
          ...patch
        }
      }
    });
  };

  const handleCreateAiSession = () => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const sessions = getAiSessions(latestState.aiAssistant, 'AI 对话');
    const blankSession = sessions.find(isAiSessionBlank);
    if (blankSession) {
      updateAiAssistantState({
        activeSessionId: blankSession.id,
        title: blankSession.title,
        viewState: blankSession.viewState
      });
      updateAiToolPanelState({ isOpen: true, activeTool: 'chat' });
      return;
    }
    const session = makeAiSession();
    updateAiAssistantState({
      activeSessionId: session.id,
      sessions: [session, ...sessions],
      title: session.title,
      viewState: session.viewState
    });
    updateAiToolPanelState({ isOpen: true, activeTool: 'chat' });
  };

  const handleSelectAiSession = (sessionId: string) => {
    const latestState = useWorkbenchStore.getState().state;
    if (!latestState) return;
    const sessions = getAiSessions(latestState.aiAssistant, 'AI 对话');
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    updateAiAssistantState({
      activeSessionId: session.id,
      title: session.title,
      viewState: session.viewState
    });
    updateAiToolPanelState({ isOpen: true, activeTool: 'chat' });
  };

  useEffect(() => {
    const assistant = state?.aiAssistant;
    const sessions = getAiSessions(assistant, 'AI 对话');
    const candidates = sessions.filter((session) => {
      const messages = Array.isArray(session.viewState?.messages)
        ? (session.viewState.messages as AiChatMessage[])
        : [];
      return (
        messages.some((message) => message.role === 'user') &&
        !session.viewState?.titleSummarized &&
        session.title !== 'AI 对话' &&
        session.title !== '新建 AI 对话'
      );
    });
    const target = candidates[0];
    if (!target) return;

    let cancelled = false;
    const messages = (target.viewState.messages as AiChatMessage[]).slice(0, 4);
    void aiApi
      .chat({
        messages: [
          {
            role: 'user',
            content: [
              '请为下面这段 AI 对话生成一个简短中文标题。',
              '要求：只输出标题，不要解释；不超过 14 个中文字符；不要加引号。',
              '',
              messages.map((message) => `${message.role}: ${message.content}`).join('\n')
            ].join('\n')
          }
        ],
        context: {
          workbenchId: workbench?.id,
          workbenchTitle: workbench?.title,
          contextMode: 'auto'
        }
      })
      .then((response) => {
        if (cancelled) return;
        const title = response.reply.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
        if (!title) return;
        const latestState = useWorkbenchStore.getState().state;
        if (!latestState?.aiAssistant) return;
        const latestSessions = getAiSessions(latestState.aiAssistant, 'AI 对话').map((session) =>
          session.id === target.id
            ? {
                ...session,
                title,
                viewState: {
                  ...session.viewState,
                  titleSummarized: true
                }
              }
            : session
        );
        const activeSession =
          latestSessions.find((session) => session.id === latestState.aiAssistant?.activeSessionId) ||
          latestSessions[0];
        updateAiAssistantState({
          sessions: latestSessions,
          title: activeSession?.title || title,
          viewState: activeSession?.viewState || latestState.aiAssistant.viewState
        });
      })
      .catch(() => {
        const latestState = useWorkbenchStore.getState().state;
        if (!latestState?.aiAssistant) return;
        const latestSessions = getAiSessions(latestState.aiAssistant, 'AI 对话').map((session) =>
          session.id === target.id
            ? {
                ...session,
                viewState: {
                  ...session.viewState,
                  titleSummarized: true
                }
              }
            : session
        );
        updateAiAssistantState({ sessions: latestSessions });
      });

    return () => {
      cancelled = true;
    };
  }, [state?.aiAssistant?.sessions, workbench?.id, workbench?.title]);

  const handleCreateExternalPanel = (draft?: {
    title?: string;
    url?: string;
    description?: string;
  }) => {
    const nextTitle =
      draft?.title?.trim() || prompt('External resource title', 'External Resource')?.trim();
    if (!nextTitle) return;

    const nextUrl = draft?.url?.trim() || prompt('External resource URL', 'https://')?.trim();
    if (!nextUrl) return;

    const nextDescription =
      typeof draft?.description === 'string'
        ? draft.description.trim()
        : prompt('Description (optional)', '')?.trim() || '';

    addEditor('external', undefined, {
      externalResource: {
        title: nextTitle,
        url: nextUrl,
        description: nextDescription
      }
    });
  };

  const handleDropEditorTab = (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => {
    if (!state) return;

    const baseLayout = getResolvedLayout(
      state.editorLayout,
      state.editors.map((editor) => editor.id),
      state.activeEditorId
    );
    if (!baseLayout) return;

    const sourceLeaf = findLeafById(baseLayout, sourcePaneId);
    if (!sourceLeaf || !sourceLeaf.editorIds.includes(editorId)) return;

    if (placement === 'center') {
      if (sourcePaneId === targetPaneId) {
        activateEditor(editorId, targetPaneId);
        return;
      }

      const compactLayout = removeEditorFromLayout(baseLayout, editorId);
      if (!compactLayout) return;

      const nextLayout = updateLeafEditors(compactLayout, targetPaneId, (leaf) => ({
        ...leaf,
        editorIds: leaf.editorIds.includes(editorId) ? leaf.editorIds : [...leaf.editorIds, editorId],
        activeEditorId: editorId
      }));

      updateWorkbenchState({
        editorLayout: nextLayout,
        activeEditorId: editorId,
        activeEditorPaneId: targetPaneId
      });
      return;
    }

    if (sourcePaneId === targetPaneId && sourceLeaf.editorIds.length <= 1) {
      activateEditor(editorId, targetPaneId);
      return;
    }

    const compactLayout = removeEditorFromLayout(baseLayout, editorId);
    if (!compactLayout) return;

    const targetLeaf = findLeafById(compactLayout, targetPaneId);
    if (!targetLeaf) return;

    const nextPaneId = createPaneId();
    const isHorizontalSplit = placement === 'left' || placement === 'right';
    const nextLeaf = createLeaf(nextPaneId, [editorId], editorId);
    const currentLeaf = {
      ...targetLeaf,
      editorIds: targetLeaf.editorIds,
      activeEditorId: targetLeaf.activeEditorId ?? targetLeaf.editorIds[0] ?? null
    };

    const nextLayout = mapLayoutTree(compactLayout, targetPaneId, () => ({
      id: `${targetPaneId}-split-${placement}-${Date.now()}`,
      type: 'split',
      direction: isHorizontalSplit ? 'row' : 'column',
      ratio: 0.5,
      children:
        placement === 'left' || placement === 'top'
          ? [nextLeaf, currentLeaf]
          : [currentLeaf, nextLeaf]
    }));

    updateWorkbenchState({
      editorLayout: nextLayout,
      activeEditorId: editorId,
      activeEditorPaneId: nextPaneId
    });
  };

  const handleSaveAllEditors = async () => {
    const dirtyEntries = Object.entries(documentStateByResourceId).filter(
      ([, value]) => !value.loading && value.content !== value.savedContent
    );

    for (const [resourceId] of dirtyEntries) {
      await saveDocumentContent(resourceId, { force: true });
    }

    await saveNow();
  };

  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(Math.max(240, Math.min(520, startWidth + moveEvent.clientX - startX)));
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleRename = async () => {
    if (!workbench) return;

    const nextTitle = prompt('Workbench title', workbench.title);
    if (!nextTitle || nextTitle.trim() === workbench.title) return;

    try {
      const updated = await workbenchApi.update(workbench.id, { title: nextTitle.trim() });
      setWorkbenchMeta({ title: updated.title, description: updated.description });
    } catch (renameError) {
      console.error('Failed to rename workbench:', renameError);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isPaletteShortcut =
        (event.metaKey || event.ctrlKey) && ((event.shiftKey && key === 'p') || key === 'p');

      if (isPaletteShortcut) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }

      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#fbfbfa] p-8">
        <div className="workspace-card-in max-w-md rounded-3xl border border-[#e5e5e1] bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-[#25272b]">Unable to load workbench</h2>
          <p className="mt-2 text-sm text-[#777a80]">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-medium text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4] active:scale-95"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (loading || !workbench || !state) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#fbfbfa]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#e5e5e1] border-t-[#202124]" />
      </div>
    );
  }

  const aiSessions = getAiSessions(state.aiAssistant, 'AI 对话');
  const activeAiSessionId =
    state.aiAssistant?.activeSessionId && aiSessions.some((session) => session.id === state.aiAssistant?.activeSessionId)
      ? state.aiAssistant.activeSessionId
      : aiSessions[0].id;
  const activeAiSession = aiSessions.find((session) => session.id === activeAiSessionId) || aiSessions[0];
  const aiAssistantEditor: EditorState = {
    id: state.aiAssistant?.id || `ai-assistant-${workbench.id}`,
    type: 'ai',
    title: activeAiSession?.title || state.aiAssistant?.title || 'AI 对话',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    zIndex: 0,
    minimized: false,
    viewState: activeAiSession?.viewState || state.aiAssistant?.viewState || { messages: [], contextHint: 'workbench' }
  };
  const aiStudioEditor: EditorState = {
    id: state.aiStudio?.id || `ai-studio-${workbench.id}`,
    type: 'studio',
    title: state.aiStudio?.title || 'AI Studio',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    zIndex: 0,
    minimized: false,
    viewState: state.aiStudio?.viewState || { studioResults: [] }
  };
  const aiToolPanel = state.aiToolPanel || {
    id: `ai-tool-panel-${workbench.id}`,
    activeTool: 'chat' as const,
    mode: 'floating' as const,
    isOpen: false,
    sidebarWidth: 520
  };
  const aiToolPanelMode = aiToolPanel.mode || 'floating';
  const isAiToolPanelOpen = Boolean(aiToolPanel.isOpen);
  const aiToolPanelSidebarWidth = aiToolPanel.sidebarWidth || 520;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f5] text-[#202124]">
      {isCommandPaletteOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/20 pt-20 backdrop-blur-[3px]">
          <div className="workspace-soft-scale w-full max-w-2xl overflow-hidden rounded-3xl border border-[#e5e5e1] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
            <div className="flex items-center gap-3 border-b border-[#eeeeeb] px-5 py-4">
              <Search className="h-4 w-4 text-[#96999d]" />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Type a command"
                className="h-8 flex-1 border-0 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#a6a8ab]"
              />
              <span className="rounded-lg border border-[#e5e5e1] bg-[#f6f6f4] px-2 py-1 text-[10px] uppercase tracking-wide text-[#96999d]">
                Esc
              </span>
            </div>
            <div className="max-h-[420px] overflow-y-auto py-2">
              {filteredCommandItems.length === 0 ? (
                <div className="px-5 py-6 text-sm text-[#777a80]">No commands found.</div>
              ) : (
                filteredCommandItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setIsCommandPaletteOpen(false);
                        setCommandQuery('');
                        item.run();
                      }}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-[#f6f6f4]"
                    >
                      <div className="rounded-xl bg-[#f1f1ef] p-2 text-[#777a80]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[#25272b]">{item.title}</div>
                        {item.subtitle && (
                          <div className="truncate text-xs text-[#96999d]">{item.subtitle}</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <div className="workspace-main relative flex min-h-0 flex-1 overflow-hidden bg-white">
        {isSidebarPinned ? (
          <div className="min-h-0 shrink-0">
            <WorkbenchSidebar
              editors={state.editors}
              resources={resourceOptions}
              workbenches={workspaceWorkbenches}
              plans={workbenchPlans}
              currentWorkbenchId={workbench.id}
              activeEditorId={state.activeEditorId}
              currentWorkbenchTitle={workbench.title}
              onActivateEditor={activateEditor}
              onResourceOpen={handleOpenResourceReference}
              onNewChat={handleCreateAiPanel}
              onNewNote={() => void handleCreateNote()}
              onNewPlan={handleCreatePlan}
              onOpenAIStudio={handleCreateStudioPanel}
              onUploadResources={handleUploadResources}
              onSearch={() => {
                setCommandQuery('');
                setIsCommandPaletteOpen(true);
              }}
              onResourceDuplicate={(resource) => void handleDuplicateResource(resource)}
              onResourceDelete={(resource) => void handleDeleteResource(resource)}
              onResourceDropToPane={(resource) => {
                const paneId = state.activeEditorPaneId ?? null;
                requestOpenResource(resource, { kind: 'split', paneId, placement: 'center' });
              }}
              onResourceReorder={(orderedIds) => void handleReorderResources(orderedIds)}
              onOpenWorkbench={(workbenchId) => navigate(`/workbenches/${workbenchId}`)}
              onPlanStepStatusChange={(planId, stepId, status) => void handlePlanStepStatusChange(planId, stepId, status)}
              onPlanAction={(planId, action, options) => void handlePlanAction(planId, action, options)}
              onPlanStepUpdate={(planId, stepId, patch) => void handlePlanStepUpdate(planId, stepId, patch)}
              onPlanFeedback={(planId, feedback) => void handlePlanFeedback(planId, feedback)}
              width={sidebarWidth}
              onResizeStart={handleSidebarResizeStart}
              variant="pinned"
            />
          </div>
        ) : (
          <div
            className="group/sidebar absolute bottom-0 left-0 top-0 z-20 w-4"
            onMouseEnter={openSidebarPreview}
            onMouseLeave={scheduleCloseSidebarPreview}
          >
            <div
              className={`absolute left-2 top-1/2 h-[calc(100%-32px)] -translate-y-1/2 w-[min(400px,calc(100vw-32px))] transition-all duration-300 ease-out ${
                isSidebarPreviewOpen
                  ? 'pointer-events-auto translate-x-0 opacity-100'
                  : 'pointer-events-none -translate-x-[calc(100%-12px)] opacity-0 group-hover/sidebar:pointer-events-auto group-hover/sidebar:translate-x-0 group-hover/sidebar:opacity-100 group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:translate-x-0 group-focus-within/sidebar:opacity-100'
              }`}
              onMouseEnter={openSidebarPreview}
              onMouseLeave={scheduleCloseSidebarPreview}
            >
              <WorkbenchSidebar
                editors={state.editors}
                resources={resourceOptions}
                workbenches={workspaceWorkbenches}
                plans={workbenchPlans}
                currentWorkbenchId={workbench.id}
                activeEditorId={state.activeEditorId}
                currentWorkbenchTitle={workbench.title}
                onActivateEditor={activateEditor}
                onResourceOpen={handleOpenResourceReference}
                onNewChat={handleCreateAiPanel}
                onNewNote={() => void handleCreateNote()}
                onNewPlan={handleCreatePlan}
                onOpenAIStudio={handleCreateStudioPanel}
                onUploadResources={handleUploadResources}
                onSearch={() => {
                  setCommandQuery('');
                  setIsCommandPaletteOpen(true);
                }}
                onResourceDuplicate={(resource) => void handleDuplicateResource(resource)}
                onResourceDelete={(resource) => void handleDeleteResource(resource)}
                onResourceDropToPane={(resource) => {
                  const paneId = state.activeEditorPaneId ?? null;
                  requestOpenResource(resource, { kind: 'split', paneId, placement: 'center' });
                }}
                onResourceReorder={(orderedIds) => void handleReorderResources(orderedIds)}
                onOpenWorkbench={(workbenchId) => navigate(`/workbenches/${workbenchId}`)}
                onPlanStepStatusChange={(planId, stepId, status) => void handlePlanStepStatusChange(planId, stepId, status)}
                onPlanAction={(planId, action, options) => void handlePlanAction(planId, action, options)}
                onPlanStepUpdate={(planId, stepId, patch) => void handlePlanStepUpdate(planId, stepId, patch)}
                onPlanFeedback={(planId, feedback) => void handlePlanFeedback(planId, feedback)}
                width={sidebarWidth}
                onResizeStart={handleSidebarResizeStart}
                variant="preview"
              />
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-hidden">
          <WorkbenchEditor
            workspaceId={workbench.workspaceId}
            editors={state.editors}
            activeEditorId={state.activeEditorId}
            activePaneId={state.activeEditorPaneId ?? null}
            editorLayout={state.editorLayout ?? null}
            resources={resourceOptions}
            documentStateByResourceId={documentStateByResourceId}
            documentSaveStateByResourceId={documentSaveStateByResourceId}
            onActivateEditor={(editorId, paneId) => activateEditor(editorId, paneId)}
            onCloseEditor={closeEditor}
            onBindResource={(editorId) => setResourcePickerState({ mode: 'replace', editorId })}
            onChangeDocumentContent={handleChangeDocumentContent}
            onSaveDocumentContent={(resourceId, content, options) =>
              void saveDocumentContent(resourceId, { force: true, contentOverride: content, ...options })
            }
            onUpdateEditorViewState={handleUpdateEditorViewState}
            onActivatePane={(paneId) => updateWorkbenchState({ activeEditorPaneId: paneId })}
            onInitializeLayout={(layout, paneId) =>
              updateWorkbenchState({
                editorLayout: layout,
                activeEditorPaneId: paneId
              })
            }
            onDropEditorTab={handleDropEditorTab}
            onDropResourceToPane={handleDropResourceToPane}
            onAddEditor={(paneId) => setResourcePickerState({ mode: 'add-tab', paneId: paneId ?? state.activeEditorPaneId ?? null })}
            onClosePane={(paneId) => {
              const targetLeaf = findLeafById(state.editorLayout, paneId);
              if (!targetLeaf) return;
              targetLeaf.editorIds.forEach((editorId) => closeEditor(editorId));
            }}
            onUpdateSplitRatio={(splitId, ratio) => {
              if (!state?.editorLayout) return;

              const updateRatio = (node: EditorLayoutNode): EditorLayoutNode => {
                if (node.type === 'leaf') return node;
                if (node.id === splitId) return { ...node, ratio };
                return {
                  ...node,
                  children: [updateRatio(node.children[0]), updateRatio(node.children[1])]
                };
              };

              updateWorkbenchState({
                editorLayout: updateRatio(state.editorLayout)
              });
            }}
            onToggleSidebar={() => setIsSidebarPinned((value) => !value)}
            isSidebarPinned={isSidebarPinned}
            aiContext={aiAssistantContext}
          />
        </div>
        {isAiToolPanelOpen && aiToolPanelMode === 'sidebar' && (
          <AIToolPanelShell
            activeTool={aiToolPanel.activeTool}
            chatEditor={aiAssistantEditor}
            studioEditor={aiStudioEditor}
            workspaceId={workbench.workspaceId}
            mode={aiToolPanelMode}
            sessions={aiSessions}
            activeSessionId={activeAiSessionId}
            sidebarWidth={aiToolPanelSidebarWidth}
            aiContext={aiAssistantContext}
            onModeChange={(mode) => updateAiToolPanelState({ mode, isOpen: true })}
            onClose={() => updateAiToolPanelState({ isOpen: false })}
            onResizeSidebar={(width) => updateAiToolPanelState({ sidebarWidth: width })}
            onSelectTool={(activeTool) => updateAiToolPanelState({ activeTool, isOpen: true })}
            onSelectSession={handleSelectAiSession}
            onCreateSession={handleCreateAiSession}
            onUpdateChatViewState={handleUpdateAiAssistantViewState}
            onUpdateStudioViewState={handleUpdateAiStudioViewState}
            onApplyNoteEdit={(resourceId, content) => saveDocumentContent(resourceId, { force: true, contentOverride: content })}
            onOpenResource={handleOpenResourceReference}
            resources={resourceOptions}
            initialStudioTemplateId={studioTemplateLaunch.templateId}
            initialStudioTemplateRequestId={studioTemplateLaunch.requestId}
          />
        )}
      </div>

      {isAiToolPanelOpen && aiToolPanelMode !== 'sidebar' && (
        <AIToolPanelShell
          activeTool={aiToolPanel.activeTool}
          chatEditor={aiAssistantEditor}
          studioEditor={aiStudioEditor}
          workspaceId={workbench.workspaceId}
          mode={aiToolPanelMode}
          sessions={aiSessions}
          activeSessionId={activeAiSessionId}
          sidebarWidth={aiToolPanelSidebarWidth}
          aiContext={aiAssistantContext}
          onModeChange={(mode) => updateAiToolPanelState({ mode, isOpen: true })}
          onClose={() => updateAiToolPanelState({ isOpen: false })}
          onResizeSidebar={(width) => updateAiToolPanelState({ sidebarWidth: width })}
          onSelectTool={(activeTool) => updateAiToolPanelState({ activeTool, isOpen: true })}
          onSelectSession={handleSelectAiSession}
          onCreateSession={handleCreateAiSession}
          onUpdateChatViewState={handleUpdateAiAssistantViewState}
          onUpdateStudioViewState={handleUpdateAiStudioViewState}
          onApplyNoteEdit={(resourceId, content) => saveDocumentContent(resourceId, { force: true, contentOverride: content })}
          onOpenResource={handleOpenResourceReference}
          resources={resourceOptions}
          initialStudioTemplateId={studioTemplateLaunch.templateId}
          initialStudioTemplateRequestId={studioTemplateLaunch.requestId}
        />
      )}

      <ResourcePickerDialog
        open={Boolean(resourcePickerState)}
        resources={resourceOptions}
        onClose={() => setResourcePickerState(null)}
        onSelect={(resource) => {
          if (resourcePickerState?.mode === 'replace' && resourcePickerState.editorId) {
            requestOpenResource(resource, { kind: 'tab', bindEditorId: resourcePickerState.editorId });
            return;
          }

          if (resourcePickerState?.mode === 'add-tab') {
            requestOpenResource(resource, { kind: 'tab', paneId: resourcePickerState.paneId ?? undefined });
          }
        }}
      />

      <AddSourcesDialog
        isOpen={isAddSourcesOpen}
        onClose={() => setIsAddSourcesOpen(false)}
        onUploadFiles={uploadResourcesToTarget}
        onAddWebsite={addWebsiteSource}
        onAddText={addCopiedTextSource}
        onDiscoverSources={discoverSources}
        onImportDiscoveredSources={importDiscoveredSources}
      />

      <WorkbenchSettingsDialog
        isOpen={isSettingsOpen}
        theme={theme}
        onClose={() => setIsSettingsOpen(false)}
        onThemeChange={setTheme}
      />
    </div>
  );
}

export default function WorkbenchPage() {
  return (
    <DndProvider backend={HTML5Backend}>
      <WorkbenchPageContent />
    </DndProvider>
  );
}
