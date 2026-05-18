import prisma from '../config/db';
import { courseKnowledgeGraphService } from './courseKnowledgeGraphService';
import { filterCleanLearningSignals, filterKnowledgeConcepts, isPollutedLearningSignal, isProbablyKnowledgeConcept } from './learnerSignalSanitizer';
import {
  blankLearnerStateV2,
  buildReadableSummary,
  CentralLearnerStateV2,
  LearnerSignalRecord,
  makeSignal,
  mergeSignals,
  snapshotToStateV2,
  stateV2ToSnapshot
} from './learnerStateModel';

export type LearnerStateDimension =
  | 'profileBase'
  | 'knowledgeState'
  | 'misconceptionState'
  | 'preferenceStyle'
  | 'behaviorEngagement'
  | 'cognitiveState'
  | 'reviewPlanning'
  | 'confidence';

export interface LearnerStateSnapshot {
  profileBase: Record<string, unknown>;
  knowledgeState: Record<string, unknown>;
  misconceptionState: Record<string, unknown>;
  preferenceStyle: Record<string, unknown>;
  behaviorEngagement: Record<string, unknown>;
  cognitiveState: Record<string, unknown>;
  reviewPlanning: Record<string, unknown>;
  confidence: Record<string, unknown>;
}

export interface CentralLearnerState {
  id: string;
  scope: string;
  version: number;
  summary: string;
  state: LearnerStateSnapshot;
  coreState: CentralLearnerStateV2;
  lastEvidenceAt?: string | null;
  updatedAt: string;
}

interface EnsureStateInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  scope?: 'workspace';
}

interface GovernLifecycleInput {
  workspaceId: string;
  workbenchId?: string | null;
  staleTopicDays?: number;
  changedBy?: string;
}

interface RecordEvidenceInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  evidenceType: string;
  sourceType: string;
  sourceId?: string | null;
  actor?: string;
  title?: string;
  summary?: string;
  payload?: unknown;
  confidence?: number;
  observedAt?: Date;
}

interface ProposePatchInput {
  workspaceId: string;
  workbenchId?: string | null;
  targetDimension: LearnerStateDimension;
  operation?: 'merge' | 'append' | 'replace';
  proposedBy?: string;
  payload: Record<string, unknown>;
  rationale?: string;
  confidence?: number;
  evidenceId?: string | null;
}

type CoreRow = {
  id: string;
  scope: string;
  version: number;
  summary: string;
  governanceJson: string;
  currentPositionJson: string;
  lastEvidenceAt?: Date | string | null;
  updatedAt: Date | string;
  workspaceId: string;
  userId: string;
};

type SignalRow = {
  id: string;
  signalKey?: string;
  observationKey?: string;
  layer?: string;
  dimension: string;
  label: string;
  value: string;
  confidence: number;
  status: LearnerSignalRecord['status'] | string;
  evidenceIdsJson: string;
  sourcesJson: string;
  rationale: string;
  firstObservedAt?: Date | string | null;
  lastObservedAt?: Date | string | null;
  observedAt?: Date | string | null;
};

type TransitionRow = {
  id: string;
  status: string;
  proposedBy: string;
  targetDimension: string;
  operation: string;
  confidence: number;
  payloadJson: string;
  rationale: string;
  appliedVersion?: number | null;
  createdAt: Date | string;
  appliedAt?: Date | string | null;
  workspaceId: string;
  workbenchId?: string | null;
  learnerStateCoreId?: string | null;
  evidenceId?: string | null;
  observedAt?: Date | string | null;
};

const dimensions: LearnerStateDimension[] = [
  'profileBase',
  'knowledgeState',
  'misconceptionState',
  'preferenceStyle',
  'behaviorEngagement',
  'cognitiveState',
  'reviewPlanning',
  'confidence'
];

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown, fallback = '{}') => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

const clampConfidence = (value: number | undefined, fallback = 0.6) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
};

const toIso = (value?: Date | string | null) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const asArray = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []);

const asRecordArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : [];

const optionalCount = async (countPromise: Promise<number>) => {
  try {
    return await countPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|no such table|P2021/i.test(message)) return 0;
    throw error;
  }
};

const signalValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value || '');
  const record = value as Record<string, unknown>;
  return String(record.value || record.concept || record.skill || record.targetSkill || record.topic || record.preference || record.text || '').trim();
};

const signalScore = (value: unknown) => {
  if (!value || typeof value !== 'object') return 0.5;
  const record = value as Record<string, unknown>;
  if (typeof record.score === 'number') return Math.max(0, Math.min(1, record.score));
  if (record.rating === 'again') return 0.25;
  if (record.rating === 'hard') return 0.45;
  if (record.rating === 'good') return 0.72;
  if (record.rating === 'easy') return 0.86;
  if (record.correct === true) return 0.78;
  if (record.correct === false) return 0.35;
  return 0.5;
};

const buildSummary = (state: CentralLearnerStateV2) => buildReadableSummary(state);

const sqlDate = (value?: string | Date | null) => value ? new Date(value).toISOString() : null;

