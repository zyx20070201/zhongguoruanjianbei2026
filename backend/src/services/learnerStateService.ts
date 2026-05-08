import prisma from '../config/db';

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

const optionalCount = async (countPromise: Promise<number>) => {
  try {
    return await countPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|no such table|P2021/i.test(message)) return 0;
    throw error;
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

const appendUnique = (left: unknown, right: unknown) => {
  const base = Array.isArray(left) ? left : [];
  const incoming = Array.isArray(right) ? right : [right].filter(Boolean);
  const seen = new Set<string>();
  return [...base, ...incoming].filter((item) => {
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeValue = (current: unknown, patch: unknown): unknown => {
  if (Array.isArray(current) || Array.isArray(patch)) return appendUnique(current, patch);
  if (
    current &&
    patch &&
    typeof current === 'object' &&
    typeof patch === 'object' &&
    !Array.isArray(current) &&
    !Array.isArray(patch)
  ) {
    return mergeObjects(current as Record<string, unknown>, patch as Record<string, unknown>);
  }
  return patch ?? current;
};

const mergeObjects = (current: Record<string, unknown>, patch: Record<string, unknown>) => {
  const next = { ...current };
  Object.entries(patch).forEach(([key, value]) => {
    next[key] = mergeValue(next[key], value);
  });
  return next;
};

const asArray = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []);

const asRecordArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : [];

const uniqueStrings = (items: string[], limit = 20) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);

const observedTime = (value: unknown) => {
  if (!value || typeof value !== 'object') return 0;
  const raw = (value as Record<string, unknown>).observedAt || (value as Record<string, unknown>).createdAt || (value as Record<string, unknown>).updatedAt;
  if (typeof raw !== 'string') return 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
};

const conceptFromSignal = (value: unknown) => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return String(record.concept || record.skill || record.targetSkill || '').trim();
};

const scoreFromSignal = (value: unknown) => {
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

const blankSnapshot = (): LearnerStateSnapshot => ({
  profileBase: {},
  knowledgeState: {},
  misconceptionState: {},
  preferenceStyle: {},
  behaviorEngagement: {},
  cognitiveState: {},
  reviewPlanning: {},
  confidence: {}
});

const buildSummary = (state: LearnerStateSnapshot) => {
  const goals = Array.isArray(state.profileBase.goals) ? state.profileBase.goals.slice(0, 2).join('、') : '未明确';
  const weakSkills = Array.isArray(state.knowledgeState.weakSkills)
    ? state.knowledgeState.weakSkills.slice(0, 3).join('、')
    : '暂无稳定证据';
  const level = String(state.cognitiveState.learnerLevel || 'unknown');
  const load = String(state.cognitiveState.cognitiveLoadTolerance || 'unknown');
  const next = Array.isArray(state.reviewPlanning.nextActions)
    ? state.reviewPlanning.nextActions.slice(0, 2).join('、')
    : '等待下一步诊断';

  return [`目标: ${goals}`, `水平: ${level}`, `负荷: ${load}`, `薄弱点: ${weakSkills}`, `下一步: ${next}`].join('\n');
};

const mapRecord = (record: any): CentralLearnerState => {
  const fromStateJson = parseJson<Partial<LearnerStateSnapshot>>(record.stateJson, {});
  const state: LearnerStateSnapshot = {
    profileBase: parseJson(record.profileBaseJson, fromStateJson.profileBase || {}),
    knowledgeState: parseJson(record.knowledgeStateJson, fromStateJson.knowledgeState || {}),
    misconceptionState: parseJson(record.misconceptionStateJson, fromStateJson.misconceptionState || {}),
    preferenceStyle: parseJson(record.preferenceStyleJson, fromStateJson.preferenceStyle || {}),
    behaviorEngagement: parseJson(record.behaviorEngagementJson, fromStateJson.behaviorEngagement || {}),
    cognitiveState: parseJson(record.cognitiveStateJson, fromStateJson.cognitiveState || {}),
    reviewPlanning: parseJson(record.reviewPlanningJson, fromStateJson.reviewPlanning || {}),
    confidence: parseJson(record.confidenceJson, fromStateJson.confidence || {})
  };

  return {
    id: record.id,
    scope: record.scope,
    version: record.version,
    summary: record.summary || buildSummary(state),
    state,
    lastEvidenceAt: record.lastEvidenceAt?.toISOString?.() || null,
    updatedAt: record.updatedAt.toISOString()
  };
};

export class LearnerStateService {
  async ensureState(input: EnsureStateInput): Promise<CentralLearnerState> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const existing = await prisma.learnerState.findFirst({
      where: { workspaceId: input.workspaceId, scope: input.scope || 'workspace' }
    });
    if (existing) return mapRecord(existing);

    const initial = await this.buildInitialSnapshot(input.workspaceId, input.workbenchId || null, input.goalId || null);
    const summary = buildSummary(initial);
    const created = await prisma.learnerState.create({
      data: {
        workspaceId: input.workspaceId,
        userId: workspace.userId,
        scope: input.scope || 'workspace',
        version: 1,
        stateJson: stringify(initial),
        summary,
        profileBaseJson: stringify(initial.profileBase),
        knowledgeStateJson: stringify(initial.knowledgeState),
        misconceptionStateJson: stringify(initial.misconceptionState),
        preferenceStyleJson: stringify(initial.preferenceStyle),
        behaviorEngagementJson: stringify(initial.behaviorEngagement),
        cognitiveStateJson: stringify(initial.cognitiveState),
        reviewPlanningJson: stringify(initial.reviewPlanning),
        confidenceJson: stringify(initial.confidence)
      }
    });

    await prisma.learnerStateVersion.create({
      data: {
        workspaceId: input.workspaceId,
        learnerStateId: created.id,
        version: 1,
        stateJson: stringify(initial),
        summary,
        changedBy: 'system',
        changeReason: 'Initial learner state seeded from existing profile, goals, traces and plans.',
        confidenceJson: stringify(initial.confidence)
      }
    });

    return mapRecord(created);
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
    return prisma.learnerStatePatch.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        learnerStateId: state.id,
        evidenceId: input.evidenceId || null,
        targetDimension: input.targetDimension,
        operation: input.operation || 'merge',
        proposedBy: input.proposedBy || 'agent',
        payloadJson: stringify(input.payload),
        rationale: input.rationale || '',
        confidence: clampConfidence(input.confidence)
      }
    });
  }

  async applyPendingPatches(workspaceId: string, options: { limit?: number; changedBy?: string } = {}) {
    const current = await this.ensureState({ workspaceId });
    const patches = await prisma.learnerStatePatch.findMany({
      where: { workspaceId, status: 'pending', learnerStateId: current.id },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(options.limit || 20, 1), 100)
    });

    if (!patches.length) return current;

    const nextState = patches.reduce((state, patch) => {
      if (!dimensions.includes(patch.targetDimension as LearnerStateDimension)) return state;
      const dimension = patch.targetDimension as LearnerStateDimension;
      const payload = parseJson<Record<string, unknown>>(patch.payloadJson, {});
      const nextDimension =
        patch.operation === 'replace'
          ? payload
          : mergeObjects(state[dimension] as Record<string, unknown>, payload);
      return { ...state, [dimension]: nextDimension };
    }, current.state);
    nextState.confidence = mergeObjects(nextState.confidence, {
      lastPatchConfidence: Number(
        (patches.reduce((sum, patch) => sum + patch.confidence, 0) / Math.max(patches.length, 1)).toFixed(2)
      ),
      evidenceCount: (Number(nextState.confidence.evidenceCount) || 0) + patches.filter((patch) => patch.evidenceId).length,
      updatedBy: options.changedBy || 'LearnerStateUpdateManager'
    });

    const nextVersion = current.version + 1;
    const summary = buildSummary(nextState);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.learnerState.update({
        where: { id: current.id },
        data: {
          version: nextVersion,
          stateJson: stringify(nextState),
          summary,
          profileBaseJson: stringify(nextState.profileBase),
          knowledgeStateJson: stringify(nextState.knowledgeState),
          misconceptionStateJson: stringify(nextState.misconceptionState),
          preferenceStyleJson: stringify(nextState.preferenceStyle),
          behaviorEngagementJson: stringify(nextState.behaviorEngagement),
          cognitiveStateJson: stringify(nextState.cognitiveState),
          reviewPlanningJson: stringify(nextState.reviewPlanning),
          confidenceJson: stringify(nextState.confidence),
          lastEvidenceAt: new Date()
        }
      });
      await tx.learnerStateVersion.create({
        data: {
          workspaceId,
          learnerStateId: current.id,
          version: nextVersion,
          stateJson: stringify(nextState),
          summary,
          changedBy: options.changedBy || 'LearnerStateUpdateManager',
          changeReason: `Applied ${patches.length} pending learner state patch(es).`,
          patchIdsJson: stringify(patches.map((patch) => patch.id), '[]'),
          evidenceIdsJson: stringify(patches.map((patch) => patch.evidenceId).filter(Boolean), '[]'),
          confidenceJson: stringify(nextState.confidence)
        }
      });
      await tx.learnerStatePatch.updateMany({
        where: { id: { in: patches.map((patch) => patch.id) } },
        data: {
          status: 'applied',
          appliedVersion: nextVersion,
          appliedAt: new Date()
        }
      });
      return saved;
    });

    return mapRecord(updated);
  }

  async refreshFromExistingEvidence(input: EnsureStateInput) {
    const state = await this.ensureState(input);
    const snapshot = await this.buildInitialSnapshot(input.workspaceId, input.workbenchId || null, input.goalId || null);
    const evidence = await this.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'consolidation',
      sourceType: 'existing_learning_memory',
      title: 'Existing learning memory consolidation',
      summary: 'Consolidated current profile, goals, traces, plans and spaced-repetition signals.',
      payload: snapshot,
      confidence: 0.7
    });
    for (const dimension of dimensions) {
      await this.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: dimension,
        operation: 'merge',
        proposedBy: 'LearnerStateConsolidator',
        payload: snapshot[dimension],
        evidenceId: evidence.id,
        confidence: 0.7,
        rationale: 'Confidence-weighted consolidation from existing learning memory.'
      });
    }
    return this.applyPendingPatches(input.workspaceId, { changedBy: 'LearnerStateConsolidator' });
  }

  async governLifecycle(input: GovernLifecycleInput) {
    const current = await this.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null });
    const staleSince = Date.now() - (input.staleTopicDays || 21) * 24 * 60 * 60 * 1000;
    const nowIso = new Date().toISOString();
    const lifecycleEvents: string[] = [];

    const topicSignals = asRecordArray(current.state.profileBase.transientTopicSignals);
    const activeTopicSignals = topicSignals.filter((signal) => {
      const time = observedTime(signal);
      return !time || time >= staleSince;
    });
    const expiredTopicSignals = topicSignals.filter((signal) => {
      const time = observedTime(signal);
      return time && time < staleSince;
    });
    if (expiredTopicSignals.length) lifecycleEvents.push(`Expired ${expiredTopicSignals.length} stale recent topic signal(s).`);

    const profileBase = {
      ...current.state.profileBase,
      recentTopics: uniqueStrings(activeTopicSignals.map((signal) => String(signal.topic || '')).filter(Boolean), 8),
      transientTopicSignals: activeTopicSignals.slice(-16),
      expiredTopicSignals: [
        ...asRecordArray(current.state.profileBase.expiredTopicSignals),
        ...expiredTopicSignals.map((signal) => ({ ...signal, expiredAt: nowIso, reason: 'recent_topic_decay' }))
      ].slice(-20)
    };

    const masterySignals = asRecordArray(current.state.knowledgeState.masterySignals);
    const candidateWeakSkills = asArray(current.state.knowledgeState.candidateWeakSkills);
    const weakSkills = asArray(current.state.knowledgeState.weakSkills);
    const byConcept = new Map<string, { weak: number; strong: number; recentStrong: number; latest: number }>();
    masterySignals.forEach((signal) => {
      const concept = conceptFromSignal(signal);
      if (!concept) return;
      const score = scoreFromSignal(signal);
      const time = observedTime(signal);
      const currentStats = byConcept.get(concept) || { weak: 0, strong: 0, recentStrong: 0, latest: 0 };
      if (score < 0.55) currentStats.weak += 1;
      if (score >= 0.75) currentStats.strong += 1;
      if (score >= 0.78 && (!time || time >= staleSince)) currentStats.recentStrong += 1;
      currentStats.latest = Math.max(currentStats.latest, time || 0);
      byConcept.set(concept, currentStats);
    });

    const promotedWeak = candidateWeakSkills.filter((concept) => (byConcept.get(concept)?.weak || 0) >= 2);
    if (promotedWeak.length) lifecycleEvents.push(`Promoted ${promotedWeak.length} candidate weak concept(s) after repeated evidence.`);
    const resolvedWeak = weakSkills.filter((concept) => (byConcept.get(concept)?.recentStrong || 0) >= 2);
    if (resolvedWeak.length) lifecycleEvents.push(`Marked ${resolvedWeak.length} weak concept(s) as resolving after recent strong evidence.`);

    const nextWeakSkills = uniqueStrings([...weakSkills.filter((concept) => !resolvedWeak.includes(concept)), ...promotedWeak], 16);
    const nextCandidateWeakSkills = uniqueStrings(candidateWeakSkills.filter((concept) => !promotedWeak.includes(concept) && !resolvedWeak.includes(concept)), 16);
    const knowledgeState = {
      ...current.state.knowledgeState,
      weakSkills: nextWeakSkills,
      candidateWeakSkills: nextCandidateWeakSkills,
      resolvedWeakSkills: uniqueStrings([...asArray(current.state.knowledgeState.resolvedWeakSkills), ...resolvedWeak], 16),
      lifecycleEvidence: [
        ...asRecordArray(current.state.knowledgeState.lifecycleEvidence),
        ...promotedWeak.map((concept) => ({ concept, action: 'promoted_to_stable_weak', at: nowIso })),
        ...resolvedWeak.map((concept) => ({ concept, action: 'marked_resolving', at: nowIso }))
      ].slice(-30)
    };

    const reviewPressure = asArray(current.state.reviewPlanning.reviewPressureSignals);
    const reviewPlanning = {
      ...current.state.reviewPlanning,
      reviewPressureSignals: reviewPressure.filter((concept) => !resolvedWeak.includes(concept)),
      resolvedReviewPressure: uniqueStrings([...asArray(current.state.reviewPlanning.resolvedReviewPressure), ...resolvedWeak], 16)
    };

    const confidence = {
      ...current.state.confidence,
      lifecycleLastRunAt: nowIso,
      lifecycleEvents,
      lifecycleStatus: lifecycleEvents.length ? 'updated' : 'no_change'
    };

    if (!lifecycleEvents.length) {
      return { state: current, lifecycleEvents, changed: false };
    }

    const evidence = await this.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      evidenceType: 'learner_state_lifecycle_governance',
      sourceType: 'learner_state_governor',
      title: 'Learner state lifecycle governance',
      summary: lifecycleEvents.join(' '),
      payload: { lifecycleEvents, expiredTopicCount: expiredTopicSignals.length, promotedWeak, resolvedWeak },
      confidence: 0.72
    });

    await this.proposePatch({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      targetDimension: 'profileBase',
      operation: 'replace',
      proposedBy: 'LearnerStateLifecycleGovernor',
      payload: profileBase,
      evidenceId: evidence.id,
      confidence: 0.72,
      rationale: 'Decay stale recent topics so single old topics do not shape future personalization.'
    });
    await this.proposePatch({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      targetDimension: 'knowledgeState',
      operation: 'replace',
      proposedBy: 'LearnerStateLifecycleGovernor',
      payload: knowledgeState,
      evidenceId: evidence.id,
      confidence: 0.74,
      rationale: 'Promote repeated weak concepts and mark resolving concepts based on recent strong evidence.'
    });
    await this.proposePatch({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      targetDimension: 'reviewPlanning',
      operation: 'replace',
      proposedBy: 'LearnerStateLifecycleGovernor',
      payload: reviewPlanning,
      evidenceId: evidence.id,
      confidence: 0.7,
      rationale: 'Remove resolved concepts from active review pressure.'
    });
    await this.proposePatch({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      targetDimension: 'confidence',
      operation: 'merge',
      proposedBy: 'LearnerStateLifecycleGovernor',
      payload: confidence,
      evidenceId: evidence.id,
      confidence: 0.7,
      rationale: 'Record lifecycle governance metadata.'
    });

    const state = await this.applyPendingPatches(input.workspaceId, { changedBy: input.changedBy || 'LearnerStateLifecycleGovernor' });
    return { state, lifecycleEvents, changed: true };
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
        workspace: {
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          major: workspace.major
        },
        goals: goals.map((goal) => goal.goalText).slice(0, 5),
        background: preferences.background || preferences.knowledgeLevel || null,
        priorKnowledge: preferences.priorKnowledge || preferences.knowledgeLevel || null
      },
      knowledgeState: {
        targetSkills: appendUnique(goalSkills, planTargetSkills),
        weakSkills: appendUnique(goalWeaknesses, planWeakSkills),
        masterySignals: traceMastery.slice(0, 6),
        activePlanId: activePlan?.id || null
      },
      misconceptionState: {
        candidates: misconceptionCandidates.slice(0, 8),
        repairStrategies: Array.isArray(diagnostic.prerequisiteGaps)
          ? ['插入前置讲解', '降低练习难度', '增加错因复盘']
          : []
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
        engagementSignals: {
          hasRepeatedReviews: reviewCount > 0,
          hasRecentTrace: traces.length > 0
        }
      },
      cognitiveState: {
        learnerLevel: diagnostic.learnerLevel || preferences.knowledgeLevel || 'unknown',
        cognitiveLoadTolerance: diagnostic.cognitiveLoadTolerance || null,
        recommendedDifficultyBand: diagnostic.recommendedDifficultyBand || null,
        zpdSignals: {
          prerequisiteGaps: diagnostic.prerequisiteGaps || [],
          strengths: diagnostic.strengths || []
        }
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
