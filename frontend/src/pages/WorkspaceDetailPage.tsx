import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { workspaceApi } from '../api/client';
import { Workspace, WorkspaceOverview, Workbench, WorkbenchItem } from '../types';

import WorkspaceHeader from '../components/workspace/WorkspaceHeader';
import { FileSystemSidebar } from '../components/workspace/FileSystemSidebar';
import { fileSystemApi } from '../services/fileSystemApi';
import WorkspaceOverviewCard from '../components/workspace/WorkspaceOverviewCard';
import WorkbenchSection from '../components/workspace/WorkbenchSection';
import WorkspaceSettingsDialog from '../components/workspace/WorkspaceSettingsDialog';
import { workbenchApi } from '../services/workbenchApi';
import { useAuthStore } from '../store/authStore';

export default function WorkspaceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workbenches, setWorkbenches] = useState<Workbench[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);
  const hydrate = useAuthStore((state) => state.hydrate);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;

    if (user === null) {
      navigate('/', { replace: true });
    }
  }, [hydrated, navigate, user]);

  useEffect(() => {
    fetchWorkspace();
  }, [id]);

  const fetchWorkspace = async () => {
    try {
      if (!id) return;
      setLoading(true);
      const res = await api.get(`/workspaces/${id}`);
      setWorkspace(res.data.workspace);
      setWorkbenches(await workbenchApi.listByWorkspace(id));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async (data: any) => {
    if (!id) return;
    try {
      const updated = await workspaceApi.updateWorkspace(id, data);
      setWorkspace(prev => prev ? { ...prev, ...updated } : updated as Workspace);
      setIsSettingsOpen(false);
    } catch (error) {
      console.error('Failed to update workspace:', error);
    }
  };

  const createWorkbench = async () => {
    if (!id) return;
    try {
      const workbench = await workbenchApi.create({
        title: 'New Task Workbench',
        description: 'Persisted task desktop for this learning objective.',
        workspaceId: id
      });
      await fetchWorkspace();
      navigate(`/workbenches/${workbench.id}`);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteWorkbench = async (workbenchId: string) => {
    if (!confirm('Delete this workbench? Its saved panels, layout and notes will be removed.')) {
      return;
    }

    try {
      await workbenchApi.delete(workbenchId);
      await fetchWorkspace();
    } catch (error) {
      console.error('Failed to delete workbench:', error);
    }
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0 && id) {
        try {
          await fileSystemApi.upload(id, Array.from(files));
        } catch (error) {
          console.error('Failed to upload files:', error);
        }
      }
    };
    input.click();
  };

  if (loading || !workspace) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--app-bg)]">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const formatActivityTime = (value?: string) => {
    if (!value) return 'never';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown';

    const diffMs = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) return 'just now';
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} min ago`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)} hours ago`;
    if (diffMs < day * 7) return `${Math.floor(diffMs / day)} days ago`;

    return date.toLocaleDateString();
  };

  // Convert raw data to UI models
  const latestWorkbench = workbenches[0];
  const overview: WorkspaceOverview = {
    id: workspace.id,
    courseName: workspace.name,
    description: workspace.description || '',
    major: workspace.major || 'General',
    updatedAt: formatActivityTime(workspace.updatedAt),
    workbenchCount: workbenches.length,
    fileCount: workspace.fileObjects?.length || 0,
    recentActivity: latestWorkbench
      ? `Workbench updated ${formatActivityTime(latestWorkbench.updatedAt)}`
      : `Workspace updated ${formatActivityTime(workspace.updatedAt)}`
  };

  const workbenchItems: WorkbenchItem[] = workbenches.map((wb) => ({
    id: wb.id,
    title: wb.title,
    updatedAt: formatActivityTime(wb.updatedAt),
    panelCount: wb.panelCount || wb.state?.editors.length || wb.state?.panels?.length || 0,
    description: wb.description
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--app-bg)] text-[var(--app-text)]">
      <WorkspaceHeader 
        courseName={workspace.name}
        major={workspace.major || 'Course'}
        updatedAt={new Date(workspace.updatedAt).toLocaleDateString()}
        onUpload={handleUpload}
        onNewWorkbench={createWorkbench}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={() => {
          logout();
          navigate('/', { replace: true });
        }}
      />
      
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar: File System */}
        <FileSystemSidebar 
          workspaceId={id || ''}
          onFileDoubleClick={async (f) => {
            if (!id) return;
            console.log('Opening file', f);
            
            let workbenchId = '';
            if (workbenches.length > 0) {
              workbenchId = workbenches[0].id;
            } else {
              try {
                const workbench = await workbenchApi.create({
                  title: 'Default Workbench',
                  description: 'Auto-created from the workspace resource explorer.',
                  workspaceId: id
                });
                workbenchId = workbench.id;
                await fetchWorkspace();
              } catch (e) {
                console.error('Failed to create workbench', e);
                return;
              }
            }

            navigate(`/workbenches/${workbenchId}?resourceId=${encodeURIComponent(f.id)}`);
          }}
        />

        {/* Main Content Area */}
        <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg-elevated)]">
          <div className="mx-auto max-w-5xl p-6 md:p-8">
            
            <WorkspaceOverviewCard 
              overview={overview}
              onUploadMaterials={handleUpload}
              onCreateWorkbench={createWorkbench}
              onResumeTask={() => {
                if (workbenches.length > 0) {
                  navigate(`/workbenches/${workbenches[0].id}`);
                } else {
                  createWorkbench();
                }
              }}
            />

            <WorkbenchSection 
              workbenches={workbenchItems}
              onCreateNew={createWorkbench}
              onDelete={deleteWorkbench}
            />
            
          </div>
        </main>
      </div>

      {/* Overlays */}
      <WorkspaceSettingsDialog 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialData={{
          name: workspace.name,
          description: workspace.description || '',
          major: workspace.major || ''
        }}
        onSave={handleUpdateSettings}
      />
    </div>
  );
}
