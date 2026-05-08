import { aiStudioService, StudioResourceType } from './aiStudioService';
import { CapabilityName, capabilityRegistry } from './capabilityRegistry';
import { ClientWorkbenchContext } from './contextSystemService';
import { learningMemoryService } from './learningMemoryService';
import { learningRunService } from './learningRunService';
import { learningStateBuilder, BuiltMclLearningState } from './learningStateBuilder';
import { mclPlannerService } from './mclPlannerService';
import { multiAgentOrchestrator } from './multiAgentOrchestrator';
import { LearningPlan } from './planningTypes';

export type MclIntent =
  | 'state'
  | 'chat'
  | 'planning'
  | 'goal_planning'
  | 'diagnosis'
  | 'knowledge_retrieval'
  | 'reflection'
  | 'content_generation'
  | 'quiz_generation'
  | 'studio_generate';

export interface MclExecuteInput {
  workspaceId: string;
  workbenchId?: string | null;
  goalId?: string | null;
  intent?: MclIntent | string;
  userInput?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  resourceType?: StudioResourceType;
  options?: Record<string, unknown>;
  capability?: CapabilityName;
  capabilityInput?: Record<string, unknown>;
  context?: Partial<ClientWorkbenchContext>;
  previousPlan?: LearningPlan | null;
}

const studioResourceTypes = new Set<StudioResourceType>([
  'report',
  'slide_deck',
  'mind_map',
  'flashcards',
  'quiz',
  'data_table'
]);

const capabilityIntents = new Set<CapabilityName>([
  'goal_planning',
  'diagnosis',
  'content_generation',
  'knowledge_retrieval',
  'reflection',
  'quiz_generation'
]);

const latestUserMessage = (messages?: MclExecuteInput['messages']) =>
  [...(messages || [])].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() || '';

const inferIntent = (input: MclExecuteInput): MclIntent => {
  if (input.intent && input.intent !== 'auto') return input.intent as MclIntent;
  if (input.resourceType && studioResourceTypes.has(input.resourceType)) return 'studio_generate';
  if (input.capability) return input.capability;

  const text = (input.userInput || latestUserMessage(input.messages)).toLowerCase();
  if (!text) return 'state';
  if (/quiz|测验|题目|出题|练习题/.test(text)) return 'quiz_generation';
  if (/flashcard|抽认卡|卡片|复习卡/.test(text)) return 'studio_generate';
  if (/mind\s*map|思维导图|概念图|知识图谱/.test(text)) return 'studio_generate';
  if (/planner|planning|自主规划|动态规划|学习计划|plan/.test(text)) return 'planning';
  if (/目标|规划|路线|计划|学习路径/.test(text)) return 'goal_planning';
  if (/诊断|短板|薄弱|掌握|水平/.test(text)) return 'diagnosis';
  if (/检索|查找|资料|来源|引用|知识库/.test(text)) return 'knowledge_retrieval';
  if (/总结|进度|复盘|下一步|状态/.test(text)) return 'reflection';
  return 'chat';
};

const resolveStudioResourceType = (input: MclExecuteInput, intent: MclIntent): StudioResourceType => {
  if (input.resourceType && studioResourceTypes.has(input.resourceType)) return input.resourceType;
  const text = (input.userInput || latestUserMessage(input.messages)).toLowerCase();
  if (/flashcard|抽认卡|卡片|复习卡/.test(text)) return 'flashcards';
  if (/mind\s*map|思维导图|概念图|知识图谱/.test(text)) return 'mind_map';
  if (intent === 'quiz_generation') return 'quiz';
  return 'report';
};

const capabilityForIntent = (intent: MclIntent, explicit?: CapabilityName): CapabilityName | null => {
  if (explicit) return explicit;
  return capabilityIntents.has(intent as CapabilityName) ? (intent as CapabilityName) : null;
};

const summarizeTimeline = (stateBundle: BuiltMclLearningState) => [
  {
    agentName: 'LearningStateBuilder',
    inputSummary: `intent=${stateBundle.state.currentTask.intent}`,
    outputSummary: `goal=${stateBundle.state.activeGoal?.title || 'none'}, citations=${stateBundle.capsule.citations.length}`,
    status: 'completed' as const
  }
];

