import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import CosmosKnowledgeGraphWorkbench from './CosmosKnowledgeGraphWorkbench';
export type IntelligenceSection = 'overview' | 'knowledge' | 'diagnosis' | 'planning' | 'memory';
type KnowledgeView = 'graph' | 'list' | 'path';
type PlanningView = 'plans' | 'steps' | 'feedback';
type LearnerProfileEntryKind = 'profile' | 'events' | 'memory';
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
  evidence?: Array<{ id: string; sourceType: string; summary: string; confidence: number; observedAt?: string; relatedConcepts?: string[] }>;
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
  version: 3;
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
  profileBase: { title: 'Profile Base', detail: '学习目标、当前课程上下文与阶段性关注点。' },
  knowledgeState: { title: 'Knowledge State', detail: '已掌握、薄弱、前置缺口等知识状态。' },
  preferenceStyle: { title: 'Preference Style', detail: '解释方式、资源形态和练习偏好。' },
  misconceptionState: { title: 'Misconception State', detail: '反复出现的误区、错误模式与纠正线索。' },
  cognitiveState: { title: 'Cognitive State', detail: '认知负荷、提问模式与学习习惯特征。' },
  behaviorEngagement: { title: 'Behavior / Engagement', detail: '近期行为、参与度与使用节奏。' },
  reviewPlanning: { title: 'Review Planning', detail: '复习压力、下一步动作与计划状态。' },
  savedMemory: { title: 'Saved Memory', detail: '用户可控的长期偏好、背景或明确记住的信息。' }
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
const INTELLIGENCE_SNAPSHOT_VERSION = 3;
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
          <button type="button" onClick={() => zoomBy(1.16)} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => zoomBy(0.86)} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={fitGraph} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="Fit graph">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={runLayout} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="Run force layout">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setShowControls((current) => !current)} className="rounded p-1.5 text-[#6b7077] hover:bg-[#f4f5f6]" title="Display controls">
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
              {item === 'connected' ? 'Connected' : item === 'local' ? 'Local' : 'All'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => patchPrefs({ showNodeLabels: !prefs.showNodeLabels })}
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ${prefs.showNodeLabels ? 'bg-[#202124] text-white' : 'text-[#6b7077] hover:bg-[#f4f5f6]'}`}
          >
            {prefs.showNodeLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Nodes
          </button>
          <button
            type="button"
            onClick={() => patchPrefs({ showEdgeLabels: !prefs.showEdgeLabels })}
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ${prefs.showEdgeLabels ? 'bg-[#202124] text-white' : 'text-[#6b7077] hover:bg-[#f4f5f6]'}`}
          >
            <Filter className="h-3.5 w-3.5" />
            Edges
          </button>
        </div>
        {showControls ? (
          <div className="absolute right-3 top-3 z-10 w-[286px] rounded-lg border border-[#d8dde4] bg-white/94 p-3 text-xs text-[#4d5864] shadow-sm backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-[#202124]">Graph controls</p>
              <button type="button" onClick={resetDisplay} className="rounded-md px-2 py-1 text-[#666a70] hover:bg-[#f1f3f5]">Reset</button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>Local depth</span><span>{prefs.localDepth}</span></span>
                <input type="range" min={1} max={4} value={prefs.localDepth} onChange={(event) => patchPrefs({ localDepth: Number(event.target.value) })} className="w-full accent-[#4386b5]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>Node size</span><span>{prefs.nodeScale.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.6} step={0.1} value={prefs.nodeScale} onChange={(event) => patchPrefs({ nodeScale: Number(event.target.value) })} className="w-full accent-[#4386b5]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>Link thickness</span><span>{prefs.edgeScale.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.8} step={0.1} value={prefs.edgeScale} onChange={(event) => patchPrefs({ edgeScale: Number(event.target.value) })} className="w-full accent-[#5b8f66]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>Repel force</span><span>{prefs.repelForce.toFixed(1)}x</span></span>
                <input type="range" min={0.6} max={2.2} step={0.1} value={prefs.repelForce} onChange={(event) => patchPrefs({ repelForce: Number(event.target.value) })} className="w-full accent-[#7b6fd1]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>Link distance</span><span>{prefs.linkDistance.toFixed(1)}x</span></span>
                <input type="range" min={0.7} max={1.8} step={0.1} value={prefs.linkDistance} onChange={(event) => patchPrefs({ linkDistance: Number(event.target.value) })} className="w-full accent-[#c17b32]" />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-[#666a70]"><span>Center force</span><span>{prefs.centerForce.toFixed(1)}x</span></span>
                <input type="range" min={0.4} max={1.8} step={0.1} value={prefs.centerForce} onChange={(event) => patchPrefs({ centerForce: Number(event.target.value) })} className="w-full accent-[#c75c5c]" />
              </label>
            </div>
          </div>
        ) : null}
        {matchedConcepts.length ? (
          <div className="absolute left-3 top-16 z-10 w-[280px] rounded-lg border border-[#d8dde4] bg-white/94 p-2 text-xs text-[#34373c] shadow-sm backdrop-blur">
            <p className="px-2 pb-1 text-[#666a70]">Search results</p>
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
                <p className="text-[#666a70]">Selected concept</p>
                <h3 className="mt-1 truncate text-sm font-semibold text-[#202124]">{selectedConcept.title}</h3>
              </div>
              <button type="button" onClick={() => setSelectedNodeId(null)} className="rounded-md p-1 text-[#666a70] hover:bg-[#f1f3f5]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md bg-[#f4f5f6] p-2"><p className="text-[#666a70]">Mastery</p><p className="mt-1 text-[#202124]">{pct(selectedConcept.learnerState?.masteryEstimate)}</p></div>
              <div className="rounded-md bg-[#f4f5f6] p-2"><p className="text-[#666a70]">Weak</p><p className="mt-1 text-[#202124]">{pct(selectedConcept.learnerState?.weaknessEstimate)}</p></div>
              <div className="rounded-md bg-[#f4f5f6] p-2"><p className="text-[#666a70]">Ready</p><p className="mt-1 text-[#202124]">{pct(selectedConcept.learnerState?.readinessEstimate)}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => openLocalGraph(selectedConcept.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#202124] px-2 text-xs font-medium text-white">
                <LocateFixed className="h-3.5 w-3.5" />
                Local graph
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
  headerTitle = 'Learning Intelligence Dashboard',
  headerDescription = '学习状态、知识结构、诊断、计划与画像。',
  onSectionChange,
  onOpenWorkbench,
  onPlanApplied,
  onOpenTerminal
}: LearningIntelligenceDashboardProps) {
  const [internalSection, setInternalSection] = useState<IntelligenceSection>('overview');
  const section = activeSection || internalSection;
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
  const [memories, setMemories] = useState<any[]>([]);
  const [learnerProfileView, setLearnerProfileView] = useState<LearnerProfileView | null>(null);
  const [profileHistoryOpen, setProfileHistoryOpen] = useState(false);
  const [selectedProfileDimension, setSelectedProfileDimension] = useState<string | null>(null);
  const [planActionBusyId, setPlanActionBusyId] = useState<string | null>(null);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const portraitPolishBadgeState = portraitPolishBadge(learnerProfileView?.portraitPolish);
  const portraitResolutionBadgeState = portraitResolutionBadge(learnerProfileView?.portraitResolution);
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
    setEvents(safeArray(snapshot.events));
    setSequences(safeArray(snapshot.sequences));
    setLearnerState(snapshot.learnerState || null);
    setMemories(safeArray(snapshot.memories));
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
      setEvents(safeArray(eventsResult.events));
      setSequences(safeArray(sequenceResult.patterns));
      setLearnerState(learnerStateResult.state || null);
      setMemories(safeArray(memoryResult.memories));
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
        learnerProfileView: profileViewResult.profileView || null,
        planningObjective:
          planDisplayTitle(persistedMclPlan) ||
          integrationResult.integration?.continueLearning?.prompt ||
          planResult.plan?.objective ||
          '根据当前学习画像、知识图谱和资料生成下一步学习计划'
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Learning Intelligence 加载失败');
    } finally {
      setLoading(false);
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
          await load();
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
    ...safeArray<any>(learnerState?.coreState?.workingState?.currentCourseState?.nextActions).map((signal) => toProfileSignal(signal, 'reviewPlanning', 'Next action', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.recentBehaviorSummary?.recentTopics).map((signal) => toProfileSignal(signal, 'profileBase', 'Recent topic', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.recentBehaviorSummary?.engagementSignals).map((signal) => toProfileSignal(signal, 'behaviorEngagement', 'Engagement signal', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.workingState?.recentBehaviorSummary?.reviewPressure).map((signal) => toProfileSignal(signal, 'reviewPlanning', 'Review pressure', 'working_state')),
    ...safeArray<any>(learnerState?.coreState?.observationMemory?.observations).map((signal) => toProfileSignal(signal, signal?.dimension || 'profileBase', signal?.label || 'Observation', 'observation_memory'))
  ];
  const savedMemories = safeArray<any>(memories)
    .filter((memory) => memory?.status !== 'deleted' && memory?.status !== 'suppressed')
    .map((memory) => ({
      ...toProfileSignal(memory, 'savedMemory', 'Saved memory', 'saved_memory'),
      label: String(memory?.dimension || memory?.category || 'Saved memory')
    }));
  const stableGroups = groupProfileSignals(stableProfileSignals, 6);
  const workingGroups = groupProfileSignals(workingStateSignals, 5);
  const savedMemoryGroups = groupProfileSignals(savedMemories, 8, { keepPromptLike: true });
  const displayStableGroups = safeArray<any>(learnerProfileView?.stableProfile).length
    ? safeArray<any>(learnerProfileView?.stableProfile).map((group) => ({
        dimension: String(group.key || group.dimension || 'profileBase'),
        meta: {
          title: String(group.title || profileDimensionMeta[group.key]?.title || group.key || 'Profile Dimension'),
          detail: String(group.summary || profileDimensionMeta[group.key]?.detail || '学习画像维度。')
        },
        items: safeArray<any>(group.items).map((item) => toProfileSignal(item, String(item.dimension || group.key || 'profileBase'), String(item.label || 'Profile signal'), 'llm_profile_view'))
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
  const displaySavedMemories = safeArray<any>(learnerProfileView?.savedMemory).length
    ? safeArray<any>(learnerProfileView?.savedMemory).map((item) => toProfileSignal(item, 'savedMemory', String(item.label || 'Saved Memory'), 'llm_profile_view'))
    : savedMemoryGroups.flatMap((group) => group.items);
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
  const profileOverviewScore = profileVisualNodes.length
    ? profileVisualNodes.reduce((sum, node) => sum + node.count, 0) / profileVisualNodes.length
    : 0;
  const selectedProfileNode =
    profileVisualNodes.find((node) => node.dimension === selectedProfileDimension) ||
    profileVisualNodes.find((node) => node.count > 0) ||
    profileVisualNodes[0] ||
    null;
  useEffect(() => {
    if (!selectedProfileDimension && profileVisualNodes[0]?.dimension) {
      setSelectedProfileDimension(
        profileVisualNodes.find((node) => node.count > 0)?.dimension || profileVisualNodes[0].dimension
      );
    }
  }, [profileVisualNodes, selectedProfileDimension]);
  useEffect(() => {
    if (structuredStages.length && !selectedStepId) {
      setSelectedStepId(structuredStageId(structuredStages[0], 0));
    }
  }, [structuredStages, selectedStepId]);
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
        onClick={() => void (section === 'memory' ? refreshPortrait() : load({ force: true }))}
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
          发给 AI Terminal
        </button>
      ) : null}
    </div>
  );
  const renderKnowledgeTools = () => (
    <div className="space-y-3 border-y border-[#eeeeeb] py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#96999d]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索概念"
            className="h-9 w-full rounded-lg border border-[#deded9] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#b9bab2]"
          />
        </label>
        <button
          type="button"
          onClick={() => void runBuildGraph()}
          disabled={loading || Boolean(graphActionRunning)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
        >
          {graphActionRunning === 'build' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
          重建课程图谱
        </button>
        <button
          type="button"
          onClick={() => void runTargetStructure()}
          disabled={loading || Boolean(graphActionRunning)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4] disabled:opacity-60"
        >
          {graphActionRunning === 'target' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
          生成目标结构
        </button>
        <button
          type="button"
          onClick={() => void runGapAnalysis()}
          disabled={loading || Boolean(graphActionRunning)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4] disabled:opacity-60"
        >
          {graphActionRunning === 'gap' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          运行差距分析
        </button>
      </div>
      {graphBuildJob || targetStructure || gapAnalysis ? (
        <div className="grid gap-3 lg:grid-cols-3">
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
    </div>
  );
  const isKnowledgeOnly = hideSectionNav && section === 'knowledge';
  const renderKnowledgeViewSwitch = () => (
    <div className="grid grid-cols-3 rounded-lg bg-[#f1f1ef] p-1">
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
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#202124]">Knowledge</h2>
        <p className="mt-1 text-sm leading-5 text-[#777b80]">概念对象、知识关系与学习路径。</p>
        <p className="mt-2 text-sm leading-5 text-[#55585d]">{contextSummary}</p>
      </div>
      {renderDashboardActions()}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#96999d]">View</p>
        {renderKnowledgeViewSwitch()}
      </div>
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
      {!isKnowledgeOnly ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-[#202124]">Knowledge</h2>
              <p className="mt-1 text-sm text-[#777b80]">知识点是稳定对象；图谱、列表和路径只是不同视图。</p>
            </div>
            <div className="w-full max-w-md sm:w-auto">{renderKnowledgeViewSwitch()}</div>
          </div>
          <div className="mb-5">{renderKnowledgeTools()}</div>
        </>
      ) : null}
      {knowledgeView === 'graph' ? (
        <div className={`${isKnowledgeOnly ? 'h-full min-h-0' : 'h-[720px]'} overflow-hidden border-y border-[#e5e7eb]`}>
          <CosmosKnowledgeGraphWorkbench
            workspaceId={workspaceId}
            workbenchId={workbenchId}
            concepts={graph.nodes}
            edges={graph.edges}
            sources={graph.sources}
            pathIds={pathIds}
            searchTerm={query}
            variant="embedded"
            sidebarControls={isKnowledgeOnly ? renderKnowledgeSidebarControls() : undefined}
          />
        </div>
      ) : null}
      {knowledgeView === 'list' ? (
        <div className={isKnowledgeOnly ? 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-hidden bg-white' : undefined}>
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
        {isKnowledgeOnly ? (
          <aside className="min-h-0 overflow-y-auto border-l border-[#e5e7eb] bg-[#fbfbfa] px-4 py-4">
            {renderKnowledgeSidebarControls()}
          </aside>
        ) : null}
        </div>
      ) : null}
      {knowledgeView === 'path' ? (
        <div className={isKnowledgeOnly ? 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-hidden bg-white' : undefined}>
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
        {isKnowledgeOnly ? (
          <aside className="min-h-0 overflow-y-auto border-l border-[#e5e7eb] bg-[#fbfbfa] px-4 py-4">
            {renderKnowledgeSidebarControls()}
          </aside>
        ) : null}
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
    const maxCount = Math.max(1, ...nodes.map((node) => node.count));
    const center = { x: 320, y: 220 };
    const radius = 146;
    const totalSignals = nodes.reduce((sum, node) => sum + node.count, 0);
    const strongest = selectedProfileNode || nodes[0];
    const stableCount = strongest ? strongest.layerCounts.stable : 0;
    const workingCount = strongest ? strongest.layerCounts.working : 0;
    const memoryCount = strongest ? strongest.layerCounts.memory : 0;
    const ratioBase = Math.max(1, strongest?.count || 0);
    const stableRatio = stableCount / ratioBase;
    const workingRatio = workingCount / ratioBase;
    const memoryRatio = memoryCount / ratioBase;
    const activeDetailSignals = strongest
      ? [
          ...displayStableGroups.flatMap((group) => group.items).filter((item) => item.dimension === strongest.dimension),
          ...displayWorkingGroups.flatMap((group) => group.items).filter((item) => item.dimension === strongest.dimension),
          ...displaySavedMemories.filter((item) => item.dimension === strongest.dimension)
        ]
      : [];
    const activeEntities = strongest?.entities || [];
    const stableEntityCount = strongest?.statusCounts?.stable ?? stableCount;
    const activeEntityCount = strongest ? (strongest.statusCounts?.active || 0) + (strongest.statusCounts?.candidate || 0) : workingCount;
    const reviewEntityCount = strongest?.statusCounts?.needs_review ?? 0;
    const riskEntityCount = strongest?.polarityCounts?.risk || 0;
    const needEntityCount = strongest?.polarityCounts?.need || 0;
    const strengthEntityCount = strongest?.polarityCounts?.strength || 0;
    const preferenceEntityCount = strongest?.polarityCounts?.preference || 0;
    const detailItems = activeEntities.length ? activeEntities : activeDetailSignals;
    return (
      <div className="grid gap-5 border-y border-[#eeeeeb] py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="relative h-[380px] overflow-hidden rounded-lg bg-[#fbfbfa] ring-1 ring-[#eeeeeb]">
            <svg viewBox="0 0 640 440" className="h-full w-full" role="img" aria-label="学习画像可视化总览">
              <defs>
                <filter id="profile-node-shadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#202124" floodOpacity="0.12" />
                </filter>
              </defs>
              {nodes.map((node, index) => {
                const angle = -Math.PI / 2 + (index / nodes.length) * Math.PI * 2;
                const start = angle - Math.PI / nodes.length;
                const end = angle + Math.PI / nodes.length;
                const largeArc = end - start > Math.PI ? 1 : 0;
                const outerR = 170;
                const innerR = 88;
                const x1 = center.x + Math.cos(start) * innerR;
                const y1 = center.y + Math.sin(start) * innerR;
                const x2 = center.x + Math.cos(start) * outerR;
                const y2 = center.y + Math.sin(start) * outerR;
                const x3 = center.x + Math.cos(end) * outerR;
                const y3 = center.y + Math.sin(end) * outerR;
                const x4 = center.x + Math.cos(end) * innerR;
                const y4 = center.y + Math.sin(end) * innerR;
                const color = profileDimensionColor(node.dimension);
                const isSelected = selectedProfileDimension === node.dimension;
                const statusLabel = isSelected ? 'selected' : `${node.count} entities`;
                return (
                  <path
                    key={`${node.dimension}-slice`}
                    d={`M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1} ${y1} Z`}
                    fill={isSelected ? '#e6edf3' : color.fill}
                    stroke={isSelected ? '#202124' : color.stroke}
                    strokeWidth={isSelected ? '2' : '1'}
                    opacity={selectedProfileDimension && !isSelected ? 0.78 : 1}
                    onClick={() => setSelectedProfileDimension(node.dimension)}
                    style={{ cursor: 'pointer' }}
                    aria-label={`${node.title} ${statusLabel}`}
                  />
                );
              })}
              <circle cx={center.x} cy={center.y} r="64" fill="#202124" />
              <circle cx={center.x} cy={center.y} r="88" fill="none" stroke="#deded9" strokeDasharray="4 8" />
              <text x={center.x} y={center.y - 7} textAnchor="middle" className="fill-white text-[15px] font-semibold">Learner</text>
              <text x={center.x} y={center.y + 15} textAnchor="middle" className="fill-[#cfd1d3] text-[11px]">{totalSignals} signals</text>
              {nodes.map((node, index) => {
                const angle = -Math.PI / 2 + (index / nodes.length) * Math.PI * 2;
                const x = center.x + Math.cos(angle) * radius;
                const y = center.y + Math.sin(angle) * radius;
                const count = Math.max(0, Number(node.count) || 0);
                const layerCounts = {
                  stable: Math.max(0, Number(node.layerCounts.stable) || 0),
                  working: Math.max(0, Number(node.layerCounts.working) || 0),
                  memory: Math.max(0, Number(node.layerCounts.memory) || 0)
                };
                const layerTotal = layerCounts.stable + layerCounts.working + layerCounts.memory;
                const barBase = Math.max(1, layerTotal || count);
                const size = 34 + (count / maxCount) * 26;
                const color = profileDimensionColor(node.dimension);
                const stableWidth = Math.max(0, Math.min(1, layerCounts.stable / barBase)) * 56;
                const workingWidth = Math.max(0, Math.min(1, layerCounts.working / barBase)) * 56;
                const memoryWidth = Math.max(0, Math.min(1, layerCounts.memory / barBase)) * 56;
                const label = truncateLabel(node.title.replace(/\s*\/\s*/g, '/'), 18);
                return (
                  <g key={node.dimension} onClick={() => setSelectedProfileDimension(node.dimension)} style={{ cursor: 'pointer' }}>
                    <line x1={center.x} y1={center.y} x2={x} y2={y} stroke="#deded9" strokeWidth="1.2" />
                    <g filter="url(#profile-node-shadow)">
                      <circle cx={x} cy={y} r={size} fill={color.fill} stroke={selectedProfileDimension === node.dimension ? '#202124' : color.stroke} strokeWidth="2.5" />
                      <rect x={x - 28} y={y + size + 8} width={stableWidth} height="4" rx="2" fill="#202124" />
                      <rect x={x - 28 + stableWidth} y={y + size + 8} width={workingWidth} height="4" rx="2" fill="#6aa6ff" />
                      <rect x={x - 28 + stableWidth + workingWidth} y={y + size + 8} width={memoryWidth} height="4" rx="2" fill="#b08968" />
                    </g>
                    <text x={x} y={y - 3} textAnchor="middle" className="text-[12px] font-semibold" fill={color.text}>{label}</text>
                    <text x={x} y={y + 17} textAnchor="middle" className="fill-[#666a70] text-[11px]">{node.count} 条</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#777b80]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-[#202124]" />稳定画像</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-[#6aa6ff]" />近期状态</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-[#b08968]" />保存记忆</span>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">At A Glance</p>
            <h3 className="mt-2 text-lg font-semibold text-[#202124]">{strongest.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[#55585d]">
              当前画像最集中的维度是 {strongest.title}，共 {strongest.count} 个画像实体。画像密度约 {score(profileOverviewScore)}，每个实体都由证据、置信度和建议动作组成。
            </p>
          </div>
          <div className="rounded-lg border border-[#eeeeeb] bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-[#202124]">{strongest.title}</p>
                <p className="mt-1 text-xs text-[#96999d]">{strongest.detail}</p>
              </div>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: profileDimensionColor(strongest.dimension).fill, color: profileDimensionColor(strongest.dimension).text }}>
                {strongest.count}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              <div className="grid grid-cols-3 gap-2 text-xs text-[#777b80]">
                <div className="rounded-md bg-[#f5f5f3] px-2 py-2">
                  <p className="text-[#96999d]">Stable</p>
                  <p className="mt-1 font-semibold text-[#202124]">{stableEntityCount}</p>
                </div>
                <div className="rounded-md bg-[#f5f5f3] px-2 py-2">
                  <p className="text-[#96999d]">Active</p>
                  <p className="mt-1 font-semibold text-[#202124]">{activeEntityCount}</p>
                </div>
                <div className="rounded-md bg-[#f5f5f3] px-2 py-2">
                  <p className="text-[#96999d]">Review</p>
                  <p className="mt-1 font-semibold text-[#202124]">{reviewEntityCount}</p>
                </div>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-[#f1f1ef]">
                <div className="h-full bg-[#202124]" style={{ width: `${stableRatio * 100}%` }} />
                <div className="h-full bg-[#6aa6ff]" style={{ width: `${workingRatio * 100}%` }} />
                <div className="h-full bg-[#b08968]" style={{ width: `${memoryRatio * 100}%` }} />
              </div>
              {activeEntities.length ? (
                <div className="grid grid-cols-4 gap-1.5 text-[11px] text-[#777b80]">
                  <span className="rounded-md bg-[#ffe9e6] px-2 py-1 text-[#9d2c22]">风险 {riskEntityCount}</span>
                  <span className="rounded-md bg-[#fff0e3] px-2 py-1 text-[#944d0b]">需求 {needEntityCount}</span>
                  <span className="rounded-md bg-[#e8f6ef] px-2 py-1 text-[#24613d]">优势 {strengthEntityCount}</span>
                  <span className="rounded-md bg-[#fff7d7] px-2 py-1 text-[#765d00]">偏好 {preferenceEntityCount}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#96999d]">Selected slice detail</p>
            {detailItems.slice(0, 4).map((item: any) => {
              const entity = item as LearnerPortraitEntity;
              const isEntity = Boolean(entity.description);
              const dimension = isEntity ? entity.dimension : item.dimension;
              const color = profileDimensionColor(dimension);
              return (
                <button key={item.id} type="button" onClick={() => setProfileEntryKind(isEntity ? (entity.dimension === 'learningRisk' || entity.dimension === 'supportNeed' ? 'events' : 'profile') : item.dimension === 'savedMemory' ? 'memory' : item.sourceType === 'working_state' ? 'events' : 'profile')} className="w-full rounded-lg border border-[#eeeeeb] bg-white px-3 py-2 text-left hover:bg-[#f7f7f5]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-[#202124]">{isEntity ? entity.displayTitle || entity.title : item.label}</span>
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: color.fill, color: color.text }}>{isEntity ? entity.polarity : item.status || 'signal'}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#96999d]">{isEntity ? entity.displayDescription || entity.description : item.value}</p>
                  {isEntity && entity.mergedFrom?.length && entity.mergedFrom.length > 1 ? (
                    <p className="mt-1 text-[11px] text-[#777b80]">合并自 {entity.mergedFrom.length} 条语义相近信号{entity.mergeReason ? `，${entity.mergeReason}` : ''}</p>
                  ) : null}
                  {isEntity && (entity.displayRecommendation || entity.recommendation) ? <p className="mt-1 line-clamp-1 text-xs text-[#55585d]">建议：{entity.displayRecommendation || entity.recommendation}</p> : null}
                </button>
              );
            })}
            {!detailItems.length ? <EmptyState title="暂无该维度详情" detail="该 slice 目前只有聚合信号，没有足够的条目。" /> : null}
          </div>
        </div>
      </div>
    );
  };
  const renderMemoryHome = () => (
    <section className="space-y-6">
      <div className="border-b border-[#e8e8e4] pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[#202124]">Learner Profile</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#777b80]">首页先给一张可视化总览，细节再进入画像、近期事件和记忆查看。</p>
          </div>
          <button
            type="button"
            onClick={() => setProfileHistoryOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e6e6e1] bg-white px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f6f6f4]"
          >
            <History className="h-4 w-4" />
            Version History
          </button>
        </div>
      </div>
      {learnerProfileView?.portraitPolish ? (
        <div className="border-y border-[#eeeeeb] bg-[#fbfbfa] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Portrait Summary</p>
              <h3 className="mt-2 text-lg font-semibold text-[#202124]">{learnerProfileView.portraitPolish.globalSummary.headline}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#55585d]">{learnerProfileView.portraitPolish.globalSummary.summary}</p>
              <p className="mt-1 text-xs text-[#96999d]">{portraitPolishBadgeState.detail}</p>
              {learnerProfileView.portraitPolish.source === 'failed' && learnerProfileView.portraitPolish.message ? (
                <p className="mt-1 max-w-3xl truncate text-xs text-[#b42318]">精修失败原因：{learnerProfileView.portraitPolish.message}</p>
              ) : null}
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${portraitPolishBadgeState.className}`} title={learnerProfileView.portraitPolish.message || portraitPolishBadgeState.detail}>
              {portraitPolishBadgeState.label}
            </span>
          </div>
          {learnerProfileView.portraitPolish.globalSummary.nextBestActions.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {learnerProfileView.portraitPolish.globalSummary.nextBestActions.slice(0, 3).map((item) => (
                <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#55585d] ring-1 ring-[#e6e6e1]">{item}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {renderProfileVisualMap()}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            id: 'profile' as LearnerProfileEntryKind,
            title: '画像',
            detail: '长期稳定学习画像',
            count: learnerProfileView?.overview?.stableCount ?? stableCount,
            subtitle: learnerProfileView?.source === 'llm' ? 'LLM normalized' : 'Normalized fallback',
            tone: 'bg-white'
          },
          {
            id: 'events' as LearnerProfileEntryKind,
            title: '近期事件',
            detail: '近期状态、观察和证据流',
            count: learnerProfileView?.overview?.workingCount ?? displayWorkingGroups.reduce((sum, group) => sum + group.items.length, 0),
            subtitle: learnerProfileView?.source === 'llm' ? 'LLM normalized' : 'Normalized fallback',
            tone: 'bg-white'
          },
          {
            id: 'memory' as LearnerProfileEntryKind,
            title: '记忆',
            detail: 'Saved Memory 和可控长期偏好',
            count: learnerProfileView?.overview?.memoryCount ?? displaySavedMemories.length,
            subtitle: learnerProfileView?.source === 'llm' ? 'LLM normalized' : 'Normalized fallback',
            tone: 'bg-white'
          }
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setProfileEntryKind(item.id)}
            className={`rounded-lg border border-[#eeeeeb] px-4 py-4 text-left transition hover:bg-[#f6f6f4] ${item.tone}`}
          >
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#96999d]">{item.title}</p>
            <p className="mt-3 text-3xl font-semibold text-[#202124]">{item.count}</p>
            <p className="mt-1 text-sm text-[#777b80]">{item.detail}</p>
            <p className="mt-2 text-xs text-[#96999d]">{item.subtitle}</p>
          </button>
        ))}
      </div>
      <div className="border-y border-[#eeeeeb] bg-[#fcfcfb] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Semantic Resolution</p>
            <p className="mt-1 text-sm text-[#55585d]">{portraitResolutionBadgeState.detail}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${portraitResolutionBadgeState.className}`} title={learnerProfileView?.portraitResolution?.message || portraitResolutionBadgeState.detail}>
            {portraitResolutionBadgeState.label}
          </span>
        </div>
        {learnerProfileView?.portraitResolution?.clusters?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {learnerProfileView.portraitResolution.clusters.slice(0, 4).map((cluster) => (
              <span key={cluster.canonicalEntityId} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#55585d] ring-1 ring-[#e6e6e1]">
                {cluster.dimension} 合并 {cluster.mergedEntityIds.length} 条
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-y border-[#eeeeeb]">
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <p className="text-sm font-medium text-[#34373c]">LLM view</p>
          <p className="text-xs text-[#96999d]">{learnerProfileView?.source === 'llm' ? 'LLM parsed' : 'Fallback normalized'}</p>
        </div>
      </div>
    </section>
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
              <h3 className="text-base font-semibold text-[#202124]">Recent Evidence Trail</h3>
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
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#777b80]">Saved Memory 和长期可控偏好。</p>
            </div>
            <button type="button" onClick={() => setProfileEntryKind(null)} className="rounded-lg px-3 py-2 text-sm text-[#34373c] hover:bg-[#f1f1ef]">返回</button>
          </div>
          <div className="border-y border-[#eeeeeb]">
            {displaySavedMemories.map((item) => (
              <RowButton key={item.id}>
                <BookOpen className="h-4 w-4 text-[#8a8e94]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#202124]">{item.value}</p>
                  <p className="mt-1 truncate text-xs text-[#96999d]">{item.label}{item.confidence != null ? ` · confidence ${score(item.confidence)}` : ''}</p>
                </div>
              </RowButton>
            ))}
            {!displaySavedMemories.length ? <EmptyState title="暂无记忆" detail="当用户明确保存偏好或背景时，这里会出现。" /> : null}
          </div>
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
            <h3 className="text-base font-semibold text-[#202124]">Stable Profile</h3>
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
      {!isKnowledgeOnly ? (
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
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">Learner Profile Audit</p>
                <h3 className="mt-2 text-2xl font-semibold text-[#202124]">Version History</h3>
                <p className="mt-2 text-sm leading-6 text-[#777b80]">当前版本 {activeVersion}。版本记录用于解释画像如何变化，事件流只作为证据链，不再作为主页面。</p>
              </div>
              <button type="button" onClick={() => setProfileHistoryOpen(false)} className="rounded-lg p-2 text-[#777b80] hover:bg-[#f1f1ef]" aria-label="Close learner profile history">
                <X className="h-4 w-4" />
              </button>
            </div>
            <section className="mt-6">
              <h4 className="text-sm font-semibold text-[#202124]">Snapshot Versions</h4>
              <div className="mt-3 border-y border-[#eeeeeb]">
                {versionItems.length ? versionItems.map((item) => (
                  <RowButton key={item.id || item.version}>
                    <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#202124]">Version {item.version}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[#96999d]">{item.summary || item.changeReason || 'Snapshot version'}</p>
                    </div>
                  </RowButton>
                )) : (
                  <RowButton>
                    <CheckCircle2 className="h-4 w-4 text-[#8a8e94]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#202124]">Version {activeVersion}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[#96999d]">{learnerState?.summary || 'Current learner state snapshot'}</p>
                    </div>
                  </RowButton>
                )}
              </div>
            </section>
            <section className="mt-7">
              <h4 className="text-sm font-semibold text-[#202124]">Recent Evidence Trail</h4>
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