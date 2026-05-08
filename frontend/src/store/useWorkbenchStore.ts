import { create } from 'zustand';
import {
  EditorLayoutNode,
  EditorState,
  ResourceReference,
  Workbench,
  WorkbenchEditorType,
  WorkbenchState
} from '../types';
import { workbenchApi } from '../services/workbenchApi';
import {
  findFirstLeafId,
  findLeafById,
  findPaneContainingEditor,
  removeEditorFromLayout,
  updateLeafEditors
} from '../utils/workbenchLayout';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface WorkbenchStoreState {
  workbench: Workbench | null;
  state: WorkbenchState | null;
  resources: ResourceReference[];
  loading: boolean;
  saveStatus: SaveStatus;
  dirty: boolean;
  error: string | null;
  saveTimer: number | null;
  loadWorkbench: (id: string) => Promise<void>;
  setResources: (resources: ResourceReference[]) => void;
  setWorkbenchMeta: (patch: Partial<Pick<Workbench, 'title' | 'description'>>) => void;
  addEditor: (
    type: WorkbenchEditorType,
    resource?: ResourceReference,
    initialViewState?: Record<string, any>,
    paneId?: string | null
  ) => void;
  duplicateEditor: (editorId: string, initialViewState?: Record<string, any>) => string | null;
  updateEditor: (editorId: string, patch: Partial<EditorState>) => void;
  updateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  updateWorkbenchState: (patch: Partial<WorkbenchState>) => void;
  activateEditor: (editorId: string, paneId?: string | null) => void;
  closeEditor: (editorId: string) => void;
  bindResourceToEditor: (editorId: string, resource: ResourceReference) => void;
  scheduleSave: () => void;
  saveNow: () => Promise<void>;
  reset: () => void;
}

const DEFAULT_LAYOUT_MODE = 'freeform' as const;
const LIVE_CONTEXT_VIEW_STATE_KEYS = new Set([
  'visibleLineRange',
  'visiblePages',
  'primaryPage',
  'visibleBlockIds',
  'scrollRatio',
  'selectedText',
  'approxChunkIndex',
  'contextUpdatedAt',
  'contextVersion'
]);

const isLiveContextPatch = (patch: Record<string, any>) => {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) => LIVE_CONTEXT_VIEW_STATE_KEYS.has(key));
};

const truncateText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const sanitizeMessages = (messages: unknown) => {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-40)
    .map((message) => ({
      role: typeof message?.role === 'string' ? message.role : 'assistant',
      content: String(message?.content || '').slice(0, 30000),
      createdAt: typeof message?.createdAt === 'string' ? message.createdAt : undefined
    }))
    .filter((message) => message.content || message.role === 'assistant');
};

const sanitizeCitation = (citation: any) => ({
  sourceId: typeof citation?.sourceId === 'string' ? citation.sourceId : undefined,
  fileId: typeof citation?.fileId === 'string' ? citation.fileId : '',
  fileName: typeof citation?.fileName === 'string' ? citation.fileName : '',
  label: typeof citation?.label === 'string' ? citation.label : '',
  locator: citation?.locator && typeof citation.locator === 'object' ? citation.locator : undefined,
  confidence: citation?.confidence,
  preview: truncateText(citation?.preview, 500),
  supportSnippets: Array.isArray(citation?.supportSnippets)
    ? citation.supportSnippets.slice(0, 4).map((snippet: any) => ({
        text: String(snippet?.text || '').slice(0, 700),
        locator: snippet?.locator && typeof snippet.locator === 'object' ? snippet.locator : undefined,
        score: typeof snippet?.score === 'number' ? snippet.score : undefined
      }))
    : undefined,
  citationQuality:
    citation?.citationQuality && typeof citation.citationQuality === 'object'
      ? {
          supportCount: citation.citationQuality.supportCount,
          sourceCount: citation.citationQuality.sourceCount,
          grounded: Boolean(citation.citationQuality.grounded)
        }
      : undefined,
  createdAt: typeof citation?.createdAt === 'string' ? citation.createdAt : undefined
});