const buildTimelineFromRunStages = (stages: Array<{ name: string; status: string; durationMs?: number; summary?: string; error?: string }>) =>
  stages.map((stage) => ({
    agentName: stage.name,
    inputSummary: stage.durationMs != null ? `${stage.durationMs}ms` : 'running',
    outputSummary: stage.error || stage.summary || stage.status,
    status: stage.status
  }));

export class MclOrchestrator {
  async startPlanningRun(input: MclExecuteInput) {
    const intent = inferIntent(input);
    if (intent !== 'planning') {
      throw new Error(`Async planning only supports planning intent, received "${intent}"`);
    }

    const userInput = input.userInput || latestUserMessage(input.messages) || intent;
    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || input.context?.workbenchId || null,
      goalId: input.goalId || null,
      intent: 'mcl:planning',
      input: {
        userInput,
        previousPlanVersion: input.previousPlan?.version || null,
        async: true
      }
    });

    setTimeout(() => {
      void this.executePlanningRun(run.id, input, userInput).catch(async (error) => {
        await learningRunService.failRun(run.id, error).catch(() => undefined);
      });
    }, 0);

    return {
      intent,
      runId: run.id,
      status: run.status,
      timeline: [
        {
          agentName: 'PlanningRun',
          inputSummary: 'queued',
          outputSummary: 'MCL planning has started in the background.',
          status: 'running'
        }
      ]
    };
  }

  private async executePlanningRun(runId: string, input: MclExecuteInput, userInput: string) {
    const stageEvents: Array<{ name: string; status: string; durationMs?: number; summary?: string; error?: string }> = [];
    const stateStep = await learningRunService.startStep(runId, 'LearningStateBuilder', {
      summary: 'Build workspace-level learning state.',
      intent: 'planning'
    });
    const stateStartedAt = Date.now();
    let stateStepCompleted = false;

    try {
      const stateBundle = await learningStateBuilder.build({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context?.workbenchId || null,
        goalId: input.goalId || null,
        intent: 'planning',
        userInput,
        resourceType: input.resourceType,
        context: input.context
      });
      const stateDurationMs = Date.now() - stateStartedAt;
      await learningRunService.completeStep(stateStep.id, {
        summary: `goal=${stateBundle.state.activeGoal?.title || 'none'}, citations=${stateBundle.capsule.citations.length}`,
        durationMs: stateDurationMs
      });
      stateStepCompleted = true;

      const previous = input.previousPlan || this.extractPreviousPlan(stateBundle);
      const plan = await mclPlannerService.planOrRevise({
        stateBundle,
        userInput,
        previousPlan: previous,
        options: {
          runId,
          onStage: (event) => {
            stageEvents.push(event);
          }
        }
      });

      const saveStep = await learningRunService.startStep(runId, 'PlanPersistence', {
        summary: 'Save plan, event and learning trace.',
        planId: plan.id
      });

      try {
        if (previous?.id) {
          await learningMemoryService.supersedeLearningPlan(previous.id);
        }

        await learningMemoryService.saveLearningPlan({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
          scope: plan.scope,
          plan
        });

        await learningMemoryService.recordEvent({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
          eventType: previous ? 'mcl.plan_revised' : 'mcl.plan_created',
          actor: 'agent',
          payload: {
            planId: plan.id,
            version: plan.version,
            nextStepId: plan.nextStepId,
            stepCount: plan.steps.length
          }
        });

        await learningMemoryService.createTrace({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
          summary: `MCL Planner 输出 v${plan.version} 计划：${plan.objective}`,
          mastery: {
            planning: {
              planId: plan.id,
              version: plan.version,
              nextStepId: plan.nextStepId
            }
          },
          nextActions: plan.steps.slice(0, 3).map((step) => step.title)
        });

        await learningRunService.completeStep(saveStep.id, {
          summary: `Saved plan v${plan.version} with ${plan.steps.length} steps.`,
          planId: plan.id,
          version: plan.version
        });
      } catch (error) {
        await learningRunService.failStep(saveStep.id, error);
        throw error;
      }

      await learningRunService.completeRun(runId, {
        intent: 'planning',
        plan,
        learningState: stateBundle.state,
        contextCapsule: stateBundle.capsule,
        contextPolicy: stateBundle.contextPolicy,
        timeline: [...summarizeTimeline(stateBundle), ...buildTimelineFromRunStages(stageEvents)],
        actions: this.suggestActions(stateBundle, plan)
      });
    } catch (error) {
      if (!stateStepCompleted && stateStep && Date.now() - stateStartedAt > 0) {
        await learningRunService.failStep(stateStep.id, error).catch(() => undefined);
      }
      throw error;
    }
  }

  async execute(input: MclExecuteInput) {
    const intent = inferIntent(input);
    const userInput = input.userInput || latestUserMessage(input.messages) || intent;
    const stateBundle = await learningStateBuilder.build({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || input.context?.workbenchId || null,
      goalId: input.goalId || null,
      intent,
      userInput,
      resourceType: input.resourceType,
      context: input.context
    });

    if (intent === 'state') {
      return {
        intent,
        learningState: stateBundle.state,
        contextCapsule: stateBundle.capsule,
        contextPolicy: stateBundle.contextPolicy,
        timeline: summarizeTimeline(stateBundle),
        actions: this.suggestActions(stateBundle)
      };
    }

    if (intent === 'chat') {
      const result = await multiAgentOrchestrator.chat({
        messages: input.messages?.length ? input.messages : [{ role: 'user', content: userInput }],
        context: {
          ...(input.context || {}),
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null
        } as ClientWorkbenchContext
      });
      return {
        ...result,
        intent,
        learningState: stateBundle.state,
        actions: this.suggestActions(stateBundle)
      };
    }

    if (intent === 'planning') {
      const run = await learningRunService.startRun({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context?.workbenchId || null,
        goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
        intent: 'mcl:planning',
        input: {
          userInput,
          previousPlanVersion: input.previousPlan?.version || null,
          capsuleId: stateBundle.capsule.capsuleId
        }
      });

      try {
        const previous = input.previousPlan || this.extractPreviousPlan(stateBundle);
        const plan = await mclPlannerService.planOrRevise({
          stateBundle,
          userInput,
          previousPlan: previous
        });

        if (previous?.id) {
          await learningMemoryService.supersedeLearningPlan(previous.id);
        }

        await learningMemoryService.saveLearningPlan({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
          scope: plan.scope,
          plan
        });

        await learningMemoryService.recordEvent({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
          eventType: previous ? 'mcl.plan_revised' : 'mcl.plan_created',
          actor: 'agent',
          payload: {
            planId: plan.id,
            version: plan.version,
            nextStepId: plan.nextStepId,
            stepCount: plan.steps.length
          }
        });

        await learningMemoryService.createTrace({
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
          summary: `MCL Planner 输出 v${plan.version} 计划：${plan.objective}`,
          mastery: {
            planning: {
              planId: plan.id,
              version: plan.version,
              nextStepId: plan.nextStepId
            }
          },
          nextActions: plan.steps.slice(0, 3).map((step) => step.title)
        });

        await learningRunService.completeRun(run.id, {
          intent,
          planId: plan.id,
          version: plan.version,
          nextStepId: plan.nextStepId
        });

        return {
          intent,
          runId: run.id,
          learningState: stateBundle.state,
          plan,
          contextCapsule: stateBundle.capsule,
          contextPolicy: stateBundle.contextPolicy,
          timeline: summarizeTimeline(stateBundle),
          actions: this.suggestActions(stateBundle, plan)
        };
      } catch (error) {
        await learningRunService.failRun(run.id, error);
        throw error;
      }
    }

    if (intent === 'studio_generate') {
      const resourceType = resolveStudioResourceType(input, intent);
      const result = await aiStudioService.generate({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context?.workbenchId || null,
        resourceType,
        prompt: userInput,
        options: input.options,
        context: {
          ...(input.context || {}),
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null
        } as ClientWorkbenchContext
      });
      await learningMemoryService.recordEvent({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context?.workbenchId || null,
        goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
        eventType: 'mcl.artifact_generated',
        actor: 'agent',
        payload: {
          intent,
          resourceType,
          runId: result.runId,
          fileObjectId: result.file.id,
          source: result.source
        }
      });
      return {
        intent,
        artifact: result,
        learningState: stateBundle.state,
        runId: result.runId,
        contextCapsule: result.contextCapsule || stateBundle.capsule,
        contextPolicy: result.contextPolicy || stateBundle.contextPolicy,
        actions: this.suggestActions(stateBundle)
      };
    }

    const capability = capabilityForIntent(intent, input.capability);
    if (!capability) throw new Error(`MCL intent "${intent}" is not supported yet`);

    const run = await learningRunService.startRun({
      workspaceId: input.workspaceId,
      workbenchId: input.workbenchId || input.context?.workbenchId || null,
      goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
      intent: `mcl:${intent}`,
      input: {
        userInput,
        capability,
        resourceType: input.resourceType,
        state: {
          goalId: stateBundle.state.activeGoal?.id || null,
          capsuleId: stateBundle.capsule.capsuleId
        }
      }
    });

    try {
      const output = await capabilityRegistry.execute(
        capability,
        {
          ...(input.capabilityInput || {}),
          goalText: input.capabilityInput?.goalText || userInput,
          query: input.capabilityInput?.query || userInput,
          skills: input.capabilityInput?.skills || stateBundle.state.activeGoal?.skills
        },
        {
          runId: run.id,
          workspaceId: input.workspaceId,
          workbenchId: input.workbenchId || input.context?.workbenchId || null,
          goalId: stateBundle.state.activeGoal?.id || input.goalId || null
        }
      );
      await learningMemoryService.recordEvent({
        workspaceId: input.workspaceId,
        workbenchId: input.workbenchId || input.context?.workbenchId || null,
        goalId: stateBundle.state.activeGoal?.id || input.goalId || null,
        eventType: 'mcl.capability_executed',
        actor: 'agent',
        payload: {
          intent,
          capability,
          runId: run.id
        }
      });
      await learningRunService.completeRun(run.id, { output, intent, capability });
      return {
        intent,
        runId: run.id,
        capability,
        output,
        learningState: stateBundle.state,
        contextCapsule: stateBundle.capsule,
        contextPolicy: stateBundle.contextPolicy,
        timeline: summarizeTimeline(stateBundle),
        actions: this.suggestActions(stateBundle)
      };
    } catch (error) {
      await learningRunService.failRun(run.id, error);
      throw error;
    }
  }

  private suggestActions(stateBundle: BuiltMclLearningState, plan?: LearningPlan) {
    const actions = [];
    if (!plan) {
      actions.push({
        id: 'build-plan',
        label: '生成动态学习计划',
        intent: 'planning'
      });
    } else if (plan.nextStepId) {
      const nextStep = plan.steps.find((step) => step.id === plan.nextStepId);
      if (nextStep) {
        actions.push({
          id: 'continue-plan',
          label: `继续：${nextStep.title}`,
          intent:
            nextStep.artifactType || nextStep.type === 'flashcards' || nextStep.type === 'mind_map'
              ? 'studio_generate'
              : nextStep.suggestedCapability || 'reflection',
          resourceType: nextStep.artifactType
        });
      }
      actions.push({
        id: 'replan',
        label: '根据新状态重规划',
        intent: 'planning'
      });
    }
    if (!stateBundle.state.activeGoal) {
      actions.push({
        id: 'create-goal',
        label: '规划学习目标',
        intent: 'goal_planning'
      });
    }
    if (!stateBundle.state.readiness.stats.chunkCount) {
      actions.push({
        id: 'index-knowledge',
        label: '索引 Workspace 资料',
        intent: 'knowledge_retrieval'
      });
    }
    actions.push(
      { id: 'generate-quiz', label: '生成测验', intent: 'studio_generate', resourceType: 'quiz' },
      { id: 'generate-flashcards', label: '生成复习卡', intent: 'studio_generate', resourceType: 'flashcards' },
      { id: 'reflect-progress', label: '总结学习进度', intent: 'reflection' }
    );
    return actions;
  }

  private extractPreviousPlan(stateBundle: BuiltMclLearningState): LearningPlan | null {
    const plan = stateBundle.state.activePlan;
    if (!plan) return null;

    return {
      id: plan.id,
      workspaceId: plan.workspaceId,
      workbenchId: plan.workbenchId || null,
      goalId: plan.goalId || null,
      scope: plan.scope === 'workspace' || plan.scope === 'workbench' || plan.scope === 'goal' ? plan.scope : 'goal',
      version: plan.version,
      status:
        plan.status === 'active' || plan.status === 'paused' || plan.status === 'completed' || plan.status === 'superseded'
          ? plan.status
          : 'active',
      objective: plan.objective,
      rationale: plan.rationale,
      assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.map((item) => String(item)) : [],
      constraints: Array.isArray(plan.constraints) ? plan.constraints.map((item) => String(item)) : [],
      targetSkills: Array.isArray(plan.targetSkills) ? plan.targetSkills.map((item) => String(item)) : [],
      weakSkills: Array.isArray(plan.weakSkills) ? plan.weakSkills.map((item) => String(item)) : [],
      milestones: Array.isArray(plan.milestones) ? (plan.milestones as LearningPlan['milestones']) : [],
      steps: Array.isArray(plan.steps) ? (plan.steps as LearningPlan['steps']) : [],
      adaptationPolicy:
        plan.adaptationPolicy &&
        typeof plan.adaptationPolicy === 'object' &&
        Array.isArray((plan.adaptationPolicy as Record<string, unknown>).replanTriggers) &&
        Array.isArray((plan.adaptationPolicy as Record<string, unknown>).progressionSignals) &&
        Array.isArray((plan.adaptationPolicy as Record<string, unknown>).fallbackActions)
          ? {
              replanTriggers: ((plan.adaptationPolicy as Record<string, unknown>).replanTriggers as unknown[]).map((item) => String(item)),
              progressionSignals: ((plan.adaptationPolicy as Record<string, unknown>).progressionSignals as unknown[]).map((item) =>
                String(item)
              ),
              fallbackActions: ((plan.adaptationPolicy as Record<string, unknown>).fallbackActions as unknown[]).map((item) =>
                String(item)
              )
            }
          : { replanTriggers: [], progressionSignals: [], fallbackActions: [] },
      evidence:
        plan.evidence &&
        typeof plan.evidence === 'object' &&
        Array.isArray((plan.evidence as Record<string, unknown>).citations)
          ? {
              citations: ((plan.evidence as Record<string, unknown>).citations as unknown[]).map((item) => String(item)),
              activeGoalTitle: String((plan.evidence as Record<string, unknown>).activeGoalTitle || '') || null,
              currentTaskIntent: String((plan.evidence as Record<string, unknown>).currentTaskIntent || ''),
              readinessSummary: String((plan.evidence as Record<string, unknown>).readinessSummary || '')
            }
          : { citations: [], currentTaskIntent: '', readinessSummary: '' },
      diagnosticReport: plan.diagnosticReport as unknown as LearningPlan['diagnosticReport'],
      candidateResources: Array.isArray(plan.candidateResources) ? (plan.candidateResources as LearningPlan['candidateResources']) : [],
      knowledgeGraphSnapshot: plan.knowledgeGraphSnapshot as unknown as LearningPlan['knowledgeGraphSnapshot'],
      reflectionHistory: Array.isArray(plan.reflectionHistory) ? (plan.reflectionHistory as LearningPlan['reflectionHistory']) : [],
      constraintScores: plan.constraintScores as unknown as LearningPlan['constraintScores'],
      revisionCount: typeof plan.revisionCount === 'number' ? plan.revisionCount : 0,
      nextStepId: plan.nextStepId || null,
      previousPlanId: plan.previousPlanId || null,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    };
  }
}

export const mclOrchestrator = new MclOrchestrator();
