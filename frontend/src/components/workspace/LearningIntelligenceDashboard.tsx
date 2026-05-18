import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  History,
  ListTree,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Eye,
  EyeOff,
  Filter,
  LocateFixed,
  Network,
  NotebookTabs,
  Plus,
  PanelRightClose,
  Pin,
  PinOff,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { learningApi } from '../../services/learningApi';
import { mclApi, type MclExecuteResult, type MclLearningPlanStep } from '../../services/mclApi';
import MarkdownPreview from '../workbench/MarkdownPreview';

type IntelligenceSection = 'overview' | 'knowledge' | 'diagnosis' | 'planning' | 'memory';
type KnowledgeView = 'graph' | 'list' | 'path';
type PlanningView = 'plans' | 'steps' | 'feedback';
type MemoryView = 'events' | 'observations' | 'stable' | 'versions';

interface LearningIntelligenceDashboardProps {
  workspaceId: string;
  workbenchId?: string;
  workbenches?: Array<{ id: string; title: string }>;
  onOpenWorkbench?: (workbenchId: string) => void;
  onPlanApplied?: () => void;
  onOpenTerminal?: (prompt: string) => void;
}

export interface ConceptNode {
  id: string;
  title: string;
  category?: string;
  difficulty?: number;
  activationScore?: number;
  learnerState?: {
    masteryEstimate?: number;
    weaknessEstimate?: number;
    readinessEstimate?: number;
  } | null;
  bindings?: Array<{ targetType: string; targetId: string; role: string; strength?: number }>;
  misconceptions?: Array<{ title: string; repairHint?: string; severity?: number }>;
}

export interface ConceptEdge {
  id: string;
  from: string;
  to: string;
  relationType: string;
  weight?: number;
  confidence?: number;
}

interface DiagnosisItem {
  concept: { id: string; title: string };
  diagnosis: string;
  masteryEstimate: number;
  weaknessEstimate: number;
  readinessEstimate: number;
  confidence: number;
  misconceptions?: Array<{ title: string; repairHint?: string; severity?: number }>;
  evidenceNeeds?: string[];
}

const sectionItems: Array<{
  id: IntelligenceSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', description: '状态、变化、入口', icon: Sparkles },
  { id: 'knowledge', label: 'Knowledge', description: '概念对象与路径', icon: Network },
  { id: 'diagnosis', label: 'Diagnosis', description: '诊断报告对象', icon: Brain },
  { id: 'planning', label: 'Planning', description: '计划与步骤', icon: Route },
  { id: 'memory', label: 'Memory', description: '记录与画像变更', icon: History }
];

