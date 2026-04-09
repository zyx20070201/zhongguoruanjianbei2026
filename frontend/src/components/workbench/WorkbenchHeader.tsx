import React, { useState } from 'react';
import { ArrowLeft, Plus, LayoutTemplate, Save, MoreHorizontal, BookOpen, FileText, FlaskConical, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WorkbenchType } from '../../types';

interface WorkbenchHeaderProps {
  workspaceId: string;
  workbenchName: string;
  workbenchType: WorkbenchType;
  updatedAt: string;
  onAddPanel: () => void;
  onLayoutTemplate: () => void;
  onSaveLayout: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function WorkbenchHeader({
  workspaceId,
  workbenchName,
  workbenchType,
  updatedAt,
  onAddPanel,
  onLayoutTemplate,
  onSaveLayout,
  onRename,
  onDuplicate,
  onDelete
}: WorkbenchHeaderProps) {
  const navigate = useNavigate();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const getTypeIcon = (type: WorkbenchType) => {
    switch (type) {
      case 'study': return <BookOpen className="w-4 h-4 text-blue-500" />;
      case 'notes': return <FileText className="w-4 h-4 text-yellow-500" />;
      case 'lab': return <FlaskConical className="w-4 h-4 text-green-500" />;
      case 'review': return <Target className="w-4 h-4 text-purple-500" />;
      default: return <BookOpen className="w-4 h-4 text-gray-500" />;
    }
  };

  const getTypeStyle = (type: WorkbenchType) => {
    switch (type) {
      case 'study': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'notes': return 'bg-yellow-50 text-yellow-700 border-yellow-100';
      case 'lab': return 'bg-green-50 text-green-700 border-green-100';
      case 'review': return 'bg-purple-50 text-purple-700 border-purple-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between sticky top-0 z-30 shadow-sm">
      <div className="flex items-center gap-3">
        <button 
          onClick={() => navigate(`/workspaces/${workspaceId}`)}
          className="p-1.5 hover:bg-gray-100 rounded-md text-gray-500 transition-colors"
          title="Back to Workspace"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="h-6 w-px bg-gray-200 mx-1"></div>
        
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-800">{workbenchName}</h1>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-bold uppercase tracking-wider ${getTypeStyle(workbenchType)}`}>
            {getTypeIcon(workbenchType)}
            {workbenchType}
          </div>
          <span className="text-xs text-gray-400 ml-2">Updated {updatedAt}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={onAddPanel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add Panel</span>
        </button>
        
        <button 
          onClick={onLayoutTemplate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
        >
          <LayoutTemplate className="w-4 h-4" />
          <span className="hidden sm:inline">Templates</span>
        </button>

        <div className="w-px h-5 bg-gray-200 mx-1"></div>

        <button 
          onClick={onSaveLayout}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
        >
          <Save className="w-4 h-4" />
          <span>Save Layout</span>
        </button>

        <div className="relative">
          <button 
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          
          {moreMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)}></div>
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-100 py-1 z-20">
                <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => { setMoreMenuOpen(false); onRename(); }}>Rename Workbench</button>
                <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => { setMoreMenuOpen(false); onDuplicate(); }}>Duplicate Workbench</button>
                <div className="h-px bg-gray-100 my-1"></div>
                <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50" onClick={() => { setMoreMenuOpen(false); onDelete(); }}>Delete Workbench</button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