const sanitizeSource = (source: any) => ({
  sourceId: typeof source?.sourceId === 'string' ? source.sourceId : undefined,
  sourceType: source?.sourceType,
  confidence: source?.confidence,
  fileId: typeof source?.fileId === 'string' ? source.fileId : '',
  fileName: typeof source?.fileName === 'string' ? source.fileName : '',
  label: typeof source?.label === 'string' ? source.label : '',
  locator: source?.locator && typeof source.locator === 'object' ? source.locator : undefined,
  score: typeof source?.score === 'number' ? source.score : undefined,
  retrievalReason: truncateText(source?.retrievalReason, 240),
  matchedTerms: Array.isArray(source?.matchedTerms) ? source.matchedTerms.slice(0, 8) : undefined,
  scoreBreakdown: source?.scoreBreakdown && typeof source.scoreBreakdown === 'object' ? source.scoreBreakdown : undefined,
  preview: truncateText(source?.preview, 500),
  supportSnippets: Array.isArray(source?.supportSnippets)
    ? source.supportSnippets.slice(0, 4).map((snippet: any) => ({
        text: String(snippet?.text || '').slice(0, 700),
        locator: snippet?.locator && typeof snippet.locator === 'object' ? snippet.locator : undefined,
        score: typeof snippet?.score === 'number' ? snippet.score : undefined
      }))
    : undefined,
  citationQuality:
    source?.citationQuality && typeof source.citationQuality === 'object'
      ? {
          supportCount: source.citationQuality.supportCount,
          sourceCount: source.citationQuality.sourceCount,
          grounded: Boolean(source.citationQuality.grounded)
        }
      : undefined,
  includedInPrompt: Boolean(source?.includedInPrompt)
});

const sanitizeLastContextDebug = (debug: any) => {
  if (!debug || typeof debug !== 'object') return undefined;
  const capsule = debug.contextCapsule && typeof debug.contextCapsule === 'object' ? debug.contextCapsule : {};
  return {
    contextPolicy: debug.contextPolicy || null,
    usedContextSummary: debug.usedContextSummary || null,
    contextCapsule: {
      citations: Array.isArray(capsule.citations) ? capsule.citations.slice(0, 12).map(sanitizeCitation) : [],
      sourceMap: Array.isArray(capsule.sourceMap) ? capsule.sourceMap.slice(0, 20).map(sanitizeSource) : [],
      estimatedTokensByLayer: capsule.estimatedTokensByLayer || null,
      fallbackReasons: Array.isArray(capsule.fallbackReasons) ? capsule.fallbackReasons.slice(0, 8) : [],
      clippedItems: Array.isArray(capsule.clippedItems) ? capsule.clippedItems.slice(0, 12) : []
    }
  };
};

const sanitizeViewStateForSave = (viewState: Record<string, any> = {}) => {
  const next = { ...viewState };

  if (Array.isArray(next.messages)) {
    next.messages = sanitizeMessages(next.messages);
  }

  if (Array.isArray(next.persistentCitations)) {
    next.persistentCitations = next.persistentCitations.slice(0, 12).map(sanitizeCitation);
  }

  if (next.lockedContextSelection?.content) {
    next.lockedContextSelection = {
      ...next.lockedContextSelection,
      content: String(next.lockedContextSelection.content).slice(0, 12000)
    };
  }

  if (next.lastContextDebug) {
    next.lastContextDebug = sanitizeLastContextDebug(next.lastContextDebug);
  }

  delete next.blocksuiteSourceContent;
  delete next.selectedText;

  return next;
};

