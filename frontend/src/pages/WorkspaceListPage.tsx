import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { workspaceApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Workspace, WorkspaceCardData } from '../types';

import DashboardHeader from '../components/dashboard/DashboardHeader';
import WorkspaceCard, { getWorkspaceEmoji } from '../components/dashboard/WorkspaceCard';

export default function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [editPanelPosition, setEditPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Dashboard state
  const [searchTerm, setSearchTerm] = useState('');
  
  const user = useAuthStore(state => state.user);
  const hydrated = useAuthStore(state => state.hydrated);
  const hydrate = useAuthStore(state => state.hydrate);
  const logout = useAuthStore(state => state.logout);
  const navigate = useNavigate();
  const inlineCreateInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (isCreatingInline) {
      window.setTimeout(() => inlineCreateInputRef.current?.focus(), 0);
    }
  }, [isCreatingInline]);

  useEffect(() => {
    if (editingWorkspace) {
      window.setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [editingWorkspace]);

  const loadWorkspaces = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await workspaceApi.getWorkspaces();
      setWorkspaces(data);
    } catch (error) {
      console.error('加载课程空间失败:', error);
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

  const startInlineCreate = () => {
    setIsCreatingInline(true);
    setNewCourseName('');
  };

  const cancelInlineCreate = () => {
    setIsCreatingInline(false);
    setNewCourseName('');
  };

  const submitInlineCreate = async () => {
    const title = newCourseName.trim();
    if (!title || !user) return;

    try {
      const newWs = await workspaceApi.createWorkspace({
        name: title,
        description: '',
        major: ''
      });
      setIsCreatingInline(false);
      setNewCourseName('');
      await loadWorkspaces();
      navigate(`/workspaces/${newWs.id}`);
    } catch (error) {
      console.error('创建课程空间失败', error);
      alert('创建课程空间失败，请查看控制台详情。');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const workspace = workspaces.find(ws => ws.id === id);
    if (!workspace) return;
    setDeletingWorkspace(workspace);
  };

  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await workspaceApi.duplicateWorkspace(id);
      loadWorkspaces();
    } catch (error) {
      console.error('复制课程空间失败', error);
    }
  };

  const confirmDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;

    try {
      await workspaceApi.deleteWorkspace(deletingWorkspace.id);
      setDeletingWorkspace(null);
      await loadWorkspaces();
    } catch (error) {
      console.error('删除课程空间失败', error);
    }
  };

  const handleEdit = (e: React.MouseEvent, id: string, rect: DOMRect) => {
    e.stopPropagation();
    const workspace = workspaces.find(ws => ws.id === id);
    if (!workspace) return;

    const panelWidth = 520;
    const margin = 16;
    const left = Math.min(Math.max(rect.left, margin), window.innerWidth - panelWidth - margin);
    const top = Math.min(Math.max(rect.top + 18, margin), window.innerHeight - 220);

    setEditingWorkspace(workspace);
    setEditPanelPosition({ left, top });
    setEditForm({
      name: workspace.name,
      description: workspace.description || ''
    });
  };

  const handleSaveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace || !editForm.name.trim()) return;

    try {
      await workspaceApi.updateWorkspace(editingWorkspace.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        major: ''
      });
      setEditingWorkspace(null);
      setEditPanelPosition(null);
      await loadWorkspaces();
    } catch (error) {
      console.error('重命名课程空间失败', error);
      alert('重命名课程空间失败，请查看控制台详情。');
    }
  };

  const formatActivityTime = (value?: string) => {
    if (!value) return '暂无记录';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未知时间';

    const diffMs = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) return '刚刚';
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
    if (diffMs < day * 7) return `${Math.floor(diffMs / day)} 天前`;

    return date.toLocaleDateString('zh-CN');
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
      major: ws.major || '通用课程',
      updatedAt: formatActivityTime(getWorkspaceActivityTime(ws)),
      status: 'active',
      taskCount: ws._count?.workbenches || 0,
      workbenchCount: ws._count?.workbenches || 0,
      fileCount,
      noteCount: 0,
      codeCount: 0,
      recentTask: latestWorkbench ? `最近任务：${latestWorkbench.title}` : undefined,
      recentWorkbench: latestWorkbench ? `最近 workbench：${latestWorkbench.title}` : undefined,
      recentLearningState: latestFile ? `最近资料：${latestFile.name}` : undefined
    };
  };

  const workspaceCards = workspaces
    .sort((a, b) => new Date(getWorkspaceActivityTime(b)).getTime() - new Date(getWorkspaceActivityTime(a)).getTime());

  const searchResults = workspaces
    .filter(ws => {
      if (searchTerm && !ws.name.toLowerCase().includes(searchTerm.toLowerCase()) && 
          !(ws.description && ws.description.toLowerCase().includes(searchTerm.toLowerCase()))) {
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(getWorkspaceActivityTime(b)).getTime() - new Date(getWorkspaceActivityTime(a)).getTime())
    .map(getCardData);

  const inlineCreateForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitInlineCreate();
      }}
      className="workspace-page-enter flex min-h-[220px] flex-col rounded-xl border border-[#d8d8d3] bg-[#fffefa] p-5 text-left shadow-[0_14px_34px_rgba(32,33,36,0.06)]"
      style={{ animationDelay: '40ms' }}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#f6f6f4] text-3xl">📚</div>
      <input
        ref={inlineCreateInputRef}
        value={newCourseName}
        onChange={(event) => setNewCourseName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelInlineCreate();
          }
        }}
        className="mt-4 w-full rounded-md bg-transparent text-lg font-semibold leading-tight text-[#202124] outline-none ring-0 placeholder:text-[#b3b3af] focus:bg-[#f7f7f5] focus:px-2"
        placeholder="课程名称"
      />
      <p className="mt-2 text-sm leading-5 text-[#777b80]">按 Enter 创建，Esc 取消。</p>
      <div className="mt-auto flex items-center gap-2 pt-5">
        <button
          type="submit"
          disabled={!newCourseName.trim()}
          className="h-8 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-[#d6d6d1]"
        >
          创建
        </button>
        <button
          type="button"
          onClick={cancelInlineCreate}
          className="h-8 rounded-lg px-2.5 text-sm font-medium text-[#666a70] transition hover:bg-[#f1f1ef] hover:text-[#202124]"
        >
          取消
        </button>
      </div>
    </form>
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fbfbfa]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#e2e2de] border-t-[#202124]"></div>
          <p className="text-sm text-[#777b80]">正在加载课程空间...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-shell min-h-screen bg-[#fbfbfa] p-6 text-[#202124] md:p-8">
      <div className="mx-auto max-w-7xl">
      
        <DashboardHeader
          searchTerm={searchTerm}
          searchResults={searchResults}
          onSearch={setSearchTerm}
          onCreateNew={startInlineCreate}
          onOpenWorkspace={(workspaceId) => navigate(`/workspaces/${workspaceId}`)}
          onLogout={() => {
            void logout().then(() => navigate('/', { replace: true }));
          }}
        />

        <div className="workspace-page-enter mb-5 flex items-center gap-2 text-sm text-[#777b80]" style={{ animationDelay: '70ms' }}>
          <span>共 {workspaces.length} 门课程</span>
      </div>

      {workspaces.length === 0 ? (
        isCreatingInline ? (
          <div className="mx-auto max-w-xl">
            {inlineCreateForm}
          </div>
        ) : (
          <div className="workspace-page-enter mx-auto max-w-xl rounded-xl border border-dashed border-[#d8d8d3] bg-white px-8 py-12 text-center" style={{ animationDelay: '140ms' }}>
            <h3 className="mb-2 text-xl font-semibold text-[#202124]">创建你的第一门课程</h3>
            <p className="mb-6 text-sm text-[#777b80]">这里会像文件夹一样收纳课程资料和学习现场。</p>
            <button 
              onClick={startInlineCreate}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-black"
            >
              <span>+</span> 新建课程
            </button>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 pb-12 md:grid-cols-2 lg:grid-cols-3">
          {isCreatingInline ? (
            <div className="workspace-list-item">
              {inlineCreateForm}
            </div>
          ) : (
            <button
              type="button"
              onClick={startInlineCreate}
              className="workspace-page-enter workspace-list-item flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#d8d8d3] bg-white text-center transition hover:-translate-y-0.5 hover:border-[#cfcfca] hover:bg-[#fffefa] hover:shadow-[0_14px_34px_rgba(32,33,36,0.06)]"
              style={{ animationDelay: '140ms' }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#f6f6f4] text-[#777b80]">
                <Plus className="h-5 w-5" />
              </span>
              <span className="mt-4 text-base font-semibold text-[#202124]">新建课程</span>
              <span className="mt-1 text-sm text-[#777b80]">添加一个新的课程空间</span>
            </button>
          )}
          {workspaceCards.map((ws, index) => (
            <WorkspaceCard 
              key={ws.id}
              data={getCardData(ws)}
              onClick={(id) => navigate(`/workspaces/${id}`)}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              editedBy={user?.username}
              style={{ animationDelay: `${180 + index * 70}ms` }}
            />
          ))}
        </div>
      )}

      {editingWorkspace && editPanelPosition && (
        <div
          className="fixed inset-0 z-50 bg-transparent"
          onClick={() => {
            setEditingWorkspace(null);
            setEditPanelPosition(null);
          }}
        >
          <form
            className="workspace-modal-enter fixed flex w-[min(520px,calc(100vw-32px))] flex-col gap-3 rounded-xl border border-[#e5e5df] bg-white p-3 shadow-[0_22px_70px_rgba(32,33,36,0.18)]"
            style={{ left: editPanelPosition.left, top: editPanelPosition.top }}
            onSubmit={handleSaveRename}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#f7f7f5] text-2xl">
                {getWorkspaceEmoji(`${editingWorkspace.name} ${editingWorkspace.description || ''}`)}
              </div>
              <input
                ref={renameInputRef}
                value={editForm.name}
                onChange={(e) => setEditForm(form => ({ ...form, name: e.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditingWorkspace(null);
                    setEditPanelPosition(null);
                  }
                }}
                className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-2 text-xl font-semibold text-[#202124] outline-none selection:bg-[#dce8ff] focus:bg-[#f7f7f5]"
                placeholder="课程名称"
                required
              />
              <button
                type="button"
                onClick={() => {
                  setEditingWorkspace(null);
                  setEditPanelPosition(null);
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#777b80] transition hover:bg-[#f1f1ef] hover:text-[#202124]"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm(form => ({ ...form, description: e.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditingWorkspace(null);
                  setEditPanelPosition(null);
                }
              }}
              className="min-h-20 resize-none rounded-lg bg-[#f7f7f5] px-3 py-2 text-sm leading-6 text-[#34373c] outline-none placeholder:text-[#a6a6a0]"
              placeholder="添加课程描述"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingWorkspace(null);
                  setEditPanelPosition(null);
                }}
                className="h-8 rounded-lg px-2.5 text-sm font-medium text-[#666a70] transition hover:bg-[#f1f1ef] hover:text-[#202124]"
              >
                取消
              </button>
              <button
                type="submit"
                className="h-8 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {deletingWorkspace && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#202124]/12 p-4"
          onClick={() => setDeletingWorkspace(null)}
        >
          <div
            className="workspace-modal-enter w-full max-w-md rounded-xl border border-[#e5e5df] bg-white p-6 shadow-[0_26px_80px_rgba(32,33,36,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-semibold text-[#202124]">删除课程</h2>
            <p className="mt-4 text-sm leading-6 text-[#5f6368]">
              确定要删除“{deletingWorkspace.name}”吗？删除后将无法恢复。
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingWorkspace(null)}
                className="h-9 rounded-lg px-3 text-sm font-medium text-[#666a70] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteWorkspace()}
                className="h-9 rounded-lg px-4 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
              >
                删除课程
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
