import type { LearnerStateDimension, LearnerStateSnapshot } from './learnerStateService';

export type LearnerMemoryLayer = 'stable_profile' | 'working_state' | 'observation_memory';

export interface LearnerSignalRecord {
  id: string;
  label: string;
  value: string;
  confidence: number;
  evidenceIds: string[];
  sources: string[];
  firstObservedAt?: string | null;
  lastObservedAt?: string | null;
  status: 'active' | 'candidate' | 'resolved' | 'suppressed';
  rationale?: string;
}

export interface CoursePositionState {
  courseId?: string | null;
  courseTitle?: string | null;
  unitId?: string | null;
  unitTitle?: string | null;
  resourceId?: string | null;
  resourceTitle?: string | null;
  workbenchId?: string | null;
  goalId?: string | null;
  updatedAt?: string | null;
}

export interface StableLearnerProfile {
  learningGoals: LearnerSignalRecord[];
  masteredKnowledge: LearnerSignalRecord[];
  weakKnowledge: LearnerSignalRecord[];
  learningPreferences: LearnerSignalRecord[];
  commonErrors: LearnerSignalRecord[];
  learnerTraits: LearnerSignalRecord[];
}

export interface WorkingLearnerState {
  currentLearningPosition: CoursePositionState;
  currentCourseState: {
    activeGoals: LearnerSignalRecord[];
    focusKnowledge: LearnerSignalRecord[];
    pendingQuestions: LearnerSignalRecord[];
    nextActions: LearnerSignalRecord[];
  };
  recentBehaviorSummary: {
    summary: string;
    recentTopics: LearnerSignalRecord[];
    engagementSignals: LearnerSignalRecord[];
    reviewPressure: LearnerSignalRecord[];
  };
}

export interface ShortTermObservationMemory {
  observations: LearnerSignalRecord[];
  candidatePromotions: LearnerSignalRecord[];
  window: {
    maxItems: number;
    oldestObservedAt?: string | null;
    newestObservedAt?: string | null;
  };
}

export interface LearnerStateGovernance {
  modelVersion: string;
  sourceFrameworks: string[];
  statePolicy: {
    singleWriter: string;
    stableProfileRequiresConsolidation: boolean;
    observationHalfLifeDays: number;
    minimumEvidenceForStableWeakness: number;
  };
  lastConsolidatedAt?: string | null;
}

export interface CentralLearnerStateV2 {
  stableProfile: StableLearnerProfile;
  workingState: WorkingLearnerState;
  observationMemory: ShortTermObservationMemory;
  governance: LearnerStateGovernance;
}

const MODEL_VERSION = 'central-learner-state-v1';
const FRAMEWORKS = [
  'IntelliCode: centralized learner state with auditable state transitions',
  'DeepTutor: multi-granular learner memory separating profile and learning summary',
  'CogEvo-Edu: short-term observations separated from long-term cognitive memory'
];

const clip = (value: string | null | undefined, maxLength = 180) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const asArray = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []);

const asRecordArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : [];

const parseTime = (value: unknown) => {
  if (typeof value !== 'string') return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const blankLearnerStateV2 = (): CentralLearnerStateV2 => ({
  stableProfile: {
    learningGoals: [],
    masteredKnowledge: [],
    weakKnowledge: [],
    learningPreferences: [],
    commonErrors: [],
    learnerTraits: []
  },
  workingState: {
    currentLearningPosition: {},
    currentCourseState: {
      activeGoals: [],
      focusKnowledge: [],
      pendingQuestions: [],
      nextActions: []
    },
    recentBehaviorSummary: {
      summary: '',
      recentTopics: [],
      engagementSignals: [],
      reviewPressure: []
    }
  },
  observationMemory: {
    observations: [],
    candidatePromotions: [],
    window: {
      maxItems: 40
    }
  },
  governance: {
    modelVersion: MODEL_VERSION,
    sourceFrameworks: FRAMEWORKS,
    statePolicy: {
      singleWriter: 'LearnerStateService.applyPendingPatches',
      stableProfileRequiresConsolidation: true,
      observationHalfLifeDays: 21,
      minimumEvidenceForStableWeakness: 2
    }
  }
});

export const signalId = (layer: LearnerMemoryLayer, dimension: string, value: string) =>
  `${layer}:${dimension}:${String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5:_-]/gi, '')
    .slice(0, 96)}`;

export const makeSignal = (input: {
  layer: LearnerMemoryLayer;
  dimension: string;
  label: string;
  value: string;
  confidence?: number;
  evidenceIds?: string[];
  sources?: string[];
  observedAt?: string | null;
  status?: LearnerSignalRecord['status'];
  rationale?: string;
}): LearnerSignalRecord => ({
  id: signalId(input.layer, input.dimension, input.value),
  label: input.label,
  value: clip(input.value, 220),
  confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))),
  evidenceIds: Array.from(new Set(input.evidenceIds || [])),
  sources: Array.from(new Set(input.sources || [])),
  firstObservedAt: input.observedAt || null,
  lastObservedAt: input.observedAt || null,
  status: input.status || 'candidate',
  rationale: clip(input.rationale, 260)
});

