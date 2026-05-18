import crypto from 'crypto';
import prisma from '../config/db';
import { FileSystemService } from './fileSystemService';
import {
  PdfPageText,
  StructuredDocumentChunk,
  documentTextExtractionService
} from './documentTextExtractionService';
import { knowledgeIndexingService } from './knowledgeIndexingService';
import { knowledgeSearchService } from './knowledgeSearchService';
import { documentChunkStore } from './documentChunkStore';
import { findWorkbenchResourceFiles } from './workbenchResourceScope';
import { videoAnalysisService } from './videoAnalysisService';
import { stableHash } from './chunkSchema';
import { LocalStorageService } from './storage/localStorageService';
import {
  ActiveFileContext,
  ChatMessage,
  ChatSessionAttachmentContext,
  Citation,
  ContextCapsule,
  ContextMode,
  ContextPolicyDecision,
  ContextResourceType,
  RetrievedChunk,
  ResourceContext,
  SourceInspectorItem,
  VisualEvidenceItem,
  SelectionContext,
  ViewportContext
} from '../types/contextSystem';

export interface ClientContextChip {
  id: string;
  kind: 'selection' | 'viewport' | 'active_file' | 'resource_scope';
  enabled?: boolean;
}

export interface ClientPanelContext {
  panelId: string;
  panelType: string;
  title?: string;
  fileId?: string | null;
  fileName?: string;
  filePath?: string;
  visiblePages?: number[];
  primaryPage?: number;
  visibleLineRange?: { start: number; end: number } | null;
  visibleBlockIds?: string[];
  approxChunkIndex?: number | null;
  scrollRatio?: number | null;
  selectedText?: string;
  selectedRange?: {
    page?: number;
    pageStart?: number;
    pageEnd?: number;
    timestampStart?: number;
    timestampEnd?: number;
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
  } | null;
  visibleContent?: string;
  language?: string;
}

export interface ClientWorkbenchContext {
  userId?: string;
  sessionId?: string;
  workspaceId: string;
  workbenchId?: string | null;
  folderId?: string | null;
  workbenchTitle?: string;
  workbenchDescription?: string;
  activePanelId?: string | null;
  activeFileId?: string | null;
  contextMode?: ContextMode;
  sourcePriority?: 'selected_resources' | 'active_context' | 'mixed';
  activeContextChips?: ClientContextChip[];
  activeFile?: {
    id?: string;
    name?: string;
    path?: string;
    content?: string;
  } | null;
  openPanels?: ClientPanelContext[];
  lockedSelection?: {
    id?: string;
    panelId?: string;
    panelType?: string;
    fileId?: string | null;
    fileName?: string;
    filePath?: string;
    content: string;
    locator?: ClientPanelContext['selectedRange'] & {
      lineStart?: number;
      lineEnd?: number;
      blockIds?: string[];
      scrollRatio?: number;
      chunkIndex?: number;
    };
  } | null;
  persistentCitations?: Array<{
    fileId: string;
    fileName: string;
    label?: string;
    locator?: Citation['locator'];
  }>;
  chatSessionAttachments?: ChatSessionAttachmentContext[];
  selectedResourceIds?: string[];
  selectedText?: string;
  recentMessages?: ChatMessage[];
}

const DEFAULT_TOKEN_BUDGET = Number(process.env.CONTEXT_TOKEN_BUDGET || 12000);
const FULL_TEXT_LIMIT = Number(process.env.CONTEXT_ACTIVE_FILE_FULL_TEXT_TOKENS || 20000);
const SUMMARY_LIMIT = Number(process.env.CONTEXT_ACTIVE_FILE_SUMMARY_TOKENS || 100000);

const clip = (value: string | null | undefined, maxLength = 500) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const clipBlock = (value: string | null | undefined, maxLength = 900) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const estimateTokens = (value: string | null | undefined) => Math.ceil(String(value || '').length / 4);

const sanitizeChatSessionAttachment = (attachment: any): ChatSessionAttachmentContext | null => {
  if (!attachment || typeof attachment !== 'object') return null;
  const name = String(attachment.name || '').trim().slice(0, 180);
  if (!name) return null;
  const mimeType = String(attachment.mimeType || attachment.type || 'application/octet-stream').slice(0, 120);
  const rawKind = String(attachment.kind || '').toLowerCase();
  const kind = (['text', 'image', 'pdf', 'document', 'file'].includes(rawKind) ? rawKind : 'file') as ChatSessionAttachmentContext['kind'];
  const dataUrl =
    typeof attachment.dataUrl === 'string' && attachment.dataUrl.startsWith('data:') && attachment.dataUrl.length <= 6_000_000
      ? attachment.dataUrl
      : undefined;
  const base64Data =
    typeof attachment.base64Data === 'string' && attachment.base64Data.length <= 5_500_000
      ? attachment.base64Data
      : undefined;

  return {
    id: typeof attachment.id === 'string' ? attachment.id : crypto.randomUUID(),
    name,
    mimeType,
    size: typeof attachment.size === 'number' ? attachment.size : 0,
    kind,
    createdAt: typeof attachment.createdAt === 'string' ? attachment.createdAt : undefined,
    textContent: typeof attachment.textContent === 'string' ? clip(attachment.textContent, 12000) : undefined,
    summary: typeof attachment.summary === 'string' ? clip(attachment.summary, 2000) : undefined,
    dataUrl,
    base64Data,
    fileObjectId: typeof attachment.fileObjectId === 'string' ? attachment.fileObjectId : undefined,
    savedToWorkbench: Boolean(attachment.savedToWorkbench),
    status: ['ready', 'metadata_only', 'error'].includes(attachment.status) ? attachment.status : undefined,
    error: typeof attachment.error === 'string' ? clip(attachment.error, 240) : undefined
  };
};

