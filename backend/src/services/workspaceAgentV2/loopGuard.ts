import { compactJson } from './utils';
import type { WorkspaceAgentDecision, WorkspaceAgentV2State } from './types';

export interface LoopGuardResult {
  ok: boolean;
  reason?: string;
}

export class WorkspaceAgentV2LoopGuard {
  private readonly softRepeatThreshold = 3;
  private readonly hardRepeatThreshold = 5;

  inspect(state: WorkspaceAgentV2State, decision: WorkspaceAgentDecision): LoopGuardResult {
    if (state.stepCount > state.maxSteps) {
      return { ok: false, reason: `Reached max agent steps (${state.maxSteps}).` };
    }
    if (decision.type === 'final') {
      const deliveryGateRepeats = state.observations
        .slice(-3)
        .filter((item) => item.tool === 'delivery.gate' && item.status === 'skipped').length;
      if (deliveryGateRepeats >= 2) {
        return { ok: false, reason: 'Detected repeated final responses blocked by DeliveryGate without satisfying the delivery contract.' };
      }
    }
    if (decision.type !== 'tool_call' || !decision.tool) return { ok: true };

    const signature = `${decision.tool}:${compactJson(decision.input || {}, 1200)}`;
    const recent = state.decisions
      .filter((item) => item.id !== decision.id)
      .filter((item) => item.type === 'tool_call' && item.tool)
      .slice(-this.hardRepeatThreshold)
      .map((item) => `${item.tool}:${compactJson(item.input || {}, 1200)}`);
    const repeatedCount = [...recent, signature].reverse().findIndex((item) => item !== signature);
    const consecutive = repeatedCount === -1 ? recent.length + 1 : repeatedCount;

    if (consecutive >= this.hardRepeatThreshold) {
      return { ok: false, reason: `Detected ${consecutive} repeated calls to ${decision.tool} with the same input.` };
    }
    if (consecutive >= this.softRepeatThreshold) {
      return { ok: true, reason: `Repeated ${decision.tool}; continue only if the new observation can change the answer.` };
    }
    return { ok: true };
  }
}