const sanitizeWorkbenchStateForSave = (state: WorkbenchState): WorkbenchState => ({
  ...state,
  aiAssistant: state.aiAssistant
    ? {
        ...state.aiAssistant,
        viewState: sanitizeViewStateForSave(state.aiAssistant.viewState),
        sessions: Array.isArray(state.aiAssistant.sessions)
          ? state.aiAssistant.sessions.slice(-30).map((session) => ({
              ...session,
              viewState: sanitizeViewStateForSave(session.viewState)
            }))
          : state.aiAssistant.sessions
      }
    : state.aiAssistant,
  editors: state.editors.map((editor) => ({
    ...editor,
    viewState: sanitizeViewStateForSave(editor.viewState)
  }))
});

const makeDefaultState = (workbenchId: string): WorkbenchState => ({
  workbenchId,
  editors: [],
  layoutMode: DEFAULT_LAYOUT_MODE,
  activeEditorId: null,
  activeEditorPaneId: null,
  editorLayout: null,
  aiAssistant: {
    id: `ai-assistant-${workbenchId}`,
    title: 'AI 对话',
    mode: 'floating',
    isOpen: false,
    activeSessionId: `ai-session-${workbenchId}`,
    sidebarWidth: 460,
    sessions: [
      {
        id: `ai-session-${workbenchId}`,
        title: 'AI 对话',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        viewState: { messages: [], contextHint: 'workbench' }
      }
    ],
    viewState: { messages: [], contextHint: 'workbench' }
  },
  version: 1
});

const normalizeEditorLayout = (node: EditorLayoutNode | null | undefined): EditorLayoutNode | null => {
  if (!node) return null;

  if (node.type === 'leaf') {
    const editorIds = Array.isArray(node.editorIds)
      ? node.editorIds
      : Array.isArray(node.panelIds)
        ? node.panelIds
        : [];

    return {
      id: node.id,
      type: 'leaf',
      editorIds,
      activeEditorId:
        typeof node.activeEditorId === 'string'
          ? node.activeEditorId
          : typeof node.activePanelId === 'string'
            ? node.activePanelId
            : editorIds[0] ?? null
    };
  }

  return {
    ...node,
    ratio: typeof node.ratio === 'number' ? node.ratio : 0.5,
    children: [
      normalizeEditorLayout(node.children[0]) as EditorLayoutNode,
      normalizeEditorLayout(node.children[1]) as EditorLayoutNode
    ]
  };
};

const normalizeWorkbenchState = (
  state: Partial<WorkbenchState> | null | undefined,
  workbenchId: string
): WorkbenchState => {
  const defaultState = makeDefaultState(workbenchId);
  const defaultAssistant = defaultState.aiAssistant!;
  const assistant = state?.aiAssistant && typeof state.aiAssistant === 'object'
    ? state.aiAssistant
    : defaultAssistant;
  const legacyViewState =
    assistant?.viewState && typeof assistant.viewState === 'object'
      ? assistant.viewState
      : defaultAssistant.viewState;
  const normalizedSessions = Array.isArray(assistant?.sessions) && assistant.sessions.length > 0
    ? assistant.sessions.map((session: any, index: number) => ({
        id: typeof session?.id === 'string' ? session.id : `ai-session-${workbenchId}-${index}`,
        title: typeof session?.title === 'string' && session.title.trim() ? session.title : `AI 对话 ${index + 1}`,
        createdAt: typeof session?.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
        updatedAt: typeof session?.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
        viewState: session?.viewState && typeof session.viewState === 'object'
          ? session.viewState
          : { messages: [], contextHint: 'workbench' }
      }))
    : [
        {
          id: defaultAssistant.activeSessionId || `ai-session-${workbenchId}`,
          title: typeof assistant?.title === 'string' && assistant.title.trim() && assistant.title !== '新建 AI 对话'
            ? assistant.title
            : 'AI 对话',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          viewState: legacyViewState
        }
      ];
  const activeSessionId =
    typeof assistant?.activeSessionId === 'string' &&
    normalizedSessions.some((session) => session.id === assistant.activeSessionId)
      ? assistant.activeSessionId
      : normalizedSessions[0].id;
  const activeSession = normalizedSessions.find((session) => session.id === activeSessionId) || normalizedSessions[0];

  return {
    workbenchId,
    editors: Array.isArray(state?.editors)
      ? state.editors
      : Array.isArray(state?.panels)
        ? state.panels
        : [],
    layoutMode: DEFAULT_LAYOUT_MODE,
    activeEditorId:
      typeof state?.activeEditorId === 'string'
        ? state.activeEditorId
        : typeof state?.activePanelId === 'string'
          ? state.activePanelId
          : null,
    activeEditorPaneId:
      typeof state?.activeEditorPaneId === 'string'
        ? state.activeEditorPaneId
        : typeof state?.activePaneId === 'string'
          ? state.activePaneId
          : null,
    editorLayout: normalizeEditorLayout(state?.editorLayout),
    aiAssistant: {
      id: typeof assistant?.id === 'string' ? assistant.id : defaultAssistant.id,
      title: typeof assistant?.title === 'string' ? assistant.title : defaultAssistant.title,
      mode:
        assistant?.mode === 'sidebar' || assistant?.mode === 'fullscreen' || assistant?.mode === 'floating'
          ? assistant.mode
          : defaultAssistant.mode,
      isOpen: Boolean(assistant?.isOpen),
      activeSessionId,
      sidebarWidth:
        typeof assistant?.sidebarWidth === 'number'
          ? Math.min(760, Math.max(360, assistant.sidebarWidth))
          : defaultAssistant.sidebarWidth,
      sessions: normalizedSessions,
      viewState: activeSession.viewState
    },
    version: typeof state?.version === 'number' && state.version > 0 ? state.version : 1
  };
};