const signalFromRow = (row: SignalRow): LearnerSignalRecord => ({
  id: row.signalKey || row.observationKey || row.id,
  label: row.label,
  value: row.value,
  confidence: row.confidence,
  evidenceIds: parseJson<string[]>(row.evidenceIdsJson, []),
  sources: parseJson<string[]>(row.sourcesJson, []),
  firstObservedAt: toIso(row.firstObservedAt || row.observedAt),
  lastObservedAt: toIso(row.lastObservedAt || row.observedAt),
  status: (row.status as LearnerSignalRecord['status']) || 'candidate',
  rationale: row.rationale
});

const rowsToCoreState = (core: CoreRow, signals: SignalRow[], observations: SignalRow[]): CentralLearnerStateV2 => {
  const state = blankLearnerStateV2();
  const cleanSignals = signals.filter((row) => row.dimension === 'knowledgeState' ? isProbablyKnowledgeConcept(row.value) : !isPollutedLearningSignal(row.value));
  const cleanObservations = observations.filter((row) => row.dimension === 'knowledgeState' ? isProbablyKnowledgeConcept(row.value) : !isPollutedLearningSignal(row.value));
  state.governance = {
    ...state.governance,
    ...parseJson<Record<string, unknown>>(core.governanceJson, {})
  } as CentralLearnerStateV2['governance'];
  state.workingState.currentLearningPosition = parseJson(core.currentPositionJson, {});

  const byLayer = (layer: string, dimension?: string, label?: string) =>
    cleanSignals
      .filter((row) => row.layer === layer && (!dimension || row.dimension === dimension) && (!label || row.label === label))
      .map(signalFromRow);

  state.stableProfile.learningGoals = byLayer('stable_profile', 'profileBase', 'Learning goal');
  state.stableProfile.masteredKnowledge = byLayer('stable_profile', 'knowledgeState', 'Mastered knowledge');
  state.stableProfile.weakKnowledge = byLayer('stable_profile', 'knowledgeState', 'Weak knowledge');
  state.stableProfile.learningPreferences = byLayer('stable_profile', 'preferenceStyle', 'Learning preference');
  state.stableProfile.commonErrors = byLayer('stable_profile', 'misconceptionState', 'Common error');
  state.stableProfile.learnerTraits = byLayer('stable_profile', 'cognitiveState', 'Learner trait');
  state.workingState.currentCourseState.activeGoals = byLayer('working_state', 'profileBase', 'Active goal');
  state.workingState.currentCourseState.focusKnowledge = byLayer('working_state', 'knowledgeState', 'Focus knowledge');
  state.workingState.currentCourseState.nextActions = byLayer('working_state', 'reviewPlanning', 'Next action');
  state.workingState.recentBehaviorSummary.recentTopics = byLayer('working_state', 'profileBase', 'Recent topic');
  state.workingState.recentBehaviorSummary.engagementSignals = byLayer('working_state', 'behaviorEngagement');
  state.workingState.recentBehaviorSummary.reviewPressure = byLayer('working_state', 'reviewPlanning', 'Review pressure');
  state.observationMemory.observations = cleanObservations.map(signalFromRow);
  state.observationMemory.candidatePromotions = cleanObservations.filter((row) => row.confidence >= 0.5).map(signalFromRow);
  state.observationMemory.window.oldestObservedAt = state.observationMemory.observations[state.observationMemory.observations.length - 1]?.lastObservedAt || null;
  state.observationMemory.window.newestObservedAt = state.observationMemory.observations[0]?.lastObservedAt || null;
  state.workingState.recentBehaviorSummary.summary = buildSummary(state);
  return state;
};

