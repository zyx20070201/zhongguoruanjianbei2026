import crypto from 'crypto';
import prisma from '../config/db';
import { learnerStateService } from './learnerStateService';
import { LearningPlan } from './planningTypes';
import { learningEventCollectionService } from './learningEventCollectionService';
import { courseKnowledgeGraphService } from './courseKnowledgeGraphService';
import { workbenchService } from './workbenchService';

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
  object?: {
    type?: string;
    id?: string | null;
    title?: string | null;
  };
  interaction?: {
    sessionId?: string | null;
    messageId?: string | null;
    turnIndex?: number | null;
    userText?: string | null;
    assistantText?: string | null;
    hintUsed?: boolean;
    repeatedQuestion?: boolean;
    markedUnknown?: boolean;
    markedMastered?: boolean;
    answerCorrect?: boolean | null;
    score?: number | null;
  };
  source?: {
    component?: string;
    route?: string;
    clientEventId?: string;
  };
  confidence?: number;
}

interface UpsertTraceInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  summary: string;
  mastery?: Record<string, unknown>;
  nextActions?: string[];
}

interface SaveLearningPlanInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  scope?: 'workspace' | 'workbench' | 'goal';
  plan: LearningPlan & {
    naturalPlanMarkdown?: string;
    structuredPlan?: LearningPlan['structuredPlan'];
    skipPlanningSideEffects?: boolean;
  };
  supersedePrevious?: boolean;
}

interface ApplyLearningPlanToWorkbenchInput {
  workspaceId: string;
  planId: string;
  workbenchId?: string | null;
  createWorkbench?: boolean;
  workbenchTitle?: string;
}

type LearningPlanStepStatusPatch = 'pending' | 'active' | 'done' | 'skipped' | 'blocked';

interface UpdateLearningPlanStepStatusInput {
  workspaceId: string;
  planId: string;
  stepId: string;
  status: LearningPlanStepStatusPatch;
}

type LearningPlanAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'archive'
  | 'restore'
  | 'supersede'
  | 'set_primary'
  | 'reopen'
  | 'duplicate'
  | 'replan';

interface PerformLearningPlanActionInput {
  workspaceId: string;
  planId: string;
  action: LearningPlanAction;
  targetPlanId?: string | null;
  title?: string;
  note?: string;
}

interface UpdateLearningPlanStepInput {
  workspaceId: string;
  planId: string;
  stepId: string;
  title?: string;
  description?: string;
  note?: string;
  estimateMinutes?: number | null;
  dueDate?: string | null;
  tags?: string[];
  artifactBindings?: Array<Record<string, unknown>>;
}

interface RecordLearningPlanFeedbackInput {
  workspaceId: string;
  planId: string;
  stepId?: string | null;
  category: 'too_hard' | 'too_easy' | 'blocked' | 'resource_mismatch' | 'replan' | 'other';
  note?: string;
  rating?: number | null;
}

const stringify = (value: unknown, fallback: string) => {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
};

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapLearningPlanRecord = (plan: any) => {
  const knowledgeGraphSnapshot = parseJson<Record<string, unknown>>(plan.knowledgeGraphSnapshotJson, {});
  return {
    id: plan.id,
    workspaceId: plan.workspaceId,
    workbenchId: plan.workbenchId,
    goalId: plan.goalId,
    scope: plan.scope,
    status: plan.status,
    version: plan.version,
    objective: plan.objective,
    rationale: plan.rationale,
    assumptions: parseJson(plan.assumptionsJson, []),
    constraints: parseJson(plan.constraintsJson, []),
    targetSkills: parseJson(plan.targetSkillsJson, []),
    weakSkills: parseJson(plan.weakSkillsJson, []),
    milestones: parseJson(plan.milestonesJson, []),
    steps: parseJson(plan.stepsJson, []),
    adaptationPolicy: parseJson(plan.adaptationPolicyJson, {}),
    evidence: parseJson(plan.evidenceJson, {}),
    diagnosticReport: parseJson(plan.diagnosticReportJson, {}),
    candidateResources: parseJson(plan.candidateResourcesJson, []),
    naturalPlanMarkdown: knowledgeGraphSnapshot.plannerMode === 'llm_only' ? plan.rationale : undefined,
    structuredPlan: knowledgeGraphSnapshot.plannerMode === 'llm_only'
      ? (knowledgeGraphSnapshot.structuredPlan as LearningPlan['structuredPlan'] | undefined) || null
      : undefined,
    knowledgeGraphSnapshot,
    reflectionHistory: parseJson(plan.reflectionHistoryJson, []),
    constraintScores: parseJson(plan.constraintScoresJson, {}),
    revisionCount: plan.revisionCount,
    nextStepId: plan.nextStepId,
    previousPlanId: plan.previousPlanId,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString()
  };
};