const getNextZIndex = (editors: EditorState[]) =>
  editors.reduce((max, editor) => Math.max(max, editor.zIndex), 0) + 1;

const makeEditorTitle = (type: WorkbenchEditorType, resource?: ResourceReference) => {
  if (resource) return resource.name;

  switch (type) {
    case 'resource':
      return 'Resource';
    case 'notes':
      return 'Notes';
    case 'code':
      return 'Code';
    case 'video':
      return 'Video';
    case 'external':
      return 'External Resource';
    case 'ai':
      return 'AI Assistant';
    case 'studio':
      return 'AI Studio';
  }
};

const makeEditorDefaults = (
  type: WorkbenchEditorType,
  index: number,
  resource?: ResourceReference,
  initialViewState?: Record<string, any>
): EditorState => ({
  id: `editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type,
  title: makeEditorTitle(type, resource),
  resourceId: resource?.id,
  resourcePath: resource?.path,
  x: 48 + (index % 8) * 28,
  y: 48 + (index % 8) * 24,
  w: type === 'notes' || type === 'ai' || type === 'studio' ? 420 : type === 'external' ? 460 : 380,
  h: type === 'notes' || type === 'ai' || type === 'studio' ? 320 : type === 'external' ? 320 : 260,
  zIndex: index + 1,
  minimized: false,
  viewState:
    type === 'notes'
      ? {
          content: '',
          placeholder: 'Write your notes for this task...',
          blocksuiteMode: 'page',
          blocksuiteSnapshot: null,
          ...initialViewState
        }
      : type === 'external'
        ? { externalResource: null, ...initialViewState }
        : type === 'ai'
          ? { messages: [], ...initialViewState }
          : type === 'studio'
            ? { studioResults: [], ...initialViewState }
      : resource
        ? { resourceName: resource.name, resourceType: resource.type, ...initialViewState }
        : { ...initialViewState }
});

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
  workbench: null,
  state: null,
  resources: [],
  loading: false,
  saveStatus: 'idle',
  dirty: false,
  error: null,
  saveTimer: null,

  async loadWorkbench(id) {
    set({ loading: true, error: null });

    try {
      const workbench = await workbenchApi.getById(id);
      set({
        workbench,
        state: normalizeWorkbenchState(workbench.state, workbench.id),
        loading: false,
        dirty: false,
        saveStatus: 'saved'
      });
    } catch (error: any) {
      set({
        loading: false,
        error: error?.response?.data?.error || error?.message || 'Failed to load workbench',
        saveStatus: 'error'
      });
    }
  },

  setResources(resources) {
    set({ resources });
  },

  setWorkbenchMeta(patch) {
    set((current) => ({
      workbench: current.workbench ? { ...current.workbench, ...patch } : current.workbench
    }));
  },

  addEditor(type, resource, initialViewState, paneId) {
    set((current) => {
      if (!current.state) return current;

      const editor = makeEditorDefaults(type, current.state.editors.length, resource, initialViewState);
      editor.zIndex = getNextZIndex(current.state.editors);

      let editorLayout = current.state.editorLayout;
      const targetPaneId = paneId ?? current.state.activeEditorPaneId;
      if (editorLayout && targetPaneId) {
        editorLayout = updateLeafEditors(
          editorLayout,
          targetPaneId,
          (leaf) => ({
            ...leaf,
            editorIds: [...leaf.editorIds, editor.id],
            activeEditorId: editor.id
          })
        );
      }

      return {
        state: {
          ...current.state,
          editors: [...current.state.editors, editor],
          activeEditorId: editor.id,
          activeEditorPaneId: targetPaneId ?? current.state.activeEditorPaneId,
          editorLayout
        },
        dirty: true,
        saveStatus: 'idle'
      };
    });
    get().scheduleSave();
  },

  duplicateEditor(editorId, initialViewState) {
    const current = get();
    if (!current.state) return null;

    const sourceEditor = current.state.editors.find((editor) => editor.id === editorId);
    if (!sourceEditor) return null;

    const duplicatedId = `editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const duplicatedEditor: EditorState = {
      ...sourceEditor,
      id: duplicatedId,
      zIndex: getNextZIndex(current.state.editors),
      viewState: {
        ...sourceEditor.viewState,
        ...initialViewState
      }
    };

    set({
      state: {
        ...current.state,
        editors: [...current.state.editors, duplicatedEditor],
        activeEditorId: duplicatedId
      },
      dirty: true,
      saveStatus: 'idle'
    });
    get().scheduleSave();
    return duplicatedId;
  },

  updateEditor(editorId, patch) {
    set((current) => {
      if (!current.state) return current;

      return {
        state: {
          ...current.state,
          editors: current.state.editors.map((editor) =>
            editor.id === editorId ? { ...editor, ...patch } : editor
          )
        },
        dirty: true,
        saveStatus: 'idle'
      };
    });
  },

  updateEditorViewState(editorId, patch) {
    const liveContextOnly = isLiveContextPatch(patch);
    set((current) => {
      if (!current.state) return current;

      return {
        state: {
          ...current.state,
          editors: current.state.editors.map((editor) =>
            editor.id === editorId
              ? { ...editor, viewState: { ...editor.viewState, ...patch } }
              : editor
          )
        },
        dirty: liveContextOnly ? current.dirty : true,
        saveStatus: liveContextOnly ? current.saveStatus : 'idle'
      };
    });
    if (!liveContextOnly) get().scheduleSave();
  },

  updateWorkbenchState(patch) {
    set((current) => {
      if (!current.state) return current;

      return {
        state: normalizeWorkbenchState(
          {
            ...current.state,
            ...patch
          },
          current.state.workbenchId
        ),
        dirty: true,
        saveStatus: 'idle'
      };
    });
    get().scheduleSave();
  },

  activateEditor(editorId, paneId) {
    set((current) => {
      if (!current.state) return current;

      const nextZIndex = getNextZIndex(current.state.editors);
      const explicitPaneId =
        paneId && findLeafById(current.state.editorLayout, paneId)?.editorIds.includes(editorId)
          ? paneId
          : null;
      const targetPaneId =
        explicitPaneId ??
        findPaneContainingEditor(current.state.editorLayout, editorId) ??
        current.state.activeEditorPaneId ??
        null;
      const editorLayout =
        targetPaneId && current.state.editorLayout
          ? updateLeafEditors(current.state.editorLayout, targetPaneId, (leaf) => ({
              ...leaf,
              activeEditorId: editorId
            }))
          : current.state.editorLayout;

      return {
        state: {
          ...current.state,
          activeEditorId: editorId,
          activeEditorPaneId: targetPaneId,
          editorLayout,
          editors: current.state.editors.map((editor) =>
            editor.id === editorId ? { ...editor, zIndex: nextZIndex } : editor
          )
        },
        dirty: true,
        saveStatus: 'idle'
      };
    });
    get().scheduleSave();
  },

  closeEditor(editorId) {
    set((current) => {
      if (!current.state) return current;
      const state = current.state;

      const editors = state.editors.filter((editor) => editor.id !== editorId);
      const nextLayout = removeEditorFromLayout(state.editorLayout, editorId);
      const firstLeafId = findFirstLeafId(nextLayout);
      const fallbackLeaf =
        findLeafById(nextLayout, state.activeEditorPaneId ?? null) ??
        findLeafById(nextLayout, firstLeafId);
      const nextActiveEditorId =
        state.activeEditorId &&
        state.activeEditorId !== editorId &&
        editors.some((editor) => editor.id === state.activeEditorId)
          ? state.activeEditorId
          : fallbackLeaf?.activeEditorId ??
            fallbackLeaf?.editorIds.at(-1) ??
            editors.at(-1)?.id ??
            null;
      const nextActiveEditorPaneId = nextActiveEditorId
        ? findPaneContainingEditor(nextLayout, nextActiveEditorId) ?? firstLeafId
        : firstLeafId;

      return {
        state: {
          ...state,
          editors,
          editorLayout: nextLayout,
          activeEditorId: nextActiveEditorId,
          activeEditorPaneId: nextActiveEditorPaneId
        },
        dirty: true,
        saveStatus: 'idle'
      };
    });
    get().scheduleSave();
  },

  bindResourceToEditor(editorId, resource) {
    set((current) => {
      if (!current.state) return current;

      return {
        state: {
          ...current.state,
          editors: current.state.editors.map((editor) =>
            editor.id === editorId
              ? {
                  ...editor,
                  title: editor.type === 'notes' ? editor.title : resource.name,
                  resourceId: resource.id,
                  resourcePath: resource.path,
                  viewState: {
                    ...editor.viewState,
                    blocksuiteSnapshot: null,
                    blocksuiteSourceContent: null,
                    resourceName: resource.name,
                    resourceType: resource.type
                  }
                }
              : editor
          )
        },
        dirty: true,
        saveStatus: 'idle'
      };
    });
    get().scheduleSave();
  },

  scheduleSave() {
    const currentTimer = get().saveTimer;
    if (currentTimer) {
      window.clearTimeout(currentTimer);
    }

    const nextTimer = window.setTimeout(() => {
      void get().saveNow();
    }, 700);

    set({ saveTimer: nextTimer });
  },

  async saveNow() {
    const { workbench, state, dirty, saveTimer } = get();
    if (!workbench || !state || !dirty) return;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }

    set({ saveStatus: 'saving', saveTimer: null, error: null });

    try {
      const stateToSave = sanitizeWorkbenchStateForSave(state);
      const savedWorkbench = await workbenchApi.saveState(workbench.id, stateToSave);
      set({
        workbench: savedWorkbench,
        state,
        dirty: false,
        saveStatus: 'saved'
      });
    } catch (error: any) {
      set({
        saveStatus: 'error',
        error: workbench ? null : error?.response?.data?.error || error?.message || 'Failed to save workbench'
      });
    }
  },

  reset() {
    const timer = get().saveTimer;
    if (timer) {
      window.clearTimeout(timer);
    }

    set({
      workbench: null,
      state: null,
      resources: [],
      loading: false,
      saveStatus: 'idle',
      dirty: false,
      error: null,
      saveTimer: null
    });
  }
}));