const stableSignalsFromDimension = (dimension: LearnerStateDimension, payload: Record<string, unknown>, transition: TransitionRow): Partial<CentralLearnerStateV2['stableProfile']> => {
  const observedAt = toIso(transition.observedAt) || new Date().toISOString();
  const evidenceIds = transition.evidenceId ? [transition.evidenceId] : [];
  const source = transition.proposedBy || 'agent';
  const confidence = clampConfidence(transition.confidence);

  if (dimension === 'profileBase') {
    const learningGoals = filterCleanLearningSignals([...asArray(payload.goals), ...asArray(payload.activeLearningGoalSignals)], 12);
    return {
      learningGoals: learningGoals.map((value) =>
        makeSignal({ layer: 'stable_profile', dimension, label: 'Learning goal', value, confidence, evidenceIds, sources: [source], observedAt, status: confidence >= 0.58 ? 'active' : 'candidate', rationale: transition.rationale })
      )
    };
  }
  if (dimension === 'knowledgeState') {
    const masterySignals = asRecordArray(payload.masterySignals);
    const mastered = filterKnowledgeConcepts([...asArray(payload.emergingStrengths), ...masterySignals.filter((item) => signalScore(item) >= 0.75).map(signalValue)], 20);
    const weak = filterKnowledgeConcepts([
      ...asArray(payload.weakSkills),
      ...asArray(payload.candidateWeakSkills).filter(() => confidence >= 0.62),
      ...masterySignals.filter((item) => signalScore(item) < 0.55 && confidence >= 0.6).map(signalValue)
    ], 20);
    return {
      masteredKnowledge: mastered.map((value) =>
        makeSignal({ layer: 'stable_profile', dimension, label: 'Mastered knowledge', value, confidence, evidenceIds, sources: [source], observedAt, status: confidence >= 0.62 ? 'active' : 'candidate', rationale: transition.rationale })
      ),
      weakKnowledge: weak.map((value) =>
        makeSignal({ layer: 'stable_profile', dimension, label: 'Weak knowledge', value, confidence, evidenceIds, sources: [source], observedAt, status: confidence >= 0.62 ? 'active' : 'candidate', rationale: transition.rationale })
      )
    };
  }
  if (dimension === 'preferenceStyle') {
    return {
      learningPreferences: [
        ...asArray(payload.resourcePreference),
        ...asArray(payload.preferredResourceForms),
        ...asArray(payload.tentativeResourcePreferences).filter(() => confidence >= 0.58)
      ].map((value) =>
        makeSignal({ layer: 'stable_profile', dimension, label: 'Learning preference', value, confidence, evidenceIds, sources: [source], observedAt, status: confidence >= 0.58 ? 'active' : 'candidate', rationale: transition.rationale })
      )
    };
  }
  if (dimension === 'misconceptionState') {
    return {
      commonErrors: [...asArray(payload.candidates), ...asArray(payload.candidateMisconceptions)].filter(() => confidence >= 0.5).map((value) =>
        makeSignal({ layer: 'stable_profile', dimension, label: 'Common error', value, confidence, evidenceIds, sources: [source], observedAt, status: confidence >= 0.62 ? 'active' : 'candidate', rationale: transition.rationale })
      )
    };
  }
  if (dimension === 'cognitiveState') {
    return {
      learnerTraits: [...asArray(payload.learnerTraits), ...asArray(payload.recurringQuestionPatterns)].map((value) =>
        makeSignal({ layer: 'stable_profile', dimension, label: 'Learner trait', value, confidence, evidenceIds, sources: [source], observedAt, status: confidence >= 0.58 ? 'active' : 'candidate', rationale: transition.rationale })
      )
    };
  }
  return {};
};

const observationSignalsFromTransition = (dimension: LearnerStateDimension, payload: Record<string, unknown>, transition: TransitionRow): LearnerSignalRecord[] => {
  const observedAt = toIso(transition.observedAt) || new Date().toISOString();
  const evidenceIds = transition.evidenceId ? [transition.evidenceId] : [];
  const source = transition.proposedBy || 'agent';
  const confidence = Math.min(clampConfidence(transition.confidence), 0.58);
  const make = (label: string, value: string) =>
    makeSignal({ layer: 'observation_memory', dimension, label, value, confidence, evidenceIds, sources: [source], observedAt, status: 'candidate', rationale: transition.rationale });

  if (dimension === 'profileBase') {
    return [
      ...filterCleanLearningSignals(asArray(payload.recentTopics), 12).map((value) => make('Recent topic observation', value)),
      ...filterCleanLearningSignals(asRecordArray(payload.transientTopicSignals).map(signalValue).filter(Boolean), 12).map((value) => make('Recent topic observation', value)),
      ...filterCleanLearningSignals(asArray(payload.activeLearningGoalSignals), 8).map((value) => make('Goal observation', value))
    ];
  }
  if (dimension === 'knowledgeState') {
    return [
      ...filterKnowledgeConcepts(asArray(payload.candidateWeakSkills), 12).map((value) => make('Candidate weak knowledge', value)),
      ...filterKnowledgeConcepts(asRecordArray(payload.weakSkillSignals).map(signalValue).filter(Boolean), 12).map((value) => make('Candidate weak knowledge', value)),
      ...filterKnowledgeConcepts(asRecordArray(payload.masterySignals).map(signalValue).filter(Boolean), 12).map((value) => make('Mastery observation', value))
    ];
  }
  if (dimension === 'preferenceStyle') {
    return [
      ...asArray(payload.tentativeResourcePreferences).map((value) => make('Preference observation', value)),
      ...asRecordArray(payload.explanationPreferenceSignals).map(signalValue).filter(Boolean).map((value) => make('Preference observation', value))
    ];
  }
  if (dimension === 'behaviorEngagement') {
    return [...asArray(payload.questionPatterns), ...asArray(payload.recurringQuestionPatterns)].map((value) => make('Engagement observation', value));
  }
  if (dimension === 'reviewPlanning') {
    return [
      ...asArray(payload.reviewPressureSignals).map((value) => make('Review pressure observation', value)),
      ...asRecordArray(payload.recentFlashcardReviews).map(signalValue).filter(Boolean).map((value) => make('Review pressure observation', value))
    ];
  }
  if (dimension === 'misconceptionState') {
    return [...asArray(payload.candidateMisconceptions), ...asArray(payload.candidates)].map((value) => make('Misconception observation', value));
  }
  return [];
};

