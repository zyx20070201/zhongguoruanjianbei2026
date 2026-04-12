import { ArrowLeft, PencilLine, Search, Settings2, SplitSquareVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface WorkbenchTopBarProps {
  workspaceId: string;
  title: string;
  onRename: () => void;
  onOpenSettings: () => void;
  panelCount?: number;
}

export default function WorkbenchTopBar({
  workspaceId,
  title,
  onRename,
  onOpenSettings,
  panelCount = 0
}: WorkbenchTopBarProps) {
  const navigate = useNavigate();

  return (
    <header className="grid h-9 grid-cols-[auto_1fr_auto] items-center border-b border-[var(--wb-border)] bg-[var(--wb-titlebar)] px-2 text-[var(--wb-text-muted)]">
      <div className="flex items-center gap-1">
        <button
          onClick={() => navigate(`/workspaces/${workspaceId}`)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--wb-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--wb-text)]"
          title="Back to workspace"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-3">
        <div className="truncate text-xs font-medium uppercase tracking-[0.18em] text-[var(--wb-text-dim)]">
          Pp1 Workbench
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-3 py-1 text-xs text-[var(--wb-text-muted)]">
          <Search className="h-3.5 w-3.5" />
          <span className="max-w-[280px] truncate">{title}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 justify-self-end">
        <div className="hidden items-center gap-1 rounded px-2 py-1 text-xs text-[var(--wb-text-dim)] md:flex">
          <SplitSquareVertical className="h-3.5 w-3.5" />
          <span>{panelCount} tabs</span>
        </div>
        <button
          onClick={onOpenSettings}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--wb-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--wb-text)]"
          title="Workbench settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          onClick={onRename}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--wb-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--wb-text)]"
          title="Rename workbench"
        >
          <PencilLine className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