const mergeSignal = (left: LearnerSignalRecord | undefined, right: LearnerSignalRecord) => {
  if (!left) return right;
  const first = [left.firstObservedAt, right.firstObservedAt].filter(Boolean).sort((a, b) => parseTime(a) - parseTime(b))[0] || null;
  const last = [left.lastObservedAt, right.lastObservedAt].filter(Boolean).sort((a, b) => parseTime(b) - parseTime(a))[0] || null;
  return {
    ...left,
    ...right,
    confidence: Math.max(left.confidence, right.confidence),
    evidenceIds: Array.from(new Set([...left.evidenceIds, ...right.evidenceIds])),
    sources: Array.from(new Set([...left.sources, ...right.sources])),
    firstObservedAt: first,
    lastObservedAt: last,
    rationale: right.rationale || left.rationale
  };
};

export const mergeSignals = (left: LearnerSignalRecord[], right: LearnerSignalRecord[], limit = 20) => {
  const byId = new Map<string, LearnerSignalRecord>();
  [...left, ...right].forEach((signal) => byId.set(signal.id, mergeSignal(byId.get(signal.id), signal)));
  return Array.from(byId.values())
    .sort((a, b) => (parseTime(b.lastObservedAt) - parseTime(a.lastObservedAt)) || b.confidence - a.confidence)
    .slice(0, limit);
};

export const isLearnerStateV2 = (value: unknown): value is CentralLearnerStateV2 =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).stableProfile &&
      (value as Record<string, unknown>).workingState &&
      (value as Record<string, unknown>).observationMemory
  );

export const stateV2ToSnapshot = (state: CentralLearnerStateV2): LearnerStateSnapshot => ({
  profileBase: {
    schema: 'stable_profile',
    goals: state.stableProfile.learningGoals.map((item) => item.value),
    recentTopics: state.workingState.recentBehaviorSummary.recentTopics.map((item) => item.value),
    currentLearningPosition: state.workingState.currentLearningPosition,
    stableSignals: state.stableProfile.learningGoals
  },
  knowledgeState: {
    schema: 'stable_and_working_knowledge',
    targetSkills: state.workingState.currentCourseState.focusKnowledge.map((item) => item.value),
    weakSkills: state.stableProfile.weakKnowledge.map((item) => item.value),
    candidateWeakSkills: state.observationMemory.observations
      .filter((item) => item.label === 'Candidate weak knowledge')
      .map((item) => item.value),
    emergingStrengths: state.stableProfile.masteredKnowledge.map((item) => item.value),
    masterySignals: [
      ...state.stableProfile.masteredKnowledge,
      ...state.stableProfile.weakKnowledge,
      ...state.workingState.currentCourseState.focusKnowledge
    ]
  },
  misconceptionState: {
    schema: 'stable_common_errors',
    candidates: state.stableProfile.commonErrors.map((item) => item.value)
  },
  preferenceStyle: {
    schema: 'stable_preferences',
    resourcePreference: state.stableProfile.learningPreferences.map((item) => item.value),
    preferredResourceForms: state.stableProfile.learningPreferences.map((item) => item.value),
    tentativeResourcePreferences: state.observationMemory.observations
      .filter((item) => item.label === 'Preference observation')
      .map((item) => item.value)
  },
  behaviorEngagement: {
    schema: 'working_behavior',
    recentBehaviorSummary: state.workingState.recentBehaviorSummary.summary,
    engagementSignals: state.workingState.recentBehaviorSummary.engagementSignals
  },
  cognitiveState: {
    schema: 'stable_traits',
    learnerTraits: state.stableProfile.learnerTraits
  },
  reviewPlanning: {
    schema: 'working_review',
    nextActions: state.workingState.currentCourseState.nextActions.map((item) => item.value),
    reviewPressureSignals: state.workingState.recentBehaviorSummary.reviewPressure.map((item) => item.value)
  },
  confidence: {
    schema: 'governance',
    confidence: Math.max(
      0.45,
      ...[
        ...state.stableProfile.learningGoals,
        ...state.stableProfile.masteredKnowledge,
        ...state.stableProfile.weakKnowledge,
        ...state.stableProfile.learningPreferences
      ].map((item) => item.confidence)
    ),
    evidenceCount: [
      ...state.stableProfile.learningGoals,
      ...state.stableProfile.masteredKnowledge,
      ...state.stableProfile.weakKnowledge,
      ...state.stableProfile.learningPreferences,
      ...state.observationMemory.observations
    ].reduce((sum, item) => sum + item.evidenceIds.length, 0),
    modelVersion: state.governance.modelVersion
  }
});

