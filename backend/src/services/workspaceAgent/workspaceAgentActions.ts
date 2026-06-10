import crypto from 'crypto';
import prisma from '../../config/db';
import { FileSystemService } from '../fileSystemService';
import { learningMemoryService } from '../learningMemoryService';
import { learningOrchestrationService } from '../learningOrchestrationService';
import type { LearningPlan } from '../planningTypes';
import { savedMemoryService } from '../savedMemoryService';
import { aiStudioService, type StudioResourceType } from '../aiStudioService';
import { codeExecutionService } from '../studio/codeExecutionService';
import { studioRenderJobService } from '../studio/renderJobService';
import { studioV2Service } from '../studio/studioV2Service';
import { studioTemplateRegistry } from '../studio/templateRegistry';
import type { StudioGoalCategory } from '../studio/types';
import type { ClientWorkbenchContext } from '../contextSystemService';
import { knowledgeIndexingService } from '../knowledgeIndexingService';
import { courseGraphBuildService } from '../courseGraphBuildService';
import { resourceIntelligenceService } from '../resourceIntelligenceService';

export type WorkspaceAgentRiskLevel = 'low' | 'medium' | 'high';

export type WorkspaceAgentActionType =
  | 'save_memory'
  | 'create_workbench'
  | 'save_learning_plan'
  | 'apply_learning_plan'
  | 'create_note'
  | 'save_generated_content'
  | 'bind_resource_to_workbench'
  | 'generate_studio_artifact'
  | 'recommend_studio_artifacts'
  | 'list_studio_artifacts'
  | 'retry_studio_render_job'
  | 'run_code_lab'
  | 'judge_studio_quiz_answer'
  | 'assist_studio_quiz_question'
  | 'index_file'
  | 'analyze_resource'
  | 'build_course_graph'
  | 'write_file'
  | 'workspace_action';

export interface WorkspaceAgentArtifact {
  id: string;
  kind: 'file' | 'studio_artifact' | 'plan' | 'memory' | 'workbench' | 'job' | 'preview';
  title: string;
  summary: string;
  contentPreview?: string;
  target?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceAgentChangeSetItem {
  id: string;
  actionType: WorkspaceAgentActionType | string;
  title: string;
  description: string;
  operation: 'create' | 'update' | 'bind' | 'run_job' | 'delete' | 'noop';
  risk: WorkspaceAgentRiskLevel;
  target: Record<string, unknown>;
  artifacts?: WorkspaceAgentArtifact[];
  reversible?: boolean;
}

export interface WorkspaceAgentChangeSet {
  id: string;
  title: string;
  summary: string;
  items: WorkspaceAgentChangeSetItem[];
  risk: WorkspaceAgentRiskLevel;
  requiresApproval: true;
}

export interface WorkspaceAgentProposal {
  id: string;
  type: WorkspaceAgentActionType | string;
  title: string;
  description: string;
  risk: WorkspaceAgentRiskLevel;
  requiresConfirmation: true;
  payload: Record<string, unknown>;
  artifacts?: WorkspaceAgentArtifact[];
  changeSet?: WorkspaceAgentChangeSet;
}

export interface WorkspaceAgentExecutedAction {
  id: string;
  proposalId: string;
  type: string;
  title: string;
  success: boolean;
  summary: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface WorkspaceAgentActionContext {
  workspaceId: string;
  workbenchId?: string | null;
  userId?: string | null;
  userInput: string;
  evidence?: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    content?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }>;
  goalDraft?: {
    title: string;
    goalText: string;
    skills: string[];
    weaknesses: string[];
    suggestedMode: 'quick-start' | 'project' | 'review';
  } | null;
}

type ActionExecute = (
  context: WorkspaceAgentActionContext,
  proposal: WorkspaceAgentProposal
) => Promise<WorkspaceAgentExecutedAction>;

interface WorkspaceAgentActionDefinition {
  type: WorkspaceAgentActionType;
  title: string;
  description: string;
  defaultRisk: WorkspaceAgentRiskLevel;
  reversible: boolean;
  execute?: ActionExecute;
}

const clip = (value: unknown, maxLength = 800) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const nowIso = () => new Date().toISOString();

const riskRank: Record<WorkspaceAgentRiskLevel, number> = { low: 0, medium: 1, high: 2 };

const maxRisk = (items: WorkspaceAgentRiskLevel[]) =>
  items.reduce<WorkspaceAgentRiskLevel>((max, item) => (riskRank[item] > riskRank[max] ? item : max), 'low');

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];

