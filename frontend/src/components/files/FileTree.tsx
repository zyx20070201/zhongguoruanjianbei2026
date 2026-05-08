import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, NodeApi, TreeApi } from 'react-arborist';
import { useDragDropManager } from 'react-dnd';
import { ChevronRight, FolderTree, Tag, Undo2 } from 'lucide-react';
import { FileSystemObject } from '../../types';
import { useFileTreeStore } from '../../store/fileTreeStore';
import { useFileCommands } from '../../hooks/useFileCommands';
import { FileTreeNode } from './FileTreeNode';
import { FileContextMenu } from './FileContextMenu';
import { fileSystemApi } from '../../services/fileSystemApi';

type ExplorerView = 'path' | 'tags';

type FileTreeNodeData = FileSystemObject & {
  syntheticKind?: 'tag-group';
  syntheticLabel?: string;
  children?: FileTreeNodeData[];
};

interface FileTreeProps {
  workspaceId: string;
  onFileSelect?: (file: FileSystemObject) => void;
  onFileDoubleClick?: (file: FileSystemObject) => void;
  collapseSignal?: number;
  enableWorkbenchDrag?: boolean;
  dndManager?: ReturnType<typeof useDragDropManager>;
  initialPath?: string;
  currentPath?: string;
  filesOverride?: FileSystemObject[];
  loadingOverride?: boolean;
  errorOverride?: string | null;
  filterQuery?: string;
  compactHeader?: boolean;
  transparentBackground?: boolean;
  onCurrentPathChange?: (path: string) => void;
  fileFilterMode?: 'all' | 'source' | 'workspace' | 'generated';
  autoHeight?: boolean;
}

const isSourceFile = (file: FileSystemObject) => {
  const resourceType = (file.resourceType || '').toLowerCase();
  if (resourceType === 'source' || resourceType === 'resource') return true;
  const category = (file.fileCategory || '').toLowerCase();
  const extension = (file.extension || '').toLowerCase().replace(/^\./, '');
  return extension === 'source' || category.includes('web') || category.includes('text-source');
};

const isGeneratedFile = (file: FileSystemObject) => {
  const resourceType = (file.resourceType || '').toLowerCase();
  if (resourceType === 'generated') return true;
  const category = (file.fileCategory || '').toLowerCase();
  return category.includes('generated');
};

const isWorkspaceFile = (file: FileSystemObject) => {
  if (file.nodeType !== 'file') return false;
  const resourceType = (file.resourceType || '').toLowerCase();
  if (resourceType === 'note' || resourceType === 'file') return true;
  if (isSourceFile(file) || isGeneratedFile(file)) return false;
  return true;
};

const applyFileFilter = (
  files: FileSystemObject[],
  fileFilterMode: FileTreeProps['fileFilterMode']
) => {
  if (fileFilterMode === 'all') return files;

  const visibleIds = new Set<string>();
  const includeNode = (file: FileSystemObject) => {
    if (file.nodeType === 'folder') return false;
    if (fileFilterMode === 'source') return isSourceFile(file);
    if (fileFilterMode === 'generated') return isGeneratedFile(file);
    return isWorkspaceFile(file);
  };

  files.forEach((file) => {
    if (!includeNode(file)) return;
    visibleIds.add(file.id);
    let parentId = file.parentId;
    while (parentId) {
      visibleIds.add(parentId);
      const parent = files.find((candidate) => candidate.id === parentId);
      parentId = parent?.parentId;
    }
  });

  return files.filter((file) => visibleIds.has(file.id));
};

const getEmptyStateCopy = (
  fileFilterMode: FileTreeProps['fileFilterMode'],
  explorerView: ExplorerView,
  hasFilterQuery: boolean
) => {
  if (hasFilterQuery) {
    return 'No resources match this filter.';
  }

  if (explorerView === 'tags') {
    if (fileFilterMode === 'source') return 'No tagged sources in this scope yet.';
    if (fileFilterMode === 'generated') return 'No tagged generated outputs yet.';
    if (fileFilterMode === 'workspace') return 'No tagged workspace files in this scope yet.';
    return 'No tagged files in this scope yet.';
  }

  if (fileFilterMode === 'source') return 'No sources yet. Add files, links, or pasted text.';
  if (fileFilterMode === 'generated') return 'No generated outputs yet.';
  if (fileFilterMode === 'workspace') return 'No workspace files yet. Create a note or file to begin.';
  return 'No files in this folder yet.';
};

