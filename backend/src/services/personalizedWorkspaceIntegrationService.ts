import prisma from '../config/db';
import { knowledgeGraphPlanningAgentService } from './knowledgeGraphPlanningAgentService';
import { learnerStateContextAdapter } from './learnerStateContextAdapter';
import { learningEventDiagnosticsService } from './learningEventDiagnosticsService';

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const clip = (value: unknown, maxLength = 260) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const unique = (items: Array<string | null | undefined>) =>
  Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));

export class PersonalizedWorkspaceIntegrationService {
  async build(input: {
    workspaceId: string;
    workbenchId?: string | null;
    goalId?: string | null;
    query?: string;
  }) {
    const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new Error('Workspace not found');

    const [learnerContext, activePlanRecord, recentWorkbench, eventDiagnostics] = await Promise.all([
      learnerStateContextAdapter.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        audience: 'tutor',
        tokenBudget: 1000
      }),
      prisma.learningPlan.findFirst({
        where: {
          workspaceId: input.workspaceId,
          status: 'active',
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.workbenchId ? { workbenchId: input.workbenchId } : {})
        },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }]
      }),
      prisma.workbench.findFirst({
        where: { workspaceId: input.workspaceId, ...(input.workbenchId ? { id: input.workbenchId } : {}) },
        orderBy: [{ lastOpenedAt: 'desc' }, { updatedAt: 'desc' }]
      }),
      learningEventDiagnosticsService.summarize({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || null,
        goalId: input.goalId || null,
        days: 14,
        limit: 120
      }).catch(() => undefined)
    ]);

    const kgPlan = await knowledgeGraphPlanningAgentService.plan({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || recentWorkbench?.id || null,
      goalId: input.goalId || activePlanRecord?.goalId || null,
      objective: input.query || activePlanRecord?.objective || undefined,
      maxConcepts: 8
    }).catch(() => null);

    const activePlan = activePlanRecord
      ? {
          id: activePlanRecord.id,
          workspaceId: activePlanRecord.workspaceId,
          workbenchId: activePlanRecord.workbenchId,
          goalId: activePlanRecord.goalId,
          scope: activePlanRecord.scope,
          status: activePlanRecord.status,
          objective: activePlanRecord.objective,
          rationale: activePlanRecord.rationale,
          version: activePlanRecord.version,
          nextStepId: activePlanRecord.nextStepId,
          assumptions: parseJson<string[]>(activePlanRecord.assumptionsJson, []),
          constraints: parseJson<string[]>(activePlanRecord.constraintsJson, []),
          milestones: parseJson<Array<Record<string, any>>>(activePlanRecord.milestonesJson, []),
          steps: parseJson<Array<Record<string, any>>>(activePlanRecord.stepsJson, []),
          targetSkills: parseJson<string[]>(activePlanRecord.targetSkillsJson, []),
          weakSkills: parseJson<string[]>(activePlanRecord.weakSkillsJson, []),
          adaptationPolicy: parseJson<Record<string, any>>(activePlanRecord.adaptationPolicyJson, {}),
          evidence: parseJson<Record<string, any>>(activePlanRecord.evidenceJson, {}),
          diagnosticReport: parseJson<Record<string, any>>(activePlanRecord.diagnosticReportJson, {}),
          candidateResources: parseJson<Array<Record<string, any>>>(activePlanRecord.candidateResourcesJson, []),
          knowledgeGraphSnapshot: parseJson<Record<string, any>>(activePlanRecord.knowledgeGraphSnapshotJson, {}),
          reflectionHistory: parseJson<Array<Record<string, any>>>(activePlanRecord.reflectionHistoryJson, []),
          constraintScores: parseJson<Record<string, any>>(activePlanRecord.constraintScoresJson, {}),
          revisionCount: activePlanRecord.revisionCount,
          previousPlanId: activePlanRecord.previousPlanId,
          createdAt: activePlanRecord.createdAt.toISOString(),
          updatedAt: activePlanRecord.updatedAt.toISOString()
        }
      : null;

    const planSteps = kgPlan?.steps?.length ? kgPlan.steps : activePlan?.steps || [];
    const nextStep = planSteps.find((step: any) => step.status === 'active') || planSteps[0] || null;
    const weakSkills = unique([
      ...(kgPlan?.weakSkills || []),
      ...(activePlan?.weakSkills || []),
      ...(learnerContext.learningSignals.stableWeaknesses || []),
      ...(learnerContext.learningSignals.candidateWeaknesses || [])
    ]).slice(0, 8);
    const strengths = unique([
      ...(kgPlan?.diagnosticReport?.strengths || []),
      ...(learnerContext.learningSignals.emergingStrengths || [])
    ]).slice(0, 6);

    const resourceRecommendations = (kgPlan?.candidateResources || []).slice(0, 8).map((resource) => ({
      id: resource.id,
      title: resource.title,
      type: resource.type,
      sourceId: resource.sourceId,
      summary: resource.summary,
      relevanceScore: resource.relevanceScore,
      reason: `与 ${resource.citationLabel || weakSkills[0] || '当前学习目标'} 相关，可支撑下一步学习。`,
      explanation: '来自课程知识图谱的 concept-resource/task/quiz 绑定，并结合 learner state 中的薄弱点排序。'
    }));

    const taskRecommendations = planSteps.slice(0, 6).map((step: any, index: number) => ({
      id: step.id || `task-${index + 1}`,
      title: step.title || `学习任务 ${index + 1}`,
      type: step.type || 'practice',
      targetSkills: Array.isArray(step.targetSkills) ? step.targetSkills : [],
      estimatedLoad: step.estimatedLoad || 'medium',
      expectedEvidence: Array.isArray(step.expectedEvidence) ? step.expectedEvidence : [],
      status: index === 0 ? 'active' : step.status || 'pending',
      reason: clip(step.rationale || '该任务来自 KG planning agent 的下一步路径。', 300)
    }));

    const continueLearning = {
      workbenchId: input.workbenchId || recentWorkbench?.id || null,
      workbenchTitle: recentWorkbench?.title || recentWorkbench?.name || null,
      planId: kgPlan?.id || activePlan?.id || null,
      nextStepId: nextStep?.id || null,
      nextStepTitle: nextStep?.title || '建立学习基线',
      prompt: this.buildContinuePrompt(nextStep, weakSkills, input.query),
      updatedAt: recentWorkbench?.lastOpenedAt?.toISOString() || activePlan?.updatedAt || null
    };

    return {
      schema: 'personalized_workspace_integration.v1',
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || recentWorkbench?.id || null,
      learnerState: {
        summary: learnerContext.summary,
        strengths,
        weakSkills,
        preferences: learnerContext.learningSignals.preferredResourceForms || [],
        currentNeeds: [
          ...(eventDiagnostics?.diagnosticHints || []),
          weakSkills.length ? 'weak_concepts_need_support' : '',
          kgPlan?.diagnosticReport?.prerequisiteGaps?.length ? 'prerequisite_gaps_found' : ''
        ].filter(Boolean)
      },
      terminalGuidance: {
        tutorStyle: this.pickTutorStyle(eventDiagnostics, weakSkills),
        responseRules: [
          'Use learner state as context, not as a fixed label.',
          'When the learner is confused, answer the confusion before adding new material.',
          'Prefer KG-grounded resources and next steps over generic advice.',
          'Explain recommendation evidence briefly when suggesting a next step.'
        ],
        suggestedPrompts: [
          continueLearning.prompt,
          weakSkills[0] ? `帮我用一个例子讲清楚 ${weakSkills[0]}` : '帮我诊断当前最该学什么',
          nextStep?.title ? `我想继续：${nextStep.title}` : '根据我的学习状态推荐下一步'
        ].filter(Boolean).slice(0, 4)
      },
      activePlan,
      continueLearning,
      resourceRecommendations,
      taskRecommendations,
      pathPreview: kgPlan
        ? {
            objective: kgPlan.objective,
            milestones: kgPlan.milestones,
            steps: kgPlan.steps,
            constraintScores: kgPlan.constraintScores,
            planningTrace: kgPlan.planningTrace
          }
        : null,
      recommendationExplanations: [
        weakSkills.length ? `优先推荐这些内容，是因为 learner state / KG learner state 显示 ${weakSkills.slice(0, 3).join('、')} 仍需要支持。` : '',
        kgPlan?.diagnosticReport?.prerequisiteGaps?.length ? `路径先补前置知识：${kgPlan.diagnosticReport.prerequisiteGaps.slice(0, 3).join('、')}。` : '',
        resourceRecommendations.length ? '资源推荐来自课程知识图谱中与薄弱/目标概念绑定的资源、任务或测验。' : '',
        eventDiagnostics?.diagnosticHints?.length ? `近期行为信号：${eventDiagnostics.diagnosticHints.slice(0, 4).join('、')}。` : ''
      ].filter(Boolean),
      evidence: {
        learnerStateVersion: learnerContext.provenance.version,
        activePlanId: activePlan?.id || null,
        kgPlanGenerated: Boolean(kgPlan),
        eventDiagnosticWindowDays: eventDiagnostics?.windowDays || null
      }
    };
  }

  private pickTutorStyle(eventDiagnostics: any, weakSkills: string[]) {
    const hints = eventDiagnostics?.diagnosticHints || [];
    if (hints.includes('recent_confusion_high') || hints.includes('sequence_repeated_confusion')) {
      return 'slow_scaffolded_feedback';
    }
    if (hints.includes('mastery_evidence_present') && weakSkills.length <= 2) return 'challenge_with_checkpoints';
    if (hints.includes('help_seeking_high')) return 'hint_first_then_explain';
    return 'balanced_personalized_tutor';
  }

  private buildContinuePrompt(nextStep: any, weakSkills: string[], query?: string) {
    if (query) return `基于我的画像和课程图谱，继续处理：${query}`;
    if (nextStep?.title) return `继续上次学习现场，先完成：${nextStep.title}`;
    if (weakSkills[0]) return `我想先补齐薄弱点：${weakSkills[0]}`;
    return '根据我的学习状态推荐下一步';
  }
}

export const personalizedWorkspaceIntegrationService = new PersonalizedWorkspaceIntegrationService();
