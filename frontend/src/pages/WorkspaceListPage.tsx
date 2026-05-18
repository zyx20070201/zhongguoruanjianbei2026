import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
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
      const data = await workspaceApi.getWorkspaces();
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
        major: ''
      });
      
      setIsWizardOpen(false);

      if (formData.resources.length > 0) {
        const uploadFolder = await fileSystemApi.createFolder(newWs.id, {
          name: 'uploaded resources',
          resourceRole: 'source',
          scope: 'workspace'
        });
        await fileSystemApi.upload(
          newWs.id,
          formData.resources,
          uploadFolder.id,
          uploadFolder.path,
          {
            resourceRole: 'source',
            resourceType: 'source',
            scope: 'workspace',
            origin: 'upload'
          }
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
        major: ''
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

    if (timestamps.length === 0) return ws.updatedAt || ws.createdAt || new Date().toISOString();

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
            void logout().then(() => navigate('/', { replace: true }));
          }}
        />

        <div className="workspace-page-enter mb-6 flex items-end gap-4" style={{ animationDelay: '70ms' }}>
          <h2 className="text-3xl font-semibold tracking-normal text-[#202124]">My workspaces</h2>
          <span className="pb-0.5 text-3xl font-semibold leading-none text-[#202124]">{processedWorkspaces.length}</span>
        </div>

      {workspaces.length === 0 ? (
        <div className="workspace-page-enter mx-auto max-w-xl rounded-[28px] border border-[#deded9] bg-white px-8 py-12 text-center shadow-[0_24px_70px_rgba(0,0,0,0.08)]" style={{ animationDelay: '140ms' }}>
          <h3 className="mb-6 text-2xl font-semibold text-[#202124]">Create your first workspace</h3>
          <button 
            onClick={() => setIsWizardOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#202124] px-5 py-3 text-sm font-medium text-white transition hover:bg-black"
          >
            <span>+</span> Create new workspace
          </button>
        </div>
      ) : processedWorkspaces.length === 0 ? (
        <div className="workspace-page-enter flex min-h-[420px] items-center justify-center rounded-3xl bg-[#f6f8fc] px-6 py-16 text-center" style={{ animationDelay: '140ms' }}>
          <div>
            <Search className="mx-auto mb-6 h-16 w-16 stroke-[1.8] text-[#3c4043]" />
            <h3 className="text-3xl font-normal text-[#202124]">No workspaces found</h3>
            <p className="mt-4 text-lg text-[#5f6368]">Try searching for a different course title, major, or description</p>
            <button
              onClick={() => { setSearchTerm(''); }}
              className="mt-8 rounded-full border border-[#d9dce1] bg-white px-7 py-3 text-base font-semibold text-[#202124] shadow-sm transition hover:bg-[#f6f7f8]"
            >
              Clear search
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 pb-12 md:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="workspace-page-enter workspace-list-item flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-[#e4e6eb] bg-white text-center shadow-sm transition hover:-translate-y-0.5 hover:border-[#d6dae3] hover:shadow-[0_18px_44px_rgba(60,64,67,0.08)]"
            style={{ animationDelay: '140ms' }}
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#f1f3f4] text-[#5f6368]">
              <Plus className="h-9 w-9" />
            </span>
            <span className="mt-5 text-xl font-semibold text-[#202124]">Create new workspace</span>
          </button>
          {processedWorkspaces.map((ws, index) => (
            <WorkspaceCard 
              key={ws.id}
              data={getCardData(ws)}
              onClick={(id) => navigate(`/workspaces/${id}`)}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              style={{ animationDelay: `${180 + index * 70}ms` }}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditingWorkspace(null)}
        >
          <form
            className="workspace-modal-enter w-full max-w-xl rounded-[22px] bg-[#fafafa] px-8 py-8 shadow-[0_28px_90px_rgba(60,64,67,0.24)]"
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-normal text-[#202124]">Edit workspace</h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingWorkspace(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#7d8188] transition hover:bg-[#f1f3f4] hover:text-[#3c4043]"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-10 space-y-7">
              <div className="relative">
                <input
                  id="workspace-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm(form => ({ ...form, name: e.target.value }))}
                  className="peer h-14 w-full rounded-[6px] border border-[#cfd4dc] bg-transparent px-4 text-base text-[#202124] outline-none transition-[border,box-shadow] duration-200 placeholder:text-transparent focus:border-[#1a73e8] focus:border-2"
                  placeholder="Workspace name"
                  required
                />
                <label className="pointer-events-none absolute -top-2 left-3 bg-[#fafafa] px-1 text-xs font-medium text-[#5f6368] transition-colors peer-focus:text-[#1a73e8]" htmlFor="workspace-name">
                  Workspace name *
                </label>
              </div>
              <div className="relative">
                <textarea
                  id="workspace-description"
                  value={editForm.description}
                  onChange={(e) => setEditForm(form => ({ ...form, description: e.target.value }))}
                  className="peer min-h-32 w-full resize-none rounded-[6px] border border-[#cfd4dc] bg-transparent px-4 py-4 text-sm leading-6 text-[#202124] outline-none transition-[border,box-shadow] duration-200 placeholder:text-transparent focus:border-[#1a73e8] focus:border-2"
                  placeholder="Description"
                />
                <label className="pointer-events-none absolute -top-2 left-3 bg-[#fafafa] px-1 text-xs font-medium text-[#5f6368] transition-colors peer-focus:text-[#1a73e8]" htmlFor="workspace-description">
                  Description
                </label>
              </div>
            </div>

            <div className="mt-10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingWorkspace(null)}
                className="rounded-full border border-[#d9dfe8] bg-white px-7 py-3 text-sm font-semibold text-[#202124] transition hover:bg-[#f6f7f8]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex h-12 items-center gap-2 rounded-full bg-[#4357ff] px-7 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3347f4]"
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
