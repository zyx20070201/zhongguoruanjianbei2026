export type WorkbenchEditorType = 'resource' | 'notes' | 'code' | 'video' | 'external' | 'ai' | 'studio';
export type WorkbenchPanelType = WorkbenchEditorType;

export interface ResourceReference {
  id: string;
  name: string;
  path: string;
  type: string;
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
  aiAssistant?: {
    id: string;
    title: string;
    activeSessionId?: string;
    sessions?: Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      viewState: Record<string, any>;
    }>;
    viewState: Record<string, any>;
  };
  aiStudio?: {
    id: string;
    title: string;
    viewState: Record<string, any>;
  };
  aiToolPanel?: {
    id: string;
    activeTool: 'chat' | 'studio';
    mode: 'floating' | 'sidebar' | 'fullscreen';
    isOpen: boolean;
    sidebarWidth?: number;
  };
  version: number;
}

export interface WorkbenchRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  state: WorkbenchState;
}

export interface WorkbenchSummary {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  panelCount: number;
  resourceCount: number;
}

export interface WorkbenchPayload {
  title?: string;
  description?: string;
}

export interface WorkbenchResourceGroups {
  sources: ResourceReference[];
  files: ResourceReference[];
  generated: ResourceReference[];
}
