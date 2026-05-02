import { learningRunService } from './learningRunService';

export type CapabilityName =
  | 'goal_planning'
  | 'diagnosis'
  | 'content_generation'
  | 'knowledge_retrieval'
  | 'reflection'
  | 'quiz_generation';

export interface CapabilityExecutionContext {
  runId?: string;
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
}

export interface Capability<I = Record<string, unknown>, O = Record<string, unknown>> {
  name: CapabilityName;
  description: string;
  execute(input: I, context: CapabilityExecutionContext): Promise<O>;
}

export class CapabilityRegistry {
  private capabilities = new Map<CapabilityName, Capability<any, any>>();

  register<I, O>(capability: Capability<I, O>) {
    this.capabilities.set(capability.name, capability);
  }

  get(name: CapabilityName) {
    const capability = this.capabilities.get(name);
    if (!capability) throw new Error(`Capability "${name}" is not registered`);
    return capability;
  }

  list() {
    return Array.from(this.capabilities.values()).map((capability) => ({
      name: capability.name,
      description: capability.description
    }));
  }

  async execute<I = Record<string, unknown>, O = Record<string, unknown>>(
    name: CapabilityName,
    input: I,
    context: CapabilityExecutionContext
  ): Promise<O> {
    const capability = this.get(name);
    const step = context.runId
      ? await learningRunService.startStep(context.runId, name, input as Record<string, unknown>)
      : null;

    try {
      const output = await capability.execute(input, context);
      if (step) await learningRunService.completeStep(step.id, output as Record<string, unknown>);
      return output as O;
    } catch (error) {
      if (step) await learningRunService.failStep(step.id, error);
      throw error;
    }
  }
}

export const capabilityRegistry = new CapabilityRegistry();
