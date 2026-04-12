import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspaceApi } from '../api/client';
import { fileSystemApi } from '../services/fileSystemApi';
import { useAuthStore } from '../store/authStore';
import { Workspace, WorkspaceCardData, ContinueLearningItem, CreateWorkspaceFormData } from '../types';

import DashboardHeader from '../components/dashboard/DashboardHeader';
import ContinueLearningSection from '../components/dashboard/ContinueLearningSection';
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

  const getContinueLearningItems = (): ContinueLearningItem[] => {
    return [...workspaces]
      .sort((a, b) => new Date(getWorkspaceActivityTime(b)).getTime() - new Date(getWorkspaceActivityTime(a)).getTime())
      .slice(0, 3)
      .map((ws) => ({
        id: `cl-${ws.id}`,
        workspaceId: ws.id,
        courseName: ws.name,
        taskName: `Last used ${ws.name}`,
        recentContent: `${ws._count?.workbenches || 0} workbenches, ${ws._count?.fileObjects ?? ws.fileObjects?.length ?? 0} files`,
        updatedAt: formatActivityTime(getWorkspaceActivityTime(ws))
      }));
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
      <div className="flex h-screen items-center justify-center bg-[var(--app-bg)]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-lg text-[var(--app-muted)]">Loading your learning space...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl bg-[var(--app-bg)] p-8 text-[var(--app-text)]">
      
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

      <ContinueLearningSection 
        items={getContinueLearningItems()}
        onOpenWorkspace={(id) => navigate(`/workspaces/${id}`)}
      />

      <div className="mb-6 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-800">My Workspaces</h2>
        <span className="text-sm text-gray-500">{processedWorkspaces.length} courses</span>
      </div>

      {workspaces.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-500">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Create your first course workspace</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            Import materials and organize a learning space tailored for your specific course needs.
          </p>
          <button 
            onClick={() => setIsWizardOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors inline-flex items-center gap-2"
          >
            <span>+</span> New Workspace
          </button>
        </div>
      ) : processedWorkspaces.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
          <p className="text-gray-500 text-lg mb-4">No workspaces found matching your search.</p>
          <button 
            onClick={() => { setSearchTerm(''); }}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
          {processedWorkspaces.map(ws => (
            <WorkspaceCard 
              key={ws.id}
              data={getCardData(ws)}
              onClick={(id) => navigate(`/workspaces/${id}`)}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
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
            className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-lg p-6"
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-4">Edit workspace info</h2>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="workspace-name">
              Name
            </label>
            <input
              id="workspace-name"
              value={editForm.name}
              onChange={(e) => setEditForm(form => ({ ...form, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="workspace-major">
              Major
            </label>
            <input
              id="workspace-major"
              value={editForm.major}
              onChange={(e) => setEditForm(form => ({ ...form, major: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="workspace-description">
              Description
            </label>
            <textarea
              id="workspace-description"
              value={editForm.description}
              onChange={(e) => setEditForm(form => ({ ...form, description: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 mb-6 text-sm min-h-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingWorkspace(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
