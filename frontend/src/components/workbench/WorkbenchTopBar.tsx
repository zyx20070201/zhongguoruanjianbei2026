import {
  ArrowLeft,
  ChevronDown,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Settings2
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Workbench } from '../../types';

interface WorkbenchTopBarProps {
  workspaceId: string;
  title: string;
  onRename: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onSidebarPreviewStart?: () => void;
  onSidebarPreviewEnd?: () => void;
  isSidebarPinned: boolean;
  workbenches?: Workbench[];
}

export default function WorkbenchTopBar({
  workspaceId,
  title,
  onRename,
  onOpenSettings,
  onToggleSidebar,
  onSidebarPreviewStart,
  onSidebarPreviewEnd,
  isSidebarPinned,
  workbenches = []
}: WorkbenchTopBarProps) {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isMenuOpen]);

  return (
    <header className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex h-16 items-start justify-between px-4 py-2 text-[#34373c]">
      <div ref={menuRef} className="pointer-events-auto relative flex min-w-0 items-center gap-2">
        <button
          onClick={() => navigate(`/workspaces/${workspaceId}`)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#777a80] transition-all duration-200 hover:bg-[#ececea] hover:text-[#202124] active:scale-95"
          title="Back to workspace"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => setIsMenuOpen((value) => !value)}
          className="flex max-w-[360px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-[15px] font-semibold tracking-[-0.01em] text-[#25272b] transition-colors duration-200 hover:bg-[#ececea]"
          title="Switch workbench"
        >
          <span className="truncate">{title}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-[#96999d] transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={onToggleSidebar}
          onMouseEnter={onSidebarPreviewStart}
          onMouseLeave={onSidebarPreviewEnd}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 active:scale-95 ${
            isSidebarPinned
              ? 'bg-[#ececea] text-[#202124]'
              : 'text-[#777a80] hover:bg-[#ececea] hover:text-[#202124]'
          }`}
          title={isSidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'}
        >
          {isSidebarPinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>

        {isMenuOpen && (
          <div className="workspace-soft-scale absolute left-10 top-10 w-[340px] overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white p-2 shadow-[0_20px_60px_rgba(0,0,0,0.14)]">
            <div className="px-2 pb-2 pt-1 text-xs font-medium text-[#96999d]">Workbenches</div>
            <div className="max-h-[300px] overflow-y-auto">
              {workbenches.length === 0 ? (
                <div className="px-3 py-3 text-sm text-[#777a80]">Only this workbench is available.</div>
              ) : (
                workbenches.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setIsMenuOpen(false);
                      navigate(`/workbenches/${item.id}`);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                      item.title === title ? 'bg-[#f1f1ef]' : 'hover:bg-[#f6f6f4]'
                    }`}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-[#96999d]" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#25272b]">{item.title}</div>
                      <div className="truncate text-xs text-[#96999d]">
                        {item.panelCount ?? item.state?.editors?.length ?? 0} panels
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="mt-2 border-t border-[#eeeeeb] pt-2">
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  navigate(`/workspaces/${workspaceId}`);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-[#34373c] transition-colors duration-150 hover:bg-[#f6f6f4]"
              >
                <ArrowLeft className="h-4 w-4 text-[#96999d]" />
                Back to workspace
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <button
          onClick={onOpenSettings}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e5e5e1] bg-white text-[#777a80] shadow-sm transition-all duration-200 hover:border-[#d7d7d2] hover:bg-[#f6f6f4] hover:text-[#202124] active:scale-95"
          title="Workbench settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          onClick={onRename}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e5e5e1] bg-white text-[#777a80] shadow-sm transition-all duration-200 hover:border-[#d7d7d2] hover:bg-[#f6f6f4] hover:text-[#202124] active:scale-95"
          title="Rename workbench"
        >
          <PencilLine className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