const applyCoreTransition = (state: CentralLearnerStateV2, transition: TransitionRow) => {
  if (!dimensions.includes(transition.targetDimension as LearnerStateDimension)) return state;
  const dimension = transition.targetDimension as LearnerStateDimension;
  const payload = parseJson<Record<string, unknown>>(transition.payloadJson, {});
  const next: CentralLearnerStateV2 = JSON.parse(JSON.stringify(state));
  const stable = stableSignalsFromDimension(dimension, payload, transition);
  next.stableProfile.learningGoals = mergeSignals(next.stableProfile.learningGoals, stable.learningGoals || [], 20);
  next.stableProfile.masteredKnowledge = mergeSignals(next.stableProfile.masteredKnowledge, stable.masteredKnowledge || [], 30);
  next.stableProfile.weakKnowledge = mergeSignals(next.stableProfile.weakKnowledge, stable.weakKnowledge || [], 30);
  next.stableProfile.learningPreferences = mergeSignals(next.stableProfile.learningPreferences, stable.learningPreferences || [], 20);
  next.stableProfile.commonErrors = mergeSignals(next.stableProfile.commonErrors, stable.commonErrors || [], 20);
  next.stableProfile.learnerTraits = mergeSignals(next.stableProfile.learnerTraits, stable.learnerTraits || [], 20);

  const observations = observationSignalsFromTransition(dimension, payload, transition);
  next.observationMemory.observations = mergeSignals(next.observationMemory.observations, observations, next.observationMemory.window.maxItems || 40);
  next.observationMemory.candidatePromotions = mergeSignals(next.observationMemory.candidatePromotions, observations.filter((item) => item.confidence >= 0.5), 20);

  const observedAt = toIso(transition.observedAt) || new Date().toISOString();
  const evidenceIds = transition.evidenceId ? [transition.evidenceId] : [];
  if (dimension === 'profileBase') {
    next.workingState.currentCourseState.activeGoals = mergeSignals(
      next.workingState.currentCourseState.activeGoals,
      filterCleanLearningSignals([...asArray(payload.goals), ...asArray(payload.activeLearningGoalSignals)], 8).map((value) =>
        makeSignal({ layer: 'working_state', dimension, label: 'Active goal', value, confidence: transition.confidence, evidenceIds, sources: [transition.proposedBy], observedAt })
      ),
      8
    );
    next.workingState.recentBehaviorSummary.recentTopics = mergeSignals(
      next.workingState.recentBehaviorSummary.recentTopics,
      observations.filter((item) => item.label === 'Recent topic observation').map((item) => ({ ...item, id: item.id.replace('observation_memory', 'working_state'), label: 'Recent topic' })),
      12
    );
  }
  if (dimension === 'knowledgeState') {
    next.workingState.currentCourseState.focusKnowledge = mergeSignals(
      next.workingState.currentCourseState.focusKnowledge,
      filterKnowledgeConcepts([...asArray(payload.targetSkills), ...asArray(payload.candidateWeakSkills), ...asRecordArray(payload.masterySignals).map(signalValue)].filter(Boolean), 16).map((value) =>
        makeSignal({ layer: 'working_state', dimension, label: 'Focus knowledge', value, confidence: transition.confidence, evidenceIds, sources: [transition.proposedBy], observedAt })
      ),
      16
    );
  }
  if (dimension === 'behaviorEngagement') {
    next.workingState.recentBehaviorSummary.engagementSignals = mergeSignals(next.workingState.recentBehaviorSummary.engagementSignals, observations, 16);
  }
  if (dimension === 'reviewPlanning') {
    next.workingState.currentCourseState.nextActions = mergeSignals(
      next.workingState.currentCourseState.nextActions,
      asArray(payload.nextActions).map((value) =>
        makeSignal({ layer: 'working_state', dimension, label: 'Next action', value, confidence: transition.confidence, evidenceIds, sources: [transition.proposedBy], observedAt })
      ),
      12
    );
    next.workingState.recentBehaviorSummary.reviewPressure = mergeSignals(
      next.workingState.recentBehaviorSummary.reviewPressure,
      observations.map((item) => ({ ...item, id: item.id.replace('observation_memory', 'working_state'), label: 'Review pressure' })),
      16
    );
  }
  next.observationMemory.window.oldestObservedAt = next.observationMemory.observations[next.observationMemory.observations.length - 1]?.lastObservedAt || null;
  next.observationMemory.window.newestObservedAt = next.observationMemory.observations[0]?.lastObservedAt || null;
  next.workingState.recentBehaviorSummary.summary = buildSummary(next);
  return next;
};

export class LearnerStateService {
  private async loadCoreRow(workspaceId: string, scope = 'workspace') {
    const rows = await prisma.$queryRawUnsafe<CoreRow[]>(
      `SELECT * FROM "LearnerStateCore" WHERE "workspaceId" = ? AND "scope" = ? LIMIT 1`,
      workspaceId,
      scope
    );
    return rows[0] || null;
  }

