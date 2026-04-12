import React from 'react';
import { WorkspaceCardData } from '../../types';

interface WorkspaceCardProps {
  data: WorkspaceCardData;
  onClick: (id: string) => void;
  onEdit: (e: React.MouseEvent, id: string) => void;
  onDuplicate: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}

export default function WorkspaceCard({ data, onClick, onEdit, onDuplicate, onDelete }: WorkspaceCardProps) {
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div 
      className="border border-gray-200 bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col group"
      onClick={() => onClick(data.id)}
    >
      <div className="p-6 flex-1">
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-medium border border-blue-100">
                {data.major}
              </span>
            </div>
            <h3 className="text-xl font-bold text-gray-800 line-clamp-1 group-hover:text-blue-600 transition-colors">{data.courseName}</h3>
          </div>
          
          <div className="relative">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}></div>
                <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-100 py-1 z-20">
                  <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => onClick(data.id)}>Open</button>
                  <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={(e) => { setShowMenu(false); onEdit(e, data.id); }}>Edit Info</button>
                  <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={(e) => { setShowMenu(false); onDuplicate(e, data.id); }}>Duplicate</button>
                  <div className="h-px bg-gray-100 my-1"></div>
                  <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50" onClick={(e) => { setShowMenu(false); onDelete(e, data.id); }}>Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
        
        <p className="text-gray-600 text-sm mb-4 line-clamp-2 h-10">{data.description || 'No description provided.'}</p>
        
        <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            <span className="font-medium text-gray-700">{data.workbenchCount}</span> Workbenches
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span className="font-medium text-gray-700">{data.fileCount}</span> Files
          </div>
        </div>

        {data.recentTask && (
          <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100/50">
            <p className="text-xs text-blue-600/80 uppercase font-bold tracking-wider mb-1">Recent Activity</p>
            <p className="text-sm text-gray-700 font-medium truncate">{data.recentTask}</p>
            {data.recentLearningState && <p className="text-xs text-gray-500 mt-1">{data.recentLearningState}</p>}
          </div>
        )}
      </div>
      
      <div className="bg-gray-50 p-4 border-t border-gray-100 flex flex-col gap-3">
        <div className="flex justify-between items-center text-xs text-gray-500 mb-1">
          <span>Last used {data.updatedAt}</span>
        </div>
        
        <div className="flex items-center justify-end gap-2">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onClick(data.id);
            }}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md font-medium transition-colors"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
