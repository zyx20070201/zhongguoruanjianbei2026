import {
  ChevronDown,
  FileText,
  FolderKanban,
  FolderOpen,
  Home,
  LibraryBig,
  PencilLine,
  Plus,
  Search,
  Target,
  Upload
} from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useState } from 'react';
import { useDragDropManager } from 'react-dnd';
import { EditorState, FileSystemObject, Workbench } from '../../types';
import { FileSystemSidebar } from '../workspace/FileSystemSidebar';

interface WorkbenchSidebarProps {
  workspaceId: string;
  workbenchId: string;
  workbenchRootPath?: string;
  editors: EditorState[];
  workbenches: Workbench[];
  currentWorkbenchId: string;
  activeEditorId: string | null;
  currentWorkbenchTitle: string;
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
  variant?: 'pinned' | 'preview';
}

const normalizePath = (value?: string) => {
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
};

export default function WorkbenchSidebar({
  workspaceId,
  workbenchId,
  workbenchRootPath,
  editors,
  workbenches,
  currentWorkbenchId,
  activeEditorId,
  currentWorkbenchTitle,
  onActivateEditor,
  onFileOpen,
  onNewChat,
  onNewNote,
  onUploadResources,
  onSearch,
  onOpenWorkbench,
  dndManager,
  width,
  onResizeStart,
  variant = 'pinned'
}: WorkbenchSidebarProps) {
  const [isWorkbenchMenuOpen, setIsWorkbenchMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'home' | 'source' | 'workspace' | 'generated' | 'plans'>('home');
  const [expandedHomeSections, setExpandedHomeSections] = useState<Record<string, boolean>>({});
  const normalizedWorkbenchRootPath = normalizePath(workbenchRootPath);

  const actionItems = [
    { label: 'New note', icon: FileText, onClick: onNewNote }
  ];
  const isPreview = variant === 'preview';
  const resourceActionClass =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#85898f] transition-all duration-200 ease-out hover:-translate-y-px hover:bg-white hover:text-[#25282d] hover:shadow-[0_5px_14px_rgba(0,0,0,0.07)]';

  const sectionTabs: Array<{
    key: 'home' | 'source' | 'workspace' | 'generated' | 'plans';
    title: string;
    icon: typeof Home;
  }> = [
    { key: 'home', title: 'Home', icon: Home },
    { key: 'source', title: 'Sources', icon: LibraryBig },
    { key: 'workspace', title: 'Files', icon: FolderOpen },
    { key: 'generated', title: 'Generates', icon: FolderKanban },
    { key: 'plans', title: 'Plans', icon: Target }
  ];

  const resourceSections: Array<{
    key: 'source' | 'workspace' | 'generated';
    title: string;
    initialPath: string;
  }> = [
    {
      key: 'source',
      title: 'Sources',
      initialPath: '/'
    },
    {
      key: 'workspace',
      title: 'Files',
      initialPath: normalizedWorkbenchRootPath
    },
    {
      key: 'generated',
      title: 'Generates',
      initialPath: normalizedWorkbenchRootPath
    }
  ];

  const activeResourceSection = resourceSections.find((section) => section.key === activeSection);
  const shouldShowResourceSearch = activeSection === 'home' || activeSection === 'source';
  const shouldShowChats = activeSection === 'home';
  const toggleHomeSection = (key: string) => {
    setExpandedHomeSections((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  return (
    <aside
      className={`workspace-slide-right relative flex shrink-0 flex-col overflow-hidden border bg-[rgba(250,250,248,0.96)] backdrop-blur-xl transition-[width,box-shadow,background-color,border-color] duration-300 ease-out ${
        isPreview
          ? 'h-full rounded-xl border-[#dddcd7] shadow-[0_18px_44px_rgba(0,0,0,0.12)]'
          : 'h-full rounded-none border-[#e2e1dc] shadow-none'
      }`}
      style={{ width }}
    >
      {isWorkbenchMenuOpen && (
        <button
          type="button"
          className="absolute inset-0 z-20 cursor-default"
          onClick={() => setIsWorkbenchMenuOpen(false)}
          aria-label="Close workbench menu"
        />
      )}

      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3">
          <div className="relative mb-3">
            <button
              type="button"
              onClick={() => setIsWorkbenchMenuOpen((value) => !value)}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200 ease-out hover:bg-white/75 hover:shadow-[0_7px_24px_rgba(0,0,0,0.045)]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f0efea] text-[#686c72]">
                <FileText className="h-4 w-4" />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[#2b2f33]">
                  {currentWorkbenchTitle}
                </span>
                <span className="block truncate text-xs text-[#95989d]">
                  Switch workbench
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#8f9399] transition-transform ${
                  isWorkbenchMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isWorkbenchMenuOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-[#e5e4de] bg-white p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.14)]">
                {workbenches.map((item) => {
                  const isCurrent = item.id === currentWorkbenchId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setIsWorkbenchMenuOpen(false);
                        if (!isCurrent) onOpenWorkbench(item.id);
                      }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 ease-out ${
                      isCurrent ? 'bg-[#f3f2ee]' : 'hover:bg-[#f7f7f5]'
                    }`}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[#8e9298]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#2b2f33]">
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-[#9a9da2]">
                          {item.panelCount ?? item.state?.editors?.length ?? 0} tabs
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <section className="mb-3 flex shrink-0 items-center gap-1 px-1">
            <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
              {sectionTabs.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`flex h-9 items-center justify-center overflow-hidden rounded-xl transition-all duration-300 ease-out ${
                      isActive
                        ? 'w-[104px] bg-white px-3 text-[#202124] shadow-[0_8px_24px_rgba(0,0,0,0.07)]'
                        : 'w-9 px-0 text-[#7a7e84] hover:bg-white/70 hover:text-[#202124]'
                    }`}
                    title={section.title}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span
                      className={`whitespace-nowrap text-sm font-semibold transition-all duration-300 ease-out ${
                        isActive ? 'ml-2 max-w-[72px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                      }`}
                    >
                      {section.title}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={onSearch}
              className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#7a7e84] transition-all duration-200 ease-out hover:bg-white/70 hover:text-[#202124]"
              title="Search"
            >
              <Search className="h-4 w-4" />
            </button>
          </section>

          <nav className="space-y-1">
            {actionItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[#464a50] transition-all duration-200 ease-out hover:translate-x-0.5 hover:bg-white/75"
                >
                  <Icon className="h-4 w-4 text-[#74787e]" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <section className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden pb-3">
            {shouldShowResourceSearch && (
            <div className="px-1">
              <button
                type="button"
                onClick={onUploadResources}
                className="flex h-10 w-full items-center gap-2 rounded-xl border border-[#e7e6e1] bg-white/80 px-3 text-left text-sm text-[#666b72] transition-all duration-200 ease-out hover:-translate-y-px hover:border-[#d9d8d2] hover:bg-white hover:shadow-[0_8px_22px_rgba(0,0,0,0.055)]"
              >
                <Search className="h-4 w-4 text-[#8a8e94]" />
                <span className="min-w-0 flex-1 truncate">Search or upload resources</span>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#7f8388] hover:bg-[#f3f2ee]">
                  <Upload className="h-4 w-4" />
                </span>
              </button>
            </div>
            )}

            {activeSection === 'home' && (
                <div className="min-h-0 px-1">
                <div className="space-y-1">
                  {resourceSections.map((section) => (
                    <div key={section.key} className="min-w-0">
                      <div className="group flex items-center rounded-xl transition-all duration-200 ease-out hover:translate-x-0.5 hover:bg-white/75">
                        <button
                          type="button"
                          onClick={() => toggleHomeSection(section.key)}
                          onDoubleClick={() => setActiveSection(section.key)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[#464a50]"
                        >
                          {section.key === 'source' ? (
                            <LibraryBig className="h-4 w-4 text-[#74787e]" />
                          ) : section.key === 'workspace' ? (
                            <FolderOpen className="h-4 w-4 text-[#74787e]" />
                          ) : (
                            <FolderKanban className="h-4 w-4 text-[#74787e]" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{section.title}</span>
                          <ChevronDown
                            className={`h-4 w-4 text-[#9a9da2] transition-transform ${
                              expandedHomeSections[section.key] ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {(section.key === 'source' || section.key === 'workspace') && (
                          <button
                            type="button"
                            onClick={onUploadResources}
                            className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#90949a] opacity-80 transition-all duration-200 ease-out hover:bg-white hover:text-[#25282d] group-hover:opacity-100"
                            title={section.key === 'source' ? 'Upload source' : 'Upload file'}
                          >
                            <Upload className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {expandedHomeSections[section.key] && (
                        <div className="ml-2 min-h-0 border-l border-[#ecebe6] pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <FileSystemSidebar
                            workspaceId={workspaceId}
                            workbenchId={workbenchId}
                            initialPath={section.initialPath}
                            title={section.title}
                            embedded
                            hideHeader
                            codexPanel
                            hideFilter
                            transparentPanel
                            enableWorkbenchDrag
                            dndManager={dndManager}
                            fileFilterMode={section.key}
                            resourceMode
                            autoHeight
                            onFileSelect={onFileOpen}
                            onFileDoubleClick={onFileOpen}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeResourceSection && (
              <div className="flex min-h-0 flex-col overflow-visible px-1">
                <div className="mb-2 flex items-center justify-between px-2">
                  <h2 className="text-sm font-medium text-[#464a50]">{activeResourceSection.title}</h2>
                  {activeResourceSection.key === 'source' ? (
                    <button
                      onClick={onUploadResources}
                      className={resourceActionClass}
                      title="Add source"
                    >
                      <Upload className="h-4 w-4" />
                    </button>
                  ) : activeResourceSection.key === 'workspace' ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={onUploadResources}
                        className={resourceActionClass}
                        title="Upload file"
                      >
                        <Upload className="h-4 w-4" />
                      </button>
                      <button
                        onClick={onNewNote}
                        className={resourceActionClass}
                        title="New note"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="min-h-0">
                  <FileSystemSidebar
                    workspaceId={workspaceId}
                    workbenchId={workbenchId}
                    initialPath={activeResourceSection.initialPath}
                    title={activeResourceSection.title}
                    embedded
                    hideHeader
                    codexPanel
                    hideFilter
                    transparentPanel
                    enableWorkbenchDrag
                    dndManager={dndManager}
                    fileFilterMode={activeResourceSection.key}
                    resourceMode
                    autoHeight
                    onFileSelect={onFileOpen}
                    onFileDoubleClick={onFileOpen}
                  />
                </div>
              </div>
            )}

            {activeSection === 'plans' && (
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                <div className="rounded-xl bg-white/70 px-4 py-4 text-sm text-[#6e7278]">
                  Plans will live here.
                </div>
              </div>
            )}

          </section>

          {shouldShowChats && (
            <div className="shrink-0 border-t border-[#ecebe6] px-1 pt-3">
              <button
                type="button"
                onClick={onNewChat}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-[#e0dfda] bg-white text-sm font-semibold text-[#3f4247] shadow-[0_8px_28px_rgba(0,0,0,0.06)] transition-all duration-200 ease-out hover:-translate-y-px hover:bg-[#fbfbfa] hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
                title="New chat"
              >
                <PencilLine className="h-4 w-4 text-[#6f7379]" />
                New chat
                <span className="rounded-lg bg-[#f0efed] px-1.5 py-0.5 text-xs font-semibold text-[#8a8e94]">
                  Cmd N
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-transparent"
        onPointerDown={onResizeStart}
        title="Resize sidebar"
      />
    </aside>
  );
}
