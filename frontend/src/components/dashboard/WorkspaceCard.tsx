import React from 'react';
import { WorkspaceCardData } from '../../types';

interface WorkspaceCardProps {
  data: WorkspaceCardData;
  onClick: (id: string) => void;
  onEdit: (e: React.MouseEvent, id: string) => void;
  onDuplicate: (e: React.MouseEvent, id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  style?: React.CSSProperties;
}

export default function WorkspaceCard({ data, onClick, onEdit, onDuplicate, onDelete, style }: WorkspaceCardProps) {
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div 
      className="workspace-card workspace-list-item group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-[#deded9] bg-white shadow-sm transition hover:border-[#cfcfca] hover:shadow-[0_18px_44px_rgba(0,0,0,0.08)]"
      onClick={() => onClick(data.id)}
      style={style}
    >
      <div className="flex-1 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="line-clamp-1 text-lg font-semibold text-[#202124]">{data.courseName}</h3>
            <p className="mt-1 truncate text-xs text-[#96999d]">{data.major}</p>
          </div>
          
          <div className="relative">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="rounded-lg p-1 text-[#96999d] transition hover:bg-[#f1f1ef] hover:text-[#34373c]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}></div>
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-[#e2e2de] bg-white py-1 shadow-lg">
                  <button className="w-full px-4 py-2 text-left text-sm text-[#34373c] hover:bg-[#f6f6f4]" onClick={() => onClick(data.id)}>Open</button>
                  <button className="w-full px-4 py-2 text-left text-sm text-[#34373c] hover:bg-[#f6f6f4]" onClick={(e) => { setShowMenu(false); onEdit(e, data.id); }}>Edit</button>
                  <button className="w-full px-4 py-2 text-left text-sm text-[#34373c] hover:bg-[#f6f6f4]" onClick={(e) => { setShowMenu(false); onDuplicate(e, data.id); }}>Duplicate</button>
                  <div className="my-1 h-px bg-[#eeeeeb]"></div>
                  <button className="w-full px-4 py-2 text-left text-sm text-[#34373c] hover:bg-[#f6f6f4]" onClick={(e) => { setShowMenu(false); onDelete(e, data.id); }}>Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
        
        {data.description && <p className="mb-4 line-clamp-2 min-h-10 text-sm leading-5 text-[#666a70]">{data.description}</p>}
        
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[#777b80]">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            <span className="font-medium text-[#34373c]">{data.workbenchCount}</span> Workbenches
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span className="font-medium text-[#34373c]">{data.fileCount}</span> Files
          </div>
        </div>

        {data.recentTask && (
          <div className="rounded-xl border border-[#eeeeeb] bg-[#fbfbfa] p-3">
            <p className="truncate text-sm font-medium text-[#34373c]">{data.recentTask}</p>
            {data.recentLearningState && <p className="mt-1 text-xs text-[#8a8d91]">{data.recentLearningState}</p>}
          </div>
        )}
      </div>
      
      <div className="flex flex-col gap-3 border-t border-[#eeeeeb] bg-[#fbfbfa] p-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[#8a8d91]">
          <span>Last used {data.updatedAt}</span>
        </div>
        
      </div>
    </div>
  );
}
