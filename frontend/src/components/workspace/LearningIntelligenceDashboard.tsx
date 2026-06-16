import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Accordion from '@radix-ui/react-accordion';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FolderInput,
  History,
  Lightbulb,
  ListTree,
  Loader2,
  MoreVertical,
  Map as MapIcon,
  Maximize2,
  Eye,
  EyeOff,
  FileText,
  Filter,
  LocateFixed,
  MoreHorizontal,
  Network,
  NotebookTabs,
  Plus,
  PanelRightClose,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  Target,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { learningApi } from '../../services/learningApi';
import { mclApi, type MclExecuteResult, type MclLearningPlanStep } from '../../services/mclApi';
import { aiApi } from '../../services/aiApi';
import MarkdownPreview from '../workbench/MarkdownPreview';
import CosmosKnowledgeGraphWorkbench from './CosmosKnowledgeGraphWorkbench';
export type IntelligenceSection = 'overview' | 'knowledge' | 'diagnosis' | 'planning' | 'memory';
type KnowledgeView = 'graph' | 'list' | 'path';
type PlanningView = 'plans' | 'steps' | 'feedback';
type LearnerProfileEntryKind = 'profile' | 'events' | 'memory';
type ProfilePanelSort = 'updated' | 'category';
type ProfileTimelineChartMode = 'line' | 'bar';
type ProfileTimelineRange = '7d' | '30d' | '1y' | 'all';
type ProfileEditorKind = 'profile' | 'memory' | 'event';
type ProfileEditorCopy = {
  title: string;
  description: string;
  fieldLabel: string;
  placeholder: string;
  selectLabel: string;
  options: Array<{ value: string; label: string }>;
};
type PortraitDimension =
  | 'learningBackground'
  | 'learningGoal'
  | 'knowledgeFoundation'
  | 'cognitiveStyle'
  | 'learningPreference'
  | 'errorPattern'
  | 'learningRisk'
  | 'metacognitiveStrategy'
  | 'supportNeed';
interface LearningIntelligenceDashboardProps {
  workspaceId: string;
  workbenchId?: string;
  workbenches?: Array<{ id: string; title: string }>;
  activeSection?: IntelligenceSection;
  hideSectionNav?: boolean;
  headerTitle?: string;
  headerDescription?: string;
  onSectionChange?: (section: IntelligenceSection) => void;
  onOpenWorkbench?: (workbenchId: string) => void;
  onPlanApplied?: () => void;
  onOpenTerminal?: (prompt: string) => void;
}
export interface ConceptNode {
  id: string;
  title: string;
  description?: string;
  category?: string;
  difficulty?: number;
  tags?: Array<{
    id: string;
    label: string;
    normalizedLabel?: string;
    state: 'candidate' | 'applied';
    sources?: Array<'system_candidate' | 'ai_suggested' | 'user'>;
    rationale?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  sourceIds?: string[];
  sources?: GraphSourceRef[];
  aiEvidence?: {
    resourceEvidence?: Array<{ fileObjectId?: string; fileName?: string; path?: string; snippet?: string; quote?: string; chunkIndex?: number; sectionId?: string }>;
  };
  activationScore?: number;
  learnerState?: {
    masteryEstimate?: number;
    weaknessEstimate?: number;
    readinessEstimate?: number;
  } | null;
  bindings?: Array<{ targetType: string; targetId: string; role: string; strength?: number; fileObjectId?: string | null; fileName?: string | null; path?: string | null }>;
  misconceptions?: Array<{ title: string; repairHint?: string; severity?: number }>;
}
export interface ConceptEdge {
  id: string;
  from: string;
  to: string;
  relationType: string;
  weight?: number;
  confidence?: number;
  sourceIds?: string[];
  sources?: GraphSourceRef[];
}
export interface GraphSource {
  id: string;
  name: string;
  path?: string;
  resourceType?: string | null;
  origin?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  updatedAt?: string | null;
  nodeCount?: number;
  edgeCount?: number;
}
export interface GraphSourceRef extends GraphSource {
  role?: string | null;
  strength?: number | null;
  confidence?: number | null;
  snippets?: Array<{
    chunkId?: string | null;
    chunkIndex?: number | null;
    sectionId?: string | null;
    quote?: string;
    rationale?: string;
    confidence?: number | null;
  }>;
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
interface LearnerProfileView {
  source?: 'llm' | 'fallback';
  overview?: {
    stableCount?: number;
    workingCount?: number;
    memoryCount?: number;
    eventCount?: number;
    activeVersion?: number;
    summary?: string;
  };
  stableProfile?: Array<{ key: string; title: string; summary: string; items: ProfileDisplaySignal[] }>;
  workingState?: Array<{ key: string; title: string; summary: string; items: ProfileDisplaySignal[] }>;
  savedMemory?: ProfileDisplaySignal[];
  recentEvents?: Array<{ id: string; eventType?: string; summary?: string; confidence?: number; observedAt?: string }>;
  portraitEntities?: LearnerPortraitEntity[];
  portraitResolution?: LearnerPortraitResolutionView;
  portraitSummary?: { schema?: string; dimensions?: Record<string, number>; sourceFrameworks?: string[] };
  portraitPolish?: LearnerPortraitPolishView;
  dedupeNotes?: string[];
}
interface LearnerPortraitEntity {
  id: string;
  dimension: PortraitDimension;
  type: string;
  title: string;
  description: string;
  status: 'stable' | 'active' | 'candidate' | 'needs_review';
  polarity: 'strength' | 'need' | 'risk' | 'preference' | 'neutral';
  confidence: number;
  severity?: 'low' | 'medium' | 'high';
  evidenceCount: number;
  evidence?: Array<{ id: string; sourceType: string; sourceId?: string | null; summary: string; confidence: number; observedAt?: string; relatedConcepts?: string[] }>;
  affectedConcepts?: string[];
  recommendation?: string;
  updatedAt?: string | null;
  mergedFrom?: string[];
  mergeReason?: string;
  aliases?: string[];
  resolutionSource?: 'builder' | 'semantic_resolver' | 'resolver_fallback';
  displayTitle?: string;
  displayDescription?: string;
  displayRecommendation?: string;
}
interface LearnerPortraitPolishView {
  schema: 'learner_portrait_polish.v1';
  source: 'llm' | 'fallback' | 'cache' | 'pending' | 'failed';
  status: 'ready' | 'pending';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  message?: string | null;
  globalSummary: {
    headline: string;
    summary: string;
    priorityInsights: string[];
    nextBestActions: string[];
  };
  dimensionSummaries: Array<{
    dimension: PortraitDimension;
    title: string;
    summary: string;
    tone: 'stable' | 'active' | 'needs_attention' | 'insufficient_evidence';
  }>;
  entities: LearnerPortraitEntity[];
}
interface LearnerPortraitResolutionView {
  schema: 'learner_portrait_resolution.v1';
  source: 'llm' | 'fallback' | 'cache' | 'pending' | 'failed';
  status: 'ready' | 'pending';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  message?: string | null;
  originalCount: number;
  resolvedCount: number;
  mergeCount: number;
  entities: LearnerPortraitEntity[];
  clusters: Array<{
    canonicalEntityId: string;
    dimension: PortraitDimension;
    mergedEntityIds: string[];
    mergeReason: string;
  }>;
}
interface LearningIntelligenceSnapshot {
  version: number;
  savedAt: number;
  workspaceId: string;
  workbenchId?: string | null;
  integration: any;
  graph: { nodes: ConceptNode[]; edges: ConceptEdge[]; sources?: GraphSource[] };
  diagnosis: any;
  kgPlan: any;
  targetStructure: any;
  gapAnalysis: any;
  mclPlan: any;
  mclPlans: any[];
  events: any[];
  sequences: any[];
  learnerState: any;
  memories: any[];
  learnerMemories?: any[];
  learnerMemoryControls?: any[];
  savedMemories?: any[];
  learnerProfileView: LearnerProfileView | null;
  planningObjective: string;
}
export const learningIntelligenceSectionItems: Array<{
  id: IntelligenceSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', description: '状态、变化、入口', icon: Sparkles },
  { id: 'diagnosis', label: 'Diagnosis', description: '诊断报告对象', icon: Brain }
];
const pct = (value?: number | null) => `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
const score = (value?: number | null) => Number(value ?? 0).toFixed(2);
const formatShortDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};
const formatCalendarDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const time = date.getTime();

  if (time >= startOfToday) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (time >= startOfYesterday) {
    return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric' });
};
const formatRelative = (value?: string | null) => {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const diffMs = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  if (diffMs < day * 7) return `${Math.floor(diffMs / day)} 天前`;
  return `${Math.floor(diffMs / day / 7)} 周前`;
};
const getTimeRange = (value?: string | null) => {
  if (!value) return '更早';
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return '更早';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = startOfToday - 30 * 24 * 60 * 60 * 1000;

  if (time >= startOfToday) return '今天';
  if (time >= startOfYesterday) return '昨天';
  if (time >= startOfWeek) return '过去 7 天';
  if (time >= startOfMonth) return '过去 30 天';
  return date.toLocaleDateString('zh-CN', { month: 'long' });
};
const clipText = (value: unknown, max = 110) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
};
type KgSearchGroup = '概念' | '来源' | '标签' | '关系' | '误区';
type KgSearchFacet = 'All' | KgSearchGroup;
type KgSearchResult = {
  id: string;
  group: KgSearchGroup;
  conceptId: string;
  title: string;
  subtitle: string;
  matchReason: string;
  explanation: string;
  previewTitle: string;
  previewBody: string;
  previewMeta: string[];
  snippets: string[];
  tags: string[];
  score: number;
};
const kgSearchFacets: KgSearchFacet[] = ['All', '概念', '来源', '标签', '关系', '误区'];
const kgRecentSearchesStorageKey = 'workspace_kg_recent_searches';
const normalizeSearchText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/\\.,;:()[\]{}'"`|!?<>+=*&^%$#@~，。；：！？（）【】《》、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const searchTokens = (value: string) => normalizeSearchText(value).split(' ').filter(Boolean);
const acronymFor = (value: string) => {
  const words = normalizeSearchText(value).split(' ').filter(Boolean);
  return words.length > 1 ? words.map((word) => word[0]).join('') : '';
};
const semanticExpansionsFor = (query: string) => {
  const normalized = normalizeSearchText(query);
  const expansions = new Set(searchTokens(normalized));
  const semanticMap: Array<[RegExp, string[]]> = [
    [/ai|人工智能|llm|大模型|模型/, ['artificial intelligence', 'machine learning', 'llm', 'model', 'prompt', 'inference', 'embedding']],
    [/database|db|数据库/, ['sql', 'transaction', 'index', 'schema', 'query', 'storage']],
    [/frontend|前端|ui|界面/, ['react', 'component', 'css', 'layout', 'interaction']],
    [/backend|后端|api|服务/, ['server', 'route', 'database', 'service', 'endpoint']],
    [/graph|图谱|知识图谱/, ['node', 'edge', 'relation', 'concept', 'knowledge graph']],
    [/test|测试|验证/, ['unit', 'integration', 'assertion', 'coverage', 'check']],
    [/tag|标签/, ['label', 'classification', 'category', 'taxonomy']],
    [/source|资料|来源|文档/, ['document', 'file', 'evidence', 'snippet', 'quote']]
  ];
  semanticMap.forEach(([pattern, words]) => {
    if (pattern.test(normalized)) words.forEach((word) => expansions.add(word));
  });
  return Array.from(expansions).filter(Boolean);
};
const fuzzySubsequenceScore = (query: string, text: string) => {
  const q = normalizeSearchText(query).replace(/\s+/g, '');
  const t = normalizeSearchText(text).replace(/\s+/g, '');
  if (!q || !t) return 0;
  let qIndex = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < t.length && qIndex < q.length; index += 1) {
    if (t[index] === q[qIndex]) {
      if (first < 0) first = index;
      last = index;
      qIndex += 1;
    }
  }
  if (qIndex !== q.length) return 0;
  const span = Math.max(1, last - first + 1);
  return Math.max(0.08, Math.min(0.42, q.length / span));
};
const scoreSearchField = (query: string, value: unknown, weight: number) => {
  const text = normalizeSearchText(value);
  const normalizedQuery = normalizeSearchText(query);
  if (!text || !normalizedQuery) return 0;
  if (text === normalizedQuery) return weight;
  if (text.startsWith(normalizedQuery)) return weight * 0.88;
  if (text.includes(normalizedQuery)) return weight * 0.72;
  const tokens = searchTokens(normalizedQuery);
  const tokenHits = tokens.filter((token) => text.includes(token)).length;
  const tokenScore = tokens.length ? (tokenHits / tokens.length) * weight * 0.5 : 0;
  const acronym = acronymFor(String(value || ''));
  const acronymScore = acronym && acronym.includes(normalizedQuery.replace(/\s+/g, '')) ? weight * 0.48 : 0;
  return Math.max(tokenScore, acronymScore, fuzzySubsequenceScore(normalizedQuery, text) * weight);
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
const planStepStatusLabel = (status?: string) => {
  if (status === 'active') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'skipped') return '已跳过';
  return '未开始';
};
const planStepStatusClass = (status?: string) => {
  if (status === 'active') return 'bg-black text-white';
  if (status === 'done') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  if (status === 'blocked') return 'bg-red-50 text-red-700 ring-1 ring-red-100';
  if (status === 'skipped') return 'bg-gray-100 text-gray-500';
  return 'bg-gray-100 text-gray-600';
};
const planStepCardClass = (status?: string, selected?: boolean) => {
  if (status === 'active') {
    return selected
      ? 'border-neutral-900 bg-neutral-50 ring-1 ring-neutral-200'
      : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300';
  }
  if (status === 'done') {
    return selected
      ? 'border-emerald-200 bg-emerald-50 ring-1 ring-emerald-100'
      : 'border-emerald-100 bg-emerald-50 hover:border-emerald-200';
  }
  if (status === 'blocked') {
    return selected
      ? 'border-red-200 bg-red-50 ring-1 ring-red-100'
      : 'border-red-100 bg-red-50 hover:border-red-200';
  }
  if (status === 'skipped') {
    return selected
      ? 'border-gray-200 bg-gray-50 ring-1 ring-gray-200'
      : 'border-gray-100 bg-gray-50 hover:border-gray-200';
  }
  return selected
    ? 'border-gray-200 bg-white ring-1 ring-gray-200'
    : 'border-gray-100 bg-white hover:border-gray-200';
};
const planStepTitleClass = (status?: string) => (status === 'blocked' ? 'text-red-950' : 'text-black');
const planStepNarrativeClass = (status?: string) => (status === 'blocked' ? 'text-red-700' : 'text-gray-500');
const planStepStatusOptions = ['pending', 'active', 'blocked', 'done', 'skipped'] as const;
type PlanStepStatus = typeof planStepStatusOptions[number];
const normalizePlanStepStatus = (status?: string): PlanStepStatus =>
  planStepStatusOptions.includes(status as PlanStepStatus) ? status as PlanStepStatus : 'pending';
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
type StageSupportMatch = {
  id: string;
  title: string;
  unit: string;
  entryPoint: string;
  reason: string;
  matchScore?: number;
};
type StageSupport = {
  stageId: string;
  status?: string;
  matchedConcepts: string[];
  missingConcepts: string[];
  prerequisiteNotes: string[];
  resources: StageSupportMatch[];
  resourceGap?: string;
};
type StagePatchProposal = {
  id: string;
  type: 'stage_patch';
  stageId: string;
  summary: string;
  title: string;
  content: string;
  rationale?: string;
  risks?: string[];
  createdAt?: string;
};
type StageActionMode = 'menu' | 'explain' | 'modify' | 'sources';
type StageChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};
type RouteActionMode = 'idle' | 'explain' | 'modify';
type PlanReviewResult = {
  id: string;
  summary: string;
  suggestions: Array<{
    stageId?: string;
    stageTitle?: string;
    issue: string;
    recommendation: string;
    priority?: string;
  }>;
  createdAt?: string;
};
const planReviewSuggestionKey = (item: PlanReviewResult['suggestions'][number], index: number) =>
  `${item.stageId || ''}:${item.stageTitle || ''}:${item.issue}:${item.recommendation}:${index}`;
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
const markdownForStage = (stage: StructuredStage) =>
  String(stage.detail?.narrative || stage.display?.narrative || stage.display?.summary || '').trim();
