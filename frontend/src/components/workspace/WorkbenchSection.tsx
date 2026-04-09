import React, { useState } from 'react';
import { WorkbenchItem } from '../../types';
import { Plus, MoreVertical, Play, BookOpen, FileText, FlaskConical, Target, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';

interface WorkbenchSectionProps {
  workbenches: WorkbenchItem[];
  onCreateNew: () => void;
}

export default function WorkbenchSection({ workbenches, onCreateNew }: WorkbenchSectionProps) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'study': return <BookOpen className="w-4 h-4 text-blue-500" />;
      case 'notes': return <FileText className="w-4 h-4 text-yellow-500" />;
      case 'lab': return <FlaskConical className="w-4 h-4 text-green-500" />;
      case 'review': return <Target className="w-4 h-4 text-purple-500" />;
      default: return <BookOpen className="w-4 h-4 text-gray-500" />;
    }
  };

  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'study': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'notes': return 'bg-yellow-50 text-yellow-700 border-yellow-100';
      case 'lab': return 'bg-green-50 text-green-700 border-green-100';
      case 'review': return 'bg-purple-50 text-purple-700 border-purple-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Workbenches</h3>
          <p className="text-sm text-gray-500">Task-oriented workspaces for this course</p>
        </div>
        
        <div className="relative">
          <div className="flex rounded-lg shadow-sm">
            <button 
              onClick={onCreateNew}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-l-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              New Workbench
            </button>
            <button 
              onClick={() => setCreateMenuOpen(!createMenuOpen)}
              className="bg-blue-700 hover:bg-blue-800 text-white px-2 py-2 rounded-r-lg border-l border-blue-800 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          
          {createMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setCreateMenuOpen(false)}></div>
              <div className="absolute right-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-20">
                <button className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2" onClick={() => {setCreateMenuOpen(false); onCreateNew();}}>
                  <Plus className="w-4 h-4 text-gray-400" /> Empty Workbench
                </button>
                <button className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2" onClick={() => {setCreateMenuOpen(false); alert('Mock: Create from selected files');}}>
                  <FileText className="w-4 h-4 text-gray-400" /> From Selected Files
                </button>
                <div className="h-px bg-gray-100 my-1"></div>
                <button className="w-full text-left px-4 py-2.5 text-sm text-purple-600 hover:bg-purple-50 flex items-center gap-2" onClick={() => {setCreateMenuOpen(false); alert('Mock: Ask AI to suggest workbench');}}>
                  <span className="text-lg">✨</span> Ask AI to Suggest
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {workbenches.length === 0 ? (
        <div className="py-12 px-6 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 text-center">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100">
            <BookOpen className="w-6 h-6 text-gray-400" />
          </div>
          <h4 className="text-gray-900 font-medium mb-1">No workbenches yet</h4>
          <p className="text-gray-500 text-sm mb-4">Create your first task-oriented workspace to start learning.</p>
          <button 
            onClick={onCreateNew}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Create Workbench
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workbenches.map(wb => (
            <div key={wb.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all group flex flex-col">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-gray-50 rounded-md border border-gray-100">
                    {getTypeIcon(wb.type)}
                  </div>
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${getTypeStyle(wb.type)}`}>
                    {wb.type}
                  </span>
                </div>
                <button className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
              
              <h4 className="font-bold text-gray-900 text-lg mb-1 group-hover:text-blue-600 transition-colors">{wb.name}</h4>
              <p className="text-xs text-gray-500 mb-4 flex-1">
                Updated {wb.updatedAt}
              </p>
              
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                <span>{wb.linkedResourceCount} Resources</span>
                <span>{wb.panelCount} Panels</span>
              </div>
              
              {wb.recentActivity && (
                <div className="bg-gray-50 rounded p-2 mb-4 text-xs text-gray-600 border border-gray-100 line-clamp-1">
                  {wb.recentActivity}
                </div>
              )}
              
              <Link 
                to={`/workbenches/${wb.id}`}
                className="mt-auto w-full flex items-center justify-center gap-1.5 py-2 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 text-sm font-medium rounded-lg border border-gray-200 hover:border-blue-200 transition-colors"
              >
                <Play className="w-4 h-4" /> Open Workbench
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
