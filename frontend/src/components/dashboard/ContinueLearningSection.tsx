import React from 'react';
import { ContinueLearningItem } from '../../types';

interface ContinueLearningSectionProps {
  items: ContinueLearningItem[];
  onOpenWorkspace: (workspaceId: string) => void;
}

export default function ContinueLearningSection({ items, onOpenWorkspace }: ContinueLearningSectionProps) {
  if (!items || items.length === 0) {
    return (
      <div className="mb-10">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Continue Learning</h2>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-500 mb-2">No recent activity yet</p>
          <p className="text-sm text-gray-400">Open a workspace or create your first one to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-10">
      <h2 className="text-xl font-bold text-gray-800 mb-4">Continue Learning</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <div 
            key={item.id}
            className="group bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
            onClick={() => onOpenWorkspace(item.workspaceId)}
          >
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
            
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-medium px-2 py-1 bg-blue-50 text-blue-700 rounded-md">
                {item.courseName}
              </span>
              <span className="text-xs text-gray-400">{item.updatedAt}</span>
            </div>
            
            <h3 className="font-bold text-gray-800 mb-1 group-hover:text-blue-600 transition-colors">
              {item.taskName}
            </h3>
            
            <p className="text-sm text-gray-500 line-clamp-2 mb-4">
              {item.recentContent}
            </p>
            
            <div className="flex items-center text-sm font-medium text-blue-600">
              Resume 
              <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
