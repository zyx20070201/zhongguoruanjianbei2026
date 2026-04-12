export interface Workspace {
  id: string;
  name: string;
  description?: string;
  major?: string;
  createdAt: string;
  updatedAt: string;
  fileObjects?: FileSystemObject[];
  workbenches?: Workbench[];
  _count?: {
    workbenches: number;
    fileObjects?: number;
  };
}

export interface FileSystemObject {
  id: string;
  name: string;
  nodeType: 'file' | 'folder';
  fileCategory?: 'note' | 'code' | 'document' | 'media' | 'generated' | 'other' | string;
  tags?: string[];
  extension?: string;
  size?: number;
  isBinary?: boolean;
  path: string;
  content?: string;
  mimeType?: string;
  storageKey?: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  parentId?: string;
  children?: FileSystemObject[];
  
  // Keep type for backwards compatibility during migration
  type?: string; 
}

export interface Workbench {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  panelCount?: number;
  state?: WorkbenchState;
  name?: string;
  layout?: string;
  panels?: Panel[];
}

export type WorkbenchEditorType = 'resource' | 'notes' | 'code' | 'video' | 'external' | 'ai';
export type WorkbenchPanelType = WorkbenchEditorType;

export interface ResourceReference {
  id: string;
  name: string;
  path: string;
  type: string;
  tags?: string[];
  extension?: string;
  mimeType?: string;
  fileCategory?: string;
  isBinary?: boolean;
}

export interface EditorState {
  id: string;
  type: WorkbenchEditorType;
  title: string;
  resourceId?: string;
  resourcePath?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  minimized: boolean;
  viewState: Record<string, any>;
}

export type PanelState = EditorState;

export interface EditorLeafNode {
  id: string;
  type: 'leaf';
  editorIds: string[];
  activeEditorId: string | null;
  panelIds?: string[];
  activePanelId?: string | null;
}

export interface EditorSplitNode {
  id: string;
  type: 'split';
  direction: 'row' | 'column';
  ratio?: number;
  children: [EditorLayoutNode, EditorLayoutNode];
}

export type EditorLayoutNode = EditorLeafNode | EditorSplitNode;

export interface WorkbenchState {
  workbenchId: string;
  editors: EditorState[];
  layoutMode: 'freeform';
  activeEditorId: string | null;
  activeEditorPaneId?: string | null;
  editorLayout?: EditorLayoutNode | null;
  panels?: PanelState[];
  activePanelId?: string | null;
  activePaneId?: string | null;
  version: number;
}

export type PanelType =
  | 'resource'
  | 'notes'
  | 'ai-assistant'
  | 'code'
  | 'result';

export interface Panel {
  id: string;
  title?: string;
  panelType: string; // "file-preview-panel", "note-editor-panel", "code-editor-panel", "ai-assistant-panel"
  config?: string;
  layoutInfo?: string;
  workbenchId: string;
  fileObjectId?: string;
  fileObject?: FileSystemObject;
}

export interface PanelInstance {
  id: string;
  type: PanelType;
  title: string;
  referencedFileId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  docked?: boolean;
  state?: {
    mode?: 'edit' | 'preview';
    saving?: boolean;
    saved?: boolean;
  };
}

export interface User {
  id: string;
  username: string;
  email?: string | null;
}

export type WorkspaceStatus = 'active' | 'review' | 'idle' | 'archived';

export type WorkbenchType = 'study' | 'notes' | 'lab' | 'review';

export interface WorkspaceOverview {
  id: string;
  courseName: string;
  description?: string;
  major: string;
  updatedAt: string;
  workbenchCount: number;
  fileCount: number;
  recentActivity?: string;
  recentLearningState?: string;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  children?: FileNode[];
}

export interface WorkbenchItem {
  id: string;
  title: string;
  updatedAt: string;
  panelCount: number;
  description?: string;
}

export interface ContinueLearningItem {
  id: string;
  workspaceId: string;
  courseName: string;
  taskName: string;
  recentContent: string;
  updatedAt: string;
}

export interface WorkspaceCardData {
  id: string;
  courseName: string;
  description?: string;
  major: string;
  updatedAt: string;
  status: WorkspaceStatus;
  workbenchCount: number;
  fileCount: number;
  noteCount: number;
  codeCount: number;
  recentTask?: string;
  recentLearningState?: string;
  archived?: boolean;
}

export interface CreateWorkspaceFormData {
  courseName: string;
  description?: string;
  major: string;
  semester?: string;
  color?: string;
  icon?: string;
  resources: File[];
  initMode: 'empty' | 'study' | 'lab' | 'review' | 'ai';
}
