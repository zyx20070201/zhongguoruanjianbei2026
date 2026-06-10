import { learnerProfileEvidenceProjectionService } from './learnerProfileEvidenceProjectionService';
import { learnerProfilePageComposerService } from './learnerProfilePageComposerService';
import { learnerPortraitPipelineService } from './learnerPortraitPipelineService';

export class LearnerProfileViewService {
  async build(input: { workspaceId: string; workbenchId?: string | null; limit?: number; forcePortrait?: boolean }) {
    const projection = await learnerProfileEvidenceProjectionService.project({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null
    });
    const portraitBundle = await learnerPortraitPipelineService.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      projection,
      forcePortrait: input.forcePortrait
    });
    return learnerProfilePageComposerService.compose({
      projection,
      portraitBundle,
      forcePortrait: input.forcePortrait
    });
  }
}

export const learnerProfileViewService = new LearnerProfileViewService();
