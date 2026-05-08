import prisma from '../config/db';
import { learnerStateService } from './learnerStateService';
import { LearningPlan } from './planningTypes';

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

interface SaveLearningPlanInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  scope?: 'workspace' | 'workbench' | 'goal';
  plan: LearningPlan;
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
    const event = await prisma.learningEvent.create({
      data: {
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        eventType: input.eventType,
        actor: input.actor || 'system',
        payloadJson: stringify(input.payload || {}, '{}')
      }
    });
    await learnerStateService.recordEvidence({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || null,
      goalId: input.goalId || null,
      evidenceType: input.eventType,
      sourceType: 'learning_event',
      sourceId: event.id,
      actor: input.actor || 'system',
      title: input.eventType,
      summary: input.eventType,
      payload: input.payload || {},
      confidence: 0.55,
      observedAt: event.createdAt
    }).catch((error) => {
      console.warn('Failed to mirror learning event into learner evidence:', error);
    });
    return event;
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
    const planRecord = await prisma.learningPlan.create({
      data: {
        id: input.plan.id,
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        scope: input.scope || (input.goalId ? 'goal' : input.workbenchId ? 'workbench' : 'workspace'),
        status: input.plan.status,
        version: input.plan.version,
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
        knowledgeGraphSnapshotJson: stringify(input.plan.knowledgeGraphSnapshot || {}, '{}'),
        reflectionHistoryJson: stringify(input.plan.reflectionHistory || [], '[]'),
        constraintScoresJson: stringify(input.plan.constraintScores || {}, '{}'),
        revisionCount: input.plan.revisionCount || 0,
        nextStepId: input.plan.nextStepId || null,
        previousPlanId: input.plan.previousPlanId || null
      }
    });
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
    return planRecord;
  }

  async supersedeLearningPlan(planId: string) {
    return prisma.learningPlan.update({
      where: { id: planId },
      data: {
        status: 'superseded'
      }
    });
  }
}

export const learningMemoryService = new LearningMemoryService();
