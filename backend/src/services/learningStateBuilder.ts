import prisma from '../config/db';
import { CentralLearnerState, learnerStateService } from './learnerStateService';
import { LearnerStateAgentContext, learnerStateContextAdapter } from './learnerStateContextAdapter';
import {
  ClientWorkbenchContext,
  workbenchContextService
} from './contextSystemService';
import { ContextCapsule, ContextPolicyDecision } from '../types/contextSystem';

export interface MclLearningState {
  workspace: {
    id: string;
    name: string;
    description?: string | null;
    major?: string | null;
  };
  workbench?: {
    id: string;
    title: string;
    description: string;
    rootPath?: string | null;
  } | null;
  learnerProfile: {
    id?: string;
    userId: string;
    workspaceId?: string | null;
    summary: string;
    preferences: Record<string, unknown>;
  };
  centralLearnerState: CentralLearnerState;
  learnerAgentContext: LearnerStateAgentContext;
  activeGoal?: {
    id: string;
    title: string;
    goalText: string;
    skills: string[];
    weaknesses: string[];
    mode: string;
    status: string;
    plan: Record<string, unknown>;
  } | null;
  activePlan?: {
    id: string;
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    scope: string;
    status: string;
    version: number;
    objective: string;
    rationale: string;
    assumptions: string[];
    constraints: string[];
    targetSkills: string[];
    weakSkills: string[];
    milestones: unknown[];
    steps: unknown[];
    adaptationPolicy: Record<string, unknown>;
    evidence: Record<string, unknown>;
    diagnosticReport: Record<string, unknown>;
    candidateResources: unknown[];
    knowledgeGraphSnapshot: Record<string, unknown>;
    reflectionHistory: unknown[];
    constraintScores: Record<string, unknown>;
    revisionCount: number;
    nextStepId?: string | null;
    previousPlanId?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  activeKnowledge: {
    capsuleId: string;
    mode: string;
    citations: ContextCapsule['citations'];
    retrievedChunks: ContextCapsule['retrievedChunks'];
    sourceMap: ContextCapsule['sourceMap'];
    estimatedTokens: number;
  };
  currentTask: {
    intent: string;
    userInput: string;
    resourceType?: string;
    contextMode?: string;
    workbenchId?: string | null;
    goalId?: string | null;
  };
  recentTraces: Array<{
    id: string;
    summary: string;
    mastery: Record<string, unknown>;
    nextActions: string[];
    updatedAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    actor: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  readiness: {
    ready: boolean;
    stats: {
      fileCount: number;
      indexedFileCount: number;
      chunkCount: number;
      goalCount: number;
      traceCount: number;
      runCount: number;
    };
    checks: Array<{ id: string; ok: boolean; message: string }>;
  };
}

export interface BuiltMclLearningState {
  state: MclLearningState;
  capsule: ContextCapsule;
  contextPolicy: ContextPolicyDecision;
  promptPreview: string;
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const profileSummary = (preferences: Record<string, unknown>) => {
  const weakPoints = Array.isArray(preferences.weakPoints) ? preferences.weakPoints.join('、') : '暂无';
  const recentFocus = Array.isArray(preferences.recentFocus) ? preferences.recentFocus.join('、') : '暂无';
  return [
    `知识水平: ${preferences.knowledgeLevel || 'unknown'}`,
    `学习目标: ${preferences.learningGoal || '未明确'}`,
    `学习偏好: ${preferences.learningPreference || '未明确'}`,
    `认知风格: ${preferences.cognitiveStyle || '未明确'}`,
    `薄弱点: ${weakPoints}`,
    `近期关注: ${recentFocus}`
  ].join('\n');
};

export class LearningStateBuilder {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    intent: string;
    userInput?: string;
    resourceType?: string;
    context?: Partial<ClientWorkbenchContext>;
  }): Promise<BuiltMclLearningState> {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const workbench = input.workbenchId
      ? await prisma.workbench.findFirst({
          where: { id: input.workbenchId, workspaceId: input.workspaceId }
        })
      : null;

    const goalId = input.goalId || workbench?.learningGoalId || null;
    const [goal, profile, activePlan, recentTraces, recentEvents, fileCount, indexedFiles, chunkCount, goalCount, traceCount, runCount] =
      await Promise.all([
        goalId
          ? prisma.learningGoal.findFirst({ where: { id: goalId, workspaceId: input.workspaceId } })
          : prisma.learningGoal.findFirst({
              where: { workspaceId: input.workspaceId, status: 'active' },
              orderBy: { updatedAt: 'desc' }
            }),
        prisma.profile.findFirst({ where: { userId: workspace.userId, workspaceId: input.workspaceId } }),
        prisma.learningPlan.findFirst({
          where: {
            workspaceId: input.workspaceId,
            status: 'active',
            ...(goalId ? { goalId } : {}),
            ...(input.workbenchId ? { workbenchId: input.workbenchId } : {})
          },
          orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }]
        }),
        prisma.learningTrace.findMany({
          where: {
            workspaceId: input.workspaceId,
            ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
            ...(goalId ? { goalId } : {})
          },
          orderBy: { updatedAt: 'desc' },
          take: 5
        }),
        prisma.learningEvent.findMany({
          where: {
            workspaceId: input.workspaceId,
            ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
            ...(goalId ? { goalId } : {})
          },
          orderBy: { createdAt: 'desc' },
          take: 8
        }),
        prisma.fileSystemObject.count({ where: { workspaceId: input.workspaceId, nodeType: 'file' } }),
        prisma.knowledgeIndexJob.groupBy({
          by: ['fileObjectId'],
          where: { workspaceId: input.workspaceId, status: 'completed' }
        }),
        prisma.knowledgeChunk.count({ where: { workspaceId: input.workspaceId } }),
        prisma.learningGoal.count({ where: { workspaceId: input.workspaceId } }),
        prisma.learningTrace.count({ where: { workspaceId: input.workspaceId } }),
        prisma.learningRun.count({ where: { workspaceId: input.workspaceId } })
      ]);