const stepIsOpen = (step: Record<string, any>) => !['done', 'skipped'].includes(String(step.status || 'pending'));

const structuredStageId = (stage: Record<string, any>, index: number) =>
  String(stage.id || `structured-${stage.order || index + 1}`);

const normalizePlanFeedback = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item: any) => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      stepId: typeof item.stepId === 'string' ? item.stepId : null,
      category: typeof item.category === 'string' ? item.category : 'other',
      note: typeof item.note === 'string' ? item.note : '',
      rating: typeof item.rating === 'number' ? item.rating : null,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
    }));
};

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class LearningMemoryService {
  private resolvePlanStep(plan: any, inputStepId: string) {
    const steps = parseJson<Array<Record<string, any>>>(plan.stepsJson, []);
    const knowledgeGraphSnapshot = parseJson<Record<string, any>>(plan.knowledgeGraphSnapshotJson, {});
    const structuredPlan = knowledgeGraphSnapshot.structuredPlan && typeof knowledgeGraphSnapshot.structuredPlan === 'object'
      ? knowledgeGraphSnapshot.structuredPlan as Record<string, any>
      : null;
    const structuredStages = Array.isArray(structuredPlan?.stages) ? structuredPlan.stages as Array<Record<string, any>> : [];
    const stepIndex = steps.findIndex((step, index) => {
      const id = String(step.id || '');
      return id === inputStepId || `step-${index + 1}` === inputStepId || `structured-${index + 1}` === inputStepId;
    });
    if (stepIndex >= 0) {
      return {
        source: 'steps' as const,
        steps,
        knowledgeGraphSnapshot,
        structuredPlan,
        structuredStages,
        index: stepIndex,
        step: steps[stepIndex],
        resolvedId: String(steps[stepIndex].id || `step-${stepIndex + 1}`)
      };
    }
    const structuredIndex = structuredStages.findIndex((stage, index) =>
      structuredStageId(stage, index) === inputStepId || `step-${index + 1}` === inputStepId
    );
    if (structuredIndex >= 0) {
      return {
        source: 'structured' as const,
        steps,
        knowledgeGraphSnapshot,
        structuredPlan,
        structuredStages,
        index: structuredIndex,
        step: structuredStages[structuredIndex],
        resolvedId: structuredStageId(structuredStages[structuredIndex], structuredIndex)
      };
    }
    return null;
  }

  private buildStepUpdateData(plan: any, resolved: NonNullable<ReturnType<LearningMemoryService['resolvePlanStep']>>, nextStep: Record<string, any>, nextStatusSource?: Array<Record<string, any>>) {
    if (resolved.source === 'steps') {
      const nextSteps = resolved.steps.map((step, index) => index === resolved.index ? nextStep : step);
      return {
        stepsJson: stringify(nextSteps, '[]'),
        knowledgeGraphSnapshotJson: plan.knowledgeGraphSnapshotJson,
        statusSource: nextStatusSource || nextSteps
      };
    }
    const nextStages = resolved.structuredStages.map((stage, index) => index === resolved.index ? nextStep : stage);
    const nextSnapshot = {
      ...resolved.knowledgeGraphSnapshot,
      structuredPlan: {
        ...(resolved.structuredPlan || {}),
        stages: nextStages
      }
    };
    return {
      stepsJson: plan.stepsJson,
      knowledgeGraphSnapshotJson: stringify(nextSnapshot, '{}'),
      statusSource: nextStatusSource || nextStages
    };
  }

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
    return learningEventCollectionService.collect(input);
  }

  async createTrace(input: UpsertTraceInput) {
    const trace = await prisma.learningTrace.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        summary: input.summary,
        masteryJson: stringify(input.mastery || {}, '{}'),
        nextActionsJson: stringify(input.nextActions || [], '[]')
      }
    });
    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'learning_trace',
      sourceType: 'learning_trace',
      sourceId: trace.id,
      actor: 'system',
      title: 'Learning trace',
      summary: input.summary,
      payload: {
        summary: input.summary,
        mastery: input.mastery || {},
        nextActions: input.nextActions || []
      },
      confidence: 0.68,
      observedAt: trace.updatedAt
    }).catch((error) => {
      console.warn('Failed to mirror learning trace into learner evidence:', error);
      return null;
    });
    if (evidence) {
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'knowledgeState',
        operation: 'merge',
        proposedBy: 'LearningTraceConsolidator',
        evidenceId: evidence.id,
        confidence: 0.68,
        rationale: 'Trace mastery signals update centralized knowledge state.',
        payload: {
          masterySignals: [input.mastery || {}],
          weakSkills: Object.keys(input.mastery || {}).filter((key) => {
            const value = (input.mastery || {})[key];
            return typeof value === 'number' ? value < 0.5 : false;
          })
        }
      }).catch((error) => console.warn('Failed to propose learner knowledge patch:', error));
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'reviewPlanning',
        operation: 'merge',
        proposedBy: 'LearningTraceConsolidator',
        evidenceId: evidence.id,
        confidence: 0.65,
        rationale: 'Trace next actions update review and planning signals.',
        payload: {
          nextActions: input.nextActions || []
        }
      }).catch((error) => console.warn('Failed to propose learner planning patch:', error));
      await learnerStateService.applyPendingPatches(input.workspaceId, {
        changedBy: 'LearningTraceConsolidator'
      }).catch((error) => console.warn('Failed to apply learner trace patches:', error));
    }
    return trace;
  }

  async saveLearningPlan(input: SaveLearningPlanInput) {
    const previousActive = await prisma.learningPlan.findFirst({
      where: {
        workspaceId: input.workspaceId,
        status: 'active',
        ...(input.goalId ? { goalId: input.goalId } : {}),
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {})
      },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }]
    });
    if ((input.supersedePrevious || input.workbenchId) && previousActive && previousActive.id !== input.plan.id) {
      await prisma.learningPlan.updateMany({
        where: {
          workspaceId: input.workspaceId,
          status: 'active',
          id: { not: input.plan.id },
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
          ...(input.goalId && !input.workbenchId ? { goalId: input.goalId } : {})
        },
        data: { status: 'superseded' }
      }).catch((error) => console.warn('Failed to supersede previous active learning plan:', error));
    }
    const nextVersion = Math.max(input.plan.version || 1, (previousActive?.version || 0) + 1);
    const planRecord = await prisma.learningPlan.create({
      data: {
        id: input.plan.id,
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        scope: input.scope || (input.goalId ? 'goal' : input.workbenchId ? 'workbench' : 'workspace'),
        status: input.plan.status,
        version: nextVersion,
        objective: input.plan.objective,
        rationale: input.plan.rationale,
        assumptionsJson: stringify(input.plan.assumptions, '[]'),
        constraintsJson: stringify(input.plan.constraints, '[]'),
        targetSkillsJson: stringify(input.plan.targetSkills, '[]'),
        weakSkillsJson: stringify(input.plan.weakSkills, '[]'),
        milestonesJson: stringify(input.plan.milestones, '[]'),
        stepsJson: stringify(input.plan.steps, '[]'),
        adaptationPolicyJson: stringify(input.plan.adaptationPolicy, '{}'),
        evidenceJson: stringify(input.plan.evidence, '{}'),
        diagnosticReportJson: stringify(input.plan.diagnosticReport || {}, '{}'),
        candidateResourcesJson: stringify(input.plan.candidateResources || [], '[]'),
        knowledgeGraphSnapshotJson: stringify(input.plan.skipPlanningSideEffects ? {
          ...(input.plan.knowledgeGraphSnapshot || {}),
          plannerMode: 'llm_only',
          sideEffectsPaused: true,
          structuredPlan: input.plan.structuredPlan || null
        } : input.plan.knowledgeGraphSnapshot || {}, '{}'),
        reflectionHistoryJson: stringify(input.plan.reflectionHistory || [], '[]'),
        constraintScoresJson: stringify(input.plan.constraintScores || {}, '{}'),
        revisionCount: input.plan.revisionCount || 0,
        nextStepId: input.plan.nextStepId || null,
        previousPlanId: input.plan.previousPlanId || previousActive?.id || null
      }
    });
    if (input.plan.skipPlanningSideEffects) {
      return planRecord;
    }
    const evidence = await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: 'learning_plan',
      sourceType: 'learning_plan',
      sourceId: planRecord.id,
      actor: 'agent',
      title: `Learning plan v${input.plan.version}`,
      summary: input.plan.diagnosticReport?.currentStateSummary || input.plan.objective,
      payload: {
        diagnosticReport: input.plan.diagnosticReport,
        targetSkills: input.plan.targetSkills,
        weakSkills: input.plan.weakSkills,
        nextStepId: input.plan.nextStepId,
        constraintScores: input.plan.constraintScores,
        knowledgeGraphSnapshot: input.plan.knowledgeGraphSnapshot
      },
      confidence: input.plan.constraintScores?.confidence ?? 0.72
    }).catch((error) => {
      console.warn('Failed to mirror learning plan into learner evidence:', error);
      return null;
    });
    if (evidence) {
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'cognitiveState',
        operation: 'merge',
        proposedBy: 'MclPlanner',
        evidenceId: evidence.id,
        confidence: input.plan.constraintScores?.confidence ?? 0.72,
        rationale: 'Planner diagnostic report updates learner cognitive state.',
        payload: {
          learnerLevel: input.plan.diagnosticReport.learnerLevel,
          cognitiveLoadTolerance: input.plan.diagnosticReport.cognitiveLoadTolerance,
          recommendedDifficultyBand: input.plan.diagnosticReport.recommendedDifficultyBand,
          zpdSignals: {
            prerequisiteGaps: input.plan.diagnosticReport.prerequisiteGaps,
            strengths: input.plan.diagnosticReport.strengths
          }
        }
      }).catch((error) => console.warn('Failed to propose learner cognitive patch:', error));
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'knowledgeState',
        operation: 'merge',
        proposedBy: 'MclPlanner',
        evidenceId: evidence.id,
        confidence: input.plan.constraintScores?.confidence ?? 0.72,
        rationale: 'Planner target and weak skills update learner knowledge state.',
        payload: {
          targetSkills: input.plan.targetSkills,
          weakSkills: input.plan.weakSkills
        }
      }).catch((error) => console.warn('Failed to propose learner skill patch:', error));
      await learnerStateService.proposePatch({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        targetDimension: 'reviewPlanning',
        operation: 'merge',
        proposedBy: 'MclPlanner',
        evidenceId: evidence.id,
        confidence: input.plan.constraintScores?.confidence ?? 0.72,
        rationale: 'Planner next steps update centralized review and planning signals.',
        payload: {
          activePlanId: input.plan.id,
          activePlanNextStepId: input.plan.nextStepId,
          nextActions: input.plan.steps.slice(0, 3).map((step) => step.title),
          replanTriggers: input.plan.adaptationPolicy.replanTriggers
        }
      }).catch((error) => console.warn('Failed to propose learner review patch:', error));
      await learnerStateService.applyPendingPatches(input.workspaceId, {
        changedBy: 'MclPlanner'
      }).catch((error) => console.warn('Failed to apply learner plan patches:', error));
    }
    await courseKnowledgeGraphService.bindPlan({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      planId: input.plan.id,
      targetSkills: input.plan.targetSkills,
      weakSkills: input.plan.weakSkills,
      steps: input.plan.steps as Array<Record<string, any>>
    }).catch((error) => console.warn('Course KG plan binding failed:', error));
    return planRecord;
  }

  async listLearningPlans(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    limit?: number;
  }) {
    const plans = await prisma.learningPlan.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.workbenchId ? { workbenchId: input.workbenchId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {})
      },
      orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }],
      take: input.limit || 30
    });

    return plans.map(mapLearningPlanRecord);
  }

  async applyLearningPlanToWorkbench(input: ApplyLearningPlanToWorkbenchInput) {
    const plan = await prisma.learningPlan.findFirst({
      where: {
        id: input.planId,
        workspaceId: input.workspaceId
      }
    });

    if (!plan) return null;

    let targetWorkbenchId = input.workbenchId || null;
    let workbench = targetWorkbenchId
      ? await prisma.workbench.findFirst({
          where: { id: targetWorkbenchId, workspaceId: input.workspaceId },
          select: { id: true, title: true, description: true, workspaceId: true, updatedAt: true }
        })
      : null;

    if (!workbench && input.createWorkbench) {
      const titleSeed = input.workbenchTitle?.trim() || plan.objective || 'Plan Workbench';
      const created = await workbenchService.create(input.workspaceId, {
        title: titleSeed,
        description: plan.objective
      });
      targetWorkbenchId = created.id;
      workbench = {
        id: created.id,
        title: created.title,
        description: created.description,
        workspaceId: created.workspaceId,
        updatedAt: new Date(created.updatedAt)
      };
    }

    if (!targetWorkbenchId || !workbench) {
      throw new Error('Target workbench was not found');
    }

    await prisma.learningPlan.updateMany({
      where: {
        workspaceId: input.workspaceId,
        workbenchId: targetWorkbenchId,
        status: 'active',
        id: { not: plan.id }
      },
      data: { status: 'superseded' }
    });

    const updatedPlan = await prisma.learningPlan.update({
      where: { id: plan.id },
      data: {
        workbenchId: targetWorkbenchId,
        scope: 'workbench',
        status: 'active'
      }
    });

    await courseKnowledgeGraphService.bindPlan({
      workspaceId: input.workspaceId,
      workbenchId: targetWorkbenchId,
      goalId: updatedPlan.goalId || null,
      planId: updatedPlan.id,
      targetSkills: parseJson(updatedPlan.targetSkillsJson, []),
      weakSkills: parseJson(updatedPlan.weakSkillsJson, []),
      steps: parseJson(updatedPlan.stepsJson, [])
    }).catch((error) => console.warn('Course KG plan rebinding failed:', error));

    await this.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: targetWorkbenchId,
      goalId: updatedPlan.goalId || null,
      eventType: 'learning_plan.applied_to_workbench',
      actor: 'user',
      payload: {
        planId: updatedPlan.id,
        workbenchId: targetWorkbenchId,
        createdWorkbench: Boolean(input.createWorkbench && !input.workbenchId)
      },
      object: { type: 'learning_plan', id: updatedPlan.id, title: updatedPlan.objective },
      source: { component: 'planning' },
      confidence: 0.9
    }).catch((error) => console.warn('Failed to record plan apply event:', error));

    return {
      plan: mapLearningPlanRecord(updatedPlan),
      workbench
    };
  }

  async updateLearningPlanStepStatus(input: UpdateLearningPlanStepStatusInput) {
    const plan = await prisma.learningPlan.findFirst({
      where: {
        id: input.planId,
        workspaceId: input.workspaceId
      }
    });

    if (!plan) return null;

    const steps = parseJson<Array<Record<string, any>>>(plan.stepsJson, []);
    const knowledgeGraphSnapshot = parseJson<Record<string, any>>(plan.knowledgeGraphSnapshotJson, {});
    const structuredPlan = knowledgeGraphSnapshot.structuredPlan && typeof knowledgeGraphSnapshot.structuredPlan === 'object'
      ? knowledgeGraphSnapshot.structuredPlan as Record<string, any>
      : null;
    let changed = false;
    const nextSteps = steps.map((step, index) => {
      const stepId = String(step.id || '');
      const fallbackStepId = `step-${index + 1}`;
      const structuredFallbackId = `structured-${index + 1}`;
      const matches = stepId === input.stepId || fallbackStepId === input.stepId || structuredFallbackId === input.stepId;
      if (!matches && input.status === 'active' && step.status === 'active') {
        changed = true;
        return { ...step, status: 'pending' };
      }
      if (!matches) return step;
      changed = true;
      return { ...step, status: input.status };
    });

    const structuredStages = Array.isArray(structuredPlan?.stages) ? structuredPlan.stages as Array<Record<string, any>> : [];
    let structuredChanged = false;
    const nextStructuredStages = !changed && structuredStages.length
      ? structuredStages.map((stage, index) => {
          const stageId = structuredStageId(stage, index);
          const matches = stageId === input.stepId || `step-${index + 1}` === input.stepId;
          if (!matches && input.status === 'active' && stage.status === 'active') {
            structuredChanged = true;
            return { ...stage, status: 'pending' };
          }
          if (!matches) return stage;
          structuredChanged = true;
          return { ...stage, status: input.status };
        })
      : structuredStages;

    if (!changed) {
      changed = structuredChanged;
    }

    if (!changed) {
      throw new Error(`Plan step not found: ${input.stepId}`);
    }

    const statusSource = nextSteps.length ? nextSteps : nextStructuredStages;
    const nextOpenStep = statusSource.find(stepIsOpen);
    const nextOpenStepId = nextOpenStep
      ? (nextSteps.length ? nextOpenStep.id : structuredStageId(nextOpenStep, statusSource.indexOf(nextOpenStep)))
      : null;
    const activeStepId = statusSource.find((step, index) => {
      const id = nextSteps.length ? String(step.id || '') : structuredStageId(step, index);
      return id === input.stepId || `step-${index + 1}` === input.stepId;
    });
    const activeStepResolvedId = activeStepId
      ? (nextSteps.length ? String(activeStepId.id || input.stepId) : input.stepId)
      : input.stepId;
    const allDone = statusSource.length > 0 && statusSource.every((step) => ['done', 'skipped'].includes(String(step.status || 'pending')));
    const nextKnowledgeGraphSnapshot = structuredChanged && structuredPlan
      ? {
          ...knowledgeGraphSnapshot,
          structuredPlan: {
            ...structuredPlan,
            stages: nextStructuredStages
          }
        }
      : knowledgeGraphSnapshot;
    const updatedPlan = await prisma.learningPlan.update({
      where: { id: plan.id },
      data: {
        stepsJson: stringify(nextSteps, '[]'),
        knowledgeGraphSnapshotJson: stringify(nextKnowledgeGraphSnapshot, '{}'),
        nextStepId: input.status === 'active' ? activeStepResolvedId : nextOpenStepId,
        status: allDone ? 'completed' : plan.status === 'completed' ? 'active' : plan.status
      }
    });

    await this.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: updatedPlan.workbenchId || null,
      goalId: updatedPlan.goalId || null,
      eventType: 'learning_plan.step_status_updated',
      actor: 'user',
      payload: {
        planId: updatedPlan.id,
        stepId: input.stepId,
        status: input.status,
        nextStepId: updatedPlan.nextStepId
      },
      object: {
        type: 'learning_plan_step',
        id: input.stepId,
        title: statusSource.find((step, index) => {
          const id = nextSteps.length ? String(step.id || '') : structuredStageId(step, index);
          return id === input.stepId || `step-${index + 1}` === input.stepId;
        })?.title || null
      },
      source: { component: 'workbench_plans' },
      confidence: 0.88
    }).catch((error) => console.warn('Failed to record plan step status event:', error));

    return mapLearningPlanRecord(updatedPlan);
  }

  async updateLearningPlanStep(input: UpdateLearningPlanStepInput) {
    const plan = await prisma.learningPlan.findFirst({
      where: { id: input.planId, workspaceId: input.workspaceId }
    });
    if (!plan) return null;

    const resolved = this.resolvePlanStep(plan, input.stepId);
    if (!resolved) throw new Error(`Plan step not found: ${input.stepId}`);

    const currentStep = cloneDeep(resolved.step || {});
    const nextStep = {
      ...currentStep,
      title: typeof input.title === 'string' ? input.title.trim() || currentStep.title : currentStep.title,
      description: typeof input.description === 'string' ? input.description.trim() : currentStep.description,
      note: typeof input.note === 'string' ? input.note.trim() : currentStep.note,
      estimatedMinutes: typeof input.estimateMinutes === 'number' ? input.estimateMinutes : currentStep.estimatedMinutes,
      dueDate: typeof input.dueDate === 'string' ? input.dueDate : currentStep.dueDate,
      tags: Array.isArray(input.tags) ? input.tags.filter((item) => typeof item === 'string') : currentStep.tags,
      artifactBindings: Array.isArray(input.artifactBindings) ? input.artifactBindings : currentStep.artifactBindings
    };

    const { stepsJson, knowledgeGraphSnapshotJson, statusSource } = this.buildStepUpdateData(
      plan,
      resolved,
      nextStep
    );

    const updatedPlan = await prisma.learningPlan.update({
      where: { id: plan.id },
      data: {
        stepsJson,
        knowledgeGraphSnapshotJson
      }
    });

    await this.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: updatedPlan.workbenchId || null,
      goalId: updatedPlan.goalId || null,
      eventType: 'learning_plan.step_updated',
      actor: 'user',
      payload: {
        planId: updatedPlan.id,
        stepId: input.stepId,
        title: nextStep.title,
        note: nextStep.note || null,
        estimateMinutes: nextStep.estimatedMinutes ?? null,
        dueDate: nextStep.dueDate ?? null,
        tags: nextStep.tags || []
      },
      object: { type: 'learning_plan_step', id: input.stepId, title: nextStep.title || null },
      source: { component: 'workbench_plans' },
      confidence: 0.85
    }).catch((error) => console.warn('Failed to record plan step update event:', error));

    return mapLearningPlanRecord(updatedPlan);
  }

  async recordLearningPlanFeedback(input: RecordLearningPlanFeedbackInput) {
    const plan = await prisma.learningPlan.findFirst({
      where: { id: input.planId, workspaceId: input.workspaceId }
    });
    if (!plan) return null;

    const knowledgeGraphSnapshot = parseJson<Record<string, any>>(plan.knowledgeGraphSnapshotJson, {});
    const existingFeedback = normalizePlanFeedback(knowledgeGraphSnapshot.planFeedback);
    const feedback = {
      id: crypto.randomUUID(),
      stepId: input.stepId || null,
      category: input.category,
      note: input.note || '',
      rating: typeof input.rating === 'number' ? input.rating : null,
      createdAt: new Date().toISOString()
    };

    const updatedSnapshot = {
      ...knowledgeGraphSnapshot,
      planFeedback: [...existingFeedback, feedback]
    };

    const updatedPlan = await prisma.learningPlan.update({
      where: { id: plan.id },
      data: {
        knowledgeGraphSnapshotJson: stringify(updatedSnapshot, '{}')
      }
    });

    await this.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: updatedPlan.workbenchId || null,
      goalId: updatedPlan.goalId || null,
      eventType: 'learning_plan.feedback_recorded',
      actor: 'user',
      payload: feedback,
      object: { type: 'learning_plan', id: updatedPlan.id, title: updatedPlan.objective },
      source: { component: 'workbench_plans' },
      confidence: 0.84
    }).catch((error) => console.warn('Failed to record plan feedback event:', error));

    return mapLearningPlanRecord(updatedPlan);
  }

  async performLearningPlanAction(input: PerformLearningPlanActionInput) {
    const plan = await prisma.learningPlan.findFirst({
      where: { id: input.planId, workspaceId: input.workspaceId }
    });
    if (!plan) return null;

    if (input.action === 'duplicate') {
      const newPlanId = crypto.randomUUID();
      const duplicate = await prisma.learningPlan.create({
        data: {
          id: newPlanId,
          workspaceId: plan.workspaceId,
          workbenchId: plan.workbenchId,
          goalId: plan.goalId,
          scope: plan.scope,
          status: 'active',
          version: plan.version + 1,
          objective: input.title?.trim() || `${plan.objective} copy`,
          rationale: plan.rationale,
          assumptionsJson: plan.assumptionsJson,
          constraintsJson: plan.constraintsJson,
          targetSkillsJson: plan.targetSkillsJson,
          weakSkillsJson: plan.weakSkillsJson,
          milestonesJson: plan.milestonesJson,
          stepsJson: plan.stepsJson,
          adaptationPolicyJson: plan.adaptationPolicyJson,
          evidenceJson: plan.evidenceJson,
          diagnosticReportJson: plan.diagnosticReportJson,
          candidateResourcesJson: plan.candidateResourcesJson,
          knowledgeGraphSnapshotJson: plan.knowledgeGraphSnapshotJson,
          reflectionHistoryJson: plan.reflectionHistoryJson,
          constraintScoresJson: plan.constraintScoresJson,
          revisionCount: plan.revisionCount,
          nextStepId: plan.nextStepId,
          previousPlanId: plan.id
        }
      });
      await this.recordEvent({
        workspaceId: input.workspaceId,
        workbenchId: duplicate.workbenchId || null,
        goalId: duplicate.goalId || null,
        eventType: 'learning_plan.duplicated',
        actor: 'user',
        payload: { planId: plan.id, duplicatePlanId: duplicate.id },
        object: { type: 'learning_plan', id: duplicate.id, title: duplicate.objective },
        source: { component: 'workbench_plans' },
        confidence: 0.88
      }).catch((error) => console.warn('Failed to record plan duplicate event:', error));
      return mapLearningPlanRecord(duplicate);
    }

    const nextStatus =
      input.action === 'pause' ? 'paused' :
      input.action === 'complete' ? 'completed' :
      input.action === 'archive' || input.action === 'supersede' ? 'superseded' :
      input.action === 'reopen' || input.action === 'restore' || input.action === 'start' || input.action === 'resume' || input.action === 'set_primary'
        ? 'active'
        : plan.status;

    if (input.action === 'set_primary') {
      await prisma.learningPlan.updateMany({
        where: {
          workspaceId: input.workspaceId,
          workbenchId: plan.workbenchId || null,
          status: 'active',
          id: { not: plan.id }
        },
        data: { status: 'superseded' }
      });
    }

    const updatedPlan = await prisma.learningPlan.update({
      where: { id: plan.id },
      data: {
        status: nextStatus,
        scope: input.action === 'set_primary' ? 'workbench' : plan.scope
      }
    });

    await this.recordEvent({
      workspaceId: input.workspaceId,
      workbenchId: updatedPlan.workbenchId || null,
      goalId: updatedPlan.goalId || null,
      eventType: `learning_plan.${input.action}`,
      actor: 'user',
      payload: { planId: updatedPlan.id, note: input.note || null, targetPlanId: input.targetPlanId || null },
      object: { type: 'learning_plan', id: updatedPlan.id, title: updatedPlan.objective },
      source: { component: 'workbench_plans' },
      confidence: 0.88
    }).catch((error) => console.warn('Failed to record plan action event:', error));

    return mapLearningPlanRecord(updatedPlan);
  }

  async supersedeLearningPlan(planId: string) {
    return prisma.learningPlan.update({
      where: { id: planId },
      data: {
        status: 'superseded'
      }
    });
  }

  async restoreLearningPlan(input: { workspaceId: string; planId: string }) {
    return this.performLearningPlanAction({
      workspaceId: input.workspaceId,
      planId: input.planId,
      action: 'restore'
    });
  }

  async rollbackLearningPlanToVersion(input: { workspaceId: string; planId: string; targetPlanId: string }) {
    const target = await prisma.learningPlan.findFirst({
      where: { id: input.targetPlanId, workspaceId: input.workspaceId }
    });
    if (!target) return null;
    await prisma.learningPlan.updateMany({
      where: {
        workspaceId: input.workspaceId,
        workbenchId: target.workbenchId || null,
        status: 'active',
        id: { not: target.id }
      },
      data: { status: 'superseded' }
    });
    const updated = await prisma.learningPlan.update({
      where: { id: target.id },
      data: { status: 'active', scope: target.workbenchId ? 'workbench' : target.scope }
    });
    return mapLearningPlanRecord(updated);
  }
}

export const learningMemoryService = new LearningMemoryService();
