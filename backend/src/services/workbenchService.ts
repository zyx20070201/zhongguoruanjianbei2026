import crypto from 'crypto';
import { workbenchRepository } from '../repositories/workbenchRepository';
import prisma from '../config/db';
import {
  EditorLayoutNode,
  EditorState,
  WorkbenchPayload,
  WorkbenchRecord,
  WorkbenchResourceGroups,
  WorkbenchState,
  WorkbenchSummary
} from '../types/workbench';
import { generateUniqueFilename } from '../utils/path';
import {
  findWorkbenchResourceFiles,
  getWorkbenchResourceFileIds,
  normalizeWorkbenchResourceRole
} from './workbenchResourceScope';

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

const GENERIC_WORKBENCH_TITLES = new Set([
  'New Task Workbench',
  'Default Workbench',
  'Untitled Workbench',
  'AI 引导学习现场',
  '新的学习目标'
]);

const isGenericWorkbenchTitle = (value?: string | null) => {
  const title = String(value || '').trim();
  return !title || GENERIC_WORKBENCH_TITLES.has(title) || /^new\s+/i.test(title) || /^untitled/i.test(title);
};

const cleanTitleSeed = (value: string) =>
  value
    .replace(/MCL\s*Planner\s*输出\s*v?\d*\s*计划[:：]?/gi, '')
    .replace(/AI\s*引导学习现场[:：]?/gi, '')
    .replace(/^(请|帮我|给我|讲讲|讲一下|学习|复习|整理|掌握|了解|我想|我需要)/, '')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, '')
    .trim();

const meaningfulTitleFromText = (value: string, fallback = '课程学习整理') => {
  const text = cleanTitleSeed(value);
  if (!text) return fallback;

  const topicPatterns: Array<[RegExp, string]> = [
    [/软件项目管理.*?(计划过程|计划|WBS|网络计划|持续策划|滚动计划)/, '软件项目计划复习'],
    [/软件项目.*?(特点|特性)/, '软件项目特性概览'],
    [/软件项目.*?(风险)/, '软件项目风险梳理'],
    [/(WBS|网络计划).*?(对比|区别)/, '计划工具对比整理'],
    [/(数据结构|算法).*?(复习|练习|题)/, '数据结构算法复习']
  ];

  for (const [pattern, title] of topicPatterns) {
    if (pattern.test(text)) return title;
  }

  const match = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}/);
  const base = (match?.[0] || text).slice(0, 12);
  const suffix = /复习|整理|概览|练习|计划|对比/.test(base) ? '' : '整理';
  return `${base}${suffix}`.slice(0, 16) || fallback;
};

