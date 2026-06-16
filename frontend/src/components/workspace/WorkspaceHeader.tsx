import React from 'react';
import { ArrowLeft, Upload, Plus, Settings, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface WorkspaceHeaderProps {
  courseName: string;
  major: string;
  updatedAt: string;
  onUpload: () => void;
  onNewWorkbench: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export default function WorkspaceHeader({
  courseName,
  major,
  updatedAt,
  onUpload,
  onNewWorkbench,
  onOpenSettings,
  onLogout
}: WorkspaceHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/workspaces')}
          className="rounded-full p-2 text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)]"
          title="返回控制台"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="mx-1 h-8 w-px bg-[var(--app-border)]"></div>
        
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-[var(--app-text)]">{courseName}</h1>
            <span className="rounded border border-[var(--app-border)] bg-[var(--app-accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--app-accent)]">
              {major}
            </span>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--app-muted)]">
            更新于 {updatedAt}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={onUpload}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--app-text)] transition-colors hover:bg-[var(--app-hover)]"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">上传</span>
        </button>
        
        <button 
          onClick={onNewWorkbench}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--app-text)] transition-colors hover:bg-[var(--app-hover)]"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">新建 Workbench</span>
        </button>

        <button 
          onClick={onOpenSettings}
          className="rounded-lg p-2 text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)]"
          title="Workspace 设置"
        >
          <Settings className="w-5 h-5" />
        </button>
        
        <button
          onClick={onLogout}
          className="rounded-lg p-2 text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)]"
          title="退出登录"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
