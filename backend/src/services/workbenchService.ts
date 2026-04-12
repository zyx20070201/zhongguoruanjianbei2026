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
  viewState: editor.viewState && typeof editor.viewState === 'object' ? editor.viewState : {}
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

const normalizeState = (workbenchId: string, state?: Partial<WorkbenchState>): WorkbenchState => ({
  workbenchId,
  editors: Array.isArray(state?.editors)
    ? state.editors.map(normalizeEditor)
    : Array.isArray(state?.panels)
      ? state.panels.map(normalizeEditor)
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
  editorLayout: normalizeEditorLayout((state?.editorLayout as EditorLayoutNode | null | undefined) ?? null),
  panels: undefined,
  activePanelId: undefined,
  activePaneId: undefined,
  version: typeof state?.version === 'number' && state.version > 0 ? state.version : 1
});

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