const parseJsonObject = (value?: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const storedVideoAnalysis = (file: { metadataJson?: string | null }) => {
  const metadata = parseJsonObject(file.metadataJson);
  const analysis = metadata.videoAnalysis;
  return analysis && typeof analysis === 'object' ? analysis as Record<string, any> : null;
};

const hasStoredVideoAnalysis = (file: { metadataJson?: string | null }) => {
  const analysis = storedVideoAnalysis(file);
  if (!analysis) return false;
  return Boolean(
    analysis.status ||
    analysis.sourceUrl ||
    analysis.provider ||
    analysis.summary ||
    (Array.isArray(analysis.transcript) && analysis.transcript.length) ||
    (Array.isArray(analysis.chapters) && analysis.chapters.length) ||
    (Array.isArray(analysis.keyPoints) && analysis.keyPoints.length) ||
    (Array.isArray(analysis.slides) && analysis.slides.length)
  );
};

const hasIndexableVideoAnalysis = (file: { metadataJson?: string | null }) => {
  const analysis = storedVideoAnalysis(file);
  if (!analysis) return false;
  return Boolean(
    analysis.summary ||
    (Array.isArray(analysis.transcript) && analysis.transcript.length) ||
    (Array.isArray(analysis.chapters) && analysis.chapters.length) ||
    (Array.isArray(analysis.keyPoints) && analysis.keyPoints.length) ||
    (Array.isArray(analysis.slides) && analysis.slides.length)
  );
};

const videoAnalysisSourceHash = (analysis: Record<string, any>) =>
  stableHash({
    runId: analysis.runId,
    generatedAt: analysis.generatedAt,
    manualRevision: analysis.manualRevision,
    transcriptCount: Array.isArray(analysis.transcript) ? analysis.transcript.length : 0,
    chapterCount: Array.isArray(analysis.chapters) ? analysis.chapters.length : 0,
    keyPointCount: Array.isArray(analysis.keyPoints) ? analysis.keyPoints.length : 0,
    slideCount: Array.isArray(analysis.slides) ? analysis.slides.length : 0
  });

const imageDataUrlFromFile = (file: { storageKey?: string | null; mimeType?: string | null }) => {
  if (!file.storageKey || !file.mimeType?.startsWith('image/')) return null;
  try {
    const fs = require('fs');
    const filePath = LocalStorageService.getFilePath(file.storageKey);
    return `data:${file.mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {
    return null;
  }
};

const renderPdfPageDataUrls = async (
  file: { storageKey?: string | null },
  pages: number[]
): Promise<Map<number, string>> => {
  const rendered = new Map<number, string>();
  if (!file.storageKey || !pages.length) return rendered;

  try {
    const fs = require('fs/promises');
    const { createCanvas } = require('@napi-rs/canvas');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const buffer = await fs.readFile(LocalStorageService.getFilePath(file.storageKey));
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true,
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0
    } as any);
    const document = await loadingTask.promise;
    try {
      for (const pageNumber of pages) {
        if (pageNumber < 1 || pageNumber > document.numPages) continue;
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.35 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport } as any).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (dataUrl?.startsWith('data:image/')) rendered.set(pageNumber, dataUrl);
      }
    } finally {
      await document?.destroy?.().catch(() => undefined);
    }
  } catch {
    return rendered;
  }

  return rendered;
};

const fileTypeFromName = (file: {
  name?: string | null;
  extension?: string | null;
  fileCategory?: string | null;
  mimeType?: string | null;
  metadataJson?: string | null;
}): ContextResourceType => {
  const extension = (file.extension || file.name?.split('.').pop() || '').toLowerCase();
  const category = (file.fileCategory || '').toLowerCase();
  const mimeType = (file.mimeType || '').toLowerCase();

  if (hasStoredVideoAnalysis(file)) return 'video';
  if (mimeType.startsWith('video/') || category === 'media') return 'video';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx' || extension === 'doc') return 'docx';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (category === 'code') return 'code';
  if (category === 'generated') return 'generated';
  return 'blocksuite';
};

const panelTypeFromClient = (panelType: string, resourceType?: ContextResourceType): ViewportContext['panelType'] => {
  if (resourceType === 'pdf') return 'pdf';
  if (resourceType === 'docx') return 'docx';
  if (resourceType === 'markdown') return 'markdown';
  if (resourceType === 'video') return 'video';
  if (panelType === 'external') return 'web';
  if (panelType === 'code') return 'code';
  return 'blocksuite';
};

const selectionTypeFromPanel = (panelType: string, resourceType?: ContextResourceType): SelectionContext['type'] => {
  if (resourceType === 'pdf') return 'pdf_text';
  if (resourceType === 'docx') return 'docx';
  if (resourceType === 'markdown') return 'markdown';
  if (panelType === 'code' || resourceType === 'code') return 'code';
  return 'block';
};

const citationLabel = (fileName: string, locator?: Citation['locator']) => {
  if (typeof locator?.timestampStart === 'number') {
    const start = secondsToClock(locator.timestampStart);
    const end = typeof locator.timestampEnd === 'number' && locator.timestampEnd !== locator.timestampStart
      ? `-${secondsToClock(locator.timestampEnd)}`
      : '';
    return `${fileName} ${start}${end}`;
  }
  if (locator?.page || locator?.primaryPage) return `${fileName} 第 ${locator.page || locator.primaryPage} 页`;
  if (locator?.pageStart && locator?.pageEnd) {
    return locator.pageStart === locator.pageEnd
      ? `${fileName} 第 ${locator.pageStart} 页`
      : `${fileName} 第 ${locator.pageStart}-${locator.pageEnd} 页`;
  }
  if (locator?.lineStart || locator?.startLine) {
    const start = locator.lineStart || locator.startLine;
    const end = locator.lineEnd || locator.endLine || start;
    return `${fileName} 行 ${start}-${end}`;
  }
  if (locator?.headingPath?.length) {
    const suffix =
      typeof locator.paragraphIndex === 'number'
        ? `，段落 ${locator.paragraphIndex + 1}`
        : typeof locator.chunkIndex === 'number'
          ? `，chunk ${locator.chunkIndex}`
          : '';
    return `${fileName}，章节：${locator.headingPath.join(' / ')}${suffix}`;
  }
  if (locator?.blockId) return `${fileName} block ${locator.blockId}`;
  if (typeof locator?.paragraphIndex === 'number') return `${fileName} 段落 ${locator.paragraphIndex + 1}`;
  if (typeof locator?.chunkIndex === 'number') return `${fileName} chunk ${locator.chunkIndex}`;
  return fileName;
};

const secondsToClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

export class ContextPolicyEngine {
  private inferIntent(query: string, contextMode: ContextMode): NonNullable<ContextPolicyDecision['intent']> {
    if (/这里|这段|这页|这个公式|这段代码|当前可见|visible|above|below/i.test(query)) return 'local_reference';
    if (/这篇|当前文件|整篇文档|当前代码|summarize current|current file|总结|概括|摘要|提炼/i.test(query)) {
      return 'summarize_current';
    }
    if (/这些资料|当前文件夹|当前\s*Workbench|workbench|结合这些文件|结合当前.*资料/i.test(query)) return 'cross_resource';
    if (/整个课程|全部资料|全局|workspace|所有资料|知识库/i.test(query)) return 'workspace_search';
    if (/代码|code|bug|复杂度|函数|class|方法|报错|stack trace|exception/i.test(query)) return 'code_help';
    if (contextMode === 'workspace') return 'workspace_search';
    if (contextMode === 'workbench') return 'cross_resource';
    if (contextMode === 'active_file') return 'summarize_current';
    return 'general_qa';
  }

  decide(input: {
    userQuery: string;
    contextMode: ContextMode;
    hasSelection: boolean;
    hasViewport: boolean;
    activeFileTokenCount?: number;
    resourceCount?: number;
    tokenBudget: number;
  }): ContextPolicyDecision {
    const query = input.userQuery;
    const reasons: string[] = [];
    const intent = this.inferIntent(query, input.contextMode);
    const layerScores: Record<string, number> = {
      selection: input.hasSelection ? 0.75 : 0,
      viewport: input.hasViewport ? 0.55 : 0,
      activeFile: 0.35,
      resourceScope: 0.45,
      retrieval: 0.6
    };
    const decision: ContextPolicyDecision = {
      includeSelection: false,
      includeViewport: false,
      includeActiveFileFullText: false,
      includeActiveFileSummary: false,
      ragScope: 'workbench',
      includeResourceSummaries: true,
      maxRetrievedChunks: 6,
      intent,
      layerScores,
      requiredLayers: [],
      reasons
    };

    const enableActiveFile = () => {
      const tokens = input.activeFileTokenCount || 0;
      if (tokens > 0 && tokens <= FULL_TEXT_LIMIT) {
        decision.includeActiveFileFullText = true;
        decision.includeActiveFileSummary = false;
      } else {
        decision.includeActiveFileFullText = false;
        decision.includeActiveFileSummary = true;
      }
      decision.ragScope = 'active_file';
      decision.requiredLayers?.push('activeFile');
    };

    if (input.hasSelection) {
      decision.includeSelection = true;
      decision.includeViewport = input.hasViewport;
      decision.ragScope = 'active_file';
      decision.maxRetrievedChunks = 4;
      layerScores.selection += 0.35;
      decision.requiredLayers?.push('selection');
      reasons.push('存在 L0 选区，优先注入 selection 并限制到当前文件检索');
    } else if (input.hasViewport) {
      decision.includeViewport = true;
      layerScores.viewport += 0.25;
      reasons.push('无选区，默认注入 L1 viewport');
    }

    if (intent === 'local_reference') {
      decision.includeSelection = input.hasSelection;
      decision.includeViewport = input.hasViewport;
      decision.ragScope = 'active_file';
      decision.maxRetrievedChunks = Math.min(decision.maxRetrievedChunks, 4);
      layerScores.selection += 0.3;
      layerScores.viewport += 0.35;
      reasons.push('问题指向当前位置，强制使用 selection/viewport');
    }

    if (intent === 'summarize_current') {
      enableActiveFile();
      layerScores.activeFile += 0.45;
      layerScores.retrieval += 0.2;
      reasons.push('问题指向当前文件，启用 L3 active file 策略');
    }

    if (
      input.contextMode === 'auto' &&
      (input.resourceCount || 0) <= 1 &&
      /总结|概括|内容|分析|讲讲|说明|提炼|重点|摘要|summarize|summary/i.test(query)
    ) {
      enableActiveFile();
      decision.includeResourceSummaries = true;
      layerScores.activeFile += 0.2;
      reasons.push('当前 Workbench 只有一个资源，自动把泛化总结/分析问题绑定到当前文件');
    }

    if (intent === 'cross_resource') {
      decision.ragScope = 'workbench';
      decision.includeResourceSummaries = true;
      decision.maxRetrievedChunks = 8;
      layerScores.resourceScope += 0.35;
      layerScores.retrieval += 0.3;
      decision.requiredLayers?.push('retrieval');
      reasons.push('问题指向 Workbench 资料池，启用 scoped RAG');
    }

    if (intent === 'workspace_search') {
      decision.ragScope = 'workspace';
      decision.includeResourceSummaries = true;
      decision.maxRetrievedChunks = 10;
      layerScores.resourceScope += 0.25;
      layerScores.retrieval += 0.45;
      decision.requiredLayers?.push('retrieval');
      reasons.push('问题指向 Workspace 全局资料');
    }

    if (intent === 'code_help') {
      decision.includeSelection = input.hasSelection;
      decision.includeViewport = input.hasViewport;
      decision.ragScope = 'active_file';
      decision.maxRetrievedChunks = 6;
      layerScores.viewport += 0.25;
      layerScores.activeFile += 0.25;
      reasons.push('问题指向代码/调试场景，优先当前文件、可视行号和邻近代码块');
    }

    if (input.contextMode !== 'auto') {
      reasons.push(`用户显式选择 contextMode=${input.contextMode}`);
      if (input.contextMode === 'selection_only') {
        decision.includeSelection = input.hasSelection;
        decision.includeViewport = false;
        decision.includeActiveFileFullText = false;
        decision.includeActiveFileSummary = false;
        decision.ragScope = 'none';
        decision.includeResourceSummaries = false;
        decision.maxRetrievedChunks = 0;
        decision.requiredLayers = input.hasSelection ? ['selection'] : [];
      } else if (input.contextMode === 'viewport') {
        decision.includeSelection = input.hasSelection;
        decision.includeViewport = input.hasViewport;
        decision.ragScope = 'active_file';
        decision.maxRetrievedChunks = 3;
        decision.requiredLayers = input.hasViewport ? ['viewport'] : [];
      } else if (input.contextMode === 'active_file') {
        decision.includeSelection = input.hasSelection;
        decision.includeViewport = input.hasViewport;
        enableActiveFile();
        decision.maxRetrievedChunks = 5;
      } else if (input.contextMode === 'workbench') {
        decision.includeSelection = input.hasSelection;
        decision.includeViewport = input.hasViewport;
        decision.ragScope = 'workbench';
        decision.includeResourceSummaries = true;
        decision.maxRetrievedChunks = 8;
        decision.requiredLayers?.push('retrieval');
      } else if (input.contextMode === 'workspace') {
        decision.includeSelection = input.hasSelection;
        decision.includeViewport = input.hasViewport;
        decision.ragScope = 'workspace';
        decision.includeResourceSummaries = true;
        decision.maxRetrievedChunks = 10;
        decision.requiredLayers?.push('retrieval');
      }
    }

    decision.requiredLayers = Array.from(new Set(decision.requiredLayers));
    decision.reasons.unshift(`intent=${intent}`);
    return decision;
  }
}

export class WorkbenchContextService {
  private policyEngine = new ContextPolicyEngine();

  async buildCapsule(input: {
    context: ClientWorkbenchContext;
    messages: ChatMessage[];
    profileSummary?: string;
    tokenBudget?: number;
  }): Promise<{ capsule: ContextCapsule; policy: ContextPolicyDecision; promptPreview: string }> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.context.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const tokenBudget = input.tokenBudget || DEFAULT_TOKEN_BUDGET;
    const openPanels = input.context.openPanels || [];
    const activePanelId = input.context.activePanelId || null;
    const activePanel = openPanels.find((panel) => panel.panelId === activePanelId) || openPanels[0] || null;
    const lockedSelectionPanel = this.panelFromLockedSelection(input.context.lockedSelection);
    const activeFileId = input.context.activeFileId || activePanel?.fileId || input.context.activeFile?.id || null;
    const mode = input.context.contextMode || 'auto';
    const enabledChips = new Set(
      (input.context.activeContextChips || []).filter((chip) => chip.enabled !== false).map((chip) => chip.kind)
    );
    const chipsWereSubmitted = Boolean(input.context.activeContextChips?.length);
    const chipEnabled = (kind: ClientContextChip['kind']) => !chipsWereSubmitted || enabledChips.has(kind);
    const selectedText = clip(
      input.context.lockedSelection?.content || input.context.selectedText || activePanel?.selectedText || '',
      12000
    );
    const selectedResourceIds = [
      ...new Set((input.context.selectedResourceIds || []).filter((value): value is string => typeof value === 'string' && Boolean(value)))
    ];
    const selectedResourceFocus = input.context.sourcePriority === 'selected_resources';
    const chatSessionAttachments = (input.context.chatSessionAttachments || [])
      .map(sanitizeChatSessionAttachment)
      .filter((attachment): attachment is ChatSessionAttachmentContext => Boolean(attachment))
      .slice(-8);

    let fileRecords = await this.loadResourceRecords(input.context, openPanels, activeFileId);
    fileRecords = await this.ensureIndexedRecords(input.context.workspaceId, fileRecords);
    const recordsById = new Map(fileRecords.map((file) => [file.id, file] as const));
    const visualEvidence = await this.buildVisualEvidence(input.context.workspaceId, fileRecords);
    const activeRecord = activeFileId ? recordsById.get(activeFileId) : undefined;
    const activeFileContent =
      typeof input.context.activeFile?.content === 'string'
        ? input.context.activeFile.content
        : activeFileId
          ? await this.readFileTextForContext(input.context.workspaceId, activeFileId, activeRecord).catch(() => '')
          : '';
    const activeTokens = estimateTokens(activeFileContent);

    const fallbackReasons: string[] = [];
    const clippedItems: Array<{ layer: string; reason: string }> = [];
    const selectionPanel = lockedSelectionPanel || activePanel;
    const selectionRecord =
      lockedSelectionPanel?.fileId && lockedSelectionPanel.fileId !== activeFileId
        ? recordsById.get(lockedSelectionPanel.fileId)
        : activeRecord;
    const selection =
      selectedText && selectionPanel && chipEnabled('selection')
        ? this.buildSelection(selectionPanel, selectedText, selectionRecord)
        : undefined;
    const viewport =
      activePanel && chipEnabled('viewport')
        ? await this.buildViewport(input.context.workspaceId, activePanel, activeRecord, fallbackReasons)
        : undefined;

    const policy = this.policyEngine.decide({
      userQuery: [...input.messages].reverse().find((message) => message.role === 'user')?.content || '',
      contextMode: mode,
      hasSelection: Boolean(selection),
      hasViewport: Boolean(viewport?.content || viewport?.locator),
      activeFileTokenCount: activeTokens,
      resourceCount: fileRecords.length,
      tokenBudget
    });

    if (!chipEnabled('selection') || selectedResourceFocus) policy.includeSelection = false;
    if (!chipEnabled('viewport') || selectedResourceFocus) policy.includeViewport = false;
    if (!chipEnabled('active_file') || selectedResourceFocus) {
      policy.includeActiveFileFullText = false;
      policy.includeActiveFileSummary = false;
    }
    if (!chipEnabled('resource_scope')) {
      policy.includeResourceSummaries = false;
      if (policy.ragScope === 'workbench' || policy.ragScope === 'workspace') policy.ragScope = 'active_file';
    }

    const resources = this.buildResources(fileRecords, activeFileId, selectedResourceFocus ? selectedResourceIds : undefined);
    const activeFile =
      activeFileId && activeRecord && chipEnabled('active_file')
        ? this.buildActiveFile(activeRecord, activeFileContent, activeTokens, policy)
        : undefined;

    let retrievedChunks = await this.retrieve({
      query: [...input.messages].reverse().find((message) => message.role === 'user')?.content || '',
      workspaceId: input.context.workspaceId,
      activeFileId: selectedResourceFocus ? null : activeFileId,
      resourceFileIds: resources.map((resource) => resource.fileId),
      videoResourceFileIds: resources.filter((resource) => resource.type === 'video').map((resource) => resource.fileId),
      policy,
      selectedResourceFocus
    });

    retrievedChunks = [
      ...this.buildAttachmentChunks(chatSessionAttachments),
      ...this.packRetrievedChunks(retrievedChunks, tokenBudget, policy)
    ].slice(0, Math.max(policy.maxRetrievedChunks, chatSessionAttachments.length));

    const citations: Citation[] = [];
    if (selection && policy.includeSelection) {
      citations.push(
        this.toCitation(selection.fileId, selection.fileName, selection.locator, {
          sourceType: 'selection',
          confidence: 'high',
          preview: selection.content
        })
      );
    }
    if (viewport && policy.includeViewport) {
      citations.push(
        this.toCitation(viewport.fileId, viewport.fileName, viewport.locator, {
          sourceType: 'viewport',
          confidence: viewport.content ? 'high' : 'medium',
          preview: viewport.content
        })
      );
    }
    (input.context.persistentCitations || []).forEach((citation) =>
      citations.push({
        fileId: citation.fileId,
        fileName: citation.fileName,
        locator: citation.locator,
        label: citation.label || citationLabel(citation.fileName, citation.locator),
        sourceType: 'pinned',
        confidence: 'medium'
      })
    );
    retrievedChunks.forEach((chunk) =>
      citations.push(
        this.toCitation(chunk.fileId, chunk.fileName, chunk.locator, {
          confidence: this.confidenceForChunk(chunk),
          score: chunk.score,
          sourceType: chunk.source === 'chat_attachment' ? 'chat_attachment' : 'retrieval',
          retrievalReason: chunk.retrievalReason,
          matchedTerms: chunk.matchedTerms,
          scoreBreakdown: chunk.scoreBreakdown,
          preview: chunk.content,
          supportSnippets: chunk.supportSnippets,
          citationQuality: chunk.citationQuality
        })
      )
    );
    const sourceMap = this.buildSourceMap(this.dedupeCitations(citations));
    retrievedChunks = retrievedChunks.map((chunk) => {
      const matchedSource = sourceMap.find(
        (source) =>
          source.sourceType === 'retrieval' &&
          source.fileId === chunk.fileId &&
          citationLabel(chunk.fileName, chunk.locator) === source.label
      );
      return {
        ...chunk,
        sourceId: matchedSource?.sourceId,
        confidence: matchedSource?.confidence || this.confidenceForChunk(chunk)
      };
    });

    const capsule: ContextCapsule = {
      capsuleId: crypto.randomUUID(),
      userId: input.context.userId || workspace.userId,
      workspaceId: input.context.workspaceId,
      workbenchId: input.context.workbenchId || undefined,
      folderId: input.context.folderId || undefined,
      activePanelId: activePanelId || undefined,
      activeFileId: activeFileId || undefined,
      mode,
      selection: policy.includeSelection && !selectedResourceFocus ? selection : undefined,
      viewport: policy.includeViewport && !selectedResourceFocus ? viewport : undefined,
      activeFile: selectedResourceFocus ? undefined : activeFile,
      resources: policy.includeResourceSummaries ? resources : resources.map((resource) => ({ ...resource, summary: undefined })),
      chatSessionAttachments: this.stripAttachmentPayloads(chatSessionAttachments),
      retrievedChunks,
      visualEvidence,
      profileSummary: input.profileSummary ? { content: input.profileSummary } : undefined,
      recentMessages: this.trimRecentMessages(input.context.recentMessages || input.messages.slice(-8), tokenBudget),
      tokenBudget,
      estimatedTokens: 0,
      fallbackReasons,
      clippedItems,
      citations: sourceMap.map((source) => ({
        sourceId: source.sourceId,
        fileId: source.fileId,
        fileName: source.fileName,
        locator: source.locator,
        label: source.label,
        confidence: source.confidence,
        sourceType: source.sourceType,
        score: source.score,
        retrievalReason: source.retrievalReason,
        matchedTerms: source.matchedTerms,
        scoreBreakdown: source.scoreBreakdown,
        preview: source.preview,
        supportSnippets: source.supportSnippets,
        citationQuality: source.citationQuality
      })),
      sourceMap,
      createdAt: new Date().toISOString()
    };

    capsule.estimatedTokens = this.estimateCapsuleTokens(capsule);
    capsule.estimatedTokensByLayer = this.estimateTokensByLayer(capsule);
    this.enforceBudget(capsule);
    capsule.promptContextPreview = this.buildPromptPreview(capsule);

    return {
      capsule,
      policy,
      promptPreview: capsule.promptContextPreview || ''
    };
  }

  private async loadResourceRecords(
    context: ClientWorkbenchContext,
    openPanels: ClientPanelContext[],
    activeFileId: string | null
  ) {
    const selectedResourceIds = [
      ...new Set((context.selectedResourceIds || []).filter((value): value is string => typeof value === 'string' && Boolean(value)))
    ];
    const selectedResourceOnly = context.sourcePriority === 'selected_resources';
    const hasExplicitResourceSelection = selectedResourceIds.length > 0;
    const explicitIds = [
      ...new Set(
        openPanels
          .map((panel) => panel.fileId)
          .concat(activeFileId)
          .concat(context.lockedSelection?.fileId || null)
          .filter((value): value is string => Boolean(value))
      )
    ];

    if (selectedResourceOnly && !hasExplicitResourceSelection) {
      return [];
    }

    if (context.workbenchId) {
      const records = await findWorkbenchResourceFiles({
        workspaceId: context.workspaceId,
        workbenchId: context.workbenchId,
        include: {
          knowledgeChunks: { select: { id: true, summary: true, tokenEstimate: true, metadataJson: true }, take: 1 }
        },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }]
      });

      if (selectedResourceOnly) {
        const selectedSet = new Set(selectedResourceIds);
        return records.filter((record) => selectedSet.has(record.id));
      }

      if (explicitIds.length === 0) {
        return records;
      }

      const explicitSet = new Set(explicitIds);
      const explicitRecords = records.filter((record) => explicitSet.has(record.id));
      return explicitRecords.length ? explicitRecords : records;
    }

    if (explicitIds.length) {
      return prisma.fileSystemObject.findMany({
        where: { workspaceId: context.workspaceId, id: { in: explicitIds }, nodeType: 'file' },
        include: { knowledgeChunks: { select: { id: true, summary: true, tokenEstimate: true, metadataJson: true }, take: 1 } }
      });
    }

    return prisma.fileSystemObject.findMany({
      where: { workspaceId: context.workspaceId, nodeType: 'file' },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      include: { knowledgeChunks: { select: { id: true, summary: true, tokenEstimate: true, metadataJson: true }, take: 1 } }
    });
  }

  private async ensureIndexedRecords(workspaceId: string, fileRecords: any[]) {
    const missingIndexedRecords = fileRecords.filter((file) => {
      const type = fileTypeFromName(file);
      const analysis = storedVideoAnalysis(file);
      if (analysis && hasIndexableVideoAnalysis(file)) {
        const firstChunkMetadata = this.parseChunkMetadata(file.knowledgeChunks?.[0]?.metadataJson);
        const hasVideoChunk = firstChunkMetadata.source === 'video-analysis' || String(firstChunkMetadata.chunkType || '').startsWith('video_');
        const indexedHash = typeof firstChunkMetadata.videoAnalysisSourceHash === 'string'
          ? firstChunkMetadata.videoAnalysisSourceHash
          : typeof firstChunkMetadata.sourceHash === 'string' && firstChunkMetadata.source === 'video-analysis'
            ? firstChunkMetadata.sourceHash
            : undefined;
        return !hasVideoChunk || indexedHash !== videoAnalysisSourceHash(analysis);
      }
      if (file.knowledgeChunks?.length > 0) {
        const metadata = this.parseChunkMetadata(file.knowledgeChunks[0]?.metadataJson);
        if (metadata.locator || typeof metadata.chunkIndex === 'number' || metadata.page || metadata.lineStart) {
          return false;
        }
      }
      if (['pdf', 'docx', 'markdown', 'blocksuite', 'code'].includes(type)) return true;
      if (type === 'video') {
        const metadata = this.parseChunkMetadata(file.metadataJson);
        const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis as Record<string, any> : {};
        return Boolean(
          analysis.summary ||
          (Array.isArray(analysis.transcript) && analysis.transcript.length) ||
          (Array.isArray(analysis.slides) && analysis.slides.length)
        );
      }
      return false;
    });

    if (missingIndexedRecords.length === 0) return fileRecords;

    await Promise.all(
      missingIndexedRecords.map((file) => {
        if (fileTypeFromName(file) === 'video' && hasIndexableVideoAnalysis(file)) {
          return videoAnalysisService.indexStoredAnalysis(workspaceId, file.id, 'context-system-on-demand-video').catch(() => null);
        }
        return knowledgeIndexingService
          .indexFile({
            workspaceId,
            fileObjectId: file.id,
            reason: 'context-system-on-demand'
          })
          .catch(() => null);
      })
    );

    return prisma.fileSystemObject.findMany({
      where: { workspaceId, id: { in: fileRecords.map((file) => file.id) }, nodeType: 'file' },
      include: { knowledgeChunks: { select: { id: true, summary: true, tokenEstimate: true, metadataJson: true }, take: 1 } }
    });
  }

  private parseChunkMetadata(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  private panelFromLockedSelection(selection?: ClientWorkbenchContext['lockedSelection']): ClientPanelContext | null {
    if (!selection?.content?.trim()) return null;
    const locator = selection.locator || undefined;
    return {
      panelId: selection.panelId || `locked:${selection.fileId || selection.id || 'selection'}`,
      panelType: selection.panelType || 'resource',
      fileId: selection.fileId || null,
      fileName: selection.fileName,
      filePath: selection.filePath,
      visiblePages: locator?.page
        ? [locator.page]
        : locator?.pageStart
          ? [locator.pageStart]
          : undefined,
      primaryPage: locator?.page || locator?.pageStart,
      visibleLineRange:
        typeof locator?.lineStart === 'number'
          ? { start: locator.lineStart, end: locator.lineEnd || locator.lineStart }
          : null,
      visibleBlockIds: locator?.blockIds,
      approxChunkIndex: typeof locator?.chunkIndex === 'number' ? locator.chunkIndex : null,
      scrollRatio: typeof locator?.scrollRatio === 'number' ? locator.scrollRatio : null,
      selectedText: selection.content,
      selectedRange: locator || null
    };
  }

  private async readFileTextForContext(workspaceId: string, fileId: string, record?: any) {
    if (!record) {
      const file = await prisma.fileSystemObject.findFirst({ where: { workspaceId, id: fileId } });
      if (!file) return '';
      record = file;
    }

    if (fileTypeFromName(record) === 'video') {
      return this.videoTextForContext(record);
    }

    try {
      return await FileSystemService.getFileContent(workspaceId, fileId);
    } catch {
      const extracted = await documentTextExtractionService.extract(record);
      return extracted.text || '';
    }
  }

  private videoTextForContext(file: any) {
    const metadata = this.parseChunkMetadata(file.metadataJson);
    const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis as Record<string, any> : {};
    const transcript = Array.isArray(analysis.transcript) ? analysis.transcript : [];
    const chapters = Array.isArray(analysis.chapters) ? analysis.chapters : [];
    const keyPoints = Array.isArray(analysis.keyPoints) ? analysis.keyPoints : [];
    const slides = Array.isArray(analysis.slides) ? analysis.slides : [];
    return [
      `Video: ${analysis.title || file.name}`,
      analysis.summary ? `Summary:\n${analysis.summary}` : '',
      chapters.length
        ? `Chapters:\n${chapters.map((chapter: any) => `- [${secondsToClock(Number(chapter.start || 0))}] ${chapter.title || ''}: ${chapter.summary || ''}`).join('\n')}`
        : '',
      keyPoints.length
        ? `Key points:\n${keyPoints.map((point: any) => `- ${point.concept || ''}: ${point.explanation || ''}`).join('\n')}`
        : '',
      slides.length
        ? `Slides:\n${slides.filter((slide: any) => !slide.duplicateOf).map((slide: any) => `- [${secondsToClock(Number(slide.timestamp || 0))}] ${slide.title || ''}${slide.ocrText ? `\n  OCR: ${clip(slide.ocrText, 500)}` : ''}`).join('\n')}`
        : '',
      transcript.length
        ? `Transcript:\n${transcript.map((segment: any) => `[${secondsToClock(Number(segment.start || 0))} - ${secondsToClock(Number(segment.end || segment.start || 0))}] ${segment.text || ''}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n\n');
  }

  private buildSelection(panel: ClientPanelContext, selectedText: string, activeRecord?: any): SelectionContext {
    const resourceType = activeRecord ? fileTypeFromName(activeRecord) : undefined;
    const lineRange = panel.visibleLineRange || undefined;
    const selectedRange = panel.selectedRange || undefined;
    const page = selectedRange?.page || panel.visiblePages?.[0];
    const pageStart = selectedRange?.pageStart || selectedRange?.page || panel.visiblePages?.[0];
    const pageEnd =
      selectedRange?.pageEnd ||
      selectedRange?.page ||
      (panel.visiblePages?.length ? panel.visiblePages[panel.visiblePages.length - 1] : undefined);
    return {
      type: selectionTypeFromPanel(panel.panelType, resourceType),
      fileId: panel.fileId || panel.panelId,
      fileName: panel.fileName || panel.title || 'Selected context',
      panelId: panel.panelId,
      content: selectedText,
      locator: {
        page,
        pageStart,
        pageEnd,
        lineStart: lineRange?.start,
        lineEnd: lineRange?.end,
        blockIds: panel.visibleBlockIds,
        scrollRatio: panel.scrollRatio ?? undefined,
        chunkIndex: typeof panel.approxChunkIndex === 'number' ? panel.approxChunkIndex : undefined,
        timestampStart: selectedRange?.timestampStart,
        timestampEnd: selectedRange?.timestampEnd,
        charStart: selectedRange?.charStart,
        charEnd: selectedRange?.charEnd,
        textLength: selectedRange?.textLength,
        rects: selectedRange?.rects
      }
    };
  }

  private async buildViewport(
    workspaceId: string,
    panel: ClientPanelContext,
    activeRecord: any,
    fallbackReasons: string[]
  ): Promise<ViewportContext> {
    const resourceType = activeRecord ? fileTypeFromName(activeRecord) : undefined;
    const lineRange = panel.visibleLineRange || undefined;
    const resolved = activeRecord
      ? await this.readViewportText(workspaceId, panel, activeRecord, resourceType, fallbackReasons)
      : {
          content: clip(panel.visibleContent, 5000),
          locator: {
            visiblePages: panel.visiblePages,
            primaryPage: panel.primaryPage || panel.visiblePages?.[0],
            scrollRatio: panel.scrollRatio ?? undefined,
            startLine: lineRange?.start,
            endLine: lineRange?.end,
            lineStart: lineRange?.start,
            lineEnd: lineRange?.end,
            blockIds: panel.visibleBlockIds
          }
        };

    return {
      panelId: panel.panelId,
      fileId: panel.fileId || panel.panelId,
      fileName: panel.fileName || panel.title || 'Visible context',
      panelType: panelTypeFromClient(panel.panelType, resourceType),
      content: resolved.content,
      locator: {
        visiblePages: panel.visiblePages,
        primaryPage: panel.primaryPage || panel.visiblePages?.[0],
        scrollRatio: panel.scrollRatio ?? undefined,
        startLine: lineRange?.start,
        endLine: lineRange?.end,
        lineStart: lineRange?.start,
        lineEnd: lineRange?.end,
        blockIds: panel.visibleBlockIds,
        ...resolved.locator
      }
    };
  }

  private async readViewportText(
    workspaceId: string,
    panel: ClientPanelContext,
    file: any,
    resourceType: ContextResourceType | undefined,
    fallbackReasons: string[]
  ): Promise<{ content: string; locator: ViewportContext['locator'] }> {
    const lineRange = panel.visibleLineRange || undefined;

    if (resourceType === 'pdf') {
      const pages = panel.visiblePages?.length
        ? panel.visiblePages
        : panel.primaryPage
          ? [panel.primaryPage]
          : [1];
      try {
        const pageTexts = await documentTextExtractionService.extractPdfPages(file, pages);
        const nonEmptyPages = pageTexts.filter((page) => page.text.trim());
        if (nonEmptyPages.length) {
          return {
            content: clip(
              nonEmptyPages.map((page) => `[第 ${page.page} 页]\n${page.text}`).join('\n\n'),
              7000
            ),
            locator: this.locatorFromPdfPages(nonEmptyPages)
          };
        }
        fallbackReasons.push(`${file.name}: PDF 第 ${pages.join(',')} 页没有可提取文本`);
      } catch (error) {
        fallbackReasons.push(`${file.name}: PDF viewport 提取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (resourceType === 'code') {
      try {
        const content = await this.readFileTextForContext(workspaceId, file.id, file);
        const lines = content.split('\n');
        const requestedStart = Math.max(1, lineRange?.start || 1);
        const requestedEnd = Math.max(requestedStart, lineRange?.end || Math.min(lines.length, requestedStart + 40));
        const start = Math.max(1, requestedStart - 15);
        const end = Math.min(lines.length, requestedEnd + 15);
        const visible = lines
          .slice(start - 1, end)
          .map((line, index) => `${start + index}: ${line}`)
          .join('\n');
        return {
          content: clip(visible, 7000),
          locator: { lineStart: start, lineEnd: end, startLine: start, endLine: end, chunkIndex: start - 1 }
        };
      } catch (error) {
        fallbackReasons.push(`${file.name}: code viewport 读取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (resourceType === 'docx' || resourceType === 'markdown' || resourceType === 'blocksuite') {
      try {
        const storedChunks = await documentChunkStore.listFileChunks({
          workspaceId,
          fileObjectId: file.id
        });
        const chunks = storedChunks.length
          ? storedChunks.map((chunk) => ({
              fileId: chunk.fileObjectId,
              chunkIndex: chunk.chunkIndex,
              text: chunk.text,
              headingPath: chunk.locator.headingPath,
              paragraphIndex: chunk.locator.paragraphIndex,
              blockId: chunk.locator.blockId,
              lineStart: chunk.locator.lineStart,
              lineEnd: chunk.locator.lineEnd,
              charStart: chunk.locator.charStart,
              charEnd: chunk.locator.charEnd
            }))
          : resourceType === 'markdown' || resourceType === 'blocksuite'
            ? documentTextExtractionService.chunkTextByType(
                await this.readFileTextForContext(workspaceId, file.id, file),
                file.extension,
                file.id
              )
            : await documentTextExtractionService.extractChunks(file);
        const selectedChunks = this.pickViewportChunks(chunks, panel);
        if (selectedChunks.length) {
          return {
            content: clip(
              selectedChunks
                .map((chunk) => {
                  const heading = chunk.headingPath?.length ? `章节：${chunk.headingPath.join(' / ')}\n` : '';
                  return `${heading}${chunk.text}`;
                })
                .join('\n\n'),
              7000
            ),
            locator: this.mergeChunkLocators(selectedChunks)
          };
        }
        fallbackReasons.push(`${file.name}: 没有找到与 viewport 对应的文档 chunk`);
      } catch (error) {
        fallbackReasons.push(`${file.name}: 文档 viewport 提取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (resourceType === 'video') {
      try {
        const chunks = await documentChunkStore.listFileChunks({ workspaceId, fileObjectId: file.id });
        const videoChunks = chunks.filter((chunk) =>
          ['video_transcript', 'video_chapter', 'video_key_point', 'video_slide', 'summary'].includes(chunk.chunkType)
        );
        const selected = this.pickViewportChunks(videoChunks.map((chunk) => ({
          fileId: chunk.fileObjectId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          headingPath: chunk.headingPath,
          lineStart: chunk.locator.lineStart,
          lineEnd: chunk.locator.lineEnd,
          charStart: chunk.locator.charStart,
          charEnd: chunk.locator.charEnd
        })), panel);
        const selectedIndexes = new Set(selected.map((chunk) => chunk.chunkIndex));
        const selectedVideoChunks = videoChunks.filter((chunk) => selectedIndexes.has(chunk.chunkIndex)).slice(0, 6);
        if (selectedVideoChunks.length) {
          return {
            content: clip(selectedVideoChunks.map((chunk) => chunk.text).join('\n\n'), 7000),
            locator: {
              chunkIndex: selectedVideoChunks[0].chunkIndex,
              headingPath: selectedVideoChunks[0].headingPath,
              timestampStart: selectedVideoChunks[0].locator.timestampStart,
              timestampEnd: selectedVideoChunks[selectedVideoChunks.length - 1].locator.timestampEnd
            }
          };
        }
      } catch (error) {
        fallbackReasons.push(`${file.name}: video viewport 提取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const fallback = clip(panel.visibleContent, 5000);
    if (!fallback) fallbackReasons.push(`${file.name}: viewport 正文为空，已降级为 locator-only context`);
    return {
      content: fallback,
      locator: {
        visiblePages: panel.visiblePages,
        primaryPage: panel.primaryPage || panel.visiblePages?.[0],
        lineStart: lineRange?.start,
        lineEnd: lineRange?.end,
        blockIds: panel.visibleBlockIds,
        scrollRatio: panel.scrollRatio ?? undefined
      }
    };
  }

  private locatorFromPdfPages(pageTexts: PdfPageText[]) {
    const pages = pageTexts.map((page) => page.page).sort((left, right) => left - right);
    return {
      page: pages.length === 1 ? pages[0] : undefined,
      pageStart: pages[0],
      pageEnd: pages[pages.length - 1],
      primaryPage: pages[0],
      visiblePages: pages,
      chunkIndex: Math.max(0, pages[0] - 1),
      charStart: pageTexts[0]?.charStart,
      charEnd: pageTexts[pageTexts.length - 1]?.charEnd
    };
  }

  private pickViewportChunks(chunks: StructuredDocumentChunk[], panel: ClientPanelContext) {
    if (chunks.length === 0) return [];
    const blockIds = new Set(panel.visibleBlockIds || []);
    if (blockIds.size > 0) {
      const byBlock = chunks.filter((chunk) => chunk.blockId && blockIds.has(chunk.blockId));
      if (byBlock.length) return byBlock;
    }

    const explicitIndex =
      typeof panel.approxChunkIndex === 'number'
        ? panel.approxChunkIndex
        : typeof panel.scrollRatio === 'number'
          ? Math.round(panel.scrollRatio * Math.max(0, chunks.length - 1))
          : 0;
    const center = Math.max(0, Math.min(chunks.length - 1, explicitIndex));
    const start = Math.max(0, center - 2);
    const end = Math.min(chunks.length, center + 3);
    return chunks.slice(start, end);
  }

  private mergeChunkLocators(chunks: StructuredDocumentChunk[]) {
    const first = chunks[0];
    const last = chunks[chunks.length - 1] || first;
    const blockIds = chunks.map((chunk) => chunk.blockId).filter((value): value is string => Boolean(value));
    return {
      chunkIndex: first.chunkIndex,
      paragraphIndex: first.paragraphIndex,
      headingPath: first.headingPath,
      lineStart: first.lineStart,
      lineEnd: last.lineEnd || first.lineEnd,
      blockId: blockIds.length === 1 ? blockIds[0] : undefined,
      blockIds: blockIds.length > 1 ? blockIds : undefined,
      charStart: first.charStart,
      charEnd: last.charEnd
    };
  }

  private buildResources(fileRecords: any[], activeFileId: string | null, primaryResourceIds?: string[]): ResourceContext[] {
    const primaryOrder = new Map((primaryResourceIds || []).map((id, index) => [id, index] as const));
    return fileRecords
      .map((file) => {
      const indexed = file.knowledgeChunks?.length > 0;
      const summary = file.knowledgeChunks?.[0]?.summary || undefined;
      return {
        fileId: file.id,
        fileName: file.name,
        filePath: file.path,
        type: fileTypeFromName(file),
        summary: summary || `${file.name} (${file.fileCategory || file.extension || 'file'})`,
        tokenCount: file.knowledgeChunks?.[0]?.tokenEstimate || undefined,
        indexed,
        isActiveFile: file.id === activeFileId,
        lastOpenedAt: file.updatedAt?.toISOString?.()
      };
      })
      .sort((left, right) => {
        const leftPrimary = primaryOrder.has(left.fileId);
        const rightPrimary = primaryOrder.has(right.fileId);
        if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
        if (leftPrimary && rightPrimary) return (primaryOrder.get(left.fileId) || 0) - (primaryOrder.get(right.fileId) || 0);
        return 0;
      });
  }

  private buildActiveFile(
    file: any,
    content: string,
    tokenCount: number,
    policy: ContextPolicyDecision
  ): ActiveFileContext {
    const summary = clip(file.knowledgeChunks?.[0]?.summary || content, 1200);
    const strategy =
      tokenCount <= FULL_TEXT_LIMIT && policy.includeActiveFileFullText
        ? 'full_text'
        : tokenCount <= SUMMARY_LIMIT
          ? 'summary_rag'
          : 'summary_viewport_rag';

    return {
      fileId: file.id,
      fileName: file.name,
      filePath: file.path,
      type: fileTypeFromName(file),
      strategy,
      content: strategy === 'full_text' ? clip(content, 80000) : undefined,
      summary,
      tokenCount
    };
  }

  private async retrieve(input: {
    query: string;
    workspaceId: string;
    activeFileId: string | null;
    resourceFileIds: string[];
    videoResourceFileIds: string[];
    policy: ContextPolicyDecision;
    selectedResourceFocus?: boolean;
  }): Promise<RetrievedChunk[]> {
    if (input.policy.ragScope === 'none' || input.policy.maxRetrievedChunks <= 0) return [];

    const fileIds =
      input.selectedResourceFocus
        ? input.resourceFileIds
        : input.policy.ragScope === 'active_file'
        ? input.activeFileId
          ? [input.activeFileId]
          : []
        : input.policy.ragScope === 'workbench'
          ? input.resourceFileIds
          : undefined;

    if (input.selectedResourceFocus && (fileIds || []).length === 0) return [];

    const results = await knowledgeSearchService.search({
      workspaceId: input.workspaceId,
      query: input.query,
      fileIds,
      limit: input.policy.maxRetrievedChunks,
      activeFileId: input.activeFileId,
      requireDiversity: input.policy.ragScope !== 'active_file'
    });

    const retrieved = results.map((item) => {
      const metadataLocator =
        item.metadata.locator && typeof item.metadata.locator === 'object'
          ? (item.metadata.locator as Record<string, unknown>)
          : item.metadata;
      const page = typeof metadataLocator.page === 'number' ? metadataLocator.page : undefined;
      const pageStart = typeof metadataLocator.pageStart === 'number' ? metadataLocator.pageStart : undefined;
      const pageEnd = typeof metadataLocator.pageEnd === 'number' ? metadataLocator.pageEnd : undefined;
      const lineStart =
        typeof metadataLocator.lineStart === 'number'
          ? metadataLocator.lineStart
          : typeof metadataLocator.startLine === 'number'
            ? metadataLocator.startLine
            : undefined;
      const lineEnd =
        typeof metadataLocator.lineEnd === 'number'
          ? metadataLocator.lineEnd
          : typeof metadataLocator.endLine === 'number'
            ? metadataLocator.endLine
            : lineStart;
      const headingPath = Array.isArray(metadataLocator.headingPath)
        ? metadataLocator.headingPath.filter((value): value is string => typeof value === 'string')
        : undefined;
      const paragraphIndex =
        typeof metadataLocator.paragraphIndex === 'number' ? metadataLocator.paragraphIndex : undefined;
      const chunkIndex = typeof metadataLocator.chunkIndex === 'number' ? metadataLocator.chunkIndex : undefined;
      const blockId = typeof metadataLocator.blockId === 'string' ? metadataLocator.blockId : undefined;
      const blockIndex = typeof metadataLocator.blockIndex === 'number' ? metadataLocator.blockIndex : undefined;
      const rects = Array.isArray(metadataLocator.rects) ? (metadataLocator.rects as NonNullable<Citation['locator']>['rects']) : undefined;
      const bbox =
        metadataLocator.bbox && typeof metadataLocator.bbox === 'object'
          ? (metadataLocator.bbox as NonNullable<Citation['locator']>['bbox'])
          : undefined;
      const timestampStart = typeof metadataLocator.timestampStart === 'number' ? metadataLocator.timestampStart : undefined;
      const timestampEnd = typeof metadataLocator.timestampEnd === 'number' ? metadataLocator.timestampEnd : timestampStart;
      return {
        chunkId: item.chunkId,
        fileId: item.fileObjectId,
        fileName: item.fileName,
        content: clip(item.chunkText, 1800),
        score: item.fileObjectId === input.activeFileId ? item.score + 4 : item.score,
        source: 'retrieval' as const,
        retrievalReason: item.retrievalReason,
        matchedTerms: item.matchedTerms,
        scoreBreakdown: item.scoreBreakdown,
        supportSnippets: item.supportSnippets?.map((snippet) => ({
          text: clip(snippet.text, 700),
          locator: snippet.locator as RetrievedChunk['locator'],
          score: snippet.score
        })),
        citationQuality: item.citationQuality,
        locator: {
          page,
          pageStart,
          pageEnd,
          lineStart,
          lineEnd,
          headingPath,
          paragraphIndex,
          chunkIndex,
          blockId,
          blockIndex,
          rects,
          bbox,
          timestampStart,
          timestampEnd
        }
      };
    });

    const timestampChunks = await this.retrieveVideoTimestampChunks({
      workspaceId: input.workspaceId,
      query: input.query,
      fileIds: fileIds || input.videoResourceFileIds,
      activeFileId: input.activeFileId,
      limit: Math.max(3, Math.min(6, input.policy.maxRetrievedChunks))
    });

    if (!timestampChunks.length) return retrieved;
    const byKey = new Map<string, RetrievedChunk>();
    [...timestampChunks, ...retrieved].forEach((chunk) => {
      const key = chunk.chunkId || `${chunk.fileId}:${chunk.locator?.chunkIndex ?? chunk.content.slice(0, 80)}`;
      const existing = byKey.get(key);
      if (!existing || chunk.score > existing.score) byKey.set(key, chunk);
    });
    return Array.from(byKey.values()).sort((left, right) => right.score - left.score);
  }

  private parseTimestampQuery(query: string): number | null {
    const normalized = query.replace(/\s+/g, '');
    const clock = normalized.match(/(?<!\d)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?!\d)/);
    if (clock) {
      const first = Number(clock[1]);
      const second = Number(clock[2]);
      const third = clock[3] ? Number(clock[3]) : undefined;
      return typeof third === 'number' ? first * 3600 + second * 60 + third : first * 60 + second;
    }
    const zhMinuteSecond = normalized.match(/(\d{1,3})分(?:钟)?(?:(\d{1,2})秒)?/);
    if (zhMinuteSecond) return Number(zhMinuteSecond[1]) * 60 + Number(zhMinuteSecond[2] || 0);
    const englishMinute = normalized.match(/(?:at|around|near)?(\d{1,3})(?:min|mins|minute|minutes)\b/i);
    if (englishMinute) return Number(englishMinute[1]) * 60;
    return null;
  }

  private async retrieveVideoTimestampChunks(input: {
    workspaceId: string;
    query: string;
    fileIds: string[];
    activeFileId: string | null;
    limit: number;
  }): Promise<RetrievedChunk[]> {
    const target = this.parseTimestampQuery(input.query);
    if (typeof target !== 'number' || !Number.isFinite(target) || target < 0 || input.fileIds.length === 0) return [];

    const perFile = await Promise.all(
      input.fileIds.map((fileId) =>
        documentChunkStore.listFileChunks({ workspaceId: input.workspaceId, fileObjectId: fileId }).catch(() => [])
      )
    );

    const scored = perFile
      .flat()
      .filter((chunk) =>
        ['video_transcript', 'video_chapter', 'video_key_point', 'video_slide', 'summary'].includes(chunk.chunkType) &&
        typeof chunk.locator.timestampStart === 'number'
      )
      .map((chunk) => {
        const start = Number(chunk.locator.timestampStart);
        const end = Number(chunk.locator.timestampEnd ?? start);
        const distance = target >= start && target <= end ? 0 : Math.min(Math.abs(target - start), Math.abs(target - end));
        const typeBoost =
          chunk.chunkType === 'video_transcript' ? 9 :
            chunk.chunkType === 'video_slide' ? 6 :
              chunk.chunkType === 'video_chapter' ? 5 :
                chunk.chunkType === 'video_key_point' ? 4 : 2;
        return {
          chunk,
          distance,
          score: Math.max(0, 38 - distance / 3) + typeBoost + (chunk.fileObjectId === input.activeFileId ? 4 : 0)
        };
      })
      .filter((item) => item.distance <= 180 || item.score >= 20)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit);

    return scored.map(({ chunk, distance, score }) => ({
      chunkId: chunk.chunkId,
      fileId: chunk.fileObjectId,
      fileName: chunk.fileName || 'Untitled video',
      content: clip(chunk.text, 1800),
      score: Number(score.toFixed(3)),
      source: 'retrieval' as const,
      retrievalReason: distance === 0
        ? `命中用户指定视频时间戳 ${secondsToClock(target)}`
        : `靠近用户指定视频时间戳 ${secondsToClock(target)}，相差约 ${Math.round(distance)} 秒`,
      matchedTerms: [secondsToClock(target)],
      scoreBreakdown: {
        timestamp: Number(Math.max(0, 38 - distance / 3).toFixed(3)),
        typeBoost: Number((score - Math.max(0, 38 - distance / 3)).toFixed(3))
      },
      locator: {
        chunkIndex: chunk.chunkIndex,
        headingPath: chunk.headingPath,
        timestampStart: chunk.locator.timestampStart,
        timestampEnd: chunk.locator.timestampEnd
      },
      supportSnippets: [{
        text: clip(chunk.text, 700),
        locator: chunk.locator,
        score: Number(score.toFixed(3))
      }],
      citationQuality: {
        supportCount: 1,
        sourceCount: 1,
        grounded: true
      }
    }));
  }

  private packRetrievedChunks(chunks: RetrievedChunk[], tokenBudget: number, policy: ContextPolicyDecision) {
    const sorted = [...chunks].sort((left, right) => right.score - left.score);
    const hardMax = tokenBudget < 8000 ? Math.min(4, policy.maxRetrievedChunks) : policy.maxRetrievedChunks;
    const chunkBudget = Math.max(900, Math.floor(tokenBudget * 0.32));
    const packed: RetrievedChunk[] = [];
    let used = 0;

    for (const chunk of sorted) {
      if (packed.length >= hardMax) break;
      const chunkTokens = estimateTokens(chunk.content);
      if (packed.length > 0 && used + chunkTokens > chunkBudget) continue;
      packed.push(chunk);
      used += chunkTokens;
    }

    if (packed.length === 0 && sorted[0]) packed.push(sorted[0]);
    return packed;
  }

  private trimRecentMessages(messages: ChatMessage[], tokenBudget: number) {
    return messages.slice(tokenBudget < 8000 ? -4 : -8);
  }

  private confidenceForChunk(chunk: RetrievedChunk): 'high' | 'medium' | 'low' {
    const rerank = Number(chunk.scoreBreakdown?.rerank || 0);
    const vector = Number(chunk.scoreBreakdown?.vector || 0);
    const lexical = Number(chunk.scoreBreakdown?.lexical || 0);
    if (chunk.source === 'selection' || chunk.source === 'viewport') return 'high';
    if (chunk.score >= 40 || rerank >= 18 || (vector >= 12 && lexical >= 4)) return 'high';
    if (chunk.score >= 18 || rerank >= 8 || vector >= 8 || lexical >= 6) return 'medium';
    return 'low';
  }

  private toCitation(
    fileId: string,
    fileName: string,
    locator?: Citation['locator'],
    details: Partial<Citation> = {}
  ): Citation {
    return {
      fileId,
      fileName,
      locator,
      label: citationLabel(fileName, locator),
      ...details,
      preview: clip(details.preview, 600)
    };
  }

  private dedupeCitations(citations: Citation[]) {
    const seen = new Set<string>();
    return citations.filter((citation) => {
      const key = `${citation.fileId}:${citation.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildSourceMap(citations: Citation[]): SourceInspectorItem[] {
    return citations.map((citation, index) => ({
      sourceId: citation.sourceId || `S${index + 1}`,
      sourceType: citation.sourceType || 'retrieval',
      confidence: citation.confidence || 'medium',
      fileId: citation.fileId,
      fileName: citation.fileName,
      label: citation.label,
      locator: citation.locator,
      score: citation.score,
      retrievalReason: citation.retrievalReason,
      matchedTerms: citation.matchedTerms,
      scoreBreakdown: citation.scoreBreakdown,
      preview: clip(citation.preview, 600),
      supportSnippets: citation.supportSnippets,
      citationQuality: citation.citationQuality,
      includedInPrompt: citation.sourceType !== 'pinned'
    }));
  }

  private buildAttachmentChunks(attachments: ChatSessionAttachmentContext[]): RetrievedChunk[] {
    return attachments.flatMap((attachment, index) => {
        const content = clip(
          [
            `Chat 附件：${attachment.name}`,
            `类型：${attachment.mimeType || attachment.kind}`,
            `大小：${attachment.size || 0} bytes`,
            attachment.textContent ? `内容：\n${attachment.textContent}` : '',
            !attachment.textContent && attachment.kind === 'image'
              ? '这是当前 AI Chat 会话内上传的图片附件。若当前模型支持多模态，系统会将图片载荷随请求提交；否则只能使用附件元数据回答。'
              : '',
            !attachment.textContent && attachment.kind !== 'image'
              ? '该附件当前只有元数据，尚未提取正文。若需要跨 Chat 或深度检索，请保存到 Workbench 后索引。'
              : ''
          ]
            .filter(Boolean)
            .join('\n'),
          14000
        );

        if (!content) return [];

        return [{
          chunkId: `chat-attachment:${attachment.id}`,
          sourceId: `A${index + 1}`,
          fileId: `chat-attachment:${attachment.id}`,
          fileName: attachment.name,
          content,
          score: 95 - index,
          confidence: attachment.textContent || attachment.dataUrl || attachment.base64Data ? 'high' : 'medium',
          source: 'chat_attachment',
          retrievalReason: '当前 AI Chat 会话附件，高优先级显式上下文',
          locator: { blockId: `chat-attachment:${attachment.id}` }
        } satisfies RetrievedChunk];
      });
  }

  private async buildVisualEvidence(workspaceId: string, fileRecords: any[]): Promise<VisualEvidenceItem[]> {
    const items: VisualEvidenceItem[] = [];

    for (const file of fileRecords) {
      const type = fileTypeFromName(file);
      if (type === 'video') {
        const metadata = this.parseChunkMetadata(file.metadataJson);
        const analysis = metadata.videoAnalysis && typeof metadata.videoAnalysis === 'object' ? metadata.videoAnalysis as Record<string, any> : {};
        const slides = Array.isArray(analysis.slides) ? analysis.slides : [];
        for (const [index, slide] of slides.slice(0, 8).entries()) {
          const imageRecord = slide.imageFileId
            ? await prisma.fileSystemObject.findFirst({ where: { workspaceId, id: slide.imageFileId } }).catch(() => null)
            : null;
          items.push({
            id: `${file.id}:slide:${slide.id || index}`,
            kind: 'video_slide',
            fileId: file.id,
            fileName: file.name,
            title: slide.title || `Slide ${index + 1}`,
            locator: {
              timestampStart: slide.timestamp,
              timestampEnd: slide.timestamp
            },
            textDescription: [
              `Video slide at ${secondsToClock(Number(slide.timestamp || 0))}`,
              slide.title ? `Title: ${slide.title}` : '',
              slide.ocrText ? `OCR: ${clipBlock(slide.ocrText, 500)}` : '',
              slide.imageFileId ? 'Rendered slide image available.' : ''
            ].filter(Boolean).join('\n'),
            ocrText: slide.ocrText,
            nearbyText: slide.ocrText ? clipBlock(slide.ocrText, 700) : undefined,
            imageFileId: slide.imageFileId,
            dataUrl: imageRecord ? imageDataUrlFromFile(imageRecord) || undefined : undefined,
            mimeType: 'image/jpeg'
          });
        }
        continue;
      }

      if ((file.mimeType || '').startsWith('image/') || /(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(file.name || ''))) {
        items.push({
          id: `${file.id}:image`,
          kind: 'image_attachment',
          fileId: file.id,
          fileName: file.name,
          title: file.name,
          textDescription: [
            `Image source: ${file.name}`,
            file.path ? `Path: ${file.path}` : '',
            file.tags?.length ? `Tags: ${file.tags.join(', ')}` : ''
          ].filter(Boolean).join('\n'),
          dataUrl: imageDataUrlFromFile(file) || undefined,
          mimeType: file.mimeType || 'image/*'
        });
        continue;
      }

      if (type === 'pdf') {
        try {
          const pages = await documentTextExtractionService.extractPdfPages(file);
          const renderTargets = pages.map((page) => page.page).slice(0, 6);
          const renderedPages = await renderPdfPageDataUrls(file, renderTargets);
          pages.filter((page) => page.text.trim()).slice(0, 6).forEach((page) => {
            items.push({
              id: `${file.id}:pdf:${page.page}`,
              kind: 'pdf_page',
              fileId: file.id,
              fileName: file.name,
              title: `Page ${page.page}`,
              locator: { page: page.page, pageStart: page.page, pageEnd: page.page },
              textDescription: [
                `PDF page ${page.page}`,
                page.text ? `Text: ${clipBlock(page.text, 700)}` : '',
                page.lines?.length ? `Line count: ${page.lines.length}` : ''
              ].filter(Boolean).join('\n'),
              nearbyText: clipBlock(page.text, 700),
              dataUrl: renderedPages.get(page.page) || undefined,
              mimeType: 'image/jpeg'
            });
          });
        } catch {
          // Text-only fallback remains available.
        }
      }
    }

    return items.slice(0, 24);
  }

  private stripAttachmentPayloads(attachments: ChatSessionAttachmentContext[]): ChatSessionAttachmentContext[] {
    return attachments.map((attachment) => ({
      ...attachment,
      dataUrl: undefined,
      base64Data: undefined,
      textContent: attachment.textContent ? clip(attachment.textContent, 1000) : undefined
    }));
  }

  private estimateCapsuleTokens(capsule: ContextCapsule) {
    return estimateTokens(
      [
        capsule.selection?.content,
        capsule.viewport?.content,
        capsule.activeFile?.content,
        capsule.activeFile?.summary,
        ...(capsule.resources || []).map((resource) => resource.summary),
        ...(capsule.chatSessionAttachments || []).map((attachment) =>
          [attachment.textContent, attachment.summary].filter(Boolean).join('\n')
        ),
        ...(capsule.retrievedChunks || []).map((chunk) => chunk.content),
        ...(capsule.visualEvidence || []).map((item) => [item.title, item.textDescription, item.ocrText, item.nearbyText].filter(Boolean).join('\n')),
        capsule.profileSummary?.content,
        ...(capsule.recentMessages || []).map((message) => message.content)
      ].join('\n')
    );
  }

  private estimateTokensByLayer(capsule: ContextCapsule) {
    return {
      selection: estimateTokens(capsule.selection?.content),
      viewport: estimateTokens(capsule.viewport?.content),
      activeFile: estimateTokens([capsule.activeFile?.content, capsule.activeFile?.summary].filter(Boolean).join('\n')),
      resources: estimateTokens((capsule.resources || []).map((resource) => resource.summary).join('\n')),
      chatSessionAttachments: estimateTokens(
        (capsule.chatSessionAttachments || [])
          .map((attachment) => [attachment.textContent, attachment.summary].filter(Boolean).join('\n'))
          .join('\n')
      ),
      retrievedChunks: estimateTokens((capsule.retrievedChunks || []).map((chunk) => chunk.content).join('\n')),
      visualEvidence: estimateTokens((capsule.visualEvidence || []).map((item) => [item.title, item.textDescription, item.ocrText, item.nearbyText].filter(Boolean).join('\n')).join('\n')),
      profileSummary: estimateTokens(capsule.profileSummary?.content),
      recentMessages: estimateTokens((capsule.recentMessages || []).map((message) => message.content).join('\n'))
    };
  }

  private enforceBudget(capsule: ContextCapsule) {
    if (capsule.estimatedTokens <= capsule.tokenBudget) return;
    const clippedItems = capsule.clippedItems || [];
    capsule.recentMessages = (capsule.recentMessages || []).slice(-4);
    clippedItems.push({ layer: 'recentMessages', reason: '超过 token budget，仅保留最近 4 条消息' });
    capsule.resources = (capsule.resources || []).map((resource) => ({
      ...resource,
      summary: resource.isActiveFile ? resource.summary : clip(resource.summary, 180)
    }));
    clippedItems.push({ layer: 'resources', reason: '超过 token budget，资源摘要降级为短摘要' });
    capsule.retrievedChunks = (capsule.retrievedChunks || []).slice(0, capsule.tokenBudget < 8000 ? 3 : 5);
    clippedItems.push({ layer: 'retrievedChunks', reason: '超过 token budget，按排序保留最强检索片段' });
    capsule.visualEvidence = (capsule.visualEvidence || []).slice(0, 10);
    clippedItems.push({ layer: 'visualEvidence', reason: '超过 token budget，裁剪视觉证据数量' });
    if (capsule.viewport?.content && capsule.viewport.content.length > 2400) {
      capsule.viewport.content = clip(capsule.viewport.content, 2400);
      clippedItems.push({ layer: 'viewport', reason: '超过 token budget，裁剪可视范围正文到 2400 字符' });
    }
    if (capsule.activeFile?.content && capsule.activeFile.tokenCount && capsule.activeFile.tokenCount > FULL_TEXT_LIMIT) {
      capsule.activeFile.content = undefined;
      capsule.activeFile.strategy = 'summary_rag';
      clippedItems.push({ layer: 'activeFile', reason: '当前文件超过全文阈值，降级为 summary + RAG' });
    }
    capsule.clippedItems = clippedItems;
    capsule.estimatedTokens = this.estimateCapsuleTokens(capsule);
    capsule.estimatedTokensByLayer = this.estimateTokensByLayer(capsule);

    if (capsule.estimatedTokens > capsule.tokenBudget && capsule.activeFile?.content) {
      capsule.activeFile.content = undefined;
      capsule.activeFile.strategy = 'summary_rag';
      clippedItems.push({ layer: 'activeFile', reason: '二次预算检查仍超限，全文降级为 summary + RAG' });
      capsule.estimatedTokens = this.estimateCapsuleTokens(capsule);
      capsule.estimatedTokensByLayer = this.estimateTokensByLayer(capsule);
    }
  }

  private buildPromptPreview(capsule: ContextCapsule) {
    const selectedResourceFocus = capsule.resources?.length && !capsule.selection && !capsule.viewport && !capsule.activeFile;
    return [
      selectedResourceFocus ? 'AI Studio Source Policy: use the listed Primary Sources as the generation basis. Current open files are ambient workbench state only and must not override selected sources.' : '',
      capsule.selection ? `L0 Selection: ${capsule.selection.fileName}\n${clip(capsule.selection.content, 700)}` : '',
      capsule.viewport ? `L1 Viewport: ${citationLabel(capsule.viewport.fileName, capsule.viewport.locator)}\n${clip(capsule.viewport.content, 700)}` : '',
      capsule.activeFile ? `L3 Active File: ${capsule.activeFile.fileName} (${capsule.activeFile.strategy})\n${clip(capsule.activeFile.content || capsule.activeFile.summary, 700)}` : '',
      capsule.resources?.length ? `${selectedResourceFocus ? 'Primary Sources' : 'L2 Resources'}: ${capsule.resources.map((resource) => resource.fileName).join(', ')}` : '',
      capsule.chatSessionAttachments?.length
        ? `L0.5 Chat Attachments: ${capsule.chatSessionAttachments
            .map((attachment) => `${attachment.name} (${attachment.kind}, ${attachment.mimeType})${attachment.textContent ? `\n${clip(attachment.textContent, 700)}` : ''}`)
            .join('\n\n')}`
        : '',
      capsule.retrievedChunks?.length
        ? `Evidence Cards: ${capsule.retrievedChunks
            .map((chunk) => {
              const sourceId = chunk.sourceId ? `[${chunk.sourceId}] ` : '';
              const reason = chunk.retrievalReason ? ` reason=${chunk.retrievalReason}` : '';
              const confidence = chunk.confidence ? ` confidence=${chunk.confidence}` : '';
              const supports = chunk.supportSnippets?.length
                ? ` supports=${chunk.supportSnippets.map((snippet, index) => `{${index + 1}: ${clip(snippet.text, 240)}}`).join(' ')}`
                : '';
              return `${sourceId}${citationLabel(chunk.fileName, chunk.locator)} score=${chunk.score}${confidence}${reason}\nEvidence: ${clip(chunk.content, 700)}${supports}`;
            })
            .join('\n\n')}\n\nCitation rule: answer only from Evidence Cards. Cite each factual claim with its [S#]. If evidence is insufficient, say so.`
        : '',
      capsule.visualEvidence?.length
        ? `Visual Evidence:\n${capsule.visualEvidence
            .map((item, index) => {
              const header = `[V${index + 1}] ${item.title} (${item.kind})`;
              const locator = item.locator?.page || item.locator?.timestampStart ? ` locator=${JSON.stringify(item.locator)}` : '';
              const imageHint = item.dataUrl ? ' image=attached' : item.imageFileId ? ` imageFileId=${item.imageFileId}` : '';
              return `${header}${locator}${imageHint}\n${clip(item.textDescription || item.nearbyText || item.ocrText, 700)}`;
            })
            .join('\n\n')}\n\nWhen visual evidence exists, ground image-related claims in [V#] items and do not ignore them.`
        : ''
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}

export const workbenchContextService = new WorkbenchContextService();