const formatMatchScore = (value: number) => {
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
};
const normalizeStageSupport = (plan: any, stages: StructuredStage[]): StageSupport[] => {
  const snapshot = plan?.knowledgeGraphSnapshot || {};
  const enhancements = snapshot?.planningEnhancements || {};
  const compiler = snapshot?.planningQueryCompiler || {};
  const stageSignals = safeArray<any>(compiler?.stageSignals);
  const stageGroundings = safeArray<any>(enhancements?.resourceGrounding?.grounding?.stageGroundings);
  const warnings = safeArray<any>(enhancements?.kgAlignment?.audit?.warnings);
  const matchedConcepts = safeArray<string>(enhancements?.kgAlignment?.matchedConcepts);
  const missingConcepts = safeArray<string>(enhancements?.kgAlignment?.missingConcepts);

  return stages.map((stage, index) => {
    const stageId = structuredStageId(stage, index);
    const signal = stageSignals[index] || {};
    const grounding = stageGroundings[index] || {};
    const stageWarnings = warnings
      .filter((warning) => !warning?.stageId || warning.stageId === grounding.stageId || warning.stageId === signal.id)
      .map((warning) => cleanNarrative(warning?.message || warning?.reason || warning))
      .filter(Boolean);
    const signalConcepts = safeArray<string>(signal?.concepts).map(cleanNarrative).filter(Boolean);
    return {
      stageId,
      status: grounding?.status,
      matchedConcepts: (signalConcepts.length ? signalConcepts : matchedConcepts).slice(0, 6),
      missingConcepts: missingConcepts.slice(0, 4),
      prerequisiteNotes: Array.from(new Set(stageWarnings)).slice(0, 3),
      resources: safeArray<any>(grounding?.matches).slice(0, 4).map((match, matchIndex) => ({
        id: match?.resourceUnitId || match?.resourceId || match?.resourceTitle || `${stageId}-resource-${matchIndex}`,
        title: cleanNarrative(match?.resourceTitle || match?.title || 'Workspace 资料'),
        unit: cleanNarrative(match?.resourceUnitTitle || match?.unit || ''),
        entryPoint: cleanNarrative(match?.resourceEntryPoint || match?.entryPoint || ''),
        reason: cleanNarrative(match?.reason || '与当前阶段目标较匹配。'),
        matchScore: typeof match?.matchScore === 'number' ? match.matchScore : undefined
      })),
      resourceGap: cleanNarrative(grounding?.gapReason || grounding?.neededResource || '')
    };
  });
};
const supportSummaryText = (support?: StageSupport) => {
  if (!support) return '依据待补充';
  const parts = [
    support.matchedConcepts.length ? `命中 ${support.matchedConcepts.length} 个知识点` : '',
    support.resources.length ? `${support.resources.length} 份资料支撑` : '',
    support.prerequisiteNotes.length ? `${support.prerequisiteNotes.length} 条前置提醒` : '',
    support.resourceGap && !support.resources.length ? '资料缺口待补' : ''
  ].filter(Boolean);
  return parts.length ? parts.join('，') : '依据待补充';
};
const stageRouteNarrative = (stage: RouteCanvasStage) => {
  const title = cleanNarrative(stage.title);
  const summary = cleanNarrative(stage.summary)
    .replace(/^#+\s*/g, '')
    .replace(/[-*]\s*/g, '')
    .trim();
  if (summary && summary !== title) return clipText(summary, 118);
  return title ? `这一阶段先围绕「${title}」建立清晰的理解，再把它接到后续学习任务里。` : '这一阶段先处理当前最关键的学习任务。';
};
const LearningRouteCanvas = ({
  stages,
  selectedStageId,
  onSelectStage,
  onClearStage,
  renderStagePanel,
  className = ''
}: {
  stages: RouteCanvasStage[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
  onClearStage?: () => void;
  renderStagePanel?: (stage: RouteCanvasStage, pinned: boolean) => React.ReactNode;
  className?: string;
}) => {
  const [hoveredStageId, setHoveredStageId] = useState<string | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const hoveredStage = stages.find((stage) => stage.id === hoveredStageId) || null;
  const selectedStage = stages.find((stage) => stage.id === selectedStageId) || null;
  const activeStage = selectedStage || hoveredStage;
  const activeStagePinned = Boolean(selectedStage);
  const width = 980;
  const rowGap = 190;
  const cardW = 320;
  const cardH = 116;
  const top = 78;
  const spineX = 110;
  const cardX = 170;
  const height = Math.max(520, top + Math.max(0, stages.length - 1) * rowGap + cardH + 104);
  const nodes = stages.map((stage, index) => ({
    stage,
    x: cardX,
    y: top + index * rowGap,
    dotX: spineX,
    dotY: top + index * rowGap + cardH / 2
  }));
  const holdHover = (stageId: string) => {
    if (hoverClearTimerRef.current != null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    setHoveredStageId(stageId);
  };
  const releaseHover = (stageId: string) => {
    if (hoverClearTimerRef.current != null) window.clearTimeout(hoverClearTimerRef.current);
    hoverClearTimerRef.current = window.setTimeout(() => {
      setHoveredStageId((current) => current === stageId ? null : current);
      hoverClearTimerRef.current = null;
    }, 140);
  };

  return (
    <div className={`relative min-h-[520px] overflow-hidden rounded-none border-0 bg-white font-primary ${className}`}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(107, 114, 128, 0.26) 1px, transparent 0)',
          backgroundSize: '20px 20px'
        }}
      />
      <div className="absolute inset-0 overflow-auto">
        <div
          className="relative min-h-full"
          style={{ width, height }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            onClearStage?.();
          }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} fill="none">
            <path
              d={`M ${spineX} ${top + cardH / 2} L ${spineX} ${top + Math.max(0, stages.length - 1) * rowGap + cardH / 2}`}
              stroke="#d4d4d8"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
            {nodes.slice(0, -1).map(({ stage, dotX, dotY }, index) => {
              const next = nodes[index + 1];
              const active = selectedStageId === stage.id || selectedStageId === next.stage.id;
              return (
                <path
                  key={`route-edge-${stage.id}`}
                  d={`M ${dotX} ${dotY} C ${dotX + 20} ${dotY}, ${cardX - 24} ${dotY}, ${cardX} ${dotY} M ${cardX + cardW} ${dotY} C ${cardX + cardW + 28} ${dotY}, ${cardX + cardW + 28} ${next.dotY}, ${cardX + cardW} ${next.dotY}`}
                  stroke={active ? '#9ca3af' : '#d1d5db'}
                  strokeWidth={active ? 1.5 : 1}
                  strokeDasharray={active ? '' : '4 6'}
                  opacity={active ? 0.9 : 0.72}
                />
              );
            })}
          </svg>

          {nodes.map(({ stage, x, y, dotX, dotY }) => {
            const selected = stage.id === selectedStageId;
            const hovered = stage.id === hoveredStageId;
            return (
              <button
                key={stage.id}
                type="button"
                onMouseEnter={() => holdHover(stage.id)}
                onMouseLeave={() => releaseHover(stage.id)}
                onFocus={() => holdHover(stage.id)}
                onBlur={() => releaseHover(stage.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectStage(stage.id);
                }}
                className={`group absolute flex overflow-hidden rounded-xl border px-4 py-4 text-left shadow-md outline-none transition duration-100 focus:outline-none ${planStepCardClass(stage.status, selected)}`}
                style={{ left: x, top: y, width: cardW, height: cardH, animation: 'workspace-menu-enter 120ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
              >
                <span
                  className={`absolute flex h-2 w-2 rounded-full transition ${
                    selected ? 'bg-gray-900' : 'bg-gray-300 group-hover:bg-gray-900'
                  }`}
                  style={{ left: dotX - x - 4, top: dotY - y - 4 }}
                />
                <span className="flex h-full w-full min-w-0 overflow-hidden">
                  <span className={`size-5 -translate-y-[1px] flex-shrink-0 rounded-full text-center text-[10px] font-medium leading-5 ${
                    selected ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {stage.order}
                  </span>
                  <span className="ml-2 min-w-0 flex-1 overflow-hidden">
                    <span className={`block line-clamp-2 text-sm font-semibold leading-5 ${planStepTitleClass(stage.status)}`}>{stage.title}</span>
                    <span className={`mt-1 block max-h-[48px] overflow-hidden text-sm leading-6 ${planStepNarrativeClass(stage.status)}`}>
                      {stageRouteNarrative(stage)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${planStepStatusClass(stage.status)}`}>
                        {planStepStatusLabel(stage.status)}
                      </span>
                      {stage.duration ? (
                        <span className="inline-flex rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          {stage.duration}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
                <span className={`invisible absolute right-3 top-3 size-3 rounded-full border transition group-hover:visible ${selected || hovered ? 'visible border-gray-400 bg-gray-50' : 'border-gray-200 bg-white'}`} />
              </button>
            );
          })}

          {activeStage ? (() => {
            const node = nodes.find((item) => item.stage.id === activeStage.id);
            if (!node) return null;
            const support = activeStage.support;
            return (
              <div
                className="absolute z-20 w-[380px] rounded-2xl border border-gray-100 bg-white p-4 text-left text-sm text-gray-700 shadow-xl"
                style={{
                  left: node.x + cardW + 20,
                  top: Math.min(Math.max(16, node.y - 2), height - (activeStagePinned ? 520 : 300)),
                  animation: 'workspace-menu-enter 120ms cubic-bezier(0.16, 1, 0.3, 1) both'
                }}
                onClick={(event) => event.stopPropagation()}
                onMouseEnter={() => holdHover(activeStage.id)}
                onMouseLeave={() => releaseHover(activeStage.id)}
              >
                {renderStagePanel ? renderStagePanel(activeStage, activeStagePinned) : (
                  <>
                    <div className="font-semibold text-gray-950">{activeStage.title}</div>
                    <p className="mt-2 text-sm leading-6 text-gray-600">{stageRouteNarrative(activeStage)}</p>
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <div className="text-xs font-medium text-gray-400">Grounding</div>
                      <p className="mt-1 leading-6 text-gray-600">{activeStage.supportText}</p>
                      {support?.matchedConcepts.length ? (
                        <p className="mt-1 line-clamp-2 leading-6 text-gray-500">{support.matchedConcepts.slice(0, 3).join(' / ')}</p>
                      ) : null}
                      {support?.resources.length ? (
                        <p className="mt-1 line-clamp-1 leading-6 text-gray-500">{support.resources[0].unit || support.resources[0].title}</p>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })() : null}
        </div>
      </div>
    </div>
  );
};
type PlanDisplayMeta = { emoji: string; title: string };
type RouteCanvasStage = {
  id: string;
  order: number;
  title: string;
  duration: string;
  summary: string;
  supportText: string;
  status?: string;
  support?: StageSupport;
};
const planMetaStorageKey = (workspaceId: string) => `workspace-planning:display-meta:${workspaceId}`;
const planTextForMeta = (plan: any) =>
  cleanNarrative(plan?.structuredPlan?.objective || plan?.objective || plan?.structuredPlan?.title || plan?.naturalPlanMarkdown || '学习计划');
const inferPlanEmoji = (text: string) => {
  if (/关系代数|数据库|sql|查询|范式|事务/i.test(text)) return '🧮';
  if (/数学|代数|微积分|概率|统计/i.test(text)) return '📐';
  if (/编程|代码|前端|后端|算法|python|react|typescript/i.test(text)) return '💻';
  if (/考试|备考|冲刺|题/i.test(text)) return '🎯';
  if (/项目|作品|实战|实践/i.test(text)) return '🛠️';
  if (/论文|阅读|文献|写作/i.test(text)) return '📚';
  return '🗺️';
};
const fallbackPlanMeta = (plan: any): PlanDisplayMeta => {
  const text = planTextForMeta(plan);
  const withoutPromptPrefix = text
    .replace(/^给我一个学习计划[，,:：\s]*/i, '')
    .replace(/^请.*?(?:学习计划|计划)[，,:：\s]*/i, '')
    .replace(/^我想要?/i, '')
    .trim();
  const title = clipText(withoutPromptPrefix || text, 18).replace(/[。.!?？]+$/, '') || '学习路线';
  return { emoji: inferPlanEmoji(text), title };
};
const parsePlanMetaReply = (reply: string, plan: any): PlanDisplayMeta => {
  try {
    const jsonText = reply.match(/\{[\s\S]*\}/)?.[0] || reply;
    const parsed = JSON.parse(jsonText);
    const fallback = fallbackPlanMeta(plan);
    return {
      emoji: String(parsed.emoji || fallback.emoji).trim().slice(0, 4) || fallback.emoji,
      title: clipText(parsed.title || fallback.title, 18) || fallback.title
    };
  } catch {
    return fallbackPlanMeta(plan);
  }
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
type ProfileDisplaySignal = {
  id: string;
  label: string;
  value: string;
  dimension: string;
  confidence?: number | null;
  status?: string | null;
  evidenceIds?: string[];
  sources?: string[];
  rationale?: string;
  lastObservedAt?: string | null;
  firstObservedAt?: string | null;
  sourceType?: string;
};
type ProfileLayer = 'stable' | 'working' | 'memory';
type ProfileVisualNode = {
  dimension: string;
  title: string;
  detail: string;
  count: number;
  layerCounts: Record<ProfileLayer, number>;
  confidence: number;
  samples: string[];
  entities?: LearnerPortraitEntity[];
  polarityCounts?: Record<LearnerPortraitEntity['polarity'], number>;
  statusCounts?: Record<LearnerPortraitEntity['status'], number>;
};
const profileDimensionMeta: Record<string, { title: string; detail: string }> = {
  profileBase: { title: '画像基础', detail: '学习目标、当前课程上下文与阶段性关注点。' },
  knowledgeState: { title: '知识状态', detail: '已掌握、薄弱、前置缺口等知识状态。' },
  preferenceStyle: { title: 'Preference Style', detail: '解释方式、资源形态和练习偏好。' },
  misconceptionState: { title: 'Misconception State', detail: '反复出现的误区、错误模式与纠正线索。' },
  cognitiveState: { title: 'Cognitive State', detail: '认知负荷、提问模式与学习习惯特征。' },
  behaviorEngagement: { title: 'Behavior / Engagement', detail: '近期行为、参与度与使用节奏。' },
  reviewPlanning: { title: 'Review Planning', detail: '复习压力、下一步动作与计划状态。' },
  savedMemory: { title: '已保存记忆', detail: '用户可控的长期偏好、背景或明确记住的信息。' }
};
const portraitDimensionMeta: Record<PortraitDimension, { title: string; detail: string }> = {
  learningBackground: { title: '学习背景', detail: '专业、课程、历史经验与学习场景。' },
  learningGoal: { title: '学习目标', detail: '当前目标、长期目标、成功标准与时间约束。' },
  knowledgeFoundation: { title: '知识基础', detail: '已掌握、薄弱、前置缺口与可学习状态。' },
  cognitiveStyle: { title: '认知风格', detail: '示例驱动、视觉化、步骤化、抽象推理等理解方式。' },
  learningPreference: { title: '学习偏好', detail: '讲解、资源、反馈和互动形式偏好。' },
  errorPattern: { title: '易错模式', detail: '概念混淆、边界遗漏、推理跳步和修复状态。' },
  learningRisk: { title: '学习风险', detail: '过载、迁移、遗忘、提示依赖和知识断层风险。' },
  metacognitiveStrategy: { title: '元认知策略', detail: '计划、监控、反思、求助和策略调整。' },
  supportNeed: { title: '支持需求', detail: '脚手架、诊断、练习、反馈与资源支持。' }
};
const portraitDimensionOrder: PortraitDimension[] = [
  'learningBackground',
  'learningGoal',
  'knowledgeFoundation',
  'cognitiveStyle',
  'learningPreference',
  'errorPattern',
  'learningRisk',
  'metacognitiveStrategy',
  'supportNeed'
];
const savedMemoryCategoryOptions = [
  { value: 'preference', label: 'preference' },
  { value: 'background', label: 'background' },
  { value: 'note', label: 'note' }
];
const recentEventTypeOptions = [
  { value: 'manual.profile_event', label: 'manual.profile_event' },
  { value: 'manual.learning_update', label: 'manual.learning_update' },
  { value: 'manual.short_term_observation', label: 'manual.short_term_observation' }
];
const profileDimensionOrder = [
  'profileBase',
  'knowledgeState',
  'preferenceStyle',
  'misconceptionState',
  'cognitiveState',
  'behaviorEngagement',
  'reviewPlanning',
  'savedMemory'
];
const normalizeProfileText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/epsilon/g, 'ε')
    .replace(/[\s"'`“”‘’.,，。:：;；!?！？()[\]{}<>《》/\\|-]+/g, '')
    .trim();
const isRawPromptLikeProfileText = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.length > 180) return true;
  if (/[?？]$/.test(text)) return true;
  if (/^(请|帮我|你帮我|请你|我现在主要想|我想让你|能不能|可不可以)/.test(text)) return true;
  if (/source\s*guide|只输出正文|不要标题|spContent\s*=|https?:\/\//i.test(text)) return true;
  return false;
};
const polishProfileValue = (value: unknown) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^(用户|学生|学习者)(?:表示|希望|想要|提到)[:：,，\s]*/i, '')
    .replace(/^我(?:想|希望|需要|打算|正在)[:：,，\s]*/i, '')
    .replace(/[。！？!?\s]+$/g, '')
    .trim();
const signalRecency = (signal: ProfileDisplaySignal) => {
  const time = new Date(signal.lastObservedAt || signal.firstObservedAt || '').getTime();
  return Number.isFinite(time) ? time : 0;
};
const signalRank = (signal: ProfileDisplaySignal) => {
  const statusWeight = signal.status === 'active' ? 0.2 : signal.status === 'candidate' ? 0.05 : 0;
  const evidenceWeight = Math.min(0.16, safeArray(signal.evidenceIds).length * 0.04);
  return Number(signal.confidence || 0) + statusWeight + evidenceWeight + Math.min(0.1, signal.value.length / 1200);
};
const dedupeProfileSignals = (signals: ProfileDisplaySignal[], limit = 8, options?: { keepPromptLike?: boolean }) => {
  const selected: ProfileDisplaySignal[] = [];
  const sorted = signals
    .map((signal) => ({ ...signal, value: polishProfileValue(signal.value) }))
    .filter((signal) => signal.value && (options?.keepPromptLike || !isRawPromptLikeProfileText(signal.value)))
    .sort((a, b) => signalRank(b) - signalRank(a) || signalRecency(b) - signalRecency(a));
  for (const signal of sorted) {
    const normalized = normalizeProfileText(signal.value);
    if (!normalized) continue;
    const duplicate = selected.some((existing) => {
      const other = normalizeProfileText(existing.value);
      if (!other) return false;
      return normalized === other || normalized.includes(other) || other.includes(normalized);
    });
    if (!duplicate) selected.push(signal);
    if (selected.length >= limit) break;
  }
  return selected;
};
const groupProfileSignals = (signals: ProfileDisplaySignal[], limitPerGroup = 5, options?: { keepPromptLike?: boolean }) => {
  const grouped = new Map<string, ProfileDisplaySignal[]>();
  signals.forEach((signal) => {
    const key = signal.dimension || 'profileBase';
    grouped.set(key, [...(grouped.get(key) || []), signal]);
  });
  return Array.from(grouped.entries())
    .sort((a, b) => profileDimensionOrder.indexOf(a[0]) - profileDimensionOrder.indexOf(b[0]))
    .map(([dimension, items]) => ({
      dimension,
      meta: profileDimensionMeta[dimension] || { title: dimension, detail: '学习画像维度。' },
      items: dedupeProfileSignals(items, limitPerGroup, options)
    }))
    .filter((group) => group.items.length);
};
const profileDimensionIcon = (dimension: string) => {
  if (dimension === 'knowledgeState') return Network;
  if (dimension === 'preferenceStyle') return SlidersHorizontal;
  if (dimension === 'misconceptionState') return Target;
  if (dimension === 'cognitiveState') return Brain;
  if (dimension === 'behaviorEngagement') return Activity;
  if (dimension === 'reviewPlanning') return Route;
  if (dimension === 'savedMemory') return BookOpen;
  return ShieldCheck;
};
const toProfileSignal = (signal: any, dimension: string, fallbackLabel: string, sourceType?: string): ProfileDisplaySignal => ({
  id: String(signal?.id || signal?.key || signal?.memoryKey || `${dimension}:${fallbackLabel}:${signal?.value || signal?.text || Math.random()}`),
  label: String(signal?.label || fallbackLabel),
  value: String(signal?.value || signal?.text || signal?.content || '').trim(),
  dimension,
  confidence: typeof signal?.confidence === 'number' ? signal.confidence : null,
  status: signal?.status || null,
  evidenceIds: safeArray<string>(signal?.evidenceIds),
  sources: safeArray<string>(signal?.sources),
  rationale: signal?.rationale || signal?.reason || '',
  firstObservedAt: signal?.firstObservedAt || null,
  lastObservedAt: signal?.lastObservedAt || signal?.updatedAt || signal?.createdAt || null,
  sourceType
});
const profileDimensionColor = (dimension: string) => {
  if (dimension === 'learningBackground') return { fill: '#eef1f4', stroke: '#7b8794', text: '#34373c' };
  if (dimension === 'learningGoal') return { fill: '#eaf4ff', stroke: '#5b9ad6', text: '#265f96' };
  if (dimension === 'knowledgeFoundation') return { fill: '#e8f6ef', stroke: '#48a06a', text: '#24613d' };
  if (dimension === 'cognitiveStyle') return { fill: '#f2ecff', stroke: '#8f6bdc', text: '#5b3f93' };
  if (dimension === 'learningPreference') return { fill: '#fff7d7', stroke: '#d4aa20', text: '#765d00' };
  if (dimension === 'errorPattern') return { fill: '#fff0e3', stroke: '#e28a3b', text: '#944d0b' };
  if (dimension === 'learningRisk') return { fill: '#ffe9e6', stroke: '#df5b4d', text: '#9d2c22' };
  if (dimension === 'metacognitiveStrategy') return { fill: '#e8f6f8', stroke: '#45a7b2', text: '#1f6570' };
  if (dimension === 'supportNeed') return { fill: '#f5efea', stroke: '#a98267', text: '#684936' };
  if (dimension === 'knowledgeState') return { fill: '#e8f2ff', stroke: '#5b8def', text: '#244f9e' };
  if (dimension === 'preferenceStyle') return { fill: '#f2ecff', stroke: '#8f6bdc', text: '#5b3f93' };
  if (dimension === 'misconceptionState') return { fill: '#fff0e3', stroke: '#e79b4f', text: '#9a530d' };
  if (dimension === 'cognitiveState') return { fill: '#e9f7f0', stroke: '#55a374', text: '#276343' };
  if (dimension === 'behaviorEngagement') return { fill: '#fff7cf', stroke: '#d1a817', text: '#725a00' };
  if (dimension === 'reviewPlanning') return { fill: '#e8f6f8', stroke: '#45a7b2', text: '#1f6570' };
  if (dimension === 'savedMemory') return { fill: '#f5efea', stroke: '#a98267', text: '#684936' };
  return { fill: '#f1f1ef', stroke: '#8a8e94', text: '#34373c' };
};
const profileChartFill = (dimension: string) => profileDimensionColor(dimension).stroke;
const profileTrendBucketLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};
const profileMenuAnimationStyle = `
@keyframes profile-menu-in {
  from {
    opacity: 0;
    transform: translate3d(0, -8px, 0) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}
`;
const profileControlKey = (dimension: string, value: string) =>
  `${dimension}:${String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5:_-]/gi, '')
    .slice(0, 80)}`;
const portraitPolishBadge = (polish?: LearnerPortraitPolishView | null) => {
  if (!polish) return { label: '规则版', detail: '当前展示由结构化规则生成。', className: 'bg-[#f5f5f3] text-[#55585d] ring-[#e5e5df]' };
  if (polish.status === 'pending') return { label: 'AI 精修中', detail: '当前先展示规则版，AI 正在后台润色。', className: 'bg-[#fff7e6] text-[#8b5a00] ring-[#fedf9b]' };
  if (polish.source === 'llm' || polish.source === 'cache') {
    const when = polish.generatedAt ? `生成时间：${new Date(polish.generatedAt).toLocaleString()}` : '生成时间未知';
    const model = polish.model ? `模型：${polish.provider || 'AI'} / ${polish.model}` : '模型信息未记录';
    return { label: polish.source === 'cache' ? 'AI 精修缓存' : 'AI 已精修', detail: `标题、摘要和建议已由 AI 基于证据润色。${when}；${model}。`, className: 'bg-[#eef7f0] text-[#2f6f46] ring-[#cfe8d4]' };
  }
  if (polish.source === 'failed') return { label: '规则版', detail: 'AI 精修超时或失败，当前展示规则版画像。', className: 'bg-[#fff1f1] text-[#b42318] ring-[#ffd6d6]' };
  return { label: '规则版', detail: '当前展示由结构化规则生成。', className: 'bg-[#f5f5f3] text-[#55585d] ring-[#e5e5df]' };
};
const portraitResolutionBadge = (resolution?: LearnerPortraitResolutionView | null) => {
  if (!resolution) return { label: '候选实体', detail: '当前展示为画像候选实体，尚未进入语义归并。', className: 'bg-[#f5f5f3] text-[#55585d] ring-[#e5e5df]' };
  if (resolution.status === 'pending') return { label: '语义归并中', detail: '当前先展示候选实体，后台正在按语义合并重叠画像。', className: 'bg-[#fff7e6] text-[#8b5a00] ring-[#fedf9b]' };
  if (resolution.source === 'llm' || resolution.source === 'cache') {
    const merged = resolution.mergeCount > 0 ? `已合并 ${resolution.mergeCount} 条重叠信号。` : '未发现需要合并的重叠实体。';
    const when = resolution.generatedAt ? `生成时间：${new Date(resolution.generatedAt).toLocaleString()}` : '生成时间未知';
    return { label: resolution.source === 'cache' ? '语义归并缓存' : '语义已归并', detail: `${merged}${when}。`, className: 'bg-[#eef7f0] text-[#2f6f46] ring-[#cfe8d4]' };
  }
  if (resolution.source === 'failed') return { label: '候选实体', detail: '语义归并超时或失败，当前展示候选实体。', className: 'bg-[#fff1f1] text-[#b42318] ring-[#ffd6d6]' };
  return { label: '候选实体', detail: '当前展示为画像候选实体。', className: 'bg-[#f5f5f3] text-[#55585d] ring-[#e5e5df]' };
};
const courseGraphBuildJobStorageKey = (workspaceId: string, workbenchId?: string) =>
  `course-graph-build-job:${workspaceId}:${workbenchId || 'workspace'}`;
const intelligenceSnapshotKey = (workspaceId: string, workbenchId?: string) =>
  `learning-intelligence:snapshot:${workspaceId}:${workbenchId || 'workspace'}`;
const INTELLIGENCE_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const INTELLIGENCE_SNAPSHOT_VERSION = 5;
const normalizeWorkbenchKey = (workbenchId?: string | null) => workbenchId || null;
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
  showEdgeLabels: false,
  nodeScale: 1,
  edgeScale: 1,
  repelForce: 1.25,
  linkDistance: 1.2,
  centerForce: 0.55,
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
const loadIntelligenceSnapshot = (workspaceId: string, workbenchId?: string): LearningIntelligenceSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(intelligenceSnapshotKey(workspaceId, workbenchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LearningIntelligenceSnapshot;
    if (parsed.version !== INTELLIGENCE_SNAPSHOT_VERSION) return null;
    if (!parsed || parsed.workspaceId !== workspaceId || parsed.workbenchId !== normalizeWorkbenchKey(workbenchId)) return null;
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > INTELLIGENCE_SNAPSHOT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};
const profileViewNeedsRefresh = (profileView?: LearnerProfileView | null) => {
  if (!profileView) return true;
  const entityCount =
    safeArray<LearnerPortraitEntity>(profileView.portraitPolish?.entities).length ||
    safeArray<LearnerPortraitEntity>(profileView.portraitResolution?.entities).length ||
    safeArray<LearnerPortraitEntity>(profileView.portraitEntities).length;
  const signalCount =
    safeArray<any>(profileView.stableProfile).reduce((sum, group) => sum + safeArray<any>(group?.items).length, 0) +
    safeArray<any>(profileView.workingState).reduce((sum, group) => sum + safeArray<any>(group?.items).length, 0) +
    safeArray<any>(profileView.savedMemory).length +
    safeArray<any>(profileView.recentEvents).length;
  return profileView.portraitPolish?.status === 'pending' ||
    profileView.portraitResolution?.status === 'pending' ||
    (entityCount === 0 && signalCount > 0);
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
  if (type === 'prerequisite') return { label: '前置', stroke: '#5b8f66', dash: '', marker: 'arrow-prerequisite' };
  if (type === 'part_of') return { label: '组成', stroke: '#7b6fd1', dash: '5 4', marker: 'arrow-part' };
  if (type === 'assesses') return { label: '测评', stroke: '#c17b32', dash: '2 4', marker: 'arrow-assesses' };
  if (type === 'remediates') return { label: '补救', stroke: '#c75c5c', dash: '7 4', marker: 'arrow-remediates' };
  if (type === 'supports') return { label: '支持', stroke: '#4386b5', dash: '4 4', marker: 'arrow-supports' };
  return { label: '相关', stroke: '#8b98a8', dash: '', marker: 'arrow-related' };
};
const conceptGroup = (node: ConceptNode) => {
  const learner = node.learnerState;
  if ((learner?.weaknessEstimate ?? 0) >= 0.62) return 'weak';
  if ((learner?.masteryEstimate ?? 0) >= 0.72) return 'mastered';
  if ((learner?.readinessEstimate ?? 0) >= 0.62) return 'ready';
  return 'neutral';
};
const groupTone = (group: string) => {
  if (group === 'weak') return { fill: '#fff0e3', stroke: '#d98a3d', text: '#8a4a0d', label: '薄弱' };
  if (group === 'mastered') return { fill: '#e7f6ed', stroke: '#4f9f66', text: '#23633b', label: '已掌握' };
  if (group === 'ready') return { fill: '#e7f2ff', stroke: '#4c8fd0', text: '#255d96', label: '准备好' };
  return { fill: '#f4f5f6', stroke: '#87919d', text: '#3d4650', label: '普通' };
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
const spreadVisibleGraphComponents = (cy: Core) => {
  const components = cy.elements(':visible').components()
    .map((component: any) => component.nodes())
    .filter((nodes: any) => nodes.length > 0)
    .sort((a: any, b: any) => b.length - a.length);
  if (components.length <= 1) return;
  const columns = Math.ceil(Math.sqrt(components.length));
  const gap = 360;
  const componentMeta = components.map((nodes: any) => {
    const box = nodes.boundingBox({ includeLabels: true, includeOverlays: false });
    return {
      nodes,
      box,
      width: Math.max(260, box.w),
      height: Math.max(180, box.h)
    };
  });
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...componentMeta.filter((_, index) => index % columns === column).map((meta) => meta.width), 260)
  );
  const rowCount = Math.ceil(componentMeta.length / columns);
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(...componentMeta.filter((_, index) => Math.floor(index / columns) === row).map((meta) => meta.height), 180)
  );
  const xOffsets = columnWidths.map((_, column) =>
    columnWidths.slice(0, column).reduce((sum, width) => sum + width + gap, 0)
  );
  const yOffsets = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0)
  );
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + gap * (columns - 1);
  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + gap * (rowCount - 1);
  componentMeta.forEach((meta, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const targetCenter = {
      x: xOffsets[column] + columnWidths[column] / 2 - totalWidth / 2,
      y: yOffsets[row] + rowHeights[row] / 2 - totalHeight / 2
    };
    const currentCenter = {
      x: meta.box.x1 + meta.box.w / 2,
      y: meta.box.y1 + meta.box.h / 2
    };
    const dx = targetCenter.x - currentCenter.x;
    const dy = targetCenter.y - currentCenter.y;
    meta.nodes.positions((node: any) => ({
      x: node.position('x') + dx,
      y: node.position('y') + dy
    }));
  });
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
  const candidate = concepts.slice(0, 140);
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
  const selected = candidate.filter((node) => selectedIds.has(node.id)).slice(0, scope === 'all' ? 132 : 96);
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
        size: Math.min(17, 5.5 + Math.sqrt(degree.get(node.id) || 0) * 2.2 + (pathSet.has(node.id) ? 2.5 : 0)),
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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rippleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const selectedNodeIdRef = useRef<string | null>(selectedId || null);
  const wavePointRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const waveFrameRef = useRef<number | null>(null);
  const conceptById = useMemo(() => new Map(concepts.map((concept) => [concept.id, concept])), [concepts]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(selectedId || null);
  const [prefs, setPrefs] = useState<GraphPrefs>(() => loadGraphPrefs(workspaceId, workbenchId));
  const [layoutCache, setLayoutCache] = useState<GraphLayoutCache>(() => loadGraphLayout(workspaceId, workbenchId));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; concept: ConceptNode } | null>(null);
  const [showControls, setShowControls] = useState(false);
  const elements = useMemo(
    () => graphElementsFor(concepts, edges, pathIds, prefs.scope, prefs.localDepth, prefs.localRootId || selectedNodeId, searchTerm),
    [concepts, edges, pathIds, prefs.scope, prefs.localDepth, prefs.localRootId, selectedNodeId, searchTerm]
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
  useEffect(() => {
    setSelectedNodeId(selectedId || null);
  }, [selectedId]);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);
  useEffect(() => {
    const canvas = rippleCanvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || !hasGraph) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * scale));
      const height = Math.max(1, Math.floor(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const draw = (now: number) => {
      resize();
      const rect = stage.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const point = wavePointRef.current;
      if (point.active) {
        const pulse = (Math.sin(now * 0.004) + 1) / 2;
        for (let index = 0; index < 4; index += 1) {
          const radius = 48 + index * 58 + pulse * 26;
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.strokeStyle = `rgba(75, 86, 99, ${0.055 - index * 0.009})`;
          context.lineWidth = 1;
          context.stroke();
        }
        const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 180);
        gradient.addColorStop(0, 'rgba(35, 39, 47, 0.035)');
        gradient.addColorStop(0.42, 'rgba(35, 39, 47, 0.015)');
        gradient.addColorStop(1, 'rgba(35, 39, 47, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, rect.width, rect.height);
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
    const usePreset = false;
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
            label: (ele: any) => prefs.showNodeLabels && (ele.data('degree') >= 4 || ele.data('path') || ele.data('matched')) ? ele.data('label') : '',
            'font-size': 8.5,
            'font-weight': 500,
            'text-margin-y': 8,
            'text-wrap': 'wrap',
            'text-max-width': 112,
            'text-background-opacity': 0,
            'text-border-opacity': 0,
            'text-opacity': 0.58,
            color: '#73777d',
            'background-color': '#5f6368',
            'border-color': '#ffffff',
            'border-width': 0.8,
            'shadow-blur': 0,
            'shadow-opacity': 0,
            'overlay-opacity': 0,
            'transition-property': 'opacity, background-color, border-color, width, height, line-color, target-arrow-color',
            'transition-duration': 160
          }
        },
        {
          selector: 'node[group = "weak"]',
          style: { 'background-color': '#6a6a6a', 'border-color': '#ffffff' }
        },
        {
          selector: 'node[group = "ready"]',
          style: { 'background-color': '#4f5358', 'border-color': '#ffffff' }
        },
        {
          selector: 'node[group = "mastered"]',
          style: { 'background-color': '#8b8f94', 'border-color': '#ffffff' }
        },
        {
          selector: 'node[path]',
          style: { 'background-color': '#303236', 'border-width': 1.2 }
        },
        {
          selector: 'node[matched]',
          style: {
            'background-color': '#202124',
            'border-color': '#ffffff',
            'border-width': 1.4,
            'shadow-opacity': 0,
            label: 'data(label)',
            'text-opacity': 0.86,
            color: '#202124',
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
            width: (ele: any) => Math.max(0.45, Math.min(1.15, Number(ele.data('weight') || 0.6) * 0.9 * prefs.edgeScale)),
            'curve-style': 'haystack',
            'haystack-radius': 0,
            'line-color': '#b7bcc2',
            'target-arrow-shape': 'none',
            opacity: 0.32,
            label: (ele: any) => prefs.showEdgeLabels && ele.data('path') ? ele.data('label') : '',
            'font-size': 8,
            'font-weight': 500,
            color: '#8a8e94',
            'text-background-opacity': 0,
            'text-rotation': 'autorotate',
            'line-style': 'solid'
          }
        },
        { selector: 'edge[relationType = "prerequisite"]', style: { 'line-color': '#aab0b6' } },
        { selector: 'edge[relationType = "part_of"]', style: { 'line-color': '#b6b3c8' } },
        { selector: 'edge[relationType = "assesses"]', style: { 'line-color': '#c3b4a3' } },
        { selector: 'edge[relationType = "remediates"]', style: { 'line-color': '#c6abaa' } },
        { selector: 'edge[relationType = "supports"]', style: { 'line-color': '#a8bac8' } },
        { selector: 'edge[path]', style: { 'line-color': '#9ca3aa', width: 1.35, opacity: 0.55, 'z-index': 5 } },
        { selector: '.faded', style: { opacity: 0.18, label: '' } },
        { selector: '.neighbor', style: { opacity: 0.68 } },
        { selector: '.neighbor-1', style: { opacity: 1, label: 'data(label)', 'text-opacity': 0.86, 'border-width': 1.2 } },
        { selector: '.wave-near', style: { opacity: 1, 'background-color': '#202124', 'text-opacity': 0.72, width: (ele: any) => Number(ele.data('size') || 8) * prefs.nodeScale * 1.35, height: (ele: any) => Number(ele.data('size') || 8) * prefs.nodeScale * 1.35 } },
        { selector: '.wave-mid', style: { opacity: 0.78, 'background-color': '#3f4247' } },
        { selector: 'edge.wave-near', style: { opacity: 0.68, width: 1.25, 'line-color': '#6f7680' } },
        { selector: 'edge.wave-mid', style: { opacity: 0.45, 'line-color': '#969da5' } },
        { selector: '.hidden-filter', style: { display: 'none' } },
        {
          selector: '.focused',
          style: {
            'background-color': '#111214',
            'border-color': '#ffffff',
            'border-width': 1.4,
            label: 'data(label)',
            color: '#202124',
            'text-opacity': 1,
            'z-index': 20
          }
        },
        {
          selector: 'edge.focused',
          style: {
            opacity: 0.78,
            width: 1.65,
            label: 'data(label)',
            'line-color': '#555d66',
            'z-index': 18
          }
        },
        {
          selector: 'edge.neighbor-1',
          style: {
            opacity: 0.6,
            width: 1.2,
            label: 'data(label)'
          }
        },
        { selector: 'edge.search-path', style: { opacity: 0.85, width: 1.7, 'line-color': '#555d66', 'z-index': 17 } }
      ] as any),
      layout: {
        name: usePreset ? 'preset' : 'fcose',
        quality: 'default',
        randomize: !usePreset,
        animate: !usePreset,
        animationDuration: 760,
        fit: !usePreset,
        padding: 70,
        nodeSeparation: 280 * prefs.linkDistance,
        nodeRepulsion: 24000 * prefs.repelForce,
        idealEdgeLength: (edge: any) => (edge.data('relationType') === 'prerequisite' ? 330 : 260) * prefs.linkDistance,
        edgeElasticity: 0.12,
        nestingFactor: 0.1,
        gravity: 0.018 * prefs.centerForce,
        gravityRangeCompound: 1.5,
        gravityCompound: 0.6,
        numIter: 2200,
        tile: true,
        tilingPaddingVertical: 180,
        tilingPaddingHorizontal: 220
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
      cy.elements().removeClass('faded neighbor neighbor-1 focused search-path');
      setSelectedNodeId(null);
      setContextMenu(null);
      setHoverInfo(null);
    };
    const focusNode = (node: any, persist = false, zoom = false) => {
      const oneHop = node.closedNeighborhood();
      cy.elements().addClass('faded').removeClass('neighbor neighbor-1 focused search-path');
      oneHop.removeClass('faded').addClass('neighbor neighbor-1');
      node.removeClass('neighbor neighbor-1').addClass('focused');
      node.connectedEdges().addClass('focused');
      oneHop.connectedEdges().difference(node.connectedEdges()).addClass('neighbor-1');
      if (persist) {
        setSelectedNodeId(node.id());
        const concept = conceptById.get(node.id());
        if (concept) onSelect(concept);
      }
      if (zoom) {
        cy.animate({ fit: { eles: oneHop, padding: 90 } }, { duration: 280 });
      }
    };
    cy.on('mouseover', 'node', (event) => {
      focusNode(event.target);
      const concept = conceptById.get(event.target.id());
      if (concept) setHoverInfo({ x: event.renderedPosition.x, y: event.renderedPosition.y, concept });
    });
    cy.on('mousemove', 'node', (event) => {
      const concept = conceptById.get(event.target.id());
      if (concept) setHoverInfo({ x: event.renderedPosition.x, y: event.renderedPosition.y, concept });
    });
    cy.on('mouseout', 'node', () => {
      setHoverInfo(null);
      if (selectedNodeIdRef.current) {
        const node = cy.getElementById(selectedNodeIdRef.current);
        if (node.nonempty()) focusNode(node, true, false);
      } else {
        cy.elements().removeClass('faded neighbor neighbor-1 focused search-path');
      }
    });
    cy.on('tap', 'node', (event) => {
      setContextMenu(null);
      focusNode(event.target, true, true);
    });
    cy.on('cxttap', 'node', (event) => {
      const node = event.target;
      setSelectedNodeId(node.id());
      focusNode(node, true, true);
      setContextMenu({ x: event.renderedPosition.x, y: event.renderedPosition.y, nodeId: node.id() });
    });
    cy.on('tap', (event) => {
      if (event.target === cy) clearFocus();
    });
    cy.on('free', 'node', () => {
      cy.layout({
        name: 'fcose',
        quality: 'default',
        randomize: false,
        animate: true,
        animationDuration: 520,
        fit: false,
        nodeSeparation: 240 * prefs.linkDistance,
        nodeRepulsion: 16000 * prefs.repelForce,
        idealEdgeLength: (edge: any) => (edge.data('relationType') === 'prerequisite' ? 300 : 230) * prefs.linkDistance,
        edgeElasticity: 0.14,
        gravity: 0.02 * prefs.centerForce,
        numIter: 620
      } as any).run();
    });
    cy.on('dragfree', 'node', () => persistLayout(cy));
    cy.on('zoom pan', () => {
      window.clearTimeout((persistLayout as any).timer);
      (persistLayout as any).timer = window.setTimeout(() => persistLayout(cy), 240);
    });
    cy.on('layoutstop', () => {
      spreadVisibleGraphComponents(cy);
      cy.fit(cy.elements(':visible'), 110);
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
      const show = prefs.showNodeLabels && (node.data('degree') >= 4 || node.data('path') || node.data('matched') || node.id() === selectedNodeId);
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
      quality: 'default',
      animate: true,
      animationDuration: 640,
      fit: true,
      padding: 70,
      nodeSeparation: 280 * prefs.linkDistance,
      nodeRepulsion: 24000 * prefs.repelForce,
      idealEdgeLength: (edge: any) => (edge.data('relationType') === 'prerequisite' ? 330 : 260) * prefs.linkDistance,
      edgeElasticity: 0.12,
      gravity: 0.018 * prefs.centerForce,
      numIter: 2000,
      tile: true,
      tilingPaddingVertical: 180,
      tilingPaddingHorizontal: 220
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
    cy.elements().addClass('faded').removeClass('neighbor neighbor-1 focused search-path');
    const oneHop = node.closedNeighborhood();
    oneHop.removeClass('faded').addClass('neighbor neighbor-1');
    node.removeClass('neighbor neighbor-1').addClass('focused');
    node.connectedEdges().addClass('focused');
    oneHop.connectedEdges().difference(node.connectedEdges()).addClass('neighbor-1');
    setSelectedNodeId(nodeId);
    const concept = conceptById.get(nodeId);
    if (concept) onSelect(concept);
    if (zoom) cy.animate({ fit: { eles: oneHop, padding: 90 } }, { duration: 280 });
  };
  const openLocalGraph = (nodeId: string) => {
    patchPrefs({ scope: 'local', localRootId: nodeId });
    setSelectedNodeId(nodeId);
    setContextMenu(null);
  };
  const resetDisplay = () => {
    patchPrefs({ ...DEFAULT_GRAPH_PREFS, localRootId: selectedNodeId });
  };
  const updateGraphWave = (x: number, y: number) => {
    wavePointRef.current = { x, y, active: true };
    if (waveFrameRef.current !== null) return;
    waveFrameRef.current = window.requestAnimationFrame(() => {
      waveFrameRef.current = null;
      const cy = cyRef.current;
      if (!cy) return;
      cy.elements().removeClass('wave-near wave-mid');
      cy.nodes(':visible').forEach((node) => {
        const position = node.renderedPosition();
        const distance = Math.hypot(position.x - x, position.y - y);
        if (distance < 118) node.addClass('wave-near');
        else if (distance < 245) node.addClass('wave-mid');
      });
      cy.edges(':visible').forEach((edge) => {
        const source = edge.source().renderedPosition();
        const target = edge.target().renderedPosition();
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const lengthSquared = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - source.x) * dx + (y - source.y) * dy) / lengthSquared));
        const px = source.x + t * dx;
        const py = source.y + t * dy;
        const distance = Math.hypot(px - x, py - y);
        if (distance < 92) edge.addClass('wave-near');
        else if (distance < 180) edge.addClass('wave-mid');
      });
    });
  };
  const clearGraphWave = () => {
    wavePointRef.current.active = false;
    cyRef.current?.elements().removeClass('wave-near wave-mid');
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
    <div className={`overflow-hidden bg-[#fbfbfa] text-[#202124] ${isFullscreen ? 'h-full rounded-none' : 'border-y border-[#e5e7eb]'}`}>
      <div className="hidden flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#55585d]">
          {DEFAULT_VISIBLE_RELATIONS.map((type) => {
            const meta = relationMeta(type);
            const enabled = visibleRelations.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleRelation(type)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition ${enabled ? 'bg-[#f4f5f6] text-[#202124] shadow-sm ring-1 ring-[#d8dde4]' : 'text-[#8a8e94] opacity-60'}`}
                title={`${enabled ? '隐藏' : '显示'}${meta.label}关系`}
              >
                <span className="h-0.5 w-7 rounded-full" style={{ backgroundColor: meta.stroke }} />
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#55585d]">
          {DEFAULT_VISIBLE_GROUPS.map((group) => {
            const tone = groupTone(group);
            const enabled = visibleGroups.has(group);
            return (
              <button
                key={group}
                type="button"
                onClick={() => toggleGroup(group)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 transition ${enabled ? 'text-[#34373c]' : 'text-[#8a8e94] opacity-55'}`}
                title={`${enabled ? '隐藏' : '显示'}${tone.label}节点`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone.fill, boxShadow: `0 0 0 1.5px ${tone.stroke}` }} />
                {tone.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        ref={stageRef}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          updateGraphWave(event.clientX - rect.left, event.clientY - rect.top);
        }}
        onMouseLeave={clearGraphWave}
        className={`relative ${isFullscreen ? 'h-full' : 'h-[720px]'} bg-white`}
      >
        <canvas ref={rippleCanvasRef} className="pointer-events-none absolute inset-0 z-[1]" />
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-0.5 rounded-md border border-[#dfe3e8] bg-white/82 p-1 shadow-sm backdrop-blur">
          <button type="button" onClick={() => zoomBy(1.16)} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="放大">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => zoomBy(0.86)} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="缩小">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={fitGraph} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="适应图谱">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={runLayout} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="运行力导向布局">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setShowControls((current) => !current)} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="显示控制项">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-[#e5e7eb]" />
          {(['connected', 'local', 'all'] as GraphScope[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => patchPrefs({ scope: item, localRootId: item === 'local' ? (selectedNodeId || prefs.localRootId) : prefs.localRootId })}
              className={`h-7 rounded px-2 text-xs font-medium ${prefs.scope === item ? 'bg-[#202124] text-white' : 'text-[#6b7077] hover:bg-[#f4f5f6]'}`}
            >
              {item === 'connected' ? '关联' : item === 'local' ? '局部' : '全部'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => patchPrefs({ showNodeLabels: !prefs.showNodeLabels })}
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ${prefs.showNodeLabels ? 'bg-[#202124] text-white' : 'text-[#6b7077] hover:bg-[#f4f5f6]'}`}
          >
            {prefs.showNodeLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            节点
          </button>
          <button
            type="button"
            onClick={() => patchPrefs({ showEdgeLabels: !prefs.showEdgeLabels })}
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ${prefs.showEdgeLabels ? 'bg-[#202124] text-white' : 'text-[#6b7077] hover:bg-[#f4f5f6]'}`}
          >
            <Filter className="h-3.5 w-3.5" />
            边
          </button>
        </div>
        {showControls ? (
          <div className="absolute right-3 top-3 z-10 w-[286px] rounded-lg border border-[#d8dde4] bg-white/94 p-3 text-xs text-[#4d5864] shadow-sm backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-[#202124]">图谱控制</p>
              <button type="button" onClick={resetDisplay} className="rounded-md px-2 py-1 text-[#666a70] hover:bg-[#f1f3f5]">重置</button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>局部深度</span><span>{prefs.localDepth}</span></span>
                <input type="range" min={1} max={4} value={prefs.localDepth} onChange={(event) => patchPrefs({ localDepth: Number(event.target.value) })} className="w-full accent-[#4386b5]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>节点大小</span><span>{prefs.nodeScale.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.6} step={0.1} value={prefs.nodeScale} onChange={(event) => patchPrefs({ nodeScale: Number(event.target.value) })} className="w-full accent-[#4386b5]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>连线粗细</span><span>{prefs.edgeScale.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.8} step={0.1} value={prefs.edgeScale} onChange={(event) => patchPrefs({ edgeScale: Number(event.target.value) })} className="w-full accent-[#5b8f66]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>排斥力</span><span>{prefs.repelForce.toFixed(1)}x</span></span>
                <input type="range" min={0.6} max={2.2} step={0.1} value={prefs.repelForce} onChange={(event) => patchPrefs({ repelForce: Number(event.target.value) })} className="w-full accent-[#7b6fd1]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>连线距离</span><span>{prefs.linkDistance.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.8} step={0.1} value={prefs.linkDistance} onChange={(event) => patchPrefs({ linkDistance: Number(event.target.value) })} className="w-full accent-[#c17b32]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>居中力</span><span>{prefs.centerForce.toFixed(1)}x</span></span>
                <input type="range" min={0.4} max={1.8} step={0.1} value={prefs.centerForce} onChange={(event) => patchPrefs({ centerForce: Number(event.target.value) })} className="w-full accent-[#c75c5c]" />
              </label>
            </div>
          </div>
        ) : null}
        {matchedConcepts.length ? (
          <div className="absolute left-3 top-16 z-10 w-[280px] rounded-lg border border-[#d8dde4] bg-white/94 p-2 text-xs text-[#34373c] shadow-sm backdrop-blur">
            <p className="px-2 pb-1 text-[#666a70]">搜索结果</p>
            {matchedConcepts.map((concept) => (
              <button key={concept.id} type="button" onClick={() => focusById(concept.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#f1f3f5]">
                <Search className="h-3.5 w-3.5 text-[#c9a227]" />
                <span className="min-w-0 flex-1 truncate">{concept.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {selectedConcept ? (
          <div className="absolute bottom-3 right-3 z-10 w-[318px] rounded-lg border border-[#d8dde4] bg-white/94 p-3 text-xs text-[#4d5864] shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[#666a70]">已选概念</p>
                <h3 className="mt-1 truncate text-sm font-semibold text-[#202124]">{selectedConcept.title}</h3>
              </div>
              <button type="button" onClick={() => setSelectedNodeId(null)} className="rounded-md p-1 text-[#666a70] hover:bg-[#f1f3f5]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md bg-[#f4f5f6] p-2"><p className="text-[#666a70]">掌握</p><p className="mt-1 text-[#202124]">{pct(selectedConcept.learnerState?.masteryEstimate)}</p></div>
              <div className="rounded-md bg-[#f4f5f6] p-2"><p className="text-[#666a70]">薄弱</p><p className="mt-1 text-[#202124]">{pct(selectedConcept.learnerState?.weaknessEstimate)}</p></div>
              <div className="rounded-md bg-[#f4f5f6] p-2"><p className="text-[#666a70]">准备度</p><p className="mt-1 text-[#202124]">{pct(selectedConcept.learnerState?.readinessEstimate)}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => openLocalGraph(selectedConcept.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#202124] px-2 text-xs font-medium text-white">
                <LocateFixed className="h-3.5 w-3.5" />
                局部图谱
              </button>
              <button type="button" onClick={() => focusById(selectedConcept.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#f1f3f5] px-2 text-xs font-medium text-[#34373c]">
                <Network className="h-3.5 w-3.5" />
                Focus
              </button>
            </div>
          </div>
        ) : null}
        {hoverInfo ? (
          <div
            className="pointer-events-none absolute z-20 max-w-[260px] rounded-lg border border-[#d8dde4] bg-white px-3 py-2 text-xs text-[#4d5864] shadow-sm"
            style={{ left: Math.min(hoverInfo.x + 14, 760), top: Math.max(12, hoverInfo.y - 18) }}
          >
            <p className="truncate font-semibold text-[#202124]">{hoverInfo.concept.title}</p>
            {hoverInfo.concept.category ? <p className="mt-1 truncate text-[#666a70]">{hoverInfo.concept.category}</p> : null}
          </div>
        ) : null}
        {contextMenu ? (
          <div
            className="absolute z-20 w-44 rounded-lg border border-[#d8dde4] bg-white p-1 text-xs text-[#34373c] shadow-lg"
            style={{ left: Math.min(contextMenu.x, 720), top: Math.min(contextMenu.y, 620) }}
          >
            <button type="button" onClick={() => focusById(contextMenu.nodeId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#f1f3f5]"><Network className="h-3.5 w-3.5" />邻域聚焦</button>
            <button type="button" onClick={() => openLocalGraph(contextMenu.nodeId)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[#f1f3f5]"><LocateFixed className="h-3.5 w-3.5" />打开局部图</button>
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-[#d8dde4] bg-white/90 px-3 py-2 text-xs text-[#4d5864] shadow-sm backdrop-blur">
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
  activeSection,
  hideSectionNav = false,
  headerTitle = '学习智能仪表盘',
  headerDescription = '学习状态、知识结构、诊断、计划与画像。',
  onSectionChange,
  onOpenWorkbench,
  onPlanApplied,
  onOpenTerminal
}: LearningIntelligenceDashboardProps) {
  const [internalSection, setInternalSection] = useState<IntelligenceSection>('overview');
  const section = activeSection || internalSection;
  const isPlanningOnly = hideSectionNav && section === 'planning';
  const isProfileOnly = hideSectionNav && section === 'memory';
  const setSection = (nextSection: IntelligenceSection) => {
    setInternalSection(nextSection);
    onSectionChange?.(nextSection);
  };
  const [knowledgeView, setKnowledgeView] = useState<KnowledgeView>('graph');
  const [planningView, setPlanningView] = useState<PlanningView>('plans');
  const [profileEntryKind, setProfileEntryKind] = useState<LearnerProfileEntryKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [knowledgeSearchOpen, setKnowledgeSearchOpen] = useState(false);
  const [kgSearchFacet, setKgSearchFacet] = useState<KgSearchFacet>('All');
  const [kgSearchPreviewId, setKgSearchPreviewId] = useState<string | null>(null);
  const [kgRecentSearches, setKgRecentSearches] = useState<string[]>([]);
  const [focusedGraphConceptId, setFocusedGraphConceptId] = useState<string | null>(null);
  const [expandedConceptIds, setExpandedConceptIds] = useState<Set<string>>(() => new Set());
  const [drawerConcept, setDrawerConcept] = useState<ConceptNode | null>(null);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<DiagnosisItem | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stageSelectionDismissed, setStageSelectionDismissed] = useState(false);
  const [planningRunning, setPlanningRunning] = useState(false);
  const [graphActionRunning, setGraphActionRunning] = useState<'build' | null>(null);
  const [graphBuildJob, setGraphBuildJob] = useState<any>(null);
  const [mclResult, setMclResult] = useState<MclExecuteResult | null>(null);
  const [planningObjective, setPlanningObjective] = useState('');
  const [planningDraftObjective, setPlanningDraftObjective] = useState('');
  const [newPlanModalOpen, setNewPlanModalOpen] = useState(false);
  const [planMenu, setPlanMenu] = useState<{ planId: string; rect: DOMRect } | null>(null);
  const [planMenuSubmenu, setPlanMenuSubmenu] = useState<'apply' | null>(null);
  const [planDisplayMeta, setPlanDisplayMeta] = useState<Record<string, PlanDisplayMeta>>({});
  const [planningRunStatus, setPlanningRunStatus] = useState<string | null>(null);
  const planningPollTimerRef = useRef<number | null>(null);
  const [integration, setIntegration] = useState<any>(null);
  const [graph, setGraph] = useState<{ nodes: ConceptNode[]; edges: ConceptEdge[]; sources: GraphSource[] }>({ nodes: [], edges: [], sources: [] });
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [kgPlan, setKgPlan] = useState<any>(null);
  const [targetStructure, setTargetStructure] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [mclPlan, setMclPlan] = useState<any>(null);
  const [mclPlans, setMclPlans] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [learnerState, setLearnerState] = useState<any>(null);
  const [learnerMemories, setLearnerMemories] = useState<any[]>([]);
  const [learnerMemoryControls, setLearnerMemoryControls] = useState<any[]>([]);
  const [savedMemoryRecords, setSavedMemoryRecords] = useState<any[]>([]);
  const [learnerProfileView, setLearnerProfileView] = useState<LearnerProfileView | null>(null);
  const [profileHistoryOpen, setProfileHistoryOpen] = useState(false);
  const [profileLedgerSort, setProfileLedgerSort] = useState<ProfilePanelSort>('updated');
  const [memoryGovernanceSort, setMemoryGovernanceSort] = useState<ProfilePanelSort>('updated');
  const [profileLedgerFilter, setProfileLedgerFilter] = useState('all');
  const [memoryGovernanceFilter, setMemoryGovernanceFilter] = useState('all');
  const [profileTimelineChartMode, setProfileTimelineChartMode] = useState<ProfileTimelineChartMode>('bar');
  const [profileTimelineRange, setProfileTimelineRange] = useState<ProfileTimelineRange>('30d');
  const [profileMemoryEditorKind, setProfileMemoryEditorKind] = useState<ProfileEditorKind>('memory');
  const [profileMemoryEditorOpen, setProfileMemoryEditorOpen] = useState(false);
  const [profileMemoryEditingKey, setProfileMemoryEditingKey] = useState<string | null>(null);
  const [profileMemoryText, setProfileMemoryText] = useState('');
  const [profileMemoryCategory, setProfileMemoryCategory] = useState('preference');
  const [profileMemoryBusyKey, setProfileMemoryBusyKey] = useState<string | null>(null);
  const [profileMemoryMenu, setProfileMemoryMenu] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [profileEvidenceView, setProfileEvidenceView] = useState<any | null>(null);
  const [profileControlledKeys, setProfileControlledKeys] = useState<Set<string>>(() => new Set());
  const [profileControlledCorrections, setProfileControlledCorrections] = useState<Map<string, string>>(() => new Map());
  const [profileManualItems, setProfileManualItems] = useState<Map<string, { key: string; dimension: string; value: string; updatedAt: string }>>(() => new Map());
  const profileActionTargetsRef = useRef<Map<string, any>>(new Map());
  const [planActionBusyId, setPlanActionBusyId] = useState<string | null>(null);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [stageDraftTitle, setStageDraftTitle] = useState('');
  const [stageDraftContent, setStageDraftContent] = useState('');
  const [stageGovernanceBusy, setStageGovernanceBusy] = useState<'save' | 'patch' | 'review' | 'apply_patch' | null>(null);
  const [patchInstruction, setPatchInstruction] = useState('');
  const [stagePatchProposal, setStagePatchProposal] = useState<StagePatchProposal | null>(null);
  const [planReviewResult, setPlanReviewResult] = useState<PlanReviewResult | null>(null);
  const [planningInlineBusy, setPlanningInlineBusy] = useState<'route_explain' | 'stage_explain' | null>(null);
  const [routeExplainResult, setRouteExplainResult] = useState('');
  const [stageExplainResult, setStageExplainResult] = useState('');
  const [routeActionMode, setRouteActionMode] = useState<RouteActionMode>('idle');
  const [routeActionInput, setRouteActionInput] = useState('');
  const [routeExplainMessages, setRouteExplainMessages] = useState<StageChatMessage[]>([]);
  const [routeModifyMessages, setRouteModifyMessages] = useState<StageChatMessage[]>([]);
  const [applyingPlanSuggestionKey, setApplyingPlanSuggestionKey] = useState<string | null>(null);
  const [stageActionMode, setStageActionMode] = useState<StageActionMode>('menu');
  const [stageActionInput, setStageActionInput] = useState('');
  const [stageExplainMessages, setStageExplainMessages] = useState<StageChatMessage[]>([]);
  const [stageModifyMessages, setStageModifyMessages] = useState<StageChatMessage[]>([]);
  const [stageSourcesOpen, setStageSourcesOpen] = useState(false);
  const [stageStatusMenuOpen, setStageStatusMenuOpen] = useState(false);
  const [stageStatusBusy, setStageStatusBusy] = useState(false);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const [planningPlansReady, setPlanningPlansReady] = useState(false);
  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`${kgRecentSearchesStorageKey}:${workspaceId}`) || '[]');
      setKgRecentSearches(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 8) : []);
    } catch {
      setKgRecentSearches([]);
    }
  }, [workspaceId]);
  const applySnapshot = (snapshot: LearningIntelligenceSnapshot) => {
    setIntegration(snapshot.integration || null);
    setGraph({
      nodes: safeArray<ConceptNode>(snapshot.graph?.nodes),
      edges: safeArray<ConceptEdge>(snapshot.graph?.edges),
      sources: safeArray<GraphSource>(snapshot.graph?.sources)
    });
    setDiagnosis(snapshot.diagnosis || null);
    setKgPlan(snapshot.kgPlan || null);
    setTargetStructure(snapshot.targetStructure || null);
    setGapAnalysis(snapshot.gapAnalysis || null);
    setMclPlan(snapshot.mclPlan || null);
    setMclPlans(safeArray(snapshot.mclPlans));
    setPlanningPlansReady(true);
    setEvents(safeArray(snapshot.events));
    setSequences(safeArray(snapshot.sequences));
    setLearnerState(snapshot.learnerState || null);
    setLearnerMemories(safeArray(snapshot.learnerMemories || snapshot.memories));
    setLearnerMemoryControls(safeArray(snapshot.learnerMemoryControls));
    setSavedMemoryRecords(safeArray(snapshot.savedMemories));
    setLearnerProfileView(snapshot.learnerProfileView || null);
    setPlanningObjective((current) => current || snapshot.planningObjective || '');
  };
  const persistSnapshot = (snapshot: Omit<LearningIntelligenceSnapshot, 'version' | 'savedAt' | 'workspaceId' | 'workbenchId'>) => {
    saveJson(intelligenceSnapshotKey(workspaceId, workbenchId), {
      ...snapshot,
      version: INTELLIGENCE_SNAPSHOT_VERSION,
      savedAt: Date.now(),
      workspaceId,
      workbenchId: workbenchId || null
    });
  };
  const load = async (options?: { force?: boolean }) => {
    if (!workspaceId) return;
    const cached = options?.force ? null : loadIntelligenceSnapshot(workspaceId, workbenchId);
    if (cached) {
      applySnapshot(cached);
      setLoadedFromCache(true);
      setLoading(false);
      setError(null);
      if (profileViewNeedsRefresh(cached.learnerProfileView)) {
        void refreshProfileViewOnly(cached);
      }
      return;
    }
    setLoadedFromCache(false);
    if (section === 'planning') setPlanningPlansReady(false);
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
        memoryResult,
        savedMemoryResult,
        profileViewResult
      ] = await Promise.all([
        learningApi.getWorkspaceIntegration(workspaceId, { workbenchId }).catch(() => ({ integration: null })),
        learningApi.getKnowledgeGraph(workspaceId, { limit: 120 }).catch(() => ({ graph: { nodes: [], edges: [] } })),
        learningApi.getDiagnosis(workspaceId, { limit: 100 }).catch(() => ({ diagnosis: null })),
        learningApi.createKnowledgeGraphPlan({ workspaceId, workbenchId, maxConcepts: 8, persist: false }).catch(() => ({ plan: null })),
        learningApi.listLearningPlans(workspaceId, { workbenchId, limit: 30 }).catch(() => ({ plans: [] })),
        learningApi.listLearningEvents(workspaceId, { workbenchId, limit: 80 }).catch(() => ({ events: [] })),
        learningApi.getLearningEventSequences(workspaceId, { workbenchId, limit: 24 }).catch(() => ({ patterns: [] })),
        learningApi.getLearnerState(workspaceId, { workbenchId }).catch(() => ({ state: null })),
        learningApi.listLearnerMemories(workspaceId, { workbenchId, limit: 40 }).catch(() => ({ memories: [] })),
        learningApi.listSavedMemories(workspaceId, { workbenchId, limit: 80 }).catch(() => ({ memories: [] })),
        learningApi.getLearnerProfileView(workspaceId, { workbenchId, limit: 30, forcePortrait: Boolean(options?.force) }).catch(() => ({ profileView: null }))
      ]);
      setIntegration(integrationResult.integration || null);
      setGraph({
        nodes: safeArray<ConceptNode>(graphResult.graph?.nodes),
        edges: safeArray<ConceptEdge>(graphResult.graph?.edges),
        sources: safeArray<GraphSource>(graphResult.graph?.sources)
      });
      setDiagnosis(diagnosisResult.diagnosis || null);
      setKgPlan(planResult.plan || null);
      setMclPlans(safeArray(plansResult.plans));
      setPlanningPlansReady(true);
      setEvents(safeArray(eventsResult.events));
      setSequences(safeArray(sequenceResult.patterns));
      setLearnerState(learnerStateResult.state || null);
      setLearnerMemories(safeArray(memoryResult.memories));
      setLearnerMemoryControls(safeArray(memoryResult.controls));
      setSavedMemoryRecords(safeArray(savedMemoryResult.memories));
      setLearnerProfileView(profileViewResult.profileView || null);
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
      persistSnapshot({
        integration: integrationResult.integration || null,
        graph: {
          nodes: safeArray<ConceptNode>(graphResult.graph?.nodes),
          edges: safeArray<ConceptEdge>(graphResult.graph?.edges),
          sources: safeArray<GraphSource>(graphResult.graph?.sources)
        },
        diagnosis: diagnosisResult.diagnosis || null,
        kgPlan: planResult.plan || null,
        targetStructure: targetStructure || null,
        gapAnalysis: gapAnalysis || null,
        mclPlan: persistedMclPlan,
        mclPlans: safeArray(plansResult.plans),
        events: safeArray(eventsResult.events),
        sequences: safeArray(sequenceResult.patterns),
        learnerState: learnerStateResult.state || null,
        memories: safeArray(memoryResult.memories),
        learnerMemories: safeArray(memoryResult.memories),
        learnerMemoryControls: safeArray(memoryResult.controls),
        savedMemories: safeArray(savedMemoryResult.memories),
        learnerProfileView: profileViewResult.profileView || null,
        planningObjective:
          planDisplayTitle(persistedMclPlan) ||
          integrationResult.integration?.continueLearning?.prompt ||
          planResult.plan?.objective ||
          '根据当前学习画像、知识图谱和资料生成下一步学习计划'
      });
    } catch (err: any) {
      setPlanningPlansReady(true);
      setError(err?.response?.data?.error || err?.message || 'Learning Intelligence 加载失败');
    } finally {
      setLoading(false);
    }
  };
  const refreshProfileMemories = async () => {
    if (!workspaceId) return;
    try {
      const [memoryResult, savedMemoryResult] = await Promise.all([
        learningApi.listLearnerMemories(workspaceId, { workbenchId, limit: 40 }),
        learningApi.listSavedMemories(workspaceId, { workbenchId, limit: 80 })
      ]);
      const nextLearnerMemories = safeArray(memoryResult.memories);
      const nextControls = safeArray(memoryResult.controls);
      const nextSavedMemories = safeArray(savedMemoryResult.memories);
      setLearnerMemories(nextLearnerMemories);
      setLearnerMemoryControls(nextControls);
      setSavedMemoryRecords(nextSavedMemories);
      const baseSnapshot = loadIntelligenceSnapshot(workspaceId, workbenchId);
      const nextSnapshot = baseSnapshot
        ? {
            ...baseSnapshot,
            version: INTELLIGENCE_SNAPSHOT_VERSION,
            savedAt: Date.now(),
            workspaceId,
            workbenchId: workbenchId || null,
            memories: nextLearnerMemories,
            learnerMemories: nextLearnerMemories,
            learnerMemoryControls: nextControls,
            savedMemories: nextSavedMemories
          }
        : undefined;
      if (nextSnapshot) saveJson(intelligenceSnapshotKey(workspaceId, workbenchId), nextSnapshot);
      void refreshProfileViewOnly(nextSnapshot);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '更新用户画像失败');
    }
  };
  const refreshProfileEvents = async () => {
    if (!workspaceId) return;
    try {
      const result = await learningApi.listLearningEvents(workspaceId, { workbenchId, limit: 80 });
      const nextEvents = safeArray(result.events);
      setEvents(nextEvents);
      const baseSnapshot = loadIntelligenceSnapshot(workspaceId, workbenchId);
      const nextSnapshot = baseSnapshot
        ? {
            ...baseSnapshot,
            version: INTELLIGENCE_SNAPSHOT_VERSION,
            savedAt: Date.now(),
            workspaceId,
            workbenchId: workbenchId || null,
            events: nextEvents
          }
        : undefined;
      if (nextSnapshot) saveJson(intelligenceSnapshotKey(workspaceId, workbenchId), nextSnapshot);
      await refreshProfileViewOnly(nextSnapshot);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '更新近期事件失败');
    }
  };
  const openProfileMemoryEditor = (memory?: any, fallback?: ProfileDisplaySignal, kind?: ProfileEditorKind) => {
    const key = String(memory?.memoryKey || memory?.key || '');
    const inferredKind: ProfileEditorKind = kind || (memory?.kind === 'event' ? 'event' : memory?.text ? 'memory' : 'profile');
    setProfileMemoryEditingKey(key || null);
    setProfileMemoryEditorKind(inferredKind);
    setProfileMemoryText(String(memory?.text || memory?.value || fallback?.value || '').trim());
    setProfileMemoryCategory(String(memory?.eventType || memory?.category || memory?.dimension || fallback?.dimension || (inferredKind === 'profile' ? 'learningPreference' : inferredKind === 'event' ? 'manual.profile_event' : 'preference')));
    setProfileMemoryEditorOpen(true);
    setProfileMemoryMenu(null);
  };
  const openNewProfileItemEditor = () => {
    const dimension = profileLedgerFilter !== 'all' ? profileLedgerFilter : 'learningPreference';
    openProfileMemoryEditor({ dimension }, undefined, 'profile');
  };
  const openNewGovernanceItemEditor = () => {
    const kind: ProfileEditorKind = memoryGovernanceFilter === 'event' ? 'event' : 'memory';
    openProfileMemoryEditor(
      kind === 'event' ? { kind: 'event', eventType: 'manual.profile_event' } : { category: 'preference' },
      undefined,
      kind
    );
  };
  const closeProfileMemoryEditor = () => {
    setProfileMemoryEditorOpen(false);
    setProfileMemoryEditingKey(null);
    setProfileMemoryEditorKind('memory');
    setProfileMemoryText('');
    setProfileMemoryCategory('preference');
  };
  const saveProfileMemory = async () => {
    const text = profileMemoryText.trim();
    if (!text) return;
    const key = profileMemoryEditingKey;
    setProfileMemoryBusyKey(key || 'new');
    setError(null);
    try {
      const target = key ? profileActionTargetsRef.current.get(key) : null;
      const isControlTarget = Boolean(target && !target.text && target.value);
      if (profileMemoryEditorKind === 'event') {
        if (key) {
          const eventId = String(target?.eventId || key.replace(/^event:/, ''));
          const result = await learningApi.updateLearningEvent(workspaceId, eventId, {
            eventType: profileMemoryCategory || 'manual.profile_event',
            summary: text,
            confidence: 1
          });
          if (result.event) {
            setEvents((current) => [result.event, ...current.filter((event) => String(event.id) !== eventId)]);
          }
          closeProfileMemoryEditor();
          await refreshProfileEvents();
          return;
        }
        const eventResult = await learningApi.recordLearningEvent({
          workspaceId,
          workbenchId,
          eventType: profileMemoryCategory || 'manual.profile_event',
          actor: 'user',
          payload: { summary: text, source: 'manual_profile_governance' },
          interaction: { userText: text },
          confidence: 1
        });
        if (eventResult.event) {
          setEvents((current) => [eventResult.event, ...current]);
        }
        closeProfileMemoryEditor();
        await refreshProfileEvents();
        return;
      }
      const result = profileMemoryEditorKind === 'profile'
        ? (await controlProfileSignal(
            {
              key: key || profileControlKey(profileMemoryCategory, text),
              dimension: profileMemoryCategory,
              value: target?.value || text
            },
            'correct',
            { correctedText: text, reason: key ? 'User edited profile item from Learning Profile.' : 'User added profile item from Learning Profile.' }
          ), { memory: null })
        : key && isControlTarget
          ? (await controlProfileSignal(target, 'correct', { correctedText: text, reason: 'User edited profile item from Learning Profile.' }), { memory: null })
          : key
            ? await learningApi.updateSavedMemory(workspaceId, key, { text, category: profileMemoryCategory })
            : await learningApi.createSavedMemory({ workspaceId, workbenchId, text, category: profileMemoryCategory });
      const saved = result.memory;
      if (saved) {
        setSavedMemoryRecords((current) => {
          const next = current.filter((memory) => String(memory.memoryKey || memory.key) !== String(saved.memoryKey));
          return [saved, ...next];
        });
      }
      if (key && isControlTarget) {
        setProfileControlledCorrections((current) => {
          const next = new Map(current);
          next.set(key, text);
          return next;
        });
      }
      if (profileMemoryEditorKind === 'profile') {
        const itemKey = key || profileControlKey(profileMemoryCategory, text);
        setProfileManualItems((current) => {
          const next = new Map(current);
          next.set(itemKey, { key: itemKey, dimension: profileMemoryCategory, value: text, updatedAt: new Date().toISOString() });
          return next;
        });
      }
      closeProfileMemoryEditor();
      await refreshProfileMemories();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '保存用户画像失败');
    } finally {
      setProfileMemoryBusyKey(null);
    }
  };
  const deleteProfileMemory = async (memory: any) => {
    const key = String(memory?.memoryKey || memory?.key || '');
    if (!key) return;
    setProfileMemoryBusyKey(key);
    setProfileMemoryMenu(null);
    setError(null);
    try {
      await learningApi.deleteSavedMemory(workspaceId, key);
      setSavedMemoryRecords((current) => current.filter((item) => String(item.memoryKey || item.key) !== key));
      await refreshProfileMemories();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '删除用户画像失败');
    } finally {
      setProfileMemoryBusyKey(null);
    }
  };
  const deleteProfileEvent = async (eventTarget: any) => {
    const eventId = String(eventTarget?.eventId || eventTarget?.id || '').replace(/^event:/, '');
    if (!eventId) return;
    setProfileMemoryBusyKey(`event:${eventId}`);
    setProfileMemoryMenu(null);
    setError(null);
    try {
      await learningApi.deleteLearningEvent(workspaceId, eventId);
      setEvents((current) => current.filter((event) => String(event.id) !== eventId));
      await refreshProfileEvents();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '删除近期事件失败');
    } finally {
      setProfileMemoryBusyKey(null);
    }
  };
  const controlProfileSignal = async (
    target: { key: string; dimension: string; value: string },
    action: 'correct' | 'delete' | 'freeze' | 'downrank' | 'restore',
    extra?: { correctedText?: string; reason?: string; weightMultiplier?: number }
  ) => {
    if (!target.key) return;
    setProfileMemoryBusyKey(target.key);
    setProfileMemoryMenu(null);
    setError(null);
    try {
      await learningApi.controlLearnerMemory({
        workspaceId,
        workbenchId,
        memoryKey: target.key,
        dimension: target.dimension,
        action,
        originalText: target.value,
        correctedText: extra?.correctedText,
        reason: extra?.reason,
        weightMultiplier: extra?.weightMultiplier
      });
      setProfileControlledKeys((current) => {
        const next = new Set(current);
        if (action === 'restore') next.delete(target.key);
        else if (action === 'delete') next.add(target.key);
        return next;
      });
      if (action === 'delete') {
        setProfileManualItems((current) => {
          if (!current.has(target.key)) return current;
          const next = new Map(current);
          next.delete(target.key);
          return next;
        });
      }
      if (action === 'correct' && extra?.correctedText) {
        setProfileControlledCorrections((current) => {
          const next = new Map(current);
          next.set(target.key, extra.correctedText || '');
          return next;
        });
      }
      await refreshProfileMemories();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '更新画像控制失败');
    } finally {
      setProfileMemoryBusyKey(null);
    }
  };
  const loadPlanningPlans = async (options?: { force?: boolean }) => {
    if (!workspaceId) return;
    const cached = options?.force ? null : loadIntelligenceSnapshot(workspaceId, workbenchId);
    const cachedPlans = safeArray<any>(cached?.mclPlans);
    const cachedPlan = cached?.mclPlan || cachedPlans[0] || null;
    if (cached) {
      setIntegration(cached.integration || null);
      setKgPlan(cached.kgPlan || null);
      setMclPlan(cachedPlan);
      setMclPlans(cachedPlans);
      setPlanningObjective((current) => current || cached.planningObjective || planDisplayTitle(cachedPlan) || '');
      setLoadedFromCache(true);
      setError(null);
      setPlanningPlansReady(Boolean(cachedPlan || cachedPlans.length));
    } else if (!mclPlan && !mclPlans.length) {
      setPlanningPlansReady(false);
    }

    try {
      const plansResult = await learningApi.listLearningPlans(workspaceId, { workbenchId, limit: 30 });
      const plans = safeArray<any>(plansResult.plans);
      const firstPlan = plans[0] || null;
      setMclPlans(plans);
      setMclPlan((current: any) => plans.find((plan) => plan.id === current?.id) || firstPlan || null);
      setPlanningObjective((current) => current || planDisplayTitle(firstPlan) || '根据当前学习画像、知识图谱和资料生成下一步学习计划');
      setPlanningPlansReady(true);
      setLoadedFromCache(false);
      setError(null);

      const baseSnapshot = loadIntelligenceSnapshot(workspaceId, workbenchId);
      if (baseSnapshot) {
        saveJson(intelligenceSnapshotKey(workspaceId, workbenchId), {
          ...baseSnapshot,
          savedAt: Date.now(),
          mclPlan: firstPlan,
          mclPlans: plans,
          planningObjective:
            planDisplayTitle(firstPlan) ||
            baseSnapshot.planningObjective ||
            '根据当前学习画像、知识图谱和资料生成下一步学习计划'
        });
      }
    } catch (err: any) {
      setPlanningPlansReady(true);
      setError(err?.response?.data?.error || err?.message || '学习计划加载失败');
    }
  };
  const refreshProfileViewOnly = async (baseSnapshot?: LearningIntelligenceSnapshot, options?: { force?: boolean; surfaceError?: boolean }) => {
    if (!workspaceId) return;
    try {
      const result = await learningApi.getLearnerProfileView(workspaceId, {
        workbenchId,
        limit: 30,
        forcePortrait: Boolean(options?.force)
      });
      if (result.profileView) {
        setLearnerProfileView(result.profileView);
        if (baseSnapshot) {
          saveJson(intelligenceSnapshotKey(workspaceId, workbenchId), {
            ...baseSnapshot,
            version: INTELLIGENCE_SNAPSHOT_VERSION,
            savedAt: Date.now(),
            workspaceId,
            workbenchId: workbenchId || null,
            learnerProfileView: result.profileView
          });
        }
      }
    } catch (error) {
      if (options?.surfaceError) throw error;
      // Keep the current portrait visible if background polish is not ready yet.
    }
  };
  const refreshPortrait = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const baseSnapshot = loadIntelligenceSnapshot(workspaceId, workbenchId) || undefined;
      await refreshProfileViewOnly(baseSnapshot, { force: true, surfaceError: true });
      setLoadedFromCache(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '学习画像刷新失败');
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
  useEffect(() => {
    if (section === 'planning') {
      void loadPlanningPlans();
      return;
    }
    void load();
  }, [workspaceId, workbenchId, section]);
  useEffect(() => {
    const handlePlanSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail || {};
      if (detail.workspaceId && detail.workspaceId !== workspaceId) return;
      window.localStorage.removeItem(intelligenceSnapshotKey(workspaceId, workbenchId));
      if (section === 'planning') {
        void loadPlanningPlans({ force: true });
      } else {
        void load({ force: true });
      }
    };
    window.addEventListener('learning-plan-saved', handlePlanSaved);
    return () => window.removeEventListener('learning-plan-saved', handlePlanSaved);
  }, [workspaceId, workbenchId, section]);
  useEffect(() => {
    if (!workspaceId || graphBuildJob?.id) return;
    let cancelled = false;
    const storedJobId = typeof window !== 'undefined' ? window.localStorage.getItem(courseGraphBuildJobStorageKey(workspaceId, workbenchId)) : null;
    const restoreFromStored = storedJobId
      ? learningApi.getCourseGraphBuildJob(storedJobId)
          .then((result) => result.job)
          .catch((err) => {
            if (err?.response?.status === 404 && typeof window !== 'undefined') {
              window.localStorage.removeItem(courseGraphBuildJobStorageKey(workspaceId, workbenchId));
            }
            return null;
          })
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
    if (section !== 'memory') return;
    if (learnerProfileView?.portraitPolish?.status !== 'pending' && learnerProfileView?.portraitResolution?.status !== 'pending') return;
    const timer = window.setTimeout(() => {
      void refreshProfileViewOnly();
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [
    section,
    learnerProfileView?.portraitPolish?.status,
    learnerProfileView?.portraitPolish?.entityHash,
    learnerProfileView?.portraitResolution?.status,
    learnerProfileView?.portraitResolution?.entityHash,
    workspaceId,
    workbenchId
  ]);
  useEffect(() => {
    if (!graphBuildJob?.id || graphBuildJob?.status === 'completed' || graphBuildJob?.status === 'failed') return;
    const timer = window.setInterval(async () => {
      try {
        const result = await learningApi.getCourseGraphBuildJob(graphBuildJob.id);
        setGraphBuildJob(result.job || null);
        if (result.job?.status === 'completed' || result.job?.status === 'failed') {
          window.clearInterval(timer);
          if (section === 'planning') {
            await loadPlanningPlans({ force: true });
          } else {
            await load();
          }
        }
      } catch (err: any) {
        if (err?.response?.status === 404) {
          setGraphBuildJob(null);
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(courseGraphBuildJobStorageKey(workspaceId, workbenchId));
          }
          window.clearInterval(timer);
        }
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(planMetaStorageKey(workspaceId)) || '{}');
      if (parsed && typeof parsed === 'object') setPlanDisplayMeta(parsed);
    } catch {
      setPlanDisplayMeta({});
    }
  }, [workspaceId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(planMetaStorageKey(workspaceId), JSON.stringify(planDisplayMeta));
  }, [planDisplayMeta, workspaceId]);
  useEffect(() => {
    if (!planMenu) return;
    const close = () => {
      setPlanMenu(null);
      setPlanMenuSubmenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [planMenu]);
  useEffect(() => {
    const plans = mclPlans.length ? mclPlans : mclPlan ? [mclPlan] : [];
    const missing = plans.filter((plan) => plan?.id && !planDisplayMeta[plan.id]);
    if (!missing.length) return;

    missing.forEach((plan) => {
      const fallback = fallbackPlanMeta(plan);
      setPlanDisplayMeta((current) => current[plan.id] ? current : { ...current, [plan.id]: fallback });
      void aiApi.chat({
        messages: [{
          role: 'user',
          content: [
            '请为这个学习计划生成一个短标题和一个 emoji。',
            '只返回 JSON：{"emoji":"...","title":"..."}。',
            'title 必须是中文，8-14 个字，不要复述用户原问题，不要出现“给我一个学习计划”。',
            `计划内容：${clipText(planTextForMeta(plan), 1200)}`
          ].join('\n')
        }]
      }).then((result) => {
        setPlanDisplayMeta((current) => ({ ...current, [plan.id]: parsePlanMetaReply(result.reply || '', plan) }));
      }).catch(() => {
        // Keep the local fallback; title generation should never block the plan list.
      });
    });
  }, [mclPlan, mclPlans, planDisplayMeta]);
  const runMclPlanning = async (objectiveOverride?: string) => {
    if (planningRunning || planningRunStatus === 'running' || planningRunStatus === 'starting') return;
    if (planningPollTimerRef.current != null) {
      window.clearTimeout(planningPollTimerRef.current);
      planningPollTimerRef.current = null;
    }
    const objective = objectiveOverride?.trim() || planningObjective.trim() || integration?.continueLearning?.prompt || kgPlan?.objective || '根据当前学习画像、知识图谱和资料生成下一步学习计划';
    setPlanningObjective(objective);
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
        setPlanningView('plans');
        if (result.plan) {
          setMclPlan(result.plan);
          setMclPlans((current) => [result.plan, ...current.filter((plan) => plan.id !== result.plan?.id)]);
          setStageSelectionDismissed(false);
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
                  setStageSelectionDismissed(false);
                  setSelectedStepId(safeArray<any>(parsed.plan.structuredPlan?.stages)[0]?.order ? `structured-${safeArray<any>(parsed.plan.structuredPlan?.stages)[0].order}` : null);
                  setPlanningView('plans');
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
      await loadPlanningPlans({ force: true });
      onPlanApplied?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '计划应用失败');
    } finally {
      setPlanActionBusyId(null);
    }
  };
  const deletePlan = async (plan: any) => {
    if (!plan?.id) return;
    setPlanActionBusyId(plan.id);
    setError(null);
    try {
      await learningApi.deleteLearningPlan(plan.id, { workspaceId });
      setMclPlans((current) => current.filter((item) => item.id !== plan.id));
      setMclPlan((current: any) => current?.id === plan.id ? null : current);
      setPlanDisplayMeta((current) => {
        const next = { ...current };
        delete next[plan.id];
        return next;
      });
      setPlanMenu(null);
      setPlanMenuSubmenu(null);
      window.localStorage.removeItem(intelligenceSnapshotKey(workspaceId, workbenchId));
      await loadPlanningPlans({ force: true });
      onPlanApplied?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '计划删除失败');
    } finally {
      setPlanActionBusyId(null);
    }
  };
  const replaceCurrentPlan = (plan: any) => {
    setMclPlan(plan);
    setMclPlans((current) => [plan, ...current.filter((item) => item.id !== plan.id)]);
    window.dispatchEvent(new CustomEvent('learning-plan-saved', { detail: { workspaceId, planId: plan.id } }));
  };
  const startStageEdit = (stage: StructuredStage, stageId: string) => {
    setEditingStageId(stageId);
    setStageDraftTitle(String(stage.title || ''));
    setStageDraftContent(markdownForStage(stage));
    setStagePatchProposal(null);
  };
  const cancelStageEdit = () => {
    setEditingStageId(null);
    setStageDraftTitle('');
    setStageDraftContent('');
  };
  const closeStagePopover = () => {
    setStageSelectionDismissed(true);
    setSelectedStepId(null);
    setStageActionMode('menu');
    setStageActionInput('');
    setEditingStageId(null);
    setStagePatchProposal(null);
    setStageExplainResult('');
    setStageExplainMessages([]);
    setStageModifyMessages([]);
    setStageSourcesOpen(false);
    setStageStatusMenuOpen(false);
  };
  const saveStageEdit = async (source: 'manual' | 'llm_patch' = 'manual', proposal?: StagePatchProposal | null) => {
    if (!mclPlan?.id || !selectedStructuredStageId) return;
    const title = source === 'llm_patch' && proposal ? proposal.title : stageDraftTitle;
    const content = source === 'llm_patch' && proposal ? proposal.content : stageDraftContent;
    setStageGovernanceBusy(source === 'llm_patch' ? 'apply_patch' : 'save');
    setError(null);
    try {
      const result = await learningApi.updateLearningPlanStage(mclPlan.id, selectedStructuredStageId, {
        workspaceId,
        title,
        content,
        changeSource: source,
        proposalId: proposal?.id || null,
        note: source === 'llm_patch' ? proposal?.summary : 'manual stage edit'
      });
      if (result?.plan) {
        replaceCurrentPlan(result.plan);
        setStageSelectionDismissed(false);
        setSelectedStepId(selectedStructuredStageId);
      }
      setStagePatchProposal(null);
      cancelStageEdit();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '计划阶段保存失败');
    } finally {
      setStageGovernanceBusy(null);
    }
  };
  const requestStagePatch = async (targetStageId = selectedStructuredStageId, instructionOverride?: string) => {
    if (!mclPlan?.id || !targetStageId) return;
    const userInstruction = instructionOverride ?? patchInstruction.trim();
    setStageGovernanceBusy('patch');
    setError(null);
    try {
      const result = await learningApi.proposeLearningPlanStagePatch(mclPlan.id, targetStageId, {
        workspaceId,
        instruction: userInstruction || undefined
      });
      setStagePatchProposal(result?.proposal || null);
      const proposal = result?.proposal;
      if (userInstruction || proposal?.summary || proposal?.rationale) {
        setStageModifyMessages((current) => [
          ...current,
          ...(userInstruction ? [{ role: 'user' as const, content: userInstruction }] : []),
          ...(proposal ? [{ role: 'assistant' as const, content: [proposal.summary, proposal.rationale].filter(Boolean).join('\n\n') || '已生成修改建议。' }] : [])
        ]);
      }
      setStageActionInput('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '局部优化建议生成失败');
    } finally {
      setStageGovernanceBusy(null);
    }
  };
  const requestPlanReview = async (instructionOverride?: string) => {
    if (!mclPlan?.id) return;
    const instruction = instructionOverride ?? '';
    setStageGovernanceBusy('review');
    setError(null);
    try {
      const result = await learningApi.reviewLearningPlan(mclPlan.id, {
        workspaceId,
        instruction: instruction || undefined
      });
      setPlanReviewResult(result?.review || null);
      if (instruction || result?.review?.summary) {
        setRouteModifyMessages((current) => [
          ...current,
          ...(instruction ? [{ role: 'user' as const, content: instruction }] : []),
          ...(result?.review?.summary ? [{ role: 'assistant' as const, content: result.review.summary }] : [])
        ]);
      }
      setRouteActionInput('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '全局计划审阅失败');
    } finally {
      setStageGovernanceBusy(null);
    }
  };
  const applyPlanReviewSuggestion = async (item: PlanReviewResult['suggestions'][number], key: string) => {
    const targetStageId = item.stageId && structuredStages.some((stage, index) => structuredStageId(stage, index) === item.stageId)
      ? item.stageId
      : structuredStages.find((stage) => cleanNarrative(stage.title) === cleanNarrative(item.stageTitle)) ?
        structuredStageId(structuredStages.find((stage) => cleanNarrative(stage.title) === cleanNarrative(item.stageTitle))!, structuredStages.findIndex((stage) => cleanNarrative(stage.title) === cleanNarrative(item.stageTitle)))
      : selectedStructuredStageId || (structuredStages[0] ? structuredStageId(structuredStages[0], 0) : null);
    if (!targetStageId) return;
    setSelectedStepId(targetStageId);
    setStageSelectionDismissed(false);
    setStageActionMode('modify');
    setRouteActionMode('idle');
    setApplyingPlanSuggestionKey(key);
    try {
      await requestStagePatch(targetStageId, [item.issue, item.recommendation].filter(Boolean).join('\n'));
    } finally {
      setApplyingPlanSuggestionKey(null);
    }
  };
  const updateSelectedStageStatus = async (status: PlanStepStatus) => {
    if (!mclPlan?.id || !selectedStructuredStageId) return;
    const targetStep = planSteps.find((item) =>
      item.id === selectedStructuredStageId ||
      item.stageId === selectedStructuredStageId ||
      Number(item.order) === Number((selectedStructuredStage as any)?.order || selectedStructuredStageIndex + 1)
    );
    const targetStepId = String(targetStep?.id || selectedStructuredStageId);
    setStageStatusBusy(true);
    setError(null);
    try {
      const result = await learningApi.updateLearningPlanStepStatus(mclPlan.id, targetStepId, {
        workspaceId,
        status
      });
      if (result?.plan) {
        replaceCurrentPlan(result.plan);
        setSelectedStepId(selectedStructuredStageId);
        setStageSelectionDismissed(false);
      }
      setStageStatusMenuOpen(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '阶段状态更新失败');
    } finally {
      setStageStatusBusy(false);
    }
  };
  const explainRouteInline = async (_stages: RouteCanvasStage[], questionOverride?: string) => {
    if (!mclPlan?.id) return;
    const question = questionOverride ?? routeActionInput.trim();
    setPlanningInlineBusy('route_explain');
    setRouteExplainResult('');
    setError(null);
    try {
      const result = await learningApi.explainLearningPlan(mclPlan.id, {
        workspaceId,
        question: question || '请解释这条学习路线为什么这样安排。',
        history: routeExplainMessages.slice(-4)
      });
      const reply = result.reply || '暂无解释。';
      setRouteExplainResult(reply);
      setRouteExplainMessages((current) => [
        ...current,
        ...(question ? [{ role: 'user' as const, content: question }] : []),
        { role: 'assistant' as const, content: reply }
      ]);
      setRouteActionInput('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '路线解释生成失败');
    } finally {
      setPlanningInlineBusy(null);
    }
  };
  const explainStageInline = async (questionOverride?: string) => {
    if (!selectedStructuredStage || !selectedStructuredStageId) return;
    if (!mclPlan?.id) return;
    const userQuestion = questionOverride ?? stageActionInput.trim();
    setPlanningInlineBusy('stage_explain');
    setStageExplainResult('');
    setError(null);
    try {
      const result = await learningApi.explainLearningPlanStage(mclPlan.id, selectedStructuredStageId, {
        workspaceId,
        question: userQuestion || undefined,
        history: stageExplainMessages.slice(-4)
      });
      const reply = result.reply || '暂无解释。';
      setStageExplainResult(reply);
      setStageExplainMessages((current) => [
        ...current,
        ...(userQuestion ? [{ role: 'user' as const, content: userQuestion }] : []),
        { role: 'assistant' as const, content: reply }
      ]);
      setStageActionInput('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '阶段解释生成失败');
    } finally {
      setPlanningInlineBusy(null);
    }
  };
  const openNewPlanModal = () => {
    setPlanningDraftObjective(planningObjective || '');
    setNewPlanModalOpen(true);
  };
  const submitNewPlan = () => {
    const objective = planningDraftObjective.trim();
    if (!objective || planningRunning || planningRunStatus === 'running' || planningRunStatus === 'starting') return;
    setNewPlanModalOpen(false);
    void runMclPlanning(objective);
  };
  const conceptById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const sourceById = useMemo(() => new Map(graph.sources.map((source) => [source.id, source])), [graph.sources]);
  const kgSearchResults = useMemo<KgSearchResult[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const semanticTerms = semanticExpansionsFor(q);
    const results: KgSearchResult[] = [];
    const pushResult = (result: KgSearchResult) => {
      const existing = results.find((item) => item.id === result.id);
      if (!existing) {
        results.push(result);
        return;
      }
      if (result.score > existing.score) Object.assign(existing, result);
    };
    const scoreSemantic = (value: unknown, weight: number) => {
      const text = normalizeSearchText(value);
      if (!text) return 0;
      const hits = semanticTerms.filter((term) => term && text.includes(normalizeSearchText(term))).length;
      return hits ? Math.min(weight, (hits / Math.max(1, semanticTerms.length)) * weight) : 0;
    };

    graph.nodes.forEach((concept) => {
      const tags = (concept.tags || []).map((tag) => tag.label).filter(Boolean);
      const nodeSources = [
        ...(concept.sources || []),
        ...(concept.sourceIds || []).map((id) => sourceById.get(id)).filter(Boolean) as GraphSource[]
      ];
      const sourceText = nodeSources.map((source) => `${source.name || ''} ${source.path || ''} ${source.resourceType || ''}`).join(' ');
      const evidenceText = [
        ...safeArray<any>(concept.aiEvidence?.resourceEvidence).map((item) => `${item.fileName || ''} ${item.path || ''} ${item.snippet || ''} ${item.quote || ''}`),
        ...safeArray<any>(concept.sources).flatMap((source) => safeArray<any>(source.snippets).map((snippet) => `${snippet.quote || ''} ${snippet.rationale || ''}`))
      ].join(' ');
      const misconceptionText = safeArray<any>(concept.misconceptions).map((item) => `${item.title || ''} ${item.repairHint || ''}`).join(' ');
      const relatedEdges = graph.edges.filter((edge) => edge.from === concept.id || edge.to === concept.id).slice(0, 8);
      const relationText = relatedEdges.map((edge) => {
        const peerId = edge.from === concept.id ? edge.to : edge.from;
        return `${edge.relationType} ${conceptById.get(peerId)?.title || peerId}`;
      }).join(' ');
      const titleScore = scoreSearchField(q, concept.title, 8);
      const descriptionScore = scoreSearchField(q, concept.description, 4.5);
      const categoryScore = scoreSearchField(q, concept.category, 3.8);
      const tagScore = scoreSearchField(q, tags.join(' '), 3.6);
      const sourceScore = scoreSearchField(q, sourceText, 3.2);
      const evidenceScore = scoreSearchField(q, evidenceText, 2.8);
      const semanticScore = scoreSemantic(`${concept.title} ${concept.description || ''} ${concept.category || ''} ${tags.join(' ')} ${relationText} ${sourceText} ${evidenceText}`, 2.2);
      const conceptScore = titleScore + descriptionScore + categoryScore + tagScore + sourceScore + evidenceScore + semanticScore;
      if (conceptScore > 0.45) {
        const snippets = [
          clipText(concept.description, 180),
          ...safeArray<any>(concept.aiEvidence?.resourceEvidence).map((item) => clipText(item.snippet || item.quote, 180)),
          ...safeArray<any>(concept.sources).flatMap((source) => safeArray<any>(source.snippets).map((snippet) => clipText(snippet.quote || snippet.rationale, 180)))
        ].filter(Boolean).slice(0, 3);
        pushResult({
          id: `concept:${concept.id}`,
          group: '概念',
          conceptId: concept.id,
          title: concept.title || concept.id,
          subtitle: concept.category || `${relatedEdges.length} relations`,
          matchReason: titleScore ? 'Matched concept title' : descriptionScore ? 'Matched concept description' : categoryScore ? 'Matched category' : semanticScore ? 'Semantic match in concept context' : 'Matched concept evidence',
          explanation: `Best match across title, description, category, tags, sources, evidence, and related concepts.`,
          previewTitle: concept.title || concept.id,
          previewBody: concept.description || '这个概念暂无描述。',
          previewMeta: [concept.category || 'Concept', `${tags.length} tags`, `${nodeSources.length} sources`, `${relatedEdges.length} relations`],
          snippets,
          tags,
          score: conceptScore
        });
      }

      tags.forEach((tag) => {
        const tagMatchScore = scoreSearchField(q, tag, 5) + scoreSemantic(`${tag} ${concept.title} ${concept.description || ''}`, 1.2);
        if (tagMatchScore <= 0.45) return;
        pushResult({
          id: `tag:${concept.id}:${normalizeSearchText(tag)}`,
          group: '标签',
          conceptId: concept.id,
          title: tag,
          subtitle: concept.title,
          matchReason: 'Matched concept tag',
          explanation: `This tag is attached to ${concept.title}.`,
          previewTitle: concept.title,
          previewBody: concept.description || `Tagged as ${tag}.`,
          previewMeta: ['Tag', concept.category || 'Concept'],
          snippets: [clipText(concept.description, 180)].filter(Boolean),
          tags,
          score: tagMatchScore
        });
      });

      safeArray<any>(concept.misconceptions).forEach((misconception, index) => {
        const text = `${misconception.title || ''} ${misconception.repairHint || ''}`;
        const misconceptionScore = scoreSearchField(q, text, 5.2) + scoreSemantic(`${text} ${concept.title}`, 1.3);
        if (misconceptionScore <= 0.45) return;
        pushResult({
          id: `misconception:${concept.id}:${index}`,
          group: '误区',
          conceptId: concept.id,
          title: misconception.title || 'Misconception',
          subtitle: concept.title,
          matchReason: 'Matched misconception or repair hint',
          explanation: `Potential weak spot connected to ${concept.title}.`,
          previewTitle: concept.title,
          previewBody: misconception.repairHint || concept.description || '',
          previewMeta: ['Misconception', misconception.severity ? `Severity ${misconception.severity}` : 'Needs review'],
          snippets: [clipText(misconception.repairHint || concept.description, 180)].filter(Boolean),
          tags,
          score: misconceptionScore
        });
      });

      nodeSources.forEach((source) => {
        const sourceSnippetText = safeArray<any>((source as GraphSourceRef).snippets).map((snippet) => `${snippet.quote || ''} ${snippet.rationale || ''}`).join(' ');
        const text = `${source.name || ''} ${source.path || ''} ${source.resourceType || ''} ${source.origin || ''} ${sourceSnippetText}`;
        const sourceMatchScore = scoreSearchField(q, text, 5.4) + scoreSemantic(`${text} ${concept.title} ${concept.description || ''}`, 1.2);
        if (sourceMatchScore <= 0.45) return;
        pushResult({
          id: `source:${concept.id}:${source.id}`,
          group: '来源',
          conceptId: concept.id,
          title: source.name || '知识来源',
          subtitle: concept.title,
          matchReason: 'Matched source name, path, or evidence snippet',
          explanation: `This source grounds ${concept.title}.`,
          previewTitle: source.name || '知识来源',
          previewBody: source.path || source.origin || concept.description || '',
          previewMeta: [source.resourceType || '来源', concept.title],
          snippets: safeArray<any>((source as GraphSourceRef).snippets).map((snippet) => clipText(snippet.quote || snippet.rationale, 180)).filter(Boolean).slice(0, 3),
          tags,
          score: sourceMatchScore
        });
      });
    });

    graph.edges.forEach((edge) => {
      const from = conceptById.get(edge.from);
      const to = conceptById.get(edge.to);
      const relationText = `${edge.relationType} ${from?.title || edge.from} ${to?.title || edge.to}`;
      const relationScore = scoreSearchField(q, relationText, 5.8) + scoreSemantic(relationText, 1.2);
      if (relationScore <= 0.45) return;
      const concept = to || from;
      if (!concept) return;
      pushResult({
        id: `relation:${edge.id}`,
        group: '关系',
        conceptId: concept.id,
        title: `${from?.title || edge.from} -> ${to?.title || edge.to}`,
        subtitle: edge.relationType,
        matchReason: 'Matched relation type or connected concept',
        explanation: `This relation connects two concepts in the knowledge graph.`,
        previewTitle: edge.relationType,
        previewBody: `${from?.title || edge.from} -> ${to?.title || edge.to}`,
        previewMeta: [`Weight ${score(edge.weight)}`, `Confidence ${score(edge.confidence)}`],
        snippets: safeArray<any>(edge.sources).flatMap((source) => safeArray<any>(source.snippets).map((snippet) => clipText(snippet.quote || snippet.rationale, 180))).filter(Boolean).slice(0, 3),
        tags: [],
        score: relationScore
      });
    });

    return results.sort((left, right) => right.score - left.score).slice(0, 80);
  }, [conceptById, graph.edges, graph.nodes, query, sourceById]);
  const filteredSearchResults = useMemo(
    () => kgSearchFacet === 'All' ? kgSearchResults : kgSearchResults.filter((result) => result.group === kgSearchFacet),
    [kgSearchFacet, kgSearchResults]
  );
  const previewSearchResult = useMemo(
    () => filteredSearchResults.find((result) => result.id === kgSearchPreviewId) || filteredSearchResults[0] || null,
    [filteredSearchResults, kgSearchPreviewId]
  );
  const filteredConcepts = useMemo(() => {
    const q = query.trim();
    const nodes = graph.nodes;
    if (!q) return nodes;
    const matchedIds = new Set(kgSearchResults.map((result) => result.conceptId));
    return nodes.filter((node) => matchedIds.has(node.id) || scoreSearchField(q, node.title, 8) > 0.45);
  }, [graph.nodes, kgSearchResults, query]);
  useEffect(() => {
    setKgSearchPreviewId((current) => {
      if (current && filteredSearchResults.some((result) => result.id === current)) return current;
      return filteredSearchResults[0]?.id || null;
    });
  }, [filteredSearchResults]);
  const rememberKgSearch = (value: string) => {
    const nextQuery = value.trim();
    if (!nextQuery) return;
    setKgRecentSearches((current) => {
      const next = [nextQuery, ...current.filter((item) => item.toLowerCase() !== nextQuery.toLowerCase())].slice(0, 8);
      try {
        window.localStorage.setItem(`${kgRecentSearchesStorageKey}:${workspaceId}`, JSON.stringify(next));
      } catch {
        // localStorage can be unavailable in private contexts.
      }
      return next;
    });
  };
  const focusSearchResult = (result: KgSearchResult) => {
    rememberKgSearch(query || result.title);
    setQuery((current) => current.trim() || result.title);
    setFocusedGraphConceptId(result.conceptId);
    setKnowledgeSearchOpen(false);
  };
  const drawerIncomingEdges = drawerConcept ? graph.edges.filter((edge) => edge.to === drawerConcept.id) : [];
  const drawerOutgoingEdges = drawerConcept ? graph.edges.filter((edge) => edge.from === drawerConcept.id) : [];
  const diagnosisItems = safeArray<DiagnosisItem>(diagnosis?.concepts);
  const weakConcepts = diagnosisItems.filter((item) => item.diagnosis === 'weak' || item.diagnosis === 'prerequisite_gap');
  const naturalPlanMarkdown = String(mclPlan?.naturalPlanMarkdown || mclPlan?.rationale || '').trim();
  const structuredPlan = mclPlan?.structuredPlan && !mclPlan.structuredPlan.parseFailed ? mclPlan.structuredPlan : null;
  const structuredStages = safeArray<StructuredStage>(structuredPlan?.stages);
  const stageSupportItems = normalizeStageSupport(mclPlan, structuredStages);
  const stageSupportById = new Map(stageSupportItems.map((item) => [item.stageId, item]));
  const selectedStructuredStage = selectedStepId
    ? structuredStages.find((stage, index) => structuredStageId(stage, index) === selectedStepId) || null
    : null;
  const selectedStructuredStageIndex = selectedStructuredStage ? structuredStages.indexOf(selectedStructuredStage) : -1;
  const selectedStructuredSupport = selectedStructuredStage && selectedStructuredStageIndex >= 0
    ? stageSupportById.get(structuredStageId(selectedStructuredStage, selectedStructuredStageIndex))
    : undefined;
  const selectedStructuredStageId = selectedStructuredStage && selectedStructuredStageIndex >= 0
    ? structuredStageId(selectedStructuredStage, selectedStructuredStageIndex)
    : null;
  const planSteps = safeArray<any>(mclPlan?.steps);
  const selectedStep = planSteps.find((step) => step.id === selectedStepId) || planSteps[0] || null;
  const stageStatusById = new Map(structuredStages.map((stage, index) => {
    const stageId = structuredStageId(stage, index);
    const step = planSteps.find((item) => item.id === stageId || item.stageId === stageId || Number(item.order) === Number(stage.order || index + 1));
    return [stageId, normalizePlanStepStatus(String(step?.status || (index === 0 ? 'active' : 'pending')))];
  }));
  const selectedStructuredStageStatus = normalizePlanStepStatus(selectedStructuredStageId ? stageStatusById.get(selectedStructuredStageId) : undefined);
  const pathIds = safeArray<any>(kgPlan?.knowledgeGraphSnapshot?.nodes).map((node) => String(node.id)).filter(Boolean);
  const stableProfileSignals: ProfileDisplaySignal[] = [
    ...safeArray<any>(learnerState?.coreState?.stableProfile?.learningGoals).map((signal) => toProfileSignal(signal, 'profileBase', 'Learning goal')),
    ...safeArray<any>(learnerState?.coreState?.stableProfile?.masteredKnowledge).map((signal) => toProfileSignal(signal, 'knowledgeState', 'Mastered knowledge')),
    ...safeArray<any>(learnerState?.coreState?.stableProfile?.weakKnowledge).map((signal) => toProfileSignal(signal, 'knowledgeState', 'Weak knowledge')),
    ...safeArray<any>(learnerState?.coreState?.stableProfile?.learningPreferences).map((signal) => toProfileSignal(signal, 'preferenceStyle', 'Learning preference')),
    ...safeArray<any>(learnerState?.coreState?.stableProfile?.commonErrors).map((signal) => toProfileSignal(signal, 'misconceptionState', 'Common error')),
    ...safeArray<any>(learnerState?.coreState?.stableProfile?.learnerTraits).map((signal) => toProfileSignal(signal, 'cognitiveState', 'Learner trait'))
  ];
  const workingStateSignals: ProfileDisplaySignal[] = [
    ...safeArray<any>(learnerState?.coreState?.workingState?.currentCourseState?.activeGoals).map((signal) => toProfileSignal(signal, 'profileBase', 'Active goal', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.currentCourseState?.focusKnowledge).map((signal) => toProfileSignal(signal, 'knowledgeState', 'Focus knowledge', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.currentCourseState?.pendingQuestions).map((signal) => toProfileSignal(signal, 'cognitiveState', 'Pending question', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.currentCourseState?.nextActions).map((signal) => toProfileSignal(signal, 'reviewPlanning', '下一步行动', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.recentBehaviorSummary?.recentTopics).map((signal) => toProfileSignal(signal, 'profileBase', 'Recent topic', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.recentBehaviorSummary?.engagementSignals).map((signal) => toProfileSignal(signal, 'behaviorEngagement', 'Engagement signal', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.recentBehaviorSummary?.reviewPressure).map((signal) => toProfileSignal(signal, 'reviewPlanning', 'Review pressure', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.observationMemory?.observations).map((signal) => toProfileSignal(signal, signal?.dimension || 'profileBase', signal?.label || 'Observation', 'observation_memory'))
  ];
  const savedMemorySignals = safeArray<any>(savedMemoryRecords)
    .filter((memory) => memory?.status !== 'deleted' && memory?.status !== 'suppressed')
    .map((memory) => ({
      ...toProfileSignal(memory, 'savedMemory', 'Saved memory', 'saved_memory'),
      label: String(memory?.dimension || memory?.category || 'Saved memory')
    }));
  const stableGroups = groupProfileSignals(stableProfileSignals, 6);
  const workingGroups = groupProfileSignals(workingStateSignals, 5);
  const savedMemoryGroups = groupProfileSignals(savedMemorySignals, 8, { keepPromptLike: true });
  const displayStableGroups = safeArray<any>(learnerProfileView?.stableProfile).length
    ? safeArray<any>(learnerProfileView?.stableProfile).map((group) => ({
        dimension: String(group.key || group.dimension || 'profileBase'),
        meta: {
          title: String(group.title || profileDimensionMeta[group.key]?.title || group.key || '画像维度'),
          detail: String(group.summary || profileDimensionMeta[group.key]?.detail || '学习画像维度。')
        },
        items: safeArray<any>(group.items).map((item) => toProfileSignal(item, String(item.dimension || group.key || 'profileBase'), String(item.label || '画像信号'), 'llm_profile_view'))
      })).filter((group) => group.items.length)
    : stableGroups;
  const displayWorkingGroups = safeArray<any>(learnerProfileView?.workingState).length
    ? safeArray<any>(learnerProfileView?.workingState).map((group) => ({
        dimension: String(group.key || group.dimension || 'profileBase'),
        meta: {
          title: String(group.title || profileDimensionMeta[group.key]?.title || group.key || 'Working State'),
          detail: String(group.summary || profileDimensionMeta[group.key]?.detail || '近期证据与工作状态。')
        },
        items: safeArray<any>(group.items).map((item) => toProfileSignal(item, String(item.dimension || group.key || 'profileBase'), String(item.label || 'Working state'), 'llm_profile_view'))
      })).filter((group) => group.items.length)
    : workingGroups;
  const displaySavedMemories = savedMemoryGroups.flatMap((group) => group.items);
  const savedMemoryBySignalId = useMemo(() => {
    const map = new Map<string, any>();
    safeArray<any>(savedMemoryRecords).forEach((memory) => {
      const signal = toProfileSignal(memory, 'savedMemory', 'Saved memory', 'saved_memory');
      map.set(signal.id, memory);
      if (memory?.memoryKey) map.set(String(memory.memoryKey), memory);
      if (memory?.key) map.set(String(memory.key), memory);
    });
    return map;
  }, [savedMemoryRecords]);
  const displayRecentEvents = safeArray<any>(learnerProfileView?.recentEvents).length
    ? safeArray<any>(learnerProfileView?.recentEvents)
    : events.slice(0, 20).map((event) => ({
        id: event.id,
        eventType: event.eventType,
        summary: event.payload?.interaction?.userText || event.objectType || event.eventFamily || event.eventType,
        confidence: event.confidence,
        observedAt: event.observedAt
      }));
  const stableCount = stableProfileSignals.length;
  const workingCount = workingStateSignals.length;
  const observationCount = safeArray<any>(learnerState?.coreState?.observationMemory?.observations).length;
  const versionItems = safeArray<any>(learnerState?.versions);
  const activeVersion = learnerProfileView?.overview?.activeVersion || learnerState?.version || versionItems[0]?.version || 1;
  const profileVisualNodes: ProfileVisualNode[] = useMemo(() => {
    const polishedEntities = safeArray<LearnerPortraitEntity>(learnerProfileView?.portraitPolish?.entities);
    const resolvedEntities = safeArray<LearnerPortraitEntity>(learnerProfileView?.portraitResolution?.entities);
    const explicitEntities = polishedEntities.length ? polishedEntities : resolvedEntities.length ? resolvedEntities : safeArray<LearnerPortraitEntity>(learnerProfileView?.portraitEntities);
    const legacySignals = [
      ...displayStableGroups.flatMap((group) => group.items).map((item) => ({ item, layer: 'stable' as ProfileLayer })),
      ...displayWorkingGroups.flatMap((group) => group.items).map((item) => ({ item, layer: 'working' as ProfileLayer })),
      ...displaySavedMemories.map((item) => ({ item, layer: 'memory' as ProfileLayer }))
    ];
    const legacyDimensionFor = (signal: ProfileDisplaySignal): PortraitDimension => {
      const text = `${signal.label} ${signal.value} ${signal.rationale || ''}`;
      if (signal.dimension === 'knowledgeState') return 'knowledgeFoundation';
      if (signal.dimension === 'misconceptionState') return 'errorPattern';
      if (signal.dimension === 'preferenceStyle') return /例子|案例|图解|可视化|步骤|一步一步|代码|demo|example|visual|step/i.test(text) ? 'cognitiveStyle' : 'learningPreference';
      if (signal.dimension === 'cognitiveState') return /反思|计划|监控|策略|求助|reflect|plan|monitor/i.test(text) ? 'metacognitiveStrategy' : 'cognitiveStyle';
      if (signal.dimension === 'behaviorEngagement') return 'metacognitiveStrategy';
      if (signal.dimension === 'reviewPlanning') return /压力|遗忘|复习|risk|pressure|review/i.test(text) ? 'learningRisk' : 'supportNeed';
      if (signal.dimension === 'savedMemory') return 'learningPreference';
      if (/目标|计划|考试|完成|掌握|goal|objective/i.test(text)) return 'learningGoal';
      if (/专业|课程|年级|背景|项目|实验|作业|course|major|project|lab/i.test(text)) return 'learningBackground';
      return 'learningBackground';
    };
    const legacyEntities: LearnerPortraitEntity[] = explicitEntities.length
      ? []
      : legacySignals.map(({ item, layer }) => {
          const dimension = legacyDimensionFor(item);
          const status = layer === 'stable' || layer === 'memory' ? 'stable' : item.status === 'active' ? 'active' : 'candidate';
          const polarity: LearnerPortraitEntity['polarity'] =
            dimension === 'learningRisk' ? 'risk' :
              dimension === 'learningPreference' || dimension === 'cognitiveStyle' ? 'preference' :
                dimension === 'errorPattern' || dimension === 'supportNeed' ? 'need' :
                  /mastered|已掌握|strength/i.test(`${item.label} ${item.value}`) ? 'strength' : 'neutral';
          return {
            id: `legacy:${dimension}:${item.id}`,
            dimension,
            type: `legacy_${item.dimension}`,
            title: item.label || portraitDimensionMeta[dimension].title,
            description: item.value,
            displayTitle: item.label || portraitDimensionMeta[dimension].title,
            displayDescription: item.value,
            status,
            polarity,
            confidence: Number(item.confidence || 0.45),
            evidenceCount: Math.max(1, safeArray(item.evidenceIds).length),
            evidence: [{
              id: item.id,
              sourceType: layer === 'memory' ? 'saved_memory' : layer === 'stable' ? 'stable_profile' : 'working_state',
              summary: item.value,
              confidence: Number(item.confidence || 0.45),
              observedAt: item.lastObservedAt || item.firstObservedAt || undefined
            }],
            affectedConcepts: item.dimension === 'knowledgeState' || item.dimension === 'misconceptionState' ? [item.value] : [],
            recommendation: dimension === 'learningRisk' ? '优先安排短诊断和复习检查。' : dimension === 'supportNeed' ? '把下一步拆成可执行的小任务。' : undefined,
            displayRecommendation: dimension === 'learningRisk' ? '优先安排短诊断和复习检查。' : dimension === 'supportNeed' ? '把下一步拆成可执行的小任务。' : undefined,
            updatedAt: item.lastObservedAt || item.firstObservedAt || null
          };
        });
    const portraitEntities = explicitEntities.length ? explicitEntities : legacyEntities;
    return portraitDimensionOrder.map((dimension) => {
      const entities = portraitEntities.filter((entity) => entity.dimension === dimension);
      const meta = portraitDimensionMeta[dimension];
      const statusCounts = {
        stable: entities.filter((entity) => entity.status === 'stable').length,
        active: entities.filter((entity) => entity.status === 'active').length,
        candidate: entities.filter((entity) => entity.status === 'candidate').length,
        needs_review: entities.filter((entity) => entity.status === 'needs_review').length
      };
      const polarityCounts = {
        strength: entities.filter((entity) => entity.polarity === 'strength').length,
        need: entities.filter((entity) => entity.polarity === 'need').length,
        risk: entities.filter((entity) => entity.polarity === 'risk').length,
        preference: entities.filter((entity) => entity.polarity === 'preference').length,
        neutral: entities.filter((entity) => entity.polarity === 'neutral').length
      };
      return {
        dimension,
        title: meta.title,
        detail: meta.detail,
        count: entities.length,
        layerCounts: {
          stable: statusCounts.stable,
          working: statusCounts.active + statusCounts.candidate,
          memory: entities.filter((entity) => safeArray<NonNullable<LearnerPortraitEntity['evidence']>[number]>(entity.evidence).some((evidence) => evidence.sourceType === 'saved_memory')).length
        },
        confidence: entities.length ? entities.reduce((sum, entity) => sum + Number(entity.confidence || 0), 0) / entities.length : 0,
        samples: entities.map((entity) => entity.displayTitle || entity.title).slice(0, 3),
        entities,
        polarityCounts,
        statusCounts
      };
    });
  }, [displaySavedMemories, displayStableGroups, displayWorkingGroups, learnerProfileView?.portraitEntities, learnerProfileView?.portraitPolish, learnerProfileView?.portraitResolution]);
  useEffect(() => {
    if (structuredStages.length && !selectedStepId && !stageSelectionDismissed) {
      setSelectedStepId(structuredStageId(structuredStages[0], 0));
    }
  }, [structuredStages, selectedStepId, stageSelectionDismissed]);
  const contextSummary =
    section === 'overview' ? integration?.learnerState?.summary || '等待学习状态生成。'
      : section === 'knowledge' ? `${filteredConcepts.length} 个知识对象，${graph.edges.length} 条关系。`
        : section === 'diagnosis' ? `${diagnosisItems.length} 条诊断对象，${weakConcepts.length} 条需要优先关注。`
          : section === 'planning' ? mclPlan?.objective || '还没有学习计划。'
            : `${activeVersion ? `v${activeVersion} · ` : ''}${learnerProfileView?.overview?.summary || learnerState?.summary || '学习画像已加载。'}`;
  const renderDashboardActions = () => (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void (section === 'memory' ? refreshPortrait() : section === 'planning' ? loadPlanningPlans({ force: true }) : load({ force: true }))}
        disabled={loading || Boolean(graphActionRunning)}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4] disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {section === 'memory' ? '刷新画像' : loadedFromCache ? '刷新最新' : '刷新'}
      </button>
      {onOpenTerminal ? (
        <button
          type="button"
          onClick={() => onOpenTerminal(integration?.continueLearning?.prompt || '根据我的学习状态推荐下一步')}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
        >
          <Sparkles className="h-4 w-4" />
          发给 AI Chat
        </button>
      ) : null}
    </div>
  );
  const renderKnowledgeTools = () => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void runBuildGraph()}
        disabled={loading || Boolean(graphActionRunning)}
        className="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-950 text-white transition rounded-full flex flex-row space-x-1 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        {graphActionRunning === 'build' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
        <span>重建图谱</span>
      </button>
      <button
        type="button"
        onClick={() => setKnowledgeSearchOpen(true)}
        className={`px-3.5 py-1.5 text-sm font-medium hover:bg-black/5 outline outline-1 outline-gray-100 rounded-3xl bg-white/95 shadow-sm backdrop-blur flex items-center gap-1.5 transition ${knowledgeSearchOpen || query.trim() ? 'bg-gray-50' : ''}`}
        aria-label="搜索"
      >
        <Search className="size-4" />
        <span>搜索</span>
      </button>
      {knowledgeSearchOpen ? (
        <div
          aria-modal="true"
          role="dialog"
          className="modal fixed top-0 right-0 left-0 bottom-0 bg-black/30 w-full h-screen max-h-[100dvh] p-3 flex justify-center z-[9999] overflow-y-auto overscroll-contain"
          style={{ scrollbarGutter: 'stable' }}
          onMouseDown={() => setKnowledgeSearchOpen(false)}
        >
          <div
            className="m-auto max-w-full w-[70rem] mx-2 shadow-2xl min-h-fit scrollbar-hidden bg-white/95 backdrop-blur-sm rounded-[2rem] border border-white"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="py-3 text-gray-700">
              <div className="px-4 pb-1.5">
                <div className="px-1 mb-1 flex justify-center space-x-2 relative z-10" id="search-container">
                  <div className="flex w-full rounded-xl" id="chat-search">
                    <div className="self-center py-2 rounded-l-xl bg-transparent">
                      <Search className="size-4" />
                    </div>
                    <input
                      autoFocus
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setKnowledgeSearchOpen(false);
                      }}
                      placeholder="搜索"
                      className="w-full rounded-r-xl py-1.5 pl-2.5 text-sm bg-transparent outline-none placeholder:text-gray-400"
                      maxLength={500}
                    />
                    {query.trim() ? (
                      <button type="button" onClick={() => setQuery('')} className="self-center p-0.5 rounded-full hover:bg-gray-100 transition" aria-label="清除搜索">
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex px-4 pb-1">
                <div className="flex flex-col overflow-y-auto h-96 md:h-[40rem] max-h-full scrollbar-hidden w-full flex-1 pr-2">
                  <div className="flex flex-wrap items-center gap-1 px-1 pb-2">
                    {kgSearchFacets.map((facet) => {
                      const count = facet === 'All' ? kgSearchResults.length : kgSearchResults.filter((result) => result.group === facet).length;
                      return (
                        <button
                          key={facet}
                          type="button"
                          onClick={() => setKgSearchFacet(facet)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                            kgSearchFacet === facet ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                          }`}
                        >
                          {facet === 'All' ? '全部' : facet}
                          {query.trim() ? <span className="ml-1 text-[11px] text-gray-400">{count}</span> : null}
                        </button>
                      );
                    })}
                  </div>

                  {!query.trim() ? (
                    <div className="pt-1">
                      <div className="w-full text-xs text-gray-500 font-medium pb-2 px-2">最近搜索</div>
                      {kgRecentSearches.length ? kgRecentSearches.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setQuery(item)}
                          className="w-full flex items-center rounded-xl text-sm py-2 px-3 hover:bg-gray-50 transition"
                        >
                          <History className="mr-2 size-4 text-gray-400" />
                          <span className="line-clamp-1 flex-1 text-left text-gray-700">{item}</span>
                        </button>
                      )) : (
                        <div className="flex h-full min-h-40 items-center justify-center text-center text-xs text-gray-500">
                          搜索概念、来源、标签、关系和误区。
                        </div>
                      )}
                    </div>
                  ) : null}

                  {query.trim() ? kgSearchFacets.filter((facet) => facet !== 'All').map((group) => {
                    const items = filteredSearchResults.filter((result) => result.group === group);
                    if (!items.length) return null;
                    return (
                      <div key={group} className="pt-1">
                        <div className="w-full text-xs text-gray-500 font-medium pb-2 px-2">{group}</div>
                        {items.map((result) => (
                          <button
                            key={result.id}
                            type="button"
                            onMouseEnter={() => setKgSearchPreviewId(result.id)}
                            onFocus={() => setKgSearchPreviewId(result.id)}
                            onClick={() => focusSearchResult(result)}
                            className={`w-full flex justify-between items-center rounded-xl text-sm py-2 px-3 text-left transition ${
                              previewSearchResult?.id === result.id ? 'bg-gray-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="line-clamp-1 w-full font-medium text-gray-700">{result.title}</div>
                              <div className="mt-0.5 line-clamp-1 text-xs text-gray-500">{result.subtitle || result.matchReason}</div>
                            </div>
                            <div className="pl-3 shrink-0 text-gray-400 text-xs">{Math.round(result.score)}</div>
                          </button>
                        ))}
                      </div>
                    );
                  }) : null}

                  {query.trim() && !filteredSearchResults.length ? (
                    <div className="flex h-full min-h-40 items-center justify-center text-center text-xs text-gray-500">
                      未找到知识
                    </div>
                  ) : null}
                </div>
                <div
                  id="chat-preview"
                  className="hidden md:flex md:flex-1 w-full overflow-y-auto h-96 md:h-[40rem] scrollbar-hidden border-l border-gray-50 pl-4"
                >
                  {previewSearchResult ? (
                    <div className="flex h-full w-full flex-col pt-4 pb-8">
                      <div className="text-xs font-medium text-gray-500">{previewSearchResult.group}</div>
                      <div className="mt-2 text-lg font-semibold leading-snug text-gray-800">{previewSearchResult.previewTitle}</div>
                      <div className="mt-2 text-sm leading-6 text-gray-600">{previewSearchResult.previewBody || previewSearchResult.explanation}</div>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {previewSearchResult.previewMeta.filter(Boolean).slice(0, 5).map((item) => (
                          <span key={item} className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-500">{item}</span>
                        ))}
                      </div>
                      <div className="mt-5">
                        <div className="text-xs font-medium text-gray-500">匹配原因</div>
                        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-600">
                          {previewSearchResult.matchReason}. {previewSearchResult.explanation}
                        </div>
                      </div>
                      {previewSearchResult.tags.length ? (
                        <div className="mt-5">
                          <div className="text-xs font-medium text-gray-500">标签</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {previewSearchResult.tags.slice(0, 12).map((tag) => (
                              <span key={tag} className="rounded-full border border-gray-100 px-2.5 py-1 text-xs text-gray-600">{tag}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {previewSearchResult.snippets.length ? (
                        <div className="mt-5">
                          <div className="text-xs font-medium text-gray-500">预览</div>
                          <div className="mt-2 space-y-2">
                            {previewSearchResult.snippets.map((snippet, index) => (
                              <div key={`${previewSearchResult.id}-snippet-${index}`} className="rounded-xl border border-gray-100 px-3 py-2 text-sm leading-6 text-gray-600">
                                {snippet}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="w-full h-full flex justify-center items-center text-gray-500 text-sm">
                      选择一个结果以预览
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
  const isKnowledgeOnly = hideSectionNav && section === 'knowledge';
  const renderKnowledgeViewSwitch = () => (
    <div className="grid grid-cols-3 rounded-lg bg-[#f1f1ef] p-1">
      {[
        { id: 'graph', label: '图谱视图', icon: Network },
        { id: 'list', label: '列表视图', icon: ListTree },
        { id: 'path', label: '路径视图', icon: MapIcon }
      ].map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setKnowledgeView(item.id as KnowledgeView)}
            className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition ${
              knowledgeView === item.id ? 'bg-white text-[#202124] shadow-sm' : 'text-[#666a70] hover:text-[#202124]'
            }`}
            title={item.label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label.replace(' View', '')}</span>
          </button>
        );
      })}
    </div>
  );
  const renderKnowledgeSidebarControls = () => (
    <div>
      {renderKnowledgeTools()}
    </div>
  );
  const renderOverview = () => (
    <section className="space-y-8">
      <div className="border-b border-[#e8e8e4] pb-6">
        <p className="text-sm font-medium text-[#777b80]">当前学习状态</p>
        <h2 className="mt-2 max-w-3xl text-2xl font-semibold text-[#202124]">
          {integration?.continueLearning?.nextStepTitle || '学习智能体正在等待更多上下文'}
        </h2>
        <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-6 text-[#55585d]">
          {integration?.learnerState?.summary || learnerState?.summary || '继续使用学习现场、资源和 AI Chat 后，这里会形成稳定摘要。'}
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
              { label: '学习画像', value: `${learnerProfileView?.overview?.stableCount ?? stableCount} 条画像，${learnerProfileView?.overview?.eventCount ?? displayRecentEvents.length} 条近期事件，${learnerProfileView?.overview?.memoryCount ?? displaySavedMemories.length} 条记忆`, target: 'memory' as IntelligenceSection }
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
    <section className={isKnowledgeOnly ? 'h-full min-h-0' : undefined}>
      {!isKnowledgeOnly && !isPlanningOnly && !isProfileOnly ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-[#202124]">知识</h2>
              <p className="mt-1 text-sm text-[#777b80]">知识点是稳定对象；图谱、列表和路径只是不同视图。</p>
            </div>
            <div className="w-full max-w-md sm:w-auto">{renderKnowledgeViewSwitch()}</div>
          </div>
        </>
      ) : null}
      {knowledgeView === 'graph' ? (
        <div className={`${isKnowledgeOnly ? 'h-full min-h-0' : 'h-[720px]'} overflow-hidden`}>
          <CosmosKnowledgeGraphWorkbench
            workspaceId={workspaceId}
            workbenchId={workbenchId}
            concepts={graph.nodes}
            edges={graph.edges}
            sources={graph.sources}
            pathIds={pathIds}
            searchTerm={query}
            focusConceptId={focusedGraphConceptId}
            variant="embedded"
            sidebarControls={renderKnowledgeSidebarControls()}
          />
        </div>
      ) : null}
      {knowledgeView === 'list' ? (
        <div className={isKnowledgeOnly ? 'h-full min-h-0 overflow-hidden bg-white' : undefined}>
        <div className={`${isKnowledgeOnly ? 'min-h-0 overflow-y-auto' : ''} border-y border-[#eeeeeb]`}>
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
        </div>
      ) : null}
      {knowledgeView === 'path' ? (
        <div className={isKnowledgeOnly ? 'h-full min-h-0 overflow-hidden bg-white' : undefined}>
        <div className={`${isKnowledgeOnly ? 'min-h-0 overflow-y-auto' : ''} border-y border-[#eeeeeb]`}>
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
  const renderPlanning = () => {
    const planningBusy = planningRunning || planningRunStatus === 'running' || planningRunStatus === 'starting';
    const plans = (mclPlans.length ? mclPlans : mclPlan ? [mclPlan] : [])
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime());
    const routeCanvasStages: RouteCanvasStage[] = structuredStages.map((stage, index) => {
      const stageId = structuredStageId(stage, index);
      const support = stageSupportById.get(stageId);
      return {
        id: stageId,
        order: stage.order || index + 1,
        title: cleanNarrative(stage.title || `阶段 ${index + 1}`),
        duration: stageDurationHint(stage),
        summary: markdownForStage(stage),
        supportText: supportSummaryText(support),
        status: stageStatusById.get(stageId),
        support
      };
    });

    return (
    <section className="text-left text-sm w-full mb-3">
      {planningView === 'plans' ? (
        <>
          <div className="flex flex-col gap-1 px-1 mt-1.5 mb-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center md:self-center text-xl font-medium px-0.5 gap-2 shrink-0">
                <div>规划</div>
                <div className="text-lg font-medium text-gray-500">{plans.length}</div>
              </div>
              <div className="flex w-full justify-end gap-1.5">
                <button
                  type="button"
                  onClick={openNewPlanModal}
                  disabled={planningBusy}
                  className="px-2 py-1.5 rounded-xl bg-black text-white transition font-medium text-sm flex items-center disabled:opacity-60"
                >
                  {planningBusy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" strokeWidth={2.5} />}
                  <div className="hidden md:block md:ml-1 text-xs">{planningBusy ? '生成中' : '新建计划'}</div>
                </button>
              </div>
            </div>
          </div>

          {plans.length ? (
            <div className="flex text-xs font-medium mb-1 items-center -mr-0.5">
              <button type="button" className="px-1.5 py-1 cursor-pointer select-none basis-3/5 text-left">
                <div className="flex gap-1.5 items-center">
                  标题
                  <span className="invisible"><ChevronDown className="size-2" /></span>
                </div>
              </button>
              <button type="button" className="px-1.5 py-1 cursor-pointer select-none hidden sm:flex sm:basis-2/5 justify-end">
                <div className="flex gap-1.5 items-center">
                  更新时间
                  <ChevronDown className="size-2" />
                </div>
              </button>
            </div>
          ) : null}

          {plans.length ? (
            plans.map((plan, idx) => {
              const meta = planDisplayMeta[plan.id] || fallbackPlanMeta(plan);
              const timeRange = getTimeRange(plan.updatedAt || plan.createdAt);
              const previousTimeRange = idx > 0 ? getTimeRange(plans[idx - 1].updatedAt || plans[idx - 1].createdAt) : null;
              return (
                <React.Fragment key={plan.id}>
                  {idx === 0 || timeRange !== previousTimeRange ? (
                    <div className={`w-full text-xs text-gray-500 font-medium ${idx === 0 ? '' : 'pt-5'} pb-2 px-2`}>
                      {timeRange}
                    </div>
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setMclPlan(plan);
                      setStageSelectionDismissed(false);
                      setSelectedStepId(safeArray<any>(plan.structuredPlan?.stages)[0]?.order ? `structured-${safeArray<any>(plan.structuredPlan?.stages)[0].order}` : null);
                      setPlanningView('steps');
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setMclPlan(plan);
                      setStageSelectionDismissed(false);
                      setSelectedStepId(safeArray<any>(plan.structuredPlan?.stages)[0]?.order ? `structured-${safeArray<any>(plan.structuredPlan?.stages)[0].order}` : null);
                      setPlanningView('steps');
                    }}
                    className="w-full flex justify-between items-center rounded-lg text-sm py-2 px-3 hover:bg-gray-50"
                  >
                    <div className="flex min-w-0 w-full sm:basis-3/5 items-center gap-2 text-left">
                      <span className="shrink-0 text-sm leading-none" aria-hidden="true">{meta.emoji}</span>
                      <div className="text-ellipsis line-clamp-1 min-w-0">{meta.title}</div>
                    </div>
                    <div className="hidden sm:flex sm:basis-2/5 items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                      <div className="text-gray-500 text-xs">
                        {formatCalendarDate(plan.updatedAt || plan.createdAt)}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPlanMenu({ planId: plan.id, rect: event.currentTarget.getBoundingClientRect() });
                          setPlanMenuSubmenu(null);
                        }}
                        className="self-center w-fit text-sm p-0.5 hover:bg-black/5 rounded-lg"
                        aria-label="计划选项"
                      >
                        <MoreHorizontal className="size-4" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          ) : !planningPlansReady ? (
            <div className="px-2 py-3">
              <div className="h-8 w-full animate-pulse rounded-lg bg-gray-50" />
              <div className="mt-2 h-8 w-5/6 animate-pulse rounded-lg bg-gray-50" />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col justify-center items-center my-16 mb-24">
              <div className="max-w-md text-center">
                <div className="text-3xl mb-3">🗺️</div>
                <div className="text-lg font-medium mb-1">未找到计划</div>
                <div className="text-gray-500 text-center text-xs">创建一个计划，开始聚焦学习路线。</div>
              </div>
              <button
                type="button"
                onClick={openNewPlanModal}
                disabled={planningBusy}
                className="mt-4 px-2 py-1.5 rounded-xl bg-black text-white transition font-medium text-sm flex items-center disabled:opacity-60"
              >
                {planningBusy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" strokeWidth={2.5} />}
                <span className="ml-1 text-xs">{planningBusy ? '生成中' : '新建计划'}</span>
              </button>
            </div>
          )}
        </>
      ) : null}
      {planMenu ? (() => {
        const plan = plans.find((item) => item.id === planMenu.planId);
        if (!plan || typeof document === 'undefined') return null;
        const menuWidth = 190;
        const submenuWidth = 270;
        const gap = 6;
        const top = Math.min(planMenu.rect.bottom + 4, window.innerHeight - 12);
        const left = Math.min(Math.max(16, planMenu.rect.right - menuWidth), window.innerWidth - menuWidth - 16);
        const submenuLeft = left + menuWidth + submenuWidth + gap > window.innerWidth - 16
          ? Math.max(16, left - submenuWidth - gap)
          : left + menuWidth + gap;
        const menuStyle: React.CSSProperties = {
          position: 'fixed',
          zIndex: 9999,
          top,
          left,
          animation: 'workspace-menu-enter 200ms cubic-bezier(0.33, 1, 0.68, 1) both'
        };
        const submenuStyle: React.CSSProperties = {
          position: 'fixed',
          zIndex: 10000,
          top,
          left: submenuLeft,
          animation: 'workspace-menu-enter 200ms cubic-bezier(0.33, 1, 0.68, 1) both'
        };
        const closePlanMenu = () => {
          setPlanMenu(null);
          setPlanMenuSubmenu(null);
        };
        return createPortal(
          <>
            <div
              className="min-w-[190px] rounded-2xl border border-gray-100 bg-white px-1 py-1 text-sm text-gray-900 shadow-lg font-primary"
              style={menuStyle}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setPlanMenuSubmenu((current) => current === 'apply' ? null : 'apply');
                }}
                onMouseEnter={() => setPlanMenuSubmenu('apply')}
                disabled={planActionBusyId === plan.id}
                className={`select-none flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 ${planMenuSubmenu === 'apply' ? 'bg-gray-50' : ''}`}
              >
                {planActionBusyId === plan.id ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}
                <div className="flex items-center">应用</div>
                <ChevronRight className="ml-auto size-4 text-gray-400" />
              </button>
              <button
                type="button"
                onClick={() => {
                  closePlanMenu();
                  void deletePlan(plan);
                }}
                disabled={planActionBusyId === plan.id}
                className="select-none flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
              >
                {planActionBusyId === plan.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                <div className="flex items-center">删除</div>
              </button>
            </div>
            {planMenuSubmenu === 'apply' ? (
              <div
                className="min-w-[270px] max-w-[270px] rounded-2xl border border-gray-100 bg-white px-1 py-1 text-sm text-gray-900 shadow-lg font-primary"
                style={submenuStyle}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseEnter={() => setPlanMenuSubmenu('apply')}
              >
                <button
                  type="button"
                  onClick={() => {
                    closePlanMenu();
                    void applyPlanToWorkbench(plan, null, true);
                  }}
                  disabled={planActionBusyId === plan.id}
                  className="select-none flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                >
                  {planActionBusyId === plan.id ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  <div className="min-w-0 flex-1 truncate">新的学习 workspace</div>
                </button>
                {workbenches.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      closePlanMenu();
                      void applyPlanToWorkbench(plan, item.id, false);
                    }}
                    disabled={planActionBusyId === plan.id}
                    className="select-none flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <NotebookTabs className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>,
          document.body
        );
      })() : null}
      {newPlanModalOpen && typeof document !== 'undefined' ? createPortal(
        <div
          aria-modal="true"
          role="dialog"
          className="fixed inset-0 z-[9999] flex h-screen max-h-[100dvh] w-full justify-center overflow-y-auto overscroll-contain bg-black/30 p-3"
          style={{ scrollbarGutter: 'stable', animation: 'add-sources-overlay-in 10ms ease-out both' }}
          onMouseDown={() => setNewPlanModalOpen(false)}
        >
          <div
            className="m-auto max-w-full w-[30rem] mx-2 min-h-fit rounded-[2rem] border border-white bg-white/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-sm font-primary"
            style={{ animation: 'workspace-soft-scale 100ms ease-out both' }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="text-lg font-medium self-center font-primary">新建计划</div>
            <div className="mt-4">
              <textarea
                value={planningDraftObjective}
                onChange={(event) => setPlanningDraftObjective(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submitNewPlan();
                  }
                }}
                autoFocus
                rows={4}
                placeholder="你想学习什么？"
                className="w-full resize-none rounded-2xl border border-gray-100 bg-white px-3 py-2 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-200"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewPlanModalOpen(false)}
                className="px-3.5 py-1.5 text-sm font-medium bg-white text-black hover:bg-gray-100 transition rounded-full"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitNewPlan}
                disabled={!planningDraftObjective.trim() || planningBusy}
                className="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white transition rounded-full flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {planningBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                创建
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      {planningView === 'steps' ? (
        structuredPlan && structuredStages.length ? (
          <div className="relative">
            <section className="bg-white">
              <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPlanningView('plans');
                      setStageSelectionDismissed(false);
                      setSelectedStepId(null);
                      setEditingStageId(null);
                      setStagePatchProposal(null);
                      setStageExplainResult('');
                      setRouteActionMode('idle');
                      setRouteActionInput('');
                    }}
                    className="rounded-md p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]"
                    aria-label="Back to plans"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <span className="shrink-0 text-lg leading-none" aria-hidden="true">{mclPlan?.id ? (planDisplayMeta[mclPlan.id]?.emoji || fallbackPlanMeta(mclPlan).emoji) : '🗺️'}</span>
                  <h3 className="min-w-0 truncate text-lg font-semibold text-[#202124]">{planDisplayTitle(mclPlan)}</h3>
                </div>
                <div className="relative z-30 flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRouteActionMode('explain');
                      setRouteActionInput('');
                    }}
                    disabled={planningInlineBusy === 'route_explain'}
                    className="inline-flex min-w-fit items-center gap-1 rounded-xl border border-gray-100 bg-white px-1.5 py-[1px] text-xs text-[#111214] shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {planningInlineBusy === 'route_explain' ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Lightbulb className="size-3 shrink-0" />}
                    <span>Explain</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRouteActionMode('modify');
                      setRouteActionInput('');
                    }}
                    disabled={stageGovernanceBusy === 'review'}
                    className="inline-flex min-w-fit items-center gap-1 rounded-xl border border-gray-100 bg-white px-1.5 py-[1px] text-xs text-[#111214] shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Tag className="size-3 shrink-0" />
                    <span>Modify</span>
                  </button>
                  {routeActionMode !== 'idle' ? (
                    <div className="absolute right-0 top-full mt-2 space-y-1 text-xs">
                      <div className="flex w-72 rounded-full border border-gray-100 bg-white py-1 shadow-xl">
                        <input
                          type="text"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          autoFocus
                          value={routeActionInput}
                          onChange={(event) => setRouteActionInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            if (routeActionMode === 'explain') void explainRouteInline(routeCanvasStages, routeActionInput.trim());
                            if (routeActionMode === 'modify') void requestPlanReview(routeActionInput.trim());
                          }}
                          placeholder={routeActionMode === 'explain' ? '提一个问题' : '告诉 AI 要修改什么'}
                          aria-label={routeActionMode === 'explain' ? '就这条路线提问' : '告诉 AI 如何修改这条路线'}
                          className="ml-5 w-full flex-1 appearance-none border-0 bg-transparent text-sm font-normal text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                        />
                        <div className="ml-1 mr-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (routeActionMode === 'explain') void explainRouteInline(routeCanvasStages, routeActionInput.trim());
                              if (routeActionMode === 'modify') void requestPlanReview(routeActionInput.trim());
                            }}
                            disabled={routeActionMode === 'explain' ? planningInlineBusy === 'route_explain' : stageGovernanceBusy === 'review'}
                            className={`${routeActionInput.trim() ? 'bg-black text-white hover:bg-gray-900' : 'bg-gray-200 text-white'} m-0.5 rounded-full p-1.5 transition disabled:opacity-60`}
                            aria-label={routeActionMode === 'explain' ? '提交问题' : '提交修改请求'}
                          >
                            {(routeActionMode === 'explain' && planningInlineBusy === 'route_explain') || (routeActionMode === 'modify' && stageGovernanceBusy === 'review') ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
                                <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setRouteActionMode('idle');
                            setRouteActionInput('');
                          }}
                          className="mr-1 self-center rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          aria-label="关闭路线聊天"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      {routeActionMode === 'explain' && (routeExplainMessages.length || routeExplainResult) ? (
                        <div className="w-72 rounded-2xl border border-gray-100 bg-white p-2 text-xs font-normal text-gray-700 shadow-xl">
                          <div className="mb-1 line-clamp-1 px-1 text-xs font-medium leading-5 text-gray-500">{planDisplayTitle(mclPlan)}</div>
                          <div className="max-h-[18rem] overflow-y-auto overscroll-contain pr-1 text-sm leading-6 [&>div>div]:gap-1 [&_li]:text-sm [&_li]:leading-6 [&_ol]:space-y-1 [&_p]:text-sm [&_p]:font-normal [&_p]:leading-6 [&_ul]:space-y-1">
                            {routeExplainMessages.slice(-4).map((message, index) => (
                              <div key={`${message.role}-${index}`} className={`mb-1 rounded-xl px-2 py-1.5 text-sm font-normal leading-6 ${message.role === 'user' ? 'ml-5 bg-gray-50 text-gray-700' : 'mr-5 bg-white text-gray-700'}`}>
                                {message.role === 'assistant' ? <MarkdownPreview content={message.content} variant="message" emptyMessage="" /> : message.content}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {routeActionMode === 'modify' && (routeModifyMessages.length || planReviewResult) ? (
                        <div className="w-72 rounded-2xl border border-gray-100 bg-white p-2 text-xs font-normal text-gray-700 shadow-xl">
                          <div className="mb-1 line-clamp-1 px-1 text-xs font-medium leading-5 text-gray-500">{planDisplayTitle(mclPlan)}</div>
                          {routeModifyMessages.length ? (
                            <div className="max-h-[12rem] overflow-y-auto pr-1 text-sm leading-6">
                              {routeModifyMessages.slice(-4).map((message, index) => (
                                <div key={`${message.role}-${index}`} className={`mb-1 rounded-xl px-2 py-1.5 text-sm font-normal leading-6 ${message.role === 'user' ? 'ml-5 bg-gray-50 text-gray-700' : 'mr-5 bg-white text-gray-700'}`}>
                                  {message.role === 'assistant' ? <MarkdownPreview content={message.content} variant="message" emptyMessage="" /> : message.content}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {planReviewResult?.suggestions.length ? (
                            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto border-t border-gray-100 pt-2">
                              {planReviewResult.suggestions.map((item, index) => {
                                const suggestionKey = planReviewSuggestionKey(item, index);
                                const applying = applyingPlanSuggestionKey === suggestionKey;
                                return (
                                  <div key={suggestionKey} className="rounded-xl bg-gray-50 px-2 py-1.5">
                                    <div className="line-clamp-1 text-sm font-medium text-gray-800">{item.stageTitle || item.stageId || `Suggestion ${index + 1}`}</div>
                                    <p className="mt-1 text-sm leading-5 text-gray-600">{item.recommendation || item.issue}</p>
                                    <div className="mt-2 flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => void applyPlanReviewSuggestion(item, suggestionKey)}
                                        disabled={Boolean(applyingPlanSuggestionKey) || stageGovernanceBusy === 'patch' || stageGovernanceBusy === 'apply_patch'}
                                        className="inline-flex h-7 items-center gap-1 rounded-full bg-[#202124] px-2.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-60"
                                      >
                                        {applying ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                                        应用
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="relative border-y border-[#e5e7eb]">
                <LearningRouteCanvas
                  stages={routeCanvasStages}
                  selectedStageId={selectedStructuredStageId}
                  onClearStage={closeStagePopover}
                  className="h-[calc(100vh-142px)]"
                  onSelectStage={(stageId) => {
                    setStageSelectionDismissed(false);
                    setSelectedStepId(stageId);
                    setStageActionMode('menu');
                    setStageActionInput('');
                    setEditingStageId(null);
                    setStagePatchProposal(null);
                    setStageExplainResult('');
                    setStageExplainMessages([]);
                    setStageModifyMessages([]);
                    setStageSourcesOpen(false);
                    setStageStatusMenuOpen(false);
                  }}
                  renderStagePanel={(stage, pinned) => {
                    const panelStructuredStageIndex = structuredStages.findIndex((item, index) => structuredStageId(item, index) === stage.id);
                    const panelStructuredStage = panelStructuredStageIndex >= 0 ? structuredStages[panelStructuredStageIndex] : null;
                    const panelStructuredStageId = panelStructuredStage
                      ? structuredStageId(panelStructuredStage, panelStructuredStageIndex)
                      : stage.id;
                    const panelSupport = stageSupportById.get(panelStructuredStageId) || stage.support;
                    const panelStatus = normalizePlanStepStatus(stageStatusById.get(panelStructuredStageId));
                    const pinnedToSelected = pinned && selectedStructuredStageId === panelStructuredStageId;
                    return panelStructuredStage ? (
                      <div className="w-[360px] text-xs text-[#4d5864]">
                        <div className="pr-6">
                          <div className="text-lg font-semibold leading-7 text-[#202124]">{stage.title}</div>
                          <div className="mt-2 text-sm leading-7 text-[#666a70]">
                            {markdownForStage(panelStructuredStage) || stageRouteNarrative(stage)}
                          </div>
                          <div className="mt-3 border-t border-gray-100 pt-3">
                            <div className="text-[11px] font-medium text-gray-400">依据</div>
                            <p className="mt-1 text-sm leading-6 text-gray-600">{supportSummaryText(panelSupport)}</p>
                            {panelSupport?.matchedConcepts.length ? (
                              <p className="mt-1 text-sm leading-6 text-gray-500">{panelSupport.matchedConcepts.slice(0, 4).join(' / ')}</p>
                            ) : null}
                          </div>
                        </div>
                        {pinnedToSelected ? (
                        <>
                        <div className="relative mt-3 flex w-fit flex-row items-center rounded-xl border border-gray-100 bg-white p-0.5 text-xs shadow-sm">
                          <button
                            type="button"
                            onClick={() => {
                              setStageActionMode('explain');
                              setStageActionInput('');
                              setEditingStageId(null);
                              setStageSourcesOpen(false);
                              setStageStatusMenuOpen(false);
                            }}
                            disabled={planningInlineBusy === 'stage_explain'}
                            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] text-[#111214] transition hover:bg-gray-50 disabled:opacity-50"
                          >
                            {planningInlineBusy === 'stage_explain' ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Lightbulb className="size-3 shrink-0" />}
                            <div className="shrink-0">解释</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStageActionMode('modify');
                              setStageActionInput('');
                              setEditingStageId(null);
                              setStageExplainResult('');
                              setStageSourcesOpen(false);
                              setStageStatusMenuOpen(false);
                            }}
                            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] text-[#111214] transition hover:bg-gray-50"
                          >
                            <Tag className="size-3 shrink-0" />
                            <div className="shrink-0">修改</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStageActionMode('sources');
                              setStageSourcesOpen(true);
                              setEditingStageId(null);
                              setStageExplainResult('');
                              setStageStatusMenuOpen(false);
                            }}
                            className="flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] text-[#111214] transition hover:bg-gray-50"
                          >
                            <FileText className="size-3 shrink-0" />
                            <div className="shrink-0">来源</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStageStatusMenuOpen((current) => !current);
                              setStageActionMode('menu');
                              setStageSourcesOpen(false);
                            }}
                            disabled={stageStatusBusy}
                            className={`flex min-w-fit items-center gap-1 rounded-xl px-1.5 py-[1px] transition hover:bg-gray-50 disabled:opacity-50 ${planStepStatusClass(panelStatus)}`}
                          >
                            {stageStatusBusy ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
                            <div className="shrink-0">{planStepStatusLabel(panelStatus)}</div>
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeStagePopover();
                            }}
                            className="flex min-w-fit items-center rounded-xl px-1.5 py-[1px] text-[#111214] transition hover:bg-gray-50"
                            aria-label="关闭阶段操作"
                          >
                            <X className="size-3 shrink-0" />
                          </button>
                          {stageStatusMenuOpen ? (
                            <div className="absolute left-full top-0 ml-2 w-28 rounded-xl border border-gray-100 bg-white p-1 shadow-xl">
                              {planStepStatusOptions.map((status) => {
                                const active = panelStatus === status;
                                return (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() => void updateSelectedStageStatus(status)}
                                    disabled={stageStatusBusy}
                                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs transition hover:bg-gray-50 disabled:opacity-50 ${active ? 'bg-gray-50' : ''}`}
                                  >
                                    <span className={`${active ? 'font-medium text-gray-900' : 'text-gray-700'}`}>{planStepStatusLabel(status)}</span>
                                    {active ? <CheckCircle2 className="size-3 text-gray-700" /> : null}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                        </>
                        ) : null}
                        {pinnedToSelected && editingStageId === panelStructuredStageId ? (
                          <div className="mt-3 w-[360px] rounded-lg border border-[#d8dde4] bg-white/94 p-3 shadow-sm backdrop-blur">
                            <input
                              value={stageDraftTitle}
                              onChange={(event) => setStageDraftTitle(event.target.value)}
                              className="h-8 w-full rounded-md border border-[#d8dde4] bg-white px-2 text-xs text-[#202124] outline-none focus:border-[#b9bab2]"
                            />
                            <textarea
                              value={stageDraftContent}
                              onChange={(event) => setStageDraftContent(event.target.value)}
                              rows={5}
                              className="w-full resize-y rounded-md border border-[#d8dde4] bg-white px-2 py-2 text-xs leading-5 text-[#202124] outline-none focus:border-[#b9bab2]"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveStageEdit('manual')}
                                disabled={stageGovernanceBusy === 'save'}
                                className="inline-flex h-8 items-center gap-1 rounded-md bg-[#202124] px-2 text-xs font-medium text-white disabled:opacity-60"
                              >
                                {stageGovernanceBusy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                保存
                              </button>
                              <button type="button" onClick={cancelStageEdit} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#f1f3f5] px-2 text-xs font-medium text-[#34373c] hover:bg-[#e9ecef]">
                                取消
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {pinnedToSelected && (stageActionMode === 'explain' || stageActionMode === 'modify') ? (
                          <div className="mt-2 space-y-1">
                            <div className="flex w-72 bg-white border border-gray-100 rounded-full py-1 shadow-xl">
                              <input
                                type="text"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                autoFocus
                                value={stageActionInput}
                                onChange={(event) => setStageActionInput(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') return;
                                  if (stageActionMode === 'explain') void explainStageInline(stageActionInput.trim());
                                  if (stageActionMode === 'modify') void requestStagePatch(panelStructuredStageId, stageActionInput.trim());
                                }}
                                placeholder={stageActionMode === 'explain' ? '提一个问题' : '告诉 AI 要修改什么'}
                                aria-label={stageActionMode === 'explain' ? '就这个阶段提问' : '告诉 AI 如何修改这个阶段'}
                                className="ml-5 w-full flex-1 appearance-none border-0 bg-transparent text-sm font-normal text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                              />
                              <div className="ml-1 mr-1">
                                <button
                                  type="button"
                                  aria-label={stageActionMode === 'explain' ? '提交问题' : '提交修改请求'}
                                  onClick={() => {
                                    if (stageActionMode === 'explain') void explainStageInline(stageActionInput.trim());
                                    if (stageActionMode === 'modify') void requestStagePatch(panelStructuredStageId, stageActionInput.trim());
                                  }}
                                  disabled={
                                    stageActionMode === 'explain'
                                      ? planningInlineBusy === 'stage_explain'
                                      : stageGovernanceBusy === 'patch'
                                  }
                                  className={`${stageActionInput.trim() !== '' ? 'bg-black text-white hover:bg-gray-900' : 'bg-gray-200 text-white'} m-0.5 rounded-full p-1.5 transition disabled:opacity-60`}
                                >
                                  {(stageActionMode === 'explain' && planningInlineBusy === 'stage_explain') || (stageActionMode === 'modify' && stageGovernanceBusy === 'patch') ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
                                      <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setStageActionMode('menu');
                                  setStageActionInput('');
                                }}
                                className="mr-1 self-center rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="关闭阶段聊天"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                            {stageActionMode === 'explain' && (stageExplainMessages.length || stageExplainResult) ? (
                              <div className="w-72 rounded-2xl border border-gray-100 bg-white p-2 text-xs font-normal text-gray-700 shadow-xl">
                                <div className="mb-1 line-clamp-1 px-1 text-xs font-medium leading-5 text-gray-500">{panelStructuredStage.title}</div>
                                <div className="max-h-[18rem] overflow-y-auto overscroll-contain pr-1 text-sm leading-6 [&>div>div]:gap-1 [&_li]:text-sm [&_li]:leading-6 [&_ol]:space-y-1 [&_p]:text-sm [&_p]:font-normal [&_p]:leading-6 [&_ul]:space-y-1">
                                  {stageExplainMessages.slice(-4).map((message, index) => (
                                    <div key={`${message.role}-${index}`} className={`mb-1 rounded-xl px-2 py-1.5 text-sm font-normal leading-6 ${message.role === 'user' ? 'ml-5 bg-gray-50 text-gray-700' : 'mr-5 bg-white text-gray-700'}`}>
                                      {message.role === 'assistant' ? <MarkdownPreview content={message.content} variant="message" emptyMessage="" /> : message.content}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {stageActionMode === 'modify' && stageModifyMessages.length ? (
                              <div className="w-72 rounded-2xl border border-gray-100 bg-white p-2 text-xs font-normal text-gray-700 shadow-xl">
                                <div className="mb-1 line-clamp-1 px-1 text-xs font-medium leading-5 text-gray-500">{panelStructuredStage.title}</div>
                                <div className="max-h-[14rem] overflow-y-auto pr-1 text-sm leading-6">
                                  {stageModifyMessages.slice(-4).map((message, index) => (
                                    <div key={`${message.role}-${index}`} className={`mb-1 rounded-xl px-2 py-1.5 text-sm font-normal leading-6 ${message.role === 'user' ? 'ml-5 bg-gray-50 text-gray-700' : 'mr-5 bg-white text-gray-700'}`}>
                                      {message.role === 'assistant' ? <MarkdownPreview content={message.content} variant="message" emptyMessage="" /> : message.content}
                                    </div>
                                  ))}
                                </div>
                                {stagePatchProposal ? (
                                  <div className="mt-2 border-t border-gray-100 pt-2">
                                    <div className="rounded-xl bg-gray-50 px-2 py-2">
                                      <p className="text-sm font-medium text-gray-800">{stagePatchProposal.summary}</p>
                                      {stagePatchProposal.rationale ? <p className="mt-1 text-sm leading-5 text-gray-600">{stagePatchProposal.rationale}</p> : null}
                                      <button
                                        type="button"
                                        onClick={() => void saveStageEdit('llm_patch', stagePatchProposal)}
                                        disabled={stageGovernanceBusy === 'apply_patch'}
                                        className="mt-2 inline-flex h-8 items-center gap-1 rounded-md bg-[#202124] px-2 text-xs font-medium text-white disabled:opacity-60"
                                      >
                                        {stageGovernanceBusy === 'apply_patch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                        应用
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {pinnedToSelected && stageActionMode === 'sources' && stageSourcesOpen ? (
                          <div className="mt-3 w-[360px] max-h-72 overflow-auto rounded-lg border border-[#d8dde4] bg-white/94 px-3 py-3 text-xs text-[#4d5864] shadow-sm backdrop-blur">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-[#202124]">来源</p>
                              <button
                                type="button"
                                onClick={() => {
                                  setStageActionMode('menu');
                                  setStageSourcesOpen(false);
                                }}
                                className="rounded-full p-1 text-[#666a70] hover:bg-[#f1f3f5]"
                                aria-label="关闭来源"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="mt-1 leading-5 text-[#666a70]">{supportSummaryText(panelSupport)}</p>
                            {panelSupport?.matchedConcepts.length ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {panelSupport.matchedConcepts.map((concept) => (
                                  <span key={concept} className="rounded-full bg-[#f1f3f5] px-2 py-0.5 text-[11px] text-[#34373c]">{concept}</span>
                                ))}
                              </div>
                            ) : null}
                            {panelSupport?.resources.length ? (
                              <div className="mt-3 space-y-2">
                                {panelSupport.resources.map((resource) => (
                                  <div key={resource.id} className="rounded-md border border-[#eeeeeb] bg-white px-2 py-2">
                                    <p className="font-medium text-[#202124]">{resource.unit || resource.title}</p>
                                    <p className="mt-1 text-[#96999d]">{resource.title}{resource.entryPoint ? ` · ${resource.entryPoint}` : ''}</p>
                                    <p className="mt-1 leading-5 text-[#666a70]">{resource.reason}</p>
                                  </div>
                                ))}
                              </div>
                            ) : panelSupport?.resourceGap ? (
                              <p className="mt-3 leading-5 text-[#666a70]">{panelSupport.resourceGap}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null;
                  }}
                />
              </div>
            </section>
            {false ? (
            <Accordion.Root
              type="single"
              collapsible
              value={selectedStepId || undefined}
              onValueChange={(value) => {
                setSelectedStepId(value || null);
                setEditingStageId(null);
                setStagePatchProposal(null);
              }}
              className="relative space-y-3"
            >
              <div className="absolute bottom-6 left-[29px] top-6 hidden w-px bg-[#e6e6e1] sm:block" />
              {structuredStages.map((stage, index) => {
                const stageId = structuredStageId(stage, index);
                const duration = stageDurationHint(stage);
                const support = stageSupportById.get(stageId);
                const isOpen = selectedStepId === stageId;
                return (
                  <Accordion.Item key={stageId} value={stageId} className="relative">
                    <Accordion.Header>
                      <Accordion.Trigger className={`group flex w-full items-start gap-3 rounded-lg border px-4 py-4 text-left transition ${isOpen ? 'border-[#d8d8d2] bg-white shadow-sm' : 'border-[#eeeeeb] bg-white hover:border-[#deded9] hover:bg-[#fbfbfa]'}`}>
                        <span className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-white ${isOpen ? 'bg-[#202124] text-white' : 'bg-[#f1f1ef] text-[#55585d]'}`}>
                          {stage.order || index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[#202124]">{stage.title}</span>
                            {duration ? <span className="text-xs font-medium text-[#96999d]">{duration}</span> : null}
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${groundingStatusTone(support?.status)}`}>
                              {groundingStatusLabel(support?.status)}
                            </span>
                          </span>
                          <span className="mt-2 block text-sm leading-6 text-[#55585d]">{clipText(markdownForStage(stage), 190)}</span>
                          <span className="mt-2 block text-xs leading-5 text-[#96999d]">{supportSummaryText(support)}</span>
                        </span>
                        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[#96999d] transition group-data-[state=open]:rotate-180`} />
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content className="overflow-hidden data-[state=closed]:animate-none data-[state=open]:animate-none">
                      <div className="ml-0 mt-2 rounded-lg border border-[#eeeeeb] bg-white px-4 py-4 sm:ml-10">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
                          <div className="min-w-0">
                            {editingStageId === stageId ? (
                              <div className="space-y-3">
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-[#777b80]">阶段标题</span>
                                  <input
                                    value={stageDraftTitle}
                                    onChange={(event) => setStageDraftTitle(event.target.value)}
                                    className="h-9 w-full rounded-md border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none focus:border-[#b9bab2]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-[#777b80]">阶段正文</span>
                                  <textarea
                                    value={stageDraftContent}
                                    onChange={(event) => setStageDraftContent(event.target.value)}
                                    rows={10}
                                    className="w-full resize-y rounded-md border border-[#deded9] bg-white px-3 py-2 text-sm leading-6 text-[#202124] outline-none focus:border-[#b9bab2]"
                                  />
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void saveStageEdit('manual')}
                                    disabled={stageGovernanceBusy === 'save'}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#202124] px-2.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-60"
                                  >
                                    {stageGovernanceBusy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelStageEdit}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#deded9] bg-white px-2.5 text-xs font-medium text-[#55585d] transition hover:bg-[#f7f7f5]"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <MarkdownPreview content={markdownForStage(stage)} variant="message" />
                            )}
                          </div>
                          <aside className="space-y-2">
                            <button
                              type="button"
                              onClick={() => onOpenTerminal?.(`Explain why this stage belongs in my learning route.\n\nStage ${stage.order || index + 1}: ${stage.title}\n\n${markdownForStage(stage)}\n\nGrounding: ${supportSummaryText(support)}`)}
                              disabled={!onOpenTerminal}
                              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-[#deded9] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f7f7f5] disabled:opacity-50"
                            >
                              <BookOpen className="h-4 w-4" />
                              Explain
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedStepId(stageId);
                                setEditingStageId(null);
                                void requestStagePatch(stageId);
                              }}
                              disabled={stageGovernanceBusy === 'patch'}
                              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
                            >
                              {stageGovernanceBusy === 'patch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                              Modify
                            </button>
                            <input
                              value={patchInstruction}
                              onChange={(event) => setPatchInstruction(event.target.value)}
                              placeholder="怎么改这一步？"
                              className="h-9 w-full rounded-md border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none focus:border-[#b9bab2]"
                            />
                          </aside>
                        </div>
                        {stagePatchProposal && selectedStructuredStageId === stageId ? (
                          <div className="mt-4 rounded-lg border border-[#deded9] bg-[#fbfbfa] px-3 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#202124]">{stagePatchProposal.summary}</p>
                                {stagePatchProposal.rationale ? <p className="mt-1 text-xs leading-5 text-[#777b80]">{stagePatchProposal.rationale}</p> : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => void saveStageEdit('llm_patch', stagePatchProposal)}
                                disabled={stageGovernanceBusy === 'apply_patch'}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#202124] px-2.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-60"
                              >
                                {stageGovernanceBusy === 'apply_patch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                应用
                              </button>
                            </div>
                            <div className="mt-3 rounded-md border border-[#eeeeeb] bg-white px-3 py-3">
                              <p className="text-sm font-medium text-[#202124]">{stagePatchProposal.title}</p>
                              <div className="mt-2 max-h-72 overflow-auto">
                                <MarkdownPreview content={stagePatchProposal.content} variant="message" />
                              </div>
                            </div>
                            {safeArray<string>(stagePatchProposal.risks).length ? (
                              <p className="mt-2 text-xs leading-5 text-[#96999d]">注意：{safeArray<string>(stagePatchProposal.risks).join('；')}</p>
                            ) : null}
                          </div>
                        ) : null}
                        <details className="mt-4 rounded-lg border border-[#eeeeeb] bg-[#fbfbfa] px-3 py-3">
                          <summary className="cursor-pointer text-sm font-medium text-[#34373c]">
                            依据 · {supportSummaryText(support)}
                          </summary>
                          <div className="mt-3 space-y-3">
                            {support?.matchedConcepts.length ? (
                              <div className="flex flex-wrap gap-1.5">
                                {support.matchedConcepts.map((concept) => (
                                  <span key={concept} className="rounded-full bg-[#eef7f0] px-2 py-0.5 text-[11px] font-medium text-[#2f6f46] ring-1 ring-[#cfe8d4]">
                                    {concept}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {support?.prerequisiteNotes.length ? (
                              <div className="rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-3">
                                <p className="text-xs font-medium text-[#b54708]">前置提醒</p>
                                <ul className="mt-2 space-y-1 text-sm leading-6 text-[#7a3d00]">
                                  {support.prerequisiteNotes.map((note) => <li key={note}>{note}</li>)}
                                </ul>
                              </div>
                            ) : null}
                            {support?.resources.length ? (
                              <div className="space-y-3">
                                {support.resources.map((resource) => (
                                  <div key={resource.id} className="rounded-lg border border-[#eeeeeb] bg-white px-3 py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-[#202124]">{resource.unit || resource.title}</p>
                                        <p className="mt-1 text-xs text-[#96999d]">
                                          {resource.title}{resource.entryPoint ? ` · ${resource.entryPoint}` : ''}
                                        </p>
                                      </div>
                                      {typeof resource.matchScore === 'number' ? (
                                        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[#777b80] ring-1 ring-[#e5e5df]">
                                          {formatMatchScore(resource.matchScore)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-[#55585d]">{resource.reason}</p>
                                  </div>
                                ))}
                              </div>
                            ) : support?.resourceGap ? (
                              <div className="rounded-lg border border-dashed border-[#e5e5df] bg-white px-3 py-3">
                                <p className="text-sm leading-6 text-[#55585d]">{support.resourceGap}</p>
                              </div>
                            ) : null}
                            {support?.missingConcepts.length ? (
                              <p className="text-xs leading-5 text-[#96999d]">
                                知识点缺口：{support.missingConcepts.join('、')}
                              </p>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                );
              })}
            </Accordion.Root>
            ) : null}
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
  };
  const renderProfileSignalRows = (items: ProfileDisplaySignal[]) => (
    <div className="border-y border-[#eeeeeb]">
      {items.map((item) => (
        <RowButton key={item.id}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-6 text-[#202124]">{item.value}</p>
            <p className="mt-1 text-xs text-[#96999d]">
              {item.label}
              {typeof item.confidence === 'number' ? ` · confidence ${score(item.confidence)}` : ''}
              {safeArray(item.evidenceIds).length ? ` · evidence ${safeArray(item.evidenceIds).length}` : ''}
              {item.status ? ` · ${item.status}` : ''}
            </p>
          </div>
        </RowButton>
      ))}
    </div>
  );
  const renderProfileGroups = (groups: ReturnType<typeof groupProfileSignals>, empty: { title: string; detail: string }) => (
    groups.length ? (
      <div className="space-y-5">
        {groups.map((group) => {
          const Icon = profileDimensionIcon(group.dimension);
          return (
            <div key={group.dimension}>
              <div className="mb-2 flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 text-[#8a8e94]" />
                <div>
                  <h4 className="text-sm font-semibold text-[#202124]">{group.meta.title}</h4>
                  <p className="mt-0.5 text-xs leading-5 text-[#777b80]">{group.meta.detail}</p>
                </div>
              </div>
              {renderProfileSignalRows(group.items)}
            </div>
          );
        })}
      </div>
    ) : <EmptyState title={empty.title} detail={empty.detail} />
  );
  const renderProfileVisualMap = () => {
    if (!profileVisualNodes.length) {
      return <EmptyState title="暂无可视化画像" detail="稳定画像、近期状态或记忆出现后，这里会自动生成一张总览图。" />;
    }
    const nodes = profileVisualNodes.slice(0, 9);
    const dimensionData = nodes.map((node) => ({
      ...node,
      shortTitle: truncateLabel(node.title.replace(/\s*\/\s*/g, '/'), 7),
      fill: profileChartFill(node.dimension)
    }));
    const trendBuckets = new Map<string, { date: string; events: number; memory: number; profile: number }>();
    const touchBucket = (value?: string | null) => {
      const time = new Date(value || '').getTime();
      if (!Number.isFinite(time)) return null;
      const date = new Date(time).toISOString().slice(0, 10);
      if (!trendBuckets.has(date)) trendBuckets.set(date, { date, events: 0, memory: 0, profile: 0 });
      return trendBuckets.get(date)!;
    };
    displayRecentEvents.forEach((event) => {
      const bucket = touchBucket(event.observedAt);
      if (bucket) bucket.events += 1;
    });
    safeArray<any>(savedMemoryRecords).forEach((memory) => {
      const bucket = touchBucket(memory.updatedAt || memory.createdAt || memory.lastObservedAt);
      if (bucket && memory?.status !== 'deleted' && memory?.status !== 'suppressed') bucket.memory += 1;
    });
    nodes.flatMap((node) => node.entities || []).forEach((entity) => {
      const bucket = touchBucket(entity.updatedAt || entity.evidence?.[0]?.observedAt);
      if (bucket) bucket.profile += 1;
    });
    const allTrendData = Array.from(trendBuckets.values())
      .sort((left, right) => left.date.localeCompare(right.date));
    const rangeDays = profileTimelineRange === '7d' ? 7 : profileTimelineRange === '30d' ? 30 : profileTimelineRange === '1y' ? 365 : null;
    const rangeStart = rangeDays ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null;
    const trendData = rangeStart
      ? allTrendData.filter((item) => {
          const time = new Date(`${item.date}T00:00:00`).getTime();
          return Number.isFinite(time) && time >= rangeStart;
        })
      : allTrendData;
    const chartTooltip = ({ active, payload, label }: any) => {
      if (!active || !payload?.length) return null;
      return (
        <div className="rounded-lg border border-[#e6e6e1] bg-white px-3 py-2 text-xs shadow-[0_12px_28px_rgba(32,33,36,0.10)]">
          <p className="mb-1 font-medium text-[#202124]">{profileTrendBucketLabel(String(label || payload[0]?.payload?.title || ''))}</p>
          {payload.map((entry: any) => (
            <p key={entry.dataKey || entry.name} className="flex items-center gap-2 text-[#666a70]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || entry.payload?.fill || '#777b80' }} />
              <span>{entry.name || entry.dataKey}: {entry.value}</span>
            </p>
          ))}
        </div>
      );
    };
    type ProfileLedgerEntry = {
      id: string;
      kind: 'profile' | 'event' | 'memory';
      title: string;
      summary: string;
      dimension?: string;
      categoryLabel: string;
      filterKey: string;
      sourceLabel: string;
      commandLabel: string;
      time?: string | null;
      confidence?: number | null;
      evidence?: NonNullable<LearnerPortraitEntity['evidence']>;
      savedMemory?: any;
      actionTarget?: any;
      event?: any;
    };
    const learnerControlRecords = safeArray<any>(learnerMemoryControls).length
      ? safeArray<any>(learnerMemoryControls)
      : safeArray<any>(learnerMemories).filter((memory) => memory?.source === 'learner_memory_control' || String(memory?.signalType || '').startsWith('user_control.'));
    const activeProfileControls = learnerControlRecords
      .filter((control) => control?.status === 'active' && portraitDimensionOrder.includes(String(control.dimension) as PortraitDimension));
    const deletedProfileKeys = new Set([
      ...Array.from(profileControlledKeys),
      ...activeProfileControls
        .filter((control) => control.action === 'delete')
        .map((control) => String(control.memoryKey || control.key || ''))
    ].filter(Boolean));
    const persistedCorrectionByKey = new Map(
      activeProfileControls
        .filter((control) => control.action === 'correct' && String(control.correctedText || control.value || '').trim())
        .map((control) => [String(control.memoryKey || control.key || ''), String(control.correctedText || control.value || '').trim()])
    );
    const manualProfileItemsByKey = new Map<string, { key: string; dimension: string; value: string; updatedAt: string }>();
    activeProfileControls
      .filter((control) => control.action === 'correct' && String(control.correctedText || control.value || '').trim())
      .forEach((control) => {
        const key = String(control.memoryKey || control.key || '');
        if (!key) return;
        manualProfileItemsByKey.set(key, {
          key,
          dimension: String(control.dimension || 'learningPreference'),
          value: String(control.correctedText || control.value || '').trim(),
          updatedAt: String(control.updatedAt || control.createdAt || '')
        });
      });
    profileManualItems.forEach((item, key) => manualProfileItemsByKey.set(key, item));
    const extractedPortraitEntries: ProfileLedgerEntry[] = nodes.flatMap((node) =>
      safeArray<LearnerPortraitEntity>(node.entities).flatMap((entity) => {
        const title = entity.displayTitle || entity.title || portraitDimensionMeta[entity.dimension]?.title || node.title;
        const memoryKey = profileControlKey(entity.dimension, title);
        if (deletedProfileKeys.has(memoryKey)) return [];
        const correctedTitle = profileControlledCorrections.get(memoryKey) || persistedCorrectionByKey.get(memoryKey);
        const displayTitle = correctedTitle || title;
        const evidence = safeArray<NonNullable<LearnerPortraitEntity['evidence']>[number]>(entity.evidence);
        const hasMemoryEvidence = evidence.some((item) => item.sourceType === 'saved_memory');
        const summary = entity.displayDescription || entity.description || entity.displayRecommendation || 'Learner profile item';
        const sourceLabel = hasMemoryEvidence ? '来自记忆' : entity.status === 'stable' ? '稳定画像' : '画像构建器';
        const actionTarget = {
          key: memoryKey,
          memoryKey,
          dimension: entity.dimension,
          value: displayTitle,
          originalValue: title,
          status: deletedProfileKeys.has(memoryKey) ? 'deleted' : 'active',
          evidence,
          summary,
          sourceLabel
        };
        profileActionTargetsRef.current.set(memoryKey, actionTarget);
        return {
          id: `profile:${entity.id}`,
          kind: 'profile',
          title: displayTitle,
          summary,
          dimension: entity.dimension,
          categoryLabel: portraitDimensionMeta[entity.dimension]?.title || entity.dimension,
          filterKey: entity.dimension,
          sourceLabel,
          commandLabel: `/${portraitDimensionMeta[entity.dimension]?.title || entity.dimension}`,
          time: entity.updatedAt || evidence[0]?.observedAt || null,
          confidence: entity.confidence,
          evidence,
          actionTarget
        };
      })
    );
    const extractedPortraitKeys = new Set(extractedPortraitEntries.map((entry) => String(entry.actionTarget?.key || '')));
    const manualPortraitEntries: ProfileLedgerEntry[] = Array.from(manualProfileItemsByKey.values())
      .filter((item) => !deletedProfileKeys.has(item.key) && !extractedPortraitKeys.has(item.key))
      .map((item) => {
        const actionTarget = {
          key: item.key,
          memoryKey: item.key,
          dimension: item.dimension,
          value: item.value,
          originalValue: item.value,
          status: 'active'
        };
        profileActionTargetsRef.current.set(item.key, actionTarget);
        return {
          id: `profile:manual:${item.key}`,
          kind: 'profile',
          title: item.value,
          summary: 'User-governed learner profile item',
          dimension: item.dimension,
          categoryLabel: portraitDimensionMeta[item.dimension as PortraitDimension]?.title || item.dimension,
          filterKey: item.dimension,
          sourceLabel: 'By You',
          commandLabel: `/${portraitDimensionMeta[item.dimension as PortraitDimension]?.title || item.dimension}`,
          time: item.updatedAt,
          confidence: 1,
          actionTarget
        };
      });
    const portraitEntries = [...manualPortraitEntries, ...extractedPortraitEntries];
    const memoryEntries: ProfileLedgerEntry[] = safeArray<any>(savedMemoryRecords)
      .filter((memory) => memory?.status !== 'deleted' && memory?.status !== 'suppressed')
      .map((memory) => {
        const title = String(memory.text || memory.value || memory.content || 'Saved memory');
        return {
          id: `memory:${String(memory.memoryKey || memory.key || memory.id || title)}`,
          kind: 'memory',
          title,
          summary: 'User-managed long-term learner memory',
          dimension: String(memory.category || memory.dimension || 'savedMemory'),
          categoryLabel: '长期记忆',
          filterKey: 'memory',
          sourceLabel: memory.source === 'manual_user_entry' ? '由你添加' : '已保存记忆',
          commandLabel: `/${String(memory.category || memory.dimension || 'memory')}`,
          time: memory.updatedAt || memory.createdAt || memory.lastObservedAt || null,
          confidence: typeof memory.confidence === 'number' ? memory.confidence : null,
          savedMemory: memory
        };
      });
    const eventEntries: ProfileLedgerEntry[] = displayRecentEvents.map((event: any) => ({
      id: `event:${String(event.id || `${event.eventType}:${event.observedAt}`)}`,
      kind: 'event',
      title: String(event.eventType || event.label || 'Learning event'),
      summary: String(event.summary || 'Recent evidence trail'),
      dimension: 'recentEvent',
      categoryLabel: '近期事件',
      filterKey: 'event',
      sourceLabel: 'Recent Event',
      commandLabel: '/近期事件',
      time: event.observedAt || null,
      confidence: typeof event.confidence === 'number' ? event.confidence : null,
      event,
      actionTarget: {
        key: `event:${String(event.id || `${event.eventType}:${event.observedAt}`)}`,
        eventId: String(event.id || ''),
        kind: 'event',
        eventType: String(event.eventType || 'manual.profile_event'),
        value: String(event.summary || event.payload?.summary || event.eventType || 'Learning event')
      }
    }));
    eventEntries.forEach((entry) => entry.actionTarget?.key ? profileActionTargetsRef.current.set(entry.actionTarget.key, entry.actionTarget) : undefined);
    const sortEntries = (entries: ProfileLedgerEntry[], sort: ProfilePanelSort) => {
      const sorted = [...entries].sort((left, right) => {
        const leftTime = new Date(left.time || '').getTime();
        const rightTime = new Date(right.time || '').getTime();
        if (sort === 'category') {
          const category = left.categoryLabel.localeCompare(right.categoryLabel, 'zh-CN');
          if (category !== 0) return category;
        }
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      });
      return sorted.slice(0, 24);
    };
    const groupEntries = (entries: ProfileLedgerEntry[], sort: ProfilePanelSort) => {
      const groups: Array<{ label: string; items: ProfileLedgerEntry[] }> = [];
      entries.forEach((entry) => {
        const label = sort === 'category' ? entry.categoryLabel : getTimeRange(entry.time);
        const group = groups.find((item) => item.label === label);
        if (group) group.items.push(entry);
        else groups.push({ label, items: [entry] });
      });
      return groups;
    };
    const applyEntryFilter = (entries: ProfileLedgerEntry[], filter: string) =>
      filter === 'all' ? entries : entries.filter((entry) => entry.filterKey === filter);
    const profileFilterOptions = [
      { value: 'all', label: '全部维度' },
      ...portraitDimensionOrder.map((dimension) => ({ value: dimension, label: portraitDimensionMeta[dimension]?.title || dimension }))
    ];
    const governanceFilterOptions = [
      { value: 'all', label: '全部记录' },
      { value: 'memory', label: '长期记忆' },
      { value: 'event', label: '近期事件' }
    ];
    const profileEntries = sortEntries(applyEntryFilter(portraitEntries, profileLedgerFilter), profileLedgerSort);
    const governanceEntries = sortEntries(applyEntryFilter([...memoryEntries, ...eventEntries], memoryGovernanceFilter), memoryGovernanceSort);
    const profileGroups = groupEntries(profileEntries, profileLedgerSort);
    const governanceGroups = groupEntries(governanceEntries, memoryGovernanceSort);
    const renderSortControl = (active: boolean) => (
      <ChevronDown className={`size-2 transition ${active ? 'opacity-100' : 'opacity-0'}`} strokeWidth={2.5} />
    );
    const renderMiniRow = (entry: ProfileLedgerEntry) => {
      const savedMemory = entry.savedMemory;
      const memoryKey = String(savedMemory?.memoryKey || savedMemory?.key || entry.actionTarget?.memoryKey || entry.actionTarget?.key || '');
      if (entry.actionTarget && memoryKey) profileActionTargetsRef.current.set(memoryKey, entry.actionTarget);
      const menuKey = memoryKey || entry.actionTarget?.key || '';
      return (
        <div key={entry.id} className="group grid w-full grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_112px_108px_32px]">
          <div className="line-clamp-1 min-w-0 text-ellipsis text-left">
            {entry.title || '未命名画像条目'}
          </div>
          <div className="hidden min-w-0 items-center justify-start sm:flex">
            <span className="truncate text-xs text-gray-500">{entry.categoryLabel}</span>
          </div>
          <div className="hidden items-center justify-end sm:flex">
            <span className="text-xs text-gray-500">{formatCalendarDate(entry.time) || '未知'}</span>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (menuKey) setProfileMemoryMenu({ key: menuKey, rect: event.currentTarget.getBoundingClientRect() });
            }}
            disabled={!menuKey}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-500 opacity-0 transition hover:bg-gray-100 disabled:opacity-0 group-hover:opacity-100"
            aria-label="更多画像操作"
          >
            <MoreHorizontal className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      );
    };
    const renderMiniPanel = (
      title: string,
      sort: ProfilePanelSort,
      setSort: React.Dispatch<React.SetStateAction<ProfilePanelSort>>,
      filter: string,
      setFilter: React.Dispatch<React.SetStateAction<string>>,
      filterOptions: Array<{ value: string; label: string }>,
      groups: Array<{ label: string; items: ProfileLedgerEntry[] }>,
      empty: string,
      action?: React.ReactNode
    ) => {
      const selectedFilter = filterOptions.find((item) => item.value === filter);
      const emptyState = title === '画像台账'
        ? filter === 'all'
          ? {
              emoji: '🫧',
              title: '未找到画像条目',
              description: '当有足够证据后，学习者画像信号会显示在这里。'
            }
          : {
              emoji: ['🌱', '🧭', '🔎', '🪄', '🧩'][Math.max(0, filterOptions.findIndex((item) => item.value === filter) - 1) % 5],
              title: `未找到${selectedFilter?.label || '画像'}内容`,
              description: '可以尝试其他维度，或手动添加画像条目。'
            }
        : filter === 'memory'
          ? {
              emoji: '🧠',
              title: '未找到记忆',
              description: '添加或确认长期记忆后，它们会显示在这里。'
            }
          : filter === 'event'
            ? {
                emoji: '🕰️',
                title: '未找到近期事件',
                description: 'workspace 活动被记录后，近期学习证据会显示在这里。'
              }
            : {
                emoji: '🗂️',
                title: '未找到治理记录',
                description: '可用的记忆和近期学习事件会显示在这里。'
              };
      return (
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-base font-semibold text-[#202124]">{title}</h3>
            {action}
          </div>
          <div className="mb-2 flex min-w-0 items-center gap-1 overflow-x-auto px-1">
            {filterOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ${filter === item.value ? 'bg-[#202124] text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {!groups.length ? (
            <div className="mb-1 hidden grid-cols-[minmax(0,1fr)_112px_108px_32px] items-center gap-2 px-3 text-xs font-medium text-gray-900 sm:grid">
              <button type="button" onClick={() => setSort('updated')} className="col-start-3 flex cursor-pointer select-none justify-end py-1 text-right">
                <span className="flex items-center gap-1.5">
                  更新时间
                  {renderSortControl(sort === 'updated')}
                </span>
              </button>
            </div>
          ) : null}
          {groups.length ? (
            <div className="mb-3 w-full text-left text-sm">
              {groups.map((group, groupIndex) => (
                <div key={group.label}>
                  <div className={`grid w-full grid-cols-[minmax(0,1fr)_32px] items-center gap-2 px-3 pb-2 text-xs font-medium sm:grid-cols-[minmax(0,1fr)_112px_108px_32px] ${groupIndex === 0 ? '' : 'pt-5'}`}>
                    <span className="text-left text-gray-500">{group.label}</span>
                    {groupIndex === 0 ? (
                      <button type="button" onClick={() => setSort('updated')} className="col-start-3 hidden cursor-pointer select-none justify-end py-1 text-right text-gray-900 sm:flex">
                        <span className="flex items-center gap-1.5">
                          更新时间
                          {renderSortControl(sort === 'updated')}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {group.items.map((entry) => renderMiniRow(entry))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
              <div className="mb-3 text-4xl leading-none">{emptyState.emoji}</div>
              <p className="text-xl font-semibold tracking-normal text-gray-900">{emptyState.title || empty}</p>
              <p className="mt-1.5 max-w-md text-sm leading-6 text-gray-500">{emptyState.description}</p>
            </div>
          )}
        </section>
      );
    };
    return (
      <div className="min-w-0 space-y-7 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-3 flex items-center justify-center gap-2 text-sm font-medium text-[#34373c]">
            <Activity className="h-4 w-4 text-[#8a8e94]" />
            <span>学习者时间线</span>
          </div>
          <div className="h-[210px]">
            {allTrendData.length ? (
              trendData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  {profileTimelineChartMode === 'line' ? (
                    <LineChart data={trendData} margin={{ top: 12, right: 12, left: -22, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#eeeeeb" />
                      <XAxis dataKey="date" tickFormatter={profileTrendBucketLabel} tickLine={false} axisLine={false} tick={{ fill: '#777b80', fontSize: 11 }} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#96999d', fontSize: 11 }} />
                      <Tooltip content={chartTooltip} />
                      <Line type="monotone" dataKey="profile" name="画像" stroke="#48a06a" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="memory" name="长期记忆" stroke="#a98267" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="events" name="近期事件" stroke="#5b9ad6" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  ) : (
                    <BarChart data={trendData} margin={{ top: 12, right: 12, left: -22, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#eeeeeb" />
                      <XAxis dataKey="date" tickFormatter={profileTrendBucketLabel} tickLine={false} axisLine={false} tick={{ fill: '#777b80', fontSize: 11 }} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#96999d', fontSize: 11 }} />
                      <Tooltip cursor={{ fill: '#f6f6f4' }} content={chartTooltip} />
                      <Bar dataKey="profile" name="画像" stackId="timeline" fill="#48a06a" radius={[5, 5, 0, 0]} />
                      <Bar dataKey="memory" name="长期记忆" stackId="timeline" fill="#a98267" radius={[5, 5, 0, 0]} />
                      <Bar dataKey="events" name="近期事件" stackId="timeline" fill="#5b9ad6" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-medium text-gray-400">这个范围内暂无时间线数据。</div>
              )
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dimensionData} margin={{ top: 12, right: 12, left: -22, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#eeeeeb" />
                  <XAxis dataKey="shortTitle" tickLine={false} axisLine={false} tick={{ fill: '#777b80', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#96999d', fontSize: 11 }} />
                  <Tooltip cursor={{ fill: '#f6f6f4' }} content={chartTooltip} />
                  <Bar dataKey="count" name="记录" radius={[5, 5, 2, 2]}>
                    {dimensionData.map((entry) => <Cell key={entry.dimension} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          {allTrendData.length ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-500">
                  {[
                    { id: 'line' as ProfileTimelineChartMode, label: '折线' },
                    { id: 'bar' as ProfileTimelineChartMode, label: '柱状' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setProfileTimelineChartMode(item.id)}
                      className={`rounded-full px-2.5 py-1 transition ${profileTimelineChartMode === item.id ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-700'}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="inline-flex rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-500">
                  {[
                    { id: '7d' as ProfileTimelineRange, label: '7D' },
                    { id: '30d' as ProfileTimelineRange, label: '30D' },
                    { id: '1y' as ProfileTimelineRange, label: '1Y' },
                    { id: 'all' as ProfileTimelineRange, label: '全部' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setProfileTimelineRange(item.id)}
                      className={`rounded-full px-2.5 py-1 transition ${profileTimelineRange === item.id ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-700'}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-between gap-1 text-xs font-medium text-gray-400 sm:flex-row sm:items-start">
                <p>时间线反映已提取的画像信号、保存的记忆和近期证据。</p>
                <p className="sm:text-right">学习者画像信号变化时会更新。</p>
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-8 lg:grid-cols-2">
          {renderMiniPanel(
            '画像台账',
            profileLedgerSort,
            setProfileLedgerSort,
            profileLedgerFilter,
            setProfileLedgerFilter,
            profileFilterOptions,
            profileGroups,
            '未找到画像条目',
            <button
              type="button"
              onClick={openNewProfileItemEditor}
              className="flex size-8 items-center justify-center rounded-full text-gray-700 transition hover:bg-gray-100"
              aria-label="添加画像条目"
            >
              <Plus className="size-4" strokeWidth={2.25} />
            </button>
          )}
          {renderMiniPanel(
            '记忆治理',
            memoryGovernanceSort,
            setMemoryGovernanceSort,
            memoryGovernanceFilter,
            setMemoryGovernanceFilter,
            governanceFilterOptions,
            governanceGroups,
            '未找到治理条目',
            <button
              type="button"
              onClick={openNewGovernanceItemEditor}
              className="flex size-8 items-center justify-center rounded-full text-gray-700 transition hover:bg-gray-100"
              aria-label="添加治理条目"
            >
              <Plus className="size-4" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    );
  };
  const renderMemoryHome = () => (
    <section className="space-y-6">
      <div className="flex flex-col gap-1 px-1 mt-1.5 mb-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center md:self-center text-xl font-medium px-0.5 gap-2 shrink-0">
            <div>学习画像</div>
          </div>
        </div>
      </div>
      {renderProfileVisualMap()}
    </section>
  );
  const renderProfileMemoryRows = (items: ProfileDisplaySignal[]) => (
    <div className="space-y-1">
      {items.map((item) => {
        const savedMemory = savedMemoryBySignalId.get(String(item.id)) || savedMemoryBySignalId.get(String((item as any).memoryKey || (item as any).key || ''));
        const memoryKey = String(savedMemory?.memoryKey || savedMemory?.key || '');
        return (
          <div key={item.id} className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-gray-50">
            <button type="button" onClick={() => openProfileMemoryEditor(savedMemory, item)} className="min-w-0 flex-1 text-left">
              <div className="flex min-w-0 items-baseline gap-2">
                <p className="truncate text-[15px] font-semibold leading-6 text-[#3f3f46]">{item.value}</p>
                <p className="shrink-0 text-sm font-medium text-[#9a9a9d]">/{savedMemory?.category || item.label || 'profile'}</p>
              </div>
              <p className="mt-0.5 truncate text-sm leading-5 text-[#55585d]">
                <span className="font-medium text-[#8a8e94]">{savedMemory?.source === 'manual_user_entry' ? '由你添加' : '来自记忆'}</span>
                <span className="px-1 text-[#a7a7aa]">·</span>
                {item.confidence != null ? `confidence ${score(item.confidence)}` : 'User managed learner profile'}
              </p>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (savedMemory) setProfileMemoryMenu({ key: memoryKey, rect: event.currentTarget.getBoundingClientRect() });
              }}
              disabled={!savedMemory}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#55585d] opacity-0 transition hover:bg-gray-100 disabled:opacity-20 group-hover:opacity-100"
              aria-label="More memory actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      {!items.length ? <EmptyState title="暂无记忆" detail="当用户明确保存偏好或背景时，这里会出现。" /> : null}
    </div>
  );
  const renderProfileDetail = () => {
    if (!profileEntryKind) return renderMemoryHome();
    if (profileEntryKind === 'events') {
      return (
        <section className="space-y-6">
          <div className="flex items-start justify-between gap-3 border-b border-[#e8e8e4] pb-5">
            <div>
              <h2 className="text-xl font-semibold text-[#202124]">近期事件</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#777b80]">展示近期状态、短期观察和事件证据，不把它们当成长期画像。</p>
            </div>
            <button type="button" onClick={() => setProfileEntryKind(null)} className="rounded-lg px-3 py-2 text-sm text-[#34373c] hover:bg-[#f1f1ef]">返回</button>
          </div>
          <section>
            <div className="mb-3">
              <h3 className="text-base font-semibold text-[#202124]">Observation / Working State</h3>
              <p className="mt-1 text-sm leading-6 text-[#777b80]">经 LLM 归并后的近期状态，默认不作为长期事实。</p>
            </div>
            {renderProfileGroups(displayWorkingGroups, {
              title: '暂无近期状态',
              detail: '近期聊天、资源和行为会形成工作状态。'
            })}
          </section>
          <section>
            <div className="mb-3">
              <h3 className="text-base font-semibold text-[#202124]">近期证据链</h3>
              <p className="mt-1 text-sm leading-6 text-[#777b80]">可审计的近期行为和对话证据。</p>
            </div>
            <div className="border-y border-[#eeeeeb]">
              {displayRecentEvents.map((event: any) => (
                <RowButton key={event.id}>
                  <Activity className="h-4 w-4 text-[#8a8e94]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#202124]">{event.eventType || event.label || 'Learning event'}</p>
                    <p className="mt-1 truncate text-xs text-[#96999d]">
                      {event.summary || 'Event evidence'}{event.confidence != null ? ` · confidence ${score(event.confidence)}` : ''}{event.observedAt ? ` · ${formatShortDate(event.observedAt)}` : ''}
                    </p>
                  </div>
                </RowButton>
              ))}
              {!displayRecentEvents.length ? <EmptyState title="暂无近期事件" detail="这里会显示学习行为、对话和测验证据。" /> : null}
            </div>
          </section>
        </section>
      );
    }
    if (profileEntryKind === 'memory') {
      return (
        <section className="space-y-6">
          <div className="flex items-start justify-between gap-3 border-b border-[#e8e8e4] pb-5">
            <div>
              <h2 className="text-xl font-semibold text-[#202124]">记忆</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#777b80]">已保存记忆和长期可控偏好。</p>
            </div>
            <button type="button" onClick={() => setProfileEntryKind(null)} className="rounded-lg px-3 py-2 text-sm text-[#34373c] hover:bg-[#f1f1ef]">返回</button>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => openProfileMemoryEditor()} className="rounded-xl bg-[#202124] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#34373c]">添加画像条目</button>
          </div>
          {renderProfileMemoryRows(displaySavedMemories)}
        </section>
      );
    }
    return (
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-3 border-b border-[#e8e8e4] pb-5">
          <div>
            <h2 className="text-xl font-semibold text-[#202124]">画像</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#777b80]">只展示长期稳定画像，内部维度在这里展开。</p>
          </div>
          <button type="button" onClick={() => setProfileEntryKind(null)} className="rounded-lg px-3 py-2 text-sm text-[#34373c] hover:bg-[#f1f1ef]">返回</button>
        </div>
        <section>
          <div className="mb-3">
            <h3 className="text-base font-semibold text-[#202124]">稳定画像</h3>
            <p className="mt-1 text-sm leading-6 text-[#777b80]">经 LLM 归并后的长期画像。</p>
          </div>
          {renderProfileGroups(displayStableGroups, {
            title: '暂无稳定画像',
            detail: '稳定画像需要重复证据或较高置信度。'
          })}
        </section>
      </section>
    );
  };
  const renderMemory = () => renderProfileDetail();
  const profileEditorCopy: ProfileEditorCopy = profileMemoryEditorKind === 'profile'
    ? {
        title: profileMemoryEditingKey ? '编辑画像条目' : '添加画像条目',
        description: '由用户管理的学习者画像信号，会保留在高层画像台账中。',
        fieldLabel: '画像内容',
        placeholder: 'e.g. Prefers concise explanations with one concrete example.',
        selectLabel: '维度',
        options: portraitDimensionOrder.map((dimension) => ({ value: dimension, label: portraitDimensionMeta[dimension]?.title || dimension }))
      }
    : profileMemoryEditorKind === 'event'
      ? {
          title: profileMemoryEditingKey ? '编辑近期事件' : '添加近期事件',
          description: '记忆治理时间线中的短期证据。',
          fieldLabel: '事件摘要',
          placeholder: 'e.g. Asked twice for a visual explanation of Bayes theorem today.',
          selectLabel: '事件类型',
          options: recentEventTypeOptions
        }
      : {
          title: profileMemoryEditingKey ? '编辑长期记忆' : '添加长期记忆',
          description: '由用户管理、供未来学习会话使用的长期记忆。',
          fieldLabel: '记忆内容',
          placeholder: 'e.g. I prefer concise explanations with one concrete example.',
          selectLabel: '类型',
          options: savedMemoryCategoryOptions
        };
  const activeProfileMenuMemory = profileMemoryMenu
    ? safeArray<any>(savedMemoryRecords).find((memory) => String(memory.memoryKey || memory.key) === profileMemoryMenu.key) ||
      profileActionTargetsRef.current.get(profileMemoryMenu.key) ||
      safeArray<any>(events).find((event) => `event:${String(event.id || '')}` === profileMemoryMenu.key) ||
      null
    : null;
  const activeProfileMenuEvidence = safeArray<NonNullable<LearnerPortraitEntity['evidence']>[number]>(activeProfileMenuMemory?.evidence);
  const content = (
    <>
      {section === 'overview' ? renderOverview() : null}
      {section === 'knowledge' ? renderKnowledge() : null}
      {section === 'diagnosis' ? renderDiagnosis() : null}
      {section === 'planning' ? renderPlanning() : null}
      {section === 'memory' ? renderMemory() : null}
    </>
  );
  return (
    <section className={isKnowledgeOnly ? 'h-full min-h-0' : 'min-h-[680px]'}>
      {!isKnowledgeOnly && !isPlanningOnly && !isProfileOnly ? (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-[#e8e8e4] pb-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-[#202124]">{headerTitle}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-[#777b80]">
            {headerDescription}
          </p>
          <p className="mt-2 max-w-5xl text-sm leading-5 text-[#55585d]">{contextSummary}</p>
        </div>
        <div className="flex items-center gap-3">
          {renderDashboardActions()}
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-[#96999d]" /> : null}
        </div>
      </div>
      ) : null}
      {error ? <div className="mb-5 border-y border-[#ffd6d6] bg-[#fff7f7] px-3 py-2 text-sm text-[#b42318]">{error}</div> : null}
      {hideSectionNav ? (
        <div className={isKnowledgeOnly ? 'h-full min-h-0' : 'min-w-0'}>{content}</div>
      ) : (
      <div className="grid gap-6 xl:grid-cols-[204px_minmax(0,1fr)]">
        <aside className="border-r border-[#e8e8e4] pr-3">
          <nav className="sticky top-4 space-y-1">
            {learningIntelligenceSectionItems.map((item) => {
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
        <div className="min-w-0">{content}</div>
      </div>
      )}
      {profileHistoryOpen ? (
        <div className="fixed inset-0 z-[130] flex justify-end bg-black/10" onClick={() => setProfileHistoryOpen(false)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-[#e6e6e1] bg-white p-6 shadow-[0_20px_80px_rgba(32,33,36,0.18)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">学习者画像审计</p>
                <h3 className="mt-2 text-2xl font-semibold text-[#202124]">版本历史</h3>
                <p className="mt-2 text-sm leading-6 text-[#777b80]">当前版本 {activeVersion}。版本记录用于解释画像如何变化，事件流只作为证据链，不再作为主页面。</p>
              </div>
              <button type="button" onClick={() => setProfileHistoryOpen(false)} className="rounded-lg p-2 text-[#777b80] hover:bg-[#f1f1ef]" aria-label="关闭学习者画像历史">
                <X className="h-4 w-4" />
              </button>
            </div>
            <section className="mt-6">
              <h4 className="text-sm font-semibold text-[#202124]">快照版本</h4>
              <div className="mt-3 border-y border-[#eeeeeb]">
                {versionItems.length ? versionItems.map((item) => (
                  <RowButton key={item.id || item.version}>
                    <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#202124]">版本 {item.version}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[#96999d]">{item.summary || item.changeReason || 'Snapshot version'}</p>
                    </div>
                  </RowButton>
                )) : (
                  <RowButton>
                    <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#202124]">版本 {activeVersion}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[#96999d]">{learnerState?.summary || 'Current learner state snapshot'}</p>
                    </div>
                  </RowButton>
                )}
              </div>
            </section>
            <section className="mt-7">
              <h4 className="text-sm font-semibold text-[#202124]">近期证据链</h4>
              <div className="mt-3 border-y border-[#eeeeeb]">
                {events.slice(0, 12).map((event) => (
                  <RowButton key={event.id}>
                    <Activity className="h-4 w-4 text-[#8a8e94]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#202124]">{event.eventType}</p>
                      <p className="mt-1 truncate text-xs text-[#96999d]">
                        {event.eventFamily || event.objectType || 'learning event'} · confidence {score(event.confidence)} · {event.observedAt ? new Date(event.observedAt).toLocaleString() : 'time unknown'}
                      </p>
                    </div>
                  </RowButton>
                ))}
                {!events.length ? <EmptyState title="暂无学习事件" detail="打开资源、对话、测验和计划操作会逐步形成事件流。" /> : null}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
      {profileEvidenceView && createPortal(
        <div className="fixed inset-0 z-[138] flex justify-end bg-black/10" onClick={() => setProfileEvidenceView(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-[#e6e6e1] bg-white p-6 shadow-[0_20px_80px_rgba(32,33,36,0.18)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">{profileEvidenceView.sourceLabel || '画像证据'}</p>
                <h3 className="mt-2 text-xl font-semibold text-[#202124]">{profileEvidenceView.title || '画像条目'}</h3>
                {profileEvidenceView.summary ? <p className="mt-2 text-sm leading-6 text-[#777b80]">{profileEvidenceView.summary}</p> : null}
              </div>
              <button type="button" onClick={() => setProfileEvidenceView(null)} className="rounded-lg p-2 text-[#777b80] hover:bg-[#f1f1ef]" aria-label="关闭画像证据">
                <X className="h-4 w-4" />
              </button>
            </div>
            <section className="mt-6">
              <h4 className="text-sm font-semibold text-[#202124]">证据</h4>
              <div className="mt-3 divide-y divide-[#eeeeeb] border-y border-[#eeeeeb]">
                {safeArray<NonNullable<LearnerPortraitEntity['evidence']>[number]>(profileEvidenceView.evidence).map((item, index) => (
                  <div key={`${item.id || item.sourceId || index}`} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#96999d]">
                      <span className="rounded-full bg-[#f5f5f3] px-2 py-0.5 font-medium text-[#55585d]">{item.sourceType || 'evidence'}</span>
                      {item.confidence != null ? <span>confidence {score(item.confidence)}</span> : null}
                      {item.observedAt ? <span>{formatCalendarDate(item.observedAt)}</span> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#34373c]">{item.summary || '证据详情不可用。'}</p>
                    {safeArray<string>(item.relatedConcepts).length ? (
                      <p className="mt-1 text-xs leading-5 text-[#96999d]">Related: {safeArray<string>(item.relatedConcepts).slice(0, 4).join(', ')}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>,
        document.body
      )}
      {profileMemoryMenu && activeProfileMenuMemory && createPortal(
        <>
          <style>{profileMenuAnimationStyle}</style>
          <button type="button" className="fixed inset-0 z-[140] cursor-default" aria-label="关闭画像记忆菜单" onClick={() => setProfileMemoryMenu(null)} />
          <div
            className="fixed z-[141] min-w-[170px] origin-top-right animate-[profile-menu-in_200ms_cubic-bezier(0.33,1,0.68,1)] rounded-2xl border border-gray-100 bg-white p-1 text-gray-900 shadow-lg"
            style={{
              top: Math.min(profileMemoryMenu.rect.bottom + 8, window.innerHeight - 140),
              left: Math.max(12, Math.min(profileMemoryMenu.rect.right - 176, window.innerWidth - 188))
            }}
          >
            {activeProfileMenuMemory.kind === 'event' ? (
              <>
                <button
                  type="button"
                  onClick={() => openProfileMemoryEditor(activeProfileMenuMemory, undefined, 'event')}
                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileHistoryOpen(true);
                    setProfileMemoryMenu(null);
                  }}
                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50"
                >
                  View evidence
                </button>
                <hr className="my-1 border-gray-50" />
                <button
                  type="button"
                  onClick={() => void deleteProfileEvent(activeProfileMenuMemory)}
                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50"
                >
                  删除
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => openProfileMemoryEditor(activeProfileMenuMemory)} className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50">
                  编辑
                </button>
                {activeProfileMenuEvidence.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProfileEvidenceView({
                        title: activeProfileMenuMemory.value || activeProfileMenuMemory.originalValue || '画像条目',
                        summary: activeProfileMenuMemory.summary || '',
                        sourceLabel: activeProfileMenuMemory.sourceLabel || '画像证据',
                        evidence: activeProfileMenuEvidence
                      });
                      setProfileMemoryMenu(null);
                    }}
                    className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50"
                  >
                    View evidence
                  </button>
                ) : null}
                <hr className="my-1 border-gray-50" />
                <button
                  type="button"
                  onClick={() => activeProfileMenuMemory.text
                    ? void deleteProfileMemory(activeProfileMenuMemory)
                    : void controlProfileSignal(activeProfileMenuMemory, 'delete', { reason: 'User deleted profile item from Learning Profile menu.' })}
                  className="flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm transition hover:bg-gray-50"
                >
                  删除
                </button>
              </>
            )}
          </div>
        </>,
        document.body
      )}
      {profileMemoryEditorOpen && createPortal(
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/20 px-4">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭画像编辑器" onClick={closeProfileMemoryEditor} />
          <div className="relative w-full max-w-xl rounded-3xl bg-white p-6 shadow-[0_24px_80px_rgba(32,33,36,0.20)]">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-[#202124]">{profileEditorCopy.title}</h3>
                <p className="mt-1 text-sm text-[#777b80]">{profileEditorCopy.description}</p>
              </div>
              <button type="button" onClick={closeProfileMemoryEditor} className="rounded-full p-2 text-[#777b80] hover:bg-gray-100" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-2 block text-sm font-medium text-[#34373c]">{profileEditorCopy.fieldLabel}</label>
            <textarea
              value={profileMemoryText}
              onChange={(event) => setProfileMemoryText(event.target.value)}
              className="min-h-32 w-full resize-none rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm leading-6 text-[#202124] outline-none transition focus:border-gray-200 focus:bg-white"
              placeholder={profileEditorCopy.placeholder}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2">
                <span className="text-sm text-[#777b80]">{profileEditorCopy.selectLabel}</span>
                <select value={profileMemoryCategory} onChange={(event) => setProfileMemoryCategory(event.target.value)} className="bg-transparent text-sm font-medium text-[#34373c] outline-none">
                  {profileEditorCopy.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={closeProfileMemoryEditor} className="rounded-xl px-4 py-2 text-sm font-medium text-[#55585d] hover:bg-gray-100">取消</button>
                <button
                  type="button"
                  onClick={() => void saveProfileMemory()}
                  disabled={!profileMemoryText.trim() || Boolean(profileMemoryBusyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#202124] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profileMemoryBusyKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {drawerConcept ? (
        <div className="fixed inset-0 z-[130] flex justify-end bg-black/10" onClick={() => setDrawerConcept(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-[#e6e6e1] bg-white p-6 shadow-[0_20px_80px_rgba(32,33,36,0.18)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">概念详情</p>
                <h3 className="mt-2 text-2xl font-semibold text-[#202124]">{drawerConcept.title}</h3>
              </div>
              <button type="button" onClick={() => setDrawerConcept(null)} className="rounded-lg p-2 text-[#777b80] hover:bg-[#f1f1ef]" aria-label="关闭概念详情">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-6 grid gap-4 border-y border-[#eeeeeb] py-5 sm:grid-cols-3">
              <div><p className="text-xs text-[#96999d]">掌握度</p><p className="mt-1 text-sm font-medium text-[#202124]">{pct(drawerConcept.learnerState?.masteryEstimate)}</p></div>
              <div><p className="text-xs text-[#96999d]">薄弱度</p><p className="mt-1 text-sm font-medium text-[#202124]">{pct(drawerConcept.learnerState?.weaknessEstimate)}</p></div>
              <div><p className="text-xs text-[#96999d]">准备度</p><p className="mt-1 text-sm font-medium text-[#202124]">{pct(drawerConcept.learnerState?.readinessEstimate)}</p></div>
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
                <h4 className="text-sm font-semibold text-[#202124]">来源证据</h4>
                <div className="mt-2 space-y-3 text-sm text-[#55585d]">
                  {drawerConcept.sources?.length ? drawerConcept.sources.map((source) => (
                    <div key={source.id} className="rounded-lg border border-[#eeeeeb] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#202124]">{source.name}</p>
                          <p className="mt-1 truncate text-xs text-[#777b80]">{source.path || source.id}</p>
                        </div>
                        <span className="shrink-0 rounded bg-[#f1f3f5] px-2 py-1 text-xs text-[#5f6368]">{source.role || 'evidence'}</span>
                      </div>
                      {source.snippets?.length ? (
                        <div className="mt-3 space-y-2">
                          {source.snippets.slice(0, 3).map((snippet, index) => (
                            <p key={`${source.id}-${index}`} className="rounded bg-[#fafafa] px-3 py-2 text-xs leading-5 text-[#4f5358]">
                              {snippet.chunkIndex !== null && snippet.chunkIndex !== undefined ? `Chunk ${snippet.chunkIndex} · ` : ''}
                              {snippet.quote}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )) : <p className="text-[#777b80]">暂无来源证据。</p>}
                </div>
              </section>
              <section>
                <h4 className="text-sm font-semibold text-[#202124]">相关资源与任务</h4>
                <div className="mt-2 space-y-2 text-sm text-[#55585d]">
                  {drawerConcept.bindings?.length ? drawerConcept.bindings.map((item, index) => (
                    <p key={`${item.targetType}-${item.targetId}-${index}`}>{item.role} · {item.fileName || item.targetType} · {item.path || item.targetId}</p>
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