const payloadString = (payload: Record<string, unknown>, key: string, fallback = '') =>
  typeof payload[key] === 'string' && String(payload[key]).trim() ? String(payload[key]).trim() : fallback;

const payloadObject = <T extends Record<string, unknown>>(payload: Record<string, unknown>, key: string): T | null =>
  payload[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key]) ? payload[key] as T : null;

const STUDIO_RESOURCE_TYPES = new Set<StudioResourceType>([
  'report',
  'slide_deck',
  'mind_map',
  'flashcards',
  'quiz',
  'data_table'
]);

const STUDIO_GOALS = new Set<StudioGoalCategory>([
  'understand',
  'map',
  'practice',
  'review',
  'lab',
  'visualize',
  'plan'
]);

const payloadLimit = (payload: Record<string, unknown>, key: string, fallback: number, min = 1, max = 100) => {
  const value = typeof payload[key] === 'number' ? payload[key] : Number(payload[key]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
};

const validStudioGoal = (value: unknown): StudioGoalCategory | undefined => {
  const goal = String(value || '').trim();
  return STUDIO_GOALS.has(goal as StudioGoalCategory) ? goal as StudioGoalCategory : undefined;
};

const validStudioResourceType = (value: unknown): StudioResourceType | null => {
  const resourceType = String(value || '').trim();
  return STUDIO_RESOURCE_TYPES.has(resourceType as StudioResourceType) ? resourceType as StudioResourceType : null;
};

const artifact = (
  kind: WorkspaceAgentArtifact['kind'],
  title: string,
  summary: string,
  metadata?: Record<string, unknown>,
  contentPreview?: string
): WorkspaceAgentArtifact => ({
  id: `artifact-${crypto.randomUUID()}`,
  kind,
  title,
  summary,
  metadata,
  contentPreview: contentPreview ? clip(contentPreview, 1200) : undefined
});

const executedBase = (proposal: WorkspaceAgentProposal) => ({
  id: `executed-${crypto.randomUUID()}`,
  proposalId: proposal.id,
  type: proposal.type,
  title: proposal.title
});

const inferBindingRole = (file: any) => {
  const role = String(file.resourceType || file.fileCategory || '').toLowerCase();
  if (['source', 'generated', 'artifact'].includes(role)) return role;
  if (role.includes('web') || role.includes('source')) return 'source';
  if (role.includes('generated')) return 'generated';
  return 'file';
};

const bindResourcesToWorkbench = async (input: {
  workspaceId: string;
  workbenchId: string;
  fileObjectIds: string[];
  source?: string;
}) => {
  const uniqueIds = Array.from(new Set(input.fileObjectIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return { bound: [] as string[] };

  const workbench = await prisma.workbench.findFirst({
    where: { id: input.workbenchId, workspaceId: input.workspaceId },
    select: { id: true }
  });
  if (!workbench) throw new Error('Workbench not found');

  const files = await prisma.fileSystemObject.findMany({
    where: {
      workspaceId: input.workspaceId,
      nodeType: 'file',
      id: { in: uniqueIds }
    },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }]
  });

  await prisma.$transaction(
    files.map((file: any, index: number) => {
      const role = inferBindingRole(file);
      return (prisma as any).workbenchResource.upsert({
        where: {
          workbenchId_fileObjectId_role: {
            workbenchId: input.workbenchId,
            fileObjectId: file.id,
            role
          }
        },
        create: {
          workbenchId: input.workbenchId,
          fileObjectId: file.id,
          role,
          source: input.source || file.origin || 'agent',
          orderIndex: index,
          metadataJson: JSON.stringify({ selectedFrom: 'workspace_agent', boundAt: nowIso() })
        },
        update: {
          source: input.source || file.origin || 'agent',
          orderIndex: index,
          metadataJson: JSON.stringify({ selectedFrom: 'workspace_agent', boundAt: nowIso() })
        }
      });
    })
  );

  return { bound: files.map((file: any) => file.id), files: files.map((file: any) => ({ id: file.id, name: file.name })) };
};

const buildMinimalStudioContext = (
  context: WorkspaceAgentActionContext,
  payload: Record<string, unknown>
): ClientWorkbenchContext => {
  const fileIds = asStringArray(payload.fileObjectIds).concat(asStringArray(payload.fileIds));
  const evidenceFileIds = (context.evidence || [])
    .map((item) => String(item.metadata?.fileObjectId || '').trim())
    .filter(Boolean);
  return {
    workspaceId: context.workspaceId,
    workbenchId: context.workbenchId || null,
    contextMode: 'auto',
    sourcePriority: fileIds.length || evidenceFileIds.length ? 'selected_resources' : 'mixed',
    selectedResourceIds: Array.from(new Set([...fileIds, ...evidenceFileIds])).slice(0, 12)
  };
};

const lightweightPlanFromDraft = (context: WorkspaceAgentActionContext, proposal: WorkspaceAgentProposal) => {
  const planDraft = payloadObject<Record<string, any>>(proposal.payload, 'planDraft') || {};
  const objective = String(planDraft.objective || context.userInput || 'Workspace learning plan').trim();
  const steps = Array.isArray(planDraft.steps)
    ? planDraft.steps.map((item: any, index: number) => ({
        id: String(item?.id || `step-${index + 1}`),
        type: 'explain',
        title: String(item?.title || item?.task || `Step ${index + 1}`),
        rationale: String(item?.rationale || item?.why || ''),
        targetSkills: Array.isArray(item?.targetSkills) ? item.targetSkills.map(String) : [],
        prerequisites: Array.isArray(item?.prerequisites) ? item.prerequisites.map(String) : [],
        estimatedLoad: ['light', 'medium', 'heavy'].includes(item?.estimatedLoad) ? item.estimatedLoad : 'medium',
        expectedEvidence: Array.isArray(item?.expectedEvidence) ? item.expectedEvidence.map(String) : [],
        status: index === 0 ? 'active' : 'pending'
      }))
    : [];
  return {
    id: crypto.randomUUID(),
    workspaceId: context.workspaceId,
    workbenchId: context.workbenchId || null,
    goalId: null,
    scope: context.workbenchId ? 'workbench' : 'workspace',
    version: 1,
    status: 'active',
    objective,
    rationale: String(planDraft.rationale || 'Saved from approved AI Terminal plan draft.'),
    assumptions: Array.isArray(planDraft.assumptions) ? planDraft.assumptions.map(String) : [],
    constraints: Array.isArray(planDraft.constraints) ? planDraft.constraints.map(String) : [],
    targetSkills: Array.isArray(planDraft.targetSkills) ? planDraft.targetSkills.map(String) : [],
    weakSkills: Array.isArray(planDraft.weakSkills) ? planDraft.weakSkills.map(String) : [],
    milestones: [],
    steps,
    adaptationPolicy: { replanTriggers: [], progressionSignals: [], fallbackActions: [] },
    evidence: {
      citations: (context.evidence || []).slice(0, 8).map((item) => item.title),
      currentTaskIntent: context.userInput,
      readinessSummary: 'Created from approved AI Terminal plan draft.'
    },
    diagnosticReport: {
      learnerLevel: 'unknown',
      targetGoal: objective,
      currentStateSummary: '',
      strengths: [],
      weakSkills: [],
      prerequisiteGaps: [],
      preferredResourceForms: [],
      timeBudget: { sessionMinutes: 30, weeklySessions: 3 },
      cognitiveLoadTolerance: 'medium',
      recommendedDifficultyBand: { min: 0.3, max: 0.7 }
    },
    candidateResources: [],
    knowledgeGraphSnapshot: { nodes: [], edges: [] },
    reflectionHistory: [],
    constraintScores: {
      cltScore: 0.6,
      zpdScore: 0.6,
      alignmentScore: 0.6,
      confidence: 0.55,
      summary: 'Lightweight terminal-approved plan.'
    },
    revisionCount: 0,
    nextStepId: steps[0]?.id || null,
    previousPlanId: null,
    naturalPlanMarkdown: '',
    structuredPlan: null,
    skipPlanningSideEffects: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  } as any;
};

export class WorkspaceAgentActionRegistry {
  private definitions = new Map<WorkspaceAgentActionType, WorkspaceAgentActionDefinition>();

  constructor() {
    this.registerDefaults();
  }

  list() {
    return Array.from(this.definitions.values()).map((definition) => ({
      type: definition.type,
      title: definition.title,
      description: definition.description,
      defaultRisk: definition.defaultRisk,
      reversible: definition.reversible,
      executable: Boolean(definition.execute)
    }));
  }

  get(type: string) {
    return this.definitions.get(type as WorkspaceAgentActionType);
  }

  preview(proposal: WorkspaceAgentProposal): WorkspaceAgentProposal {
    const definition = this.get(proposal.type);
    const risk = proposal.risk || definition?.defaultRisk || 'medium';
    const target = {
      workspaceId: proposal.payload.workspaceId,
      workbenchId: proposal.payload.workbenchId || null,
      ...payloadObject<Record<string, unknown>>(proposal.payload, 'target')
    };
    const artifacts = proposal.artifacts || this.previewArtifacts(proposal);
    const changeSet: WorkspaceAgentChangeSet = proposal.changeSet || {
      id: `changeset-${crypto.randomUUID()}`,
      title: proposal.title,
      summary: proposal.description,
      risk,
      requiresApproval: true,
      items: [{
        id: `change-${crypto.randomUUID()}`,
        actionType: proposal.type,
        title: proposal.title,
        description: proposal.description,
        operation: this.operationFor(proposal.type),
        risk,
        target,
        artifacts,
        reversible: definition?.reversible ?? false
      }]
    };
    return { ...proposal, risk, artifacts, changeSet };
  }

  async execute(
    context: WorkspaceAgentActionContext,
    proposal: WorkspaceAgentProposal
  ): Promise<WorkspaceAgentExecutedAction> {
    const definition = this.get(proposal.type);
    if (!definition?.execute) {
      return {
        ...executedBase(proposal),
        success: false,
        summary: `当前还没有 ${proposal.type} 的确认后执行器。`,
        error: 'unsupported_proposal_executor'
      };
    }
    return definition.execute(context, proposal);
  }

  private register(definition: WorkspaceAgentActionDefinition) {
    this.definitions.set(definition.type, definition);
  }

  private registerDefaults() {
    this.register({
      type: 'save_memory',
      title: '保存长期记忆',
      description: '保存用户明确表达的长期偏好、背景或约束。',
      defaultRisk: 'medium',
      reversible: true,
      execute: async (context, proposal) => {
        if (!context.userId) throw new Error('缺少 userId，无法保存长期记忆。');
        const text = payloadString(proposal.payload, 'candidateText', context.userInput);
        const memory = await savedMemoryService.upsert({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          userId: context.userId,
          text,
          category: payloadString(proposal.payload, 'category', 'note'),
          source: 'workspace_agent_approval',
          confidence: 0.9
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已保存长期记忆：${clip(memory.text, 120)}`,
          result: { memoryId: memory.id, memoryKey: memory.memoryKey }
        };
      }
    });

    this.register({
      type: 'create_workbench',
      title: '创建学习现场',
      description: '基于当前学习目标创建 guided workbench。',
      defaultRisk: 'medium',
      reversible: false,
      execute: async (context, proposal) => {
        const goalDraft = (payloadObject(proposal.payload, 'goalDraft') || context.goalDraft || {
          title: clip(context.userInput, 24) || '学习计划',
          goalText: context.userInput,
          skills: [],
          weaknesses: [],
          suggestedMode: 'quick-start'
        }) as any;
        const result = await learningOrchestrationService.createGuidedWorkbench({
          workspaceId: context.workspaceId,
          goalText: goalDraft.goalText || context.userInput,
          title: goalDraft.title,
          mode: goalDraft.suggestedMode,
          goalDraft
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已创建学习现场：${result.workbench.title}`,
          result: {
            workbenchId: result.workbench.id,
            generatedResourceIds: result.generatedResources.map((resource: any) => resource.id)
          }
        };
      }
    });

    this.register({
      type: 'save_learning_plan',
      title: '保存学习计划',
      description: '保存 planner 生成或用户确认的学习计划。',
      defaultRisk: 'medium',
      reversible: true,
      execute: async (context, proposal) => {
        const proposedPlan = proposal.payload.plan as LearningPlan | undefined;
        const plan = proposedPlan?.id && proposedPlan.objective && Array.isArray(proposedPlan.steps)
          ? proposedPlan
          : lightweightPlanFromDraft(context, proposal);
        const savedPlan = await learningMemoryService.saveLearningPlan({
          workspaceId: context.workspaceId,
          workbenchId: (plan as any).workbenchId || context.workbenchId || null,
          goalId: (plan as any).goalId || null,
          scope: (plan as any).scope || (context.workbenchId ? 'workbench' : 'workspace'),
          supersedePrevious: Boolean(proposal.payload.supersedePrevious),
          plan: {
            ...(plan as any),
            workspaceId: context.workspaceId,
            workbenchId: (plan as any).workbenchId || context.workbenchId || null,
            updatedAt: nowIso()
          }
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已保存学习计划：${(savedPlan as any).objective || (plan as any).objective}`,
          result: {
            planId: (savedPlan as any).id,
            version: (savedPlan as any).version,
            scope: (savedPlan as any).scope
          }
        };
      }
    });

    this.register({
      type: 'apply_learning_plan',
      title: '应用学习计划',
      description: '将已保存学习计划应用到 Workbench。',
      defaultRisk: 'medium',
      reversible: false,
      execute: async (context, proposal) => {
        const planId = payloadString(proposal.payload, 'planId');
        if (!planId) throw new Error('缺少 planId。');
        const result = await learningMemoryService.applyLearningPlanToWorkbench({
          workspaceId: context.workspaceId,
          planId,
          workbenchId: payloadString(proposal.payload, 'targetWorkbenchId', context.workbenchId || '') || null,
          createWorkbench: Boolean(proposal.payload.createWorkbench),
          workbenchTitle: payloadString(proposal.payload, 'workbenchTitle') || undefined
        });
        if (!result) throw new Error('Learning plan not found');
        return {
          ...executedBase(proposal),
          success: true,
          summary: '已将学习计划应用到 Workbench。',
          result: result as Record<string, unknown>
        };
      }
    });

    this.register({
      type: 'save_generated_content',
      title: '保存生成内容',
      description: '把 Agent 生成的内容保存为 workspace/workbench 文件。',
      defaultRisk: 'medium',
      reversible: true,
      execute: async (context, proposal) => {
        const content = payloadString(proposal.payload, 'content', context.userInput);
        const filename = payloadString(proposal.payload, 'filename', 'agent-generated-note.md');
        const file = await FileSystemService.saveGeneratedContent({
          workspaceId: context.workspaceId,
          targetDir: payloadString(proposal.payload, 'targetDir', 'Generated'),
          filename,
          category: payloadString(proposal.payload, 'category', 'generated'),
          workbenchId: context.workbenchId || undefined,
          resourceRole: payloadString(proposal.payload, 'resourceRole', 'generated'),
          resourceType: payloadString(proposal.payload, 'resourceType', 'generated'),
          scope: context.workbenchId ? 'workbench' : 'workspace',
          origin: 'agent',
          metadata: { generator: 'workspace_agent', proposalId: proposal.id },
          content
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已保存文件：${file.name}`,
          result: { fileObjectId: file.id, path: file.path, name: file.name }
        };
      }
    });

    this.register({
      type: 'create_note',
      title: '创建学习笔记',
      description: '把回答或草稿保存为可继续编辑的 Markdown 笔记。',
      defaultRisk: 'medium',
      reversible: true,
      execute: async (context, proposal) => this.execute(context, {
        ...proposal,
        type: 'save_generated_content',
        payload: {
          ...proposal.payload,
          filename: payloadString(proposal.payload, 'filename', 'agent-note.md'),
          category: 'note',
          resourceRole: 'generated',
          resourceType: 'generated'
        }
      })
    });

    this.register({
      type: 'bind_resource_to_workbench',
      title: '绑定资源到 Workbench',
      description: '把已有资料或生成产物绑定到当前学习现场。',
      defaultRisk: 'medium',
      reversible: true,
      execute: async (context, proposal) => {
        const workbenchId = payloadString(proposal.payload, 'targetWorkbenchId', context.workbenchId || '');
        const fileObjectIds = asStringArray(proposal.payload.fileObjectIds).concat(asStringArray(proposal.payload.fileIds));
        if (!workbenchId) throw new Error('缺少 targetWorkbenchId/workbenchId。');
        if (!fileObjectIds.length) throw new Error('缺少 fileObjectIds。');
        const result = await bindResourcesToWorkbench({
          workspaceId: context.workspaceId,
          workbenchId,
          fileObjectIds,
          source: 'agent'
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已绑定 ${result.bound.length} 个资源到 Workbench。`,
          result
        };
      }
    });

    this.register({
      type: 'generate_studio_artifact',
      title: '生成 AI Studio 产物',
      description: '调用 AI Studio 模板生成学习资源并保存为文件/artifact。',
      defaultRisk: 'medium',
      reversible: true,
      execute: async (context, proposal) => {
        const resourceType = validStudioResourceType(proposal.payload.resourceType);
        const templateId = payloadString(
          proposal.payload,
          'templateId',
          resourceType ? '' : 'resource_to_notes'
        );
        const prompt = payloadString(proposal.payload, 'prompt', context.userInput);
        const options = payloadObject(proposal.payload, 'options') || {};
        if (resourceType && !templateId) {
          const result = await aiStudioService.generate({
            workspaceId: context.workspaceId,
            workbenchId: context.workbenchId || null,
            resourceType,
            prompt,
            options,
            context: buildMinimalStudioContext(context, proposal.payload)
          });
          return {
            ...executedBase(proposal),
            success: true,
            summary: `已生成 Studio 资源：${result.file.name}`,
            result: {
              fileObjectId: result.file.id,
              path: result.file.path,
              resourceType,
              flashcardDeckId: result.flashcardDeck?.id || null,
              runId: result.runId,
              source: result.source,
              qualityScore: result.qualityReport?.score ?? null
            }
          };
        }
        const template = studioTemplateRegistry.get(templateId);
        if (!template) throw new Error(`Studio template "${templateId}" not found`);
        const result = await studioV2Service.generate({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          goal: validStudioGoal(proposal.payload.goal) || template.goal,
          templateId,
          prompt: prompt || template.promptFrame,
          options: Object.keys(options).length ? options : template.defaultOptions || {},
          context: buildMinimalStudioContext(context, proposal.payload)
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已生成 Studio 产物：${result.file.name}`,
          result: {
            fileObjectId: result.file.id,
            path: result.file.path,
            artifactId: result.artifact?.id || null,
            renderJobId: result.renderJob?.id || null,
            templateId,
            runId: result.runId
          }
        };
      }
    });

    this.register({
      type: 'recommend_studio_artifacts',
      title: '推荐 AI Studio 产物',
      description: '调用 AI Studio 推荐器，基于当前目标和上下文推荐可生成的学习产物。',
      defaultRisk: 'low',
      reversible: false,
      execute: async (context, proposal) => {
        const result = await studioV2Service.recommend({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          goal: validStudioGoal(proposal.payload.goal),
          context: buildMinimalStudioContext(context, proposal.payload)
        });
        const recommendations = Array.isArray((result as any).recommendations)
          ? (result as any).recommendations
          : Array.isArray(result)
            ? result
            : [];
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已生成 ${recommendations.length} 条 AI Studio 推荐。`,
          result: result as Record<string, unknown>
        };
      }
    });

    this.register({
      type: 'list_studio_artifacts',
      title: '列出 AI Studio 产物',
      description: '读取当前 workspace/workbench 已生成的 AI Studio 产物。',
      defaultRisk: 'low',
      reversible: false,
      execute: async (context, proposal) => {
        const artifacts = await studioV2Service.listArtifacts({
          workspaceId: context.workspaceId,
          workbenchId: proposal.payload.workbenchId === false ? null : context.workbenchId || null,
          limit: payloadLimit(proposal.payload, 'limit', 20, 1, 100)
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已读取 ${artifacts.length} 个 AI Studio 产物。`,
          result: { artifacts }
        };
      }
    });

    this.register({
      type: 'retry_studio_render_job',
      title: '重试 Studio 渲染任务',
      description: '对已有 Studio render job 执行重试。',
      defaultRisk: 'medium',
      reversible: false,
      execute: async (context, proposal) => {
        const renderJobId = payloadString(proposal.payload, 'renderJobId') || payloadString(proposal.payload, 'jobId');
        if (!renderJobId) throw new Error('缺少 renderJobId。');
        const existing = await studioRenderJobService.get({ workspaceId: context.workspaceId, id: renderJobId });
        if (!existing) throw new Error('Render job not found');
        const job = await studioRenderJobService.run(renderJobId);
        if (!job) throw new Error('Render job retry failed');
        return {
          ...executedBase(proposal),
          success: job.status !== 'failed',
          summary: `渲染任务状态：${job.status} / ${job.stage}`,
          result: { job }
        };
      }
    });

    this.register({
      type: 'run_code_lab',
      title: '运行 Code Lab',
      description: '调用 AI Studio Code Lab 运行用户提供的代码。',
      defaultRisk: 'high',
      reversible: false,
      execute: async (_context, proposal) => {
        const language = payloadString(proposal.payload, 'language', 'python');
        const sourceCode = payloadString(proposal.payload, 'sourceCode');
        if (!sourceCode) throw new Error('缺少 sourceCode。');
        const result = await codeExecutionService.run({
          language,
          sourceCode,
          stdin: payloadString(proposal.payload, 'stdin')
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `Code Lab 执行完成：${result.status.description}`,
          result: result as unknown as Record<string, unknown>
        };
      }
    });

    this.register({
      type: 'judge_studio_quiz_answer',
      title: '批改 Studio Quiz 答案',
      description: '调用 AI Studio Quiz Judge 批改单题答案，并写入学习事件/画像。',
      defaultRisk: 'medium',
      reversible: false,
      execute: async (context, proposal) => {
        const question = payloadObject<any>(proposal.payload, 'question');
        const userAnswer = payloadString(proposal.payload, 'userAnswer');
        if (!question) throw new Error('缺少 question。');
        if (!userAnswer) throw new Error('缺少 userAnswer。');
        const result = await aiStudioService.judgeQuizAnswer({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          question,
          userAnswer
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `Quiz 批改完成：${Math.round((Number((result as any).score) || 0) * 100)} 分。`,
          result: result as Record<string, unknown>
        };
      }
    });

    this.register({
      type: 'assist_studio_quiz_question',
      title: '解释 Studio Quiz 题目',
      description: '调用 AI Studio 单题助手，围绕当前题目解释、提示或排查题目质量。',
      defaultRisk: 'low',
      reversible: false,
      execute: async (context, proposal) => {
        const question = payloadObject<any>(proposal.payload, 'question');
        const userMessage = payloadString(proposal.payload, 'userMessage', context.userInput);
        if (!question) throw new Error('缺少 question。');
        if (!userMessage) throw new Error('缺少 userMessage。');
        const result = await aiStudioService.assistQuizQuestion({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          question,
          userMessage,
          userAnswer: payloadString(proposal.payload, 'userAnswer') || undefined
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: '已生成单题解释/提示。',
          result: result as Record<string, unknown>
        };
      }
    });

    this.register({
      type: 'index_file',
      title: '索引文件',
      description: '为指定文件建立知识索引。',
      defaultRisk: 'low',
      reversible: false,
      execute: async (context, proposal) => {
        const fileObjectId = payloadString(proposal.payload, 'fileObjectId') || asStringArray(proposal.payload.fileObjectIds)[0];
        if (!fileObjectId) throw new Error('缺少 fileObjectId。');
        const job = await knowledgeIndexingService.indexFile({
          workspaceId: context.workspaceId,
          fileObjectId,
          reason: 'workspace-agent-action',
          force: Boolean(proposal.payload.force)
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `已完成/启动文件索引：${fileObjectId}`,
          result: { job }
        };
      }
    });

    this.register({
      type: 'analyze_resource',
      title: '分析资源结构',
      description: '运行 Resource Intelligence，提取大纲、章节、阅读建议和结构信息。',
      defaultRisk: 'low',
      reversible: false,
      execute: async (context, proposal) => {
        const fileObjectId = payloadString(proposal.payload, 'fileObjectId') || asStringArray(proposal.payload.fileObjectIds)[0];
        if (!fileObjectId) throw new Error('缺少 fileObjectId。');
        const intelligence = await resourceIntelligenceService.analyze(context.workspaceId, fileObjectId, {
          force: Boolean(proposal.payload.force)
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: `资源分析状态：${intelligence.status}`,
          result: { fileObjectId, status: intelligence.status, overview: clip(intelligence.overview, 240) }
        };
      }
    });

    this.register({
      type: 'build_course_graph',
      title: '构建课程知识图谱',
      description: '基于 workspace 资料重建或增强课程知识图谱。',
      defaultRisk: 'medium',
      reversible: false,
      execute: async (context, proposal) => {
        const report = await courseGraphBuildService.build({
          workspaceId: context.workspaceId,
          workbenchId: context.workbenchId || null,
          reindex: Boolean(proposal.payload.reindex),
          includeWorkspaceResources: proposal.payload.includeWorkspaceResources !== false,
          validate: proposal.payload.validate !== false,
          graphLimit: typeof proposal.payload.graphLimit === 'number' ? proposal.payload.graphLimit : undefined
        });
        return {
          ...executedBase(proposal),
          success: true,
          summary: '已完成课程知识图谱构建/增强。',
          result: report as unknown as Record<string, unknown>
        };
      }
    });

    this.register({
      type: 'write_file',
      title: '写入或修改文件',
      description: '任意文件改写需要差异预览；当前仅生成 proposal，不直接执行。',
      defaultRisk: 'high',
      reversible: true
    });

    this.register({
      type: 'workspace_action',
      title: '执行 Workspace 操作',
      description: '通用 workspace 状态变更占位动作。',
      defaultRisk: 'medium',
      reversible: false
    });
  }

  private operationFor(type: string): WorkspaceAgentChangeSetItem['operation'] {
    if (type === 'save_memory' || type === 'create_workbench' || type === 'create_note' || type === 'save_generated_content' || type === 'generate_studio_artifact') return 'create';
    if (type === 'bind_resource_to_workbench' || type === 'apply_learning_plan') return 'bind';
    if (type === 'index_file' || type === 'analyze_resource' || type === 'build_course_graph' || type === 'retry_studio_render_job' || type === 'run_code_lab' || type === 'judge_studio_quiz_answer' || type === 'assist_studio_quiz_question') return 'run_job';
    if (type === 'write_file' || type === 'save_learning_plan') return 'update';
    return 'noop';
  }

  private previewArtifacts(proposal: WorkspaceAgentProposal): WorkspaceAgentArtifact[] {
    if (proposal.type === 'generate_studio_artifact') {
      const resourceType = payloadString(proposal.payload, 'resourceType');
      if (resourceType) {
        return [artifact('studio_artifact', `AI Studio ${resourceType}`, proposal.description, { resourceType })];
      }
      const templateId = payloadString(proposal.payload, 'templateId', 'resource_to_notes');
      const template = studioTemplateRegistry.get(templateId);
      return [artifact('studio_artifact', template?.title || 'AI Studio Artifact', template?.description || proposal.description, { templateId })];
    }
    if (proposal.type === 'recommend_studio_artifacts') {
      return [artifact('preview', 'AI Studio 推荐', '将基于当前上下文生成 Studio 产物推荐。', {
        goal: proposal.payload.goal || null
      })];
    }
    if (proposal.type === 'list_studio_artifacts') {
      return [artifact('studio_artifact', 'AI Studio 产物列表', '将读取已生成的 Studio 产物。', {
        limit: proposal.payload.limit || 20
      })];
    }
    if (proposal.type === 'retry_studio_render_job') {
      return [artifact('job', 'Studio Render Job', '将重试指定渲染任务。', {
        renderJobId: proposal.payload.renderJobId || proposal.payload.jobId
      })];
    }
    if (proposal.type === 'run_code_lab') {
      return [artifact('preview', 'Code Lab', '将运行用户提供的代码。', {
        language: proposal.payload.language || 'python'
      }, payloadString(proposal.payload, 'sourceCode'))];
    }
    if (proposal.type === 'judge_studio_quiz_answer') {
      return [artifact('preview', 'Quiz 批改', '将批改单题答案并记录学习事件。', undefined, payloadString(proposal.payload, 'userAnswer'))];
    }
    if (proposal.type === 'assist_studio_quiz_question') {
      return [artifact('preview', 'Quiz 单题助手', '将围绕当前题目生成提示或解释。', undefined, payloadString(proposal.payload, 'userMessage'))];
    }
    if (proposal.type === 'create_note' || proposal.type === 'save_generated_content') {
      return [artifact('file', payloadString(proposal.payload, 'filename', 'agent-generated-note.md'), '将创建一个可编辑文件。', {
        targetDir: payloadString(proposal.payload, 'targetDir', 'Generated')
      }, payloadString(proposal.payload, 'content'))];
    }
    if (proposal.type === 'save_learning_plan' || proposal.type === 'apply_learning_plan') {
      return [artifact('plan', proposal.title, proposal.description, { planId: proposal.payload.planId })];
    }
    if (proposal.type === 'save_memory') {
      return [artifact('memory', '长期记忆', payloadString(proposal.payload, 'candidateText', '保存一条长期记忆。'))];
    }
    if (proposal.type === 'create_workbench') {
      return [artifact('workbench', '学习现场', '将创建新的 guided workbench。')];
    }
    if (proposal.type === 'index_file' || proposal.type === 'analyze_resource' || proposal.type === 'build_course_graph') {
      return [artifact('job', proposal.title, proposal.description, { actionType: proposal.type })];
    }
    return [artifact('preview', proposal.title, proposal.description)];
  }
}

export const workspaceAgentActionRegistry = new WorkspaceAgentActionRegistry();
