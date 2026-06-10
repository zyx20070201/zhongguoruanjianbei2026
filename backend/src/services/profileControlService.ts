import { learnerMemoryControlService, MemoryControlAction } from './learnerMemoryControlService';

export class ProfileControlService {
  listProfileControls(input: { workspaceId: string; workbenchId?: string | null; limit?: number }) {
    return learnerMemoryControlService.listKeyMemories(input);
  }

  explainProfileItem(input: { workspaceId: string; memoryKey: string }) {
    return learnerMemoryControlService.explain(input);
  }

  controlProfileItem(input: {
    workspaceId: string;
    workbenchId?: string | null;
    memoryKey: string;
    dimension: string;
    action: MemoryControlAction;
    correctedText?: string;
    originalText?: string;
    reason?: string;
    weightMultiplier?: number;
  }) {
    return learnerMemoryControlService.control(input);
  }

  lifecycle(input: { workspaceId: string; staleDays?: number }) {
    return learnerMemoryControlService.lifecycle(input);
  }

  evaluate(input: { workspaceId: string }) {
    return learnerMemoryControlService.evaluate(input);
  }
}

export const profileControlService = new ProfileControlService();
