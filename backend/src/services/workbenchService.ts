import crypto from 'crypto';
import { workbenchRepository } from '../repositories/workbenchRepository';
import prisma from '../config/db';
import {
  EditorLayoutNode,
  EditorState,
  WorkbenchPayload,
  WorkbenchRecord,
  WorkbenchState,
  WorkbenchSummary
} from '../types/workbench';
import { generateUniqueFilename } from '../utils/path';

const DEFAULT_LAYOUT_MODE = 'freeform' as const;

const slugifyWorkbenchFolderName = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || 'Untitled Workbench';
};

const buildFallbackRootPath = (title: string) => `/${slugifyWorkbenchFolderName(title)}`;

const truncateText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const sanitizeMessages = (messages: unknown) => {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-40)
    .map((message: any) => ({
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

const sanitizeViewState = (viewState: Record<string, any> = {}) => {
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

const normalizeEditor = (editor: EditorState): EditorState => ({
  id: editor.id,
  type: editor.type,
  title: editor.title,
  resourceId: editor.resourceId,
  resourcePath: editor.resourcePath,
  x: Number.isFinite(editor.x) ? editor.x : 48,
  y: Number.isFinite(editor.y) ? editor.y : 48,
  w: Math.max(280, Number.isFinite(editor.w) ? editor.w : 360),
  h: Math.max(200, Number.isFinite(editor.h) ? editor.h : 260),
  zIndex: Number.isFinite(editor.zIndex) ? editor.zIndex : 1,
  minimized: Boolean(editor.minimized),
  viewState: sanitizeViewState(editor.viewState && typeof editor.viewState === 'object' ? editor.viewState : {})
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

const normalizeAiAssistant = (workbenchId: string, value: any): WorkbenchState['aiAssistant'] => {
  const fallbackSessionId = `ai-session-${workbenchId}`;
  const fallbackViewState = { messages: [], contextHint: 'workbench' };
  const assistant = value && typeof value === 'object' ? value : {};
  const rawSessions = Array.isArray(assistant.sessions) ? assistant.sessions : [];
  const sessions = (rawSessions.length
    ? rawSessions.slice(-30).map((session: any, index: number) => ({
        id: typeof session?.id === 'string' ? session.id : `ai-session-${workbenchId}-${index}`,
        title: typeof session?.title === 'string' && session.title.trim() ? session.title : `AI 对话 ${index + 1}`,
        createdAt: typeof session?.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
        updatedAt: typeof session?.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
        viewState: sanitizeViewState(session?.viewState && typeof session.viewState === 'object' ? session.viewState : fallbackViewState)
      }))
    : [
        {
          id: typeof assistant.activeSessionId === 'string' ? assistant.activeSessionId : fallbackSessionId,
          title: typeof assistant.title === 'string' && assistant.title.trim() ? assistant.title : 'AI 对话',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          viewState: sanitizeViewState(
            assistant.viewState && typeof assistant.viewState === 'object' ? assistant.viewState : fallbackViewState
          )
        }
      ]) as NonNullable<NonNullable<WorkbenchState['aiAssistant']>['sessions']>;
  const activeSessionId =
    typeof assistant.activeSessionId === 'string' && sessions.some((session) => session.id === assistant.activeSessionId)
      ? assistant.activeSessionId
      : sessions[0].id;
  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];

  return {
    id: typeof assistant.id === 'string' ? assistant.id : `ai-assistant-${workbenchId}`,
    title: typeof assistant.title === 'string' && assistant.title.trim() ? assistant.title : activeSession.title,
    mode:
      assistant.mode === 'sidebar' || assistant.mode === 'fullscreen' || assistant.mode === 'floating'
        ? assistant.mode
        : 'floating',
    isOpen: Boolean(assistant.isOpen),
    activeSessionId,
    sidebarWidth:
      typeof assistant.sidebarWidth === 'number'
        ? Math.min(760, Math.max(360, assistant.sidebarWidth))
        : 460,
    sessions,
    viewState: activeSession.viewState
  };
};

const normalizeState = (workbenchId: string, state?: Partial<WorkbenchState>): WorkbenchState => {
  const editors = Array.isArray(state?.editors)
    ? state.editors.map(normalizeEditor)
    : Array.isArray(state?.panels)
      ? state.panels.map(normalizeEditor)
      : [];

  return {
    workbenchId,
    editors,
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
    editorLayout: normalizeEditorLayout((state?.editorLayout as EditorLayoutNode | null | undefined) ?? null),
    panels: undefined,
    activePanelId: undefined,
    activePaneId: undefined,
    aiAssistant: normalizeAiAssistant(workbenchId, state?.aiAssistant),
    version: typeof state?.version === 'number' && state.version > 0 ? state.version : 1
  };
};

const normalizeRecord = (record: WorkbenchRecord): WorkbenchRecord => ({
  ...record,
  rootPath: record.rootPath || buildFallbackRootPath(record.title),
  state: normalizeState(record.id, record.state)
});

const toSummary = (record: WorkbenchRecord): WorkbenchSummary => {
  const normalizedRecord = normalizeRecord(record);

  return {
    id: normalizedRecord.id,
    workspaceId: normalizedRecord.workspaceId,
    title: normalizedRecord.title,
    description: normalizedRecord.description,
    rootPath: normalizedRecord.rootPath,
    createdAt: normalizedRecord.createdAt,
    updatedAt: normalizedRecord.updatedAt,
    lastOpenedAt: normalizedRecord.lastOpenedAt,
    panelCount: normalizedRecord.state.editors.length
  };
};

export class WorkbenchService {
  private async ensureWorkbenchRootFolder(workspaceId: string, rootPath: string) {
    const normalizedPath = rootPath.startsWith('/') ? rootPath : `/${rootPath}`;
    const segments = normalizedPath.split('/').filter(Boolean);

    let parentId: string | null = null;
    let currentPath = '';

    for (const segment of segments) {
      currentPath = `${currentPath}/${segment}`;

      let folder = await prisma.fileSystemObject.findUnique({
        where: {
          workspaceId_path: {
            workspaceId,
            path: currentPath
          }
        }
      });

      if (!folder) {
        folder = await prisma.fileSystemObject.create({
          data: {
            name: segment,
            nodeType: 'folder',
            fileCategory: 'other',
            tags: '[]',
            path: currentPath,
            workspaceId,
            parentId
          }
        });
      }

      parentId = folder.id;
    }
  }

  private async createWorkbenchRootPath(workspaceId: string, title: string) {
    const existingFolders = await prisma.fileSystemObject.findMany({
      where: {
        workspaceId,
        parentId: null,
        nodeType: 'folder'
      },
      select: { name: true }
    });

    const existingNames = new Set(existingFolders.map((folder) => folder.name));
    const rootFolderName = generateUniqueFilename(slugifyWorkbenchFolderName(title), existingNames);

    return `/${rootFolderName}`;
  }

  async listByWorkspace(workspaceId: string): Promise<WorkbenchSummary[]> {
    const records = await workbenchRepository.listByWorkspace(workspaceId);
    return records.map(toSummary);
  }

  async getById(id: string, markOpened = false): Promise<WorkbenchRecord | null> {
    const record = await workbenchRepository.findById(id);
    if (!record) return null;

    const normalizedRecord = normalizeRecord(record);
    await this.ensureWorkbenchRootFolder(normalizedRecord.workspaceId, normalizedRecord.rootPath);

    if (!markOpened) {
      return normalizedRecord;
    }

    const now = new Date().toISOString();
    const nextRecord: WorkbenchRecord = {
      ...normalizedRecord,
      updatedAt: now,
      lastOpenedAt: now
    };

    await workbenchRepository.save(nextRecord);
    return nextRecord;
  }

  async create(workspaceId: string, payload: WorkbenchPayload): Promise<WorkbenchRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const title = payload.title?.trim() || 'Untitled Workbench';
    const description = payload.description?.trim() || '';
    const rootPath = await this.createWorkbenchRootPath(workspaceId, title);

    const record: WorkbenchRecord = {
      id,
      workspaceId,
      title,
      description,
      rootPath,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      state: {
        workbenchId: id,
        editors: [],
        layoutMode: DEFAULT_LAYOUT_MODE,
        activeEditorId: null,
        activeEditorPaneId: null,
        version: 1
      }
    };

    await this.ensureWorkbenchRootFolder(workspaceId, rootPath);
    return workbenchRepository.save(record);
  }

  async updateMetadata(id: string, payload: WorkbenchPayload): Promise<WorkbenchRecord | null> {
    const current = await workbenchRepository.findById(id);
    if (!current) return null;

    const nextRecord: WorkbenchRecord = {
      ...current,
      title: payload.title?.trim() || current.title,
      description: payload.description?.trim() ?? current.description,
      updatedAt: new Date().toISOString()
    };

    return workbenchRepository.save(nextRecord);
  }

  async saveState(id: string, state: Partial<WorkbenchState>): Promise<WorkbenchRecord | null> {
    const current = await workbenchRepository.findById(id);
    if (!current) return null;

    const nextState = normalizeState(id, state);
    const activeEditorExists = nextState.activeEditorId
      ? nextState.editors.some((editor) => editor.id === nextState.activeEditorId)
      : false;

    const nextRecord: WorkbenchRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      state: {
        ...nextState,
        activeEditorId: activeEditorExists
          ? nextState.activeEditorId
          : nextState.editors[nextState.editors.length - 1]?.id ?? null,
        panels: undefined,
        activePanelId: undefined,
        activePaneId: undefined
      }
    };

    return workbenchRepository.save(nextRecord);
  }

  async delete(id: string): Promise<boolean> {
    return workbenchRepository.delete(id);
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await workbenchRepository.deleteByWorkspace(workspaceId);
  }
}

export const workbenchService = new WorkbenchService();
