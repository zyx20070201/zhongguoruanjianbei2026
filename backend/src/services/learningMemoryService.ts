import prisma from '../config/db';

type GoalMode = 'quick-start' | 'project' | 'review';

interface CreateGoalInput {
  workspaceId: string;
  title: string;
  goalText: string;
  skills: string[];
  weaknesses: string[];
  mode: GoalMode;
  plan?: Record<string, unknown>;
}

interface RecordEventInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  eventType: string;
  actor?: 'user' | 'assistant' | 'system' | 'agent';
  payload?: Record<string, unknown>;
}

interface UpsertTraceInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  summary: string;
  mastery?: Record<string, unknown>;
  nextActions?: string[];
}

const stringify = (value: unknown, fallback: string) => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

export class LearningMemoryService {
  async createGoal(input: CreateGoalInput) {
    return prisma.learningGoal.create({
      data: {
        workspaceId: input.workspaceId,
        title: input.title,
        goalText: input.goalText,
        skillsJson: stringify(input.skills, '[]'),
        weaknessesJson: stringify(input.weaknesses, '[]'),
        mode: input.mode,
        planJson: stringify(input.plan || {}, '{}')
      }
    });
  }

  async attachGoalToWorkbench(goalId: string, workbenchId: string) {
    return prisma.workbench.update({
      where: { id: workbenchId },
      data: { learningGoalId: goalId }
    });
  }

  async recordEvent(input: RecordEventInput) {
    return prisma.learningEvent.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        eventType: input.eventType,
        actor: input.actor || 'system',
        payloadJson: stringify(input.payload || {}, '{}')
      }
    });
  }

  async createTrace(input: UpsertTraceInput) {
    return prisma.learningTrace.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        summary: input.summary,
        masteryJson: stringify(input.mastery || {}, '{}'),
        nextActionsJson: stringify(input.nextActions || [], '[]')
      }
    });
  }
}

export const learningMemoryService = new LearningMemoryService();
