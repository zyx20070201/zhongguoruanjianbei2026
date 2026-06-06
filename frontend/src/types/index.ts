export interface Workspace {
  id: string;
  name: string;
  description?: string;
  major?: string;
  aiTerminalConfig?: string;
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
  resourceType?: 'source' | 'note' | 'generated' | 'artifact' | 'resource' | 'file' | 'folder' | string;
  scope?: 'workspace' | 'workbench' | string;
  origin?: string;
  ownerWorkbenchId?: string;
  metadata?: Record<string, unknown>;
  metadataJson?: string;
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
  knowledgeIndexJobs?: Array<{
    id: string;
    status: string;
    extractor?: string | null;
    errorMessage?: string | null;
    chunkCount?: number;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
  _count?: {
    knowledgeChunks?: number;
  };
  
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
  resourceCount?: number;
  state?: WorkbenchState;
  name?: string;
  layout?: string;
  panels?: Panel[];
}

export type WorkbenchEditorType = 'resource' | 'notes' | 'code' | 'video' | 'external' | 'ai' | 'studio';
export type WorkbenchPanelType = WorkbenchEditorType;

export interface ResourceReference {
  id: string;
  name: string;
  path: string;
  type: string;
  resourceRole?: string;
  resourceType?: string;
  scope?: string;
  origin?: string;
  ownerWorkbenchId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  extension?: string;
  mimeType?: string;
  fileCategory?: string;
  isBinary?: boolean;
  size?: number;
  chunkCount?: number;
  knowledgeIndexJobs?: Array<{
    id: string;
    status: string;
    extractor?: string | null;
    errorMessage?: string | null;
    chunkCount?: number;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
  _count?: {
    knowledgeChunks?: number;
  };
}

export interface WorkbenchResourceGroups {
  sources: ResourceReference[];
  files: ResourceReference[];
  generated: ResourceReference[];
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
  profileImageUrl?: string | null;
  bio?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  notificationWebhookUrl?: string | null;
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
  resourceCount?: number;
  description?: string;
}

export interface LearningGoalDraft {
  title: string;
  goalText: string;
  skills: string[];
  weaknesses: string[];
  suggestedMode: 'quick-start' | 'project' | 'review';
}

export interface LearningTerminalMessage {
  role: 'user' | 'assistant';
  content: string;
  files?: TerminalChatFile[];
  mode?: 'chat' | 'agentic';
  statusHistory?: Array<{
    done: boolean;
    action: string;
    description?: string;
    hidden?: boolean;
    query?: string;
    queries?: string[];
    count?: number;
  }>;
  goalDraft?: LearningGoalDraft;
  proposedActions?: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    risk: 'low' | 'medium' | 'high';
    requiresConfirmation: boolean;
    payload?: Record<string, unknown>;
  }>;
  executedActions?: Array<{
    id: string;
    proposalId: string;
    type: string;
    title: string;
    success: boolean;
    summary: string;
    result?: Record<string, unknown>;
    error?: string;
  }>;
  agentTrace?: Array<{
    id: string;
    at: string;
    node: string;
    summary: string;
    details?: Record<string, unknown>;
  }>;
  evidence?: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    content?: string;
    source?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
  followUps?: string[];
  askUserToSave?: {
    text: string;
    candidate?: {
      text: string;
      category: string;
      confidence: number;
      reason: string;
    } | null;
  } | null;
}

export interface TerminalChatFile {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  size?: number;
  extension?: string;
  fileCategory?: string;
  resourceType?: string;
  scope?: string;
  origin?: string;
  downloadUrl?: string;
  status?: 'uploading' | 'ready' | 'error';
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PersonalizedWorkspaceIntegration {
  schema: string;
  workspaceId: string;
  workbenchId?: string | null;
  learnerState: {
    summary: string;
    strengths: string[];
    weakSkills: string[];
    preferences: string[];
    currentNeeds: string[];
  };
  terminalGuidance: {
    tutorStyle: string;
    responseRules: string[];
    suggestedPrompts: string[];
  };
  activePlan?: {
    id: string;
    workspaceId?: string;
    workbenchId?: string | null;
    goalId?: string | null;
    scope?: string;
    status?: string;
    objective: string;
    rationale?: string;
    version?: number;
    nextStepId?: string | null;
    assumptions?: string[];
    constraints?: string[];
    milestones?: unknown[];
    steps?: unknown[];
    targetSkills?: string[];
    weakSkills?: string[];
    adaptationPolicy?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    diagnosticReport?: Record<string, unknown>;
    candidateResources?: unknown[];
    knowledgeGraphSnapshot?: Record<string, unknown>;
    reflectionHistory?: unknown[];
    constraintScores?: Record<string, unknown>;
    revisionCount?: number;
    previousPlanId?: string | null;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  continueLearning: {
    workbenchId?: string | null;
    workbenchTitle?: string | null;
    planId?: string | null;
    nextStepId?: string | null;
    nextStepTitle: string;
    prompt: string;
    updatedAt?: string | null;
  };
  resourceRecommendations: Array<{
    id: string;
    title: string;
    type: string;
    sourceId?: string;
    summary: string;
    relevanceScore: number;
    reason: string;
    explanation: string;
  }>;
  taskRecommendations: Array<{
    id: string;
    title: string;
    type: string;
    targetSkills: string[];
    estimatedLoad: string;
    expectedEvidence: string[];
    status: string;
    reason: string;
  }>;
  pathPreview?: {
    objective: string;
    milestones: unknown[];
    steps: unknown[];
    constraintScores: Record<string, unknown>;
    planningTrace?: Record<string, unknown>;
  } | null;
  recommendationExplanations: string[];
  evidence: Record<string, unknown>;
}

export interface LearningTerminalAction {
  id: string;
  label: string;
  description?: string;
}

export interface LearningTerminalResponse {
  reply: string;
  mode?: 'chat' | 'agentic';
  goalDraft?: LearningGoalDraft;
  suggestedActions?: LearningTerminalAction[];
  sessionId?: string;
  runId?: string;
  checkpointThreadId?: string;
  status?: 'completed' | 'approval_required';
  proposedActions?: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    risk: 'low' | 'medium' | 'high';
    requiresConfirmation: boolean;
    payload?: Record<string, unknown>;
  }>;
  approvalRequest?: {
    proposals: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      risk: 'low' | 'medium' | 'high';
      requiresConfirmation: boolean;
      payload?: Record<string, unknown>;
    }>;
    message: string;
  };
  executedActions?: Array<{
    id: string;
    proposalId: string;
    type: string;
    title: string;
    success: boolean;
    summary: string;
    result?: Record<string, unknown>;
    error?: string;
  }>;
  agentTrace?: Array<{
    id: string;
    at: string;
    node: string;
    summary: string;
    details?: Record<string, unknown>;
  }>;
  evidence?: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    content?: string;
    source?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
  followUps?: string[];
  memoryContext?: {
    askUserToSave?: {
      text: string;
      candidate?: {
        text: string;
        category: string;
        confidence: number;
        reason: string;
      } | null;
    } | null;
    workspaceIntegration?: PersonalizedWorkspaceIntegration | null;
  };
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
  taskCount?: number;
  workbenchCount: number;
  fileCount: number;
  noteCount: number;
  codeCount: number;
  recentTask?: string;
  recentWorkbench?: string;
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
