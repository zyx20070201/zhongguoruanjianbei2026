import prisma from '../../config/db';
import type {
  Citation,
  ContextCapsule,
  ContextLocator,
  ContextPolicyDecision,
  ContextResourceType,
  RetrievedChunk,
  ResourceContext,
  SourceInspectorItem
} from '../../types/contextSystem';
import type { StudioContextRef } from '../studio/types';
import type { WorkspaceAgentToolContext } from './toolRegistry';
import type { WorkspaceAgentEvidence, WorkspaceAgentHistoryMessage } from './types';
import { clip, clipPreserveWhitespace, createId, unique } from './utils';

const DEFAULT_STUDIO_CAPSULE_TOKEN_BUDGET = Number(process.env.WORKSPACE_AGENT_STUDIO_CAPSULE_TOKEN_BUDGET || 12000);
const DEFAULT_MAX_CHARS_PER_CHUNK = Number(process.env.WORKSPACE_AGENT_STUDIO_CAPSULE_CHUNK_CHARS || 2200);

const estimateTokens = (value: unknown) => Math.ceil(String(value || '').length / 4);

const confidence = (value: unknown): 'high' | 'medium' | 'low' =>
  value === 'high' || value === 'low' ? value : 'medium';

const locatorFrom = (value: unknown): ContextLocator | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as ContextLocator
    : undefined;

const typeFromFile = (file: {
  name?: string | null;
  extension?: string | null;
  mimeType?: string | null;
  fileCategory?: string | null;
  resourceType?: string | null;
}): ContextResourceType => {
  const extension = String(file.extension || file.name?.split('.').pop() || '').toLowerCase();
  const mimeType = String(file.mimeType || '').toLowerCase();
  const category = String(file.fileCategory || '').toLowerCase();
  const resourceType = String(file.resourceType || '').toLowerCase();
  if (extension === 'pdf' || mimeType.includes('pdf')) return 'pdf';
  if (extension === 'docx' || extension === 'doc' || mimeType.includes('word')) return 'docx';
  if (extension === 'md' || extension === 'markdown' || mimeType.includes('markdown')) return 'markdown';
  if (mimeType.startsWith('video/') || category === 'media') return 'video';
  if (category === 'code') return 'code';
  if (category === 'web' || resourceType === 'web') return 'web';
  if (category === 'generated' || resourceType === 'generated') return 'generated';
  return 'blocksuite';
};

const labelFor = (title: string, locator?: ContextLocator) => {
  if (typeof locator?.page === 'number') return `${title} 第 ${locator.page} 页`;
  if (typeof locator?.pageStart === 'number') {
    const end = typeof locator.pageEnd === 'number' ? locator.pageEnd : locator.pageStart;
    return locator.pageStart === end ? `${title} 第 ${locator.pageStart} 页` : `${title} 第 ${locator.pageStart}-${end} 页`;
  }
  if (typeof locator?.lineStart === 'number' || typeof locator?.startLine === 'number') {
    const start = locator.lineStart || locator.startLine || 1;
    const end = locator.lineEnd || locator.endLine || start;
    return `${title} 行 ${start}-${end}`;
  }
  if (locator?.headingPath?.length) return `${title}，章节：${locator.headingPath.join(' / ')}`;
  if (typeof locator?.chunkIndex === 'number') return `${title} chunk ${locator.chunkIndex}`;
  return title;
};