export const snapshotToStateV2 = (snapshot: LearnerStateSnapshot, input?: { workbenchId?: string | null; goalId?: string | null }) => {
  const now = new Date().toISOString();
  const next = blankLearnerStateV2();
  next.workingState.currentLearningPosition = {
    ...(snapshot.profileBase.currentLearningPosition && typeof snapshot.profileBase.currentLearningPosition === 'object'
      ? snapshot.profileBase.currentLearningPosition as CoursePositionState
      : {}),
    workbenchId: input?.workbenchId || null,
    goalId: input?.goalId || null,
    updatedAt: now
  };
  next.stableProfile.learningGoals = asArray(snapshot.profileBase.goals).map((value) =>
    makeSignal({ layer: 'stable_profile', dimension: 'profileBase', label: 'Learning goal', value, confidence: 0.62, sources: ['legacy_snapshot'], observedAt: now, status: 'active' })
  );
  next.stableProfile.weakKnowledge = asArray(snapshot.knowledgeState.weakSkills).map((value) =>
    makeSignal({ layer: 'stable_profile', dimension: 'knowledgeState', label: 'Weak knowledge', value, confidence: 0.62, sources: ['legacy_snapshot'], observedAt: now, status: 'active' })
  );
  next.stableProfile.masteredKnowledge = asArray(snapshot.knowledgeState.emergingStrengths).map((value) =>
    makeSignal({ layer: 'stable_profile', dimension: 'knowledgeState', label: 'Mastered knowledge', value, confidence: 0.58, sources: ['legacy_snapshot'], observedAt: now, status: 'active' })
  );
  next.stableProfile.learningPreferences = [
    ...asArray(snapshot.preferenceStyle.resourcePreference),
    ...asArray(snapshot.preferenceStyle.preferredResourceForms)
  ].map((value) =>
    makeSignal({ layer: 'stable_profile', dimension: 'preferenceStyle', label: 'Learning preference', value, confidence: 0.58, sources: ['legacy_snapshot'], observedAt: now, status: 'active' })
  );
  next.stableProfile.commonErrors = asArray(snapshot.misconceptionState.candidates).map((value) =>
    makeSignal({ layer: 'stable_profile', dimension: 'misconceptionState', label: 'Common error', value, confidence: 0.52, sources: ['legacy_snapshot'], observedAt: now, status: 'candidate' })
  );
  next.workingState.recentBehaviorSummary.recentTopics = asArray(snapshot.profileBase.recentTopics).map((value) =>
    makeSignal({ layer: 'working_state', dimension: 'profileBase', label: 'Recent topic', value, confidence: 0.42, sources: ['legacy_snapshot'], observedAt: now, status: 'candidate' })
  );
  next.workingState.currentCourseState.focusKnowledge = [
    ...asArray(snapshot.knowledgeState.targetSkills),
    ...asArray(snapshot.knowledgeState.candidateWeakSkills)
  ].map((value) =>
    makeSignal({ layer: 'working_state', dimension: 'knowledgeState', label: 'Focus knowledge', value, confidence: 0.46, sources: ['legacy_snapshot'], observedAt: now, status: 'candidate' })
  );
  next.workingState.currentCourseState.nextActions = asArray(snapshot.reviewPlanning.nextActions).map((value) =>
    makeSignal({ layer: 'working_state', dimension: 'reviewPlanning', label: 'Next action', value, confidence: 0.5, sources: ['legacy_snapshot'], observedAt: now, status: 'candidate' })
  );
  next.observationMemory.observations = asRecordArray(snapshot.profileBase.transientTopicSignals)
    .map((item) => String(item.topic || item.value || ''))
    .filter(Boolean)
    .map((value) => makeSignal({ layer: 'observation_memory', dimension: 'profileBase', label: 'Short-term observation', value, confidence: 0.36, sources: ['legacy_snapshot'], observedAt: now }));
  next.workingState.recentBehaviorSummary.summary = buildReadableSummary(next);
  return next;
};

export const buildReadableSummary = (state: CentralLearnerStateV2) => {
  const goals = state.stableProfile.learningGoals.slice(0, 2).map((item) => item.value).join('、') || '未稳定';
  const weak = state.stableProfile.weakKnowledge.slice(0, 3).map((item) => item.value).join('、') || '暂无稳定结论';
  const focus = state.workingState.currentCourseState.focusKnowledge.slice(0, 3).map((item) => item.value).join('、') || '等待当前学习上下文';
  const prefs = state.stableProfile.learningPreferences.slice(0, 2).map((item) => item.value).join('、') || '未稳定';
  return [`长期目标: ${goals}`, `当前焦点: ${focus}`, `稳定薄弱点: ${weak}`, `学习偏好: ${prefs}`].join('\n');
};

export const dimensionForSignal = (dimension: LearnerStateDimension) => {
  if (dimension === 'profileBase') return 'profileBase';
  if (dimension === 'knowledgeState') return 'knowledgeState';
  if (dimension === 'misconceptionState') return 'misconceptionState';
  if (dimension === 'preferenceStyle') return 'preferenceStyle';
  if (dimension === 'reviewPlanning') return 'reviewPlanning';
  if (dimension === 'behaviorEngagement') return 'behaviorEngagement';
  if (dimension === 'cognitiveState') return 'cognitiveState';
  return 'confidence';
};
