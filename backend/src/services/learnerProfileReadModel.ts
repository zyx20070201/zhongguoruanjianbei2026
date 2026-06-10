export type LearnerProfileEntrySource =
  | 'stable_profile'
  | 'working_state'
  | 'observation_memory'
  | 'saved_memory'
  | 'event';

export type LearnerProfileEntry = {
  id: string;
  dimension: string;
  label: string;
  value: string;
  confidence?: number | null;
  status?: string | null;
  evidenceCount?: number;
  source: LearnerProfileEntrySource;
  observedAt?: string | null;
  rationale?: string | null;
  eventFamily?: string | null;
  eventType?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  diagnosticFeatures?: Record<string, any> | null;
  cognitiveSignals?: Array<Record<string, any>> | null;
  quality?: Record<string, any> | null;
  sourcePipeline?: string | null;
};

export type LearnerProfileGroup = {
  key: string;
  title: string;
  summary: string;
  items: LearnerProfileEntry[];
};

export type LearnerProfileEvidenceProjection = {
  state: any;
  context: any;
  stableProfile: LearnerProfileEntry[];
  workingState: LearnerProfileEntry[];
  savedMemoryEntries: LearnerProfileEntry[];
  recentEvents: LearnerProfileEntry[];
};

export type LearnerProfilePolishView = {
  schema: 'learner_portrait_polish.v1';
  source: 'llm' | 'fallback' | 'cache' | 'pending' | 'failed';
  status: 'ready' | 'pending' | 'failed';
  entityHash: string;
  generatedAt?: string | null;
  model?: string | null;
  provider?: string | null;
  globalSummary: {
    headline: string;
    summary: string;
    priorityInsights: string[];
    nextBestActions: string[];
  };
  dimensionSummaries: Array<{
    dimension: string;
    title: string;
    summary: string;
    tone: 'stable' | 'active' | 'needs_attention' | 'insufficient_evidence';
  }>;
  entities: Array<any>;
};

export type LearnerPortraitResolutionView = {
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
  entities: Array<any>;
  clusters: Array<{
    canonicalEntityId: string;
    dimension: string;
    mergedEntityIds: string[];
    mergeReason: string;
  }>;
};

export type LearnerPortraitBundle = {
  portrait: {
    schema: string;
    sourceFrameworks: string[];
    dimensions: Record<string, number>;
    entities: Array<any>;
  };
  portraitResolution: LearnerPortraitResolutionView;
  portraitPolish: LearnerProfilePolishView;
  persisted?: {
    candidates: Array<any>;
    entities: Array<any>;
  };
};

export const clipProfileText = (value: string | null | undefined, maxLength = 220) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

export const safeProfileArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/epsilon/g, 'ε')
    .replace(/[\s"'`“”‘’.,，。:：;；!?！？()[\]{}<>《》/\\|-]+/g, '')
    .trim();

export const learnerProfileTitleMap: Record<string, { title: string; summary: string }> = {
  profileBase: { title: 'Profile Base', summary: '学习目标、当前上下文与阶段性关注点。' },
  knowledgeState: { title: 'Knowledge State', summary: '已掌握、薄弱和前置缺口。' },
  preferenceStyle: { title: 'Preference Style', summary: '讲解方式、资源形态和练习偏好。' },
  misconceptionState: { title: 'Misconception State', summary: '误区、错误模式和纠正线索。' },
  cognitiveState: { title: 'Cognitive State', summary: '认知负荷、提问模式与习惯。' },
  behaviorEngagement: { title: 'Behavior / Engagement', summary: '近期参与度和使用节奏。' },
  reviewPlanning: { title: 'Review Planning', summary: '复习压力与下一步动作。' }
};

export const dedupeProfileEntries = (entries: LearnerProfileEntry[], limit: number) => {
  const selected: LearnerProfileEntry[] = [];
  const sorted = [...entries].sort((a, b) => {
    const confidenceDelta = Number(b.confidence || 0) - Number(a.confidence || 0);
    if (confidenceDelta) return confidenceDelta;
    const timeDelta = new Date(b.observedAt || 0).getTime() - new Date(a.observedAt || 0).getTime();
    if (timeDelta) return timeDelta;
    return Number(b.evidenceCount || 0) - Number(a.evidenceCount || 0);
  });

  for (const entry of sorted) {
    const normalized = normalize(entry.value);
    if (!normalized) continue;
    const duplicate = selected.some((other) => {
      const otherNormalized = normalize(other.value);
      return normalized === otherNormalized || normalized.includes(otherNormalized) || otherNormalized.includes(normalized);
    });
    if (!duplicate) selected.push(entry);
    if (selected.length >= limit) break;
  }
  return selected;
};

export const groupProfileEntries = (
  entries: LearnerProfileEntry[],
  titleMap = learnerProfileTitleMap,
  limitPerGroup = 5
): LearnerProfileGroup[] => {
  const grouped = new Map<string, LearnerProfileEntry[]>();
  entries.forEach((entry) => {
    const key = entry.dimension || 'profileBase';
    grouped.set(key, [...(grouped.get(key) || []), entry]);
  });
  return Array.from(grouped.entries()).map(([key, items]) => ({
    key,
    title: titleMap[key]?.title || key,
    summary: titleMap[key]?.summary || 'Learner profile dimension',
    items: dedupeProfileEntries(items, limitPerGroup)
  }));
};
