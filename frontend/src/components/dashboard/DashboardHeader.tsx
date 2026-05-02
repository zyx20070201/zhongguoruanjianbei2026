import React from 'react';
import { LogOut, Plus, Search } from 'lucide-react';

interface DashboardHeaderProps {
  onSearch: (term: string) => void;
  onSortChange: (sort: string) => void;
  onCreateNew: () => void;
  onLogout: () => void;
  searchTerm: string;
  currentSort: string;
}

export default function DashboardHeader({ 
  onSearch, 
  onSortChange, 
  onCreateNew,
  onLogout,
  searchTerm,
  currentSort
}: DashboardHeaderProps) {
  return (
    <div className="workspace-hero mb-10 flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-normal text-[#202124]">Workspaces</h1>
      </div>

      <div className="flex w-full flex-col items-center gap-2 sm:flex-row md:w-auto">
        <div className="relative w-full sm:w-auto">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#96999d]">
            <Search className="h-4 w-4" />
          </div>
          <input
            type="text"
            className="h-10 w-full rounded-xl border border-[#deded9] bg-white py-2 pl-9 pr-4 text-sm text-[#202124] shadow-sm outline-none transition focus:border-[#c8c8c2] sm:w-56 md:w-64"
            placeholder="Search workspaces..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <div className="flex w-full sm:w-auto gap-2">
          <select 
            className="h-10 flex-1 rounded-xl border border-[#deded9] bg-white px-3 py-2 text-sm text-[#34373c] shadow-sm outline-none transition focus:border-[#c8c8c2] sm:w-auto"
            value={currentSort}
            onChange={(e) => onSortChange(e.target.value)}
          >
            <option value="accessed">Recently Accessed</option>
            <option value="updated">Updated Time</option>
            <option value="name">Course Name</option>
          </select>
        </div>

        <button 
          onClick={onCreateNew}
          className="workspace-nav-item flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#202124] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-black sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          New
        </button>

        <button
          onClick={onLogout}
          className="workspace-nav-item flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#deded9] bg-white px-3 text-sm font-medium text-[#34373c] shadow-sm transition hover:bg-[#f6f6f4] sm:w-auto"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </div>
  );
}
