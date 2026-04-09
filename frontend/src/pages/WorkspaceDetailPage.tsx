import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { workspaceApi } from '../api/client';
import { Workspace, WorkspaceOverview, WorkbenchItem } from '../types';

import WorkspaceHeader from '../components/workspace/WorkspaceHeader';
import { FileSystemSidebar } from '../components/workspace/FileSystemSidebar';
import { fileSystemApi } from '../services/fileSystemApi';
import WorkspaceOverviewCard from '../components/workspace/WorkspaceOverviewCard';
import WorkbenchSection from '../components/workspace/WorkbenchSection';
import AITerminalDrawer from '../components/workspace/AITerminalDrawer';
import WorkspaceSettingsDialog from '../components/workspace/WorkspaceSettingsDialog';

export default function WorkspaceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);

  useEffect(() => {
    fetchWorkspace();
  }, [id]);

  const fetchWorkspace = async () => {
    try {
      if (!id) return;
      setLoading(true);
      const res = await api.get(`/workspaces/${id}`);
      setWorkspace(res.data.workspace);
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
      const res = await api.post('/workbenches', {
        name: 'New Task Workbench',
        workspaceId: id
      });
      navigate(`/workbenches/${res.data.workbench.id}`);
    } catch (e) {
      console.error(e);
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
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Convert raw data to UI models
  const mockOverview: WorkspaceOverview = {
    id: workspace.id,
    courseName: workspace.name,
    description: workspace.description || '',
    major: workspace.major || 'General',
    updatedAt: new Date(workspace.updatedAt).toLocaleDateString(),
    status: 'active',
    workbenchCount: workspace.workbenches?.length || 0,
    fileCount: workspace.fileObjects?.length || 0,
    recentActivity: 'Created workspace',
    suggestedNextStep: workspace.fileObjects?.length ? 'Create a study workbench' : 'Upload initial course materials'
  };

  const mockWorkbenches: WorkbenchItem[] = (workspace.workbenches || []).map((wb, i) => ({
    id: wb.id,
    name: wb.name,
    type: ['study', 'notes', 'lab', 'review'][i % 4] as any, // Mock type assignment
    updatedAt: new Date(wb.updatedAt || new Date()).toLocaleDateString(),
    linkedResourceCount: Math.floor(Math.random() * 5),
    panelCount: wb.panels?.length || 0,
    recentActivity: i === 0 ? 'Edited 2 hours ago' : undefined
  }));

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <WorkspaceHeader 
        courseName={workspace.name}
        major={workspace.major || 'Course'}
        updatedAt={new Date(workspace.updatedAt).toLocaleDateString()}
        onUpload={handleUpload}
        onNewWorkbench={createWorkbench}
        onToggleAI={() => setIsAIOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar: File System */}
        <FileSystemSidebar 
          workspaceId={id || ''}
          onFileDoubleClick={async (f) => {
            console.log('Opening file', f);
            
            // 1. Get or create a workbench
            let workbenchId = '';
            if (workspace.workbenches && workspace.workbenches.length > 0) {
              workbenchId = workspace.workbenches[0].id;
            } else {
              try {
                const res = await api.post('/workbenches', {
                  name: 'Default Workbench',
                  workspaceId: id
                });
                workbenchId = res.data.workbench.id;
              } catch (e) {
                console.error('Failed to create workbench', e);
                return;
              }
            }
            
            // 2. Map file category to panel type
            let panelType = 'file-preview-panel';
            if (f.fileCategory === 'note' || f.name.endsWith('.md') || f.name.endsWith('.txt')) {
              panelType = 'note-editor-panel';
            } else if (f.fileCategory === 'code' || f.name.match(/\.(js|ts|py|java|cpp|c)$/)) {
              panelType = 'code-editor-panel';
            }
            
            // 3. Create panel referencing this file object
            try {
              await api.post('/panels', {
                workbenchId,
                title: f.name,
                panelType,
                fileObjectId: f.id
              });
            } catch (e) {
              console.warn('Failed to add panel or panel already exists', e);
            }
            
            // 4. Navigate to workbench
            navigate(`/workbenches/${workbenchId}`);
          }}
        />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6 md:p-8">
            
            <WorkspaceOverviewCard 
              overview={mockOverview}
              onUploadMaterials={handleUpload}
              onCreateWorkbench={createWorkbench}
              onAskAI={() => setIsAIOpen(true)}
              onResumeTask={() => {
                if (workspace.workbenches && workspace.workbenches.length > 0) {
                  navigate(`/workbenches/${workspace.workbenches[0].id}`);
                } else {
                  createWorkbench();
                }
              }}
            />

            <WorkbenchSection 
              workbenches={mockWorkbenches}
              onCreateNew={createWorkbench}
            />
            
          </div>
        </main>
      </div>

      {/* Overlays */}
      <AITerminalDrawer 
        isOpen={isAIOpen}
        onClose={() => setIsAIOpen(false)}
        workspaceName={workspace.name}
      />

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
