import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { longTermMemoryProjectionService } from './longTermMemoryProjectionService';
import { LearnerProfileEvidenceProjection } from './learnerProfileReadModel';
import { profileStateProjectionService } from './profileStateProjectionService';
import { recentEventProjectionService } from './recentEventProjectionService';

export class LearnerProfileEvidenceProjectionService {
  async project(input: { workspaceId: string; workbenchId?: string | null; goalId?: string | null }): Promise<LearnerProfileEvidenceProjection> {
    const [profileState, memory, recentEvent, context] = await Promise.all([
      profileStateProjectionService.project({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null
      }),
      longTermMemoryProjectionService.project({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        limit: 40
      }),
      recentEventProjectionService.project({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        limit: 40
      }),
      learnerStateContextAdapter.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        audience: 'general'
      })
    ]);

    return {
      state: profileState.state,
      context,
      stableProfile: profileState.stableProfile,
      workingState: profileState.workingState,
      savedMemoryEntries: memory.savedMemoryEntries,
      recentEvents: recentEvent.recentEvents
    };
  }
}

export const learnerProfileEvidenceProjectionService = new LearnerProfileEvidenceProjectionService();
