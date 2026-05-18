import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  X
} from 'lucide-react';
import { learningApi } from '../services/learningApi';
import {
  ConceptEdge,
  ConceptNode,
  KnowledgeGraphWorkbench
} from '../components/workspace/LearningIntelligenceDashboard';

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const pct = (value?: number | null) => `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
const buildJobStorageKey = (workspaceId: string, workbenchId?: string) =>
  `course-graph-build-job:${workspaceId}:${workbenchId || 'workspace'}`;

const relationLabel = (type: string) => {
  if (type === 'prerequisite') return '前置';
  if (type === 'part_of') return '组成';
  if (type === 'assesses') return '测评';
  if (type === 'remediates') return '补救';
  if (type === 'supports') return '支持';
  return '相关';
};

export default function KnowledgeGraphPage() {
  const { id: workspaceId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const workbenchId = searchParams.get('workbenchId') || undefined;
  const [graph, setGraph] = useState<{ nodes: ConceptNode[]; edges: ConceptEdge[] }>({ nodes: [], edges: [] });
  const [integration, setIntegration] = useState<any>(null);
  const [kgPlan, setKgPlan] = useState<any>(null);
  const [selectedConcept, setSelectedConcept] = useState<ConceptNode | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionRunning, setActionRunning] = useState<'build' | 'target' | 'gap' | null>(null);
  const [buildJob, setBuildJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildReport, setBuildReport] = useState<any>(null);
  const [targetStructure, setTargetStructure] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [integrationResult, graphResult, planResult] = await Promise.all([
        learningApi.getWorkspaceIntegration(workspaceId, { workbenchId }).catch(() => ({ integration: null })),
        learningApi.getKnowledgeGraph(workspaceId, { limit: 180 }).catch(() => ({ graph: { nodes: [], edges: [] } })),
        learningApi.createKnowledgeGraphPlan({ workspaceId, workbenchId, maxConcepts: 10, persist: false }).catch(() => ({ plan: null }))
      ]);
      setIntegration(integrationResult.integration || null);
      setGraph({
        nodes: safeArray<ConceptNode>(graphResult.graph?.nodes),
        edges: safeArray<ConceptEdge>(graphResult.graph?.edges)
      });
      setKgPlan(planResult.plan || null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '知识图谱加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId, workbenchId]);

  useEffect(() => {
    if (!workspaceId || buildJob?.id) return;
    let cancelled = false;
    const storedJobId = typeof window !== 'undefined' ? window.localStorage.getItem(buildJobStorageKey(workspaceId, workbenchId)) : null;
    const restoreFromStored = storedJobId
      ? learningApi.getCourseGraphBuildJob(storedJobId).then((result) => result.job).catch(() => null)
      : Promise.resolve(null);
    restoreFromStored
      .then((storedJob) => storedJob || learningApi.listCourseGraphBuildJobs(workspaceId, 8)
        .then((result) => {
          const jobs = safeArray<any>(result.jobs);
          const active = jobs.find((job) =>
            (job.status === 'queued' || job.status === 'running') &&
            (!workbenchId || !job.workbenchId || job.workbenchId === workbenchId)
          );
          const latestCompleted = jobs.find((job) =>
            (job.status === 'completed' || job.status === 'failed') &&
            (!workbenchId || !job.workbenchId || job.workbenchId === workbenchId)
          );
          return active || latestCompleted || null;
        }))
      .then((result) => {
        if (cancelled) return;
        const restored = result || null;
        if (restored) {
          setBuildJob(restored);
          if (restored.report) setBuildReport(restored.report);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workbenchId, buildJob?.id]);

  useEffect(() => {
    if (!buildJob?.id || buildJob?.status === 'completed' || buildJob?.status === 'failed') return;
    const timer = window.setInterval(async () => {
      try {
        const result = await learningApi.getCourseGraphBuildJob(buildJob.id);
        setBuildJob(result.job || null);
        if (result.job?.report) setBuildReport(result.job.report);
        if (result.job?.status === 'completed' || result.job?.status === 'failed') {
          window.clearInterval(timer);
          await load();
        }
      } catch {
        // keep polling silently
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [buildJob?.id, buildJob?.status, workspaceId, workbenchId]);

  const runBuildGraph = async () => {
    if (!workspaceId) return;
    setActionRunning('build');
    setError(null);
    try {
      const result = await learningApi.startCourseGraphBuildJob({
        workspaceId,
        workbenchId,
        reindex: true,
        validate: true,
        includeWorkspaceResources: true,
        graphLimit: 180
      });
      setBuildJob(result.job || null);
      if (result.job?.id && typeof window !== 'undefined') {
        window.localStorage.setItem(buildJobStorageKey(workspaceId, workbenchId), result.job.id);
      }
      setBuildReport(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '课程知识图谱重建失败');
    } finally {
      setActionRunning(null);
    }
  };

  const runTargetStructure = async () => {
    if (!workspaceId) return;
    const objective = integration?.continueLearning?.prompt || kgPlan?.objective || integration?.continueLearning?.nextStepTitle;
    setActionRunning('target');
    setError(null);
    try {
      const result = await learningApi.buildTargetKnowledgeStructure({
        workspaceId,
        workbenchId,
        objective,
        persist: true
      });
      setTargetStructure(result.structure || null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '目标知识结构生成失败');
    } finally {
      setActionRunning(null);
    }
  };

  const runGapAnalysis = async () => {
    if (!workspaceId) return;
    const objective = targetStructure?.objective || integration?.continueLearning?.prompt || kgPlan?.objective || integration?.continueLearning?.nextStepTitle;
    setActionRunning('gap');
    setError(null);
    try {
      const result = await learningApi.runKnowledgeGapAnalysis({
        workspaceId,
        workbenchId,
        objective,
        targetStructure: targetStructure || undefined,
        persist: true
      });
      setTargetStructure(result.targetStructure || targetStructure || null);
      setGapAnalysis(result.analysis || null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '知识差距分析失败');
    } finally {
      setActionRunning(null);
    }
  };

  const conceptById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const incomingEdges = selectedConcept ? graph.edges.filter((edge) => edge.to === selectedConcept.id) : [];
  const outgoingEdges = selectedConcept ? graph.edges.filter((edge) => edge.from === selectedConcept.id) : [];
  const kgPathIds = safeArray<any>(kgPlan?.knowledgeGraphSnapshot?.nodes).map((node) => String(node.id)).filter(Boolean);
  const fallbackPathIds = safeArray<string>(integration?.continueLearning?.conceptIds);
  const pathIds = kgPathIds.length ? kgPathIds : fallbackPathIds;

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#0b1117] text-[#e6edf3]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#202832] bg-[#0f141b] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/workspaces/${workspaceId}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#c9d1d9] hover:bg-[#30363d]">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-[#7dd3fc]" />
              <h1 className="truncate text-sm font-semibold">Workspace Knowledge Graph</h1>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#8b949e]">
              {graph.nodes.length} concepts · {graph.edges.length} relations · {integration?.continueLearning?.nextStepTitle || 'full-screen graph workspace'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative block w-[320px] max-w-[42vw]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b949e]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索概念、类型或 id"
              className="h-9 w-full rounded-lg border border-[#30363d] bg-[#0b1117] pl-9 pr-9 text-sm text-[#e6edf3] outline-none placeholder:text-[#6e7681] focus:border-[#7dd3fc]"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8b949e] hover:bg-[#30363d]">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || Boolean(actionRunning)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 text-sm font-medium text-[#c9d1d9] hover:bg-[#30363d] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void runBuildGraph()}
            disabled={loading || Boolean(actionRunning)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#238636] px-3 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-60"
          >
            {actionRunning === 'build' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
            重建课程图谱
          </button>
        </div>
      </header>

      {error ? <div className="shrink-0 border-b border-[#5f2a2a] bg-[#2a1515] px-4 py-2 text-sm text-[#ffb4b4]">{error}</div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-h-0">
          {graph.nodes.length ? (
            <KnowledgeGraphWorkbench
              workspaceId={workspaceId}
              workbenchId={workbenchId}
              concepts={graph.nodes}
              edges={graph.edges}
              selectedId={selectedConcept?.id}
              pathIds={pathIds}
              searchTerm={query}
              variant="fullscreen"
              onSelect={setSelectedConcept}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Network className="mx-auto h-8 w-8 text-[#6e7681]" />
                <p className="mt-3 text-sm font-medium">还没有可展示的知识图谱</p>
                <p className="mt-2 text-sm text-[#8b949e]">索引课程资料或生成学习计划后再刷新。</p>
              </div>
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-[#202832] bg-[#0f141b] p-5">
          <section className="mb-5 border-b border-[#202832] pb-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8b949e]">Graph Kernel</p>
            {buildJob ? (
              <div className="mt-3 rounded-md bg-[#161b22] px-3 py-3">
                <p className="text-sm font-medium text-[#f0f6fc]">{buildJob.status === 'completed' ? '课程图谱已完成' : buildJob.status === 'failed' ? '课程图谱构建失败' : '课程图谱构建中'}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#30363d]">
                  <div
                    className="h-full rounded-full bg-[#2ea043] transition-all"
                    style={{ width: `${Math.max(4, Math.min(100, Number(buildJob.progress?.percent || 0)))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-[#8b949e]">{buildJob.progress?.message || '正在处理...'}</p>
                {buildJob.progress?.currentFileName ? <p className="mt-1 truncate text-xs text-[#c9d1d9]">{buildJob.progress.currentFileName}</p> : null}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runTargetStructure()}
                disabled={loading || Boolean(actionRunning)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 text-sm font-medium text-[#c9d1d9] hover:bg-[#30363d] disabled:opacity-60"
              >
                {actionRunning === 'target' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                目标结构
              </button>
              <button
                type="button"
                onClick={() => void runGapAnalysis()}
                disabled={loading || Boolean(actionRunning)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 text-sm font-medium text-[#c9d1d9] hover:bg-[#30363d] disabled:opacity-60"
              >
                {actionRunning === 'gap' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                差距分析
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-[#c9d1d9]">
              {buildReport ? (
                <div className="rounded-md bg-[#161b22] px-3 py-2">
                  <p className="font-medium text-[#f0f6fc]">课程图谱已重建</p>
                  <p className="mt-1 text-xs text-[#8b949e]">
                    concepts {buildReport.graph?.nodes?.length ?? buildReport.conceptsCreated ?? buildReport.conceptCount ?? graph.nodes.length} · relations {buildReport.graph?.edges?.length ?? buildReport.relationsCreated ?? buildReport.relationCount ?? graph.edges.length}
                  </p>
                </div>
              ) : null}
              {targetStructure ? (
                <div className="rounded-md bg-[#161b22] px-3 py-2">
                  <p className="flex items-center gap-2 font-medium text-[#f0f6fc]"><Sparkles className="h-3.5 w-3.5 text-[#7dd3fc]" />目标结构</p>
                  <p className="mt-1 text-xs text-[#8b949e]">{targetStructure.nodes?.length || 0} nodes · {targetStructure.edges?.length || 0} edges · confidence {Number(targetStructure.confidence || 0).toFixed(2)}</p>
                </div>
              ) : null}
              {gapAnalysis ? (
                <div className="rounded-md bg-[#161b22] px-3 py-2">
                  <p className="font-medium text-[#f0f6fc]">差距分析</p>
                  <p className="mt-1 text-xs text-[#8b949e]">
                    covered {gapAnalysis.summary?.coveredCount ?? 0} · gaps {gapAnalysis.summary?.gapCount ?? 0} · blocked {gapAnalysis.summary?.blockedCount ?? 0} · readiness {pct(gapAnalysis.summary?.overallReadiness)}
                  </p>
                  <div className="mt-2 space-y-1">
                    {safeArray<string>(gapAnalysis.nextActions).slice(0, 3).map((action) => (
                      <p key={action} className="truncate text-xs text-[#c9d1d9]">{action}</p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
          {selectedConcept ? (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#8b949e]">Concept Detail</p>
                  <h2 className="mt-2 break-words text-2xl font-semibold text-[#f0f6fc]">{selectedConcept.title}</h2>
                </div>
                <button type="button" onClick={() => setSelectedConcept(null)} className="rounded-md p-2 text-[#8b949e] hover:bg-[#30363d]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 border-y border-[#202832] py-4">
                <div><p className="text-xs text-[#8b949e]">Mastery</p><p className="mt-1 text-sm font-semibold">{pct(selectedConcept.learnerState?.masteryEstimate)}</p></div>
                <div><p className="text-xs text-[#8b949e]">Weakness</p><p className="mt-1 text-sm font-semibold">{pct(selectedConcept.learnerState?.weaknessEstimate)}</p></div>
                <div><p className="text-xs text-[#8b949e]">Readiness</p><p className="mt-1 text-sm font-semibold">{pct(selectedConcept.learnerState?.readinessEstimate)}</p></div>
              </div>

              <div className="mt-5 space-y-6 text-sm text-[#c9d1d9]">
                <section>
                  <h3 className="text-sm font-semibold text-[#f0f6fc]">入边</h3>
                  <div className="mt-2 space-y-2">
                    {incomingEdges.length ? incomingEdges.slice(0, 12).map((edge) => (
                      <p key={edge.id} className="rounded-md bg-[#161b22] px-3 py-2">{relationLabel(edge.relationType)} · {conceptById.get(edge.from)?.title || edge.from}</p>
                    )) : <p className="text-[#8b949e]">暂无入边。</p>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[#f0f6fc]">出边</h3>
                  <div className="mt-2 space-y-2">
                    {outgoingEdges.length ? outgoingEdges.slice(0, 12).map((edge) => (
                      <p key={edge.id} className="rounded-md bg-[#161b22] px-3 py-2">{relationLabel(edge.relationType)} · {conceptById.get(edge.to)?.title || edge.to}</p>
                    )) : <p className="text-[#8b949e]">暂无出边。</p>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[#f0f6fc]">常见误区</h3>
                  <div className="mt-2 space-y-2">
                    {selectedConcept.misconceptions?.length ? selectedConcept.misconceptions.map((item) => (
                      <p key={item.title} className="rounded-md bg-[#161b22] px-3 py-2">{item.title}{item.repairHint ? `：${item.repairHint}` : ''}</p>
                    )) : <p className="text-[#8b949e]">暂无误区记录。</p>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[#f0f6fc]">相关资源与任务</h3>
                  <div className="mt-2 space-y-2">
                    {selectedConcept.bindings?.length ? selectedConcept.bindings.map((item, index) => (
                      <p key={`${item.targetType}-${item.targetId}-${index}`} className="rounded-md bg-[#161b22] px-3 py-2">{item.role} · {item.targetType} · {item.targetId}</p>
                    )) : <p className="text-[#8b949e]">暂无绑定资源。</p>}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center text-sm text-[#8b949e]">
              <div>
                <Network className="mx-auto h-8 w-8" />
                <p className="mt-3 font-medium text-[#c9d1d9]">选择一个节点</p>
                <p className="mt-2 leading-6">点击图中的概念查看前置关系、误区和资源绑定。</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
