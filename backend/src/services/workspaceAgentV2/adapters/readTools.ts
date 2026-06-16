import { courseKnowledgeGraphService } from '../../courseKnowledgeGraphService';
import { documentTextExtractionService } from '../../documentTextExtractionService';
import { FileSystemService } from '../../fileSystemService';
import { knowledgeSearchService } from '../../knowledgeSearchService';
import { learnerStateContextAdapter } from '../../learnerStateContextAdapter';
import { resourceDiscoveryService } from '../../resourceDiscoveryService';
import { webSourceExtractionService } from '../../webSourceExtractionService';
import { workspaceFileIndexService } from '../../workspaceFileIndexService';
import { isHiddenFromWorkspaceKnowledge, visibleWorkspaceKnowledgeWhere } from '../../fileObjectVisibility';
import { createId, nowIso, clip, clipPreserveWhitespace } from '../utils';
import { workspaceAgentV2ToolRegistry, type WorkspaceAgentToolContext } from '../toolRegistry';
import type { WorkspaceAgentEvidence, WorkspaceAgentObservation, WorkspaceAgentSourceScope } from '../types';
import type { ChatSessionAttachmentContext } from '../../../types/contextSystem';
import { attachmentKind, chatAttachmentContextFromFile, loadChatAttachmentFiles, readAttachmentText } from '../attachmentContext';
import { bfsWorkspaceTreeRows, formatWorkspaceTreeRows } from '../workspaceTreeOverview';
import prisma from '../../../config/db';

const stringInput = (input: Record<string, unknown>, key: string, fallback = '') =>
  typeof input[key] === 'string' && String(input[key]).trim() ? String(input[key]).trim() : fallback;

const numberInput = (input: Record<string, unknown>, key: string, fallback: number, min: number, max: number) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
};

const stringArrayInput = (input: Record<string, unknown>, key: string, fallback: string[] = []) =>
  Array.isArray(input[key])
    ? (input[key] as unknown[]).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 80)
    : fallback;

const normalizedStringSetInput = (input: Record<string, unknown>, key: string, fallback: string[] = []) =>
  stringArrayInput(input, key, fallback)
    .map((item) => item.toLowerCase().replace(/^\./, '').trim())
    .filter(Boolean);

const booleanInput = (input: Record<string, unknown>, key: string, fallback = false) =>
  typeof input[key] === 'boolean' ? input[key] : typeof input[key] === 'string' ? input[key].toLowerCase() === 'true' : fallback;

const scopeInput = (
  input: Record<string, unknown>,
  allowedScopes: WorkspaceAgentSourceScope[],
  fallback: WorkspaceAgentSourceScope = 'workspace'
): WorkspaceAgentSourceScope => {
  const value = String(input.scope || '').trim();
  return allowedScopes.includes(value as WorkspaceAgentSourceScope) ? value as WorkspaceAgentSourceScope : fallback;
};

const modeInput = (input: Record<string, unknown>) =>
  ['overview', 'targeted_search', 'deep_read'].includes(String(input.mode)) ? input.mode as any : 'targeted_search';

