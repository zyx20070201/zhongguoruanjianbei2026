import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspaceApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Workspace, WorkspaceCardData, WorkspaceStatus, ContinueLearningItem, CreateWorkspaceFormData } from '../types';

import DashboardHeader from '../components/dashboard/DashboardHeader';
import AICommandBar from '../components/dashboard/AICommandBar';
import ContinueLearningSection from '../components/dashboard/ContinueLearningSection';
import WorkspaceCard from '../components/dashboard/WorkspaceCard';
import CreateWorkspaceWizard from '../components/dashboard/CreateWorkspaceWizard';

export default function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Dashboard state
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('accessed');
  
  const user = useAuthStore(state => state.user);
  const navigate = useNavigate();

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
    if (user) {
      loadWorkspaces();
    } else {
      navigate('/');
    }
  }, [user, navigate]);

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
      
      // We could add logic here to create initial workbench based on initMode
      if (formData.initMode !== 'empty') {
        console.log('Would initialize with mode:', formData.initMode);
        // Toast or similar indication
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

  // Convert raw API Workspaces to UI card data
  const getCardData = (ws: Workspace): WorkspaceCardData => {
    return {
      id: ws.id,
      courseName: ws.name,
      description: ws.description,
      major: ws.major || 'General',
      updatedAt: new Date(ws.updatedAt).toLocaleDateString(),
      status: 'active', // Mock status
      workbenchCount: ws._count?.workbenches || 0,
      fileCount: Math.floor(Math.random() * 20), // Mock data
      noteCount: Math.floor(Math.random() * 10), // Mock data
      codeCount: Math.floor(Math.random() * 5),  // Mock data
      recentTask: ws._count?.workbenches ? `Latest Workbench` : undefined,
      recentLearningState: 'In Progress'
    };
  };

  // Mock continue learning items (could be derived from real data in a full implementation)
  const getMockContinueLearningItems = (): ContinueLearningItem[] => {
    if (workspaces.length === 0) return [];
    
    return workspaces.slice(0, 2).map((ws, i) => ({
      id: `cl-${i}`,
      workspaceId: ws.id,
      courseName: ws.name,
      taskName: `Phase ${i + 1} Review`,
      recentContent: i === 0 ? 'Last read: Chapter 4 Introduction' : 'Last edited: Lab assignment 2',
      updatedAt: '2 hours ago'
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
      // Status filter (mocking this as all workspaces are currently 'active' in our simple model)
      // In reality, this would use ws.status or similar
      return true;
    })
    .sort((a, b) => {
      // Sort logic
      if (sort === 'updated' || sort === 'accessed') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      if (sort === 'name') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 text-lg">Loading your learning space...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-gray-50">
      
      <DashboardHeader 
        searchTerm={searchTerm}
        currentFilter={filter}
        currentSort={sort}
        onSearch={setSearchTerm}
        onFilterChange={setFilter}
        onSortChange={setSort}
        onCreateNew={() => setIsWizardOpen(true)}
      />

      <AICommandBar />

      <ContinueLearningSection 
        items={getMockContinueLearningItems()}
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
            Import materials and let AI help organize your learning space tailored for your specific course needs.
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
            onClick={() => { setSearchTerm(''); setFilter('all'); }}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
          {processedWorkspaces.map(ws => (
            <WorkspaceCard 
              key={ws.id}
              data={getCardData(ws)}
              onClick={(id) => navigate(`/workspaces/${id}`)}
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
    </div>
  );
}
