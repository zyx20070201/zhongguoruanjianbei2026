import { FileSystemService } from '../fileSystemService';
import { clip } from './utils';

const normalizeWorkspacePath = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean).join('/')}`.replace(/\/+$/, '');
};

const DEFAULT_IGNORE_NAMES = new Set([
  'node_modules',
  '__pycache__',
  'env',
  'venv',
  'target',
  'build',
  'dist',
  'out',
  'bundle',
  'vendor',
  'tmp',
  'temp',
  'deps',
  'Pods'
]);

const shouldIgnoreTreeItem = (item: any) => {
  const name = String(item.name || '').trim();
  if (!name) return false;
  if (DEFAULT_IGNORE_NAMES.has(name)) return true;
  if (name.startsWith('.') && name !== '.github') return true;
  return false;
};

const pathDepth = (value?: string | null) =>
  normalizeWorkspacePath(value).split('/').filter(Boolean).length;

const sortTreeItems = (items: any[]) =>
  [...items].sort((a, b) => {
    const aFolder = a.nodeType === 'folder' ? 0 : 1;
    const bFolder = b.nodeType === 'folder' ? 0 : 1;
    if (aFolder !== bFolder) return aFolder - bFolder;
    return String(a.name || a.path || '').localeCompare(String(b.name || b.path || ''), 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base'
    });
  });

export const bfsWorkspaceTreeRows = (
  tree: any[],
  options: {
    rootFolder?: any | null;
    recursive?: boolean;
    limit?: number;
    ignoreNoise?: boolean;
  } = {}
) => {
  const limit = Math.max(1, Math.min(Number(options.limit || 120), 500));
  const byParent = new Map<string, any[]>();
  const rootParentId = options.rootFolder?.id || null;
  const rootPath = normalizeWorkspacePath(options.rootFolder?.path || '');
  const descendants = options.rootFolder
    ? tree.filter((item) => {
        const itemPath = normalizeWorkspacePath(item.path);
        return item.id !== options.rootFolder.id && itemPath.startsWith(`${rootPath}/`);
      })
    : tree;

  for (const item of descendants) {
    if (options.ignoreNoise && shouldIgnoreTreeItem(item)) continue;
    const parentId = item.parentId || null;
    if (options.rootFolder && !options.recursive && parentId !== rootParentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(item);
  }

  for (const [parentId, children] of byParent) {
    byParent.set(parentId, sortTreeItems(children));
  }

  if (!options.recursive) return (byParent.get(rootParentId) || []).slice(0, limit);

  const rows: any[] = [];
  const queue = [...(byParent.get(rootParentId) || [])];
  while (queue.length && rows.length < limit) {
    const item = queue.shift()!;
    rows.push(item);
    if (item.nodeType === 'folder') {
      queue.push(...(byParent.get(item.id) || []));
    }
  }
  return rows;
};

export const formatWorkspaceTreeRows = (
  rows: any[],
  options: {
    rootPath?: string;
    didHitLimit?: boolean;
    limit?: number;
  } = {}
) => {
  const rootPath = normalizeWorkspacePath(options.rootPath || '');
  const rootDepth = pathDepth(rootPath);
  const lines = rows.map((item) => {
    const itemPath = normalizeWorkspacePath(item.path || item.name || '');
    const depth = Math.max(0, pathDepth(itemPath) - rootDepth - 1);
    const marker = item.nodeType === 'folder' ? '/' : '';
    const size = item.nodeType === 'folder' || !item.size ? '' : ` ${item.size}b`;
    const type = item.nodeType === 'folder' ? 'dir' : String(item.extension || item.mimeType || 'file');
    return `${'  '.repeat(depth)}- ${itemPath || item.name}${marker} [${type}${size}]`;
  });
  if (options.didHitLimit) {
    lines.push(`... [truncated at ${options.limit || rows.length} entries; narrow the path or list recursively with a larger limit if needed]`);
  }
  return lines.join('\n');
};

export const buildWorkspaceTreeOverviewEvidence = async (
  workspaceId: string,
  options: { limit?: number } = {}
) => {
  const limit = Math.max(20, Math.min(Number(options.limit || 160), 500));
  const tree = await FileSystemService.getFileTree(workspaceId, { visibleWorkspaceKnowledgeOnly: true }).catch(() => []);
  const rows = bfsWorkspaceTreeRows(tree, {
    recursive: true,
    limit,
    ignoreNoise: true
  });
  const didHitLimit = rows.length >= limit && tree.length > rows.length;
  const content = formatWorkspaceTreeRows(rows, { rootPath: '/', didHitLimit, limit });
  return {
    id: `env-workspace-tree-${workspaceId}`,
    kind: 'environment' as const,
    title: 'Workspace recursive file tree overview',
    summary: clip(`Recursive BFS overview of ${rows.length}${didHitLimit ? '+' : ''} visible workspace entries. Use exact paths with workspace.file.read; use workspace.fs.list recursive=true to explore more.`, 420),
    content,
    source: '/',
    metadata: {
      source: 'environment_details',
      workspaceId,
      recursive: true,
      traversal: 'breadth_first',
      returnedRows: rows.length,
      totalRows: tree.length,
      didHitLimit
    }
  };
};
