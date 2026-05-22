import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Loader2 as SpinnerIcon,
  Loader2,
  Network,
  RefreshCw,
  Sparkles,
  Target,
  Tag,
  X
} from 'lucide-react';
import { learningApi } from '../services/learningApi';
import {
  ConceptEdge,
  ConceptNode
} from '../components/workspace/LearningIntelligenceDashboard';
import CosmosKnowledgeGraphWorkbench from '../components/workspace/CosmosKnowledgeGraphWorkbench';

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const pct = (value?: number | null) => `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
const normalizeTag = (value: string) => value.trim().replace(/^#+/, '').replace(/\s+/g, ' ');
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
  const [loading, setLoading] = useState(false);
  const [actionRunning, setActionRunning] = useState<'build' | 'target' | 'gap' | null>(null);
  const [buildJob, setBuildJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildReport, setBuildReport] = useState<any>(null);
  const [targetStructure, setTargetStructure] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [conceptTags, setConceptTags] = useState<any[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagQuestion, setTagQuestion] = useState('');
  const [tagSuggestionRunning, setTagSuggestionRunning] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagQuery, setTagQuery] = useState('');

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [integrationResult, graphResult, planResult] = await Promise.all([
        learningApi.getWorkspaceIntegration(workspaceId, { workbenchId }).catch(() => ({ integration: null })),
        learningApi.getKnowledgeGraph(workspaceId, { limit: 180, tagQuery: tagQuery.trim() || undefined }).catch(() => ({ graph: { nodes: [], edges: [] } })),
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
  }, [workspaceId, workbenchId, tagQuery]);

  useEffect(() => {
    if (selectedConcept && !graph.nodes.some((node) => node.id === selectedConcept.id)) {
      setSelectedConcept(null);
    }
  }, [graph.nodes, selectedConcept]);

  useEffect(() => {
    if (!workspaceId || buildJob?.id) return;
    let cancelled = false;
    const storedJobId = typeof window !== 'undefined' ? window.localStorage.getItem(buildJobStorageKey(workspaceId, workbenchId)) : null;
    const restoreFromStored = storedJobId
      ? learningApi.getCourseGraphBuildJob(storedJobId)
          .then((result) => result.job)
          .catch((err) => {
            if (err?.response?.status === 404 && typeof window !== 'undefined') {
              window.localStorage.removeItem(buildJobStorageKey(workspaceId, workbenchId));
            }
            return null;
          })
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
      } catch (err: any) {
        if (err?.response?.status === 404) {
          setBuildJob(null);
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(buildJobStorageKey(workspaceId, workbenchId));
          }
          window.clearInterval(timer);
        }
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
  const appliedTags = useMemo(() => conceptTags.filter((tag) => tag.state === 'applied'), [conceptTags]);
  const candidateTags = useMemo(() => conceptTags.filter((tag) => tag.state !== 'applied'), [conceptTags]);
  const pathIds = useMemo(() => {
    const kgPathIds = safeArray<any>(kgPlan?.knowledgeGraphSnapshot?.nodes).map((node) => String(node.id)).filter(Boolean);
    const fallbackPathIds = safeArray<string>(integration?.continueLearning?.conceptIds);
    return kgPathIds.length ? kgPathIds : fallbackPathIds;
  }, [kgPlan?.knowledgeGraphSnapshot?.nodes, integration?.continueLearning?.conceptIds]);

  useEffect(() => {
    if (!selectedConcept?.id) {
      setConceptTags([]);
      setTagDraft('');
      setTagQuestion('');
      return;
    }
    let cancelled = false;
    learningApi.getConceptTags(workspaceId, selectedConcept.id).then((result) => {
      if (cancelled) return;
      setConceptTags(safeArray<any>(result.tags));
    }).catch(() => {
      if (!cancelled) setConceptTags([]);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selectedConcept?.id]);

  const reloadConceptTags = async (conceptId: string) => {
    const result = await learningApi.getConceptTags(workspaceId, conceptId);
    setConceptTags(safeArray<any>(result.tags));
  };

  const addTag = async (label: string, options?: { source?: 'user' | 'ai_suggested' | 'system_candidate'; state?: 'candidate' | 'applied'; rationale?: string }) => {
    if (!selectedConcept?.id) return;
    const next = normalizeTag(label);
    if (!next) return;
    setTagSaving(true);
    try {
      await learningApi.addConceptTag({
        workspaceId,
        conceptId: selectedConcept.id,
        label: next,
        source: options?.source || 'user',
        state: options?.state,
        rationale: options?.rationale
      });
      await reloadConceptTags(selectedConcept.id);
      setTagDraft('');
    } finally {
      setTagSaving(false);
    }
  };

  const removeTag = async (tagId: string) => {
    if (!selectedConcept?.id) return;
    setTagSaving(true);
    try {
      await learningApi.deleteConceptTag(workspaceId, selectedConcept.id, tagId);
      await reloadConceptTags(selectedConcept.id);
    } finally {
      setTagSaving(false);
    }
  };

  const suggestTags = async () => {
    if (!selectedConcept?.id) return;
    setTagSuggestionRunning(true);
    try {
      const result = await learningApi.suggestConceptTags({
        workspaceId,
        conceptId: selectedConcept.id,
        question: tagQuestion.trim() || undefined
      });
      const next = safeArray<any>(result.suggestedTags);
      setConceptTags((current) => {
        const byKey = new Map(current.map((item) => [String(item.normalizedLabel || item.label).toLowerCase(), item]));
        next.forEach((item) => {
          const key = String(item.label || '').trim().toLowerCase();
          if (!key) return;
          byKey.set(key, {
            id: `suggested-${key}`,
            label: item.label,
            normalizedLabel: key,
            state: 'candidate',
            sources: ['ai_suggested'],
            rationale: item.rationale || ''
          });
        });
        return Array.from(byKey.values());
      });
    } finally {
      setTagSuggestionRunning(false);
    }
  };

  return (
    <section className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden overscroll-none bg-[#fbfbfa] text-[#202124]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#e5e7eb] bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/workspaces/${workspaceId}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#4d5864] hover:bg-[#f1f3f5]">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-[#4386b5]" />
              <h1 className="truncate text-sm font-semibold">Workspace Knowledge Graph</h1>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#666a70]">
              {graph.nodes.length} concepts · {graph.edges.length} relations · {integration?.continueLearning?.nextStepTitle || 'full-screen graph workspace'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={tagQuery}
            onChange={(event) => setTagQuery(event.target.value)}
            placeholder="Tag 过滤"
            className="h-9 w-32 rounded-lg border border-[#d8dde4] px-3 text-sm outline-none focus:border-[#202124]"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || Boolean(actionRunning)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8dde4] bg-white px-3 text-sm font-medium text-[#34373c] hover:bg-[#f1f3f5] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void runBuildGraph()}
            disabled={loading || Boolean(actionRunning)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white hover:bg-black disabled:opacity-60"
          >
            {actionRunning === 'build' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
            重建课程图谱
          </button>
        </div>
      </header>

      {error ? <div className="shrink-0 border-b border-[#ffd6d6] bg-[#fff7f7] px-4 py-2 text-sm text-[#b42318]">{error}</div> : null}

      <div className="grid h-0 min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,380px)] overflow-hidden overscroll-none">
        <div className="h-full min-h-0 min-w-0 overflow-hidden overscroll-none">
          {graph.nodes.length ? (
            <CosmosKnowledgeGraphWorkbench
              workspaceId={workspaceId}
              workbenchId={workbenchId}
              concepts={graph.nodes}
              edges={graph.edges}
              selectedId={selectedConcept?.id || null}
              onSelectConcept={setSelectedConcept}
              pathIds={pathIds}
              variant="fullscreen"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Network className="mx-auto h-8 w-8 text-[#8a8e94]" />
                <p className="mt-3 text-sm font-medium">还没有可展示的知识图谱</p>
                <p className="mt-2 text-sm text-[#666a70]">索引课程资料或生成学习计划后再刷新。</p>
              </div>
            </div>
          )}
        </div>

        <aside className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden border-l border-[#e5e7eb] bg-white">
          <div className="min-h-0 overflow-y-auto overscroll-contain p-5 pb-12">
            <section className="mb-5 border-b border-[#e5e7eb] pb-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#666a70]">Graph Kernel</p>
            {buildJob ? (
              <div className="mt-3 rounded-md bg-[#f4f5f6] px-3 py-3">
                <p className="text-sm font-medium text-[#202124]">{buildJob.status === 'completed' ? '课程图谱已完成' : buildJob.status === 'failed' ? '课程图谱构建失败' : '课程图谱构建中'}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#d8dde4]">
                  <div
                    className="h-full rounded-full bg-[#4f9f66] transition-all"
                    style={{ width: `${Math.max(4, Math.min(100, Number(buildJob.progress?.percent || 0)))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-[#666a70]">{buildJob.progress?.message || '正在处理...'}</p>
                {buildJob.progress?.currentFileName ? <p className="mt-1 truncate text-xs text-[#34373c]">{buildJob.progress.currentFileName}</p> : null}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runTargetStructure()}
                disabled={loading || Boolean(actionRunning)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#d8dde4] bg-white px-3 text-sm font-medium text-[#34373c] hover:bg-[#f1f3f5] disabled:opacity-60"
              >
                {actionRunning === 'target' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                目标结构
              </button>
              <button
                type="button"
                onClick={() => void runGapAnalysis()}
                disabled={loading || Boolean(actionRunning)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#d8dde4] bg-white px-3 text-sm font-medium text-[#34373c] hover:bg-[#f1f3f5] disabled:opacity-60"
              >
                {actionRunning === 'gap' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                差距分析
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-[#34373c]">
              {buildReport ? (
                <div className="rounded-md bg-[#f4f5f6] px-3 py-2">
                  <p className="font-medium text-[#202124]">课程图谱已重建</p>
                  <p className="mt-1 text-xs text-[#666a70]">
                    concepts {buildReport.graph?.nodes?.length ?? buildReport.conceptsCreated ?? buildReport.conceptCount ?? graph.nodes.length} · relations {buildReport.graph?.edges?.length ?? buildReport.relationsCreated ?? buildReport.relationCount ?? graph.edges.length}
                  </p>
                </div>
              ) : null}
              {targetStructure ? (
                <div className="rounded-md bg-[#f4f5f6] px-3 py-2">
                  <p className="flex items-center gap-2 font-medium text-[#202124]"><Sparkles className="h-3.5 w-3.5 text-[#4386b5]" />目标结构</p>
                  <p className="mt-1 text-xs text-[#666a70]">{targetStructure.nodes?.length || 0} nodes · {targetStructure.edges?.length || 0} edges · confidence {Number(targetStructure.confidence || 0).toFixed(2)}</p>
                </div>
              ) : null}
              {gapAnalysis ? (
                <div className="rounded-md bg-[#f4f5f6] px-3 py-2">
                  <p className="font-medium text-[#202124]">差距分析</p>
                  <p className="mt-1 text-xs text-[#666a70]">
                    covered {gapAnalysis.summary?.coveredCount ?? 0} · gaps {gapAnalysis.summary?.gapCount ?? 0} · blocked {gapAnalysis.summary?.blockedCount ?? 0} · readiness {pct(gapAnalysis.summary?.overallReadiness)}
                  </p>
                  <div className="mt-2 space-y-1">
                    {safeArray<string>(gapAnalysis.nextActions).slice(0, 3).map((action) => (
                      <p key={action} className="truncate text-xs text-[#34373c]">{action}</p>
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
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#666a70]">Concept Detail</p>
                  <h2 className="mt-2 break-words text-2xl font-semibold text-[#202124]">{selectedConcept.title}</h2>
                </div>
                <button type="button" onClick={() => setSelectedConcept(null)} className="rounded-md p-2 text-[#666a70] hover:bg-[#f1f3f5]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 border-y border-[#e5e7eb] py-4">
                <div><p className="text-xs text-[#666a70]">Mastery</p><p className="mt-1 text-sm font-semibold">{pct(selectedConcept.learnerState?.masteryEstimate)}</p></div>
                <div><p className="text-xs text-[#666a70]">Weakness</p><p className="mt-1 text-sm font-semibold">{pct(selectedConcept.learnerState?.weaknessEstimate)}</p></div>
                <div><p className="text-xs text-[#666a70]">Readiness</p><p className="mt-1 text-sm font-semibold">{pct(selectedConcept.learnerState?.readinessEstimate)}</p></div>
              </div>

              <div className="mt-5 space-y-6 text-sm text-[#34373c]">
                <section>
                  <h3 className="text-sm font-semibold text-[#202124]">标签</h3>
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {appliedTags.length ? appliedTags.map((tag) => (
                        <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-[#d8dde4] bg-white px-2 py-1 text-xs text-[#202124]">
                          <Tag className="h-3 w-3 text-[#666a70]" />
                          {tag.label}
                          <button type="button" onClick={() => void removeTag(tag.id)} className="ml-1 text-[#666a70] hover:text-[#202124]">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )) : <p className="text-[#666a70]">暂无已应用标签。</p>}
                    </div>
                    <div className="space-y-2 rounded-md border border-[#e5e7eb] bg-white px-3 py-3">
                      <div className="flex gap-2">
                        <input
                          value={tagDraft}
                          onChange={(event) => setTagDraft(event.target.value)}
                          placeholder="添加标签，如 重点 / 复习 / 收藏"
                          className="h-9 min-w-0 flex-1 rounded-md border border-[#d8dde4] px-3 text-sm outline-none focus:border-[#202124]"
                        />
                        <button
                          type="button"
                          onClick={() => void addTag(tagDraft, { source: 'user', state: 'applied' })}
                          disabled={tagSaving || !tagDraft.trim()}
                          className="inline-flex h-9 items-center gap-1 rounded-md bg-[#202124] px-3 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {tagSaving ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          添加
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={tagQuestion}
                          onChange={(event) => setTagQuestion(event.target.value)}
                          placeholder="问 AI 这个节点该怎么理解"
                          className="h-9 min-w-0 flex-1 rounded-md border border-[#d8dde4] px-3 text-sm outline-none focus:border-[#202124]"
                        />
                        <button
                          type="button"
                          onClick={() => void suggestTags()}
                          disabled={tagSuggestionRunning}
                          className="inline-flex h-9 items-center gap-1 rounded-md border border-[#d8dde4] bg-white px-3 text-sm font-medium text-[#34373c] disabled:opacity-60"
                        >
                          {tagSuggestionRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          AI 建议
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {candidateTags.length ? candidateTags.map((tag) => (
                        <div key={tag.id} className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-[#202124]">{tag.label}</p>
                              {tag.rationale ? <p className="mt-1 text-xs text-[#666a70]">{tag.rationale}</p> : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => void addTag(tag.label, { source: tag.sources?.[0] || 'ai_suggested', state: 'applied', rationale: tag.rationale })}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d8dde4] bg-white px-2 text-xs font-medium text-[#34373c]"
                            >
                              采纳
                            </button>
                          </div>
                        </div>
                      )) : <p className="text-[#666a70]">暂无候选标签。</p>}
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-[#202124]">入边</h3>
                  <div className="mt-2 space-y-2">
                    {incomingEdges.length ? incomingEdges.slice(0, 12).map((edge) => (
                      <p key={edge.id} className="rounded-md bg-[#f4f5f6] px-3 py-2">{relationLabel(edge.relationType)} · {conceptById.get(edge.from)?.title || edge.from}</p>
                    )) : <p className="text-[#666a70]">暂无入边。</p>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[#202124]">出边</h3>
                  <div className="mt-2 space-y-2">
                    {outgoingEdges.length ? outgoingEdges.slice(0, 12).map((edge) => (
                      <p key={edge.id} className="rounded-md bg-[#f4f5f6] px-3 py-2">{relationLabel(edge.relationType)} · {conceptById.get(edge.to)?.title || edge.to}</p>
                    )) : <p className="text-[#666a70]">暂无出边。</p>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[#202124]">常见误区</h3>
                  <div className="mt-2 space-y-2">
                    {selectedConcept.misconceptions?.length ? selectedConcept.misconceptions.map((item) => (
                      <p key={item.title} className="rounded-md bg-[#f4f5f6] px-3 py-2">{item.title}{item.repairHint ? `：${item.repairHint}` : ''}</p>
                    )) : <p className="text-[#666a70]">暂无误区记录。</p>}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-[#202124]">相关资源与任务</h3>
                  <div className="mt-2 space-y-2">
                    {selectedConcept.bindings?.length ? selectedConcept.bindings.map((item, index) => (
                      <p key={`${item.targetType}-${item.targetId}-${index}`} className="rounded-md bg-[#f4f5f6] px-3 py-2">{item.role} · {item.targetType} · {item.targetId}</p>
                    )) : <p className="text-[#666a70]">暂无绑定资源。</p>}
                  </div>
                </section>
              </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-[#666a70]">
                <div>
                  <Network className="mx-auto h-8 w-8" />
                  <p className="mt-3 font-medium text-[#34373c]">选择一个节点</p>
                  <p className="mt-2 leading-6">点击图中的概念查看前置关系、误区和资源绑定。</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
