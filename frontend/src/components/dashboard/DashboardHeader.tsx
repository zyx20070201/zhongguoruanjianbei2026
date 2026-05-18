import React from 'react';
import { ChevronDown, LogOut, Plus, Search, Settings2, X } from 'lucide-react';

interface DashboardHeaderProps {
  onSearch: (term: string) => void;
  onSortChange: (sort: string) => void;
  onCreateNew: () => void;
  onLogout: () => void;
  searchTerm: string;
  currentSort: string;
}

export default function DashboardHeader({ 
  onSearch, 
  onSortChange, 
  onCreateNew,
  onLogout,
  searchTerm,
  currentSort
}: DashboardHeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = React.useState(Boolean(searchTerm));
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (searchTerm) setIsSearchOpen(true);
  }, [searchTerm]);

  React.useEffect(() => {
    if (!isSearchOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && searchRef.current?.contains(target)) return;
      setIsSearchOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isSearchOpen]);

  return (
    <div className="workspace-hero workspace-page-enter mb-8 flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-normal text-[#202124]">Workspaces</h1>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
        {isSearchOpen ? (
          <div ref={searchRef} className="workspace-search-open relative h-11 w-full sm:w-[320px]">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[#777b80]">
              <Search className="h-4 w-4" />
            </div>
            <input
              type="text"
              className="h-11 w-full rounded-full border border-[#d9dce1] bg-white py-2 pl-11 pr-10 text-sm text-[#202124] shadow-sm outline-none transition-[border,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:border-[#9aa0a6] focus:shadow-[0_8px_26px_rgba(60,64,67,0.10)]"
              placeholder="Search workspaces"
              value={searchTerm}
              autoFocus
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  onSearch('');
                  setIsSearchOpen(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                onSearch('');
                setIsSearchOpen(false);
              }}
              className="absolute inset-y-0 right-2 my-auto flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4]"
              title="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#d9dce1] bg-white text-[#3c4043] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03] hover:bg-[#f6f7f8] hover:shadow-[0_10px_28px_rgba(60,64,67,0.10)] active:scale-[0.98]"
            title="Search workspaces"
          >
            <Search className="h-5 w-5" />
          </button>
        )}

        <div className="flex h-11 items-center overflow-hidden rounded-full border border-[#d9dce1] bg-white p-1 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:shadow-[0_10px_28px_rgba(60,64,67,0.08)]">
          <label className="relative flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-[#34373c]">
            <select
              className="absolute inset-0 cursor-pointer opacity-0"
              value={currentSort}
              onChange={(e) => onSortChange(e.target.value)}
              title="Sort workspaces"
            >
              <option value="accessed">Most recent</option>
              <option value="updated">Updated time</option>
              <option value="name">Course name</option>
            </select>
            <span>
              {currentSort === 'name' ? 'Course name' : currentSort === 'updated' ? 'Updated time' : 'Most recent'}
            </span>
            <ChevronDown className="h-4 w-4 text-[#5f6368]" />
          </label>
        </div>

        <button 
          onClick={onCreateNew}
          className="workspace-nav-item flex h-11 items-center justify-center gap-2 rounded-full bg-[#202124] px-5 text-sm font-semibold text-white shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.02] hover:bg-black hover:shadow-[0_12px_30px_rgba(32,33,36,0.18)] active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create new
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsSettingsOpen((value) => !value)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[#d9dce1] bg-white text-[#3c4043] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03] hover:bg-[#f6f7f8] hover:shadow-[0_10px_28px_rgba(60,64,67,0.10)] active:scale-[0.98]"
            title="Settings"
          >
            <Settings2 className="h-5 w-5" />
          </button>
          {isSettingsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsSettingsOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-2xl border border-[#e1e3e7] bg-white py-2 shadow-[0_18px_44px_rgba(60,64,67,0.18)]">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsSettingsOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-[#3c4043] transition hover:bg-[#f6f7f8]"
                >
                  <LogOut className="h-4 w-4 text-[#6f7379]" />
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
