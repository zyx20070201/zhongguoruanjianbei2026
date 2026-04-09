import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import WorkspaceListPage from './pages/WorkspaceListPage';
import WorkspaceDetailPage from './pages/WorkspaceDetailPage';
import WorkbenchPage from './pages/WorkbenchPage';

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
    <RouterProvider router={router} />
  </React.StrictMode>
);
