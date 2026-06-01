import prisma, { withPrismaRetry } from '../config/db';

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
};

export class LearningRunService {
  async startRun(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    intent: string;
    input?: Record<string, unknown>;
  }) {
    return withPrismaRetry(() =>
      prisma.learningRun.create({
        data: {
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || null,
          goalId: input.goalId || null,
          intent: input.intent,
          status: 'running',
          inputJson: stringify(input.input || {})
        }
      })
    );
  }

  async startStep(runId: string, capability: string, input?: Record<string, unknown>) {
    return withPrismaRetry(() =>
      prisma.learningRunStep.create({
        data: {
          runId,
          capability,
          status: 'running',
          inputJson: stringify(input || {}),
          startedAt: new Date()
        }
      })
    );
  }

  async completeStep(stepId: string, output?: Record<string, unknown>) {
    return withPrismaRetry(() =>
      prisma.learningRunStep.update({
        where: { id: stepId },
        data: {
          status: 'completed',
          outputJson: stringify(output || {}),
          completedAt: new Date()
        }
      })
    );
  }

  async failStep(stepId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return withPrismaRetry(() =>
      prisma.learningRunStep.update({
        where: { id: stepId },
        data: {
          status: 'failed',
          errorMessage: message,
          completedAt: new Date()
        }
      })
    );
  }

  async completeRun(runId: string, result?: Record<string, unknown>) {
    return withPrismaRetry(() =>
      prisma.learningRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          resultJson: stringify(result || {})
        }
      })
    );
  }

  async failRun(runId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return withPrismaRetry(() =>
      prisma.learningRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorMessage: message
        }
      })
    );
  }

  async listRuns(workspaceId: string, limit = 20) {
    return prisma.learningRun.findMany({
      where: { workspaceId },
      include: {
        steps: {
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100)
    });
  }

  async getRun(id: string) {
    return prisma.learningRun.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
  }
}

export const learningRunService = new LearningRunService();