  private async loadState(core: CoreRow): Promise<CentralLearnerState> {
    const [signals, observations] = await Promise.all([
      prisma.$queryRawUnsafe<SignalRow[]>(`SELECT * FROM "LearnerStateSignal" WHERE "learnerStateCoreId" = ? ORDER BY "updatedAt" DESC`, core.id),
      prisma.$queryRawUnsafe<SignalRow[]>(`SELECT * FROM "LearnerObservation" WHERE "learnerStateCoreId" = ? AND "status" = 'active' ORDER BY "observedAt" DESC`, core.id)
    ]);
    const coreState = rowsToCoreState(core, signals, observations);
    const state = stateV2ToSnapshot(coreState);
    return {
      id: core.id,
      scope: core.scope,
      version: core.version,
      summary: core.summary || buildSummary(coreState),
      state,
      coreState,
      lastEvidenceAt: toIso(core.lastEvidenceAt),
      updatedAt: toIso(core.updatedAt) || new Date().toISOString()
    };
  }

  private async saveSignals(tx: any, coreId: string, workspaceId: string, state: CentralLearnerStateV2) {
    const stableSignals = [
      ...state.stableProfile.learningGoals.map((signal) => ({ ...signal, layer: 'stable_profile', dimension: 'profileBase' })),
      ...state.stableProfile.masteredKnowledge.map((signal) => ({ ...signal, layer: 'stable_profile', dimension: 'knowledgeState' })),
      ...state.stableProfile.weakKnowledge.map((signal) => ({ ...signal, layer: 'stable_profile', dimension: 'knowledgeState' })),
      ...state.stableProfile.learningPreferences.map((signal) => ({ ...signal, layer: 'stable_profile', dimension: 'preferenceStyle' })),
      ...state.stableProfile.commonErrors.map((signal) => ({ ...signal, layer: 'stable_profile', dimension: 'misconceptionState' })),
      ...state.stableProfile.learnerTraits.map((signal) => ({ ...signal, layer: 'stable_profile', dimension: 'cognitiveState' })),
      ...state.workingState.currentCourseState.activeGoals.map((signal) => ({ ...signal, layer: 'working_state', dimension: 'profileBase' })),
      ...state.workingState.currentCourseState.focusKnowledge.map((signal) => ({ ...signal, layer: 'working_state', dimension: 'knowledgeState' })),
      ...state.workingState.currentCourseState.nextActions.map((signal) => ({ ...signal, layer: 'working_state', dimension: 'reviewPlanning' })),
      ...state.workingState.recentBehaviorSummary.recentTopics.map((signal) => ({ ...signal, layer: 'working_state', dimension: 'profileBase' })),
      ...state.workingState.recentBehaviorSummary.engagementSignals.map((signal) => ({ ...signal, layer: 'working_state', dimension: 'behaviorEngagement' })),
      ...state.workingState.recentBehaviorSummary.reviewPressure.map((signal) => ({ ...signal, layer: 'working_state', dimension: 'reviewPlanning' }))
    ];
    for (const signal of stableSignals) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "LearnerStateSignal" ("id","signalKey","layer","dimension","label","value","confidence","status","evidenceIdsJson","sourcesJson","rationale","firstObservedAt","lastObservedAt","workspaceId","learnerStateCoreId","updatedAt")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT("learnerStateCoreId","signalKey") DO UPDATE SET
           "layer"=excluded."layer","dimension"=excluded."dimension","label"=excluded."label","value"=excluded."value","confidence"=excluded."confidence","status"=excluded."status",
           "evidenceIdsJson"=excluded."evidenceIdsJson","sourcesJson"=excluded."sourcesJson","rationale"=excluded."rationale","firstObservedAt"=excluded."firstObservedAt","lastObservedAt"=excluded."lastObservedAt","updatedAt"=CURRENT_TIMESTAMP`,
        signal.id,
        signal.id,
        signal.layer,
        signal.dimension,
        signal.label,
        signal.value,
        signal.confidence,
        signal.status,
        stringify(signal.evidenceIds, '[]'),
        stringify(signal.sources, '[]'),
        signal.rationale || '',
        sqlDate(signal.firstObservedAt),
        sqlDate(signal.lastObservedAt),
        workspaceId,
        coreId
      );
    }
    for (const observation of state.observationMemory.observations) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "LearnerObservation" ("id","observationKey","dimension","label","value","confidence","status","evidenceIdsJson","sourcesJson","rationale","observedAt","workspaceId","learnerStateCoreId","updatedAt")
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT("learnerStateCoreId","observationKey") DO UPDATE SET
           "dimension"=excluded."dimension","label"=excluded."label","value"=excluded."value","confidence"=excluded."confidence","status"=excluded."status",
           "evidenceIdsJson"=excluded."evidenceIdsJson","sourcesJson"=excluded."sourcesJson","rationale"=excluded."rationale","observedAt"=excluded."observedAt","updatedAt"=CURRENT_TIMESTAMP`,
        observation.id,
        observation.id,
        observation.id.includes(':knowledgeState:') ? 'knowledgeState' :
          observation.id.includes(':preferenceStyle:') ? 'preferenceStyle' :
            observation.id.includes(':reviewPlanning:') ? 'reviewPlanning' :
              observation.id.includes(':misconceptionState:') ? 'misconceptionState' :
                observation.id.includes(':behaviorEngagement:') ? 'behaviorEngagement' : 'profileBase',
        observation.label,
        observation.value,
        observation.confidence,
        'active',
        stringify(observation.evidenceIds, '[]'),
        stringify(observation.sources, '[]'),
        observation.rationale || '',
        sqlDate(observation.lastObservedAt || observation.firstObservedAt),
        workspaceId,
        coreId
      );
    }
  }

  private async createSnapshotVersion(tx: any, input: {
    workspaceId: string;
    coreId: string;
    version: number;
    state: CentralLearnerStateV2;
    changedBy: string;
    reason: string;
    transitionIds?: string[];
    evidenceIds?: string[];
  }) {
    const projected = stateV2ToSnapshot(input.state);
    await tx.$executeRawUnsafe(
      `INSERT INTO "LearnerStateSnapshotVersion" ("id","version","snapshotJson","summary","changedBy","changeReason","transitionIdsJson","evidenceIdsJson","confidenceJson","workspaceId","learnerStateCoreId")
       VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),?,?,?,?,?,?,?,?,?,?)`,
      input.version,
      stringify(input.state),
      buildSummary(input.state),
      input.changedBy,
      input.reason,
      stringify(input.transitionIds || [], '[]'),
      stringify(input.evidenceIds || [], '[]'),
      stringify(projected.confidence),
      input.workspaceId,
      input.coreId
    );
  }

  async ensureState(input: EnsureStateInput): Promise<CentralLearnerState> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');
    const scope = input.scope || 'workspace';
    const existing = await this.loadCoreRow(input.workspaceId, scope);
    if (existing) return this.loadState(existing);

    const initialSnapshot = await this.buildInitialSnapshot(input.workspaceId, input.workbenchId || null, input.goalId || null);
    const coreState = snapshotToStateV2(initialSnapshot, { workbenchId: input.workbenchId || null, goalId: input.goalId || null });
    const summary = buildSummary(coreState);
    const coreId = await prisma.$transaction(async (tx) => {
      const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "LearnerStateCore" ("id","scope","version","summary","governanceJson","currentPositionJson","workspaceId","userId")
         VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),?,?,?,?,?,?,?)
         RETURNING "id"`,
        scope,
        1,
        summary,
        stringify(coreState.governance),
        stringify(coreState.workingState.currentLearningPosition),
        input.workspaceId,
        workspace.userId
      );
      const id = inserted[0].id;
      await this.saveSignals(tx, id, input.workspaceId, coreState);
      await this.createSnapshotVersion(tx, {
        workspaceId: input.workspaceId,
        coreId: id,
        version: 1,
        state: coreState,
        changedBy: 'system',
        reason: 'Initial learner state core created with normalized profile, working-state, and observation tables.'
      });
      return id;
    });
    const row = await this.loadCoreRow(input.workspaceId, scope);
    if (!row || row.id !== coreId) throw new Error('Failed to initialize learner state core');
    return this.loadState(row);
  }

  async recordEvidence(input: RecordEvidenceInput) {
    return prisma.learnerEvidence.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        evidenceType: input.evidenceType,
        sourceType: input.sourceType,
        sourceId: input.sourceId || null,
        actor: input.actor || 'system',
        title: input.title || '',
        summary: input.summary || '',
        payloadJson: stringify(input.payload || {}),
        confidence: clampConfidence(input.confidence),
        observedAt: input.observedAt || new Date()
      }
    });
  }

  async proposePatch(input: ProposePatchInput) {
    const state = await this.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null });
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO "LearnerStateTransition" ("id","status","proposedBy","targetDimension","operation","confidence","payloadJson","rationale","workspaceId","workbenchId","learnerStateCoreId","evidenceId")
       VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),?,?,?,?,?,?,?,?,?,?,?)
       RETURNING *`,
      'pending',
      input.proposedBy || 'agent',
      input.targetDimension,
      input.operation || 'merge',
      clampConfidence(input.confidence),
      stringify(input.payload),
      input.rationale || '',
      input.workspaceId,
      input.workbenchId || null,
      state.id,
      input.evidenceId || null
    );
    return rows[0] as any;
  }

  async applyPendingPatches(workspaceId: string, options: { limit?: number; changedBy?: string } = {}) {
    const current = await this.ensureState({ workspaceId });
    const transitions = await prisma.$queryRawUnsafe<TransitionRow[]>(
      `SELECT t.*, e."observedAt" as "observedAt"
       FROM "LearnerStateTransition" t
       LEFT JOIN "LearnerEvidence" e ON e."id" = t."evidenceId"
       WHERE t."workspaceId" = ? AND t."status" = 'pending' AND t."learnerStateCoreId" = ?
       ORDER BY t."createdAt" ASC
       LIMIT ?`,
      workspaceId,
      current.id,
      Math.min(Math.max(options.limit || 20, 1), 100)
    );
    if (!transitions.length) return current;

    const nextCore = transitions.reduce((state, transition) => applyCoreTransition(state, transition), current.coreState);
    nextCore.governance.lastConsolidatedAt = new Date().toISOString();
    nextCore.workingState.recentBehaviorSummary.summary = buildSummary(nextCore);
    const nextVersion = current.version + 1;
    const summary = buildSummary(nextCore);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "LearnerStateCore" SET "version" = ?, "summary" = ?, "governanceJson" = ?, "currentPositionJson" = ?, "lastEvidenceAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
        nextVersion,
        summary,
        stringify(nextCore.governance),
        stringify(nextCore.workingState.currentLearningPosition),
        current.id
      );
      await this.saveSignals(tx, current.id, workspaceId, nextCore);
      await this.createSnapshotVersion(tx, {
        workspaceId,
        coreId: current.id,
        version: nextVersion,
        state: nextCore,
        changedBy: options.changedBy || 'LearnerStateUpdateManager',
        reason: `Applied ${transitions.length} learner-state transition(s) into normalized learner state tables.`,
        transitionIds: transitions.map((transition) => transition.id),
        evidenceIds: transitions.map((transition) => transition.evidenceId).filter(Boolean) as string[]
      });
      await tx.$executeRawUnsafe(
        `UPDATE "LearnerStateTransition" SET "status" = 'applied', "appliedVersion" = ?, "appliedAt" = CURRENT_TIMESTAMP WHERE "id" IN (${transitions.map(() => '?').join(',')})`,
        nextVersion,
        ...transitions.map((transition) => transition.id)
      );
    });

    const row = await this.loadCoreRow(workspaceId);
    if (!row) throw new Error('Learner state core disappeared after transition application');
    const applied = await this.loadState(row);
    await this.syncCourseKnowledgeLearnerState(workspaceId, applied.coreState).catch((error) => {
      console.warn('Failed to sync course KG learner state:', error);
    });
    return applied;
  }

  private async syncCourseKnowledgeLearnerState(workspaceId: string, state: CentralLearnerStateV2) {
    const updates = [
      ...state.stableProfile.masteredKnowledge.map((signal) => ({ signal, layer: 'stable' as const, masteryDelta: 0.12, weaknessDelta: -0.08, readinessDelta: 0.1 })),
      ...state.stableProfile.weakKnowledge.map((signal) => ({ signal, layer: 'stable' as const, masteryDelta: -0.04, weaknessDelta: 0.14, readinessDelta: -0.08 })),
      ...state.workingState.currentCourseState.focusKnowledge.map((signal) => ({ signal, layer: 'working' as const, masteryDelta: 0.02, weaknessDelta: 0.02, readinessDelta: 0.04 }))
    ].filter((update) => this.shouldSyncSignalToCourseKnowledgeGraph(update.signal, update.layer));
    for (const update of updates.slice(0, 40)) {
      const title = String(update.signal.value || '').trim();
      if (!isProbablyKnowledgeConcept(title)) continue;
      const concept = await courseKnowledgeGraphService.upsertConcept({
        workspaceId,
        title,
        source: 'learner_state_sync',
        evidence: {
          signalId: update.signal.id,
          label: update.signal.label,
          confidence: update.signal.confidence,
          sources: update.signal.sources
        }
      });
      await courseKnowledgeGraphService.updateLearnerConceptState({
        workspaceId,
        conceptId: concept.id,
        masteryDelta: update.masteryDelta * (update.signal.confidence || 0.5),
        weaknessDelta: update.weaknessDelta * (update.signal.confidence || 0.5),
        readinessDelta: update.readinessDelta * (update.signal.confidence || 0.5),
        sourceSignalId: update.signal.id,
        evidence: {
          source: 'learner_state_signal',
          label: update.signal.label,
          value: update.signal.value,
          confidence: update.signal.confidence
        }
      });
    }
  }

  private shouldSyncSignalToCourseKnowledgeGraph(signal: LearnerSignalRecord, layer: 'stable' | 'working') {
    const title = String(signal.value || '').trim();
    if (!isProbablyKnowledgeConcept(title)) return false;
    const confidence = Number(signal.confidence || 0);
    const sources = (signal.sources || []).join(' ');
    const rawConversationSource = /LearnerStateAnalyzer\.chat|MemoryExtractor\.(recent_topic|active_learning_goal|candidate_weak_concept)/i.test(sources);
    if (layer === 'stable') return signal.status === 'active' && confidence >= 0.58 && !rawConversationSource;
    if (rawConversationSource) return false;
    return confidence >= 0.58;
  }

  async refreshFromExistingEvidence(input: EnsureStateInput) {
    const snapshot = await this.buildInitialSnapshot(input.workspaceId, input.workbenchId || null, input.goalId || null);
    const evidence = await this.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'centralized_learner_state_refresh',
      sourceType: 'existing_learning_memory',
      title: 'Learner state core refresh',
      summary: 'Reseeded normalized learner state tables from existing goals, traces, plans and reviews.',
      payload: snapshot,
      confidence: 0.68
    });
    for (const dimension of dimensions) {
      await this.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: dimension,
        operation: 'merge',
        proposedBy: 'LearnerStateCoreRefresh',
        payload: snapshot[dimension],
        evidenceId: evidence.id,
        confidence: 0.68,
        rationale: 'Refresh existing learning records into normalized learner state as governed transition proposals.'
      });
    }
    return this.applyPendingPatches(input.workspaceId, { changedBy: 'LearnerStateCoreRefresh' });
  }

  async governLifecycle(input: GovernLifecycleInput) {
    const current = await this.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null });
    return { state: current, lifecycleEvents: ['Lifecycle promotion is intentionally deferred while the normalized learner-state foundation is stabilized.'], changed: false };
  }

  private async buildInitialSnapshot(
    workspaceId: string,
    workbenchId?: string | null,
    goalId?: string | null
  ): Promise<LearnerStateSnapshot> {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const [profile, goals, traces, activePlan, dueCards, reviewCount, eventCount] = await Promise.all([
      prisma.profile.findFirst({ where: { userId: workspace.userId, workspaceId } }),
      prisma.learningGoal.findMany({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, take: 5 }),
      prisma.learningTrace.findMany({
        where: { workspaceId, ...(workbenchId ? { workbenchId } : {}), ...(goalId ? { goalId } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 8
      }),
      prisma.learningPlan.findFirst({
        where: { workspaceId, status: 'active', ...(workbenchId ? { workbenchId } : {}), ...(goalId ? { goalId } : {}) },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }]
      }),
      optionalCount(prisma.flashcard.count({ where: { workspaceId, suspended: false, dueAt: { lte: new Date() } } })),
      optionalCount(prisma.flashcardReviewLog.count({ where: { workspaceId } })),
      prisma.learningEvent.count({ where: { workspaceId } })
    ]);

    const preferences = parseJson<Record<string, unknown>>(profile?.preferences, {});
    const goalSkills = goals.flatMap((goal) => parseJson<string[]>(goal.skillsJson, []));
    const goalWeaknesses = goals.flatMap((goal) => parseJson<string[]>(goal.weaknessesJson, []));
    const traceMastery = traces.map((trace) => parseJson<Record<string, unknown>>(trace.masteryJson, {}));
    const traceNextActions = traces.flatMap((trace) => parseJson<string[]>(trace.nextActionsJson, []));
    const diagnostic = parseJson<Record<string, unknown>>(activePlan?.diagnosticReportJson, {});
    const planWeakSkills = parseJson<string[]>(activePlan?.weakSkillsJson, []);
    const planTargetSkills = parseJson<string[]>(activePlan?.targetSkillsJson, []);
    const misconceptionCandidates = [...goalWeaknesses, ...planWeakSkills].filter((item) => /错|误|混淆|不清|薄弱|gap|weak/i.test(item));

    return {
      profileBase: {
        workspace: { id: workspace.id, name: workspace.name, description: workspace.description, major: workspace.major },
        goals: goals.map((goal) => goal.goalText).slice(0, 5),
        background: preferences.background || preferences.knowledgeLevel || null,
        priorKnowledge: preferences.priorKnowledge || preferences.knowledgeLevel || null,
        currentLearningPosition: {
          courseTitle: workspace.name,
          workbenchId,
          goalId: goalId || activePlan?.goalId || goals[0]?.id || null,
          updatedAt: new Date().toISOString()
        }
      },
      knowledgeState: {
        targetSkills: Array.from(new Set([...goalSkills, ...planTargetSkills])),
        weakSkills: Array.from(new Set([...goalWeaknesses, ...planWeakSkills])),
        masterySignals: traceMastery.slice(0, 6),
        activePlanId: activePlan?.id || null
      },
      misconceptionState: {
        candidates: misconceptionCandidates.slice(0, 8),
        repairStrategies: Array.isArray(diagnostic.prerequisiteGaps) ? ['插入前置讲解', '降低练习难度', '增加错因复盘'] : []
      },
      preferenceStyle: {
        learningPreference: preferences.learningPreference || null,
        cognitiveStyle: preferences.cognitiveStyle || null,
        resourcePreference: preferences.resourcePreference || diagnostic.preferredResourceForms || []
      },
      behaviorEngagement: {
        eventCount,
        traceCount: traces.length,
        recentTraceSummaries: traces.map((trace) => trace.summary).slice(0, 5),
        engagementSignals: { hasRepeatedReviews: reviewCount > 0, hasRecentTrace: traces.length > 0 }
      },
      cognitiveState: {
        learnerLevel: diagnostic.learnerLevel || preferences.knowledgeLevel || 'unknown',
        cognitiveLoadTolerance: diagnostic.cognitiveLoadTolerance || null,
        recommendedDifficultyBand: diagnostic.recommendedDifficultyBand || null,
        zpdSignals: { prerequisiteGaps: diagnostic.prerequisiteGaps || [], strengths: diagnostic.strengths || [] }
      },
      reviewPlanning: {
        dueFlashcards: dueCards,
        reviewCount,
        nextActions: traceNextActions.slice(0, 8),
        activePlanNextStepId: activePlan?.nextStepId || null
      },
      confidence: {
        source: 'existing_learning_memory',
        confidence: traces.length || activePlan ? 0.68 : 0.45,
        evidenceCount: traces.length + goals.length + reviewCount + eventCount,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

export const learnerStateService = new LearnerStateService();
