import {
  FileText,
  MessageSquare,
  PencilLine,
  Plus,
  Search,
  Sparkles,
  Upload
} from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useMemo } from 'react';
import { useDragDropManager } from 'react-dnd';
import { EditorState, FileSystemObject, Workbench } from '../../types';
import { FileSystemSidebar } from '../workspace/FileSystemSidebar';

interface WorkbenchSidebarProps {
  workspaceId: string;
  workbenchRootPath?: string;
  editors: EditorState[];
  workbenches: Workbench[];
  currentWorkbenchId: string;
  activeEditorId: string | null;
  onActivateEditor: (editorId: string) => void;
  onFileOpen: (file: FileSystemObject) => void;
  onNewChat: () => void;
  onNewNote: () => void;
  onUploadResources: () => void;
  onSearch: () => void;
  onOpenWorkbench: (workbenchId: string) => void;
  dndManager: ReturnType<typeof useDragDropManager>;
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

const normalizePath = (value?: string) => {
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
};

export default function WorkbenchSidebar({
  workspaceId,
  workbenchRootPath,
  editors,
  workbenches,
  currentWorkbenchId,
  activeEditorId,
  onActivateEditor,
  onFileOpen,
  onNewChat,
  onNewNote,
  onUploadResources,
  onSearch,
  onOpenWorkbench,
  dndManager,
  width,
  onResizeStart
}: WorkbenchSidebarProps) {
  const normalizedWorkbenchRootPath = normalizePath(workbenchRootPath);

  const chatHistory = useMemo(() => {
    const currentWorkbench = workbenches.find((item) => item.id === currentWorkbenchId);
    const knownWorkbenches = [
      {
        id: currentWorkbenchId,
        title: currentWorkbench?.title || 'Current workbench',
        updatedAt: currentWorkbench?.updatedAt,
        editors
      },
      ...workbenches
        .filter((item) => item.id !== currentWorkbenchId)
        .map((item) => ({
          id: item.id,
          title: item.title,
          updatedAt: item.updatedAt,
          editors: item.state?.editors || []
        }))
    ];

    return knownWorkbenches.flatMap((workbench) =>
      workbench.editors
        .filter((editor) => editor.type === 'ai')
        .map((editor) => ({
          editor,
          workbenchId: workbench.id,
          workbenchTitle: workbench.title,
          updatedAt: workbench.updatedAt
        }))
    );
  }, [currentWorkbenchId, editors, workbenches]);

  const formatHistoryTime = (value?: string) => {
    if (!value) return 'recent';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'recent';
    return date.toLocaleDateString();
  };

  const actionItems = [
    { label: 'New chat', icon: PencilLine, onClick: onNewChat },
    { label: 'New note', icon: FileText, onClick: onNewNote },
    { label: 'Upload resources', icon: Upload, onClick: onUploadResources },
    { label: 'Search', icon: Search, onClick: onSearch }
  ];

  const filesView = (
    <>
      <section className="flex shrink-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-2 pb-1 pt-2">
          <h2 className="text-sm font-semibold text-[#6f7379]">Folders</h2>
        </div>
        <div className="h-[150px] min-h-0">
          <FileSystemSidebar
            workspaceId={workspaceId}
            initialPath={normalizedWorkbenchRootPath}
            title="Folders"
            embedded
            hideHeader
            codexPanel
            hideFilter
            transparentPanel
            enableWorkbenchDrag
            dndManager={dndManager}
            onFileSelect={onFileOpen}
            onFileDoubleClick={onFileOpen}
          />
        </div>
      </section>

      <section className="px-2 pt-2 pb-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#6f7379]">Chats</h2>
          <button
            onClick={onNewChat}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-white/80 hover:text-[#202124]"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1 overflow-y-auto pr-1">
          {chatHistory.length === 0 ? (
            <button
              onClick={onNewChat}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[#6b6f76] transition hover:bg-white/70"
            >
              <MessageSquare className="h-4 w-4" />
              Start first chat
            </button>
          ) : (
            chatHistory.map(({ editor, workbenchId, workbenchTitle, updatedAt }) => {
              const isActive = workbenchId === currentWorkbenchId && editor.id === activeEditorId;

              return (
                <button
                  key={`${workbenchId}:${editor.id}`}
                  onClick={() => {
                    if (workbenchId === currentWorkbenchId) {
                      onActivateEditor(editor.id);
                    } else {
                      onOpenWorkbench(workbenchId);
                    }
                  }}
                  className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                    isActive ? 'bg-white/90 text-[#202124] shadow-sm' : 'text-[#34373c] hover:bg-white/70'
                  }`}
                >
                  <Sparkles className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#202124]' : 'text-[#777b80]'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{editor.title || 'AI Assistant'}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#96999d]">
                      {workbenchTitle} · {formatHistoryTime(updatedAt)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </>
  );

  return (
    <aside
      className="workspace-slide-right relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-[#d9d9d4] bg-[#eeeeec] shadow-sm"
      style={{ width }}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4">
          <nav className="space-y-0.5">
            {actionItems.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className="workspace-nav-item flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm text-[#34373c] transition hover:bg-white/70"
                >
                  <Icon className="h-4 w-4 text-[#55585d]" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-5 flex shrink-0 flex-col">
            {filesView}
          </div>
        </div>
      </div>

      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[#d7d7d2]"
        onPointerDown={onResizeStart}
        title="Resize sidebar"
      />
    </aside>
  );
}
