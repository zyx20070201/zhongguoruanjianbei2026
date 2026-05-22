import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import WorkspaceShellPage from './pages/WorkspaceShellPage';
import KnowledgeGraphPage from './pages/KnowledgeGraphPage';
import WorkbenchPage from './pages/WorkbenchPage';
import { ThemeProvider } from './theme';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: '/', element: <LoginPage /> },
      {
        element: <ProtectedRoute />,
        children: [
          { path: '/workspaces', element: <WorkspaceShellPage /> },
          { path: '/workspaces/:id', element: <WorkspaceShellPage /> },
          { path: '/workspaces/:id/knowledge-graph', element: <KnowledgeGraphPage /> },
          { path: '/workbenches/:id', element: <WorkbenchPage /> }
        ]
      }
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>
);