const cleanUserFacingDescription = (value: string) =>
  value
    .replace(/MCL\s*Planner\s*输出\s*v?\d*\s*计划[:：]?/gi, '')
    .replace(/AI\s*引导学习现场[:：]?/gi, '')
    .replace(/agent|signals?|confidence|candidate weak|debug|embedding|reranker/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

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

const sanitizeChatAttachment = (attachment: any) => ({
  id: typeof attachment?.id === 'string' ? attachment.id : crypto.randomUUID(),
  name: String(attachment?.name || 'Untitled attachment').slice(0, 180),
  mimeType: String(attachment?.mimeType || attachment?.type || 'application/octet-stream').slice(0, 120),
  size: typeof attachment?.size === 'number' ? attachment.size : 0,
  kind: ['text', 'image', 'pdf', 'document', 'file'].includes(attachment?.kind) ? attachment.kind : 'file',
  createdAt: typeof attachment?.createdAt === 'string' ? attachment.createdAt : new Date().toISOString(),
  textContent: typeof attachment?.textContent === 'string' ? attachment.textContent.slice(0, 12000) : undefined,
  dataUrl:
    typeof attachment?.dataUrl === 'string' && attachment.dataUrl.startsWith('data:') && attachment.dataUrl.length <= 6_000_000
      ? attachment.dataUrl
      : undefined,
  base64Data:
    typeof attachment?.base64Data === 'string' && attachment.base64Data.length <= 5_500_000
      ? attachment.base64Data
      : undefined,
  fileObjectId: typeof attachment?.fileObjectId === 'string' ? attachment.fileObjectId : undefined,
  savedToWorkbench: Boolean(attachment?.savedToWorkbench),
  status: ['ready', 'metadata_only', 'error'].includes(attachment?.status) ? attachment.status : undefined,
  error: truncateText(attachment?.error, 240)
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

  if (Array.isArray(next.chatSessionAttachments)) {
    next.chatSessionAttachments = next.chatSessionAttachments.slice(-8).map(sanitizeChatAttachment);
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
    activeSessionId,
    sessions,
    viewState: activeSession.viewState
  };
};

const normalizeAiStudio = (workbenchId: string, value: any): WorkbenchState['aiStudio'] => {
  const studio = value && typeof value === 'object' ? value : {};
  return {
    id: typeof studio.id === 'string' ? studio.id : `ai-studio-${workbenchId}`,
    title: typeof studio.title === 'string' && studio.title.trim() ? studio.title : 'AI Studio',
    viewState: sanitizeViewState(
      studio.viewState && typeof studio.viewState === 'object' ? studio.viewState : { studioResults: [] }
    )
  };
};

const normalizeAiToolPanel = (
  workbenchId: string,
  value: any
): WorkbenchState['aiToolPanel'] => {
  const panel = value && typeof value === 'object' ? value : {};

  return {
    id: typeof panel.id === 'string' ? panel.id : `ai-tool-panel-${workbenchId}`,
    activeTool: panel.activeTool === 'studio' ? 'studio' : 'chat',
    mode:
      panel.mode === 'sidebar' || panel.mode === 'fullscreen' || panel.mode === 'floating'
        ? panel.mode
        : 'floating',
    isOpen: typeof panel.isOpen === 'boolean' ? panel.isOpen : false,
    sidebarWidth:
      typeof panel.sidebarWidth === 'number'
        ? Math.min(860, Math.max(360, panel.sidebarWidth))
        : 520
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
    aiStudio: normalizeAiStudio(workbenchId, state?.aiStudio),
    aiToolPanel: normalizeAiToolPanel(workbenchId, state?.aiToolPanel),
    version: typeof state?.version === 'number' && state.version > 0 ? state.version : 1
  };
};

const normalizeRecord = (record: WorkbenchRecord): WorkbenchRecord => ({
  ...record,
  rootPath: record.rootPath || buildFallbackRootPath(record.title),
  state: normalizeState(record.id, record.state)
});

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseTags = (value: unknown): string[] => {
  if (!value || typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag)).filter(Boolean) : [];
  } catch {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
};

const inferResourceGroup = (resource: any): keyof WorkbenchResourceGroups => {
  const bindingRole = normalizeWorkbenchResourceRole(resource.workbenchBindings?.[0]?.role) || 'file';
  const resourceType = normalizeWorkbenchResourceRole(resource.resourceType) || 'file';
  const category = String(resource.fileCategory || '').toLowerCase();

  if (bindingRole === 'generated' || resourceType === 'generated' || category.includes('generated')) {
    return 'generated';
  }

  if (
    bindingRole === 'source' ||
    resourceType === 'source' ||
    category.includes('source') ||
    category.includes('web')
  ) {
    return 'sources';
  }

  return 'files';
};

const inferBindingRole = (resource: any) => {
  const normalizedType = normalizeWorkbenchResourceRole(resource.resourceType) || 'file';
  if (normalizedType === 'source' || normalizedType === 'generated' || normalizedType === 'artifact') {
    return normalizedType;
  }
  return 'file';
};

const mapFileResource = (resource: any) => ({
  id: resource.id,
  name: resource.name,
  path: resource.path,
  type: resource.resourceType || resource.fileCategory || resource.nodeType || 'file',
  isBinary: Boolean(resource.isBinary),
  resourceType: resource.resourceType,
  scope: resource.scope,
  origin: resource.origin,
  ownerWorkbenchId: resource.ownerWorkbenchId,
  metadata: parseJsonObject(resource.metadataJson),
  tags: parseTags(resource.tags),
  extension: resource.extension,
  mimeType: resource.mimeType,
  fileCategory: resource.fileCategory
});

const toSummary = (record: WorkbenchRecord, resourceCount = 0): WorkbenchSummary => {
  const normalizedRecord = normalizeRecord(record);

  return {
    id: normalizedRecord.id,
    workspaceId: normalizedRecord.workspaceId,
    title: normalizedRecord.title,
    description: cleanUserFacingDescription(normalizedRecord.description),
    rootPath: normalizedRecord.rootPath,
    createdAt: normalizedRecord.createdAt,
    updatedAt: normalizedRecord.updatedAt,
    lastOpenedAt: normalizedRecord.lastOpenedAt,
    panelCount: normalizedRecord.state.editors.length,
    resourceCount
  };
};

export class WorkbenchService {
  private async inferUserFacingTitle(workspaceId: string, payload: WorkbenchPayload, fallback = '课程学习整理') {
    if (!isGenericWorkbenchTitle(payload.title)) {
      return meaningfulTitleFromText(payload.title || '', fallback);
    }

    if (payload.description?.trim()) {
      return meaningfulTitleFromText(payload.description, fallback);
    }

    const [latestTrace, latestEvent, latestFile] = await Promise.all([
      prisma.learningTrace.findFirst({
        where: { workspaceId },
        orderBy: { updatedAt: 'desc' },
        select: { summary: true, nextActionsJson: true }
      }),
      prisma.learningEvent.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { payloadJson: true, eventType: true }
      }),
      prisma.fileSystemObject.findFirst({
        where: { workspaceId, nodeType: 'file' },
        orderBy: { updatedAt: 'desc' },
        select: { name: true }
      })
    ]);

    const eventSeed = (() => {
      if (!latestEvent?.payloadJson) return '';
      try {
        return JSON.stringify(JSON.parse(latestEvent.payloadJson));
      } catch {
        return latestEvent.payloadJson;
      }
    })();

    return meaningfulTitleFromText(
      latestTrace?.summary || latestTrace?.nextActionsJson || eventSeed || latestFile?.name || fallback,
      fallback
    );
  }

  private async hydrateUserFacingTitle(record: WorkbenchRecord): Promise<WorkbenchRecord> {
    if (!isGenericWorkbenchTitle(record.title)) return record;

    const title = await this.inferUserFacingTitle(record.workspaceId, { title: record.title, description: record.description });
    if (!title || title === record.title) return record;

    return workbenchRepository.save({
      ...record,
      title,
      updatedAt: record.updatedAt
    });
  }

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
    const existingWorkbenches = await prisma.workbench.findMany({
      where: { workspaceId },
      select: { rootPath: true }
    });

    const existingNames = new Set(
      existingWorkbenches
        .map((workbench) => workbench.rootPath?.replace(/^\/+/, ''))
        .filter((name): name is string => Boolean(name))
    );
    const rootFolderName = generateUniqueFilename(slugifyWorkbenchFolderName(title), existingNames);

    return `/${rootFolderName}`;
  }

  async listByWorkspace(workspaceId: string): Promise<WorkbenchSummary[]> {
    const records = await workbenchRepository.listByWorkspace(workspaceId);
    const hydrated = await Promise.all(records.map((record) => this.hydrateUserFacingTitle(record)));
    const resourceCounts = await Promise.all(
      hydrated.map(async (record) =>
        getWorkbenchResourceFileIds({
          workspaceId,
          workbenchId: record.id
        }).then((ids) => ids.length)
      )
    );
    return hydrated.map((record, index) => toSummary(record, resourceCounts[index] || 0));
  }

  async getById(id: string, markOpened = false): Promise<WorkbenchRecord | null> {
    const record = await workbenchRepository.findById(id);
    if (!record) return null;

    const titledRecord = await this.hydrateUserFacingTitle(record);
    const normalizedRecord = normalizeRecord(titledRecord);

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
    const title = await this.inferUserFacingTitle(workspaceId, payload);
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

    return workbenchRepository.save(record);
  }

  async getResourceGroups(id: string): Promise<WorkbenchResourceGroups | null> {
    const workbench = await prisma.workbench.findUnique({
      where: { id },
      select: { id: true, workspaceId: true }
    });
    if (!workbench) return null;

    const resources = await findWorkbenchResourceFiles({
      workspaceId: workbench.workspaceId,
      workbenchId: id,
      include: {
        workbenchBindings: {
          where: { workbenchId: id },
          orderBy: [{ orderIndex: 'asc' }, { updatedAt: 'desc' }]
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }]
    });

    const groups: WorkbenchResourceGroups = {
      sources: [],
      files: [],
      generated: []
    };

    resources
      .sort((left: any, right: any) => {
        const leftOrder = left.workbenchBindings?.[0]?.orderIndex ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.workbenchBindings?.[0]?.orderIndex ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        const leftUpdated = new Date(left.updatedAt).getTime();
        const rightUpdated = new Date(right.updatedAt).getTime();
        return rightUpdated - leftUpdated;
      })
      .forEach((resource) => {
      groups[inferResourceGroup(resource)].push(mapFileResource(resource));
      });

    return groups;
  }

  async reorderResources(id: string, orderedIds: string[]): Promise<WorkbenchResourceGroups | null> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return this.getResourceGroups(id);
    }

    const workbench = await prisma.workbench.findUnique({
      where: { id },
      select: { id: true, workspaceId: true }
    });
    if (!workbench) return null;

    const resources = await findWorkbenchResourceFiles({
      workspaceId: workbench.workspaceId,
      workbenchId: id
    });
    const scopedIds = new Set(resources.map((resource: any) => resource.id));
    const filteredIds = Array.from(new Set(orderedIds.filter((item) => scopedIds.has(item))));
    if (filteredIds.length === 0) return this.getResourceGroups(id);

    await prisma.$transaction(
      filteredIds.map((fileObjectId, index) =>
        (prisma as any).workbenchResource.updateMany({
          where: { workbenchId: id, fileObjectId },
          data: { orderIndex: index }
        })
      )
    );

    const idsWithBinding = new Set(
      (
        await (prisma as any).workbenchResource.findMany({
          where: { workbenchId: id, fileObjectId: { in: filteredIds } },
          select: { fileObjectId: true }
        })
      ).map((item: any) => item.fileObjectId)
    );

    const missingIds = filteredIds.filter((fileObjectId) => !idsWithBinding.has(fileObjectId));
    if (missingIds.length > 0) {
      const missingResources = resources.filter((resource: any) => missingIds.includes(resource.id));
      await prisma.$transaction(
        missingResources.map((resource: any, index: number) =>
          (prisma as any).workbenchResource.create({
            data: {
              workbenchId: id,
              fileObjectId: resource.id,
              role: inferBindingRole(resource),
              source: resource.origin || 'local',
              orderIndex: filteredIds.indexOf(resource.id),
              metadataJson: JSON.stringify({})
            }
          })
        )
      );
    }

    return this.getResourceGroups(id);
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