const pct = (value?: number | null) => `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
const score = (value?: number | null) => Number(value ?? 0).toFixed(2);
const formatShortDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};
const clipText = (value: unknown, max = 110) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const cleanNarrative = (value: unknown) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text
    .replace(/；资源理由：.*$/i, '')
    .replace(/资源理由：.*$/i, '')
    .replace(/适配理由：.*$/i, '')
    .replace(/教学阶段：.*$/i, '')
    .replace(/定位：\{.*$/i, '')
    .replace(/入口：.*$/i, '')
    .replace(/备选：.*$/i, '')
    .replace(/coveredSkills=\d+/gi, '')
    .replace(/prerequisiteSkills=\d+/gi, '')
    .replace(/learnerLevel=[a-z]+/gi, '')
    .replace(/teachingRole=[a-z_]+/gi, '')
    .replace(/suitableStage=[a-z_]+/gi, '')
    .replace(/matchScore:[0-9.]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[;；]+\s*$/, '')
    .trim();
};

const resourceTypeLabel = (type: string) => {
  if (type === 'document') return '文档';
  if (type === 'video') return '视频';
  if (type === 'exercise') return '题库';
  if (type === 'project') return '实操案例';
  return '资源';
};

const groundingStatusLabel = (value?: string | null) => {
  if (value === 'grounded') return '资料已命中';
  if (value === 'partial') return '部分命中';
  if (value === 'resource_gap') return '资料不足';
  return '资料待确认';
};

const groundingStatusTone = (value?: string | null) => {
  if (value === 'grounded') return 'text-[#2f6f46] bg-[#eef7f0] ring-[#cfe8d4]';
  if (value === 'partial') return 'text-[#8b5a00] bg-[#fff7e6] ring-[#fedf9b]';
  if (value === 'resource_gap') return 'text-[#b54708] bg-[#fff7ed] ring-[#fed7aa]';
  return 'text-[#55585d] bg-[#f5f5f3] ring-[#e5e5df]';
};

const stepPlanNarrative = (step: MclLearningPlanStep) => {
  const fragments = [
    step.stepDetail?.learningGoal,
    step.learningGoal,
    step.stepDetail?.whyThisStep,
    step.whyThisStage,
    step.rationale
  ]
    .map((value) => cleanNarrative(value))
    .filter(Boolean);

  if (!fragments.length) return '这一阶段先处理当前最关键的学习任务。';

  const deduped = Array.from(new Set(fragments));
  return deduped.slice(0, 2).join(' ');
};

const stepNextAction = (step: MclLearningPlanStep) => {
  const nextStep = cleanNarrative(step.stepDetail?.dynamicAdjustment?.nextStep || '');
  if (nextStep) return nextStep;
  return cleanNarrative(step.unlockCondition || step.successCriteria?.[0] || '完成后进入下一步。');
};

const stepGroundingStatus = (step: MclLearningPlanStep) =>
  step.groundingStatus || step.resourceGrounding?.status || (safeArray(step.resourceOptions).length ? 'partial' : undefined);

type StructuredStage = NonNullable<NonNullable<MclExecuteResult['plan']>['structuredPlan']>['stages'][number];

const planTypeLabel = (value?: string) => {
  if (value === 'time_limited') return '时间受限';
  if (value === 'exam') return '备考冲刺';
  if (value === 'project') return '项目导向';
  if (value === 'weakness_focused') return '补弱';
  if (value === 'mixed') return '混合场景';
  return '普通学习';
};

const planDisplayTitle = (plan: any) => cleanNarrative(plan?.structuredPlan?.objective || plan?.objective || plan?.structuredPlan?.title || '学习计划');
const planStageCount = (plan: any) => safeArray(plan?.structuredPlan?.stages).length || safeArray(plan?.steps).length;
const structuredStageId = (stage: { order?: number }, index: number) => `structured-${stage.order || index + 1}`;
const stageDurationHint = (stage: StructuredStage) => {
  const text = `${stage.title} ${stage.display?.narrative || ''} ${stage.display?.summary || ''}`;
  return text.match(/第?\s*\d+\s*-\s*\d+\s*天/)?.[0] || text.match(/\d+\s*天/)?.[0] || text.match(/\d+\s*周/)?.[0] || '';
};

const formatMatchScore = (value: number) => {
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
};

const normalizeGroundingMatches = (step: MclLearningPlanStep) => {
  const fromGrounding = safeArray<any>(step.resourceGrounding?.matches).map((match, index) => ({
    id: match?.resourceId || match?.resourceUnitId || match?.resourceTitle || `grounding-${index}`,
    title: cleanNarrative(match?.resourceUnitTitle || match?.resourceTitle || '未命名资料'),
    source: cleanNarrative(match?.resourceTitle || match?.resourceUnitTitle || '上传资料'),
    location: cleanNarrative(match?.resourceEntryPoint || match?.resourceLocator?.headingPath?.slice?.(-1)?.[0] || match?.resourceLocator?.page || ''),
    reason: cleanNarrative(match?.reason || '该资料可支撑当前步骤。'),
    matchScore: typeof match?.matchScore === 'number' ? match.matchScore : undefined,
    evidence: safeArray<any>(match?.acceptedEvidence),
    snippets: safeArray<string>(match?.evidenceSnippets),
    missingClaims: safeArray<string>(match?.missingClaims)
  }));

  if (fromGrounding.length) return fromGrounding;

  const fromOptions = safeArray<any>(step.resourceOptions).map((item, index) => ({
    id: item?.resourceUnitId || item?.resourceTitle || item?.resourceEntryPoint || `option-${index}`,
    title: cleanNarrative(item?.resourceUnitTitle || item?.resourceTitle || '候选资料'),
    source: cleanNarrative(item?.resourceTitle || item?.resourceUnitTitle || '上传资料'),
    location: cleanNarrative(item?.resourceEntryPoint || '未提供'),
    reason: cleanNarrative(item?.reason || '该资料可作为当前步骤的支撑。'),
    matchScore: typeof item?.matchScore === 'number' ? item.matchScore : undefined,
    evidence: safeArray<any>(item?.acceptedEvidence),
    snippets: safeArray<string>(item?.evidenceSnippets),
    missingClaims: safeArray<string>(item?.missingClaims)
  }));

  if (fromOptions.length) return fromOptions;

  const fromDetail = Object.entries(step.stepDetail?.recommendedResources || {}).flatMap(([type, items]) =>
    safeArray<any>(items).map((item, index) => ({
      id: item?.id || item?.name || `${type}-${index}`,
      title: cleanNarrative(item?.name || `${resourceTypeLabel(type)}资料`),
      source: cleanNarrative(item?.source || '上传资料'),
      location: cleanNarrative(item?.location || '未提供'),
      reason: cleanNarrative(item?.matchReason || '该资料可支撑当前步骤。'),
      matchScore: undefined,
      evidence: [],
      snippets: [],
      missingClaims: []
    }))
  );

  return fromDetail;
};

const stateTone = (concept?: ConceptNode) => {
  const learner = concept?.learnerState;
  if ((learner?.weaknessEstimate ?? 0) >= 0.62) return 'text-[#b54708] bg-[#fff7ed] ring-[#fed7aa]';
  if ((learner?.masteryEstimate ?? 0) >= 0.72) return 'text-[#2f6f46] bg-[#eef7f0] ring-[#cfe8d4]';
  return 'text-[#55585d] bg-[#f5f5f3] ring-[#e5e5df]';
};

const diagnosisLabel = (value: string) => {
  if (value === 'weak') return '薄弱';
  if (value === 'mastered') return '已掌握';
  if (value === 'prerequisite_gap') return '前置缺口';
  return '发展中';
};

const diagnosisTone = (value: string) => {
  if (value === 'weak' || value === 'prerequisite_gap') return 'text-[#b54708] bg-[#fff7ed] ring-[#fed7aa]';
  if (value === 'mastered') return 'text-[#2f6f46] bg-[#eef7f0] ring-[#cfe8d4]';
  return 'text-[#55585d] bg-[#f5f5f3] ring-[#e5e5df]';
};

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const courseGraphBuildJobStorageKey = (workspaceId: string, workbenchId?: string) =>
  `course-graph-build-job:${workspaceId}:${workbenchId || 'workspace'}`;
type GraphScope = 'connected' | 'local' | 'all';
type GraphGroup = 'weak' | 'ready' | 'mastered' | 'neutral';

interface GraphPrefs {
  scope: GraphScope;
  localDepth: number;
  showNodeLabels: boolean;
  showEdgeLabels: boolean;
  nodeScale: number;
  edgeScale: number;
  repelForce: number;
  linkDistance: number;
  centerForce: number;
  visibleRelations: string[];
  visibleGroups: GraphGroup[];
  localRootId: string | null;
}

interface GraphLayoutCache {
  version: 1;
  zoom?: number;
  pan?: { x: number; y: number };
  positions: Record<string, { x: number; y: number }>;
}

interface GraphEnergyParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: number;
  phase: number;
}

interface GraphEnergyState {
  focusId: string | null;
  hoverId: string | null;
  burstStartedAt: number;
  pulseStartedAt: number;
  particles: GraphEnergyParticle[];
}

let cytoscapeFcoseRegistered = false;
if (!cytoscapeFcoseRegistered) {
  cytoscape.use(fcose);
  cytoscapeFcoseRegistered = true;
}

const DEFAULT_VISIBLE_RELATIONS = ['prerequisite', 'part_of', 'related', 'assesses', 'remediates', 'supports'];
const DEFAULT_VISIBLE_GROUPS: GraphGroup[] = ['weak', 'ready', 'mastered', 'neutral'];
const DEFAULT_GRAPH_PREFS: GraphPrefs = {
  scope: 'connected',
  localDepth: 2,
  showNodeLabels: true,
  showEdgeLabels: true,
  nodeScale: 1,
  edgeScale: 1,
  repelForce: 1,
  linkDistance: 1,
  centerForce: 1,
  visibleRelations: [...DEFAULT_VISIBLE_RELATIONS],
  visibleGroups: [...DEFAULT_VISIBLE_GROUPS],
  localRootId: null
};

const graphPrefsKey = (workspaceId: string, workbenchId?: string) =>
  `learning-intelligence:graph-prefs:${workspaceId}:${workbenchId || 'workspace'}`;

const graphLayoutKey = (workspaceId: string, workbenchId?: string) =>
  `learning-intelligence:graph-layout:${workspaceId}:${workbenchId || 'workspace'}`;

const loadGraphPrefs = (workspaceId: string, workbenchId?: string): GraphPrefs => {
  if (typeof window === 'undefined') return DEFAULT_GRAPH_PREFS;
  try {
    const raw = window.localStorage.getItem(graphPrefsKey(workspaceId, workbenchId));
    if (!raw) return DEFAULT_GRAPH_PREFS;
    const parsed = JSON.parse(raw) as Partial<GraphPrefs>;
    return {
      ...DEFAULT_GRAPH_PREFS,
      ...parsed,
      visibleRelations: safeArray<string>(parsed.visibleRelations).length ? safeArray<string>(parsed.visibleRelations) : [...DEFAULT_VISIBLE_RELATIONS],
      visibleGroups: safeArray<GraphGroup>(parsed.visibleGroups).length ? safeArray<GraphGroup>(parsed.visibleGroups) : [...DEFAULT_VISIBLE_GROUPS]
    };
  } catch {
    return DEFAULT_GRAPH_PREFS;
  }
};

const loadGraphLayout = (workspaceId: string, workbenchId?: string): GraphLayoutCache => {
  if (typeof window === 'undefined') return { version: 1, positions: {} };
  try {
    const raw = window.localStorage.getItem(graphLayoutKey(workspaceId, workbenchId));
    if (!raw) return { version: 1, positions: {} };
    const parsed = JSON.parse(raw) as GraphLayoutCache;
    return { version: 1, positions: parsed.positions || {}, zoom: parsed.zoom, pan: parsed.pan };
  } catch {
    return { version: 1, positions: {} };
  }
};

const saveJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore localStorage quota and privacy errors
  }
};

const relationMeta = (type: string) => {
  if (type === 'prerequisite') return { label: '前置', stroke: '#9bd889', dash: '', marker: 'arrow-prerequisite' };
  if (type === 'part_of') return { label: '组成', stroke: '#b9a7ff', dash: '5 4', marker: 'arrow-part' };
  if (type === 'assesses') return { label: '测评', stroke: '#ffb86c', dash: '2 4', marker: 'arrow-assesses' };
  if (type === 'remediates') return { label: '补救', stroke: '#ff7b72', dash: '7 4', marker: 'arrow-remediates' };
  if (type === 'supports') return { label: '支持', stroke: '#7cc7ff', dash: '4 4', marker: 'arrow-supports' };
  return { label: '相关', stroke: '#a5b4c6', dash: '', marker: 'arrow-related' };
};

const conceptGroup = (node: ConceptNode) => {
  const learner = node.learnerState;
  if ((learner?.weaknessEstimate ?? 0) >= 0.62) return 'weak';
  if ((learner?.masteryEstimate ?? 0) >= 0.72) return 'mastered';
  if ((learner?.readinessEstimate ?? 0) >= 0.62) return 'ready';
  return 'neutral';
};

const groupTone = (group: string) => {
  if (group === 'weak') return { fill: '#3d2518', stroke: '#ffb86c', text: '#ffd2a3', label: '薄弱' };
  if (group === 'mastered') return { fill: '#1f3327', stroke: '#7ee787', text: '#b8f2bf', label: '已掌握' };
  if (group === 'ready') return { fill: '#17343b', stroke: '#7dd3fc', text: '#b8ecff', label: '准备好' };
  return { fill: '#22262d', stroke: '#8b949e', text: '#c9d1d9', label: '普通' };
};

const truncateLabel = (value: string, max = 14) => {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const matchesGraphQuery = (node: ConceptNode, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return [node.title, node.category, node.id].some((value) => String(value || '').toLowerCase().includes(q));
};

const localNodeIdsFor = (rootId: string, edges: ConceptEdge[], depth: number) => {
  const selected = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);
  for (let hop = 0; hop < Math.max(1, depth); hop += 1) {
    const next = new Set<string>();
    edges.forEach((edge) => {
      if (frontier.has(edge.from) && !selected.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !selected.has(edge.from)) next.add(edge.from);
    });
    next.forEach((id) => selected.add(id));
    frontier = next;
    if (!frontier.size) break;
  }
  return selected;
};

const graphElementsFor = (
  concepts: ConceptNode[],
  edges: ConceptEdge[],
  pathIds: string[],
  scope: GraphScope,
  localDepth: number,
  localRootId?: string | null,
  searchTerm = '',
  layoutPositions: Record<string, { x: number; y: number }> = {}
): ElementDefinition[] => {
  const candidate = concepts.slice(0, 120);
  const candidateIds = new Set(candidate.map((node) => node.id));
  const candidateEdges = edges.filter((edge) => candidateIds.has(edge.from) && candidateIds.has(edge.to)).slice(0, 260);
  const degree = new Map<string, number>();
  candidateEdges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });
  const pathSet = new Set(pathIds);
  const searchSet = new Set(candidate.filter((node) => matchesGraphQuery(node, searchTerm)).map((node) => node.id));
  let selectedIds = new Set(
    candidate
      .filter((node) => scope === 'all' || (degree.get(node.id) || 0) > 0 || pathSet.has(node.id) || searchSet.has(node.id))
      .map((node) => node.id)
  );
  if (scope === 'local' && localRootId && candidateIds.has(localRootId)) {
    selectedIds = localNodeIdsFor(localRootId, candidateEdges, localDepth);
  } else if (searchSet.size) {
    selectedIds = new Set(searchSet);
    searchSet.forEach((id) => {
      localNodeIdsFor(id, candidateEdges, 1).forEach((neighborId) => selectedIds.add(neighborId));
    });
  }
  if (!selectedIds.size) {
    candidate.slice(0, 36).forEach((node) => selectedIds.add(node.id));
  }
  const selected = candidate.filter((node) => selectedIds.has(node.id)).slice(0, scope === 'all' ? 100 : 64);
  const selectedSet = new Set(selected.map((node) => node.id));
  const visibleEdges = candidateEdges.filter((edge) => selectedSet.has(edge.from) && selectedSet.has(edge.to));
  return [
    ...selected.map((node) => ({
      group: 'nodes' as const,
      data: {
        id: node.id,
        label: truncateLabel(node.title, 18),
        fullLabel: node.title,
        group: conceptGroup(node),
        degree: degree.get(node.id) || 0,
        size: Math.min(48, 24 + (degree.get(node.id) || 0) * 3 + (pathSet.has(node.id) ? 8 : 0)),
        mastery: node.learnerState?.masteryEstimate ?? 0,
        weakness: node.learnerState?.weaknessEstimate ?? 0,
        readiness: node.learnerState?.readinessEstimate ?? 0,
        path: pathSet.has(node.id),
        matched: searchSet.has(node.id),
        pinned: layoutPositions[node.id] ? 'yes' : 'no'
      },
      position: layoutPositions[node.id]
    })),
    ...visibleEdges.map((edge) => ({
      group: 'edges' as const,
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        relationType: edge.relationType,
        label: relationMeta(edge.relationType).label,
        weight: edge.weight ?? 0.6,
        confidence: edge.confidence ?? 0.55,
        path: pathSet.has(edge.from) && pathSet.has(edge.to)
      }
    }))
  ];
};

function RowButton({
  children,
  selected,
  onClick
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`group flex w-full items-center gap-3 border-b border-[#eeeeeb] px-3 py-3 text-left transition last:border-b-0 hover:bg-[#f7f7f5] ${
        selected ? 'bg-[#f1f1ef]' : ''
      }`}
    >
      {children}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-y border-[#eeeeeb] py-10 text-center">
      <p className="text-sm font-medium text-[#34373c]">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#777b80]">{detail}</p>
    </div>
  );
}

export function KnowledgeGraphWorkbench({
  workspaceId,
  workbenchId,
  concepts,
  edges,
  selectedId,
  pathIds,
  searchTerm = '',
  variant = 'embedded',
  onSelect
}: {
  workspaceId: string;
  workbenchId?: string;
  concepts: ConceptNode[];
  edges: ConceptEdge[];
  selectedId?: string | null;
  pathIds: string[];
  searchTerm?: string;
  variant?: 'embedded' | 'fullscreen';
  onSelect: (concept: ConceptNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const energyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const selectedNodeIdRef = useRef<string | null>(selectedId || null);
  const energyStateRef = useRef<GraphEnergyState>({
    focusId: selectedId || null,
    hoverId: null,
    burstStartedAt: performance.now(),
    pulseStartedAt: performance.now(),
    particles: []
  });
  const conceptById = useMemo(() => new Map(concepts.map((concept) => [concept.id, concept])), [concepts]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(selectedId || null);
  const [prefs, setPrefs] = useState<GraphPrefs>(() => loadGraphPrefs(workspaceId, workbenchId));
  const [layoutCache, setLayoutCache] = useState<GraphLayoutCache>(() => loadGraphLayout(workspaceId, workbenchId));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [showControls, setShowControls] = useState(true);
  const elements = useMemo(
    () => graphElementsFor(concepts, edges, pathIds, prefs.scope, prefs.localDepth, prefs.localRootId || selectedNodeId, searchTerm, layoutCache.positions),
    [concepts, edges, pathIds, prefs.scope, prefs.localDepth, prefs.localRootId, selectedNodeId, searchTerm, layoutCache.positions]
  );
  const graphSignature = elements.map((element) => `${element.group}:${element.data.id}`).join('|');
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const hasGraph = elements.some((element) => element.group === 'nodes');
  const visibleRelations = useMemo(() => new Set(prefs.visibleRelations), [prefs.visibleRelations]);
  const visibleGroups = useMemo(() => new Set(prefs.visibleGroups), [prefs.visibleGroups]);
  const layoutStorageKey = graphLayoutKey(workspaceId, workbenchId);
  const prefsStorageKey = graphPrefsKey(workspaceId, workbenchId);

  const patchPrefs = (patch: Partial<GraphPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      saveJson(prefsStorageKey, next);
      return next;
    });
  };

  const persistLayout = (cy = cyRef.current) => {
    if (!cy) return;
    const positions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node) => {
      const position = node.position();
      positions[node.id()] = { x: Math.round(position.x), y: Math.round(position.y) };
    });
    const next = { version: 1 as const, positions, zoom: cy.zoom(), pan: cy.pan() };
    setLayoutCache(next);
    saveJson(layoutStorageKey, next);
  };

  const triggerEnergyFocus = (nodeId: string | null, mode: 'hover' | 'select' | 'clear' = 'select') => {
    const now = performance.now();
    energyStateRef.current.focusId = nodeId;
    energyStateRef.current.hoverId = mode === 'hover' ? nodeId : null;
    energyStateRef.current.burstStartedAt = now;
    energyStateRef.current.pulseStartedAt = now;
  };

  const spawnEnergyBurst = (nodeId: string, count = 34) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (node.empty()) return;
    const position = node.renderedPosition();
    const particles = energyStateRef.current.particles;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
      const speed = 0.28 + Math.random() * 1.15;
      particles.push({
        x: position.x,
        y: position.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.1 + Math.random() * 2.2,
        alpha: 0.85,
        hue: 188 + Math.random() * 70,
        phase: Math.random() * Math.PI * 2
      });
    }
    if (particles.length > 260) particles.splice(0, particles.length - 260);
  };

  useEffect(() => {
    setSelectedNodeId(selectedId || null);
  }, [selectedId]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    if (selectedNodeId) triggerEnergyFocus(selectedNodeId, 'select');
  }, [selectedNodeId]);

  useEffect(() => {
    const canvas = energyCanvasRef.current;
    if (!canvas || !hasGraph) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    let lastTime = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * scale));
      const height = Math.max(1, Math.floor(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const drawGlowLine = (
      source: { x: number; y: number },
      target: { x: number; y: number },
      alpha: number,
      color: string,
      width: number,
      dashOffset = 0
    ) => {
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.lineWidth = width;
      context.lineCap = 'round';
      context.setLineDash([2, 10]);
      context.lineDashOffset = -dashOffset;
      context.shadowColor = color;
      context.shadowBlur = 16;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.stroke();
      context.restore();
    };

    const draw = (now: number) => {
      resize();
      const rect = canvas.getBoundingClientRect();
      const elapsed = Math.min(48, now - lastTime);
      lastTime = now;
      context.clearRect(0, 0, rect.width, rect.height);

      const cy = cyRef.current;
      const energy = energyStateRef.current;
      const t = now * 0.001;

      context.save();
      for (let index = 0; index < 84; index += 1) {
        const x = ((index * 137.7 + Math.sin(t * 0.33 + index) * 18) % Math.max(1, rect.width));
        const y = ((index * 83.3 + Math.cos(t * 0.27 + index * 0.7) * 14) % Math.max(1, rect.height));
        const alpha = 0.08 + Math.sin(t * 0.9 + index) * 0.035;
        context.fillStyle = `rgba(125, 211, 252, ${alpha})`;
        context.beginPath();
        context.arc(x, y, index % 7 === 0 ? 1.5 : 0.9, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      if (cy && energy.focusId) {
        const focus = cy.getElementById(energy.focusId);
        if (focus.nonempty() && focus.visible()) {
          const focusPosition = focus.renderedPosition();
          const burstAge = Math.max(0, now - energy.burstStartedAt);
          const reveal = Math.min(1, burstAge / 460);
          const breathing = 1 + Math.sin(t * 3.2) * 0.045;
          const radius = (42 + reveal * 82) * breathing;

          const gradient = context.createRadialGradient(focusPosition.x, focusPosition.y, 4, focusPosition.x, focusPosition.y, radius);
          gradient.addColorStop(0, `rgba(240, 246, 252, ${0.34 * (1 - reveal * 0.25)})`);
          gradient.addColorStop(0.24, 'rgba(125, 211, 252, 0.2)');
          gradient.addColorStop(0.72, 'rgba(185, 167, 255, 0.07)');
          gradient.addColorStop(1, 'rgba(125, 211, 252, 0)');
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(focusPosition.x, focusPosition.y, radius, 0, Math.PI * 2);
          context.fill();

          const firstHop = focus.neighborhood('node:visible');
          const connectedEdges = focus.connectedEdges(':visible');
          connectedEdges.forEach((edge: any, edgeIndex: number) => {
            const source = edge.source().renderedPosition();
            const target = edge.target().renderedPosition();
            const phase = (now - energy.pulseStartedAt) * 0.11 + edgeIndex * 21;
            drawGlowLine(source, target, 0.15 + reveal * 0.45, 'rgba(240, 246, 252, 0.92)', 1.2 + reveal * 2.1, phase);

            const p = ((phase % 100) / 100);
            const px = source.x + (target.x - source.x) * p;
            const py = source.y + (target.y - source.y) * p;
            context.save();
            context.shadowColor = '#f0f6fc';
            context.shadowBlur = 18;
            context.fillStyle = 'rgba(240, 246, 252, 0.9)';
            context.beginPath();
            context.arc(px, py, 2.2 + reveal * 1.4, 0, Math.PI * 2);
            context.fill();
            context.restore();
          });

          firstHop.forEach((node: any, index: number) => {
            const position = node.renderedPosition();
            const delay = Math.min(1, Math.max(0, (burstAge - index * 22) / 360));
            if (delay <= 0) return;
            const orbitRadius = 15 + Math.sin(t * 2 + index) * 2.6;
            context.save();
            context.globalAlpha = delay * 0.75;
            context.strokeStyle = 'rgba(247, 215, 116, 0.5)';
            context.lineWidth = 1;
            context.shadowColor = '#f7d774';
            context.shadowBlur = 10;
            context.beginPath();
            context.arc(position.x, position.y, orbitRadius, 0, Math.PI * 2);
            context.stroke();
            context.restore();
          });
        }
      }

      const particles = energy.particles;
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.x += particle.vx * elapsed;
        particle.y += particle.vy * elapsed;
        particle.vx *= 0.986;
        particle.vy *= 0.986;
        particle.alpha -= elapsed * 0.0017;
        particle.phase += elapsed * 0.008;
        if (particle.alpha <= 0) {
          particles.splice(index, 1);
          continue;
        }
        context.save();
        context.globalAlpha = particle.alpha;
        context.fillStyle = `hsla(${particle.hue}, 90%, 72%, 0.9)`;
        context.shadowColor = `hsla(${particle.hue}, 90%, 72%, 0.8)`;
        context.shadowBlur = 11;
        context.beginPath();
        context.arc(particle.x + Math.sin(particle.phase) * 3, particle.y + Math.cos(particle.phase) * 3, particle.size, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [hasGraph, graphSignature]);

  useEffect(() => {
    const nextPrefs = loadGraphPrefs(workspaceId, workbenchId);
    const nextLayout = loadGraphLayout(workspaceId, workbenchId);
    setPrefs(nextPrefs);
    setLayoutCache(nextLayout);
    setSelectedNodeId(selectedId || nextPrefs.localRootId || null);
  }, [workspaceId, workbenchId]);

  useEffect(() => {
    if (!containerRef.current || !hasGraph) return;
    const usePreset = elements.some((element) => element.group === 'nodes' && element.position);
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.25,
      maxZoom: 3,
      wheelSensitivity: 0.18,
      boxSelectionEnabled: false,
      autoungrabify: false,
      style: ([
        {
          selector: 'core',
          style: { 'active-bg-opacity': 0 }
        },
        {
          selector: 'node',
          style: {
            width: (ele: any) => Number(ele.data('size') || 28) * prefs.nodeScale,
            height: (ele: any) => Number(ele.data('size') || 28) * prefs.nodeScale,
            label: (ele: any) => prefs.showNodeLabels && (ele.data('degree') >= 3 || ele.data('path') || ele.data('matched')) ? ele.data('label') : '',
            'font-size': 10.5,
            'font-weight': 600,
            'text-margin-y': 11,
            'text-wrap': 'wrap',
            'text-max-width': 132,
            'text-background-color': '#101820',
            'text-background-opacity': 0.72,
            'text-background-padding': 5,
            'text-border-color': '#30363d',
            'text-border-width': 1,
            'text-border-opacity': 0.75,
            color: '#d6deeb',
            'background-color': '#22262d',
            'border-color': '#8b949e',
            'border-width': 2.2,
            'shadow-blur': 14,
            'shadow-opacity': 0.22,
            'shadow-color': '#8b949e',
            'overlay-opacity': 0,
            'transition-property': 'opacity, background-color, border-color, width, height, line-color, target-arrow-color',
            'transition-duration': 120
          }
        },
        {
          selector: 'node[group = "weak"]',
          style: { 'background-color': '#3d2518', 'border-color': '#ffb86c', 'shadow-color': '#ffb86c' }
        },
        {
          selector: 'node[group = "ready"]',
          style: { 'background-color': '#17343b', 'border-color': '#7dd3fc', 'shadow-color': '#7dd3fc' }
        },
        {
          selector: 'node[group = "mastered"]',
          style: { 'background-color': '#1f3327', 'border-color': '#7ee787', 'shadow-color': '#7ee787' }
        },
        {
          selector: 'node[path]',
          style: { 'border-color': '#f0f6fc', 'border-width': 3.5, 'shadow-opacity': 0.5 }
        },
        {
          selector: 'node[matched]',
          style: {
            'background-color': '#2a3340',
            'border-color': '#f7d774',
            'border-width': 4.2,
            'shadow-color': '#f7d774',
            'shadow-opacity': 0.72,
            'shadow-blur': 30,
            label: 'data(label)',
            'z-index': 16
          }
        },
        {
          selector: 'node[pinned = "yes"]',
          style: {
            'border-style': 'double',
            'border-width': 4
          }
        },
        {
          selector: 'edge',
          style: {
            width: (ele: any) => Math.max(2.4, Math.min(8, Number(ele.data('weight') || 0.6) * 5.8 * prefs.edgeScale)),
            'curve-style': 'bezier',
            'control-point-step-size': 38,
            'line-color': '#4f5b69',
            'target-arrow-color': '#4f5b69',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.05,
            opacity: 0.34,
            label: (ele: any) => prefs.showEdgeLabels && ele.data('path') ? ele.data('label') : '',
            'font-size': 9,
            'font-weight': 600,
            color: '#c9d1d9',
            'text-background-color': '#0f141b',
            'text-background-opacity': 0.82,
            'text-background-padding': 3,
            'text-rotation': 'autorotate',
            'line-style': 'solid'
          }
        },
        { selector: 'edge[relationType = "prerequisite"]', style: { 'line-color': '#6fae78', 'target-arrow-color': '#6fae78', width: 3.6 } },
        { selector: 'edge[relationType = "part_of"]', style: { 'line-color': '#8f7fe0', 'target-arrow-color': '#8f7fe0', 'line-style': 'dashed' } },
        { selector: 'edge[relationType = "assesses"]', style: { 'line-color': '#c98642', 'target-arrow-color': '#c98642', 'line-style': 'dotted' } },
        { selector: 'edge[relationType = "remediates"]', style: { 'line-color': '#d15f5f', 'target-arrow-color': '#d15f5f', 'line-style': 'dashed' } },
        { selector: 'edge[relationType = "supports"]', style: { 'line-color': '#579ed1', 'target-arrow-color': '#579ed1' } },
        { selector: 'edge[path]', style: { 'line-color': '#f0f6fc', 'target-arrow-color': '#f0f6fc', width: 6.5, opacity: 1, 'z-index': 5 } },
        { selector: '.faded', style: { opacity: 0.035, label: '' } },
        { selector: '.neighbor', style: { opacity: 0.55 } },
        { selector: '.neighbor-1', style: { opacity: 1, label: 'data(label)', 'border-width': 3.2, 'shadow-opacity': 0.42, 'shadow-blur': 22 } },
        { selector: '.neighbor-2', style: { opacity: 0.42, 'border-width': 2.4, 'shadow-opacity': 0.16 } },
        { selector: '.hidden-filter', style: { display: 'none' } },
        {
          selector: '.focused',
          style: {
            'border-color': '#f0f6fc',
            'border-width': 4.6,
            label: 'data(label)',
            'text-background-opacity': 0.96,
            'shadow-blur': 28,
            'shadow-opacity': 0.72,
            'shadow-color': '#f0f6fc',
            'z-index': 20
          }
        },
        {
          selector: 'edge.focused',
          style: {
            opacity: 1,
            width: 8.5,
            label: 'data(label)',
            'z-index': 18
          }
        },
        {
          selector: 'edge.neighbor-1',
          style: {
            opacity: 0.92,
            width: 5.8,
            label: 'data(label)'
          }
        },
        {
          selector: 'edge.neighbor-2',
          style: {
            opacity: 0.28,
            width: 2.8
          }
        },
        { selector: 'edge.search-path', style: { opacity: 1, width: 7, 'line-color': '#f7d774', 'target-arrow-color': '#f7d774', 'z-index': 17 } }
      ] as any),
      layout: {
        name: usePreset ? 'preset' : 'fcose',
        quality: 'proof',
        randomize: !usePreset,
        animate: !usePreset,
        animationDuration: 420,
        fit: !usePreset,
        padding: 70,
        nodeRepulsion: 12000 * prefs.repelForce,
        idealEdgeLength: (edge: any) => (edge.data('relationType') === 'prerequisite' ? 190 : 142) * prefs.linkDistance,
        edgeElasticity: 0.24,
        nestingFactor: 0.1,
        gravity: 0.07 * prefs.centerForce,
        gravityRangeCompound: 1.5,
        gravityCompound: 0.6,
        numIter: 3200,
        tile: prefs.scope === 'all'
      } as any
    });

    cyRef.current = cy;
    const updateStats = () => setStats({
      nodes: cy.nodes(':visible').length,
      edges: cy.edges(':visible').length
    });
    updateStats();
    if (usePreset && layoutCache.zoom && layoutCache.pan) {
      cy.zoom(layoutCache.zoom);
      cy.pan(layoutCache.pan);
    }

    const clearFocus = () => {
      cy.elements().removeClass('faded neighbor neighbor-1 neighbor-2 focused search-path');
      setSelectedNodeId(null);
      setContextMenu(null);
      triggerEnergyFocus(null, 'clear');
    };
    const focusNode = (node: any, persist = false, zoom = false, mode: 'hover' | 'select' = 'hover') => {
      const oneHop = node.closedNeighborhood();
      const twoHop = oneHop.neighborhood('node').closedNeighborhood();
      cy.elements().addClass('faded').removeClass('neighbor neighbor-1 neighbor-2 focused search-path');
      oneHop.removeClass('faded').addClass('neighbor neighbor-1');
      twoHop.removeClass('faded').addClass('neighbor neighbor-2');
      node.removeClass('neighbor neighbor-1 neighbor-2').addClass('focused');
      node.connectedEdges().addClass('focused');
      oneHop.connectedEdges().difference(node.connectedEdges()).addClass('neighbor-1');
      twoHop.connectedEdges().difference(node.connectedEdges()).addClass('neighbor-2');
      if (persist) {
        setSelectedNodeId(node.id());
        const concept = conceptById.get(node.id());
        if (concept) onSelect(concept);
      }
      triggerEnergyFocus(node.id(), mode);
      if (mode === 'select') spawnEnergyBurst(node.id(), 42);
      if (zoom) {
        cy.animate({ fit: { eles: oneHop, padding: 90 } }, { duration: 280 });
      }
    };

    cy.on('mouseover', 'node', (event) => focusNode(event.target, false, false, 'hover'));
    cy.on('mouseout', 'node', () => {
      if (selectedNodeIdRef.current) {
        const node = cy.getElementById(selectedNodeIdRef.current);
        if (node.nonempty()) focusNode(node, true, false, 'select');
      } else {
        cy.elements().removeClass('faded neighbor neighbor-1 neighbor-2 focused search-path');
        triggerEnergyFocus(null, 'clear');
      }
    });
    cy.on('tap', 'node', (event) => {
      setContextMenu(null);
      focusNode(event.target, true, true, 'select');
    });
    cy.on('cxttap', 'node', (event) => {
      const node = event.target;
      setSelectedNodeId(node.id());
      focusNode(node, true, true, 'select');
      setContextMenu({ x: event.renderedPosition.x, y: event.renderedPosition.y, nodeId: node.id() });
    });
    cy.on('tap', (event) => {
      if (event.target === cy) clearFocus();
    });
    cy.on('grab', 'node', (event) => {
      triggerEnergyFocus(event.target.id(), 'select');
      spawnEnergyBurst(event.target.id(), 18);
    });
    cy.on('free', 'node', (event) => {
      triggerEnergyFocus(event.target.id(), 'select');
    });
    cy.on('position', 'node', (event) => {
      if (selectedNodeIdRef.current === event.target.id()) {
        triggerEnergyFocus(event.target.id(), 'select');
      }
    });
    cy.on('dragfree', 'node', () => persistLayout(cy));
    cy.on('zoom pan', () => {
      window.clearTimeout((persistLayout as any).timer);
      (persistLayout as any).timer = window.setTimeout(() => persistLayout(cy), 240);
    });
    cy.on('layoutstop', () => {
      updateStats();
      persistLayout(cy);
    });
    cy.on('remove add style', updateStats);

    return () => {
      persistLayout(cy);
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphSignature, prefs.nodeScale, prefs.edgeScale, prefs.repelForce, prefs.linkDistance, prefs.centerForce]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('hidden-filter');
    cy.edges().forEach((edge) => {
      if (!visibleRelations.has(edge.data('relationType'))) edge.addClass('hidden-filter');
    });
    cy.nodes().forEach((node) => {
      if (!visibleGroups.has(node.data('group'))) {
        node.addClass('hidden-filter');
        node.connectedEdges().addClass('hidden-filter');
      }
    });
    setStats({ nodes: cy.nodes(':visible').length, edges: cy.edges(':visible').length });
  }, [visibleRelations, visibleGroups, graphSignature]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((node) => {
      const show = prefs.showNodeLabels && (node.data('degree') >= 3 || node.data('path') || node.data('matched') || node.id() === selectedNodeId);
      node.style('label', show ? node.data('label') : '');
    });
    cy.edges().forEach((edge) => {
      edge.style('label', prefs.showEdgeLabels && (edge.data('path') || edge.hasClass('focused')) ? edge.data('label') : '');
    });
  }, [prefs.showNodeLabels, prefs.showEdgeLabels, selectedNodeId, graphSignature]);

  const fitGraph = () => cyRef.current?.fit(undefined, 70);
  const runLayout = () => {
    const cy = cyRef.current;
    if (!cy) return;
    setLayoutCache({ version: 1, positions: {} });
    saveJson(layoutStorageKey, { version: 1, positions: {} });
    cy.nodes().unlock();
    cy.layout({
      name: 'fcose',
      quality: 'proof',
      animate: true,
      animationDuration: 420,
      fit: true,
      padding: 70,
      nodeRepulsion: 12000 * prefs.repelForce,
      idealEdgeLength: (edge: any) => (edge.data('relationType') === 'prerequisite' ? 190 : 142) * prefs.linkDistance,
      edgeElasticity: 0.24,
      gravity: 0.07 * prefs.centerForce,
      numIter: 2600,
      tile: prefs.scope === 'all'
    } as any).run();
  };
  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: Math.max(0.25, Math.min(3, cy.zoom() * factor)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
    });
  };
  const toggleRelation = (type: string) => {
    const next = new Set(prefs.visibleRelations);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    patchPrefs({ visibleRelations: Array.from(next) });
  };
  const toggleGroup = (group: GraphGroup) => {
    const next = new Set(prefs.visibleGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    patchPrefs({ visibleGroups: Array.from(next) as GraphGroup[] });
  };
  const focusById = (nodeId: string, zoom = true) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (node.empty()) return;
    cy.elements().addClass('faded').removeClass('neighbor neighbor-1 neighbor-2 focused search-path');
    const oneHop = node.closedNeighborhood();
    const twoHop = oneHop.neighborhood('node').closedNeighborhood();
    oneHop.removeClass('faded').addClass('neighbor neighbor-1');
    twoHop.removeClass('faded').addClass('neighbor neighbor-2');
    node.removeClass('neighbor neighbor-1 neighbor-2').addClass('focused');
    node.connectedEdges().addClass('focused');
    oneHop.connectedEdges().difference(node.connectedEdges()).addClass('neighbor-1');
    twoHop.connectedEdges().difference(node.connectedEdges()).addClass('neighbor-2');
    setSelectedNodeId(nodeId);
    const concept = conceptById.get(nodeId);
    if (concept) onSelect(concept);
    triggerEnergyFocus(nodeId, 'select');
    spawnEnergyBurst(nodeId, 42);
    if (zoom) cy.animate({ fit: { eles: oneHop, padding: 90 } }, { duration: 280 });
  };
  const pinNode = (nodeId: string) => {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(nodeId);
    if (node.empty()) return;
    node.lock();
    node.data('pinned', 'yes');
    persistLayout(cy);
  };
  const unpinNode = (nodeId: string) => {
    const next = { ...layoutCache.positions };
    delete next[nodeId];
    const cache = { ...layoutCache, positions: next };
    setLayoutCache(cache);
    saveJson(layoutStorageKey, cache);
    const node = cyRef.current?.getElementById(nodeId);
    node?.unlock();
    node?.data('pinned', 'no');
  };
  const openLocalGraph = (nodeId: string) => {
    patchPrefs({ scope: 'local', localRootId: nodeId });
    setSelectedNodeId(nodeId);
    setContextMenu(null);
    triggerEnergyFocus(nodeId, 'select');
    spawnEnergyBurst(nodeId, 58);
  };
  const resetDisplay = () => {
    patchPrefs({ ...DEFAULT_GRAPH_PREFS, localRootId: selectedNodeId });
  };
  const matchedConcepts = useMemo(
    () => searchTerm.trim() ? concepts.filter((concept) => matchesGraphQuery(concept, searchTerm)).slice(0, 8) : [],
    [concepts, searchTerm]
  );
  const selectedConcept = selectedNodeId ? conceptById.get(selectedNodeId) : null;

  if (!hasGraph) {
    return <EmptyState title="还没有知识结构" detail="上传并索引课程资料，或通过学习现场生成测验和计划后，知识对象会出现在这里。" />;
  }

  const isFullscreen = variant === 'fullscreen';

  return (
    <div className={`overflow-hidden bg-[#0f141b] ${isFullscreen ? 'h-full rounded-none' : 'border-y border-[#202832]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#202832] bg-[#0f141b] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#b7c0cc]">
          {DEFAULT_VISIBLE_RELATIONS.map((type) => {
            const meta = relationMeta(type);
            const enabled = visibleRelations.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleRelation(type)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition ${enabled ? 'bg-[#161b22] text-[#e6edf3] shadow-sm ring-1 ring-[#30363d]' : 'text-[#768390] opacity-60'}`}
                title={`${enabled ? '隐藏' : '显示'}${meta.label}关系`}
              >
                <span className="h-0.5 w-7 rounded-full" style={{ backgroundColor: meta.stroke }} />
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#b7c0cc]">
          {DEFAULT_VISIBLE_GROUPS.map((group) => {
            const tone = groupTone(group);
            const enabled = visibleGroups.has(group);
            return (
              <button
                key={group}
                type="button"
                onClick={() => toggleGroup(group)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition ${enabled ? 'text-[#d6deeb]' : 'text-[#768390] opacity-55'}`}
                title={`${enabled ? '隐藏' : '显示'}${tone.label}节点`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone.fill, boxShadow: `0 0 0 1.5px ${tone.stroke}` }} />
                {tone.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`relative ${isFullscreen ? 'h-full' : 'h-[720px]'} bg-[#0f141b] bg-[radial-gradient(circle_at_1px_1px,#26303a_1.1px,transparent_0)] [background-size:28px_28px]`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_32%_24%,rgba(125,211,252,0.14),transparent_30%),radial-gradient(circle_at_72%_70%,rgba(185,167,255,0.11),transparent_30%)]" />
        <canvas ref={energyCanvasRef} className="pointer-events-none absolute inset-0 z-[1] h-full w-full" />
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-[#30363d] bg-[#161b22]/92 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur">
          <button type="button" onClick={() => zoomBy(1.16)} className="rounded-md p-1.5 text-[#c9d1d9] hover:bg-[#30363d]" title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => zoomBy(0.86)} className="rounded-md p-1.5 text-[#c9d1d9] hover:bg-[#30363d]" title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={fitGraph} className="rounded-md p-1.5 text-[#c9d1d9] hover:bg-[#30363d]" title="Fit graph">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={runLayout} className="rounded-md p-1.5 text-[#c9d1d9] hover:bg-[#30363d]" title="Run force layout">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setShowControls((current) => !current)} className="rounded-md p-1.5 text-[#c9d1d9] hover:bg-[#30363d]" title="Display controls">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-[#30363d]" />
          {(['connected', 'local', 'all'] as GraphScope[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => patchPrefs({ scope: item, localRootId: item === 'local' ? (selectedNodeId || prefs.localRootId) : prefs.localRootId })}
              className={`h-7 rounded-md px-2 text-xs font-medium ${prefs.scope === item ? 'bg-[#e6edf3] text-[#0f141b]' : 'text-[#c9d1d9] hover:bg-[#30363d]'}`}
            >
              {item === 'connected' ? 'Connected' : item === 'local' ? 'Local' : 'All'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => patchPrefs({ showNodeLabels: !prefs.showNodeLabels })}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${prefs.showNodeLabels ? 'bg-[#e6edf3] text-[#0f141b]' : 'text-[#c9d1d9] hover:bg-[#30363d]'}`}
          >
            {prefs.showNodeLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Nodes
          </button>
          <button
            type="button"
            onClick={() => patchPrefs({ showEdgeLabels: !prefs.showEdgeLabels })}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${prefs.showEdgeLabels ? 'bg-[#e6edf3] text-[#0f141b]' : 'text-[#c9d1d9] hover:bg-[#30363d]'}`}
          >
            <Filter className="h-3.5 w-3.5" />
            Edges
          </button>
        </div>

        {showControls ? (
          <div className="absolute right-3 top-3 z-10 w-[286px] rounded-lg border border-[#30363d] bg-[#161b22]/94 p-3 text-xs text-[#c9d1d9] shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-[#e6edf3]">Graph controls</p>
              <button type="button" onClick={resetDisplay} className="rounded-md px-2 py-1 text-[#9da7b3] hover:bg-[#30363d]">Reset</button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 flex justify-between text-[#9da7b3]"><span>Local depth</span><span>{prefs.localDepth}</span></span>
                <input type="range" min={1} max={4} value={prefs.localDepth} onChange={(event) => patchPrefs({ localDepth: Number(event.target.value) })} className="w-full accent-[#7dd3fc]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#9da7b3]"><span>Node size</span><span>{prefs.nodeScale.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.6} step={0.1} value={prefs.nodeScale} onChange={(event) => patchPrefs({ nodeScale: Number(event.target.value) })} className="w-full accent-[#7dd3fc]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#9da7b3]"><span>Link thickness</span><span>{prefs.edgeScale.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.8} step={0.1} value={prefs.edgeScale} onChange={(event) => patchPrefs({ edgeScale: Number(event.target.value) })} className="w-full accent-[#9bd889]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#9da7b3]"><span>Repel force</span><span>{prefs.repelForce.toFixed(1)}x</span></span>
                <input type="range" min={0.6} max={2.2} step={0.1} value={prefs.repelForce} onChange={(event) => patchPrefs({ repelForce: Number(event.target.value) })} className="w-full accent-[#b9a7ff]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#9da7b3]"><span>Link distance</span><span>{prefs.linkDistance.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.8} step={0.1} value={prefs.linkDistance} onChange={(event) => patchPrefs({ linkDistance: Number(event.target.value) })} className="w-full accent-[#ffb86c]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#9da7b3]"><span>Center force</span><span>{prefs.centerForce.toFixed(1)}x</span></span>
                <input type="range" min={0.4} max={1.8} step={0.1} value={prefs.centerForce} onChange={(event) => patchPrefs({ centerForce: Number(event.target.value) })} className="w-full accent-[#ff7b72]" />
              </label>
            </div>
          </div>
        ) : null}

        {matchedConcepts.length ? (
          <div className="absolute left-3 top-16 z-10 w-[280px] rounded-lg border border-[#30363d] bg-[#161b22]/92 p-2 text-xs text-[#c9d1d9] shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur">
            <p className="px-2 pb-1 text-[#9da7b3]">Search results</p>
            {matchedConcepts.map((concept) => (
              <button key={concept.id} type="button" onClick={() => focusById(concept.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#30363d]">
                <Search className="h-3.5 w-3.5 text-[#f7d774]" />
                <span className="min-w-0 flex-1 truncate">{concept.title}</span>
              </button>
            ))}
          </div>
        ) : null}

        {selectedConcept ? (
          <div className="absolute bottom-3 right-3 z-10 w-[318px] rounded-lg border border-[#30363d] bg-[#161b22]/94 p-3 text-xs text-[#c9d1d9] shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[#9da7b3]">Selected concept</p>
                <h3 className="mt-1 truncate text-sm font-semibold text-[#e6edf3]">{selectedConcept.title}</h3>
              </div>
              <button type="button" onClick={() => setSelectedNodeId(null)} className="rounded-md p-1 text-[#9da7b3] hover:bg-[#30363d]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md bg-[#0f141b] p-2"><p className="text-[#768390]">Mastery</p><p className="mt-1 text-[#e6edf3]">{pct(selectedConcept.learnerState?.masteryEstimate)}</p></div>
              <div className="rounded-md bg-[#0f141b] p-2"><p className="text-[#768390]">Weak</p><p className="mt-1 text-[#e6edf3]">{pct(selectedConcept.learnerState?.weaknessEstimate)}</p></div>
              <div className="rounded-md bg-[#0f141b] p-2"><p className="text-[#768390]">Ready</p><p className="mt-1 text-[#e6edf3]">{pct(selectedConcept.learnerState?.readinessEstimate)}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => openLocalGraph(selectedConcept.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#e6edf3] px-2 text-xs font-medium text-[#0f141b]">
                <LocateFixed className="h-3.5 w-3.5" />
                Local graph
              </button>
              <button type="button" onClick={() => focusById(selectedConcept.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#30363d] px-2 text-xs font-medium text-[#e6edf3]">
                <Network className="h-3.5 w-3.5" />
                Focus
              </button>
              <button type="button" onClick={() => layoutCache.positions[selectedConcept.id] ? unpinNode(selectedConcept.id) : pinNode(selectedConcept.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#30363d] px-2 text-xs font-medium text-[#e6edf3]">
                {layoutCache.positions[selectedConcept.id] ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                {layoutCache.positions[selectedConcept.id] ? 'Unpin' : 'Pin'}
              </button>
            </div>
          </div>
        ) : null}

        {contextMenu ? (
          <div
            className="absolute z-20 w-44 rounded-lg border border-[#30363d] bg-[#161b22] p-1 text-xs text-[#d6deeb] shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
            style={{ left: Math.min(contextMenu.x, 720), top: Math.min(contextMenu.y, 620) }}
          >
            <button type="button" onClick={() => focusById(contextMenu.nodeId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#30363d]"><Network className="h-3.5 w-3.5" />邻域聚焦</button>
            <button type="button" onClick={() => openLocalGraph(contextMenu.nodeId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#30363d]"><LocateFixed className="h-3.5 w-3.5" />打开局部图</button>
            <button type="button" onClick={() => pinNode(contextMenu.nodeId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#30363d]"><Pin className="h-3.5 w-3.5" />固定当前位置</button>
            <button type="button" onClick={() => unpinNode(contextMenu.nodeId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#30363d]"><PinOff className="h-3.5 w-3.5" />取消固定</button>
          </div>
        ) : null}

        <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-[#30363d] bg-[#161b22]/90 px-3 py-2 text-xs text-[#c9d1d9] shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur">
          {stats.nodes} nodes · {stats.edges} visible edges · {prefs.scope === 'connected' ? 'isolated hidden' : prefs.scope === 'local' ? `${prefs.localDepth}-hop local graph` : 'all nodes'} · 拖拽、右键动作、滚轮缩放、布局会自动记住。
        </div>
        <div ref={containerRef} className="relative z-[2] h-full w-full" />
      </div>
    </div>
  );
}

export default function LearningIntelligenceDashboard({
  workspaceId,
  workbenchId,
  workbenches = [],
  onOpenWorkbench,
  onPlanApplied,
  onOpenTerminal
}: LearningIntelligenceDashboardProps) {
  const [section, setSection] = useState<IntelligenceSection>('overview');
  const [knowledgeView, setKnowledgeView] = useState<KnowledgeView>('graph');
  const [planningView, setPlanningView] = useState<PlanningView>('plans');
  const [memoryView, setMemoryView] = useState<MemoryView>('events');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expandedConceptIds, setExpandedConceptIds] = useState<Set<string>>(() => new Set());
  const [drawerConcept, setDrawerConcept] = useState<ConceptNode | null>(null);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<DiagnosisItem | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [planningRunning, setPlanningRunning] = useState(false);
  const [graphActionRunning, setGraphActionRunning] = useState<'build' | 'target' | 'gap' | null>(null);
  const [graphBuildJob, setGraphBuildJob] = useState<any>(null);
  const [mclResult, setMclResult] = useState<MclExecuteResult | null>(null);
  const [planningObjective, setPlanningObjective] = useState('');
  const [planningRunStatus, setPlanningRunStatus] = useState<string | null>(null);
  const planningPollTimerRef = useRef<number | null>(null);

  const [integration, setIntegration] = useState<any>(null);
  const [graph, setGraph] = useState<{ nodes: ConceptNode[]; edges: ConceptEdge[] }>({ nodes: [], edges: [] });
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [kgPlan, setKgPlan] = useState<any>(null);
  const [targetStructure, setTargetStructure] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [mclPlan, setMclPlan] = useState<any>(null);
  const [mclPlans, setMclPlans] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [learnerState, setLearnerState] = useState<any>(null);
  const [memories, setMemories] = useState<any[]>([]);
  const [planActionBusyId, setPlanActionBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [
        integrationResult,
        graphResult,
        diagnosisResult,
        planResult,
        plansResult,
        eventsResult,
        sequenceResult,
        learnerStateResult,
        memoryResult
      ] = await Promise.all([
        learningApi.getWorkspaceIntegration(workspaceId, { workbenchId }).catch(() => ({ integration: null })),
        learningApi.getKnowledgeGraph(workspaceId, { limit: 120 }).catch(() => ({ graph: { nodes: [], edges: [] } })),
        learningApi.getDiagnosis(workspaceId, { limit: 100 }).catch(() => ({ diagnosis: null })),
        learningApi.createKnowledgeGraphPlan({ workspaceId, workbenchId, maxConcepts: 8, persist: false }).catch(() => ({ plan: null })),
        learningApi.listLearningPlans(workspaceId, { workbenchId, limit: 30 }).catch(() => ({ plans: [] })),
        learningApi.listLearningEvents(workspaceId, { workbenchId, limit: 80 }).catch(() => ({ events: [] })),
        learningApi.getLearningEventSequences(workspaceId, { workbenchId, limit: 24 }).catch(() => ({ patterns: [] })),
        learningApi.getLearnerState(workspaceId, { workbenchId }).catch(() => ({ state: null })),
        learningApi.listLearnerMemories(workspaceId, { workbenchId, limit: 40 }).catch(() => ({ memories: [] }))
      ]);
      setIntegration(integrationResult.integration || null);
      setGraph({
        nodes: safeArray<ConceptNode>(graphResult.graph?.nodes),
        edges: safeArray<ConceptEdge>(graphResult.graph?.edges)
      });
      setDiagnosis(diagnosisResult.diagnosis || null);
      setKgPlan(planResult.plan || null);
      setMclPlans(safeArray(plansResult.plans));
      setEvents(safeArray(eventsResult.events));
      setSequences(safeArray(sequenceResult.patterns));
      setLearnerState(learnerStateResult.state || null);
      setMemories(safeArray(memoryResult.memories));
      const persistedMclPlan =
        safeArray<any>(plansResult.plans)[0] ||
        integrationResult.integration?.activePlan ||
        learnerStateResult.state?.coreState?.workingState?.currentCourseState?.activePlan ||
        null;
      if (persistedMclPlan) {
        setMclPlan(persistedMclPlan);
        setSelectedStepId((current) =>
          current ||
          (safeArray<any>(persistedMclPlan.structuredPlan?.stages)[0]?.order
            ? `structured-${safeArray<any>(persistedMclPlan.structuredPlan?.stages)[0].order}`
            : null) ||
          null
        );
      }
      setPlanningObjective((current) =>
        current ||
        planDisplayTitle(persistedMclPlan) ||
        integrationResult.integration?.continueLearning?.prompt ||
        planResult.plan?.objective ||
        '根据当前学习画像、知识图谱和资料生成下一步学习计划'
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Learning Intelligence 加载失败');
    } finally {
      setLoading(false);
    }
  };

  const runBuildGraph = async () => {
    setGraphActionRunning('build');
    setError(null);
    try {
      const result = await learningApi.startCourseGraphBuildJob({
        workspaceId,
        workbenchId,
        reindex: true,
        validate: true,
        includeWorkspaceResources: true,
        graphLimit: 160
      });
      setGraphBuildJob(result.job || null);
      if (result.job?.id && typeof window !== 'undefined') {
        window.localStorage.setItem(courseGraphBuildJobStorageKey(workspaceId, workbenchId), result.job.id);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '课程图谱重建失败');
    } finally {
      setGraphActionRunning(null);
    }
  };

  const runTargetStructure = async () => {
    const objective = planningObjective.trim() || integration?.continueLearning?.prompt || kgPlan?.objective || '根据当前学习画像、知识图谱和资料生成目标知识结构';
    setGraphActionRunning('target');
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
      setGraphActionRunning(null);
    }
  };

  const runGapAnalysis = async () => {
    const objective = targetStructure?.objective || planningObjective.trim() || integration?.continueLearning?.prompt || kgPlan?.objective || '根据当前学习画像、知识图谱和资料运行差距分析';
    setGraphActionRunning('gap');
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
      setGraphActionRunning(null);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId, workbenchId]);

  useEffect(() => {
    if (!workspaceId || graphBuildJob?.id) return;
    let cancelled = false;
    const storedJobId = typeof window !== 'undefined' ? window.localStorage.getItem(courseGraphBuildJobStorageKey(workspaceId, workbenchId)) : null;
    const restoreFromStored = storedJobId
      ? learningApi.getCourseGraphBuildJob(storedJobId).then((result) => result.job).catch(() => null)
      : Promise.resolve(null);
    restoreFromStored
      .then((storedJob) => storedJob || learningApi.listCourseGraphBuildJobs(workspaceId, 8).then((result) => {
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
      .then((restored) => {
        if (cancelled) return;
        if (restored) setGraphBuildJob(restored);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workbenchId, graphBuildJob?.id]);

  useEffect(() => {
    if (!graphBuildJob?.id || graphBuildJob?.status === 'completed' || graphBuildJob?.status === 'failed') return;
    const timer = window.setInterval(async () => {
      try {
        const result = await learningApi.getCourseGraphBuildJob(graphBuildJob.id);
        setGraphBuildJob(result.job || null);
        if (result.job?.status === 'completed' || result.job?.status === 'failed') {
          window.clearInterval(timer);
          await load();
        }
      } catch {
        // keep current progress visible while the next poll retries
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [graphBuildJob?.id, graphBuildJob?.status, workspaceId, workbenchId]);

  useEffect(() => {
    return () => {
      if (planningPollTimerRef.current != null) {
        window.clearTimeout(planningPollTimerRef.current);
        planningPollTimerRef.current = null;
      }
    };
  }, []);

  const runMclPlanning = async () => {
    if (planningRunning || planningRunStatus === 'running' || planningRunStatus === 'starting') return;
    if (planningPollTimerRef.current != null) {
      window.clearTimeout(planningPollTimerRef.current);
      planningPollTimerRef.current = null;
    }
    const objective = planningObjective.trim() || integration?.continueLearning?.prompt || kgPlan?.objective || '根据当前学习画像、知识图谱和资料生成下一步学习计划';
    setPlanningRunning(true);
    setError(null);
    setPlanningRunStatus('starting');
    try {
      const result = await mclApi.execute({
        workspaceId,
        workbenchId,
        intent: 'planning',
        userInput: objective,
        context: { workspaceId, workbenchId },
      });
      setMclResult(result);
      if (result.runId) {
        setPlanningRunStatus(result.status || 'running');
        setPlanningView(result.plan ? 'steps' : 'plans');
        if (result.plan) {
          setMclPlan(result.plan);
          setMclPlans((current) => [result.plan, ...current.filter((plan) => plan.id !== result.plan?.id)]);
          setSelectedStepId(safeArray<any>(result.plan.structuredPlan?.stages)[0]?.order ? `structured-${safeArray<any>(result.plan.structuredPlan?.stages)[0].order}` : null);
        }
        const pollRun = async () => {
          try {
            const latest = await mclApi.getRun(result.runId!);
            const run = latest.run;
            setPlanningRunStatus(run.status);
            if (run.status === 'completed' && run.resultJson) {
              try {
                const parsed = JSON.parse(run.resultJson);
                if (parsed?.timeline) {
                  setMclResult((current) => ({
                    ...(current || { intent: 'planning' }),
                    runId: result.runId,
                    timeline: parsed.timeline,
                    status: run.status
                  }));
                }
                if (parsed?.plan) {
                  setMclPlan(parsed.plan);
                  setMclPlans((current) => [parsed.plan, ...current.filter((plan) => plan.id !== parsed.plan?.id)]);
                  setSelectedStepId(safeArray<any>(parsed.plan.structuredPlan?.stages)[0]?.order ? `structured-${safeArray<any>(parsed.plan.structuredPlan?.stages)[0].order}` : null);
                  setPlanningView('steps');
                }
              } catch {
                // keep existing UI state if parsing fails
              }
              return;
            }
            if (run.status === 'failed') {
              setError(run.errorMessage || '三智能体 Planning 运行失败');
              return;
            }
            planningPollTimerRef.current = window.setTimeout(pollRun, 2000);
          } catch {
            planningPollTimerRef.current = window.setTimeout(pollRun, 3000);
          }
        };
        planningPollTimerRef.current = window.setTimeout(pollRun, 2000);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '三智能体 Planning 运行失败');
    } finally {
      setPlanningRunning(false);
    }
  };

  const applyPlanToWorkbench = async (plan: any, targetWorkbenchId?: string | null, createWorkbench = false) => {
    if (!plan?.id) return;
    setPlanActionBusyId(plan.id);
    setError(null);
    try {
      const result = await learningApi.applyLearningPlanToWorkbench(plan.id, {
        workspaceId,
        workbenchId: targetWorkbenchId || undefined,
        createWorkbench,
        workbenchTitle: createWorkbench ? planDisplayTitle(plan) : undefined
      });
      if (createWorkbench && result?.workbench?.id && onOpenWorkbench) {
        onOpenWorkbench(result.workbench.id);
      } else if (targetWorkbenchId && onOpenWorkbench) {
        onOpenWorkbench(targetWorkbenchId);
      }
      await load();
      onPlanApplied?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '计划应用失败');
    } finally {
      setPlanActionBusyId(null);
    }
  };

  const filteredConcepts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nodes = graph.nodes;
    if (!q) return nodes;
    return nodes.filter((node) => node.title.toLowerCase().includes(q));
  }, [graph.nodes, query]);

  const conceptById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const drawerIncomingEdges = drawerConcept ? graph.edges.filter((edge) => edge.to === drawerConcept.id) : [];
  const drawerOutgoingEdges = drawerConcept ? graph.edges.filter((edge) => edge.from === drawerConcept.id) : [];
  const diagnosisItems = safeArray<DiagnosisItem>(diagnosis?.concepts);
  const weakConcepts = diagnosisItems.filter((item) => item.diagnosis === 'weak' || item.diagnosis === 'prerequisite_gap');
  const naturalPlanMarkdown = String(mclPlan?.naturalPlanMarkdown || mclPlan?.rationale || '').trim();
  const structuredPlan = mclPlan?.structuredPlan && !mclPlan.structuredPlan.parseFailed ? mclPlan.structuredPlan : null;
  const structuredStages = safeArray<StructuredStage>(structuredPlan?.stages);
  const selectedStructuredStage = structuredStages.find((stage, index) => structuredStageId(stage, index) === selectedStepId) || structuredStages[0] || null;
  const planSteps = safeArray<any>(mclPlan?.steps);
  const selectedStep = planSteps.find((step) => step.id === selectedStepId) || planSteps[0] || null;
  const pathIds = safeArray<any>(kgPlan?.knowledgeGraphSnapshot?.nodes).map((node) => String(node.id)).filter(Boolean);
  const stableSignals = safeArray<any>(learnerState?.coreState?.stableProfile?.learningGoals)
    .concat(safeArray(learnerState?.coreState?.stableProfile?.masteredKnowledge))
    .concat(safeArray(learnerState?.coreState?.stableProfile?.weakKnowledge))
    .concat(safeArray(learnerState?.coreState?.stableProfile?.learningPreferences));
  const observations = safeArray<any>(learnerState?.coreState?.observationMemory?.observations);
  const versions = safeArray<any>(learnerState?.versions);

  useEffect(() => {
    if (structuredStages.length && !selectedStepId) {
      setSelectedStepId(structuredStageId(structuredStages[0], 0));
    }
  }, [structuredStages, selectedStepId]);

  const contextPanel = (
    <aside className="hidden min-h-[620px] border-l border-[#e8e8e4] pl-5 xl:block">
      <div className="sticky top-5 space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Context</p>
          <p className="mt-2 text-sm leading-6 text-[#55585d]">
            {section === 'overview' ? integration?.learnerState?.summary || '等待学习状态生成。' : null}
            {section === 'knowledge' ? `${filteredConcepts.length} 个知识对象，${graph.edges.length} 条关系。` : null}
            {section === 'diagnosis' ? `${diagnosisItems.length} 条诊断对象，${weakConcepts.length} 条需要优先关注。` : null}
            {section === 'planning' ? mclPlan?.objective || '还没有学习计划。' : null}
            {section === 'memory' ? `${events.length} 条事件，${observations.length} 条短期观察，${stableSignals.length} 条稳定画像。` : null}
          </p>
        </div>

        {section === 'knowledge' ? (
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-[#777b80]">过滤知识点</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#96999d]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索概念"
                className="h-9 w-full rounded-lg border border-[#deded9] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#b9bab2]"
              />
            </span>
          </label>
        ) : null}

        {section === 'knowledge' ? (
          <div className="space-y-2">
            {graphBuildJob ? (
              <div className="rounded-lg border border-[#e6e6e1] bg-white px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Build Job</p>
                <p className="mt-2 text-sm font-medium text-[#202124]">{graphBuildJob.status === 'completed' ? '课程图谱已完成' : graphBuildJob.status === 'failed' ? '课程图谱构建失败' : '课程图谱构建中'}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eeeeeb]">
                  <div className="h-full rounded-full bg-[#202124] transition-all" style={{ width: `${Math.max(4, Math.min(100, Number(graphBuildJob.progress?.percent || 0)))}%` }} />
                </div>
                <p className="mt-2 truncate text-xs text-[#777b80]">{graphBuildJob.progress?.message || '正在处理...'}</p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void runBuildGraph()}
              disabled={loading || Boolean(graphActionRunning)}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
            >
              {graphActionRunning === 'build' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
              重建课程图谱
            </button>
            <button
              type="button"
              onClick={() => void runTargetStructure()}
              disabled={loading || Boolean(graphActionRunning)}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4] disabled:opacity-60"
            >
              {graphActionRunning === 'target' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
              生成目标结构
            </button>
            <button
              type="button"
              onClick={() => void runGapAnalysis()}
              disabled={loading || Boolean(graphActionRunning)}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4] disabled:opacity-60"
            >
              {graphActionRunning === 'gap' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              运行差距分析
            </button>
          </div>
        ) : null}

        {section === 'knowledge' && (targetStructure || gapAnalysis) ? (
          <div className="space-y-3 border-t border-[#e8e8e4] pt-4">
            {targetStructure ? (
              <div className="rounded-lg border border-[#eeeeeb] bg-white px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Target Structure</p>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-[#202124]">{targetStructure.objective || '目标结构'}</p>
                <p className="mt-1 text-xs text-[#777b80]">{targetStructure.nodes?.length || 0} nodes · {targetStructure.edges?.length || 0} edges</p>
              </div>
            ) : null}
            {gapAnalysis ? (
              <div className="rounded-lg border border-[#eeeeeb] bg-white px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Gap Analysis</p>
                <p className="mt-2 text-sm font-medium text-[#202124]">readiness {pct(gapAnalysis.summary?.overallReadiness)}</p>
                <p className="mt-1 text-xs text-[#777b80]">covered {gapAnalysis.summary?.coveredCount ?? 0} · gaps {gapAnalysis.summary?.gapCount ?? 0} · blocked {gapAnalysis.summary?.blockedCount ?? 0}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || Boolean(graphActionRunning)}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
          {onOpenTerminal ? (
            <button
              type="button"
              onClick={() => onOpenTerminal(integration?.continueLearning?.prompt || '根据我的学习状态推荐下一步')}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
            >
              <Sparkles className="h-4 w-4" />
              发给 AI Terminal
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );

  const renderOverview = () => (
    <section className="space-y-8">
      <div className="border-b border-[#e8e8e4] pb-6">
        <p className="text-sm font-medium text-[#777b80]">当前学习状态</p>
        <h2 className="mt-2 max-w-3xl text-2xl font-semibold text-[#202124]">
          {integration?.continueLearning?.nextStepTitle || '学习智能体正在等待更多上下文'}
        </h2>
        <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-6 text-[#55585d]">
          {integration?.learnerState?.summary || learnerState?.summary || '继续使用学习现场、资源和 AI Terminal 后，这里会形成稳定摘要。'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setSection('planning')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white">
            <Route className="h-4 w-4" />
            打开当前计划
          </button>
          <button type="button" onClick={() => setSection('knowledge')} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] hover:bg-[#f1f1ef]">
            <Network className="h-4 w-4" />
            查看知识结构
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-[#202124]">最近变化</h3>
          <div className="mt-3 border-y border-[#eeeeeb]">
            {events.slice(0, 5).map((event) => (
              <div key={event.id} className="flex items-start gap-3 border-b border-[#eeeeeb] py-3 last:border-b-0">
                <Activity className="mt-0.5 h-4 w-4 text-[#8a8e94]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#34373c]">{event.eventType}</p>
                  <p className="mt-1 truncate text-xs text-[#96999d]">{event.objectType || event.eventFamily || 'learning event'} · {new Date(event.observedAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
            {!events.length ? <EmptyState title="暂无近期变化" detail="学习事件会在打开资源、完成测验、对话和计划更新时产生。" /> : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#202124]">推荐入口</h3>
          <div className="mt-3 border-y border-[#eeeeeb]">
            {[
              { label: '薄弱知识', value: integration?.learnerState?.weakSkills?.slice(0, 3).join('、') || weakConcepts.slice(0, 3).map((item) => item.concept.title).join('、'), target: 'diagnosis' as IntelligenceSection },
              { label: '当前计划', value: mclPlan?.objective || integration?.continueLearning?.nextStepTitle, target: 'planning' as IntelligenceSection },
              { label: '记忆与画像', value: `${stableSignals.length} 条稳定画像，${observations.length} 条短期观察`, target: 'memory' as IntelligenceSection }
            ].map((item) => (
              <RowButton key={item.label} onClick={() => setSection(item.target)}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#34373c]">{item.label}</p>
                  <p className="mt-1 truncate text-sm text-[#777b80]">{item.value || '等待生成'}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-[#96999d]" />
              </RowButton>
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  const renderKnowledge = () => (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#202124]">Knowledge</h2>
          <p className="mt-1 text-sm text-[#777b80]">知识点是稳定对象；图谱、列表和路径只是不同视图。</p>
        </div>
        <div className="inline-flex rounded-lg bg-[#f1f1ef] p-1">
          {[
            { id: 'graph', label: 'Graph View', icon: Network },
            { id: 'list', label: 'List View', icon: ListTree },
            { id: 'path', label: 'Path View', icon: MapIcon }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setKnowledgeView(item.id as KnowledgeView)}
                className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                  knowledgeView === item.id ? 'bg-white text-[#202124] shadow-sm' : 'text-[#666a70] hover:text-[#202124]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {knowledgeView === 'graph' ? (
        <div>
          <div className="mb-3 flex justify-end">
            <Link
              to={`/workspaces/${workspaceId}/knowledge-graph${workbenchId ? `?workbenchId=${encodeURIComponent(workbenchId)}` : ''}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
            >
              <Maximize2 className="h-4 w-4" />
              全屏打开图谱
            </Link>
          </div>
          <KnowledgeGraphWorkbench
          workspaceId={workspaceId}
          workbenchId={workbenchId}
          concepts={graph.nodes}
          edges={graph.edges}
          selectedId={drawerConcept?.id}
          pathIds={pathIds}
          searchTerm={query}
          onSelect={setDrawerConcept}
          />
        </div>
      ) : null}

      {knowledgeView === 'list' ? (
        <div className="border-y border-[#eeeeeb]">
          {filteredConcepts.map((concept) => {
            const expanded = expandedConceptIds.has(concept.id);
            const prereqs = graph.edges.filter((edge) => edge.to === concept.id && edge.relationType === 'prerequisite').map((edge) => conceptById.get(edge.from)?.title).filter(Boolean);
            return (
              <div key={concept.id} className="border-b border-[#eeeeeb] last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedConceptIds((current) => {
                      const next = new Set(current);
                      if (next.has(concept.id)) next.delete(concept.id);
                      else next.add(concept.id);
                      return next;
                    });
                  }}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#f7f7f5]"
                >
                  {expanded ? <ChevronDown className="h-4 w-4 text-[#96999d]" /> : <ChevronRight className="h-4 w-4 text-[#96999d]" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#202124]">{concept.title}</p>
                    <p className="mt-1 text-xs text-[#96999d]">掌握 {pct(concept.learnerState?.masteryEstimate)} · 薄弱 {pct(concept.learnerState?.weaknessEstimate)} · 准备度 {pct(concept.learnerState?.readinessEstimate)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${stateTone(concept)}`}>{concept.category || 'concept'}</span>
                </button>
                {expanded ? (
                  <div className="grid gap-4 px-10 pb-4 text-sm text-[#55585d] md:grid-cols-4">
                    <div><p className="mb-1 text-xs font-medium text-[#96999d]">前置知识</p>{prereqs.length ? prereqs.slice(0, 4).map((item) => <p key={item}>{item}</p>) : <p>暂无</p>}</div>
                    <div><p className="mb-1 text-xs font-medium text-[#96999d]">常见误区</p>{concept.misconceptions?.length ? concept.misconceptions.slice(0, 3).map((item) => <p key={item.title}>{item.title}</p>) : <p>暂无</p>}</div>
                    <div><p className="mb-1 text-xs font-medium text-[#96999d]">相关资源</p>{concept.bindings?.filter((item) => item.targetType === 'resource').length || 0} 个资源</div>
                    <div><button type="button" onClick={() => setDrawerConcept(concept)} className="text-sm font-medium text-[#202124] hover:underline">打开详情</button></div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!filteredConcepts.length ? <EmptyState title="没有匹配的知识点" detail="清空搜索，或先重建 workspace 知识图谱。" /> : null}
        </div>
      ) : null}

      {knowledgeView === 'path' ? (
        <div className="border-y border-[#eeeeeb]">
          {(pathIds.length ? pathIds.map((id) => conceptById.get(id)).filter(Boolean) as ConceptNode[] : filteredConcepts.slice(0, 8)).map((concept, index, arr) => (
            <button key={concept.id} type="button" onClick={() => setDrawerConcept(concept)} className="flex w-full items-start gap-4 border-b border-[#eeeeeb] px-3 py-4 text-left last:border-b-0 hover:bg-[#f7f7f5]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1f1ef] text-xs font-medium text-[#55585d]">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#202124]">{concept.title}</p>
                <p className="mt-1 text-sm text-[#777b80]">{index === 0 ? '路径起点' : index === arr.length - 1 ? '目标知识' : '桥接知识'} · readiness {pct(concept.learnerState?.readinessEstimate)}</p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 text-[#96999d]" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );

  const renderDiagnosis = () => (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-[#202124]">Diagnosis</h2>
        <p className="mt-1 text-sm text-[#777b80]">诊断报告作为对象存在；证据链只在详情里展开。</p>
      </div>
      <div className="border-y border-[#eeeeeb]">
        {diagnosisItems.map((item) => {
          const evidenceCount = (item.misconceptions?.length || 0) + (item.evidenceNeeds?.length || 0) + 1;
          return (
            <RowButton key={item.concept.id} selected={selectedDiagnosis?.concept.id === item.concept.id} onClick={() => setSelectedDiagnosis(item)}>
              <Brain className="h-4 w-4 text-[#8a8e94]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#202124]">{item.concept.title}</p>
                <p className="mt-1 truncate text-xs text-[#96999d]">证据 {evidenceCount} · confidence {score(item.confidence)} · readiness {pct(item.readinessEstimate)}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${diagnosisTone(item.diagnosis)}`}>{diagnosisLabel(item.diagnosis)}</span>
            </RowButton>
          );
        })}
        {!diagnosisItems.length ? <EmptyState title="暂无诊断报告" detail="完成学习事件或测验后，系统会生成概念级诊断对象。" /> : null}
      </div>

      {selectedDiagnosis ? (
        <div className="mt-6 border-y border-[#eeeeeb] py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Diagnosis Detail</p>
              <h3 className="mt-2 text-lg font-semibold text-[#202124]">{selectedDiagnosis.concept.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#55585d]">结论：{diagnosisLabel(selectedDiagnosis.diagnosis)}。影响范围主要在相关前置知识、测验表现和后续计划排序。</p>
            </div>
            <button type="button" onClick={() => setSelectedDiagnosis(null)} className="rounded-lg p-2 text-[#777b80] hover:bg-[#f1f1ef]"><PanelRightClose className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold text-[#202124]">证据链</h4>
              <div className="mt-2 space-y-2 text-sm text-[#55585d]">
                <p>mastery={score(selectedDiagnosis.masteryEstimate)}, weakness={score(selectedDiagnosis.weaknessEstimate)}, readiness={score(selectedDiagnosis.readinessEstimate)}</p>
                {(selectedDiagnosis.evidenceNeeds || []).map((item) => <p key={item}>{item}</p>)}
                {(selectedDiagnosis.misconceptions || []).map((item) => <p key={item.title}>误区：{item.title}</p>)}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[#202124]">系统建议</h4>
              <div className="mt-2 space-y-2 text-sm text-[#55585d]">
                <p>先查看相关知识对象，再把该概念加入当前计划步骤。</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => setSection('knowledge')} className="h-8 rounded-lg bg-[#f1f1ef] px-3 text-xs font-medium text-[#34373c]">查看知识点</button>
                  <button type="button" className="h-8 rounded-lg bg-[#f1f1ef] px-3 text-xs font-medium text-[#34373c]">标记有帮助</button>
                  <button type="button" className="h-8 rounded-lg bg-[#f1f1ef] px-3 text-xs font-medium text-[#34373c]">需要纠正</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );

  const planningFeedbackItems = safeArray<any>(events)
    .filter((event) => /plan|trace|quiz|practice|reflection/i.test(String(event.eventType || event.type || '')))
    .slice(0, 8);

  const renderPlanning = () => (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#202124]">Learning Plans</h2>
          <p className="mt-1 text-sm text-[#777b80]">管理已生成的学习计划、查看每一步内容，并记录后续反馈。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runMclPlanning()}
            disabled={planningRunning || planningRunStatus === 'running' || planningRunStatus === 'starting'}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
          >
            {planningRunning || planningRunStatus === 'running' || planningRunStatus === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {planningRunStatus === 'running' || planningRunStatus === 'starting' ? '生成中' : '生成新计划'}
          </button>
          <div className="inline-flex rounded-lg bg-[#f1f1ef] p-1">
            {[
              ['plans', '计划'],
              ['steps', '步骤'],
              ['feedback', '反馈']
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPlanningView(id as PlanningView)} className={`h-8 rounded-md px-3 text-sm font-medium ${planningView === id ? 'bg-white text-[#202124] shadow-sm' : 'text-[#666a70]'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <label className="block">
          <span className="mb-2 block text-xs font-medium text-[#777b80]">计划目标</span>
          <input
            value={planningObjective}
            onChange={(event) => setPlanningObjective(event.target.value)}
            placeholder="例如：掌握 SQL 基础并完成数据查询练习"
            className="h-10 w-full rounded-lg border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none focus:border-[#b9bab2]"
          />
        </label>
        <div className="rounded-lg border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-2">
          <p className="text-xs font-medium text-[#777b80]">计划库</p>
          <p className="mt-1 text-sm font-semibold text-[#202124]">{mclPlans.length} 个计划</p>
          <p className="mt-1 text-xs text-[#96999d]">
            {planningRunStatus === 'completed' ? '最近已更新' : planningRunStatus === 'running' || planningRunStatus === 'starting' ? '正在生成新计划' : '可继续生成新计划'}
          </p>
        </div>
      </div>

      {planningView === 'plans' ? (
        <div className="border-y border-[#eeeeeb]">
          {(mclPlans.length ? mclPlans : mclPlan ? [mclPlan] : []).map((plan) => {
            const steps = safeArray<any>(plan.steps);
            const active = plan.id === mclPlan?.id;
            return (
              <RowButton
                key={plan.id}
                selected={active}
                onClick={() => {
                  setMclPlan(plan);
                  setSelectedStepId(safeArray<any>(plan.structuredPlan?.stages)[0]?.order ? `structured-${safeArray<any>(plan.structuredPlan?.stages)[0].order}` : null);
                  setPlanningView('steps');
                }}
              >
                <NotebookTabs className="h-4 w-4 text-[#8a8e94]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#202124]">{planDisplayTitle(plan)}</p>
                  <p className="mt-1 text-xs text-[#96999d]">
                    {planStageCount(plan)} 阶段 · {plan.status || 'active'}{formatShortDate(plan.updatedAt) ? ` · ${formatShortDate(plan.updatedAt)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                  {workbenches.length ? (
                    <select
                      value={plan.workbenchId || ''}
                      onChange={(event) => {
                        const targetId = event.target.value;
                        if (targetId) void applyPlanToWorkbench(plan, targetId, false);
                      }}
                      disabled={planActionBusyId === plan.id}
                      className="h-8 max-w-[180px] rounded-md border border-[#deded9] bg-white px-2 text-xs text-[#34373c] outline-none disabled:opacity-60"
                    >
                      <option value="">应用到 workbench</option>
                      {workbenches.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void applyPlanToWorkbench(plan, null, true)}
                    disabled={planActionBusyId === plan.id}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-[#202124] px-2.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-60"
                  >
                    {planActionBusyId === plan.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    新建现场
                  </button>
                </div>
                <ChevronRight className="h-4 w-4 text-[#96999d]" />
              </RowButton>
            );
          })}
          {!mclPlans.length && !mclPlan ? <EmptyState title="还没有学习计划" detail="输入目标并生成新计划后，这里会保留每一次生成结果。" /> : null}
        </div>
      ) : null}

      {planningView === 'steps' ? (
        structuredPlan && structuredStages.length ? (
          <div className="space-y-5">
            <section className="border-y border-[#eeeeeb] bg-white px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Plan Overview</p>
                  <h3 className="mt-2 text-lg font-semibold text-[#202124]">{planDisplayTitle(mclPlan)}</h3>
                </div>
                <span className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-xs font-medium text-[#55585d] ring-1 ring-[#e5e5df]">
                  {planTypeLabel(structuredPlan.overview?.planType)}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-[#55585d]">
                {structuredPlan.overview?.goalUnderstanding ? <p><span className="font-medium text-[#34373c]">目标：</span>{structuredPlan.overview.goalUnderstanding}</p> : null}
                {structuredPlan.overview?.learnerContext ? <p><span className="font-medium text-[#34373c]">起点：</span>{structuredPlan.overview.learnerContext}</p> : null}
                {structuredPlan.overview?.overallPath ? <p><span className="font-medium text-[#34373c]">路径：</span>{structuredPlan.overview.overallPath}</p> : null}
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="border-y border-[#eeeeeb] bg-white">
                <div className="border-b border-[#eeeeeb] px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Stage Timeline</p>
                </div>
                <div className="divide-y divide-[#eeeeeb]">
                  {structuredStages.map((stage, index) => {
                    const stageId = structuredStageId(stage, index);
                    const selected = selectedStructuredStage === stage;
                    const duration = stageDurationHint(stage);
                    return (
                      <button
                        key={stageId}
                        type="button"
                        onClick={() => setSelectedStepId(stageId)}
                        className={`block w-full px-4 py-4 text-left transition hover:bg-[#f7f7f5] ${selected ? 'bg-[#fbfbfa]' : 'bg-white'}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${selected ? 'bg-[#202124] text-white' : 'bg-[#f1f1ef] text-[#55585d]'}`}>
                            {stage.order || index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-[#202124]">{stage.title}</p>
                              {duration ? <span className="text-xs font-medium text-[#96999d]">{duration}</span> : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {safeArray<string>(stage.display?.tags || stage.display?.focusTags).slice(0, 6).map((tag) => (
                                <span key={tag} className="rounded-full bg-[#f5f5f3] px-2 py-0.5 text-[11px] font-medium text-[#55585d] ring-1 ring-[#e5e5df]">{tag}</span>
                              ))}
                            </div>
                            {stage.display?.narrative || stage.display?.summary ? <p className="mt-2 text-sm leading-6 text-[#55585d]">{stage.display.narrative || stage.display.summary}</p> : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="border-y border-[#eeeeeb] bg-white px-4 py-4">
                {selectedStructuredStage ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Stage Detail</p>
                      <h3 className="mt-2 text-lg font-semibold text-[#202124]">
                        阶段 {selectedStructuredStage.order}：{selectedStructuredStage.title}
                      </h3>
                    </div>
                    <div>
                      <p className="text-sm leading-6 text-[#34373c]">{selectedStructuredStage.detail?.narrative || selectedStructuredStage.detail?.howToLearn || '原计划未明确写出。'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">建议练习</p>
                      <ul className="mt-2 space-y-1 text-sm leading-6 text-[#34373c]">
                        {safeArray<string>(selectedStructuredStage.detail?.practiceTasks).map((item) => <li key={item}>- {item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">过关标准</p>
                      <ul className="mt-2 space-y-1 text-sm leading-6 text-[#34373c]">
                        {safeArray<string>(selectedStructuredStage.detail?.completionCriteria).map((item) => <li key={item}>- {item}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : <EmptyState title="还没有阶段详情" detail="选择一个阶段后查看详细安排。" />}
              </section>
            </div>

            <section className="grid gap-5 lg:grid-cols-3">
              <div className="border-y border-[#eeeeeb] bg-white px-4 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">近期行动安排</p>
                <div className="mt-3 space-y-3">
                  {safeArray<any>(structuredPlan.actionPlan).map((item, index) => (
                    <div key={`${item.label}-${index}`} className="border-b border-[#eeeeeb] pb-3 last:border-b-0 last:pb-0">
                      <p className="text-sm font-medium text-[#202124]">{item.label}{item.estimatedMinutes ? ` · ${item.estimatedMinutes} 分钟` : ''}</p>
                      <p className="mt-1 text-sm leading-6 text-[#55585d]">{item.task}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-y border-[#eeeeeb] bg-white px-4 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">常见卡点</p>
                <div className="mt-3 space-y-3">
                  {safeArray<any>(structuredPlan.commonProblems).map((item, index) => (
                    <div key={`${item.problem}-${index}`}>
                      <p className="text-sm font-medium text-[#202124]">{item.problem}</p>
                      <p className="mt-1 text-sm leading-6 text-[#55585d]">{item.adjustment}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-y border-[#eeeeeb] bg-white px-4 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">判断自己是否学会了</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#55585d]">
                  {safeArray<string>(structuredPlan.masteryCriteria).map((item) => <li key={item}>- {item}</li>)}
                </ul>
              </div>
            </section>
          </div>
        ) : naturalPlanMarkdown ? (
          <div className="overflow-hidden border-y border-[#eeeeeb] bg-white">
            <MarkdownPreview content={naturalPlanMarkdown} variant="message" />
          </div>
        ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="border-y border-[#eeeeeb]">
            {planSteps.map((step, index) => (
              <RowButton key={step.id || index} selected={(step.id || String(index)) === selectedStepId} onClick={() => setSelectedStepId(step.id || String(index))}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1f1ef] text-xs font-medium text-[#55585d]">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#202124]">{step.title}</p>
                  <p className="mt-1 truncate text-xs text-[#96999d]">{step.type || step.stepType || 'step'} · {step.estimatedLoad || 'medium'}</p>
                </div>
              </RowButton>
            ))}
            {!planSteps.length ? <EmptyState title="还没有计划步骤" detail="选择一个已有计划，或先生成新的学习计划。" /> : null}
          </div>
          <div className="border-y border-[#eeeeeb] py-4">
            {selectedStep ? (
              (() => {
                const groundingStatus = stepGroundingStatus(selectedStep);
                const groundingMatches = normalizeGroundingMatches(selectedStep);
                const groundingMessage = cleanNarrative(
                  selectedStep.resourceGapReason ||
                  selectedStep.resourceGrounding?.gapReason ||
                  selectedStep.stepDetail?.resourceGaps?.document ||
                  '当前资料库里还没有足够内容支撑这一步，需要补充更多资料。'
                );
                const groundingSummary = cleanNarrative(
                  selectedStep.resourceReason ||
                  selectedStep.resourceGrounding?.neededResource ||
                  selectedStep.stepDetail?.personalizationReason ||
                  ''
                );
                const claimMatrix = safeArray<any>(selectedStep.resourceGrounding?.claimEvidenceMatrix);

                return (
                  <div className="space-y-5 px-3">
                    <div className="border-b border-[#eeeeeb] pb-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Step Detail</p>
                          <h3 className="mt-2 text-lg font-semibold text-[#202124]">{selectedStep.title}</h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-xs font-medium text-[#55585d] ring-1 ring-[#e5e5df]">{selectedStep.type || 'step'}</span>
                          <span className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-xs font-medium text-[#55585d] ring-1 ring-[#e5e5df]">{selectedStep.estimatedLoad || 'medium'}</span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${groundingStatusTone(groundingStatus)}`}>{groundingStatusLabel(groundingStatus)}</span>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[#55585d]">{stepPlanNarrative(selectedStep)}</p>
                    </div>

                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">计划解释</p>
                      <p className="mt-1 text-sm leading-6 text-[#34373c]">{stepPlanNarrative(selectedStep)}</p>
                      {groundingSummary ? <p className="mt-2 text-sm leading-6 text-[#777b80]">{groundingSummary}</p> : null}
                    </div>

                    <div className="border-t border-[#eeeeeb] pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">资料支撑</p>
                        <p className="text-xs text-[#96999d]">{groundingMatches.length ? `${groundingMatches.length} 条支撑` : '未找到明确支撑'}</p>
                      </div>

                      {claimMatrix.length ? (
                        <div className="mt-3 rounded-xl border border-[#eeeeeb] bg-white px-3 py-3">
                          <p className="text-xs font-medium text-[#96999d]">学习点覆盖</p>
                          <div className="mt-2 space-y-2">
                            {claimMatrix.slice(0, 5).map((claim, claimIndex) => {
                              const status = String(claim.status || 'missing');
                              const tone = status === 'supported'
                                ? 'bg-[#eef7f0] text-[#2f6f46] ring-[#cfe8d4]'
                                : status === 'partial'
                                  ? 'bg-[#fff7e6] text-[#8b5a00] ring-[#fedf9b]'
                                  : 'bg-[#fff7ed] text-[#b54708] ring-[#fed7aa]';
                              return (
                                <div key={claim.claimId || claimIndex} className="flex items-start gap-2">
                                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`}>
                                    {status === 'supported' ? '已支撑' : status === 'partial' ? '部分' : '缺资料'}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm leading-5 text-[#34373c]">{cleanNarrative(claim.claim)}</p>
                                    {claim.missingReason ? <p className="mt-1 text-xs leading-5 text-[#96999d]">{cleanNarrative(claim.missingReason)}</p> : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {groundingMatches.length ? (
                        <div className="mt-3 space-y-3">
                          {groundingMatches.slice(0, 4).map((item) => (
                            <div key={item.id} className="rounded-xl border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-[#202124]">{item.title}</p>
                                  <p className="mt-1 text-xs text-[#96999d]">
                                    {item.source}{item.location ? ` · ${item.location}` : ''}
                                  </p>
                                </div>
                                {typeof item.matchScore === 'number' ? (
                                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-[#777b80] ring-1 ring-[#e5e5df]">
                                    {formatMatchScore(item.matchScore)}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-[#55585d]">{item.reason}</p>
                              {(item.evidence.length || item.snippets.length) ? (
                                <div className="mt-3 rounded-lg border border-[#eeeeeb] bg-white px-3 py-2">
                                  <p className="text-xs font-medium text-[#96999d]">证据片段</p>
                                  {item.evidence.slice(0, 2).map((evidence: any, evidenceIndex: number) => (
                                    <div key={evidence.chunkId || evidenceIndex} className="mt-2">
                                      <p className="text-sm leading-6 text-[#34373c]">{clipText(evidence.snippet, 220)}</p>
                                      {evidence.whySupports ? <p className="mt-1 text-xs leading-5 text-[#777b80]">{cleanNarrative(evidence.whySupports)}</p> : null}
                                      {safeArray<string>(evidence.supportedClaims).length ? (
                                        <p className="mt-1 text-xs leading-5 text-[#96999d]">支撑：{safeArray<string>(evidence.supportedClaims).slice(0, 4).join('、')}</p>
                                      ) : null}
                                      {evidence.contextBefore || evidence.contextAfter ? (
                                        <p className="mt-1 text-xs leading-5 text-[#96999d]">
                                          上下文：{clipText([evidence.contextBefore, evidence.contextAfter].filter(Boolean).join(' / '), 160)}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                  {!item.evidence.length && item.snippets.slice(0, 1).map((snippet: string, snippetIndex: number) => (
                                    <p key={snippetIndex} className="mt-2 text-sm leading-6 text-[#34373c]">{clipText(snippet, 220)}</p>
                                  ))}
                                </div>
                              ) : null}
                              {item.missingClaims.length ? (
                                <p className="mt-2 text-xs leading-5 text-[#96999d]">仍缺：{item.missingClaims.slice(0, 4).join('、')}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl border border-dashed border-[#e5e5df] bg-white px-3 py-4">
                          <p className="text-sm leading-6 text-[#55585d]">{groundingMessage}</p>
                          {safeArray<string>(selectedStep.resourceGrounding?.missingClaims).length ? (
                            <p className="mt-2 text-xs leading-5 text-[#96999d]">缺少：{safeArray<string>(selectedStep.resourceGrounding?.missingClaims).slice(0, 4).join('、')}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-[#eeeeeb] pt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#96999d]">下一步</p>
                      <p className="mt-1 text-sm leading-6 text-[#34373c]">{stepNextAction(selectedStep)}</p>
                    </div>
                  </div>
                );
              })()
            ) : <p className="px-3 text-sm text-[#777b80]">选择一个步骤查看详情。</p>}
          </div>
        </div>
        )
      ) : null}

      {planningView === 'feedback' ? (
        <div className="border-y border-[#eeeeeb]">
          {planningFeedbackItems.map((event, index) => (
            <RowButton key={event.id || index}>
              <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#202124]">{event.payload?.summary || event.eventType || '学习反馈'}</p>
                <p className="mt-1 truncate text-xs text-[#96999d]">
                  {event.eventType || 'event'}{formatShortDate(event.createdAt || event.observedAt) ? ` · ${formatShortDate(event.createdAt || event.observedAt)}` : ''}
                </p>
              </div>
            </RowButton>
          ))}
          {!planningFeedbackItems.length ? <EmptyState title="暂无执行反馈" detail="完成计划步骤、测验或复盘后，这里会显示学习反馈记录。" /> : null}
        </div>
      ) : null}
    </section>
  );

  const renderMemory = () => (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#202124]">Memory</h2>
          <p className="mt-1 text-sm text-[#777b80]">查看系统记住了什么、为什么记住，以及画像如何变化。</p>
        </div>
        <div className="inline-flex rounded-lg bg-[#f1f1ef] p-1">
          {[
            ['events', 'Learning Events'],
            ['observations', 'Observations'],
            ['stable', 'Stable Profile'],
            ['versions', 'Version History']
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setMemoryView(id as MemoryView)} className={`h-8 rounded-md px-3 text-sm font-medium ${memoryView === id ? 'bg-white text-[#202124] shadow-sm' : 'text-[#666a70]'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="border-y border-[#eeeeeb]">
        {memoryView === 'events' ? events.map((event) => (
          <RowButton key={event.id}>
            <Activity className="h-4 w-4 text-[#8a8e94]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#202124]">{event.eventType}</p>
              <p className="mt-1 truncate text-xs text-[#96999d]">{event.eventFamily} · confidence {score(event.confidence)} · {new Date(event.observedAt).toLocaleString()}</p>
            </div>
          </RowButton>
        )) : null}

        {memoryView === 'observations' ? observations.map((item) => (
          <RowButton key={item.id}>
            <Clock3 className="h-4 w-4 text-[#8a8e94]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#202124]">{item.value}</p>
              <p className="mt-1 truncate text-xs text-[#96999d]">{item.label} · confidence {score(item.confidence)}</p>
            </div>
          </RowButton>
        )) : null}

        {memoryView === 'stable' ? stableSignals.map((item) => (
          <RowButton key={item.id}>
            <ShieldCheck className="h-4 w-4 text-[#8a8e94]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#202124]">{item.value}</p>
              <p className="mt-1 truncate text-xs text-[#96999d]">{item.label} · evidence {safeArray(item.evidenceIds).length} · {item.status}</p>
            </div>
            <button type="button" className="h-8 rounded-lg px-2 text-xs font-medium text-[#666a70] hover:bg-[#eeeeeb]">纠正</button>
          </RowButton>
        )) : null}

        {memoryView === 'versions' ? (
          versions.length ? versions.map((item) => (
            <RowButton key={item.id || item.version}>
              <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#202124]">Version {item.version}</p>
                <p className="mt-1 truncate text-xs text-[#96999d]">{item.summary || item.changeReason || 'Snapshot version'}</p>
              </div>
            </RowButton>
          )) : (
            <RowButton>
              <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#202124]">Version {learnerState?.version || 1}</p>
                <p className="mt-1 truncate text-xs text-[#96999d]">{learnerState?.summary || 'Current learner state snapshot'}</p>
              </div>
            </RowButton>
          )
        ) : null}

        {memoryView === 'events' && !events.length ? <EmptyState title="暂无学习事件" detail="打开资源、对话、测验和计划操作会逐步形成事件流。" /> : null}
        {memoryView === 'observations' && !observations.length ? <EmptyState title="暂无短期观察" detail="短期观察会先保留在 observation memory，不会马上变成稳定画像。" /> : null}
        {memoryView === 'stable' && !stableSignals.length ? <EmptyState title="暂无稳定画像" detail="重复、可信的证据会被提升为稳定画像。" /> : null}
      </div>

      {memories.length ? (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-[#202124]">用户可控记忆</h3>
          <div className="border-y border-[#eeeeeb]">
            {memories.slice(0, 8).map((memory) => (
              <RowButton key={memory.key || memory.memoryKey}>
                <BookOpen className="h-4 w-4 text-[#8a8e94]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#202124]">{memory.value || memory.text}</p>
                  <p className="mt-1 truncate text-xs text-[#96999d]">{memory.dimension || memory.category} · {memory.status}</p>
                </div>
              </RowButton>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );

  return (
    <section className="min-h-[680px]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#202124]">Learning Intelligence Dashboard</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#777b80]">
            面向对象地浏览学习画像、知识结构、诊断报告、计划和记忆记录。
          </p>
        </div>
        {loading ? <Loader2 className="mt-1 h-5 w-5 animate-spin text-[#96999d]" /> : null}
      </div>

      {error ? <div className="mb-5 border-y border-[#ffd6d6] bg-[#fff7f7] px-3 py-2 text-sm text-[#b42318]">{error}</div> : null}

      <div className="grid gap-7 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
        <aside className="border-r border-[#e8e8e4] pr-4">
          <nav className="sticky top-5 space-y-1">
            {sectionItems.map((item) => {
              const Icon = item.icon;
              const selected = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    selected ? 'bg-[#f1f1ef] text-[#202124]' : 'text-[#666a70] hover:bg-[#f6f6f4] hover:text-[#202124]'
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-[#96999d]">{item.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {section === 'overview' ? renderOverview() : null}
          {section === 'knowledge' ? renderKnowledge() : null}
          {section === 'diagnosis' ? renderDiagnosis() : null}
          {section === 'planning' ? renderPlanning() : null}
          {section === 'memory' ? renderMemory() : null}
        </div>

        {contextPanel}
      </div>

      {drawerConcept ? (
        <div className="fixed inset-0 z-[130] flex justify-end bg-black/10" onClick={() => setDrawerConcept(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-[#e6e6e1] bg-white p-6 shadow-[0_20px_80px_rgba(32,33,36,0.18)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Concept Detail</p>
                <h3 className="mt-2 text-2xl font-semibold text-[#202124]">{drawerConcept.title}</h3>
              </div>
              <button type="button" onClick={() => setDrawerConcept(null)} className="rounded-lg p-2 text-[#777b80] hover:bg-[#f1f1ef]" aria-label="Close concept detail">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 border-y border-[#eeeeeb] py-5 sm:grid-cols-3">
              <div><p className="text-xs text-[#96999d]">Mastery</p><p className="mt-1 text-sm font-medium text-[#202124]">{pct(drawerConcept.learnerState?.masteryEstimate)}</p></div>
              <div><p className="text-xs text-[#96999d]">Weakness</p><p className="mt-1 text-sm font-medium text-[#202124]">{pct(drawerConcept.learnerState?.weaknessEstimate)}</p></div>
              <div><p className="text-xs text-[#96999d]">Readiness</p><p className="mt-1 text-sm font-medium text-[#202124]">{pct(drawerConcept.learnerState?.readinessEstimate)}</p></div>
            </div>

            <div className="mt-6 space-y-6">
              <section>
                <h4 className="text-sm font-semibold text-[#202124]">前置知识</h4>
                <div className="mt-2 space-y-2 text-sm text-[#55585d]">
                  {drawerIncomingEdges.filter((edge) => edge.relationType === 'prerequisite').map((edge) => (
                    <p key={edge.id}>{conceptById.get(edge.from)?.title || edge.from}</p>
                  ))}
                  {!drawerIncomingEdges.some((edge) => edge.relationType === 'prerequisite') ? <p className="text-[#777b80]">暂无前置知识。</p> : null}
                </div>
              </section>
              <section>
                <h4 className="text-sm font-semibold text-[#202124]">图谱连接</h4>
                <div className="mt-2 grid gap-3 text-sm text-[#55585d] sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-[#96999d]">指向该知识点</p>
                    {drawerIncomingEdges.length ? drawerIncomingEdges.slice(0, 8).map((edge) => (
                      <p key={edge.id}>{relationMeta(edge.relationType).label} · {conceptById.get(edge.from)?.title || edge.from}</p>
                    )) : <p className="text-[#777b80]">暂无入边。</p>}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-[#96999d]">从该知识点延伸</p>
                    {drawerOutgoingEdges.length ? drawerOutgoingEdges.slice(0, 8).map((edge) => (
                      <p key={edge.id}>{relationMeta(edge.relationType).label} · {conceptById.get(edge.to)?.title || edge.to}</p>
                    )) : <p className="text-[#777b80]">暂无出边。</p>}
                  </div>
                </div>
              </section>
              <section>
                <h4 className="text-sm font-semibold text-[#202124]">常见误区</h4>
                <div className="mt-2 space-y-2 text-sm text-[#55585d]">
                  {drawerConcept.misconceptions?.length ? drawerConcept.misconceptions.map((item) => (
                    <p key={item.title}>{item.title}{item.repairHint ? `：${item.repairHint}` : ''}</p>
                  )) : <p className="text-[#777b80]">暂无误区记录。</p>}
                </div>
              </section>
              <section>
                <h4 className="text-sm font-semibold text-[#202124]">相关资源与任务</h4>
                <div className="mt-2 space-y-2 text-sm text-[#55585d]">
                  {drawerConcept.bindings?.length ? drawerConcept.bindings.map((item, index) => (
                    <p key={`${item.targetType}-${item.targetId}-${index}`}>{item.role} · {item.targetType} · {item.targetId}</p>
                  )) : <p className="text-[#777b80]">暂无绑定资源。</p>}
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
