import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api, { workspaceApi } from '../api/client';
import { LearningTerminalMessage, Workspace, WorkspaceOverview, Workbench, WorkbenchItem } from '../types';

import { FileSystemSidebar } from '../components/workspace/FileSystemSidebar';
import { fileSystemApi } from '../services/fileSystemApi';
import WorkspaceSettingsDialog from '../components/workspace/WorkspaceSettingsDialog';
import { workbenchApi } from '../services/workbenchApi';
import { useAuthStore } from '../store/authStore';
import LearningTerminal from '../components/workspace/LearningTerminal';
import LearnerMemoryCenter from '../components/workspace/LearnerMemoryCenter';
import SavedMemoryCenter from '../components/workspace/SavedMemoryCenter';
import MemoryDebugPanel from '../components/workspace/MemoryDebugPanel';
import { mclApi, MclExecuteResult, MclLearningPlan } from '../services/mclApi';
import { learningApi } from '../services/learningApi';
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  ChevronRight,
  FileText,
  FolderTree,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Workflow
} from 'lucide-react';

interface WorkspaceChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: LearningTerminalMessage[];
}

type WorkspaceView = 'status' | 'workbenches' | 'assets' | 'terminal';

export default function WorkspaceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workbenches, setWorkbenches] = useState<Workbench[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFilesPanelOpen, setIsFilesPanelOpen] = useState(true);
  const [chatSessions, setChatSessions] = useState<WorkspaceChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  
  // UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>('status');
  const [planningPrompt, setPlanningPrompt] = useState('基于当前课程资料、学习记录和目标，生成一个可执行的动态学习计划。');
  const [planningResult, setPlanningResult] = useState<MclExecuteResult | null>(null);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [planningRunStatus, setPlanningRunStatus] = useState<string | null>(null);
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
    if (!hydrated) return;

    if (!user) {
      setLoading(false);
      return;
    }

    void fetchWorkspace();
  }, [hydrated, id, user]);

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
      setLoadError(null);
      const res = await api.get(`/workspaces/${id}`);
      setWorkspace(res.data.workspace);
      setWorkbenches(await workbenchApi.listByWorkspace(id));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404) {
          setLoadError('Workspace 不存在或已被删除。');
        } else if (error.code === 'ECONNABORTED') {
          setLoadError('后端响应超时，请确认 backend dev server 正在运行。');
        } else if (!error.response) {
          setLoadError('无法连接到后端服务，请确认 http://127.0.0.1:3001 可访问。');
        } else {
          setLoadError(error.response.data?.error || '加载 Workspace 失败。');
        }
      } else {
        setLoadError('加载 Workspace 失败。');
      }
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
          await fileSystemApi.upload(id, Array.from(files), undefined, undefined, {
            resourceRole: 'source',
            resourceType: 'source',
            scope: 'workspace',
            origin: 'upload'
          });
          await fetchWorkspace();
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

  const parseRunJson = <T,>(value: unknown, fallback: T): T => {
    if (!value || typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };

  const timelineFromRun = (run: any): MclExecuteResult['timeline'] => {
    const steps = Array.isArray(run?.steps) ? run.steps : [];
    return steps.map((step: any) => {
      const output = parseRunJson<{ summary?: string; durationMs?: number; fallback?: boolean }>(step.outputJson, {});
      const input = parseRunJson<{ summary?: string }>(step.inputJson, {});
      const duration = output.durationMs != null ? `${output.durationMs}ms` : step.status;
      return {
        agentName: String(step.capability || 'Agent'),
        inputSummary: input.summary || duration,
        outputSummary: step.errorMessage || output.summary || (output.fallback ? 'Used fallback result.' : step.status),
        status: String(step.status || 'running')
      };
    });
  };

  const waitForPlanningRun = async (runId: string) => {
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    for (let attempt = 0; attempt < 180; attempt += 1) {
      const { run } = await learningApi.getRun(runId);
      const timeline = timelineFromRun(run);
      setPlanningRunStatus(run.status);
      setPlanningResult((current) => ({
        ...(current || { intent: 'planning', runId }),
        runId,
        intent: 'planning',
        timeline
      }));

      if (run.status === 'completed') {
        const result = parseRunJson<MclExecuteResult>(run.resultJson, { intent: 'planning', runId, timeline });
        setPlanningResult({
          ...result,
          runId,
          timeline: result.timeline?.length ? result.timeline : timeline
        });
        setPlanningRunStatus('completed');
        await fetchWorkspace();
        return;
      }

      if (run.status === 'failed') {
        throw new Error(run.errorMessage || 'MCL planning failed');
      }

      await sleep(1500);
    }

    throw new Error('规划仍在运行，请稍后刷新或重试。');
  };

  const runMclPlanning = async (mode: 'create' | 'revise' = 'create') => {
    if (!id || planningLoading) return;

    setPlanningLoading(true);
    setPlanningError(null);
    setPlanningRunStatus('queued');

    try {
      const result = await mclApi.execute({
        workspaceId: id,
        intent: 'planning',
        userInput: planningPrompt,
        previousPlan: mode === 'revise' ? (planningResult?.plan as Record<string, unknown> | undefined) : undefined,
        context: {
          workspaceId: id,
          workbenchId: latestWorkbench?.id
        }
      });
      setPlanningResult(result);
      setPlanningRunStatus(result.status || 'running');

      if (result.runId && !result.plan) {
        await waitForPlanningRun(result.runId);
      } else {
        await fetchWorkspace();
      }
    } catch (error: any) {
      setPlanningError(error?.response?.data?.error || error?.message || 'MCL planning failed');
      setPlanningRunStatus('failed');
    } finally {
      setPlanningLoading(false);
    }
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

  if (loading || (!loadError && !workspace)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--app-bg)]">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (loadError || !workspace) {
    return (
      <div className="workspace-shell flex min-h-0 flex-1 items-center justify-center bg-[#fbfbfa] px-6 text-[#202124]">
        <div className="w-full max-w-md border-y border-[#e8e8e4] py-8">
          <p className="text-sm font-medium text-[#96999d]">Workspace</p>
          <h1 className="mt-2 text-2xl font-semibold">暂时无法打开这个 Workspace</h1>
          <p className="mt-3 text-sm leading-6 text-[#666a70]">
            {loadError || '加载 Workspace 失败。'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => void fetchWorkspace()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
            <button
              onClick={() => navigate('/workspaces')}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
            >
              返回列表
            </button>
          </div>
        </div>
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
  const latestFiles = (workspace.fileObjects || [])
    .filter((file) => file.nodeType === 'file')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 4);
  const statusItems = [
    { label: 'Workbench', value: overview.workbenchCount },
    { label: 'Resources', value: overview.fileCount },
    { label: 'Updated', value: overview.updatedAt }
  ];
  const profileSignals = [
    `专业方向：${overview.major}`,
    workbenchItems.length > 0 ? `偏好从「${workbenchItems[0].title}」继续` : '偏好：先建立清晰目标',
    latestFiles.length > 0 ? `近期资料：${latestFiles[0].name}` : '资料状态：等待上传课程资产'
  ];
  const activeMclPlan: MclLearningPlan | undefined = planningResult?.plan;
  const planningReadiness = planningResult?.learningState?.readiness;
  const planningCitations = (planningResult?.contextCapsule?.citations || []) as Array<{
    label?: string;
    title?: string;
    source?: string;
  }>;
  const workspaceViews: Array<{
    id: WorkspaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'status', label: '学习状态', icon: Sparkles },
    { id: 'workbenches', label: '学习现场', icon: Workflow },
    { id: 'assets', label: '课程资产', icon: FolderTree },
    { id: 'terminal', label: 'AI Terminal', icon: PencilLine }
  ];

  return (
    <div className="workspace-shell min-h-0 flex-1 overflow-y-auto bg-[#fbfbfa] text-[#202124]">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-8 border-b border-[#e8e8e4] pb-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => navigate('/workspaces')}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-[#666a70] transition hover:bg-[#f1f1ef] hover:text-[#202124]"
            >
              <ArrowLeft className="h-4 w-4" />
              Workspaces
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-normal text-[#202124] sm:text-4xl">{overview.courseName}</h1>
              {overview.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[#666a70]">{overview.description}</p>
              ) : null}
            </div>
            <dl className="flex flex-wrap items-end justify-start gap-x-8 gap-y-3 text-left lg:justify-end lg:text-right">
              {statusItems.map((item) => (
                <div key={item.label} className="min-w-[72px]">
                  <dt className="text-[11px] text-[#96999d]">{item.label}</dt>
                  <dd className="mt-1 truncate text-sm font-medium text-[#202124]">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        <nav className="-mt-3 mb-8 flex flex-wrap items-center gap-2 border-b border-[#e8e8e4] pb-3">
          {workspaceViews.map((view) => {
            const Icon = view.icon;
            const isActive = activeView === view.id;

            return (
              <button
                key={view.id}
                onClick={() => setActiveView(view.id)}
                className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${
                  isActive
                    ? 'bg-[#f1f1ef] text-[#202124]'
                    : 'text-[#777b80] hover:bg-[#f6f6f4] hover:text-[#34373c]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {view.label}
              </button>
            );
          })}
        </nav>

        <main>
          {activeView === 'status' ? (
            <section>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#202124]">学习状态</h2>
              </div>
              <button
                onClick={latestWorkbench ? () => navigate(`/workbenches/${latestWorkbench.id}`) : createWorkbench}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
              >
                {latestWorkbench ? '继续最近现场' : '创建学习现场'}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-8 md:grid-cols-[1fr_1fr_1.1fr]">
              <div>
                <p className="text-sm font-medium text-[#34373c]">最近学习</p>
                <p className="mt-2 text-2xl font-semibold text-[#202124]">{overview.updatedAt}</p>
                <p className="mt-2 text-sm leading-6 text-[#777b80]">
                  {latestWorkbench ? latestWorkbench.title : '尚未创建学习现场'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-[#34373c]">学习现场</p>
                <p className="text-2xl font-semibold text-[#202124]">{overview.workbenchCount}</p>
                <p className="mt-2 text-sm leading-6 text-[#777b80]">
                  {overview.fileCount} 份课程资产可用
                </p>
              </div>
              <details className="border-l border-[#eeeeeb] pl-5">
                <summary className="cursor-pointer list-none text-sm font-medium text-[#34373c]">
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#777b80]" />
                    个性化依据
                  </span>
                </summary>
                <div className="mt-3 space-y-2">
                  {profileSignals.map((signal) => (
                    <p key={signal} className="text-sm leading-6 text-[#666a70]">{signal}</p>
                  ))}
                </div>
              </details>
            </div>

            <SavedMemoryCenter workspaceId={id || ''} workbenchId={latestWorkbench?.id} />
            <LearnerMemoryCenter workspaceId={id || ''} workbenchId={latestWorkbench?.id} />
            <MemoryDebugPanel workspaceId={id || ''} workbenchId={latestWorkbench?.id} />

            <div className="mt-10 border-t border-[#eeeeeb] pt-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
                <section className="space-y-5">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#f1f1ef] px-3 py-1 text-xs font-medium text-[#55585d]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      MCL multi-agent planning
                    </div>
                    <h3 className="text-2xl font-semibold tracking-normal text-[#202124]">动态学习规划入口</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[#666a70]">
                      Planning 会先构建 Workspace 级学习状态，再交给多智能体规划层生成或修订计划。它会解释使用了哪些上下文、为什么这样排序、下一步需要产出什么证据。
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#e6e6e1] bg-white p-4">
                    <label className="mb-2 block text-sm font-medium text-[#34373c]">本次规划意图</label>
                    <textarea
                      value={planningPrompt}
                      onChange={(event) => setPlanningPrompt(event.target.value)}
                      rows={5}
                      className="w-full resize-none rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 py-2 text-sm leading-6 text-[#202124] outline-none transition focus:border-[#b9bab2] focus:bg-white"
                      placeholder="例如：帮我为编译原理实验生成一个 2 周学习计划，优先补齐语法分析和 IR 生成。"
                    />
	                    {planningError ? <p className="mt-2 text-sm text-red-600">{planningError}</p> : null}
	                    {planningRunStatus && planningRunStatus !== 'completed' && !planningError ? (
	                      <p className="mt-2 text-sm text-[#777b80]">
	                        当前状态：{planningRunStatus === 'running' ? '正在执行 multi-agent planning' : planningRunStatus}
	                      </p>
	                    ) : null}
	                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => void runMclPlanning('create')}
                        disabled={planningLoading || !planningPrompt.trim()}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {planningLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        生成规划
                      </button>
                      <button
                        onClick={() => void runMclPlanning('revise')}
                        disabled={planningLoading || !activeMclPlan}
                        className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <RefreshCw className="h-4 w-4" />
                        基于结果重规划
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ['资料', planningReadiness?.stats?.fileCount ?? overview.fileCount],
                      ['知识块', planningReadiness?.stats?.chunkCount ?? 0],
                      ['Trace', planningReadiness?.stats?.traceCount ?? 0]
                    ].map(([label, value]) => (
                      <div key={label} className="border-l border-[#e2e2de] pl-3">
                        <p className="text-xs text-[#96999d]">{label}</p>
                        <p className="mt-1 text-lg font-semibold text-[#202124]">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="min-w-0">
                  {activeMclPlan ? (
                    <div className="space-y-6">
                      <div className="rounded-xl border border-[#e6e6e1] bg-white p-5">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#96999d]">Plan v{activeMclPlan.version} · {activeMclPlan.status}</p>
                            <h3 className="mt-1 text-xl font-semibold text-[#202124]">{activeMclPlan.objective}</h3>
                          </div>
                          <span className="rounded-full bg-[#f1f1ef] px-3 py-1 text-xs font-medium text-[#55585d]">
                            confidence {Math.round((activeMclPlan.constraintScores?.confidence || 0) * 100)}%
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-[#666a70]">{activeMclPlan.rationale}</p>
                        {activeMclPlan.constraintScores?.summary ? (
                          <p className="mt-3 text-sm leading-6 text-[#777b80]">{activeMclPlan.constraintScores.summary}</p>
                        ) : null}
                      </div>

                      <div>
                        <h4 className="mb-3 text-sm font-semibold text-[#202124]">执行步骤</h4>
                        <div className="space-y-2">
                          {activeMclPlan.steps.map((step, index) => {
                            const isNext = activeMclPlan.nextStepId === step.id;
                            return (
                              <div
                                key={step.id}
                                className={`rounded-lg border px-4 py-3 ${
                                  isNext ? 'border-[#202124] bg-white' : 'border-[#eeeeeb] bg-[#fbfbfa]'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eeeeeb] text-xs font-medium text-[#55585d]">
                                    {index + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium text-[#202124]">{step.title}</p>
                                      {isNext ? <span className="rounded-full bg-[#202124] px-2 py-0.5 text-xs text-white">next</span> : null}
                                      <span className="text-xs text-[#96999d]">{step.type} · {step.estimatedLoad || 'medium'}</span>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-[#666a70]">{step.rationale}</p>
                                    {step.expectedEvidence?.length ? (
                                      <p className="mt-2 text-xs text-[#777b80]">证据：{step.expectedEvidence.join(' / ')}</p>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-[#202124]">Agent timeline</h4>
                          <div className="space-y-2">
                            {(planningResult?.timeline || []).map((item) => (
                              <div key={`${item.agentName}-${item.inputSummary}`} className="border-l border-[#deded9] pl-3">
                                <p className="text-sm font-medium text-[#34373c]">{item.agentName}</p>
                                <p className="text-xs leading-5 text-[#777b80]">{item.inputSummary}</p>
                                <p className="text-xs leading-5 text-[#777b80]">{item.outputSummary}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-[#202124]">上下文证据</h4>
                          <div className="space-y-2">
                            {planningCitations.length > 0 ? planningCitations.slice(0, 5).map((citation, index) => (
                              <p key={`${citation.label || citation.title}-${index}`} className="text-sm leading-6 text-[#666a70]">
                                {citation.label || `引用 ${index + 1}`} · {citation.title || citation.source || 'Workspace context'}
                              </p>
                            )) : (
                              <p className="text-sm leading-6 text-[#777b80]">本次结果未返回显式 citation，但仍使用了 Workspace 学习状态与记忆。</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
	                  ) : planningLoading ? (
	                    <div className="flex min-h-[420px] flex-col justify-center rounded-xl border border-dashed border-[#d8d8d3] bg-white p-6">
	                      <div className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[#34373c]">
	                        <Loader2 className="h-4 w-4 animate-spin" />
	                        正在生成 Workspace 级动态规划
	                      </div>
	                      <p className="max-w-xl text-sm leading-6 text-[#666a70]">
	                        后端已经创建异步 run，下面会持续更新 LearningStateBuilder、Planner、Reflection 和保存阶段的进度。
	                      </p>
	                      <div className="mt-5 space-y-2">
	                        {(planningResult?.timeline || []).length > 0 ? (planningResult?.timeline || []).map((item) => (
	                          <div key={`${item.agentName}-${item.inputSummary}-${item.status}`} className="border-l border-[#deded9] pl-3">
	                            <p className="text-sm font-medium text-[#34373c]">{item.agentName}</p>
	                            <p className="text-xs leading-5 text-[#777b80]">{item.inputSummary}</p>
	                            <p className="text-xs leading-5 text-[#777b80]">{item.outputSummary}</p>
	                          </div>
	                        )) : (
	                          <p className="text-sm text-[#777b80]">Queued...</p>
	                        )}
	                      </div>
	                    </div>
	                  ) : (
                    <div className="flex min-h-[420px] flex-col justify-center rounded-xl border border-dashed border-[#d8d8d3] bg-white p-6">
                      <p className="text-lg font-semibold text-[#202124]">还没有生成 Workspace 级动态规划</p>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-[#666a70]">
                        点击“生成规划”后，这里会展示 MCL multi-agent planning 的目标、步骤、约束评分、agent 执行链路和上下文证据。这个入口不会进入具体 Workbench，而是站在课程 Workspace 层面做全局规划。
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </section>
          ) : null}

          {activeView === 'workbenches' ? (
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-[#202124]">学习现场</h2>
                </div>
                <button
                  onClick={createWorkbench}
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
                >
                  <Plus className="h-4 w-4" />
                  New
                </button>
              </div>

              <div className="space-y-2">
                {workbenchItems.length === 0 ? (
                  <button
                    onClick={createWorkbench}
                    className="flex w-full items-center gap-3 rounded-lg border border-dashed border-[#d8d8d3] bg-white p-4 text-left transition hover:bg-[#f6f6f4]"
                  >
                    <BookOpen className="h-5 w-5 text-[#777b80]" />
                    <span>
                      <span className="block text-sm font-medium text-[#34373c]">创建第一个学习现场</span>
                      <span className="mt-1 block text-sm text-[#777b80]">把某个具体任务、资料和 AI 辅助集中到 Workbench 中。</span>
                    </span>
                  </button>
                ) : (
                  workbenchItems.map((workbench) => (
                    <div key={workbench.id} className="group flex items-center gap-3 border-b border-[#eeeeeb] px-1 py-3 transition last:border-b-0 hover:bg-[#f6f6f4] sm:px-3">
                      <Link to={`/workbenches/${workbench.id}`} className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#202124]">{workbench.title}</p>
                        <p className="mt-1 truncate text-sm text-[#777b80]">
                          {workbench.description || 'Saved task workspace with open panels, notes and learning context.'}
                        </p>
                        <p className="mt-2 flex items-center gap-2 text-xs text-[#96999d]">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {workbench.updatedAt} · {workbench.panelCount} panels
                        </p>
                      </Link>
                      <button
                        onClick={() => deleteWorkbench(workbench.id)}
                        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#96999d] transition hover:bg-[#fff1f1] hover:text-[#d92d20] group-hover:inline-flex"
                        title="Delete workbench"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {activeView === 'assets' ? (
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-[#202124]">课程资产</h2>
                </div>
                <button
                  onClick={() => setIsFilesPanelOpen((value) => !value)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
                >
                  <FileText className="h-4 w-4" />
                  {isFilesPanelOpen ? 'Hide tree' : 'Show tree'}
                </button>
              </div>

              {latestFiles.length > 0 ? (
                <div className="mb-4 space-y-2">
                  {latestFiles.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => void openFileInWorkbench(file.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-[#f6f6f4]"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[#777b80]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#34373c]">{file.name}</span>
                        <span className="block truncate text-xs text-[#96999d]">{formatActivityTime(file.updatedAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  onClick={handleUpload}
                  className="mb-4 flex w-full items-center gap-3 rounded-lg border border-dashed border-[#d8d8d3] bg-white p-4 text-left transition hover:bg-[#f6f6f4]"
                >
                  <Upload className="h-5 w-5 text-[#777b80]" />
                  <span>
                    <span className="block text-sm font-medium text-[#34373c]">上传课程资料</span>
                    <span className="mt-1 block text-sm text-[#777b80]">课件、论文、代码和笔记会成为 AI Terminal 的上下文。</span>
                  </span>
                </button>
              )}

              {isFilesPanelOpen ? (
                <div className="h-[360px] overflow-hidden border-y border-[#eeeeeb] bg-white">
                  <FileSystemSidebar
                    workspaceId={id || ''}
                    embedded
                    hideHeader
                    showEmbeddedActions
                    codexPanel
                    onFileDoubleClick={(file) => void openFileInWorkbench(file.id)}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {activeView === 'terminal' ? (
            <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#202124]">AI Terminal</h2>
              </div>
              <button
                onClick={createChat}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
              >
                <PencilLine className="h-4 w-4" />
                New chat
              </button>
            </div>

            <LearningTerminal
              workspaceId={id || ''}
              sessionId={currentChat?.id}
              workbenchId={latestWorkbench?.id}
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
              variant="dashboard"
            />
            </section>
          ) : null}
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
