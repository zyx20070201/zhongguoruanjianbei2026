import { ArrowLeft, PencilLine, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface WorkbenchTopBarProps {
  workspaceId: string;
  title: string;
  onRename: () => void;
  onOpenSettings: () => void;
}

export default function WorkbenchTopBar({
  workspaceId,
  title,
  onRename,
  onOpenSettings
}: WorkbenchTopBarProps) {
  const navigate = useNavigate();

  return (
    <header className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex h-16 items-start justify-between px-4 py-2 text-[#34373c]">
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        <button
          onClick={() => navigate(`/workspaces/${workspaceId}`)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#777a80] transition-all duration-200 hover:bg-[#ececea] hover:text-[#202124] active:scale-95"
          title="Back to workspace"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div
          className="max-w-[360px] truncate rounded-lg px-2.5 py-1 text-[15px] font-semibold tracking-[-0.01em] text-[#25272b]"
          title={title}
        >
          {title}
        </div>
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
