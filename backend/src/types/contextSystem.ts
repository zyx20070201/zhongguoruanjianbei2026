export type ContextMode =
  | 'auto'
  | 'selection_only'
  | 'viewport'
  | 'active_file'
  | 'workbench'
  | 'workspace';

export type ContextResourceType =
  | 'pdf'
  | 'docx'
  | 'markdown'
  | 'blocksuite'
  | 'code'
  | 'web'
  | 'video'
  | 'generated';

export interface ContextLocator {
  page?: number;
  pageStart?: number;
  pageEnd?: number;
  visiblePages?: number[];
  primaryPage?: number;
  scrollRatio?: number;
  startLine?: number;
  endLine?: number;
  lineStart?: number;
  lineEnd?: number;
  cursorLine?: number;
  blockId?: string;
  blockIds?: string[];
  blockIndex?: number;
  headingPath?: string[];
  paragraphIndex?: number;
  chunkIndex?: number;
  charStart?: number;
  charEnd?: number;
  textLength?: number;
  rects?: Array<{
    page?: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  bbox?: {
    page?: number;
    left: number;
    top: number;
    width: number;
    height: number;
  };
  timestampStart?: number;
  timestampEnd?: number;
}

export interface SelectionContext {
  type: 'text' | 'pdf_text' | 'code' | 'block' | 'markdown' | 'docx' | 'video_transcript';
  fileId: string;
  fileName: string;
  panelId?: string;
  content: string;
  locator?: ContextLocator;
}

export interface ViewportContext {
  panelId: string;
  fileId: string;
  fileName: string;
  panelType: 'pdf' | 'code' | 'markdown' | 'blocksuite' | 'docx' | 'video' | 'web';
  content?: string;
  locator?: ContextLocator;
}

export interface ActiveFileContext {
  fileId: string;
  fileName: string;
  filePath?: string;
  type: ContextResourceType;
  strategy: 'full_text' | 'summary_rag' | 'summary_viewport_rag';
  content?: string;
  summary?: string;
  tokenCount?: number;
}

export interface ResourceContext {
  fileId: string;
  fileName: string;
  filePath?: string;
  type: ContextResourceType;
  summary?: string;
  tokenCount?: number;
  indexed: boolean;
  lastOpenedAt?: string;
  isActiveFile?: boolean;
}

export interface RetrievedChunk {
  chunkId: string;
  sourceId?: string;
  fileId: string;
  fileName: string;
  content: string;
  score: number;
  confidence?: 'high' | 'medium' | 'low';
  source?: 'selection' | 'viewport' | 'active_file' | 'retrieval';
  retrievalReason?: string;
  matchedTerms?: string[];
  scoreBreakdown?: Record<string, number>;
  locator?: ContextLocator;
  supportSnippets?: Array<{
    text: string;
    locator?: ContextLocator;
    score?: number;
  }>;
  citationQuality?: {
    supportCount: number;
    sourceCount: number;
    grounded: boolean;
  };
}

export interface Citation {
  sourceId?: string;
  fileId: string;
  fileName: string;
  locator?: ContextLocator;
  label: string;
  confidence?: 'high' | 'medium' | 'low';
  sourceType?: 'selection' | 'viewport' | 'active_file' | 'retrieval' | 'pinned';
  score?: number;
  retrievalReason?: string;
  matchedTerms?: string[];
  scoreBreakdown?: Record<string, number>;
  preview?: string;
  supportSnippets?: Array<{
    text: string;
    locator?: ContextLocator;
    score?: number;
  }>;
  citationQuality?: {
    supportCount: number;
    sourceCount: number;
    grounded: boolean;
  };
}

export interface SourceInspectorItem {
  sourceId: string;
  sourceType: 'selection' | 'viewport' | 'active_file' | 'retrieval' | 'pinned';
  confidence: 'high' | 'medium' | 'low';
  fileId: string;
  fileName: string;
  label: string;
  locator?: ContextLocator;
  score?: number;
  retrievalReason?: string;
  matchedTerms?: string[];
  scoreBreakdown?: Record<string, number>;
  preview?: string;
  supportSnippets?: Array<{
    text: string;
    locator?: ContextLocator;
    score?: number;
  }>;
  citationQuality?: {
    supportCount: number;
    sourceCount: number;
    grounded: boolean;
  };
  includedInPrompt: boolean;
}

export interface ProfileSummary {
  content: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextCapsule {
  capsuleId: string;
  userId: string;
  workspaceId: string;
  workbenchId?: string;
  folderId?: string;
  activePanelId?: string;
  activeFileId?: string;
  mode: ContextMode;
  selection?: SelectionContext;
  viewport?: ViewportContext;
  activeFile?: ActiveFileContext;
  resources?: ResourceContext[];
  retrievedChunks?: RetrievedChunk[];
  profileSummary?: ProfileSummary;
  recentMessages?: ChatMessage[];
  tokenBudget: number;
  estimatedTokens: number;
  estimatedTokensByLayer?: Record<string, number>;
  promptContextPreview?: string;
  fallbackReasons?: string[];
  clippedItems?: Array<{ layer: string; reason: string }>;
  citations: Citation[];
  sourceMap?: SourceInspectorItem[];
  createdAt: string;
}

export interface ContextPolicyDecision {
  includeSelection: boolean;
  includeViewport: boolean;
  includeActiveFileFullText: boolean;
  includeActiveFileSummary: boolean;
  ragScope: 'active_file' | 'workbench' | 'workspace' | 'none';
  includeResourceSummaries: boolean;
  maxRetrievedChunks: number;
  intent?: 'local_reference' | 'summarize_current' | 'cross_resource' | 'workspace_search' | 'code_help' | 'general_qa';
  layerScores?: Record<string, number>;
  requiredLayers?: string[];
  reasons: string[];
}
