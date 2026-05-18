import { Outlet, useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

export default function Layout() {
  const location = useLocation();
  const isWorkbenchRoute = location.pathname.startsWith('/workbenches/');
  const isWorkspaceDetailRoute = /^\/workspaces\/[^/]+$/.test(location.pathname);
  const isKnowledgeGraphRoute = /^\/workspaces\/[^/]+\/knowledge-graph$/.test(location.pathname);
  const isStandaloneRoute = location.pathname === '/' || location.pathname === '/workspaces';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      {!isWorkbenchRoute && !isWorkspaceDetailRoute && !isKnowledgeGraphRoute && !isStandaloneRoute && (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] px-4 backdrop-blur">
          <h1 className="text-xl font-semibold text-[var(--app-text)]">AI Learning Workspace</h1>
          <ThemeToggle />
        </header>
      )}
      <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
