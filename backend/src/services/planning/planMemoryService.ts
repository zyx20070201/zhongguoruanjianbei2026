import crypto from 'crypto';
import prisma from '../../config/db';
import { learningMemoryService } from '../learningMemoryService';
import { LearningPlan } from './planningTypes';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class PlanMemoryService {
  async getLatestPlan(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
  }): Promise<LearningPlan | null> {
    const event = await prisma.learningEvent.findFirst({
      where: {
        workspaceId: input.workspaceId,
        eventType: { in: ['mcl.plan_created', 'mcl.plan_revised'] },
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
    const payload = parseJson<{ plan?: LearningPlan }>(event?.payloadJson, {});
    return payload.plan || null;
  }

  async savePlan(input: {
    plan: LearningPlan;
    eventType: 'mcl.plan_created' | 'mcl.plan_revised';
    revisionReason?: string;
  }) {
    const plan = {
      ...input.plan,
      id: input.plan.id || crypto.randomUUID(),
      updatedAt: new Date().toISOString()
    };
    await learningMemoryService.recordEvent({
      workspaceId: plan.workspaceId,
      workbenchId: plan.workbenchId || null,
      goalId: plan.goalId || null,
      eventType: input.eventType,
      actor: 'agent',
      payload: {
        plan,
        revisionReason: input.revisionReason || null
      }
    });
    return plan;
  }
}

export const planMemoryService = new PlanMemoryService();
