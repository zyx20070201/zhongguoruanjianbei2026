import React from 'react';
import { LogOut } from 'lucide-react';

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
    <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--app-text)]">Learning Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)] md:text-base">Manage courses, tasks and files</p>
      </div>

      <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3 items-center">
        <div className="relative w-full sm:w-auto">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--app-muted)]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
          <input
            type="text"
            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-strong)] py-2 pl-9 pr-4 text-sm text-[var(--app-text)] outline-none transition-all focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent-soft)] sm:w-48 md:w-64"
            placeholder="Search workspaces..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <div className="flex w-full sm:w-auto gap-2">
          <select 
            className="flex-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-strong)] px-3 py-2 text-sm text-[var(--app-text)] outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)] sm:w-auto"
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
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--app-accent)] px-5 py-2 font-medium text-white shadow-sm transition-colors hover:brightness-110 sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
          New Workspace
        </button>

        <button
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-strong)] px-4 py-2 font-medium text-[var(--app-text)] transition-colors hover:bg-[var(--app-hover)] sm:w-auto"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </div>
  );
}
