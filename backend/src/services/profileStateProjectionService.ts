import { learnerStateService } from './learnerStateService';
import { LearnerProfileEntry, safeProfileArray } from './learnerProfileReadModel';

const signalEntry = (
  item: any,
  dimension: string,
  label: string,
  source: LearnerProfileEntry['source']
): LearnerProfileEntry => ({
  id: String(item.id),
  dimension,
  label: item.label || label,
  value: String(item.value || ''),
  confidence: item.confidence,
  status: item.status,
  evidenceCount: safeProfileArray(item.evidenceIds).length,
  source,
  observedAt: item.lastObservedAt || item.firstObservedAt || null,
  rationale: item.rationale || null
});

export class ProfileStateProjectionService {
  async project(input: { workspaceId: string; workbenchId?: string | null; goalId?: string | null }) {
    const state = await learnerStateService.ensureState({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null
    });

    const stableProfile: LearnerProfileEntry[] = [
      ...safeProfileArray<any>(state.coreState.stableProfile.learningGoals).map((item) => signalEntry(item, 'profileBase', 'Learning goal', 'stable_profile')),
      ...safeProfileArray<any>(state.coreState.stableProfile.masteredKnowledge).map((item) => signalEntry(item, 'knowledgeState', 'Mastered knowledge', 'stable_profile')),
      ...safeProfileArray<any>(state.coreState.stableProfile.weakKnowledge).map((item) => signalEntry(item, 'knowledgeState', 'Weak knowledge', 'stable_profile')),
      ...safeProfileArray<any>(state.coreState.stableProfile.learningPreferences).map((item) => signalEntry(item, 'preferenceStyle', 'Learning preference', 'stable_profile')),
      ...safeProfileArray<any>(state.coreState.stableProfile.commonErrors).map((item) => signalEntry(item, 'misconceptionState', 'Common error', 'stable_profile')),
      ...safeProfileArray<any>(state.coreState.stableProfile.learnerTraits).map((item) => signalEntry(item, 'cognitiveState', 'Learner trait', 'stable_profile'))
    ];

    const workingState: LearnerProfileEntry[] = [
      ...safeProfileArray<any>(state.coreState.workingState.currentCourseState.activeGoals).map((item) => signalEntry(item, 'profileBase', 'Active goal', 'working_state')),
      ...safeProfileArray<any>(state.coreState.workingState.currentCourseState.focusKnowledge).map((item) => signalEntry(item, 'knowledgeState', 'Focus knowledge', 'working_state')),
      ...safeProfileArray<any>(state.coreState.workingState.currentCourseState.pendingQuestions).map((item) => signalEntry(item, 'cognitiveState', 'Pending question', 'working_state')),
      ...safeProfileArray<any>(state.coreState.workingState.currentCourseState.nextActions).map((item) => signalEntry(item, 'reviewPlanning', 'Next action', 'working_state')),
      ...safeProfileArray<any>(state.coreState.workingState.recentBehaviorSummary.recentTopics).map((item) => signalEntry(item, 'profileBase', 'Recent topic', 'working_state')),
      ...safeProfileArray<any>(state.coreState.workingState.recentBehaviorSummary.engagementSignals).map((item) => signalEntry(item, 'behaviorEngagement', 'Engagement signal', 'working_state')),
      ...safeProfileArray<any>(state.coreState.workingState.recentBehaviorSummary.reviewPressure).map((item) => signalEntry(item, 'reviewPlanning', 'Review pressure', 'working_state')),
      ...safeProfileArray<any>(state.coreState.observationMemory.observations).map((item) =>
        signalEntry(item, item.dimension || 'profileBase', 'Observation', 'observation_memory')
      )
    ];

    return { state, stableProfile, workingState };
  }
}

export const profileStateProjectionService = new ProfileStateProjectionService();
