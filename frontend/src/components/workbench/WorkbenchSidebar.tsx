import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileSearch,
  FileText,
  FolderOpen,
  House,
  PanelLeftClose,
  Save,
  Search,
  Sparkles,
  Undo2,
  X
} from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from 'react';
import { useDragDropManager } from 'react-dnd';
import { EditorState, FileSystemObject, ResourceReference } from '../../types';
import { FileSystemSidebar } from '../workspace/FileSystemSidebar';

type SidebarView = 'files' | 'search' | 'ai';

interface WorkbenchSidebarProps {
  workspaceId: string;
  workbenchRootPath?: string;
  editors: EditorState[];
  activeEditorId: string | null;
  activeView: SidebarView;
  resources: ResourceReference[];
  documentStateByResourceId: Record<string, { content: string; savedContent: string; loading?: boolean }>;
  onActivateEditor: (editorId: string) => void;
  onActiveViewChange: (view: SidebarView) => void;
  onCloseEditor: (editorId: string) => void;
  onFileOpen: (file: FileSystemObject) => void;
  onSave: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  dndManager: ReturnType<typeof useDragDropManager>;
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onCreateAiPanel: () => void;
}

type SearchTreeNode = {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  resource?: ResourceReference;
  children: SearchTreeNode[];
};

const sidebarViews: Array<{
  id: SidebarView;
  label: string;
  icon: typeof FolderOpen;
}> = [
  { id: 'files', label: 'Explorer', icon: FolderOpen },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'ai', label: 'AI', icon: Bot }
];

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

const getEditorIcon = (type: EditorState['type']) => {
  switch (type) {
    case 'resource':
      return <FolderOpen className="h-4 w-4" />;
    case 'notes':
      return <FileText className="h-4 w-4" />;
    case 'code':
      return <FileCode2 className="h-4 w-4" />;
    case 'video':
      return <FileSearch className="h-4 w-4" />;
    case 'external':
      return <FileSearch className="h-4 w-4" />;
    case 'ai':
      return <Sparkles className="h-4 w-4" />;
  }
};

const getEditorDescription = (editor: EditorState, resources: ResourceReference[]) => {
  if (editor.type === 'external') {
    return editor.viewState?.externalResource?.url || 'External reference';
  }

  if (editor.type === 'ai') {
    return 'Workbench conversation';
  }

  const resource = resources.find((item) => item.id === editor.resourceId);
  return resource ? resource.path : editor.type;
};

const toFileSystemObject = (workspaceId: string, resource: ResourceReference): FileSystemObject => ({
  id: resource.id,
  name: resource.name,
  path: resource.path,
  nodeType: 'file',
  createdAt: '',
  updatedAt: '',
  workspaceId,
  parentId: undefined,
  extension: resource.extension,
  mimeType: resource.mimeType,
  fileCategory: resource.fileCategory,
  isBinary: resource.isBinary,
  tags: resource.tags
});

