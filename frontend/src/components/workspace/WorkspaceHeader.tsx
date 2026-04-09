import React from 'react';
import { ArrowLeft, Upload, Plus, Sparkles, Settings, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface WorkspaceHeaderProps {
  courseName: string;
  major: string;
  updatedAt: string;
  onUpload: () => void;
  onNewWorkbench: () => void;
  onToggleAI: () => void;
  onOpenSettings: () => void;
}

export default function WorkspaceHeader({
  courseName,
  major,
  updatedAt,
  onUpload,
  onNewWorkbench,
  onToggleAI,
  onOpenSettings
}: WorkspaceHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/workspaces')}
          className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="h-8 w-px bg-gray-200 mx-1"></div>
        
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900">{courseName}</h1>
            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-medium rounded border border-blue-100">
              {major}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
            Updated {updatedAt}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={onUpload}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">Upload</span>
        </button>
        
        <button 
          onClick={onNewWorkbench}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Workbench</span>
        </button>

        <div className="w-px h-6 bg-gray-200 mx-1"></div>

        <button 
          onClick={onToggleAI}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg shadow-sm transition-all"
        >
          <Sparkles className="w-4 h-4" />
          <span>AI Terminal</span>
        </button>

        <button 
          onClick={onOpenSettings}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          title="Workspace Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
        
        <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
