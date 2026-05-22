import React from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Plus, Search, Settings, X } from 'lucide-react';
import { WorkspaceCardData } from '../../types';
import { getWorkspaceEmoji } from './WorkspaceCard';

interface DashboardHeaderProps {
  onSearch: (term: string) => void;
  onCreateNew: () => void;
  onLogout: () => void;
  onOpenWorkspace: (id: string) => void;
  searchTerm: string;
  searchResults: WorkspaceCardData[];
}

export default function DashboardHeader({ 
  onSearch, 
  onCreateNew,
  onLogout,
  onOpenWorkspace,
  searchTerm,
  searchResults
}: DashboardHeaderProps) {
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLDivElement | null>(null);
  const searchPanelRef = React.useRef<HTMLDivElement | null>(null);
  const [searchPanelPosition, setSearchPanelPosition] = React.useState<{ top: number; right: number }>({ top: 0, right: 16 });

  const updateSearchPanelPosition = React.useCallback(() => {
    const rect = searchRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSearchPanelPosition({
      top: rect.bottom + 8,
      right: Math.max(16, window.innerWidth - rect.right)
    });
  }, []);

  React.useEffect(() => {
    if (!isSearchOpen) return;
    updateSearchPanelPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && searchRef.current?.contains(target)) return;
      if (target && searchPanelRef.current?.contains(target)) return;
      setIsSearchOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSearchOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateSearchPanelPosition);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateSearchPanelPosition);
    };
  }, [isSearchOpen, updateSearchPanelPosition]);

  const searchPanel = isSearchOpen
    ? createPortal(
        <div
          ref={searchPanelRef}
          className="fixed z-[9999] w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-xl border border-[#e3e1db] bg-white shadow-[0_22px_70px_rgba(32,33,36,0.18)] animate-[workspace-menu-enter_120ms_cubic-bezier(0.16,1,0.3,1)_both]"
          style={{ top: searchPanelPosition.top, right: searchPanelPosition.right }}
        >
          <div className="relative border-b border-[#eeeeeb] bg-white p-3">
            <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-[#96999d]" />
            <input
              type="text"
              className="h-10 w-full rounded-lg bg-[#f7f7f5] py-2 pl-9 pr-9 text-sm text-[#202124] outline-none"
              placeholder="搜索课程名称或描述"
              value={searchTerm}
              autoFocus
              onChange={(e) => onSearch(e.target.value)}
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => onSearch('')}
                className="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#777b80] transition hover:bg-[#eeeeeb] hover:text-[#202124]"
                title="清空搜索"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="max-h-[420px] overflow-y-auto bg-white p-2">
            {searchResults.length ? (
              searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(false);
                    onOpenWorkspace(item.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f6f6f4]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#f1f1ef] text-lg">
                    {getWorkspaceEmoji(`${item.courseName} ${item.description || ''}`)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[#202124]">{item.courseName}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#8a8d91]">{item.description || item.recentWorkbench || '课程空间'}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-sm text-[#85898f]">
                {searchTerm.trim() ? '没有找到课程' : '输入课程名称或描述进行搜索'}
              </div>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="workspace-hero workspace-page-enter mb-8 flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-normal text-[#202124]">课程空间</h1>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
        <div ref={searchRef} className="relative">
          <button
            type="button"
            onClick={() => {
              updateSearchPanelPosition();
              setIsSearchOpen((value) => !value);
            }}
            className={`flex h-10 items-center overflow-hidden rounded-full border border-[#e2e2dd] bg-white text-[#666a70] transition-all duration-200 hover:bg-[#f6f6f4] hover:text-[#202124] ${
              isSearchOpen ? 'w-[280px] justify-start px-3' : 'w-10 justify-center p-0'
            }`}
            title="搜索课程"
          >
            <Search className="h-4 w-4 shrink-0 stroke-[2]" />
            {isSearchOpen ? <span className="ml-2 min-w-0 flex-1 text-left text-sm opacity-100">搜索课程</span> : null}
          </button>
        </div>

        <button 
          onClick={onCreateNew}
          className="workspace-nav-item flex h-10 items-center justify-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-black active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          新建课程
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsSettingsOpen((value) => !value)}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
            title="设置"
          >
            <Settings className="h-4 w-4" />
            设置
          </button>
          {isSettingsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsSettingsOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-[#e5e5df] bg-white p-1.5 shadow-[0_18px_44px_rgba(60,64,67,0.16)]">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsSettingsOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-[#3c4043] transition hover:bg-[#f6f6f4]"
                >
                  <LogOut className="h-4 w-4 text-[#6f7379]" />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {searchPanel}
    </div>
  );
}
