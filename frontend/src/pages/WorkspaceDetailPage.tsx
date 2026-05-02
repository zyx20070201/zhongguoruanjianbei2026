import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import api, { workspaceApi } from '../api/client';
import { LearningTerminalMessage, Workspace, WorkspaceOverview, Workbench, WorkbenchItem } from '../types';

import { FileSystemSidebar } from '../components/workspace/FileSystemSidebar';
import { fileSystemApi } from '../services/fileSystemApi';
import WorkspaceSettingsDialog from '../components/workspace/WorkspaceSettingsDialog';
import { workbenchApi } from '../services/workbenchApi';
import { useAuthStore } from '../store/authStore';
import LearningTerminal from '../components/workspace/LearningTerminal';
import {
  ArrowLeft,
  FolderTree,
  PencilLine,
  Plus,
  Search,
  Settings,
  Upload,
  Workflow
} from 'lucide-react';

interface WorkspaceChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: LearningTerminalMessage[];
}

export default function WorkspaceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workbenches, setWorkbenches] = useState<Workbench[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFilesPanelOpen, setIsFilesPanelOpen] = useState(true);
  const [chatSessions, setChatSessions] = useState<WorkspaceChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  
  // UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);
  const hydrate = useAuthStore((state) => state.hydrate);

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

  useEffect(() => {
    if (!id) return;

    const storageKey = `workspace:${id}:chats`;
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? JSON.parse(stored) as WorkspaceChatSession[] : [];
    const initialChats = parsed.length > 0
      ? parsed
      : [{
          id: crypto.randomUUID(),
          title: 'New chat',
          updatedAt: new Date().toISOString(),
          messages: []
        }];

    setChatSessions(initialChats);
    setCurrentChatId(initialChats[0]?.id || null);
  }, [id]);

  useEffect(() => {
    if (!id || chatSessions.length === 0) return;

    localStorage.setItem(`workspace:${id}:chats`, JSON.stringify(chatSessions));
  }, [chatSessions, id]);

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

  const createChat = () => {
    const nextChat: WorkspaceChatSession = {
      id: crypto.randomUUID(),
      title: 'New chat',
      updatedAt: new Date().toISOString(),
      messages: []
    };
    setChatSessions((sessions) => [nextChat, ...sessions]);
    setCurrentChatId(nextChat.id);
  };

  const deleteChat = (chatId: string) => {
    setChatSessions((sessions) => {
      const remaining = sessions.filter((session) => session.id !== chatId);
      const nextSessions = remaining.length > 0
        ? remaining
        : [{
            id: crypto.randomUUID(),
            title: 'New chat',
            updatedAt: new Date().toISOString(),
            messages: []
          }];

      if (currentChatId === chatId) {
        setCurrentChatId(nextSessions[0]?.id || null);
      }

      return nextSessions;
    });
  };

  const updateCurrentChatMessages = (messages: WorkspaceChatSession['messages']) => {
    const targetChatId = currentChatId;
    if (!targetChatId) return;

    setChatSessions((sessions) =>
      sessions.map((session) =>
        session.id === targetChatId
          ? {
              ...session,
              messages,
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  };

  const nameCurrentChat = (title: string) => {
    const targetChatId = currentChatId;
    if (!targetChatId) return;

    setChatSessions((sessions) =>
      sessions.map((session) =>
        session.id === targetChatId && session.title === 'New chat'
          ? {
              ...session,
              title: title.slice(0, 42),
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  };

  const openFileInWorkbench = async (fileId: string) => {
    if (!id) return;

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

    navigate(`/workbenches/${workbenchId}?resourceId=${encodeURIComponent(fileId)}`);
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
  const currentChat = chatSessions.find((session) => session.id === currentChatId) || chatSessions[0];
  const formatChatTime = (value: string) => formatActivityTime(value);

  return (
    <div className="workspace-shell flex min-h-0 flex-1 bg-[#f7f7f5] text-[#1f2328]">
      <aside className="workspace-sidebar flex w-[310px] shrink-0 flex-col border-r border-[#d9d9d4] bg-[#eeeeec]">
        <div className="flex h-14 shrink-0 items-center gap-2 px-5">
          <button
            onClick={() => navigate('/workspaces')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6b6f76] transition hover:bg-white/70 hover:text-[#1f2328]"
            title="Back to workspaces"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#2d3035]">{workspace.name}</p>
            <p className="truncate text-xs text-[#8a8d91]">{workspace.major || 'Course'}</p>
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto px-4 pb-4">
          <nav className="space-y-1">
            <button
              onClick={createChat}
              className="workspace-nav-item flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-[#34373c] transition hover:bg-white/70"
            >
              <PencilLine className="h-4 w-4 text-[#55585d]" />
              New chat
            </button>
            <button
              onClick={createWorkbench}
              className="workspace-nav-item flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-[#34373c] transition hover:bg-white/70"
            >
              <Workflow className="h-4 w-4 text-[#55585d]" />
              New workbench
            </button>
            <button
              className="workspace-nav-item flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-[#34373c] transition hover:bg-white/70"
            >
              <Search className="h-4 w-4 text-[#55585d]" />
              Search
            </button>
          </nav>

          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-medium text-[#96999d]">Workbenches</h2>
              <button
                onClick={createWorkbench}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#7a7d82] transition hover:bg-white/80 hover:text-[#1f2328]"
                title="New workbench"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1">
              {workbenchItems.length === 0 ? (
                <button
                  onClick={createWorkbench}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[#6b6f76] transition hover:bg-white/70"
                >
                  <Workflow className="h-4 w-4" />
                  Create first workbench
                </button>
              ) : (
                workbenchItems.map((workbench) => (
                  <div key={workbench.id} className="workspace-list-item group flex items-center gap-1 rounded-lg hover:bg-white/70">
                    <Link
                      to={`/workbenches/${workbench.id}`}
                      className="min-w-0 flex-1 px-2.5 py-2"
                    >
                      <p className="truncate text-sm text-[#34373c]">{workbench.title}</p>
                      <p className="truncate text-xs text-[#96999d]">
                        {workbench.panelCount} panels · {workbench.updatedAt}
                      </p>
                    </Link>
                    <button
                      onClick={() => deleteWorkbench(workbench.id)}
                      className="mr-1 hidden h-7 w-7 items-center justify-center rounded-md text-[#96999d] hover:bg-[#fff1f1] hover:text-[#d92d20] group-hover:inline-flex"
                      title="Delete workbench"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-medium text-[#96999d]">Chats</h2>
              <button
                onClick={createChat}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#7a7d82] transition hover:bg-white/80 hover:text-[#1f2328]"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1">
              {chatSessions.map((chat) => (
                <div
                  key={chat.id}
                  className={`workspace-list-item group flex w-full items-center gap-1 rounded-lg transition ${
                    chat.id === currentChat?.id
                      ? 'bg-white/80 text-[#202124]'
                      : 'text-[#34373c] hover:bg-white/70'
                  }`}
                >
                  <button
                    onClick={() => setCurrentChatId(chat.id)}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <span className="block truncate text-sm">{chat.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#96999d]">{formatChatTime(chat.updatedAt)}</span>
                  </button>
                  <button
                    onClick={() => deleteChat(chat.id)}
                    className="mr-1 hidden h-7 w-7 items-center justify-center rounded-md text-[#96999d] transition hover:bg-[#ececea] hover:text-[#34373c] group-hover:inline-flex"
                    title="Delete chat"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

        </div>

        <div className="mt-auto h-4 shrink-0" />
      </aside>

      <div className="workspace-main flex min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa]">
        <header className="flex h-14 shrink-0 items-center justify-end px-5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#deded9] bg-white text-[#777b80] shadow-sm transition hover:bg-[#f6f6f4] hover:text-[#202124]"
              title="Workspace settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsFilesPanelOpen((value) => !value)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition ${
                isFilesPanelOpen
                  ? 'border-[#d8d8d3] bg-[#f1f1ef] text-[#202124]'
                  : 'border-[#deded9] bg-white text-[#777b80] hover:bg-[#f6f6f4] hover:text-[#202124]'
              }`}
              title={isFilesPanelOpen ? 'Collapse files' : 'Open files'}
            >
              <FolderTree className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <LearningTerminal
            workspaceId={id || ''}
            workspaceName={workspace.name}
            major={workspace.major || 'Course'}
            workbenches={workbenchItems}
            fileCount={workspace.fileObjects?.length || 0}
            messages={currentChat?.messages || []}
            onMessagesChange={updateCurrentChatMessages}
            onChatStarted={nameCurrentChat}
            onUploadMaterials={handleUpload}
            onCreateWorkbench={createWorkbench}
            onRefresh={fetchWorkspace}
            onWorkbenchCreated={(workbenchId) => navigate(`/workbenches/${workbenchId}`)}
          />
        </main>
      </div>

      {isFilesPanelOpen ? (
        <aside className="workspace-files-panel flex w-[390px] shrink-0 flex-col border-l border-[#eeeeeb] bg-white">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#eeeeeb] bg-white px-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFilesPanelOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#f1f1ef] text-[#202124] transition hover:bg-[#e9e9e5]"
                title="Collapse files"
              >
                <FolderTree className="h-5 w-5" />
              </button>
              <div>
                <p className="text-sm font-medium text-[#202124]">Files</p>
                <p className="text-xs text-[#96999d]">{overview.fileCount} workspace files</p>
              </div>
            </div>
            <button
              onClick={handleUpload}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#777b80] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
              title="Upload files"
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <FileSystemSidebar
              workspaceId={id || ''}
              embedded
              hideHeader
              showEmbeddedActions
              codexPanel
              onFileDoubleClick={(file) => void openFileInWorkbench(file.id)}
            />
          </div>
        </aside>
      ) : null}

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
