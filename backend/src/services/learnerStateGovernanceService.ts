import prisma from '../config/db';
import { isPollutedLearningSignal } from './learnerSignalSanitizer';
import { learnerStateService } from './learnerStateService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalize = (value: string) => value.trim().toLowerCase();

const dimensionForObservation = (dimension: string) => {
  if (['profileBase', 'knowledgeState', 'misconceptionState', 'preferenceStyle', 'behaviorEngagement', 'cognitiveState', 'reviewPlanning', 'confidence'].includes(dimension)) {
    return dimension as any;
  }
  return 'profileBase' as const;
};

export class LearnerStateGovernanceService {
  async govern(input: { workspaceId: string; workbenchId?: string | null; minEvidenceCount?: number; promotionConfidence?: number }) {
    const state = await learnerStateService.ensureState({ workspaceId: input.workspaceId, workbenchId: input.workbenchId || null });
    const minEvidenceCount = Math.max(input.minEvidenceCount || 2, 1);
    const promotionConfidence = Math.max(input.promotionConfidence || 0.62, 0.5);
    const observations = await prisma.learnerObservation.findMany({
      where: { workspaceId: input.workspaceId, learnerStateCoreId: state.id, status: 'active' },
      orderBy: { observedAt: 'desc' },
      take: 300
    });
    const signals = await prisma.learnerStateSignal.findMany({
      where: { workspaceId: input.workspaceId, learnerStateCoreId: state.id },
      orderBy: { updatedAt: 'desc' },
      take: 300
    });
    const pollutedSignals = signals.filter((signal) => isPollutedLearningSignal(signal.value));
    const pollutedObservations = observations.filter((observation) => isPollutedLearningSignal(observation.value));
    if (pollutedSignals.length) {
      await prisma.learnerStateSignal.updateMany({
        where: { id: { in: pollutedSignals.map((signal) => signal.id) } },
        data: {
          status: 'suppressed_polluted',
          confidence: 0,
          rationale: 'Suppressed by learner-state governance because this value matches an internal prompt or non-learning signal filter.'
        }
      });
    }
    if (pollutedObservations.length) {
      await prisma.learnerObservation.updateMany({
        where: { id: { in: pollutedObservations.map((observation) => observation.id) } },
        data: {
          status: 'suppressed_polluted',
          confidence: 0,
          rationale: 'Suppressed by learner-state governance because this value matches an internal prompt or non-learning signal filter.'
        }
      });
    }
    const activeControls = await prisma.learnerMemoryControl.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' }
    });
    const blockedValues = new Set(
      activeControls
        .filter((control) => ['delete', 'downrank'].includes(control.action))
        .map((control) => normalize(control.correctedText || control.originalText || control.memoryKey))
        .filter(Boolean)
    );
    const frozenKeys = new Set(activeControls.filter((control) => control.action === 'freeze').map((control) => control.memoryKey));
    const stableByDimensionValue = new Map(signals.filter((signal) => signal.layer === 'stable_profile').map((signal) => [`${signal.dimension}:${normalize(signal.value)}`, signal]));
    const groups = new Map<string, typeof observations>();
    observations.forEach((observation) => {
      if (isPollutedLearningSignal(observation.value)) return;
      const key = `${observation.dimension}:${normalize(observation.value)}`;
      groups.set(key, [...(groups.get(key) || []), observation]);
    });

    const decisions: Array<Record<string, unknown>> = [];
    for (const [key, items] of groups.entries()) {
      const [dimension, valueKey] = key.split(':');
      if (!valueKey || blockedValues.has(valueKey) || frozenKeys.has(key)) {
        decisions.push({ key, action: 'blocked_by_user_control', count: items.length });
        continue;
      }
      const evidenceIds = Array.from(new Set(items.flatMap((item) => parseJson<string[]>(item.evidenceIdsJson, []))));
      const avgConfidence = items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
      const stable = stableByDimensionValue.get(key);
      const enoughEvidence = evidenceIds.length >= minEvidenceCount || items.length >= minEvidenceCount;
      const consistent = avgConfidence >= promotionConfidence && items.every((item) => item.confidence >= 0.42);
      if (stable && avgConfidence < 0.35 && !frozenKeys.has(stable.signalKey)) {
        await prisma.learnerStateSignal.update({
          where: { id: stable.id },
          data: {
            confidence: Math.max(0.15, stable.confidence * 0.82),
            status: stable.confidence * 0.82 < 0.38 ? 'candidate' : stable.status,
            rationale: [stable.rationale, 'Governance demoted confidence because recent observations are weak or conflicting.'].filter(Boolean).join(' ')
          }
        });
        decisions.push({ key, action: 'demoted_stable_signal', previousConfidence: stable.confidence, observationConfidence: avgConfidence });
        continue;
      }
      if (!stable && enoughEvidence && consistent) {
        const latest = items[0];
        const evidence = await learnerStateService.recordEvidence({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          evidenceType: 'learner_state_governance_promotion',
          sourceType: 'learner_observation_cluster',
          sourceId: latest.id,
          actor: 'system',
          title: `Promoted learner observation: ${latest.value}`,
          summary: `Promoted ${items.length} consistent observations into stable learner state.`,
          payload: { observationIds: items.map((item) => item.id), evidenceIds, avgConfidence, dimension, value: latest.value },
          confidence: Math.min(0.92, avgConfidence + 0.08)
        });
        await learnerStateService.proposePatch({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          targetDimension: dimensionForObservation(dimension),
          proposedBy: 'LearnerStateGovernanceService',
          confidence: Math.min(0.92, avgConfidence + 0.08),
          evidenceId: evidence.id,
          rationale: 'Promoted repeated, consistent short-term observations into stable learner profile.',
          payload: this.payloadForPromotion(dimension, latest.value)
        });
        decisions.push({ key, action: 'promoted_observation_cluster', count: items.length, evidenceCount: evidenceIds.length, avgConfidence });
      } else {
        decisions.push({ key, action: 'kept_observation_memory', count: items.length, evidenceCount: evidenceIds.length, avgConfidence });
      }
    }

    const applied = await learnerStateService.applyPendingPatches(input.workspaceId, { changedBy: 'LearnerStateGovernanceService' });
    return {
      schema: 'learner_state_governance_report.v1',
      workspaceId: input.workspaceId,
      decisions,
      summary: {
        observationsReviewed: observations.length,
        stableSignalsReviewed: signals.length,
        pollutedSignalsSuppressed: pollutedSignals.length,
        pollutedObservationsSuppressed: pollutedObservations.length,
        promoted: decisions.filter((item) => item.action === 'promoted_observation_cluster').length,
        demoted: decisions.filter((item) => item.action === 'demoted_stable_signal').length,
        blockedByUserControl: decisions.filter((item) => item.action === 'blocked_by_user_control').length
      },
      state: applied
    };
  }

  private payloadForPromotion(dimension: string, value: string) {
    if (dimension === 'knowledgeState') return { candidateWeakSkills: [value], targetSkills: [value] };
    if (dimension === 'misconceptionState') return { candidateMisconceptions: [value], candidates: [value] };
    if (dimension === 'preferenceStyle') return { tentativeResourcePreferences: [value], resourcePreference: [value] };
    if (dimension === 'reviewPlanning') return { reviewPressureSignals: [value], nextActions: [value] };
    if (dimension === 'behaviorEngagement') return { recurringQuestionPatterns: [value], questionPatterns: [value] };
    if (dimension === 'cognitiveState') return { learnerTraits: [value] };
    return { activeLearningGoalSignals: [value], recentTopics: [value] };
  }
}

export const learnerStateGovernanceService = new LearnerStateGovernanceService();
