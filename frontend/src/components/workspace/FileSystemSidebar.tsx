import React from 'react';
import { useDragDropManager } from 'react-dnd';
import { FileTreeComponent } from '../files/FileTree';
import { useFileTree } from '../../hooks/useFileTree';
import { FileSystemObject } from '../../types';
import {
  ChevronDown,
  ChevronsUp,
  FilePlus2,
  FileText,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
  RefreshCw,
  Search
} from 'lucide-react';
import { useFileCommands } from '../../hooks/useFileCommands';
import { useFileTreeStore } from '../../store/fileTreeStore';
import { AddSourcesDialog } from './AddSourcesDialog';
import { DiscoveredResource, fileSystemApi } from '../../services/fileSystemApi';

interface FileSystemSidebarProps {
  workspaceId: string;
  workbenchId?: string;
  onFileSelect?: (file: FileSystemObject) => void;
  onFileDoubleClick?: (file: FileSystemObject) => void;
  title?: string;
  embedded?: boolean;
  hideHeader?: boolean;
  showEmbeddedActions?: boolean;
  enableWorkbenchDrag?: boolean;
  dndManager?: ReturnType<typeof useDragDropManager>;
  initialPath?: string;
  codexPanel?: boolean;
  hideFilter?: boolean;
  transparentPanel?: boolean;
  fileFilterMode?: 'all' | 'source' | 'workspace' | 'generated';
  resourceMode?: boolean;
  autoHeight?: boolean;
}