export default function WorkbenchSidebar({
  workspaceId,
  workbenchRootPath,
  editors,
  activeEditorId,
  activeView,
  resources,
  documentStateByResourceId,
  onActivateEditor,
  onActiveViewChange,
  onCloseEditor,
  onFileOpen,
  onSave,
  saveStatus,
  dndManager,
  width,
  onResizeStart,
  onCreateAiPanel
}: WorkbenchSidebarProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isOpenEditorsCollapsed, setIsOpenEditorsCollapsed] = useState(false);
  const [openEditorsHeight, setOpenEditorsHeight] = useState(220);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTreeExpanded, setSearchTreeExpanded] = useState<Record<string, boolean>>({});
  const [searchScopePath, setSearchScopePath] = useState(() => normalizePath(workbenchRootPath));

  const normalizedWorkbenchRootPath = normalizePath(workbenchRootPath);

  useEffect(() => {
    setSearchScopePath(normalizedWorkbenchRootPath);
  }, [normalizedWorkbenchRootPath]);

  const saveLabel = useMemo(() => {
    switch (saveStatus) {
      case 'saving':
        return 'Saving';
      case 'error':
        return 'Retry Save';
      default:
        return 'Save';
    }
  }, [saveStatus]);

  const aiEditors = useMemo(() => editors.filter((editor) => editor.type === 'ai'), [editors]);

  const searchBreadcrumbPaths = useMemo(() => {
    const segments = searchScopePath === '/' ? [] : searchScopePath.replace(/^\/+/, '').split('/');
    return segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join('/')}`
    }));
  }, [searchScopePath]);

  const scopedResources = useMemo(() => {
    return resources.filter((resource) => {
      if (searchScopePath === '/') return true;
      if (resource.path === searchScopePath) return true;
      return resource.path.startsWith(`${searchScopePath}/`);
    });
  }, [resources, searchScopePath]);

  const filteredResources = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return scopedResources.filter((item) => item.type !== 'folder');
    }

    return scopedResources.filter((resource) => {
      if (resource.type === 'folder') return false;
      return (
        resource.name.toLowerCase().includes(query) ||
        resource.path.toLowerCase().includes(query) ||
        resource.type.toLowerCase().includes(query) ||
        (resource.tags || []).some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [scopedResources, searchQuery]);

  const searchTree = useMemo(() => {
    const rootChildren: SearchTreeNode[] = [];
    const scopePrefix = searchScopePath === '/' ? '' : `${searchScopePath}/`;

    filteredResources.forEach((resource) => {
      const relativePath =
        searchScopePath === '/'
          ? resource.path
          : resource.path.startsWith(scopePrefix)
            ? resource.path.slice(scopePrefix.length)
            : resource.path;
      const segments = relativePath.replace(/^\/+/, '').split('/').filter(Boolean);
      let current = rootChildren;

      segments.forEach((segment, index) => {
        const localPath = `/${segments.slice(0, index + 1).join('/')}`;
        const nodePath =
          searchScopePath === '/'
            ? localPath
            : `${searchScopePath}${localPath}`.replace(/\/+/g, '/');
        const isLeaf = index === segments.length - 1;
        let child = current.find((item) => item.name === segment && item.path === nodePath);

        if (!child) {
          child = {
            id: isLeaf ? resource.id : `search-folder:${nodePath}`,
            name: segment,
            type: isLeaf ? 'file' : 'folder',
            path: nodePath,
            resource: isLeaf ? resource : undefined,
            children: []
          };
          current.push(child);
        }

        current = child.children;
      });
    });

    const sortNodes = (nodes: SearchTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach((node) => sortNodes(node.children));
    };

    sortNodes(rootChildren);
    return rootChildren;
  }, [filteredResources, searchScopePath]);

  const openPanelsSection = (
    <>
      <div className="border-b border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)]">
        <div className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--wb-text-dim)]">
          <button
            onClick={() => setIsOpenEditorsCollapsed((value) => !value)}
            className="flex items-center gap-1 transition-colors hover:text-[var(--wb-text)]"
          >
            {isOpenEditorsCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Open Editors
          </button>
          <span>{editors.length}</span>
        </div>

        {!isOpenEditorsCollapsed && (
          <div className="overflow-y-auto px-1.5 pb-2" style={{ height: openEditorsHeight }}>
            {editors.length === 0 ? (
              <div className="px-2 py-3 text-sm text-[var(--wb-text-muted)]">No open editors.</div>
            ) : (
              editors.map((editor) => {
                const resource = resources.find((item) => item.id === editor.resourceId);
                const isActive = editor.id === activeEditorId;
                const isDirty = Boolean(
                  resource?.id &&
                    documentStateByResourceId[resource.id] &&
                    documentStateByResourceId[resource.id].content !==
                      documentStateByResourceId[resource.id].savedContent
                );

                return (
                  <div
                    key={editor.id}
                    className={`group flex items-center gap-2 rounded-sm px-2 py-1.5 ${
                      isActive ? 'bg-[var(--wb-accent-soft)]' : 'hover:bg-white/5'
                    }`}
                  >
                    <button
                      onClick={() => onActivateEditor(editor.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className={isActive ? 'text-[var(--wb-accent)]' : 'text-[var(--wb-text-dim)]'}>
                        {getEditorIcon(editor.type)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--wb-text)]">{editor.title}</span>
                        <span className="block truncate text-xs text-[var(--wb-text-muted)]">
                          {getEditorDescription(editor, resources)}
                        </span>
                      </span>
                      {isDirty && <span className="text-xs font-semibold text-[var(--wb-accent)]">M</span>}
                    </button>
                    <button
                      onClick={() => onCloseEditor(editor.id)}
                      className="rounded p-1 text-[var(--wb-text-dim)] opacity-0 transition-opacity hover:bg-white/5 hover:text-[var(--wb-text)] group-hover:opacity-100"
                      title="Close editor"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {!isOpenEditorsCollapsed && (
        <div
          className="h-px shrink-0 cursor-row-resize bg-[var(--wb-border)] hover:bg-[var(--wb-accent)]"
          onPointerDown={(event) => {
            event.preventDefault();
            const startY = event.clientY;
            const startHeight = openEditorsHeight;

            const handlePointerMove = (moveEvent: PointerEvent) => {
              setOpenEditorsHeight(
                Math.max(120, Math.min(420, startHeight + moveEvent.clientY - startY))
              );
            };

            const handlePointerUp = () => {
              window.removeEventListener('pointermove', handlePointerMove);
              window.removeEventListener('pointerup', handlePointerUp);
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
          }}
          title="Resize open editors"
        />
      )}
    </>
  );

  const filesView = (
    <>
      {openPanelsSection}
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileSystemSidebar
          workspaceId={workspaceId}
          initialPath={workbenchRootPath}
          title="Explorer"
          embedded
          hideHeader
          showEmbeddedActions
          enableWorkbenchDrag
          dndManager={dndManager}
          onFileSelect={onFileOpen}
          onFileDoubleClick={onFileOpen}
        />
      </div>
    </>
  );

  const searchView = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--wb-border)] px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-[var(--wb-text-muted)]">
            <button
              onClick={() => setSearchScopePath('/')}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 ${
                searchScopePath === '/' ? 'text-[var(--wb-text)]' : ''
              }`}
            >
              <House className="h-3.5 w-3.5" />
              Workspace
            </button>
            {searchBreadcrumbPaths.map((segment) => (
              <div key={segment.path} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                <button
                  onClick={() => setSearchScopePath(segment.path)}
                  className={`rounded px-1.5 py-0.5 hover:bg-white/5 ${
                    searchScopePath === segment.path ? 'text-[var(--wb-text)]' : ''
                  }`}
                >
                  {segment.label}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              const parent = getParentPath(searchScopePath);
              if (parent) setSearchScopePath(parent);
            }}
            disabled={searchScopePath === '/'}
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)] disabled:opacity-40"
            title="Go to parent folder"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Up
          </button>
        </div>

        <div className="mb-3 text-xs text-[var(--wb-text-dim)]">
          Default workbench scope: <span className="text-[var(--wb-text)]">{normalizedWorkbenchRootPath}</span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--wb-text-dim)]" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search current scope"
            className="h-9 w-full rounded border border-[var(--wb-border)] bg-[var(--wb-editor)] pl-9 pr-3 text-sm text-[var(--wb-text)] outline-none transition focus:border-[var(--wb-accent)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {searchTree.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--wb-border)] bg-white/5 p-4 text-sm text-[var(--wb-text-muted)]">
            No matching files in this scope.
          </div>
        ) : (
          <div className="space-y-0.5">
            {searchTree.map((node) => {
              const renderNode = (item: SearchTreeNode, depth = 0) => {
                const isFolder = item.type === 'folder';
                const expanded = searchTreeExpanded[item.path] ?? true;

                if (!isFolder && item.resource) {
                  return (
                    <button
                      key={item.id}
                      onClick={() => onFileOpen(toFileSystemObject(workspaceId, item.resource!))}
                      className="flex w-full items-center gap-2 rounded-sm py-1.5 pr-2 text-left hover:bg-white/5"
                      style={{ paddingLeft: `${depth * 14 + 10}px` }}
                    >
                      <FileSearch className="h-4 w-4 shrink-0 text-[var(--wb-accent)]" />
                      <span className="truncate text-sm text-[var(--wb-text)]">{item.name}</span>
                    </button>
                  );
                }

                return (
                  <div key={item.id}>
                    <div
                      className="flex w-full items-center gap-1 rounded-sm py-1.5 pr-2 hover:bg-white/5"
                      style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    >
                      <button
                        onClick={() =>
                          setSearchTreeExpanded((current) => ({
                            ...current,
                            [item.path]: !expanded
                          }))
                        }
                        className="inline-flex h-5 w-5 items-center justify-center text-[var(--wb-text-dim)] hover:text-[var(--wb-text)]"
                        title={expanded ? 'Collapse' : 'Expand'}
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => setSearchScopePath(item.path)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title={`Open ${item.path}`}
                      >
                        <FolderOpen className="h-4 w-4 shrink-0 text-[#79b6ff]" />
                        <span className="truncate text-sm text-[var(--wb-text)]">{item.name}</span>
                        <span className="ml-auto text-xs text-[var(--wb-text-dim)]">{item.children.length}</span>
                      </button>
                    </div>
                    {expanded && item.children.map((child) => renderNode(child, depth + 1))}
                  </div>
                );
              };

              return renderNode(node);
            })}
          </div>
        )}
      </div>
    </div>
  );

  const aiView = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--wb-border)] px-4 py-4">
        <div className="rounded border border-[var(--wb-border)] bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--wb-text)]">
            <Sparkles className="h-4 w-4 text-[var(--wb-accent)]" />
            AI reads active workbench context
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--wb-text-muted)]">
            Keep files from this workbench context open side by side and the AI panel can use them.
          </p>
          <button
            onClick={onCreateAiPanel}
            className="mt-4 inline-flex h-9 items-center justify-center rounded bg-[var(--wb-accent)] px-4 text-sm font-medium text-[#08111c] transition hover:brightness-110"
          >
            New AI Conversation
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {aiEditors.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--wb-border)] bg-white/5 p-4 text-sm text-[var(--wb-text-muted)]">
            Start an AI conversation scoped to this workbench.
          </div>
        ) : (
          aiEditors.map((editor, index) => (
            <div
              key={editor.id}
              className={`mb-2 rounded-sm border px-3 py-3 ${
                editor.id === activeEditorId
                  ? 'border-[var(--wb-accent)] bg-[var(--wb-accent-soft)]'
                  : 'border-[var(--wb-border)] bg-white/5'
              }`}
            >
              <button
                onClick={() => onActivateEditor(editor.id)}
                className="flex w-full items-start gap-3 text-left"
              >
                <div className="rounded bg-[rgba(90,166,255,0.12)] p-2 text-[var(--wb-accent)]">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--wb-text)]">
                    {editor.title || `AI Conversation ${index + 1}`}
                  </div>
                  <div className="truncate text-xs text-[var(--wb-text-muted)]">
                    {editor.viewState?.messages?.length
                      ? `${editor.viewState.messages.length} messages`
                      : 'Fresh conversation'}
                  </div>
                </div>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderView = () => {
    switch (activeView) {
      case 'files':
        return filesView;
      case 'search':
        return searchView;
      case 'ai':
        return aiView;
    }
  };

  if (isSidebarCollapsed) {
    return (
      <aside className="flex h-full shrink-0 border-r border-[var(--wb-border)] bg-[var(--wb-activitybar)]">
        <div className="flex w-12 flex-col items-center gap-1 py-2">
          {sidebarViews.map((view) => {
            const Icon = view.icon;
            return (
              <button
                key={view.id}
                onClick={() => {
                  onActiveViewChange(view.id);
                  setIsSidebarCollapsed(false);
                }}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded text-[var(--wb-text-dim)] transition hover:bg-white/5 hover:text-[var(--wb-text)]"
                title={view.label}
              >
                <Icon className="h-5 w-5" />
                {activeView === view.id && (
                  <span className="absolute left-0 top-1.5 h-7 w-0.5 rounded-r bg-[var(--wb-accent)]" />
                )}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="relative flex h-full shrink-0 border-r border-[var(--wb-border)] bg-[var(--wb-sidebar)]"
      style={{ width }}
    >
      <div className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-[var(--wb-border)] bg-[var(--wb-activitybar)] py-2">
        <div className="flex w-full flex-col items-center gap-1">
          {sidebarViews.map((view) => {
            const Icon = view.icon;
            const isActive = activeView === view.id;

            return (
              <button
                key={view.id}
                onClick={() => onActiveViewChange(view.id)}
                className={`relative inline-flex h-10 w-10 items-center justify-center rounded transition ${
                  isActive
                    ? 'bg-white/5 text-[var(--wb-text)]'
                    : 'text-[var(--wb-text-dim)] hover:bg-white/5 hover:text-[var(--wb-text)]'
                }`}
                title={view.label}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 h-7 w-0.5 rounded-r bg-[var(--wb-accent)]" />
                )}
                <Icon className="h-5 w-5" />
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setIsSidebarCollapsed(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded text-[var(--wb-text-dim)] transition hover:bg-white/5 hover:text-[var(--wb-text)]"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--wb-text-dim)]">
                {activeView === 'files' ? 'Explorer' : 'Workbench'}
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--wb-text)]">
                {sidebarViews.find((view) => view.id === activeView)?.label}
              </div>
            </div>
            <button
              onClick={onSave}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--wb-text-dim)] transition hover:bg-white/5 hover:text-[var(--wb-text)]"
              title={saveLabel}
            >
              <Save className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={activeView === 'files' ? 'min-h-0 flex flex-1 flex-col' : 'min-h-0 flex-1'}>
          {renderView()}
        </div>
      </div>

      <div
        className="absolute right-0 top-0 h-full w-px cursor-col-resize bg-transparent hover:bg-[var(--wb-accent)]"
        onPointerDown={onResizeStart}
        title="Resize sidebar"
      />
    </aside>
  );
}
