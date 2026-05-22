import React from 'react';
import { WorkspaceOverview } from '../../types';
import { Upload, Plus, PlayCircle, Folder } from 'lucide-react';

interface WorkspaceOverviewCardProps {
  overview: WorkspaceOverview;
  onUploadMaterials: () => void;
  onCreateWorkbench: () => void;
  onResumeTask: () => void;
}

export default function WorkspaceOverviewCard({
  overview,
  onUploadMaterials,
  onCreateWorkbench,
  onResumeTask
}: WorkspaceOverviewCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 overflow-hidden">
      <div className="p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">{overview.courseName}</h2>
            </div>
            
            <p className="text-gray-600 text-sm mb-4 max-w-2xl">
              {overview.description || 'No description provided for this course workspace.'}
            </p>
            
            <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-6">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded bg-blue-50 text-blue-600 flex items-center justify-center">
                  <PlayCircle className="w-3.5 h-3.5" />
                </div>
                <span className="font-medium text-gray-700">{overview.workbenchCount}</span> Workbenches
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded bg-gray-100 text-gray-600 flex items-center justify-center">
                  <Folder className="w-3.5 h-3.5" />
                </div>
                <span className="font-medium text-gray-700">{overview.fileCount}</span> Files
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">•</span>
                <span>Updated {overview.updatedAt}</span>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-sm">
                {overview.recentActivity && (
                  <div className="flex-1">
                    <span className="text-gray-500 mr-2">Last activity:</span>
                    <span className="font-medium text-gray-800">{overview.recentActivity}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-2 min-w-[200px]">
            <button 
              onClick={onResumeTask}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Resume Recent Task
            </button>
            <button 
              onClick={onCreateWorkbench}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg border border-gray-200 transition-colors"
            >
              <Plus className="w-4 h-4 text-gray-400" /> Create Workbench
            </button>
            <button 
              onClick={onUploadMaterials}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg border border-gray-200 transition-colors"
            >
              <Upload className="w-4 h-4 text-gray-400" /> Upload Materials
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}