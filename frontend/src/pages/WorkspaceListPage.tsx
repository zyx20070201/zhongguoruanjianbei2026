import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspaceApi } from '../api/client';
import { fileSystemApi } from '../services/fileSystemApi';
import { useAuthStore } from '../store/authStore';
import { Workspace, WorkspaceCardData, CreateWorkspaceFormData } from '../types';

import DashboardHeader from '../components/dashboard/DashboardHeader';
import WorkspaceCard from '../components/dashboard/WorkspaceCard';
import CreateWorkspaceWizard from '../components/dashboard/CreateWorkspaceWizard';

export default function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', major: '' });
  const [loading, setLoading] = useState(true);
  
  // Dashboard state
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState('accessed');
  
  const user = useAuthStore(state => state.user);
  const hydrated = useAuthStore(state => state.hydrated);
  const hydrate = useAuthStore(state => state.hydrate);
  const logout = useAuthStore(state => state.logout);
  const navigate = useNavigate();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const loadWorkspaces = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await workspaceApi.getWorkspaces(user.id);
      setWorkspaces(data);
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hydrated) return;

    if (user) {
      loadWorkspaces();
    } else {
      navigate('/', { replace: true });
    }
  }, [hydrated, user, navigate]);

  const handleCreateWorkspace = async (formData: CreateWorkspaceFormData) => {
    if (!user) return;
    try {
      // In a real implementation, we would send more details from formData
      // For now, we adapt to the existing API
      const newWs = await workspaceApi.createWorkspace({
        name: formData.courseName,
        description: formData.description || '',
        major: formData.major,
        userId: user.id,
      });
      
      setIsWizardOpen(false);

      if (formData.resources.length > 0) {
        const uploadFolder = await fileSystemApi.createFolder(newWs.id, {
          name: 'uploaded resources'
        });
        await fileSystemApi.upload(
          newWs.id,
          formData.resources,
          uploadFolder.id,
          uploadFolder.path
        );
      }

      await loadWorkspaces();
      
      // Navigate to the newly created workspace
      // navigate(`/workspaces/${newWs.id}`);
    } catch (error) {
      console.error('Failed to create workspace', error);
      alert('Failed to create workspace. See console for details.');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this workspace? This action cannot be undone.')) {
      try {
        await workspaceApi.deleteWorkspace(id);
        loadWorkspaces();
      } catch (error) {
        console.error('Failed to delete workspace', error);
      }
    }
  };

  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await workspaceApi.duplicateWorkspace(id);
      loadWorkspaces();
    } catch (error) {
      console.error('Failed to duplicate workspace', error);
    }
  };

  const handleEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const workspace = workspaces.find(ws => ws.id === id);
    if (!workspace) return;

    setEditingWorkspace(workspace);
    setEditForm({
      name: workspace.name,
      description: workspace.description || '',
      major: workspace.major || ''
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace || !editForm.name.trim()) return;

    try {
      await workspaceApi.updateWorkspace(editingWorkspace.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        major: editForm.major.trim()
      });
      setEditingWorkspace(null);
      await loadWorkspaces();
    } catch (error) {
      console.error('Failed to update workspace', error);
      alert('Failed to update workspace. See console for details.');
    }
  };

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

  const getWorkspaceActivityTime = (ws: Workspace) => {
    const timestamps = [
      ws.updatedAt,
      ...(ws.workbenches || []).map(item => item.updatedAt || ''),
      ...(ws.fileObjects || []).map(item => item.updatedAt)
    ]
      .map(value => new Date(value).getTime())
      .filter(value => !Number.isNaN(value));

    return new Date(Math.max(...timestamps)).toISOString();
  };

  // Convert raw API Workspaces to UI card data
  const getCardData = (ws: Workspace): WorkspaceCardData => {
    const latestWorkbench = ws.workbenches?.[0];
    const latestFile = ws.fileObjects?.[0];
    const fileCount = ws._count?.fileObjects ?? ws.fileObjects?.length ?? 0;

    return {
      id: ws.id,
      courseName: ws.name,
      description: ws.description,
      major: ws.major || 'General',
      updatedAt: formatActivityTime(getWorkspaceActivityTime(ws)),
      status: 'active',
      workbenchCount: ws._count?.workbenches || 0,
      fileCount,
      noteCount: 0,
      codeCount: 0,
      recentTask: latestWorkbench ? `Latest workbench: ${latestWorkbench.title}` : undefined,
      recentLearningState: latestFile ? `Latest file: ${latestFile.name}` : undefined
    };
  };

  // Filter and sort workspaces
  const processedWorkspaces = workspaces
    .filter(ws => {
      // Search filter
      if (searchTerm && !ws.name.toLowerCase().includes(searchTerm.toLowerCase()) && 
          !(ws.description && ws.description.toLowerCase().includes(searchTerm.toLowerCase()))) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Sort logic
      if (sort === 'accessed') {
        return new Date(getWorkspaceActivityTime(b)).getTime() - new Date(getWorkspaceActivityTime(a)).getTime();
      }
      if (sort === 'updated') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      if (sort === 'name') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fbfbfa]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#e2e2de] border-t-[#202124]"></div>
          <p className="text-sm text-[#777b80]">Loading workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-shell min-h-screen bg-[#fbfbfa] p-6 text-[#202124] md:p-8">
      <div className="mx-auto max-w-7xl">
      
      <DashboardHeader 
        searchTerm={searchTerm}
        currentSort={sort}
        onSearch={setSearchTerm}
        onSortChange={setSort}
        onCreateNew={() => setIsWizardOpen(true)}
        onLogout={() => {
          logout();
          navigate('/', { replace: true });
        }}
      />

      <div className="workspace-card mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#34373c]">Recent</h2>
        <span className="text-sm text-[#8a8d91]">{processedWorkspaces.length}</span>
      </div>

      {workspaces.length === 0 ? (
        <div className="workspace-composer mx-auto max-w-xl rounded-[28px] border border-[#deded9] bg-white px-8 py-12 text-center shadow-[0_24px_70px_rgba(0,0,0,0.08)]">
          <h3 className="mb-6 text-2xl font-semibold text-[#202124]">Create your first workspace</h3>
          <button 
            onClick={() => setIsWizardOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#202124] px-5 py-3 text-sm font-medium text-white transition hover:bg-black"
          >
            <span>+</span> New workspace
          </button>
        </div>
      ) : processedWorkspaces.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#deded9] bg-white py-12 text-center">
          <p className="mb-4 text-[#777b80]">No matching workspaces.</p>
          <button 
            onClick={() => { setSearchTerm(''); }}
            className="font-medium text-[#202124] hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 pb-12 md:grid-cols-2 lg:grid-cols-3">
          {processedWorkspaces.map((ws, index) => (
            <WorkspaceCard 
              key={ws.id}
              data={getCardData(ws)}
              onClick={(id) => navigate(`/workspaces/${id}`)}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              style={{ animationDelay: `${index * 60}ms` }}
            />
          ))}
        </div>
      )}

      <CreateWorkspaceWizard 
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onSubmit={handleCreateWorkspace}
      />

      {editingWorkspace && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => setEditingWorkspace(null)}
        >
          <form
          className="workspace-composer w-full max-w-lg rounded-[24px] border border-[#deded9] bg-white p-6 shadow-xl"
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-[#202124]">Edit workspace</h2>
            <label className="mb-1 block text-sm font-medium text-[#34373c]" htmlFor="workspace-name">
              Name
            </label>
            <input
              id="workspace-name"
              value={editForm.name}
              onChange={(e) => setEditForm(form => ({ ...form, name: e.target.value }))}
              className="mb-4 w-full rounded-xl border border-[#deded9] px-3 py-2 text-sm outline-none focus:border-[#c8c8c2]"
              required
            />
            <label className="mb-1 block text-sm font-medium text-[#34373c]" htmlFor="workspace-major">
              Major
            </label>
            <input
              id="workspace-major"
              value={editForm.major}
              onChange={(e) => setEditForm(form => ({ ...form, major: e.target.value }))}
              className="mb-4 w-full rounded-xl border border-[#deded9] px-3 py-2 text-sm outline-none focus:border-[#c8c8c2]"
            />
            <label className="mb-1 block text-sm font-medium text-[#34373c]" htmlFor="workspace-description">
              Description
            </label>
            <textarea
              id="workspace-description"
              value={editForm.description}
              onChange={(e) => setEditForm(form => ({ ...form, description: e.target.value }))}
              className="mb-6 min-h-28 w-full rounded-xl border border-[#deded9] px-3 py-2 text-sm outline-none focus:border-[#c8c8c2]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingWorkspace(null)}
                className="rounded-xl border border-[#deded9] px-4 py-2 text-sm text-[#34373c] hover:bg-[#f6f6f4]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#202124] px-4 py-2 text-sm text-white hover:bg-black"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
      </div>
    </div>
  );
}
