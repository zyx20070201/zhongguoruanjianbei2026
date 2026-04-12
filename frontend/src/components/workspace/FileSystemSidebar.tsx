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
  RefreshCw
} from 'lucide-react';
import { useFileCommands } from '../../hooks/useFileCommands';
import { useFileTreeStore } from '../../store/fileTreeStore';

interface FileSystemSidebarProps {
  workspaceId: string;
  onFileSelect?: (file: FileSystemObject) => void;
  onFileDoubleClick?: (file: FileSystemObject) => void;
  title?: string;
  embedded?: boolean;
  hideHeader?: boolean;
  showEmbeddedActions?: boolean;
  enableWorkbenchDrag?: boolean;
  dndManager?: ReturnType<typeof useDragDropManager>;
  initialPath?: string;
}

export const FileSystemSidebar: React.FC<FileSystemSidebarProps> = ({
  workspaceId,
  onFileSelect,
  onFileDoubleClick,
  title = 'Explorer',
  embedded = false,
  hideHeader = false,
  showEmbeddedActions = false,
  enableWorkbenchDrag = false,
  dndManager,
  initialPath
}) => {
  const [isDraggingFiles, setIsDraggingFiles] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = React.useState(280);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [collapseSignal, setCollapseSignal] = React.useState(0);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = React.useState(false);
  const [currentPath, setCurrentPath] = React.useState(initialPath || '/');
  const { refresh, loading } = useFileTree(workspaceId);
  const { createFolder, createFile, uploadFiles } = useFileCommands(workspaceId);
  const { files, selectedNodeId } = useFileTreeStore();

  React.useEffect(() => {
    setCurrentPath(initialPath || '/');
  }, [initialPath]);

  const getTargetFolder = () => {
    const selectedNode = files.find((file) => file.id === selectedNodeId);
    if (!selectedNode) {
      const currentFolder =
        currentPath === '/'
          ? undefined
          : files.find((file) => file.nodeType === 'folder' && file.path === currentPath);

      return { parentId: currentFolder?.id, parentPath: currentFolder?.path };
    }

    if (selectedNode.nodeType === 'folder') {
      return { parentId: selectedNode.id, parentPath: selectedNode.path };
    }

    const parent = selectedNode.parentId
      ? files.find((file) => file.id === selectedNode.parentId)
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
    const name = prompt('Enter file name (e.g., new-file.md):');
    if (!name) return;

    const { parentId, parentPath } = getTargetFolder();
    try {
      await createFile(name, parentId, parentPath);
    } catch (error: any) {
      alert(getErrorMessage(error, 'Failed to create file'));
    }
  };

  const handleCreateFolder = async () => {
    const name = prompt('Enter folder name:');
    if (!name) return;

    const { parentId, parentPath } = getTargetFolder();
    try {
      await createFolder(name, parentId, parentPath);
    } catch (error: any) {
      alert(getErrorMessage(error, 'Failed to create folder'));
    }
  };

  const handleCreateNote = async () => {
    const name = prompt('Enter note name (e.g., untitled-note.md):', 'untitled-note.md');
    if (!name) return;

    const finalName = /\.[^./]+$/.test(name) ? name : `${name}.md`;
    const { parentId, parentPath } = getTargetFolder();
    try {
      await createFile(finalName, parentId, parentPath);
      setIsCreateMenuOpen(false);
    } catch (error: any) {
      alert(getErrorMessage(error, 'Failed to create note'));
    }
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files as FileList);
      if (files.length > 0) {
        await uploadFilesToTarget(files);
      }
    };
    input.click();
  };

  const uploadFilesToTarget = async (files: File[]) => {
    const { parentId, parentPath } = getTargetFolder();
    try {
      await uploadFiles(files, parentId, parentPath);
    } catch (error: any) {
      alert(getErrorMessage(error, 'Failed to upload files'));
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
    'inline-flex h-6 w-6 items-center justify-center rounded text-[var(--wb-text-dim)] hover:bg-white/5 hover:text-[var(--wb-text)] disabled:cursor-not-allowed disabled:opacity-50';
  const renderCreateMenu = () => (
    <div className="absolute right-0 top-8 z-30 min-w-[150px] overflow-hidden rounded border border-[var(--wb-border)] bg-[var(--wb-panel)] py-1 shadow-lg">
      <button
        onClick={() => {
          void handleCreateFile();
          setIsCreateMenuOpen(false);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--wb-text)] hover:bg-white/5"
      >
        <FilePlus2 size={14} /> New File
      </button>
      <button
        onClick={() => void handleCreateNote()}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--wb-text)] hover:bg-white/5"
      >
        <FileText size={14} /> New Note
      </button>
      <button
        onClick={() => {
          void handleCreateFolder();
          setIsCreateMenuOpen(false);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--wb-text)] hover:bg-white/5"
      >
        <FolderPlus size={14} /> New Folder
      </button>
    </div>
  );

  return (
    <div
      className={`group/explorer relative flex h-full min-h-0 flex-col self-stretch shrink-0 border-r border-[var(--wb-border)] bg-[var(--wb-sidebar)] ${
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
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-[var(--wb-accent)] bg-[rgba(90,166,255,0.14)] text-sm font-medium text-[#d9eaff]">
          Drop files to upload
        </div>
      )}
      {embedded && showEmbeddedActions && (
        <div className="relative flex h-10 items-center border-b border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-2">
          <div className="ml-auto flex items-center gap-0.5">
            <div className="relative">
              <button
                onClick={() => setIsCreateMenuOpen((value) => !value)}
                className="inline-flex h-6 items-center gap-1 rounded px-2 text-[var(--wb-text-dim)] hover:bg-white/5 hover:text-[var(--wb-text)]"
                title="Create"
              >
                <FilePlus2 size={15} />
                <ChevronDown size={12} />
              </button>
              {isCreateMenuOpen && renderCreateMenu()}
            </div>
            <button 
              onClick={handleUpload}
              className={explorerButtonClass}
              title="Upload"
            >
              <Upload size={15} />
            </button>
            <button 
              onClick={() => setCollapseSignal(signal => signal + 1)}
              className={explorerButtonClass}
              title="Collapse Folders"
            >
              <ChevronsUp size={15} />
            </button>
            <button 
              onClick={refresh}
              disabled={loading}
              className={explorerButtonClass}
              title="Refresh Explorer"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
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
          title={isCollapsed ? 'Open Explorer' : 'Minimize Explorer'}
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
              title="Create"
            >
              <FilePlus2 size={15} />
              <ChevronDown size={12} />
            </button>
            {isCreateMenuOpen && renderCreateMenu()}
          </div>
          <button 
            onClick={handleUpload}
            className={explorerButtonClass}
            title="Upload"
          >
            <Upload size={15} />
          </button>
          <button 
            onClick={() => setCollapseSignal(signal => signal + 1)}
            className={explorerButtonClass}
            title="Collapse Folders"
          >
            <ChevronsUp size={15} />
          </button>
          <button 
            onClick={refresh}
            disabled={loading}
            className={explorerButtonClass}
            title="Refresh Explorer"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      )}
      
      <div className={`flex min-h-0 flex-1 overflow-hidden ${isCollapsed ? 'invisible pointer-events-none' : ''}`}>
        <FileTreeComponent 
          workspaceId={workspaceId}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
          collapseSignal={collapseSignal}
          enableWorkbenchDrag={enableWorkbenchDrag}
          dndManager={dndManager}
          initialPath={initialPath}
          currentPath={currentPath}
          onCurrentPathChange={setCurrentPath}
        />
      </div>
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
