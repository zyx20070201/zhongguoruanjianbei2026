import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import WorkspaceListPage from './pages/WorkspaceListPage';
import WorkspaceDetailPage from './pages/WorkspaceDetailPage';
import WorkbenchPage from './pages/WorkbenchPage';
import { ThemeProvider } from './theme';
import { AppPreferencesProvider } from './appPreferences';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: '/', element: <LoginPage /> },
      { path: '/workspaces', element: <WorkspaceListPage /> },
      { path: '/workspaces/:id', element: <WorkspaceDetailPage /> },
      { path: '/workbenches/:id', element: <WorkbenchPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppPreferencesProvider>
        <RouterProvider router={router} />
      </AppPreferencesProvider>
    </ThemeProvider>
  </React.StrictMode>
);
