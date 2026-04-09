import React from 'react';

interface DashboardHeaderProps {
  onSearch: (term: string) => void;
  onFilterChange: (filter: string) => void;
  onSortChange: (sort: string) => void;
  onCreateNew: () => void;
  searchTerm: string;
  currentFilter: string;
  currentSort: string;
}

export default function DashboardHeader({ 
  onSearch, 
  onFilterChange, 
  onSortChange, 
  onCreateNew,
  searchTerm,
  currentFilter,
  currentSort
}: DashboardHeaderProps) {
  return (
    <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Learning Dashboard</h1>
        <p className="text-gray-500 mt-1 text-sm md:text-base">Manage courses, tasks, files and AI workflows</p>
      </div>

      <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3 items-center">
        <div className="relative w-full sm:w-auto">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
          <input
            type="text"
            className="pl-9 pr-4 py-2 w-full sm:w-48 md:w-64 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm transition-all"
            placeholder="Search workspaces..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <div className="flex w-full sm:w-auto gap-2">
          <select 
            className="flex-1 sm:w-auto border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
            value={currentFilter}
            onChange={(e) => onFilterChange(e.target.value)}
          >
            <option value="all">All</option>
            <option value="recent">Recent</option>
            <option value="in-progress">In Progress</option>
            <option value="archived">Archived</option>
          </select>

          <select 
            className="flex-1 sm:w-auto border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
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
          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
          New Workspace
        </button>
      </div>
    </div>
  );
}