const getEmptyStateAction = (fileFilterMode: FileTreeProps['fileFilterMode']) => {
  if (fileFilterMode === 'workspace') {
    return 'Create a folder to start';
  }

  return null;
};

const normalizePath = (value?: string) => {
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
};

const getParentPath = (path: string) => {
  if (path === '/') return null;
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '/';
  return normalized.slice(0, index);
};

const buildPathTree = (files: FileSystemObject[], currentPath: string): FileTreeNodeData[] => {
  const currentFolder =
    currentPath === '/'
      ? null
      : files.find((file) => file.nodeType === 'folder' && file.path === currentPath) || null;

  const visibleItems = files.filter((file) => {
    if (currentPath === '/') return true;
    return file.path.startsWith(`${currentPath}/`);
  });

  const nodeMap = new Map<string, FileTreeNodeData>();
  visibleItems.forEach((item) => {
    nodeMap.set(item.id, { ...item, children: [] });
  });

  const roots: FileTreeNodeData[] = [];
  visibleItems.forEach((item) => {
    const parent = item.parentId ? nodeMap.get(item.parentId) : undefined;
    if (parent) {
      parent.children!.push(nodeMap.get(item.id)!);
      return;
    }

    if (currentFolder) {
      if (item.parentId === currentFolder.id) {
        roots.push(nodeMap.get(item.id)!);
      }
      return;
    }

    if (!item.parentId) {
      roots.push(nodeMap.get(item.id)!);
    }
  });

  const sortNodes = (nodes: FileTreeNodeData[]) => {
    nodes.sort((a, b) => {
      if (a.nodeType === 'folder' && b.nodeType !== 'folder') return -1;
      if (a.nodeType !== 'folder' && b.nodeType === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children || []));
  };

  sortNodes(roots);
  return roots;
};

const buildTagTree = (files: FileSystemObject[], currentPath: string): FileTreeNodeData[] => {
  const scopedFiles = files.filter((file) => {
    if (file.nodeType !== 'file') return false;
    if (currentPath === '/') return true;
    return file.path.startsWith(`${currentPath}/`);
  });

  const groups = new Map<string, FileSystemObject[]>();
  scopedFiles.forEach((file) => {
    const tags = file.tags?.length ? file.tags : ['Untagged'];
    tags.forEach((tag) => {
      const key = tag.trim() || 'Untagged';
      groups.set(key, [...(groups.get(key) || []), file]);
    });
  });

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, items]) => ({
      id: `tag:${tag}`,
      name: tag,
      nodeType: 'folder',
      path: `#tag/${tag}`,
      createdAt: '',
      updatedAt: '',
      workspaceId: scopedFiles[0]?.workspaceId || '',
      syntheticKind: 'tag-group',
      syntheticLabel: tag,
      children: items
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({ ...item, children: [] }))
    }));
};

const filterTreeNodes = (nodes: FileTreeNodeData[], query: string): FileTreeNodeData[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return nodes;

  return nodes.reduce<FileTreeNodeData[]>((matches, node) => {
    const childMatches = filterTreeNodes(node.children || [], normalizedQuery);
    const isMatch =
      node.name.toLowerCase().includes(normalizedQuery) ||
      node.path.toLowerCase().includes(normalizedQuery) ||
      (node.tags || []).some((tag) => tag.toLowerCase().includes(normalizedQuery));

    if (isMatch || childMatches.length > 0) {
      matches.push({
        ...node,
        children: childMatches.length > 0 ? childMatches : node.children
      });
    }

    return matches;
  }, []);
};

const countTreeNodes = (nodes: FileTreeNodeData[]): number =>
  nodes.reduce((total, node) => total + 1 + countTreeNodes(node.children || []), 0);

