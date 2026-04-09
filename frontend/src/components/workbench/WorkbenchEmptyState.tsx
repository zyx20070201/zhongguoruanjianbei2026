import React from 'react';
import { FileText, BookOpen, Sparkles, Code, LayoutTemplate, Plus } from 'lucide-react';

interface WorkbenchEmptyStateProps {
  onAddPanel: (type: string) => void;
  onUseTemplate: () => void;
  onAskAI: () => void;
}

export default function WorkbenchEmptyState({ onAddPanel, onUseTemplate, onAskAI }: WorkbenchEmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50/50 p-8">
      <div className="max-w-2xl w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-blue-100 shadow-sm">
          <LayoutTemplate className="w-8 h-8 text-blue-600" />
        </div>
        
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Build this workbench for your task</h2>
        <p className="text-gray-500 mb-8 max-w-lg mx-auto">
          This workbench stores layout, references and task context, not duplicated content. Panels will reference files from the workspace file system.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 text-left">
          <button 
            onClick={() => onAddPanel('resource')}
            className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
          >
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg group-hover:bg-blue-200 transition-colors">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 mb-1">Add Resource Panel</h3>
              <p className="text-xs text-gray-500">View PDFs, videos, or images</p>
            </div>
          </button>
          
          <button 
            onClick={() => onAddPanel('notes')}
            className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-yellow-300 hover:bg-yellow-50/50 transition-all group"
          >
            <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg group-hover:bg-yellow-200 transition-colors">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 mb-1">Add Notes Panel</h3>
              <p className="text-xs text-gray-500">Edit markdown notes</p>
            </div>
          </button>
          
          <button 
            onClick={() => onAddPanel('code')}
            className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-green-300 hover:bg-green-50/50 transition-all group"
          >
            <div className="p-2 bg-green-100 text-green-600 rounded-lg group-hover:bg-green-200 transition-colors">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 mb-1">Add Code Panel</h3>
              <p className="text-xs text-gray-500">Write and run code</p>
            </div>
          </button>
          
          <button 
            onClick={() => onAddPanel('ai-assistant')}
            className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50/50 transition-all group"
          >
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg group-hover:bg-purple-200 transition-colors">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 mb-1">Add AI Assistant</h3>
              <p className="text-xs text-gray-500">Local AI helper for this task</p>
            </div>
          </button>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6 border-t border-gray-100">
          <button 
            onClick={onUseTemplate}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors"
          >
            <LayoutTemplate className="w-4 h-4" /> Use Layout Template
          </button>
          <button 
            onClick={onAskAI}
            className="flex items-center gap-2 px-5 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium rounded-lg border border-purple-200 transition-colors"
          >
            <Sparkles className="w-4 h-4" /> Ask AI to Suggest Layout
          </button>
        </div>
      </div>
    </div>
  );
}
