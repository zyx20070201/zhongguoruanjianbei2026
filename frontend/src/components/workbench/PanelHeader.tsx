import React from 'react';
import { X, MoreVertical, FileText, BookOpen, Sparkles, Code, LayoutTemplate, ExternalLink } from 'lucide-react';
import { PanelInstance } from '../../types';

interface PanelHeaderProps {
  panel: PanelInstance;
  onClose: () => void;
  onRemove: () => void;
  onReplaceReference: () => void;
}

export default function PanelHeader({ panel, onClose, onRemove, onReplaceReference }: PanelHeaderProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);

  const getIcon = () => {
    switch (panel.type) {
      case 'resource': return <BookOpen className="w-4 h-4 text-blue-500" />;
      case 'notes': return <FileText className="w-4 h-4 text-yellow-500" />;
      case 'code': return <Code className="w-4 h-4 text-green-500" />;
      case 'ai-assistant': return <Sparkles className="w-4 h-4 text-purple-500" />;
      case 'result': return <LayoutTemplate className="w-4 h-4 text-gray-500" />;
      default: return <FileText className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <div className="panel-header bg-gray-50 px-3 py-2 border-b border-gray-200 flex justify-between items-center cursor-move select-none group">
      <div className="flex items-center gap-2 overflow-hidden">
        {getIcon()}
        <span className="font-bold text-xs text-gray-700 truncate">{panel.title}</span>
        {panel.referencedFileId && (
          <span className="text-[10px] text-gray-400 truncate max-w-[150px] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
            {panel.referencedFileId}
          </span>
        )}
      </div>
      
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {panel.state?.saving && <span className="text-[10px] text-gray-400 mr-2">Saving...</span>}
        {panel.state?.saved && <span className="text-[10px] text-green-500 mr-2">Saved</span>}
        
        <div className="relative">
          <button 
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}></div>
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-100 py-1 z-20">
                {panel.type !== 'ai-assistant' && (
                  <>
                    <button className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onReplaceReference(); }}>
                      <ExternalLink className="w-3.5 h-3.5" /> Replace Reference
                    </button>
                    <button className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); alert('Mock: Open in File System'); }}>
                      <BookOpen className="w-3.5 h-3.5" /> Open in File System
                    </button>
                    <div className="h-px bg-gray-100 my-1"></div>
                  </>
                )}
                <button className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRemove(); }}>
                  Remove from Workbench
                </button>
              </div>
            </>
          )}
        </div>
        
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
