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
  };
}

export interface FileSystemObject {
  id: string;
  name: string;
  nodeType: 'file' | 'folder';
  fileCategory?: 'note' | 'code' | 'document' | 'media' | 'generated' | 'other' | string;
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
  name: string;
  layout?: string;
  workspaceId: string;
  panels?: Panel[];
  createdAt?: string;
  updatedAt?: string;
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
}

export type WorkspaceStatus = 'active' | 'review' | 'idle' | 'archived';

export type AIActionType =
  | 'organize'
  | 'summarize'
  | 'create-workbench'
  | 'suggest-next-task';

export type WorkbenchType = 'study' | 'notes' | 'lab' | 'review';

export interface WorkspaceOverview {
  id: string;
  courseName: string;
  description?: string;
  major: string;
  updatedAt: string;
  status: WorkspaceStatus;
  workbenchCount: number;
  fileCount: number;
  recentActivity?: string;
  recentLearningState?: string;
  suggestedNextStep?: string;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  children?: FileNode[];
}

export interface WorkbenchItem {
  id: string;
  name: string;
  type: WorkbenchType;
  updatedAt: string;
  linkedResourceCount: number;
  panelCount: number;
  recentActivity?: string;
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