export const FileSystemSidebar: React.FC<FileSystemSidebarProps> = ({
  workspaceId,
  workbenchId,
  onFileSelect,
  onFileDoubleClick,
  title = '文件浏览器',
  embedded = false,
  hideHeader = false,
  showEmbeddedActions = false,
  enableWorkbenchDrag = false,
  dndManager,
  initialPath,
  codexPanel = false,
  hideFilter = false,
  transparentPanel = false,
  fileFilterMode = 'all',
  resourceMode = false,
  autoHeight = false
}) => {
  const [isDraggingFiles, setIsDraggingFiles] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = React.useState(280);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [collapseSignal, setCollapseSignal] = React.useState(0);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = React.useState(false);
  const [isAddSourcesOpen, setIsAddSourcesOpen] = React.useState(false);
  const [currentPath, setCurrentPath] = React.useState(initialPath || '/');
  const [filterQuery, setFilterQuery] = React.useState('');
  const role = fileFilterMode === 'workspace' ? 'file' : fileFilterMode === 'all' ? undefined : fileFilterMode;
  const { files: sidebarFiles, refresh, loading, error } = useFileTree(workspaceId, {
    resourceMode,
    workbenchId,
    role,
    scope: workbenchId ? 'all' : 'workspace'
  });
  const { createFolder, createFile, uploadFiles, importUrl } = useFileCommands(workspaceId, {
    resourceMode,
    workbenchId,
    resourceRole: role,
    scope: workbenchId ? 'workbench' : 'workspace'
  });
  const { files, selectedNodeId } = useFileTreeStore();
  const activeFiles = resourceMode ? sidebarFiles : files;

  React.useEffect(() => {
    setCurrentPath(initialPath || '/');
  }, [initialPath]);

  const getTargetFolder = () => {
    const selectedNode = activeFiles.find((file) => file.id === selectedNodeId);
    if (!selectedNode) {
      const currentFolder =
        currentPath === '/'
          ? undefined
          : activeFiles.find((file) => file.nodeType === 'folder' && file.path === currentPath);

      return { parentId: currentFolder?.id, parentPath: currentFolder?.path };
    }

    if (selectedNode.nodeType === 'folder') {
      return { parentId: selectedNode.id, parentPath: selectedNode.path };
    }

    const parent = selectedNode.parentId
      ? activeFiles.find((file) => file.id === selectedNode.parentId)
      : undefined;

    return {
      parentId: selectedNode.parentId,
      parentPath: parent?.path
    };
  };

  const getErrorMessage = (error: any, fallback: string) => {
    return error?.response?.data?.error || error?.message || fallback;
  };

  const handleCreateFile = async () => {
    const name = prompt('请输入文件名（例如 new-file.md）：');
    if (!name) return;

    const { parentId, parentPath } = getTargetFolder();
    try {
      await createFile(name, parentId, parentPath);
    } catch (error: any) {
      alert(getErrorMessage(error, '创建文件失败'));
    }
  };

  const handleCreateFolder = async () => {
    const name = prompt('请输入文件夹名称：');
    if (!name) return;

    const { parentId, parentPath } = getTargetFolder();
    try {
      await createFolder(name, parentId, parentPath);
    } catch (error: any) {
      alert(getErrorMessage(error, '创建文件夹失败'));
    }
  };

  const handleCreateNote = async () => {
    const name = prompt('请输入笔记名称（例如 untitled-note.md）：', 'untitled-note.md');
    if (!name) return;

    const finalName = /\.[^./]+$/.test(name) ? name : `${name}.md`;
    const { parentId, parentPath } = getTargetFolder();
    try {
      await createFile(finalName, parentId, parentPath, {
        fileCategory: 'note',
        resourceRole: 'note',
        resourceType: 'note',
        scope: workbenchId ? 'workbench' : 'workspace'
      });
      setIsCreateMenuOpen(false);
    } catch (error: any) {
      alert(getErrorMessage(error, '创建笔记失败'));
    }
  };

  const handleUpload = () => {
    setIsAddSourcesOpen(true);
  };

  const uploadFilesToTarget = async (files: File[]) => {
    const { parentId, parentPath } = getTargetFolder();
    try {
      await uploadFiles(files, parentId, parentPath);
    } catch (error: any) {
      alert(getErrorMessage(error, '上传文件失败'));
    }
  };

  const sourceFilename = (title: string, fallback: string) => {
    const safeBase = (title || fallback)
      .trim()
      .replace(/\.[^./]+$/, '')
      .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .trim() || fallback;
    return `${safeBase}.source`;
  };

  const addWebsiteSource = async ({ title, url }: { title: string; url: string }) => {
    const { parentId, parentPath } = getTargetFolder();
    await importUrl({ title, url }, parentId, parentPath);
  };

  const addTextSource = async ({ title, content }: { title: string; content: string }) => {
    const { parentId, parentPath } = getTargetFolder();
    await createFile(sourceFilename(title, 'pasted-source'), parentId, parentPath, {
      content: `# ${title}\n\nSource type: copied text\n\n${content}\n`,
      fileCategory: 'text-source',
      resourceRole: 'source',
      resourceType: 'source',
      scope: workbenchId ? 'workbench' : 'workspace'
    });
  };

  const discoverSources = async ({ query, maxResults }: { query: string; maxResults?: number }) => {
    if (!workspaceId) return [];
    const response = await fileSystemApi.discoverSources(workspaceId, {
      query,
      maxResults,
      provider: 'auto'
    });
    return response.results;
  };

  const importDiscoveredSources = async (sources: DiscoveredResource[]) => {
    const { parentId, parentPath } = getTargetFolder();
    for (const source of sources) {
      await importUrl({ title: source.title, url: source.url }, parentId, parentPath);
    }
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isCollapsed) return;

    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(440, Math.max(180, startWidth + event.clientX - startX));
      setSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const explorerButtonClass =
    codexPanel
      ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#777b80] hover:bg-[#f1f1ef] hover:text-[#202124] disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex h-6 w-6 items-center justify-center rounded text-[var(--wb-text-dim)] hover:bg-white/5 hover:text-[var(--wb-text)] disabled:cursor-not-allowed disabled:opacity-50';
  const renderCreateMenu = () => (
    <div className={`absolute right-0 top-8 z-30 min-w-[150px] overflow-hidden py-1 shadow-lg ${
      codexPanel
        ? 'rounded-xl border border-[#e2e2de] bg-white text-[#202124]'
        : 'rounded border border-[var(--wb-border)] bg-[var(--wb-panel)]'
    }`}>
      <button
        onClick={() => {
          void handleCreateFile();
          setIsCreateMenuOpen(false);
        }}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
          codexPanel ? 'text-[#34373c] hover:bg-[#f6f6f4]' : 'text-[var(--wb-text)] hover:bg-white/5'
        }`}
      >
        <FilePlus2 size={14} /> 新建文件
      </button>
      <button
        onClick={() => void handleCreateNote()}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
          codexPanel ? 'text-[#34373c] hover:bg-[#f6f6f4]' : 'text-[var(--wb-text)] hover:bg-white/5'
        }`}
      >
        <FileText size={14} /> 新建笔记
      </button>
      <button
        onClick={() => {
          void handleCreateFolder();
          setIsCreateMenuOpen(false);
        }}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
          codexPanel ? 'text-[#34373c] hover:bg-[#f6f6f4]' : 'text-[var(--wb-text)] hover:bg-white/5'
        }`}
      >
        <FolderPlus size={14} /> 新建文件夹
      </button>
    </div>
  );

  return (
    <div
      className={`group/explorer relative flex h-full min-h-0 flex-col self-stretch shrink-0 ${
        codexPanel
          ? transparentPanel ? 'bg-transparent' : 'bg-white'
          : 'border-r border-[var(--wb-border)] bg-[var(--wb-sidebar)]'
      } ${
        isDraggingFiles ? 'ring-2 ring-[var(--wb-accent)] ring-inset' : ''
      }`}
      style={embedded ? undefined : { width: isCollapsed ? 40 : sidebarWidth }}
      onDragOver={(e) => {
        if (isCollapsed) return;
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setIsDraggingFiles(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDraggingFiles(false);
        }
      }}
      onDrop={async (e) => {
        if (isCollapsed) return;
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setIsDraggingFiles(false);

        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
          await uploadFilesToTarget(droppedFiles);
        }
      }}
    >
      {isCreateMenuOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setIsCreateMenuOpen(false)} />
      )}
      {isDraggingFiles && !isCollapsed && (
        <div className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-[var(--wb-accent)] bg-[rgba(90,166,255,0.14)] text-sm font-medium ${
          codexPanel ? 'text-[#1683ff]' : 'text-[#d9eaff]'
        }`}>
          松开即可上传文件
        </div>
      )}
      {embedded && showEmbeddedActions && (
        <div className={`relative flex items-center border-b px-3 ${
          codexPanel ? 'h-12 border-[#eeeeeb] bg-white' : 'h-10 border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-2'
        }`}>
          {codexPanel && (
            <div className="mr-auto flex items-center gap-1 text-xs text-[#96999d]">
              <span>{currentPath === '/' ? 'Workspace' : currentPath}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setIsCreateMenuOpen((value) => !value)}
                className={codexPanel
                  ? 'inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[#777b80] hover:bg-[#f1f1ef] hover:text-[#202124]'
                  : 'inline-flex h-6 items-center gap-1 rounded px-2 text-[var(--wb-text-dim)] hover:bg-white/5 hover:text-[var(--wb-text)]'
                }
                title="新建"
              >
                <FilePlus2 size={15} />
                <ChevronDown size={12} />
              </button>
              {isCreateMenuOpen && renderCreateMenu()}
            </div>
            <button 
              onClick={handleUpload}
              className={explorerButtonClass}
              title="上传"
            >
              <Upload size={15} />
            </button>
            <button 
              onClick={() => setCollapseSignal(signal => signal + 1)}
              className={explorerButtonClass}
              title="折叠文件夹"
            >
              <ChevronsUp size={15} />
            </button>
            <button 
              onClick={refresh}
              disabled={loading}
              className={explorerButtonClass}
              title="刷新文件浏览器"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      )}
      {codexPanel && !hideFilter && (
        <div className="border-b border-[#eeeeeb] bg-white px-4 py-3">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-[#e6e6e2] bg-white px-3 text-[#9a9da1] shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-[#cfcfca]">
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#a8aaad]"
              placeholder="筛选文件..."
            />
          </label>
        </div>
      )}
      {!embedded && isCollapsed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[var(--wb-sidebar)]">
          <div className="mt-3 select-none text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--wb-text-dim)] [writing-mode:vertical-rl]">
            {title}
          </div>
        </div>
      )}
      {!embedded && (
        <button
          onClick={() => setIsCollapsed(value => !value)}
          className="absolute -right-3 top-1/2 z-30 inline-flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] text-[var(--wb-text-dim)] shadow-sm hover:bg-[var(--wb-sidebar)] hover:text-[var(--wb-text)]"
          title={isCollapsed ? '展开文件浏览器' : '收起文件浏览器'}
        >
          {isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      )}
      {!hideHeader && (
      <div className={`relative flex h-11 items-center border-b border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-3 focus-within:bg-[var(--wb-sidebar-alt)] ${isCollapsed ? 'invisible pointer-events-none' : ''}`}>
        <h2 className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.18em] text-[var(--wb-text-dim)] transition-opacity group-hover/explorer:opacity-0 group-focus-within/explorer:opacity-0">{title}</h2>
        <div className="absolute right-2 top-2.5 flex items-center gap-0.5 bg-[var(--wb-sidebar-alt)] opacity-0 pointer-events-none transition-opacity group-hover/explorer:opacity-100 group-hover/explorer:pointer-events-auto group-focus-within/explorer:opacity-100 group-focus-within/explorer:pointer-events-auto">
          <div className="relative">
            <button
              onClick={() => setIsCreateMenuOpen((value) => !value)}
              className="inline-flex h-6 items-center gap-1 rounded px-2 text-[var(--wb-text-dim)] hover:bg-white/5 hover:text-[var(--wb-text)]"
              title="新建"
            >
              <FilePlus2 size={15} />
              <ChevronDown size={12} />
            </button>
            {isCreateMenuOpen && renderCreateMenu()}
          </div>
          <button 
            onClick={handleUpload}
            className={explorerButtonClass}
            title="上传"
          >
            <Upload size={15} />
          </button>
          <button 
            onClick={() => setCollapseSignal(signal => signal + 1)}
            className={explorerButtonClass}
            title="折叠文件夹"
          >
            <ChevronsUp size={15} />
          </button>
          <button 
            onClick={refresh}
            disabled={loading}
            className={explorerButtonClass}
            title="刷新文件浏览器"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      )}
      
      <div
        className={`flex ${autoHeight ? 'min-h-0 shrink-0' : 'min-h-0 flex-1'} overflow-hidden ${
          codexPanel ? `${transparentPanel ? 'bg-transparent' : 'bg-white'} px-2 py-1` : ''
        } ${isCollapsed ? 'invisible pointer-events-none' : ''}`}
      >
        <FileTreeComponent
          workspaceId={workspaceId}
          filesOverride={resourceMode ? sidebarFiles : undefined}
          loadingOverride={resourceMode ? loading : undefined}
          errorOverride={resourceMode ? error : undefined}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
          collapseSignal={collapseSignal}
          enableWorkbenchDrag={enableWorkbenchDrag}
          dndManager={dndManager}
          initialPath={initialPath}
          currentPath={currentPath}
          filterQuery={filterQuery}
          compactHeader={codexPanel}
          transparentBackground={transparentPanel}
          fileFilterMode={fileFilterMode}
          autoHeight={autoHeight}
          onCurrentPathChange={setCurrentPath}
        />
      </div>
      <AddSourcesDialog
        isOpen={isAddSourcesOpen}
        onClose={() => setIsAddSourcesOpen(false)}
        onUploadFiles={uploadFilesToTarget}
        onAddWebsite={addWebsiteSource}
        onAddText={addTextSource}
        onDiscoverSources={discoverSources}
        onImportDiscoveredSources={importDiscoveredSources}
      />
      {!embedded && !isCollapsed && (
        <div
          className="absolute right-0 top-0 h-full w-px cursor-col-resize bg-transparent hover:bg-[var(--wb-accent)]"
          onPointerDown={startResize}
          title="Resize Explorer"
        />
      )}
    </div>
  );
};