    const preferences = parseJson<Record<string, unknown>>(profile?.preferences, {});
    const centralLearnerState = await learnerStateService.ensureState({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: goal?.id || goalId || null
    });
    const learnerAgentContext = await learnerStateContextAdapter.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: goal?.id || goalId || null,
      audience:
        input.intent === 'planning'
          ? 'planner'
          : input.intent === 'quiz_generation'
            ? 'quiz'
            : input.intent === 'studio_generate'
              ? 'studio'
              : input.intent === 'reflection'
                ? 'reflection'
                : 'tutor'
    });
    const capsuleResult = await workbenchContextService.buildCapsule({
      context: {
        ...(input.context || {}),
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context?.workbenchId || null,
        userId: input.context?.userId || workspace.userId
      },
      messages: [{ role: 'user', content: input.userInput || input.intent }]
    });
    const capsule = capsuleResult.capsule;
    const checks = [
      {
        id: 'knowledge-index',
        ok: chunkCount > 0,
        message: chunkCount > 0 ? '知识块已建立' : '还没有可检索知识块'
      },
      {
        id: 'learning-goals',
        ok: goalCount > 0,
        message: goalCount > 0 ? '已有结构化学习目标' : '还没有结构化学习目标'
      },
      {
        id: 'learning-traces',
        ok: traceCount > 0,
        message: traceCount > 0 ? '已有学习记忆 trace' : '还没有学习 trace'
      }
    ];

    return {
      state: {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          major: workspace.major
        },
        workbench: workbench
          ? {
              id: workbench.id,
              title: workbench.title || workbench.name,
              description: workbench.description || '',
              rootPath: workbench.rootPath
            }
          : null,
        learnerProfile: {
          id: profile?.id,
          userId: workspace.userId,
          workspaceId: input.workspaceId,
          summary: profileSummary(preferences),
          preferences
        },
        centralLearnerState,
        learnerAgentContext,
        activeGoal: goal
          ? {
              id: goal.id,
              title: goal.title,
              goalText: goal.goalText,
              skills: parseJson<string[]>(goal.skillsJson, []),
              weaknesses: parseJson<string[]>(goal.weaknessesJson, []),
              mode: goal.mode,
              status: goal.status,
              plan: parseJson<Record<string, unknown>>(goal.planJson, {})
            }
          : null,
        activePlan: activePlan
          ? {
              id: activePlan.id,
              workspaceId: activePlan.workspaceId,
              workbenchId: activePlan.workbenchId,
              goalId: activePlan.goalId,
              scope: activePlan.scope,
              status: activePlan.status,
              version: activePlan.version,
              objective: activePlan.objective,
              rationale: activePlan.rationale,
              assumptions: parseJson<string[]>(activePlan.assumptionsJson, []),
              constraints: parseJson<string[]>(activePlan.constraintsJson, []),
              targetSkills: parseJson<string[]>(activePlan.targetSkillsJson, []),
              weakSkills: parseJson<string[]>(activePlan.weakSkillsJson, []),
              milestones: parseJson<unknown[]>(activePlan.milestonesJson, []),
              steps: parseJson<unknown[]>(activePlan.stepsJson, []),
              adaptationPolicy: parseJson<Record<string, unknown>>(activePlan.adaptationPolicyJson, {}),
              evidence: parseJson<Record<string, unknown>>(activePlan.evidenceJson, {}),
              diagnosticReport: parseJson<Record<string, unknown>>(activePlan.diagnosticReportJson, {}),
              candidateResources: parseJson<unknown[]>(activePlan.candidateResourcesJson, []),
              knowledgeGraphSnapshot: parseJson<Record<string, unknown>>(activePlan.knowledgeGraphSnapshotJson, {}),
              reflectionHistory: parseJson<unknown[]>(activePlan.reflectionHistoryJson, []),
              constraintScores: parseJson<Record<string, unknown>>(activePlan.constraintScoresJson, {}),
              revisionCount: activePlan.revisionCount,
              nextStepId: activePlan.nextStepId,
              previousPlanId: activePlan.previousPlanId,
              createdAt: activePlan.createdAt.toISOString(),
              updatedAt: activePlan.updatedAt.toISOString()
            }
          : null,
        activeKnowledge: {
          capsuleId: capsule.capsuleId,
          mode: capsule.mode,
          citations: capsule.citations,
          retrievedChunks: capsule.retrievedChunks,
          sourceMap: capsule.sourceMap,
          estimatedTokens: capsule.estimatedTokens
        },
        currentTask: {
          intent: input.intent,
          userInput: input.userInput || '',
          resourceType: input.resourceType,
          contextMode: input.context?.contextMode,
          workbenchId: input.workbenchId || null,
          goalId: goal?.id || goalId || null
        },
        recentTraces: recentTraces.map((trace: typeof recentTraces[number]) => ({
          id: trace.id,
          summary: trace.summary,
          mastery: parseJson<Record<string, unknown>>(trace.masteryJson, {}),
          nextActions: parseJson<string[]>(trace.nextActionsJson, []),
          updatedAt: trace.updatedAt.toISOString()
        })),
        recentEvents: recentEvents.map((event: typeof recentEvents[number]) => ({
          id: event.id,
          eventType: event.eventType,
          actor: event.actor,
          payload: parseJson<Record<string, unknown>>(event.payloadJson, {}),
          createdAt: event.createdAt.toISOString()
        })),
        readiness: {
          ready: checks.every((check) => check.ok),
          checks,
          stats: {
            fileCount,
            indexedFileCount: indexedFiles.length,
            chunkCount,
            goalCount,
            traceCount,
            runCount
          }
        }
      },
      capsule,
      contextPolicy: capsuleResult.policy,
      promptPreview: capsuleResult.promptPreview
    };
  }
}

export const learningStateBuilder = new LearningStateBuilder();