const normalizeWorkspacePath = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean).join('/')}`.replace(/\/+$/, '');
};

const parseJsonObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const evidenceObservation = (
  tool: string,
  summary: string,
  evidence: WorkspaceAgentEvidence[],
  status: WorkspaceAgentObservation['status'] = 'success'
): WorkspaceAgentObservation => ({
  id: createId('obs'),
  tool,
  status,
  summary,
  evidenceIds: evidence.map((item) => item.id),
  at: nowIso()
});

const fileIdsForScope = async (
  context: WorkspaceAgentToolContext,
  input: Record<string, unknown>,
  scope: WorkspaceAgentSourceScope
) => {
  const explicit = stringArrayInput(input, 'fileIds');
  if (scope === 'explicit_sources' || scope === 'chat_attachments') {
    return explicit;
  }

  if (scope === 'workbench') {
    const workbenchId = stringInput(input, 'workbenchId');
    if (!workbenchId) return [];
    const resources = await FileSystemService.listResources(context.workspaceId, {
      workbenchId,
      scope: 'workbench'
    }).catch(() => []);
    return resources.map((resource: any) => String(resource.id || '')).filter(Boolean).slice(0, 120);
  }

  return [];
};

const validateExplicitScope = (scope: WorkspaceAgentSourceScope, fileIds: string[]) => {
  if ((scope === 'explicit_sources' || scope === 'chat_attachments') && !fileIds.length) {
    return `Scope ${scope} requires explicit fileIds.`;
  }
  if (scope === 'workbench' && !fileIds.length) {
    return 'Scope workbench requires explicit workbenchId with readable resources.';
  }
  return '';
};

const skippedObservation = (tool: string, summary: string): {
  observation: WorkspaceAgentObservation;
  evidence: WorkspaceAgentEvidence[];
  raw?: unknown;
} => ({
  observation: {
    id: createId('obs'),
    tool,
    status: 'skipped',
    summary,
    error: summary,
    at: nowIso()
  },
  evidence: []
});

const scopedFileIds = async (
  context: WorkspaceAgentToolContext,
  input: Record<string, unknown>,
  scope: WorkspaceAgentSourceScope
) => {
  const explicit = stringArrayInput(input, 'fileIds');
  if (explicit.length) return explicit;
  if (scope === 'explicit_sources') return (context.contextSources?.selectedResources || []).map((item) => item.id).filter(Boolean);
  if (scope === 'chat_attachments') return (context.contextSources?.chatAttachments || []).map((item) => item.id).filter(Boolean);
  if (scope === 'workbench') return fileIdsForScope(context, input, scope);
  return [];
};

const loadWorkspaceFiles = async (workspaceId: string, fileIds: string[], options: { visibleWorkspaceOnly?: boolean } = {}) => {
  if (!fileIds.length) return [];
  const rows = await prisma.fileSystemObject.findMany({
    where: {
      workspaceId,
      nodeType: 'file',
      id: { in: fileIds },
      ...(options.visibleWorkspaceOnly ? { scope: { not: 'chat' }, ...visibleWorkspaceKnowledgeWhere } : {})
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      path: true,
      content: true,
      storageKey: true,
      isBinary: true,
      extension: true,
      mimeType: true,
      size: true,
      scope: true,
      fileCategory: true,
      resourceType: true,
      ownerWorkbenchId: true,
      origin: true,
      tags: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true
    }
  });
  const filtered = options.visibleWorkspaceOnly ? rows.filter((row) => !isHiddenFromWorkspaceKnowledge(row)) : rows;
  const byId = new Map(filtered.map((row) => [row.id, row]));
  return fileIds.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
};

const resolveWorkspaceFileIdsByPath = async (
  workspaceId: string,
  paths: string[],
  options: { visibleWorkspaceOnly?: boolean } = {}
) => {
  const normalizedPaths = paths.map((path) => normalizeWorkspacePath(path)).filter(Boolean);
  if (!normalizedPaths.length) return [];
  const rows = await prisma.fileSystemObject.findMany({
    where: {
      workspaceId,
      nodeType: 'file',
      path: { in: normalizedPaths },
      ...(options.visibleWorkspaceOnly ? { scope: { not: 'chat' }, ...visibleWorkspaceKnowledgeWhere } : {})
    },
    select: {
      id: true,
      path: true,
      scope: true,
      resourceType: true,
      fileCategory: true,
      origin: true,
      ownerWorkbenchId: true,
      tags: true,
      metadataJson: true
    }
  });
  const byPath = new Map(
    rows
      .filter((row) => !options.visibleWorkspaceOnly || !isHiddenFromWorkspaceKnowledge(row))
      .map((row) => [normalizeWorkspacePath(row.path), row.id])
  );
  return normalizedPaths.map((path) => byPath.get(path)).filter((id): id is string => Boolean(id));
};

const readFileText = async (
  workspaceId: string,
  file: {
    id: string;
    name: string;
    path: string;
    content?: string | null;
    storageKey?: string | null;
    isBinary?: boolean | null;
    extension?: string | null;
    mimeType?: string | null;
  }
) => {
  if (file.content && String(file.content).trim()) return String(file.content);
  try {
    return await FileSystemService.getFileContent(workspaceId, file.id);
  } catch {
    const extracted = await documentTextExtractionService.extract({
      id: file.id,
      name: file.name,
      path: file.path,
      storageKey: file.storageKey || undefined,
      content: file.content || undefined,
      isBinary: Boolean(file.isBinary),
      extension: file.extension || undefined,
      mimeType: file.mimeType || undefined
    } as any);
    return extracted.text || '';
  }
};

const sliceLines = (content: string, startLine?: number, endLine?: number) => {
  const lines = content.split(/\r?\n/);
  if (!startLine && !endLine) return { content, locator: { textLength: content.length } };
  const start = Math.max(1, startLine || 1);
  const end = Math.min(lines.length, Math.max(start, endLine || start + 999));
  return {
    content: lines.slice(start - 1, end).join('\n'),
    locator: { lineStart: start, lineEnd: end, textLength: content.length }
  };
};

const workspaceFileSearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    scope: { type: 'string', enum: ['workspace', 'workbench', 'explicit_sources'] },
    workbenchId: { type: 'string' },
    fileIds: { type: 'array' },
    mode: { type: 'string', enum: ['overview', 'targeted_search', 'deep_read'] },
    limit: { type: 'number', minimum: 1, maximum: 12 }
  },
  required: ['query', 'scope', 'limit'],
  additionalProperties: false
};

const knowledgeSearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    scope: { type: 'string', enum: ['workspace', 'workbench', 'explicit_sources', 'chat_attachments'] },
    workbenchId: { type: 'string' },
    fileIds: { type: 'array' },
    limit: { type: 'number', minimum: 1, maximum: 10 }
  },
  required: ['query', 'scope', 'limit'],
  additionalProperties: false
};

const workspaceFsListSchema = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['workspace', 'workbench', 'explicit_sources', 'chat_attachments'] },
    workbenchId: { type: 'string' },
    fileIds: { type: 'array' },
    folderId: { type: 'string' },
    path: { type: 'string' },
    pathPrefix: { type: 'string' },
    extensions: { type: 'array' },
    nodeTypes: { type: 'array' },
    recursive: { type: 'boolean' },
    limit: { type: 'number', minimum: 1, maximum: 120 }
  },
  required: ['scope', 'limit'],
  additionalProperties: false
};

const workspaceFileReadSchema = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['workspace', 'workbench', 'explicit_sources'] },
    workbenchId: { type: 'string' },
    fileIds: { type: 'array' },
    paths: { type: 'array' },
    path: { type: 'string' },
    startLine: { type: 'number', minimum: 1 },
    endLine: { type: 'number', minimum: 1 },
    maxCharsPerFile: { type: 'number', minimum: 200, maximum: 12000 },
    limit: { type: 'number', minimum: 1, maximum: 12 }
  },
  required: ['scope'],
  additionalProperties: false
};

const webSearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    maxResults: { type: 'number', minimum: 1, maximum: 10 },
    provider: { type: 'string', enum: ['auto', 'exa', 'tavily'] }
  },
  required: ['query'],
  additionalProperties: false
};

const webFetchSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    title: { type: 'string' },
    maxChars: { type: 'number', minimum: 500, maximum: 16000 },
    includeLinks: { type: 'boolean' },
    includeImages: { type: 'boolean' }
  },
  required: ['url'],
  additionalProperties: false
};

const executeKnowledgeSearch = async (
  toolName: string,
  input: Record<string, unknown>,
  context: WorkspaceAgentToolContext
) => {
  const query = stringInput(input, 'query', context.userInput);
  const scope = scopeInput(input, ['workspace', 'workbench', 'explicit_sources', 'chat_attachments']);
  const fileIds = await fileIdsForScope(context, input, scope);
  const scopeError = validateExplicitScope(scope, fileIds);
  if (scopeError) return skippedObservation(toolName, scopeError);
  const results = await knowledgeSearchService.search({
    workspaceId: context.workspaceId,
    query,
    fileIds: fileIds.length ? fileIds : undefined,
    limit: numberInput(input, 'limit', 6, 1, 10),
    includeChatScoped: scope === 'chat_attachments' || Boolean(fileIds.length),
    visibleWorkspaceOnly: scope === 'workspace'
  });
  const evidence: WorkspaceAgentEvidence[] = results.map((item: any, index: number) => ({
    id: createId('ev'),
    kind: 'knowledge_chunk',
    title: item.fileName || item.title || `Knowledge result ${index + 1}`,
    summary: clip(item.summary || item.text || item.content || item.chunkText || '', 360),
        content: clipPreserveWhitespace(item.text || item.content || item.chunkText || item.summary || '', 1400),
    source: item.filePath || item.path || item.source,
    score: typeof item.score === 'number' ? item.score : undefined,
    metadata: {
      fileObjectId: item.fileObjectId,
      chunkId: item.chunkId || item.id,
      pageNumber: item.pageNumber,
      scope,
      fileIds
    }
  }));
  return {
    observation: evidenceObservation(toolName, evidence.length ? `Found ${evidence.length} indexed knowledge chunks in scope=${scope}.` : `No indexed knowledge chunks matched in scope=${scope}.`, evidence),
    evidence,
    raw: results
  };
};

const executeWorkspaceFileSearch = async (
  toolName: string,
  input: Record<string, unknown>,
  context: WorkspaceAgentToolContext
) => {
  const query = stringInput(input, 'query', context.userInput);
  const scope = scopeInput(input, ['workspace', 'workbench', 'explicit_sources']);
  const fileIds = await fileIdsForScope(context, input, scope);
  const scopeError = validateExplicitScope(scope, fileIds);
  if (scopeError) return skippedObservation(toolName, scopeError);
  const limit = numberInput(input, 'limit', 8, 1, 12);
  const result = await workspaceFileIndexService.search({
    workspaceId: context.workspaceId,
    query,
    mode: modeInput(input),
    fileIds: fileIds.length ? fileIds : undefined,
    fileLimit: limit,
    chunkLimit: limit,
    visibleWorkspaceOnly: scope === 'workspace'
  });
  const fileEvidence: WorkspaceAgentEvidence[] = (result.files || []).slice(0, 6).map((file: any) => ({
    id: createId('ev'),
    kind: 'workspace_file',
    title: file.name || file.fileName || file.path || 'Workspace file',
    summary: clip(`${file.path || ''} ${file.summary || ''}`.trim(), 360),
    source: file.path,
    metadata: {
      fileObjectId: file.fileObjectId,
      indexStatus: file.indexStatus,
      chunkCount: file.chunkCount,
      scope,
      fileIds
    }
  }));
  const chunkEvidence: WorkspaceAgentEvidence[] = (result.chunks || []).slice(0, 8).map((chunk: any) => ({
    id: createId('ev'),
    kind: 'workspace_chunk',
    title: chunk.fileName || 'Workspace chunk',
    summary: clip(chunk.summary || chunk.text || chunk.content || chunk.chunkText || '', 360),
    content: clipPreserveWhitespace(chunk.text || chunk.content || chunk.chunkText || chunk.summary || '', 1400),
    source: chunk.filePath || chunk.path || chunk.source,
    score: typeof chunk.score === 'number' ? chunk.score : undefined,
    metadata: {
      fileObjectId: chunk.fileObjectId,
      chunkId: chunk.chunkId || chunk.id,
      scope,
      fileIds
    }
  }));
  const evidence = [...fileEvidence, ...chunkEvidence];
  return {
    observation: evidenceObservation(toolName, `Workspace file search scope=${scope} found ${result.files.length} files and ${result.chunks.length} chunks.`, evidence),
    evidence,
    raw: result
  };
};

const executeWorkspaceFsList = async (
  input: Record<string, unknown>,
  context: WorkspaceAgentToolContext
) => {
  const scope = scopeInput(input, ['workspace', 'workbench', 'explicit_sources', 'chat_attachments']);
  const limit = numberInput(input, 'limit', 40, 1, 120);
  const folderId = stringInput(input, 'folderId');
  const path = normalizeWorkspacePath(stringInput(input, 'path') || stringInput(input, 'pathPrefix'));
  const extensions = normalizedStringSetInput(input, 'extensions');
  const nodeTypes = normalizedStringSetInput(input, 'nodeTypes');
  const recursive = booleanInput(input, 'recursive', false);
  let rows: any[] = [];
  let currentFolder: any = null;
  let breadcrumbs: Array<{ id?: string; name: string; path: string }> = [{ name: '/', path: '/' }];

  if (scope === 'chat_attachments') {
    rows = (context.contextSources?.chatAttachments || []).map((item) => ({
      id: item.id,
      name: item.title || item.id,
      path: item.title || item.id,
      mimeType: item.mimeType,
      size: item.size,
      nodeType: 'file',
      scope: 'chat',
      kind: item.kind || 'chat_attachment'
    }));
  } else if (scope === 'explicit_sources') {
    const ids = await scopedFileIds(context, input, scope);
    if (!ids.length) return skippedObservation('workspace.fs.list', 'Scope explicit_sources requires selected/fileIds sources.');
    rows = await loadWorkspaceFiles(context.workspaceId, ids);
  } else if (scope === 'workbench') {
    const workbenchId = stringInput(input, 'workbenchId', context.workbenchId || context.contextSources?.workbench?.id || '');
    if (!workbenchId) return skippedObservation('workspace.fs.list', 'Scope workbench requires workbenchId.');
    rows = await FileSystemService.listResources(context.workspaceId, {
      workbenchId,
      scope: 'workbench'
    }).catch(() => []);
  } else {
    const tree = await FileSystemService.getFileTree(context.workspaceId, { visibleWorkspaceKnowledgeOnly: true });
    const byId = new Map(tree.map((item: any) => [item.id, item]));

    if (folderId) {
      const folder = byId.get(folderId);
      if (!folder || folder.nodeType !== 'folder') {
        return skippedObservation('workspace.fs.list', `Folder not found: ${folderId}`);
      }
      currentFolder = folder;
    } else if (path) {
      const folder = tree.find((item: any) => item.nodeType === 'folder' && normalizeWorkspacePath(item.path) === path);
      if (!folder) {
        return skippedObservation('workspace.fs.list', `Folder path not found: ${path}`);
      }
      currentFolder = folder;
    }

    if (currentFolder) {
      const chain: any[] = [];
      let cursor = currentFolder;
      while (cursor) {
        chain.unshift(cursor);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
      }
      breadcrumbs = [
        { name: '/', path: '/' },
        ...chain.map((folder) => ({ id: folder.id, name: folder.name, path: folder.path }))
      ];
    }

    rows = bfsWorkspaceTreeRows(tree, {
      rootFolder: currentFolder,
      recursive,
      limit,
      ignoreNoise: recursive
    });
  }

  const totalRows = rows.length;
  const filteredBeforeLimit = rows.filter((item: any) => {
    const extension = String(item.extension || String(item.name || '').split('.').pop() || '').toLowerCase().replace(/^\./, '');
    const mimeType = String(item.mimeType || '').toLowerCase();
    if (extensions.length && !extensions.some((ext) => extension === ext || mimeType.includes(ext))) return false;

    const nodeType = String(item.nodeType || 'file').toLowerCase();
    if (nodeTypes.length && !nodeTypes.includes(nodeType)) return false;

    return true;
  });
  const filtered = filteredBeforeLimit.slice(0, limit);
  const didHitLimit = filteredBeforeLimit.length >= limit;
  const treeText = formatWorkspaceTreeRows(filtered, {
    rootPath: currentFolder?.path || '/',
    didHitLimit,
    limit
  });
  const evidence: WorkspaceAgentEvidence[] = filtered.map((item: any) => {
    const metadata = parseJsonObject(item.metadataJson);
    return {
      id: createId('ev'),
      kind: 'workspace_file_card',
      title: item.name || item.title || item.id,
      summary: clip(`${item.nodeType === 'folder' ? 'folder' : 'file'} ${item.path || item.name || item.title || item.id} ${item.mimeType || ''} ${item.size ? `${item.size} bytes` : ''}`.trim(), 360),
      source: item.path || undefined,
      metadata: {
        fileObjectId: item.id,
        path: item.path,
        nodeType: item.nodeType || 'file',
        scope,
        mimeType: item.mimeType,
        extension: item.extension,
        size: item.size,
        fileCategory: item.fileCategory,
        resourceType: item.resourceType,
        indexStatus: metadata.indexStatus || metadata.workspaceFileCard?.indexStatus
      }
    };
  });

  return {
    observation: evidenceObservation(
      'workspace.fs.list',
      `Listed ${evidence.length} of ${filteredBeforeLimit.length} entries in ${currentFolder?.path || '/'} scope=${scope}${recursive ? ' recursively breadth-first' : ''}${didHitLimit ? `; hit limit ${limit}` : ''}.`,
      evidence
    ),
    evidence,
    raw: {
      scope,
      currentFolder: currentFolder
        ? { id: currentFolder.id, name: currentFolder.name, path: currentFolder.path }
        : { id: null, name: '/', path: '/' },
      breadcrumbs,
      totalRows,
      matchingRows: filteredBeforeLimit.length,
      returnedRows: filtered.length,
      didHitLimit,
      traversal: recursive ? 'breadth_first' : 'direct_children',
      treeText,
      filters: {
        folderId: folderId || undefined,
        path: path || undefined,
        extensions,
        nodeTypes,
        recursive
      },
      folders: filtered.filter((item: any) => item.nodeType === 'folder'),
      files: filtered.filter((item: any) => item.nodeType !== 'folder'),
      rows: filtered
    }
  };
};

const executeWorkspaceFileRead = async (
  input: Record<string, unknown>,
  context: WorkspaceAgentToolContext
) => {
  const scope = scopeInput(input, ['workspace', 'workbench', 'explicit_sources']);
  const limit = numberInput(input, 'limit', 6, 1, 12);
  const pathInputs = [
    ...stringArrayInput(input, 'paths'),
    stringInput(input, 'path')
  ].filter(Boolean);
  const pathFileIds = await resolveWorkspaceFileIdsByPath(context.workspaceId, pathInputs, {
    visibleWorkspaceOnly: scope === 'workspace'
  });
  const fileIds = Array.from(new Set([...stringArrayInput(input, 'fileIds'), ...pathFileIds])).slice(0, limit);
  if (!fileIds.length) return skippedObservation('workspace.file.read', 'workspace.file.read requires explicit fileIds or paths.');
  const maxChars = numberInput(input, 'maxCharsPerFile', 4000, 200, 12000);
  const startLine = input.startLine == null ? undefined : numberInput(input, 'startLine', 1, 1, 1000000);
  const endLine = input.endLine == null ? undefined : numberInput(input, 'endLine', startLine || 1, 1, 1000000);
  const files = await loadWorkspaceFiles(context.workspaceId, fileIds, {
    visibleWorkspaceOnly: scope === 'workspace'
  });
  const evidence: WorkspaceAgentEvidence[] = [];

  for (const file of files) {
    try {
      if (attachmentKind(file) === 'image') {
        evidence.push({
          id: createId('ev'),
          kind: 'workspace_file_image',
          title: file.name,
          summary: 'This workspace file is an image. Use a visual inspection tool when workspace visual inspection is available.',
          source: file.path,
          metadata: { fileObjectId: file.id, scope, mimeType: file.mimeType, path: file.path }
        });
        continue;
      }
      const rawText = await readFileText(context.workspaceId, file);
      const sliced = sliceLines(rawText, startLine, endLine);
      evidence.push({
        id: createId('ev'),
        kind: 'workspace_file_content',
        title: file.name,
        summary: clip(sliced.content, 420),
        content: clipPreserveWhitespace(sliced.content, maxChars),
        source: file.path,
        metadata: {
          fileObjectId: file.id,
          scope,
          path: file.path,
          mimeType: file.mimeType,
          extension: file.extension,
          locator: sliced.locator,
          originalLength: rawText.length
        }
      });
    } catch (error) {
      evidence.push({
        id: createId('ev'),
        kind: 'workspace_file_read_error',
        title: file.name,
        summary: `无法读取文件：${error instanceof Error ? error.message : String(error)}`,
        source: file.path,
        metadata: { fileObjectId: file.id, scope, path: file.path }
      });
    }
  }

  return {
    observation: evidenceObservation('workspace.file.read', `Read ${evidence.length} workspace files in scope=${scope}.`, evidence),
    evidence
  };
};

let registered = false;

export const registerWorkspaceAgentV2ReadTools = () => {
  if (registered) return;
  registered = true;

  workspaceAgentV2ToolRegistry.register({
    name: 'workspace.fs.list',
    title: 'Browse Workspace Folder',
    description: 'Browse the real workspace folder tree. In workspace scope, folderId/path selects the folder to list; recursive=false returns direct children only. source/generated/note/file are metadata, not virtual folders.',
    category: 'read',
    inputSchema: workspaceFsListSchema,
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ scope: 'workspace', path: '/', recursive: false, limit: 40 }],
    execute: async (input, context) => executeWorkspaceFsList(input, context)
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'knowledge.search',
    title: 'Search Indexed Knowledge',
    description: 'Search indexed workspace knowledge chunks for facts, explanations, examples, or evidence relevant to the user goal.',
    category: 'read',
    inputSchema: {
      ...knowledgeSearchSchema
    },
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ query: '数据库事务隔离级别', scope: 'workspace', limit: 6 }],
    execute: async (input, context) => executeKnowledgeSearch('knowledge.search', input, context)
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'workspace.file.search',
    title: 'Search Workspace Files',
    description: 'Search visible workspace files and indexed chunks. Use this when the question refers to materials, documents, current workspace files, or selected files.',
    category: 'read',
    inputSchema: workspaceFileSearchSchema,
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ query: '实验报告要求', scope: 'workspace', mode: 'targeted_search', limit: 8 }],
    execute: async (input, context) => executeWorkspaceFileSearch('workspace.file.search', input, context)
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'workspace.file.read',
    title: 'Read Workspace Files',
    description: 'Read explicit workspace fileIds or paths as text evidence, like Cline read_files. Use after locating files with workspace.fs.list or workspace.file.search. Supports clipped line ranges and document text extraction when available.',
    category: 'read',
    inputSchema: workspaceFileReadSchema,
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ scope: 'workspace', paths: ['/notes/example.md'], maxCharsPerFile: 4000 }],
    execute: async (input, context) => executeWorkspaceFileRead(input, context)
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'workspace.files.search',
    title: 'Search Workspace Files (legacy alias)',
    description: 'Compatibility alias for workspace.file.search. Use workspace.file.search for new calls.',
    category: 'read',
    inputSchema: workspaceFileSearchSchema,
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ query: '实验报告要求', scope: 'workspace', mode: 'targeted_search', limit: 8 }],
    execute: async (input, context) => executeWorkspaceFileSearch('workspace.files.search', input, context)
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'attachment.list',
    title: 'List Chat Attachments',
    description: 'List explicit chat attachments available to the current agent turn. This returns metadata only.',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 24 }
      },
      additionalProperties: false
    },
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    execute: async (input, context) => {
      const limit = numberInput(input, 'limit', 12, 1, 24);
      const attachments = (context.contextSources?.chatAttachments || []).slice(0, limit);
      const evidence: WorkspaceAgentEvidence[] = attachments.map((attachment) => ({
        id: createId('ev'),
        kind: 'attachment_metadata',
        title: attachment.title || attachment.id,
        summary: clip(`${attachment.mimeType || 'attachment'} ${attachment.size || ''}`.trim(), 240),
        metadata: { ...attachment }
      }));
      return {
        observation: evidenceObservation('attachment.list', `Listed ${attachments.length} explicit chat attachments.`, evidence),
        evidence,
        raw: attachments
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'attachment.read',
    title: 'Read Chat Attachments',
    description: 'Read explicit attachment text by fileIds. The model must provide fileIds from ContextSources or prior attachment.list.',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['chat_attachments'] },
        fileIds: { type: 'array' },
        limit: { type: 'number', minimum: 1, maximum: 12 },
        maxCharsPerFile: { type: 'number', minimum: 200, maximum: 6000 }
      },
      required: ['scope', 'fileIds', 'limit'],
      additionalProperties: false
    },
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    execute: async (input, context) => {
      const fileIds = stringArrayInput(input, 'fileIds').slice(0, numberInput(input, 'limit', 6, 1, 12));
      if (!fileIds.length) return skippedObservation('attachment.read', 'attachment.read requires explicit fileIds.');
      const maxChars = numberInput(input, 'maxCharsPerFile', 1800, 200, 6000);
      const files = await loadChatAttachmentFiles(context, fileIds);
      const evidence: WorkspaceAgentEvidence[] = [];
      const filesById = new Map(files.map((file) => [file.id, file]));
      for (const fileId of fileIds) {
        const file = filesById.get(fileId);
        if (!file) {
          evidence.push({
            id: createId('ev'),
            kind: 'chat_attachment_error',
            title: fileId,
            summary: '无法读取附件：该 fileId 不属于当前聊天附件，或附件记录不存在。',
            metadata: { fileObjectId: fileId, scope: 'chat_attachments' }
          });
          continue;
        }
        try {
          if (attachmentKind(file) === 'image') {
            evidence.push({
              id: createId('ev'),
              kind: 'chat_attachment_image',
              title: file.name,
              summary: '该附件是图片。图片内容会作为多模态上下文直接提供给主模型；文本读取工具不生成图片摘要。',
              metadata: { fileObjectId: file.id, scope: 'chat_attachments', mimeType: file.mimeType }
            });
            continue;
          }
          const content = await readAttachmentText(file);
          evidence.push({
            id: createId('ev'),
            kind: 'chat_attachment',
            title: file.name || fileId,
            summary: clip(content, 360),
            content: clipPreserveWhitespace(content, maxChars),
            source: file.path,
            metadata: { fileObjectId: file.id, scope: 'chat_attachments', mimeType: file.mimeType, path: file.path }
          });
        } catch (error) {
          evidence.push({
            id: createId('ev'),
            kind: 'chat_attachment_error',
            title: file.name || fileId,
            summary: `无法读取附件：${error instanceof Error ? error.message : String(error)}`,
            source: file.path,
            metadata: { fileObjectId: file.id, scope: 'chat_attachments', mimeType: file.mimeType, path: file.path }
          });
        }
      }
      return {
        observation: evidenceObservation('attachment.read', `Read ${evidence.length} explicit attachments.`, evidence),
        evidence
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'attachment.image.inspect',
    title: 'Read Attachment Images',
    description: 'Read explicit image attachments as multimodal image evidence. The main agent model receives the image blocks directly; this tool does not pre-summarize images with a second model.',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['chat_attachments'] },
        fileIds: { type: 'array' },
        limit: { type: 'number', minimum: 1, maximum: 8 },
        question: { type: 'string' },
        detail: { type: 'string', enum: ['summary', 'ocr', 'diagram', 'full'] }
      },
      required: ['scope', 'fileIds', 'limit'],
      additionalProperties: false
    },
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    execute: async (input, context) => {
      const requested = new Set(stringArrayInput(input, 'fileIds').slice(0, numberInput(input, 'limit', 6, 1, 12)));
      const files = await loadChatAttachmentFiles(context, Array.from(requested));
      const imageFiles = files.filter((file) => attachmentKind(file) === 'image');
      if (!imageFiles.length) return skippedObservation('attachment.image.inspect', 'No readable image attachments were found for the requested fileIds.');
      const imageContexts: ChatSessionAttachmentContext[] = [];
      for (const file of imageFiles) {
        const attachment = await chatAttachmentContextFromFile(file);
        if (attachment.dataUrl || attachment.base64Data) imageContexts.push(attachment);
      }
      if (!imageContexts.length) return skippedObservation('attachment.image.inspect', 'Image attachments exist, but no image bytes/dataUrl could be loaded for multimodal context.');
      const evidence: WorkspaceAgentEvidence[] = imageFiles.map((file, index) => ({
        id: createId('ev'),
        kind: 'chat_attachment_image',
        title: file.name || `Image attachment ${index + 1}`,
        summary: 'Successfully read image attachment. The image bytes are provided directly to the main multimodal model context.',
        metadata: {
          fileObjectId: file.id,
          scope: 'chat_attachments',
          mimeType: file.mimeType,
          hasImagePayload: imageContexts.some((attachment) => attachment.id === file.id)
        }
      }));
      return {
        observation: evidenceObservation('attachment.image.inspect', `Read ${evidence.length} image attachments as multimodal context.`, evidence),
        evidence,
        raw: imageContexts.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          hasImagePayload: Boolean(attachment.dataUrl || attachment.base64Data)
        }))
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'web.search',
    title: 'Search Web Resources',
    description: 'Search external learning resources and web pages by query using configured Exa or Tavily providers. Use this to discover candidate URLs before fetching specific pages.',
    category: 'read',
    inputSchema: webSearchSchema,
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ query: '数据库事务隔离级别 教程', maxResults: 5, provider: 'auto' }],
    execute: async (input) => {
      const query = stringInput(input, 'query');
      const result = await resourceDiscoveryService.discover({
        query,
        maxResults: numberInput(input, 'maxResults', 6, 1, 10),
        provider: ['exa', 'tavily', 'auto'].includes(String(input.provider)) ? String(input.provider) as any : 'auto'
      });
      const evidence: WorkspaceAgentEvidence[] = result.results.map((item) => ({
        id: createId('ev'),
        kind: 'web_search_result',
        title: item.title,
        summary: clip(item.summary || item.snippet || item.contentPreview || item.url, 520),
        content: clip(item.contentPreview || item.summary || item.snippet || '', 1200),
        source: item.url,
        score: item.score,
        metadata: {
          provider: item.provider,
          url: item.url,
          imageUrl: item.imageUrl,
          thumbnailUrl: item.thumbnailUrl,
          publishedAt: item.publishedAt,
          author: item.author,
          source: item.source
        }
      }));
      return {
        observation: evidenceObservation('web.search', `Found ${evidence.length} web candidates via ${result.provider}.`, evidence),
        evidence,
        raw: result
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'web.fetch',
    title: 'Fetch Web Page',
    description: 'Fetch and extract readable Markdown content from a specific URL. Use after the user gives a URL or after web.search finds a candidate source.',
    category: 'read',
    inputSchema: webFetchSchema,
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ url: 'https://example.com/article', maxChars: 6000 }],
    execute: async (input) => {
      const page = await webSourceExtractionService.extract({
        url: stringInput(input, 'url'),
        title: stringInput(input, 'title') || undefined
      });
      const maxChars = numberInput(input, 'maxChars', 7000, 500, 16000);
      const includeLinks = booleanInput(input, 'includeLinks', true);
      const includeImages = booleanInput(input, 'includeImages', false);
      const content = [
        page.contentMarkdown,
        includeLinks && page.links?.length
          ? `\n\nLinks:\n${page.links.slice(0, 20).map((link) => `- ${link.text}: ${link.href}`).join('\n')}`
          : '',
        includeImages && page.images?.length
          ? `\n\nImages:\n${page.images.slice(0, 20).map((image) => `- ${image.alt || 'image'}: ${image.src}`).join('\n')}`
          : ''
      ].filter(Boolean).join('');
      const evidence: WorkspaceAgentEvidence[] = [{
        id: createId('ev'),
        kind: 'web_page',
        title: page.title,
        summary: clip(page.excerpt || page.contentMarkdown, 520),
        content: clip(content, maxChars),
        source: page.url,
        metadata: {
          url: page.url,
          byline: page.byline,
          siteName: page.siteName,
          linkCount: page.links?.length || 0,
          imageCount: page.images?.length || 0
        }
      }];
      return {
        observation: evidenceObservation('web.fetch', `Fetched web page "${page.title}".`, evidence),
        evidence,
        raw: page
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'course_graph.query',
    title: 'Query Course Knowledge Graph',
    description: 'Read the course knowledge graph to understand concepts, prerequisite relationships, weak areas, and graph structure.',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 10, maximum: 120 }
      },
      required: ['query']
    },
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ query: '索引和查询优化的前置知识', limit: 80 }],
    execute: async (input, context) => {
      const query = stringInput(input, 'query', context.userInput).toLowerCase();
      const graph = await courseKnowledgeGraphService.getGraph({
        workspaceId: context.workspaceId,
        limit: numberInput(input, 'limit', 80, 10, 120)
      });
      const nodes = Array.isArray((graph as any).nodes) ? (graph as any).nodes : [];
      const edges = Array.isArray((graph as any).edges) ? (graph as any).edges : [];
      const rankedNodes = nodes
        .map((node: any) => {
          const haystack = `${node.label || node.name || ''} ${node.summary || node.description || ''}`.toLowerCase();
          const score = query.split(/\s+/).filter(Boolean).reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
          return { node, score };
        })
        .sort((left: any, right: any) => right.score - left.score)
        .slice(0, 10)
        .map((item: any) => item.node);
      const evidence: WorkspaceAgentEvidence[] = rankedNodes.map((node: any) => ({
        id: createId('ev'),
        kind: 'course_graph_concept',
        title: node.label || node.name || node.id || 'Concept',
        summary: clip(node.summary || node.description || node.type || '', 420),
        metadata: { conceptId: node.id, type: node.type, mastery: node.mastery }
      }));
      return {
        observation: evidenceObservation('course_graph.query', `Course graph has ${nodes.length} concepts and ${edges.length} relations; selected ${evidence.length} relevant concepts.`, evidence),
        evidence,
        raw: { nodes: rankedNodes, edgeCount: edges.length, totalNodes: nodes.length }
      };
    }
  });

  workspaceAgentV2ToolRegistry.register({
    name: 'learner_context.read',
    title: 'Read Learner Context',
    description: 'Read learner state, memories, preferences, and learning profile context for personalized responses.',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        audience: { type: 'string', enum: ['general', 'planner', 'tutor', 'diagnosis'] }
      }
    },
    risk: 'low',
    sideEffect: false,
    requiresApproval: false,
    examples: [{ audience: 'tutor' }],
    execute: async (input, context) => {
      const audience = ['general', 'planner', 'tutor', 'diagnosis'].includes(String(input.audience)) ? String(input.audience) as any : 'general';
      const learnerContext = await learnerStateContextAdapter.build({
        workspaceId: context.workspaceId,
        workbenchId: context.workbenchId || null,
        audience
      });
      const evidence: WorkspaceAgentEvidence[] = [{
        id: createId('ev'),
        kind: 'learner_context',
        title: 'Learner context',
        summary: clip((learnerContext as any).summary || JSON.stringify(learnerContext), 700),
        content: clip(JSON.stringify(learnerContext, null, 2), 1800),
        metadata: { audience }
      }];
      return {
        observation: evidenceObservation('learner_context.read', 'Read learner context for personalization.', evidence),
        evidence,
        raw: learnerContext
      };
    }
  });
};
