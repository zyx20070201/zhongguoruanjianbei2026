import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm h-14 flex items-center px-4 shrink-0">
        <h1 className="text-xl font-semibold text-gray-800">AI Learning Workspace</h1>
      </header>
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