const sourceMapFromCitations = (citations: Citation[]): SourceInspectorItem[] =>
  citations.map((citation, index) => ({
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

const historyText = (message: WorkspaceAgentHistoryMessage) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .map((block) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_result') return block.content;
          return `${block.name}: ${JSON.stringify(block.input)}`;
        })
        .join('\n');

const evidenceFileId = (item: WorkspaceAgentEvidence) =>
  typeof item.metadata?.fileObjectId === 'string'
    ? item.metadata.fileObjectId
    : typeof item.metadata?.fileId === 'string'
      ? item.metadata.fileId
      : `virtual:evidence:${item.id}`;

const chunkFromEvidence = (item: WorkspaceAgentEvidence, index: number): RetrievedChunk | null => {
  const content = clipPreserveWhitespace(item.content || item.summary, DEFAULT_MAX_CHARS_PER_CHUNK);
  if (!content) return null;
  const fileId = evidenceFileId(item);
  const locator = locatorFrom(item.metadata?.locator);
  return {
    chunkId: typeof item.metadata?.chunkId === 'string' ? item.metadata.chunkId : item.id,
    sourceId: `S${index + 1}`,
    fileId,
    fileName: item.title || fileId,
    content,
    score: typeof item.score === 'number' ? item.score : 0.82,
    confidence: confidence(item.metadata?.confidence),
    source: fileId.startsWith('virtual:') ? 'retrieval' : 'retrieval',
    retrievalReason: `agent_evidence:${item.kind}`,
    locator
  };
};

const citationFromChunk = (chunk: RetrievedChunk): Citation => ({
  sourceId: chunk.sourceId,
  fileId: chunk.fileId,
  fileName: chunk.fileName,
  locator: chunk.locator,
  label: labelFor(chunk.fileName, chunk.locator),
  confidence: chunk.confidence || 'medium',
  sourceType: chunk.source === 'chat_attachment' ? 'chat_attachment' : 'retrieval',
  score: chunk.score,
  retrievalReason: chunk.retrievalReason,
  preview: chunk.content
});

const normalizeRefs = (refs: StudioContextRef[]) =>
  refs
    .map((ref) => ({
      ...ref,
      type: ref.type,
      fileId: String(ref.fileId || '').trim() || undefined,
      evidenceId: String(ref.evidenceId || '').trim() || undefined,
      messageId: String(ref.messageId || '').trim() || undefined,
      turnId: String(ref.turnId || '').trim() || undefined,
      title: String(ref.title || '').trim() || undefined,
      content: String(ref.content || '').trim() || undefined
    }))
    .filter((ref) => ref.type === 'workspace_file' || ref.type === 'evidence' || ref.type === 'conversation' || ref.type === 'inline')
    .slice(0, 24);

const promptPreview = (capsule: ContextCapsule) =>
  [
    'AI Studio Source Policy: use this Agent-built Context Capsule as the generation basis. Do not reconstruct context from UI selected resources.',
    capsule.resources?.length
      ? `Primary Sources: ${capsule.resources.map((resource) => resource.fileName).join(', ')}`
      : '',
    capsule.retrievedChunks?.length
      ? `Evidence Cards: ${capsule.retrievedChunks
          .map((chunk) => {
            const sourceId = chunk.sourceId ? `[${chunk.sourceId}] ` : '';
            return `${sourceId}${labelFor(chunk.fileName, chunk.locator)} score=${chunk.score}\nEvidence: ${clip(chunk.content, 700)}`;
          })
          .join('\n\n')}\n\nCitation rule: ground factual claims in Evidence Cards. If evidence is insufficient, say so.`
      : '',
    capsule.recentMessages?.length
      ? `Recent Conversation:\n${capsule.recentMessages.map((message) => `${message.role}: ${clip(message.content, 500)}`).join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');

export const buildStudioContextFromAgentEvidence = async (input: {
  context: WorkspaceAgentToolContext;
  prompt: string;
  refs: StudioContextRef[];
  sourceMode: 'evidence' | 'model_knowledge';
}): Promise<{ capsule: ContextCapsule; policy: ContextPolicyDecision; contextRefs: StudioContextRef[] }> => {
  const refs = normalizeRefs(input.refs);
  const workspaceFileIds = unique(refs.filter((ref) => ref.type === 'workspace_file').map((ref) => ref.fileId || ''), 12);
  const files = workspaceFileIds.length
    ? await prisma.fileSystemObject.findMany({
        where: {
          workspaceId: input.context.workspaceId,
          id: { in: workspaceFileIds },
          nodeType: 'file'
        }
      })
    : [];
  const fileById = new Map(files.map((file) => [file.id, file] as const));
  const resources: ResourceContext[] = workspaceFileIds.map((fileId) => {
    const file = fileById.get(fileId);
    return {
      fileId,
      fileName: file?.name || refs.find((ref) => ref.fileId === fileId)?.title || fileId,
      filePath: file?.path || undefined,
      type: file ? typeFromFile(file) : 'generated',
      summary: clip(file ? `${file.name}${file.path ? ` (${file.path})` : ''}` : refs.find((ref) => ref.fileId === fileId)?.title || fileId, 300),
      tokenCount: file?.size ? Math.ceil(Number(file.size || 0) / 4) : undefined,
      indexed: false
    };
  });

  const evidenceById = new Map((input.context.evidence || []).map((item) => [item.id, item as WorkspaceAgentEvidence] as const));
  const evidenceRefs = refs.filter((ref) => ref.type === 'evidence' && ref.evidenceId);
  const evidence = evidenceRefs.length
    ? evidenceRefs.map((ref) => evidenceById.get(ref.evidenceId || '')).filter((item): item is WorkspaceAgentEvidence => Boolean(item))
    : (input.context.evidence || []).filter((item: WorkspaceAgentEvidence) => item.content || item.summary).slice(-8);

  const chunks: RetrievedChunk[] = [];
  evidence.forEach((item) => {
    const chunk = chunkFromEvidence(item, chunks.length);
    if (chunk) chunks.push(chunk);
  });

  const history = Array.isArray((input.context as any).agentMessages)
    ? (input.context as any).agentMessages as WorkspaceAgentHistoryMessage[]
    : [];
  for (const ref of refs.filter((item) => item.type === 'conversation')) {
    const matched = history.find((message) =>
      (ref.messageId && message.id === ref.messageId) ||
      (ref.turnId && message.turnId === ref.turnId)
    );
    const content = ref.content || (matched ? historyText(matched) : '');
    if (!content) continue;
    const sourceId = `S${chunks.length + 1}`;
    chunks.push({
      chunkId: ref.messageId || ref.turnId || createId('conv'),
      sourceId,
      fileId: `virtual:conversation:${ref.messageId || ref.turnId || sourceId}`,
      fileName: ref.title || 'Conversation context',
      content: clipPreserveWhitespace(content, DEFAULT_MAX_CHARS_PER_CHUNK),
      score: 0.78,
      confidence: 'medium',
      source: 'retrieval',
      retrievalReason: 'agent_conversation_ref',
      locator: ref.locator
    });
  }

  for (const ref of refs.filter((item) => item.type === 'inline')) {
    if (!ref.content) continue;
    const sourceId = `S${chunks.length + 1}`;
    chunks.push({
      chunkId: createId('inline'),
      sourceId,
      fileId: `virtual:inline:${sourceId}`,
      fileName: ref.title || 'Inline context',
      content: clipPreserveWhitespace(ref.content, DEFAULT_MAX_CHARS_PER_CHUNK),
      score: 0.76,
      confidence: 'medium',
      source: 'retrieval',
      retrievalReason: 'agent_inline_ref',
      locator: ref.locator
    });
  }

  const resourceCitations: Citation[] = resources.map((resource, index) => ({
    sourceId: `R${index + 1}`,
    fileId: resource.fileId,
    fileName: resource.fileName,
    label: resource.fileName,
    sourceType: 'pinned',
    confidence: 'medium',
    preview: resource.summary
  }));
  const citations = [...resourceCitations, ...chunks.map(citationFromChunk)];
  const sourceMap = sourceMapFromCitations(citations);
  const tokenBudget = input.context.contextBudget?.maxTotalEvidenceChars
    ? Math.ceil(input.context.contextBudget.maxTotalEvidenceChars / 4)
    : DEFAULT_STUDIO_CAPSULE_TOKEN_BUDGET;
  const capsule: ContextCapsule = {
    capsuleId: createId('studio-capsule'),
    userId: input.context.userId || 'workspace-agent-v2',
    workspaceId: input.context.workspaceId,
    workbenchId: input.context.workbenchId || undefined,
    mode: input.sourceMode === 'model_knowledge' ? 'model_knowledge' : 'selection_only',
    resources,
    retrievedChunks: chunks,
    recentMessages: history
      .filter((message) => message.metadata?.userVisible !== false && typeof message.content === 'string')
      .slice(-4)
      .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.content) })),
    tokenBudget,
    estimatedTokens: 0,
    estimatedTokensByLayer: {},
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
      preview: source.preview
    })),
    sourceMap,
    buildTrace: [{
      step: 'agent_context_refs.normalize',
      status: 'completed',
      durationMs: 0,
      summary: `refs=${refs.length}, resources=${resources.length}, chunks=${chunks.length}`
    }],
    fallbackReasons: input.sourceMode === 'model_knowledge' ? ['sourceMode=model_knowledge'] : [],
    clippedItems: chunks.some((chunk) => estimateTokens(chunk.content) > Math.ceil(DEFAULT_MAX_CHARS_PER_CHUNK / 4))
      ? [{ layer: 'retrievedChunks', reason: 'Agent evidence was clipped to Studio capsule item budget.' }]
      : [],
    createdAt: new Date().toISOString()
  };
  const textForTokens = [
    ...resources.map((resource) => resource.summary || resource.fileName),
    ...chunks.map((chunk) => chunk.content),
    ...(capsule.recentMessages || []).map((message) => message.content)
  ].join('\n');
  capsule.estimatedTokens = estimateTokens(textForTokens);
  capsule.estimatedTokensByLayer = {
    resources: estimateTokens(resources.map((resource) => resource.summary).join('\n')),
    retrievedChunks: estimateTokens(chunks.map((chunk) => chunk.content).join('\n')),
    recentMessages: estimateTokens((capsule.recentMessages || []).map((message) => message.content).join('\n'))
  };
  capsule.promptContextPreview = promptPreview(capsule);

  const policy: ContextPolicyDecision = {
    includeSelection: false,
    includeViewport: false,
    includeActiveFileFullText: false,
    includeActiveFileSummary: false,
    ragScope: 'none',
    includeResourceSummaries: true,
    maxRetrievedChunks: chunks.length,
    intent: input.sourceMode === 'model_knowledge' ? 'general_qa' : 'cross_resource',
    reasons: ['Workspace Agent V2 supplied an Agent-built Studio Context Capsule.']
  };

  return { capsule, policy, contextRefs: refs };
};