export const FileTreeComponent: React.FC<FileTreeProps> = ({
  workspaceId,
  onFileSelect,
  onFileDoubleClick,
  collapseSignal,
  enableWorkbenchDrag = false,
  dndManager,
  initialPath,
  currentPath: controlledCurrentPath,
  filesOverride,
  loadingOverride,
  errorOverride,
  filterQuery = '',
  compactHeader = false,
  transparentBackground = false,
  onCurrentPathChange,
  fileFilterMode = 'all',
  autoHeight = false
}) => {
  const {
    files,
    loading,
    error,
    selectedNodeId,
    revealNodeId,
    expandedNodeIds,
    setSelectedNodeId,
    setRevealNodeId,
    toggleExpanded,
    setExpanded,
    clearExpanded
  } = useFileTreeStore();
  const commands = useFileCommands(workspaceId);
  const visibleFiles = filesOverride ?? files;
  const visibleLoading = loadingOverride ?? loading;
  const visibleError = errorOverride ?? error;
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<TreeApi<FileTreeNodeData> | undefined>(undefined);

  const [explorerView, setExplorerView] = useState<ExplorerView>('path');
  const [internalCurrentPath, setInternalCurrentPath] = useState(() => normalizePath(initialPath));
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: NodeApi<FileTreeNodeData>;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 250, height: 500 });

  const currentPath = normalizePath(controlledCurrentPath ?? internalCurrentPath);
  const setCurrentPath = (path: string) => {
    const nextPath = normalizePath(path);
    if (controlledCurrentPath === undefined) {
      setInternalCurrentPath(nextPath);
    }
    onCurrentPathChange?.(nextPath);
  };

  useEffect(() => {
    if (controlledCurrentPath === undefined) {
      setInternalCurrentPath(normalizePath(initialPath));
    }
  }, [controlledCurrentPath, initialPath]);

  useEffect(() => {
    if (currentPath === '/') return;
    const exists = visibleFiles.some((file) => file.nodeType === 'folder' && file.path === currentPath);
    if (!exists) {
      setCurrentPath('/');
    }
  }, [currentPath, visibleFiles]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (collapseSignal !== undefined) {
      treeRef.current?.closeAll();
      clearExpanded();
    }
  }, [clearExpanded, collapseSignal]);

  const scopedFiles = useMemo(
    () => applyFileFilter(visibleFiles, fileFilterMode),
    [fileFilterMode, visibleFiles]
  );

  useEffect(() => {
    if (!selectedNodeId) return;
    const existsInScope = scopedFiles.some((file) => file.id === selectedNodeId);
    if (!existsInScope) {
      setSelectedNodeId(null);
    }
  }, [scopedFiles, selectedNodeId, setSelectedNodeId]);

  useEffect(() => {
    if (!revealNodeId) return;
    const target = scopedFiles.find((file) => file.id === revealNodeId);
    if (!target) return;

    let parentId = target.parentId;
    while (parentId) {
      setExpanded(parentId, true);
      const parent = scopedFiles.find((file) => file.id === parentId);
      parentId = parent?.parentId;
    }

    setSelectedNodeId(revealNodeId);

    const frame = window.requestAnimationFrame(() => {
      treeRef.current?.select(revealNodeId, { align: 'smart', focus: false });
      setRevealNodeId(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [revealNodeId, scopedFiles, setExpanded, setRevealNodeId, setSelectedNodeId]);

  const currentFolder =
    currentPath === '/'
      ? null
      : scopedFiles.find((file) => file.nodeType === 'folder' && file.path === currentPath) || null;

  const breadcrumbPaths = useMemo(() => {
    const segments = currentPath === '/' ? [] : currentPath.replace(/^\/+/, '').split('/');
    return segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join('/')}`
    }));
  }, [currentPath]);

  const treeData = useMemo(() => {
    const data = explorerView === 'path' ? buildPathTree(scopedFiles, currentPath) : buildTagTree(scopedFiles, currentPath);
    return filterTreeNodes(data, filterQuery);
  }, [currentPath, explorerView, scopedFiles, filterQuery]);
  const treeHeight = autoHeight
    ? Math.max(30, countTreeNodes(treeData) * 30)
    : Math.max(0, dimensions.height - (compactHeader ? 0 : 62));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      Object.entries(expandedNodeIds).forEach(([id, isExpanded]) => {
        const node = treeRef.current?.get(id);
        if (!node) return;
        if (isExpanded) {
          node.open();
        } else {
          node.close();
        }
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [expandedNodeIds, treeData]);

  const canDropOnParent = (
    parentNode: NodeApi<FileTreeNodeData> | null,
    dragNodes: NodeApi<FileTreeNodeData>[]
  ) => {
    if (explorerView === 'tags') return false;
    if (!parentNode) return true;
    if (parentNode.data.syntheticKind) return false;
    if (parentNode.data.nodeType !== 'folder') return false;

    return dragNodes.every((dragNode) => {
      if (dragNode.data.syntheticKind) return false;
      if (dragNode.id === parentNode.id) return false;
      if (dragNode.data.nodeType === 'folder' && dragNode.isAncestorOf(parentNode)) return false;
      return true;
    });
  };

  const handleMove = async ({ dragIds, parentId }: any) => {
    if (explorerView === 'tags' || dragIds.length === 0) return;
    try {
      await commands.moveNode(dragIds[0], parentId);
    } catch (moveError: any) {
      alert(moveError?.response?.data?.error || moveError?.message || 'Failed to move file');
    }
  };

  const handleRename = async ({ id, name }: any) => {
    if (explorerView === 'tags') return;
    try {
      await commands.renameNode(id, name);
    } catch (renameError: any) {
      alert(renameError?.response?.data?.error || renameError?.message || 'Failed to rename file');
    }
  };

  const onContextMenu = (e: React.MouseEvent, node: NodeApi<FileTreeNodeData>) => {
    if (node.data.syntheticKind) return;
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const getDefaultTarget = () => ({
    parentId: currentFolder?.id,
    parentPath: currentFolder?.path
  });

  const handleCreateFile = async (parentId?: string, parentPath?: string) => {
    const name = prompt('Enter file name (e.g., new-file.md):');
    if (!name) return;

    try {
      const target = parentId || parentPath ? { parentId, parentPath } : getDefaultTarget();
      await commands.createFile(name, target.parentId || undefined, target.parentPath || undefined);
    } catch (createError: any) {
      alert(createError?.response?.data?.error || createError?.message || 'Failed to create file');
    }
  };

  const handleCreateNote = async (parentId?: string, parentPath?: string) => {
    const name = prompt('Enter note name (e.g., meeting-notes.md):', 'untitled-note.md');
    if (!name) return;

    try {
      const target = parentId || parentPath ? { parentId, parentPath } : getDefaultTarget();
      const normalizedName = /\.[^./]+$/.test(name) ? name : `${name}.md`;
      await commands.createFile(normalizedName, target.parentId || undefined, target.parentPath || undefined);
    } catch (createError: any) {
      alert(createError?.response?.data?.error || createError?.message || 'Failed to create note');
    }
  };

  const handleCreateFolder = async (parentId?: string, parentPath?: string) => {
    const name = prompt('Enter folder name:');
    if (!name) return;

    try {
      const target = parentId || parentPath ? { parentId, parentPath } : getDefaultTarget();
      await commands.createFolder(name, target.parentId || undefined, target.parentPath || undefined);
    } catch (createError: any) {
      alert(createError?.response?.data?.error || createError?.message || 'Failed to create folder');
    }
  };

  const handleUpload = async (parentId?: string, parentPath?: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const uploadFiles = Array.from(e.target.files as FileList);
      if (uploadFiles.length === 0) return;

      try {
        const target = parentId || parentPath ? { parentId, parentPath } : getDefaultTarget();
        await commands.uploadFiles(
          uploadFiles,
          target.parentId || undefined,
          target.parentPath || undefined
        );
      } catch (uploadError: any) {
        alert(uploadError?.response?.data?.error || uploadError?.message || 'Failed to upload files');
      }
    };
    input.click();
  };

  const handleMoveTo = async (id: string) => {
    const targetPath = prompt('Move to folder path (use / for root):', '/');
    if (targetPath == null) return;

    const normalizedTargetPath = normalizePath(targetPath);
    const targetParent =
      normalizedTargetPath === '/'
        ? null
        : visibleFiles.find((file) => file.nodeType === 'folder' && file.path === normalizedTargetPath);

    if (normalizedTargetPath !== '/' && !targetParent) {
      alert(`Folder not found: ${normalizedTargetPath}`);
      return;
    }

    try {
      await commands.moveNode(id, targetParent?.id || undefined);
    } catch (moveError: any) {
      alert(moveError?.response?.data?.error || moveError?.message || 'Failed to move file');
    }
  };

  if (visibleLoading && visibleFiles.length === 0) {
    return <div className="p-4 text-sm text-[var(--wb-text-muted)]">Loading files...</div>;
  }

  if (visibleError) {
    return <div className="p-4 text-sm text-red-300">{visibleError}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full flex-1 flex-col overflow-hidden ${
        transparentBackground ? 'bg-transparent' : 'bg-white'
      }`}
    >
      {!compactHeader && (
      <div className="border-b border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-2 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto text-xs text-[var(--wb-text-muted)]">
            <button
              onClick={() => setCurrentPath('/')}
              className={`rounded px-1.5 py-0.5 hover:bg-white/5 ${
                currentPath === '/' ? 'text-[var(--wb-text)]' : ''
              }`}
            >
              Workspace
            </button>
            {breadcrumbPaths.map((segment) => (
              <React.Fragment key={segment.path}>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                <button
                  onClick={() => setCurrentPath(segment.path)}
                  className={`rounded px-1.5 py-0.5 hover:bg-white/5 ${
                    currentPath === segment.path ? 'text-[var(--wb-text)]' : ''
                  }`}
                >
                  {segment.label}
                </button>
              </React.Fragment>
            ))}
          </div>
          <button
            onClick={() => {
              const parent = getParentPath(currentPath);
              if (parent) setCurrentPath(parent);
            }}
            disabled={currentPath === '/'}
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)] disabled:opacity-40"
            title="Go to parent folder"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Up
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setExplorerView('path')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              explorerView === 'path'
                ? 'bg-[var(--wb-accent-soft)] text-[var(--wb-text)]'
                : 'text-[var(--wb-text-muted)] hover:bg-white/5'
            }`}
          >
            <FolderTree className="h-3.5 w-3.5" />
            Path
          </button>
          <button
            onClick={() => setExplorerView('tags')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              explorerView === 'tags'
                ? 'bg-[var(--wb-accent-soft)] text-[var(--wb-text)]'
                : 'text-[var(--wb-text-muted)] hover:bg-white/5'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            Tags
          </button>
        </div>
      </div>
      )}

      {treeData.length === 0 ? (
        <div className="flex flex-col gap-2 p-4 text-sm text-[var(--wb-text-muted)]">
          <p>{getEmptyStateCopy(fileFilterMode, explorerView, Boolean(filterQuery.trim()))}</p>
          {explorerView === 'path' &&
            !filterQuery.trim() &&
            getEmptyStateAction(fileFilterMode) && (
            <button
              onClick={() => void handleCreateFolder()}
              className="text-left text-[var(--wb-accent)] hover:underline"
            >
              {getEmptyStateAction(fileFilterMode)}
            </button>
          )}
        </div>
      ) : (
        <Tree
          ref={treeRef}
          data={treeData}
          width={dimensions.width}
          height={treeHeight}
          rowHeight={30}
          indent={compactHeader ? 12 : 18}
          initialOpenState={expandedNodeIds}
          openByDefault={false}
          onMove={handleMove}
          onRename={handleRename}
          disableDrag={(node: any) =>
            explorerView === 'tags' || Boolean(node?.data?.syntheticKind ?? node?.syntheticKind)
          }
          disableDrop={({ parentNode, dragNodes }) => !canDropOnParent(parentNode, dragNodes)}
          dndRootElement={containerRef.current}
          dndManager={enableWorkbenchDrag && explorerView === 'path' ? dndManager : undefined}
          className="h-full bg-transparent"
          onSelect={(nodes) => {
            if (nodes.length === 0) {
              setSelectedNodeId(null);
              return;
            }

            const node = nodes[0];
            if (node.data.syntheticKind) {
              setSelectedNodeId(null);
              return;
            }

            setSelectedNodeId(node.id);
            if (node.data.nodeType === 'file') {
              onFileSelect?.(node.data);
            }
          }}
          onToggle={(id) => toggleExpanded(id)}
        >
          {(props) => (
            <FileTreeNode
              {...props}
              onContextMenu={onContextMenu}
              onDoubleClick={(node: any) => {
                if (node.data.syntheticKind) return;
                if (node.data.nodeType === 'folder' && explorerView === 'path') {
                  setCurrentPath(node.data.path);
                  return;
                }
                if (node.data.nodeType === 'file') {
                  onFileDoubleClick?.(node.data);
                }
              }}
              enableWorkbenchDrag={enableWorkbenchDrag}
            />
          )}
        </Tree>
      )}

      {contextMenu && !contextMenu.node.data.syntheticKind && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onRename={(id) => treeRef.current?.get(id)?.edit()}
          onDelete={async (id) => {
            if (confirm('Delete this item?')) {
              await commands.deleteNode(id);
            }
          }}
          onCopy={(id, targetParentId) => commands.copyNode(id, targetParentId)}
          onMove={handleMoveTo}
          onDownload={(id) => {
            window.open(fileSystemApi.downloadUrl(workspaceId, id), '_blank');
          }}
          onCreateFile={(parentId, parentPath) => void handleCreateFile(parentId, parentPath)}
          onCreateNote={(parentId, parentPath) => void handleCreateNote(parentId, parentPath)}
          onCreateFolder={(parentId, parentPath) => void handleCreateFolder(parentId, parentPath)}
          onUpload={(parentId, parentPath) => void handleUpload(parentId, parentPath)}
        />
      )}
    </div>
  );
};
